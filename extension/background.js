/**
 * Service worker: owns the single WebSocket to the local bot and relays
 * messages between it and the broker tabs.
 *
 *   server  --ws-->  background  --chrome.tabs.sendMessage({kind:"server"})-->  content scripts
 *   content --chrome.runtime.sendMessage({kind:"send", msg})-->  background  --ws-->  server
 *
 * MV3 workers are short lived; the WebSocket plus the server's pings keep it
 * alive, and a 30s alarm reconnects if the socket dropped while we slept.
 */

const DEFAULT_URL = "ws://127.0.0.1:8765";
const BROKER_URL_PATTERNS = [
  "*://*.pocketoption.com/*",
  "*://*.po.trade/*",
  "*://*.qxbroker.com/*",
  "*://*.quotex.io/*",
  "*://*.quotex.com/*",
  "*://*.iqoption.com/*",
  "*://*.olymptrade.com/*",
];

let ws = null;
let state = { connected: false, url: DEFAULT_URL, hello: null, lastError: null, attempts: 0 };
let reconnectTimer = null;
const registrations = new Map(); // tabId -> register payload (re-sent on reconnect)

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.local.get("serverUrl");
  return serverUrl || DEFAULT_URL;
}

function broadcastToTabs(payload) {
  chrome.tabs.query({ url: BROKER_URL_PATTERNS }, (tabs) => {
    for (const tab of tabs || []) {
      chrome.tabs.sendMessage(tab.id, payload, () => void chrome.runtime.lastError);
    }
  });
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
    return true;
  }
  return false;
}

function setState(patch) {
  state = { ...state, ...patch };
  broadcastToTabs({ kind: "state", state });
}

async function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  const url = await getServerUrl();
  state.url = url;
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setState({ connected: false, lastError: String(e) });
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    setState({ connected: true, lastError: null, attempts: 0 });
    // Re-announce every known broker tab so the server knows who is listening.
    for (const reg of registrations.values()) send(reg);
  };

  ws.onmessage = (ev) => {
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch (e) {
      return;
    }
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "ping") {
      send({ type: "pong" });
      return;
    }
    if (msg.type === "hello") setState({ hello: msg });
    broadcastToTabs({ kind: "server", msg: { ...msg, receivedAt: Date.now() } });
  };

  ws.onerror = () => {
    setState({ lastError: `cannot reach ${url}` });
  };

  ws.onclose = () => {
    ws = null;
    setState({ connected: false, hello: null });
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  state.attempts += 1;
  const delay = Math.min(30000, 1000 * 2 ** Math.min(state.attempts, 5)); // 2s .. 30s
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function disconnect() {
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  setState({ connected: false, hello: null, attempts: 0 });
}

// ---- messages from content scripts and the popup ---------------------------------
chrome.runtime.onMessage.addListener((req, sender, reply) => {
  switch (req && req.kind) {
    case "send": {
      const ok = send(req.msg);
      reply({ ok });
      return;
    }
    case "register": {
      if (sender.tab) registrations.set(sender.tab.id, req.msg);
      reply({ ok: send(req.msg), state });
      return;
    }
    case "getState":
      reply({ state });
      return;
    case "reconnect":
      disconnect();
      connect().then(() => reply({ ok: true }));
      return true; // async reply
    default:
      return;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => registrations.delete(tabId));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.serverUrl) {
    disconnect();
    connect();
  }
});

chrome.alarms.create("bb-reconnect", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "bb-reconnect") connect();
});

chrome.runtime.onInstalled.addListener(() => connect());
chrome.runtime.onStartup.addListener(() => connect());
connect();
