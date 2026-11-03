/**
 * Pure helpers shared by the content script, the popup and the Node tests.
 *
 * This file has no `import`/`export` so it can be loaded two ways:
 *   - as a plain content script (manifest lists it before content.js),
 *   - as an ES module from Node tests (`await import("../lib.js")`).
 * Either way the API lands on `globalThis.__bbLib`.
 */
(function (root) {
  "use strict";

  const SERVER_TYPES = new Set(["hello", "signal", "status", "halt", "ping"]);

  /**
   * Normalise an asset name for loose comparison.
   * "EUR/USD OTC" -> "EURUSD", "frxEURUSD" -> "EURUSD", "btc-usdt" -> "BTCUSDT".
   */
  function normalizeSymbol(name) {
    if (typeof name !== "string") return "";
    let s = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
    s = s.replace(/OTC/g, "");
    if (s.startsWith("FRX")) s = s.slice(3); // Deriv forex prefix
    if (s.startsWith("CRY")) s = s.slice(3); // Deriv crypto prefix
    return s;
  }

  /** True when the page's asset and the signal's symbol refer to the same pair. */
  function symbolsMatch(pageAsset, signalSymbol) {
    const a = normalizeSymbol(pageAsset);
    const b = normalizeSymbol(signalSymbol);
    if (!a || !b) return false;
    return a === b || a.includes(b) || b.includes(a);
  }

  /**
   * Parse a money string as rendered by broker UIs: "$1,234.56", "1 234,56 ₽",
   * "10000", "-5.25". Returns NaN when no number is present.
   */
  function parseMoney(text) {
    if (typeof text !== "string") return NaN;
    const cleaned = text.replace(/[ \s]/g, "");
    const m = cleaned.match(/-?\d[\d,.]*/);
    if (!m) return NaN;
    let num = m[0];
    const hasComma = num.includes(",");
    const hasDot = num.includes(".");
    if (hasComma && hasDot) {
      // Whichever separator comes last is the decimal one.
      if (num.lastIndexOf(",") > num.lastIndexOf(".")) {
        num = num.replace(/\./g, "").replace(",", ".");
      } else {
        num = num.replace(/,/g, "");
      }
    } else if (hasComma) {
      // "1,234" / "12,345,678" are thousands; "12,5" / "12,50" are decimals.
      const parts = num.split(",");
      const allThousands = parts.slice(1).every((p) => p.length === 3);
      num = allThousands && parts.length > 1 && parts[0].length <= 3 ? num.replace(/,/g, "") : num.replace(/,/g, ".");
    }
    const v = Number(num);
    return Number.isFinite(v) ? v : NaN;
  }

  /** Format a stake for the amount input. "{:.0f}" -> integer, "{:.2f}" -> 2 decimals. */
  function formatStake(stake, amountFormat) {
    const m = /\{:\.(\d)f\}/.exec(amountFormat || "{:.2f}");
    const digits = m ? Number(m[1]) : 2;
    return Number(stake).toFixed(digits);
  }

  /**
   * Validate a message from the bot's signal server.
   * Returns { ok: true, msg } or { ok: false, error }.
   */
  function validateServerMessage(raw) {
    let msg = raw;
    if (typeof raw === "string") {
      try {
        msg = JSON.parse(raw);
      } catch (e) {
        return { ok: false, error: "invalid json" };
      }
    }
    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return { ok: false, error: "not an object" };
    if (typeof msg.type !== "string" || !SERVER_TYPES.has(msg.type)) return { ok: false, error: `unknown type ${msg.type}` };
    if (msg.type === "signal") {
      if (typeof msg.id !== "string" || !msg.id) return { ok: false, error: "signal.id missing" };
      if (typeof msg.symbol !== "string" || !msg.symbol) return { ok: false, error: "signal.symbol missing" };
      if (msg.direction !== "CALL" && msg.direction !== "PUT") return { ok: false, error: "signal.direction must be CALL|PUT" };
      if (typeof msg.confidence !== "number" || msg.confidence < 0 || msg.confidence > 1) return { ok: false, error: "signal.confidence must be 0..1" };
      if (typeof msg.expiry_sec !== "number" || msg.expiry_sec <= 0) return { ok: false, error: "signal.expiry_sec must be > 0" };
      if (msg.stake != null && (typeof msg.stake !== "number" || msg.stake <= 0)) return { ok: false, error: "signal.stake must be > 0" };
      if (msg.time != null && typeof msg.time !== "number") return { ok: false, error: "signal.time must be a number" };
    }
    if (msg.type === "halt" && typeof msg.reason !== "string") return { ok: false, error: "halt.reason missing" };
    return { ok: true, msg };
  }

  /** Seconds elapsed since the signal was generated (uses `time`, falls back to receipt time). */
  function signalAgeSec(signal, nowMs) {
    const now = nowMs == null ? Date.now() : nowMs;
    const t = typeof signal.time === "number" ? signal.time * 1000 : signal.receivedAt || now;
    return Math.max(0, (now - t) / 1000);
  }

  /** Decide a trade outcome from the balance before/after. */
  function outcomeFromBalance(before, after) {
    if (!Number.isFinite(before) || !Number.isFinite(after)) return { outcome: "unknown", pnl: 0 };
    const pnl = Math.round((after - before) * 100) / 100;
    if (pnl > 0) return { outcome: "win", pnl };
    if (pnl < 0) return { outcome: "loss", pnl };
    return { outcome: "tie", pnl: 0 };
  }

  const DEFAULT_SETTINGS = Object.freeze({
    serverUrl: "ws://127.0.0.1:8765",
    autoTrade: false,
    stakeOverride: null,
    minConfidence: 0.6,
    ignoreSymbolCheck: false,
    soundOn: true,
    selectorOverrides: {},
  });

  root.__bbLib = {
    normalizeSymbol,
    symbolsMatch,
    parseMoney,
    formatStake,
    validateServerMessage,
    signalAgeSec,
    outcomeFromBalance,
    DEFAULT_SETTINGS,
    SERVER_TYPES,
  };
})(globalThis);
