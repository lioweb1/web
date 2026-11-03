<section class="section">
  <div class="container">
    <div class="section-head"><div><h1>Trading Calculators</h1><p class="muted">Plan every trade before you open it. Calculations run in your browser.</p></div></div>
    <div class="tools-grid">

      <div class="card tool" data-tool="lot">
        <h3>📐 Position size / lot size</h3>
        <div class="tool-form">
          <label>Account balance ($)<input type="number" name="balance" value="1000" step="any"></label>
          <label>Risk per trade (%)<input type="number" name="risk" value="1" step="any"></label>
          <label>Stop loss (pips)<input type="number" name="sl" value="20" step="any"></label>
          <label>Pair<select name="pair"><option value="10">EUR/USD, GBP/USD, AUD/USD (USD quote)</option><option value="jpy">USD/JPY &amp; JPY pairs</option><option value="gold">XAU/USD (Gold)</option><option value="other">Other (pip value $10)</option></select></label>
          <label class="jpy-row">USD/JPY rate<input type="number" name="jpy" value="150" step="any"></label>
        </div>
        <div class="tool-out"><div><span>Risk amount</span><b data-out="riskAmt">—</b></div><div><span>Lot size</span><b data-out="lots">—</b></div><div><span>Mini / micro lots</span><b data-out="mini">—</b></div></div>
      </div>

      <div class="card tool" data-tool="rr">
        <h3>🎯 Risk : reward</h3>
        <div class="tool-form">
          <label>Direction<select name="dir"><option value="1">BUY</option><option value="-1">SELL</option></select></label>
          <label>Entry<input type="number" name="entry" value="1.0850" step="any"></label>
          <label>Stop loss<input type="number" name="sl" value="1.0820" step="any"></label>
          <label>Take profit<input type="number" name="tp" value="1.0910" step="any"></label>
        </div>
        <div class="tool-out"><div><span>Risk : reward</span><b data-out="ratio">—</b></div><div><span>Break-even win rate</span><b data-out="be">—</b></div><div><span>Check</span><b data-out="valid">—</b></div></div>
      </div>

      <div class="card tool" data-tool="pip">
        <h3>💱 Pip value</h3>
        <div class="tool-form">
          <label>Lot size<input type="number" name="lots" value="1" step="any"></label>
          <label>Pip size<select name="pip"><option value="0.0001">0.0001 (most pairs)</option><option value="0.01">0.01 (JPY pairs / gold)</option></select></label>
          <label>Current price (quote → USD)<input type="number" name="price" value="1" step="any"><small class="muted">Use 1 for xxx/USD pairs, the USD/xxx rate for USD-base pairs.</small></label>
        </div>
        <div class="tool-out"><div><span>Value per pip</span><b data-out="value">—</b></div><div><span>10 pips</span><b data-out="ten">—</b></div><div><span>50 pips</span><b data-out="fifty">—</b></div></div>
      </div>

      <div class="card tool" data-tool="binary">
        <h3>⚡ Binary options profit</h3>
        <div class="tool-form">
          <label>Trade amount ($)<input type="number" name="stake" value="10" step="any"></label>
          <label>Broker payout (%)<input type="number" name="payout" value="85" step="any"></label>
          <label>Trades<input type="number" name="trades" value="20"></label>
          <label>Win rate (%)<input type="number" name="wr" value="60" step="any"></label>
        </div>
        <div class="tool-out"><div><span>Profit per win</span><b data-out="win">—</b></div><div><span>Expected result</span><b data-out="exp">—</b></div><div><span>Break-even win rate</span><b data-out="be">—</b></div></div>
      </div>

      <div class="card tool" data-tool="martingale">
        <h3>🧮 Martingale table <span class="tag tag-gold">High risk</span></h3>
        <div class="tool-form">
          <label>Starting trade ($)<input type="number" name="stake" value="1" step="any"></label>
          <label>Payout (%)<input type="number" name="payout" value="85" step="any"></label>
          <label>Steps<input type="number" name="steps" value="6" min="1" max="15"></label>
        </div>
        <div class="table-wrap"><table class="table compact"><thead><tr><th>Step</th><th>Trade</th><th>Total risked</th><th>Profit if win</th></tr></thead><tbody data-out="table"></tbody></table></div>
        <p class="muted small">Each step recovers the previous losses. The required capital grows very fast, so most traders should avoid martingale.</p>
      </div>

      <div class="card tool" data-tool="compound">
        <h3>📈 Compounding growth</h3>
        <div class="tool-form">
          <label>Starting balance ($)<input type="number" name="start" value="100" step="any"></label>
          <label>Gain per day (%)<input type="number" name="rate" value="2" step="any"></label>
          <label>Days<input type="number" name="days" value="30"></label>
        </div>
        <div class="tool-out"><div><span>Final balance</span><b data-out="final">—</b></div><div><span>Total profit</span><b data-out="profit">—</b></div><div><span>Growth</span><b data-out="growth">—</b></div></div>
        <p class="muted small">For illustration only. Real results include losing days.</p>
      </div>
    </div>
    <p class="muted small mt"><?= e(setting('disclaimer')) ?></p>
  </div>
</section>
