# Bot dashboard & licensing

The **Trading bot** section of the app (`/app/bot`) is the control plane for the
`bot/` Python trading bot sold to customers: licenses are issued here, every
bot validates its key against this app, and reports its trades and status so
the workspace can watch all customers' bots in one dashboard.

Nothing here places trades. The app only stores what bots report.

## Pages

| Route | Who | What |
|---|---|---|
| `/app/bot` | any member | KPIs, equity curve, win rate by hour, by symbol, recent 50 trades. Filters live in the URL: `range`, `from`, `to`, `license`, `symbol`, `outcome`. |
| `/app/bot/licenses` | any member (create/revoke: admin+) | License list, create form, +30 days, revoke / reactivate, copy key. |
| `/app/bot/licenses/[id]` | any member (edit: admin+, delete: owner) | Devices with live status, notes, last 100 trades. |

## Data model

* `bot_licenses` – one per customer: `key` (`BB-XXXX-XXXX-XXXX-XXXX`), `plan`
  (`trial|monthly|yearly|lifetime`), `status` (`active|revoked|expired`),
  `max_devices`, `expires_at`, `features` JSON, `notes`.
* `bot_devices` – machines that validated a key, unique per `(license_id, machine_id)`.
* `bot_trades` – the journal; `(license_id, ref)` is unique when `ref` is set, so a
  bot can safely re-send trades.
* `bot_status` – one row per device, upserted by the bot (balance, today's summary, config).

Licenses are workspace rows protected by RLS like every other table; devices,
trades and status are visible only through a license of the current workspace
(`drizzle/0002_bot.sql`).

`features` keys the bot honours:

```json
{ "auto_trade": true, "max_symbols": 5, "brokers": ["paper", "deriv", "browser", "extension"], "copier": false, "extension": true }
```

## Public API (used by the bot)

No session cookie; the license key is the credential. Both endpoints are
`POST` with a JSON body and answer `Cache-Control: no-store`.

### `POST /api/bot/license/validate`

Call on start-up and periodically (the bot uses 5 minutes). Rate limited to 60
calls per minute per IP.

```json
{ "key": "BB-AB2C-DE3F-GH4J-KM5N", "machine_id": "sha256-of-hostname+mac", "version": "0.2.0", "hostname": "vps-1", "broker": "deriv" }
```

Success (`200`):

```json
{ "valid": true, "license_id": "…uuid…", "device_id": "…uuid…", "plan": "monthly", "label": "Customer A",
  "expires_at": "2026-12-03T10:00:00.000Z", "features": { "auto_trade": true, "max_symbols": 5, "brokers": ["deriv"] } }
```

Denied (`200`, so the bot can show the reason):

```json
{ "valid": false, "reason": "not_found" | "revoked" | "expired" | "device_limit" }
```

A new `machine_id` is registered when the key has a free slot; a known machine
is always accepted while the key is active. `400` for a malformed body, `429`
when rate limited.

### `POST /api/bot/ingest`

Headers: `x-license-key`, `x-machine-id`. The key is validated on every call
(`401 {"error": "license revoked"}` etc.).

Body is one of:

```json
{ "type": "trade", "trade": { "traded_at": 1764754800, "symbol": "frxEURUSD", "direction": "CALL", "stake": 10, "confidence": 0.8,
                              "outcome": "win", "pnl": 8.5, "ref": "contract-123", "strategy": "mean_reversion", "broker": "deriv",
                              "reasons": ["touched lower band", "rsi oversold (28.1)"] } }
```

```json
{ "type": "trades", "trades": [ …same objects, up to 500… ] }
```

```json
{ "type": "status", "status": { "balance": 1012.4, "summary": { "wins": 3, "losses": 1, "win_rate": 75, "pnl": 12.4, "halted": null },
                                "config": { "symbols": ["frxEURUSD", "R_100"], "expiry_sec": 60, "strategies": ["mean_reversion"] },
                                "version": "0.2.0", "broker": "deriv" } }
```

Responses: `{ "ok": true, "inserted": 1, "received": 1 }` for trades (re-sent
refs count as received, not inserted) and `{ "ok": true }` for status.

`traded_at` is unix seconds. `outcome` is `win|loss|tie|unknown`,
`direction` is `CALL|PUT`.

### Minimal Python client

```python
import requests, hashlib, platform, uuid

BASE = "https://your-app.example"
MACHINE = hashlib.sha256(f"{platform.node()}-{uuid.getnode()}".encode()).hexdigest()[:32]

def validate(key):
    r = requests.post(f"{BASE}/api/bot/license/validate", json={"key": key, "machine_id": MACHINE, "version": "0.2.0"}, timeout=10)
    return r.json()

def report_trade(key, trade):
    requests.post(f"{BASE}/api/bot/ingest", headers={"x-license-key": key, "x-machine-id": MACHINE}, json={"type": "trade", "trade": trade}, timeout=10)
```

## Environment

No new variables. The routes use the owner database connection
(`DATABASE_OWNER_URL`) like the cron route, scoped to the single license row
they authenticate. Apply the migration with `npm run db:migrate`.
