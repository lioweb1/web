/**
 * Content script: runs inside the broker's trading page.
 *
 *  - draws a shadow-DOM overlay with connection state, the latest signal,
 *    today's summary and manual/auto controls,
 *  - executes signals by driving the page's amount input and CALL/PUT buttons,
 *  - detects the result from the balance change after expiry,
 *  - reports balance every 10s and answers the popup's "Test selectors".
 *
 * Nothing here talks to the network directly; all traffic goes through
 * background.js, which only connects to the bot on the user's own machine.
 */
(function () {
  "use strict";
  const lib = globalThis.__bbLib;
  const STALE_AFTER_SEC = 10;
  const SETTLE_GRACE_MS = 8000;
  const BALANCE_POLLS = 10;
  const BALANCE_POLL_MS = 2000;

  let settings = { ...lib.DEFAULT_SETTINGS };
  let broker = null;
  let connected = false;
  let halted = null;
  let lastSignal = null;
  let summary = null;
  let busy = false; // one trade at a time
  let ui = null;

  // ---------------------------------------------------------------- helpers
  const q = (sel) => (sel ? document.querySelector(sel) : null);

  function toBackground(kind, msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ kind, msg }, (res) => {
          void chrome.runtime.lastError;
          resolve(res || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }
  const sendToServer = (msg) => toBackground("send", msg);

  function readBalance() {
    const el = q(broker.balance);
    if (!el) return NaN;
    return lib.parseMoney(el.textContent || "");
  }

  function readAsset() {
    const el = q(broker.assetLabel);
    return el ? (el.textContent || "").trim() : "";
  }

  /** Set a React/Vue controlled input the way a user would. */
  function setInputValue(input, value) {
    input.focus();
    input.select && input.select();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    input.blur();
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function beep(direction) {
    if (!settings.soundOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = direction === "CALL" ? 880 : 440;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
      osc.onended = () => ctx.close();
    } catch (e) {
      /* audio may be blocked until the user interacts with the page */
    }
  }

  // ---------------------------------------------------------------- trading
  async function execute(signal, source) {
    if (busy) return skip(signal, "another trade in progress");
    if (halted) return skip(signal, `halted: ${halted}`);
    const age = lib.signalAgeSec(signal);
    const maxAge = source === "manual" ? signal.expiry_sec : STALE_AFTER_SEC;
    if (age > maxAge) return skip(signal, `stale signal (${age.toFixed(0)}s old)`);
    if (!settings.ignoreSymbolCheck) {
      const asset = readAsset();
      if (asset && !lib.symbolsMatch(asset, signal.symbol)) {
        return skip(signal, `symbol mismatch (page ${asset}, signal ${signal.symbol})`);
      }
    }
    const before = readBalance();
    if (!Number.isFinite(before)) return skip(signal, "balance not found");
    const input = q(broker.amountInput);
    const button = q(signal.direction === "CALL" ? broker.callButton : broker.putButton);
    if (!input) return skip(signal, "amount input not found");
    if (!button) return skip(signal, `${signal.direction} button not found`);

    busy = true;
    try {
      const stake = settings.stakeOverride || signal.stake || 1;
      setInputValue(input, lib.formatStake(stake, broker.amountFormat));
      await sleep(150);
      button.click();
      const placedAt = Date.now();
      sendToServer({ type: "trade_placed", id: signal.id, at: placedAt, stake, balanceBefore: before });
      ui.setStatus(`placed ${signal.direction} ${stake} · waiting ${signal.expiry_sec}s`);

      await sleep(signal.expiry_sec * 1000 + SETTLE_GRACE_MS);
      let after = NaN;
      for (let i = 0; i < BALANCE_POLLS; i++) {
        after = readBalance();
        if (Number.isFinite(after) && Math.abs(after - before) > 1e-9) break;
        await sleep(BALANCE_POLL_MS);
      }
      const { outcome, pnl } = lib.outcomeFromBalance(before, after);
      sendToServer({ type: "result", id: signal.id, outcome, pnl, balanceBefore: before, balanceAfter: after });
      ui.setStatus(`${outcome.toUpperCase()} ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`);
      ui.flash(outcome);
    } finally {
      busy = false;
    }
  }

  function skip(signal, reason) {
    sendToServer({ type: "skipped", id: signal.id, reason });
    ui.setStatus(`skipped: ${reason}`, true);
  }

  // ---------------------------------------------------------------- server msgs
  function onServerMessage(msg) {
    const v = lib.validateServerMessage(msg);
    if (!v.ok) return;
    switch (msg.type) {
      case "hello":
        halted = null;
        ui.setStatus(`bot v${msg.version} · ${(msg.symbols || []).join(", ")} · ${msg.expiry_sec}s`);
        break;
      case "signal":
        lastSignal = msg;
        ui.showSignal(msg);
        beep(msg.direction);
        if (!settings.autoTrade) {
          skip(msg, "auto-trade off");
        } else if (msg.confidence < settings.minConfidence) {
          skip(msg, `confidence ${msg.confidence.toFixed(2)} < ${settings.minConfidence}`);
        } else {
          execute(msg, "auto");
        }
        break;
      case "status":
        summary = msg.summary || null;
        ui.setSummary(summary);
        break;
      case "halt":
        halted = msg.reason;
        ui.setStatus(`⛔ halted: ${msg.reason}`, true);
        break;
      default:
        break;
    }
  }

  chrome.runtime.onMessage.addListener((req, _sender, reply) => {
    if (!req) return;
    if (req.kind === "server") onServerMessage(req.msg);
    else if (req.kind === "state") {
      connected = !!req.state.connected;
      ui.setConnected(connected, req.state.lastError);
    } else if (req.kind === "testSelectors") {
      reply(testSelectors());
    } else if (req.kind === "settingsChanged") {
      loadSettings();
    }
  });

  // ---------------------------------------------------------------- selector test
  function testSelectors() {
    const keys = ["balance", "amountInput", "callButton", "putButton", "assetLabel"];
    const result = { broker: broker.id, items: [] };
    for (const key of keys) {
      const el = q(broker[key]);
      const found = !!el;
      let value = "";
      if (el) {
        value = (el.value != null && el.value !== "" ? el.value : el.textContent || "").trim().slice(0, 40);
        el.style.outline = "3px solid #22c55e";
        setTimeout(() => (el.style.outline = ""), 4000);
      }
      result.items.push({ key, selector: broker[key], found, value });
    }
    const bal = readBalance();
    result.balance = Number.isFinite(bal) ? bal : null;
    return result;
  }

  // ---------------------------------------------------------------- overlay
  function buildOverlay() {
    const host = document.createElement("div");
    host.id = "bb-overlay-host";
    host.style.cssText = "position:fixed;z-index:2147483647;top:80px;right:16px;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
        .panel { width: 260px; background: #0f172a; color: #e2e8f0; border: 1px solid #334155; border-radius: 10px;
                 box-shadow: 0 10px 30px rgba(0,0,0,.45); font-size: 12px; overflow: hidden; }
        .head { display:flex; align-items:center; gap:8px; padding:8px 10px; background:#1e293b; cursor:move; user-select:none; }
        .dot { width:8px; height:8px; border-radius:50%; background:#ef4444; flex:none; }
        .dot.on { background:#22c55e; }
        .title { font-weight:600; flex:1; }
        .head button { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:14px; padding:0 4px; }
        .body { padding:10px; display:flex; flex-direction:column; gap:8px; }
        .body.collapsed { display:none; }
        .signal { border-radius:8px; padding:8px 10px; background:#1e293b; border-left:4px solid #64748b; }
        .signal.CALL { border-left-color:#22c55e; } .signal.PUT { border-left-color:#ef4444; }
        .signal .dir { font-weight:700; font-size:14px; }
        .signal.CALL .dir { color:#22c55e; } .signal.PUT .dir { color:#ef4444; }
        .signal .meta { color:#94a3b8; margin-top:2px; }
        .signal .reasons { color:#cbd5e1; margin-top:4px; font-size:11px; line-height:1.35; }
        .row { display:flex; gap:6px; }
        .btn { flex:1; padding:7px 8px; border-radius:6px; border:1px solid #475569; background:#1e293b; color:#e2e8f0; cursor:pointer; font-weight:600; }
        .btn:disabled { opacity:.45; cursor:not-allowed; }
        .btn.primary { background:#2563eb; border-color:#2563eb; }
        .btn.auto.on { background:#16a34a; border-color:#16a34a; }
        .status { color:#94a3b8; min-height:14px; }
        .status.err { color:#fca5a5; }
        .summary { color:#cbd5e1; }
        .flash-win { animation: fw .8s; } .flash-loss { animation: fl .8s; }
        @keyframes fw { 0%{background:#14532d} 100%{background:#0f172a} }
        @keyframes fl { 0%{background:#7f1d1d} 100%{background:#0f172a} }
      </style>
      <div class="panel">
        <div class="head" id="head">
          <span class="dot" id="dot"></span>
          <span class="title">binarybot · <span id="broker"></span></span>
          <button id="toggle" title="collapse">–</button>
        </div>
        <div class="body" id="body">
          <div class="signal" id="signal"><div class="dir">waiting for signal…</div></div>
          <div class="row">
            <button class="btn primary" id="take" disabled>Take trade</button>
            <button class="btn auto" id="auto">Auto: off</button>
          </div>
          <div class="summary" id="summary">today: no trades yet</div>
          <div class="status" id="status">connecting to bot…</div>
        </div>
      </div>`;
    (document.body || document.documentElement).appendChild(host);

    const $ = (id) => root.getElementById(id);
    $("broker").textContent = broker.name;
    let countdownTimer = null;

    const api = {
      setConnected(on, err) {
        $("dot").classList.toggle("on", on);
        if (!on) api.setStatus(err ? `bot offline: ${err}` : "bot offline", true);
        else if ($("status").classList.contains("err")) api.setStatus("connected");
      },
      setStatus(text, isErr) {
        $("status").textContent = text;
        $("status").classList.toggle("err", !!isErr);
      },
      setSummary(s) {
        $("summary").textContent = s
          ? `today: ${s.wins}W/${s.losses}L (${s.win_rate}%) · pnl ${s.pnl >= 0 ? "+" : ""}${s.pnl}${s.halted ? " · ⛔ " + s.halted : ""}`
          : "today: no trades yet";
      },
      showSignal(sig) {
        const el = $("signal");
        el.className = `signal ${sig.direction}`;
        const render = () => {
          const left = Math.max(0, sig.expiry_sec - lib.signalAgeSec(sig));
          el.innerHTML = `<div class="dir">${sig.direction === "CALL" ? "▲ CALL" : "▼ PUT"} <span style="color:#e2e8f0">${sig.symbol}</span></div>
            <div class="meta">confidence ${(sig.confidence * 100).toFixed(0)}% · ${sig.expiry_sec}s · stake ${settings.stakeOverride || sig.stake || "-"} · ${left.toFixed(0)}s left</div>
            <div class="reasons">${(sig.reasons || []).map((r) => "• " + escapeHtml(r)).join("<br>")}</div>`;
          if (left <= 0) {
            clearInterval(countdownTimer);
            $("take").disabled = true;
          }
        };
        clearInterval(countdownTimer);
        render();
        countdownTimer = setInterval(render, 1000);
        $("take").disabled = false;
      },
      setAuto(on) {
        $("auto").textContent = `Auto: ${on ? "on" : "off"}`;
        $("auto").classList.toggle("on", on);
      },
      flash(outcome) {
        const p = root.querySelector(".panel");
        p.classList.remove("flash-win", "flash-loss");
        void p.offsetWidth;
        if (outcome === "win" || outcome === "loss") p.classList.add(`flash-${outcome}`);
      },
    };

    $("take").addEventListener("click", () => lastSignal && execute(lastSignal, "manual"));
    $("auto").addEventListener("click", async () => {
      settings.autoTrade = !settings.autoTrade;
      await chrome.storage.local.set({ autoTrade: settings.autoTrade });
      api.setAuto(settings.autoTrade);
    });
    $("toggle").addEventListener("click", () => {
      const collapsed = $("body").classList.toggle("collapsed");
      $("toggle").textContent = collapsed ? "+" : "–";
      chrome.storage.local.set({ overlayCollapsed: collapsed });
    });

    // Drag the panel by its header, persist the position.
    let drag = null;
    $("head").addEventListener("mousedown", (e) => {
      if (e.target.id === "toggle") return;
      const r = host.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!drag) return;
      host.style.left = `${Math.max(0, e.clientX - drag.dx)}px`;
      host.style.top = `${Math.max(0, e.clientY - drag.dy)}px`;
      host.style.right = "auto";
    });
    window.addEventListener("mouseup", () => {
      if (!drag) return;
      drag = null;
      chrome.storage.local.set({ overlayPos: { left: host.style.left, top: host.style.top } });
    });
    chrome.storage.local.get(["overlayPos", "overlayCollapsed"], ({ overlayPos, overlayCollapsed }) => {
      if (overlayPos && overlayPos.left) {
        host.style.left = overlayPos.left;
        host.style.top = overlayPos.top;
        host.style.right = "auto";
      }
      if (overlayCollapsed) {
        $("body").classList.add("collapsed");
        $("toggle").textContent = "+";
      }
    });
    return api;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // ---------------------------------------------------------------- settings
  async function loadSettings() {
    const stored = await chrome.storage.local.get(Object.keys(lib.DEFAULT_SETTINGS));
    settings = { ...lib.DEFAULT_SETTINGS, ...stored };
    if (typeof settings.selectorOverrides === "string") {
      try {
        settings.selectorOverrides = JSON.parse(settings.selectorOverrides || "{}");
      } catch (e) {
        settings.selectorOverrides = {};
      }
    }
    broker = globalThis.__bbResolveBroker(location.hostname, settings.selectorOverrides);
    if (ui) ui.setAuto(settings.autoTrade);
  }

  // ---------------------------------------------------------------- boot
  async function boot() {
    await loadSettings();
    if (!broker) return; // not a trading page we know
    ui = buildOverlay();
    ui.setAuto(settings.autoTrade);

    const reg = await toBackground("register", {
      type: "register",
      broker: broker.id,
      url: location.href,
      extVersion: chrome.runtime.getManifest().version,
      autoTrade: settings.autoTrade,
    });
    if (reg && reg.state) ui.setConnected(!!reg.state.connected, reg.state.lastError);

    // Balance heartbeat.
    setInterval(() => {
      const bal = readBalance();
      if (Number.isFinite(bal)) sendToServer({ type: "balance", balance: bal });
    }, 10000);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (Object.keys(changes).some((k) => k in lib.DEFAULT_SETTINGS)) loadSettings();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
