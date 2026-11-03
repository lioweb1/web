/** Popup: edit settings, show connection state, run the selector test on the active tab. */
(function () {
  "use strict";
  const lib = globalThis.__bbLib;
  const $ = (id) => document.getElementById(id);
  const out = (text, cls) => {
    $("out").textContent = text;
    $("out").className = cls || "";
  };

  async function load() {
    const s = { ...lib.DEFAULT_SETTINGS, ...(await chrome.storage.local.get(Object.keys(lib.DEFAULT_SETTINGS))) };
    $("serverUrl").value = s.serverUrl;
    $("autoTrade").checked = !!s.autoTrade;
    $("ignoreSymbolCheck").checked = !!s.ignoreSymbolCheck;
    $("soundOn").checked = s.soundOn !== false;
    $("minConfidence").value = s.minConfidence;
    $("stakeOverride").value = s.stakeOverride == null ? "" : s.stakeOverride;
    $("selectorOverrides").value =
      typeof s.selectorOverrides === "string" ? s.selectorOverrides : JSON.stringify(s.selectorOverrides || {}, null, 2);
    if ($("selectorOverrides").value === "{}") $("selectorOverrides").value = "";
  }

  async function save() {
    let overrides = {};
    const raw = $("selectorOverrides").value.trim();
    if (raw) {
      try {
        overrides = JSON.parse(raw);
      } catch (e) {
        return out("Selector overrides is not valid JSON: " + e.message, "bad");
      }
    }
    const stakeRaw = $("stakeOverride").value.trim();
    const minConf = Number($("minConfidence").value);
    await chrome.storage.local.set({
      serverUrl: $("serverUrl").value.trim() || lib.DEFAULT_SETTINGS.serverUrl,
      autoTrade: $("autoTrade").checked,
      ignoreSymbolCheck: $("ignoreSymbolCheck").checked,
      soundOn: $("soundOn").checked,
      minConfidence: Number.isFinite(minConf) ? Math.min(1, Math.max(0, minConf)) : lib.DEFAULT_SETTINGS.minConfidence,
      stakeOverride: stakeRaw ? Number(stakeRaw) : null,
      selectorOverrides: overrides,
    });
    out("Saved.", "ok");
  }

  async function refreshState() {
    chrome.runtime.sendMessage({ kind: "getState" }, (res) => {
      const st = (res && res.state) || {};
      $("dot").classList.toggle("on", !!st.connected);
      $("conn").textContent = st.connected ? "connected" : st.lastError || "offline";
    });
  }

  async function testSelectors() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return out("No active tab.", "bad");
    chrome.tabs.sendMessage(tab.id, { kind: "testSelectors" }, (res) => {
      if (chrome.runtime.lastError || !res) {
        return out("This tab is not a supported broker page (or reload it after installing).", "bad");
      }
      const lines = res.items.map(
        (it) => `${it.found ? "✔" : "✘"} ${it.key.padEnd(12)} ${it.found ? JSON.stringify(it.value) : "NOT FOUND"}`
      );
      lines.push(`balance parsed: ${res.balance == null ? "n/a" : res.balance}`);
      const allCore = res.items.filter((i) => i.key !== "assetLabel").every((i) => i.found);
      out(`broker: ${res.broker}\n` + lines.join("\n"), allCore ? "ok" : "bad");
    });
  }

  $("save").addEventListener("click", save);
  $("test").addEventListener("click", testSelectors);
  $("reconnect").addEventListener("click", () => chrome.runtime.sendMessage({ kind: "reconnect" }, () => setTimeout(refreshState, 800)));
  load();
  refreshState();
  setInterval(refreshState, 2000);
})();
