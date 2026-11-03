// Run with:  node --test "extension/test/*.test.mjs"
// lib.js has no import/export, so importing it as a module just evaluates it
// and leaves the API on globalThis.__bbLib (same as in the extension).
import { test } from "node:test";
import assert from "node:assert/strict";

await import("../lib.js");
const lib = globalThis.__bbLib;

test("normalizeSymbol strips separators, OTC and Deriv prefixes", () => {
  assert.equal(lib.normalizeSymbol("EUR/USD OTC"), "EURUSD");
  assert.equal(lib.normalizeSymbol("frxEURUSD"), "EURUSD");
  assert.equal(lib.normalizeSymbol("cryBTCUSD"), "BTCUSD");
  assert.equal(lib.normalizeSymbol(" btc-usdt "), "BTCUSDT");
  assert.equal(lib.normalizeSymbol(null), "");
});

test("symbolsMatch is loose but not sloppy", () => {
  assert.ok(lib.symbolsMatch("EUR/USD OTC", "EURUSD"));
  assert.ok(lib.symbolsMatch("Euro / US Dollar EURUSD", "frxEURUSD"));
  assert.ok(!lib.symbolsMatch("GBP/USD", "EURUSD"));
  assert.ok(!lib.symbolsMatch("", "EURUSD"));
});

test("parseMoney handles broker formats", () => {
  assert.equal(lib.parseMoney("$1,234.56"), 1234.56);
  assert.equal(lib.parseMoney("1 234,56 ₽"), 1234.56);
  assert.equal(lib.parseMoney("10000"), 10000);
  assert.equal(lib.parseMoney("-5.25 USD"), -5.25);
  assert.equal(lib.parseMoney("12,5"), 12.5);
  assert.equal(lib.parseMoney("12,345,678"), 12345678);
  assert.equal(lib.parseMoney("Balance: 9 950.10"), 9950.1);
  assert.ok(Number.isNaN(lib.parseMoney("no digits")));
  assert.ok(Number.isNaN(lib.parseMoney(undefined)));
});

test("formatStake follows the python-style format", () => {
  assert.equal(lib.formatStake(5, "{:.0f}"), "5");
  assert.equal(lib.formatStake(5.456, "{:.2f}"), "5.46");
  assert.equal(lib.formatStake(5, undefined), "5.00");
});

test("validateServerMessage accepts a good signal", () => {
  const v = lib.validateServerMessage({
    type: "signal", id: "abc", symbol: "EURUSD", direction: "CALL", confidence: 0.8, expiry_sec: 60, stake: 5,
    reasons: ["x"], time: 1700000000,
  });
  assert.ok(v.ok);
  assert.ok(lib.validateServerMessage('{"type":"ping"}').ok);
  assert.ok(lib.validateServerMessage({ type: "halt", reason: "daily loss" }).ok);
});

test("validateServerMessage rejects bad input", () => {
  assert.equal(lib.validateServerMessage("{nope").error, "invalid json");
  assert.equal(lib.validateServerMessage([]).error, "not an object");
  assert.match(lib.validateServerMessage({ type: "wat" }).error, /unknown type/);
  assert.match(lib.validateServerMessage({ type: "signal", id: "a", symbol: "X", direction: "UP", confidence: 0.5, expiry_sec: 60 }).error, /direction/);
  assert.match(lib.validateServerMessage({ type: "signal", id: "a", symbol: "X", direction: "PUT", confidence: 1.5, expiry_sec: 60 }).error, /confidence/);
  assert.match(lib.validateServerMessage({ type: "signal", id: "a", symbol: "X", direction: "PUT", confidence: 0.5, expiry_sec: 0 }).error, /expiry/);
  assert.match(lib.validateServerMessage({ type: "halt" }).error, /reason/);
});

test("signalAgeSec and outcomeFromBalance", () => {
  const now = 1_700_000_010_000;
  assert.equal(lib.signalAgeSec({ time: 1_700_000_000 }, now), 10);
  assert.equal(lib.signalAgeSec({ receivedAt: now - 3000 }, now), 3);
  assert.deepEqual(lib.outcomeFromBalance(100, 104.25), { outcome: "win", pnl: 4.25 });
  assert.deepEqual(lib.outcomeFromBalance(100, 95), { outcome: "loss", pnl: -5 });
  assert.deepEqual(lib.outcomeFromBalance(100, 100), { outcome: "tie", pnl: 0 });
  assert.deepEqual(lib.outcomeFromBalance(100, NaN), { outcome: "unknown", pnl: 0 });
});
