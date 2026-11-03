# binarybot bridge (Chrome extension)

Shows the Python bot's signals inside your broker's own trading page and,
when you switch Auto on, places them by clicking the page's CALL/PUT buttons.
It replaces the Playwright adapter for people who just want to log into their
broker in normal Chrome. The extension never contacts the internet itself; it
only opens a WebSocket to the bot running on your machine.

Supported pages: Pocket Option (pocketoption.com, po.trade), Quotex
(qxbroker.com, quotex.io/.com), IQ Option, Olymp Trade.

## 1. Run the bot with the signal server

In `bot/config.yaml` set the broker to the extension bridge, then start it:

```yaml
broker:
  kind: extension        # local WebSocket signal server on ws://127.0.0.1:8765
```

```bash
cd bot
python main.py run
```

The bot generates signals, applies its risk rules, and pushes each signal to
the extension. The extension reports back `trade_placed`, `result` (from the
balance change) or `skipped` so the bot's journal and risk limits stay accurate.

## 2. Install the extension

1. Open `chrome://extensions`, enable **Developer mode** (top right).
2. **Load unpacked** and pick this `extension/` folder.
3. Open your broker, log in, open the asset and expiry the bot is configured for.
4. Reload the broker tab once; the dark "binarybot" panel appears top-right
   (drag it anywhere, collapse with `–`).

The panel dot is green when the bot is connected. Signals show direction,
symbol, confidence, countdown and the reasons. **Take trade** places the last
signal manually; **Auto** toggles automatic execution (also in the popup).

## 3. Verify the selectors (do this first, on a demo account)

Broker front-ends change often. The selectors in `brokers.js` mirror
`bot/binarybot/brokers/profiles/*.yaml` and are best guesses.

1. Click the extension icon → **Test selectors**.
2. Every element it finds is outlined green on the page for 4 seconds and
   listed as ✔ with the text it read; ✘ means not found.
3. For a ✘, right-click the real element → Inspect, copy a stable class or
   `data-*` attribute, and put it in **Selector overrides**, e.g.

```json
{ "pocketoption": { "balance": ".balance-info-block__balance", "callButton": ".btn-call" } }
```

Keys: `balance`, `amountInput`, `callButton`, `putButton`, `assetLabel`
(`assetLabel` is optional; it only powers the symbol check).
`balance parsed` must show your real balance number, otherwise results cannot
be detected.

## Settings (popup)

| setting | meaning |
|---|---|
| Bot server URL | default `ws://127.0.0.1:8765` |
| Auto-trade signals | off by default. Signals are only shown until you turn it on |
| Minimum confidence | signals below this are reported as `skipped` |
| Stake override | fixed amount instead of the bot's stake |
| Ignore symbol check | skip the "page asset == signal symbol" guard |
| Sound on signal | short beep, high for CALL, low for PUT |

## How a trade is executed

1. Signal arrives. Older than 10s → skipped as stale (manual "Take trade" allows up to the expiry length).
2. Page asset label is compared loosely with the signal symbol (`EUR/USD OTC` == `EURUSD` == `frxEURUSD`).
3. Balance is read, amount typed into the input, CALL/PUT clicked, `trade_placed` sent.
4. After `expiry + 8s` the balance is polled every 2s (up to 10 times) until it changes.
   Up → win, down → loss, unchanged → tie. `result` is sent with the pnl.

One trade at a time; a `halt` from the bot disables execution until the next `hello`.

## Protocol (for anyone writing their own server)

Server → extension: `hello`, `signal`, `status`, `halt`, `ping`.
Extension → server: `register`, `pong`, `trade_placed`, `result`, `skipped`, `balance` (every 10s).
Field shapes are validated in `lib.js` (`validateServerMessage`).

## Tests

```bash
node --test "extension/test/*.test.mjs"
```

## Warning

Pocket Option, Quotex, IQ Option and Olymp Trade forbid automated trading in
their terms of service and may freeze or close accounts that use it. Validate
on demo accounts and understand that using this on a real account is at your
own risk. Nothing here guarantees profit; the bot's risk limits are there to
cap losses, not to create an edge.
