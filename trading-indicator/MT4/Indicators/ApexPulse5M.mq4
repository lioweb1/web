//+------------------------------------------------------------------+
//|                                                ApexPulse5M.mq4   |
//|      Non-repainting next-candle CALL / PUT confluence indicator   |
//|      with premium dashboard and built-in honest win-rate tracker  |
//+------------------------------------------------------------------+
//  HOW IT AVOIDS REPAINTING
//  - Signals are calculated ONLY on closed candles (bar index >= 1).
//  - The forming candle (bar 0) never receives an arrow.
//  - Higher-timeframe trend uses the last FULLY CLOSED higher-timeframe
//    candle, so no future data leaks into history.
//  - Once an arrow is printed it is never moved or removed.
//
//  HOW TO TRADE THE SIGNAL
//  - An arrow on a closed candle is the forecast for the NEXT candle.
//  - Enter at the open of the next candle (the alert fires on its first
//    tick) with expiry = InpExpiryCandles candles (default 1 = 5 min on M5).
//
//  RISK: no indicator can predict the market with certainty. Use the
//  built-in win-rate tracker and a demo account before trading real money.
//+------------------------------------------------------------------+
#property copyright   "Apex Pulse"
#property version     "1.10"
#property description "Apex Pulse 5M PRO - non-repainting next-candle CALL/PUT signals."
#property description "Signals use closed candles only and never change afterwards."
#property description "High risk: past win-rate does not guarantee future results."
#property strict

#property indicator_chart_window
#property indicator_buffers 6
#property indicator_color1 clrMediumSeaGreen
#property indicator_color2 clrCrimson
#property indicator_color3 clrMediumSeaGreen
#property indicator_color4 clrCrimson
#property indicator_width1 3
#property indicator_width2 3

#define APX_PREFIX "APX5_"

enum ENUM_APX_SESSION
  {
   APX_SESSION_ALL     = 0, // All sessions
   APX_SESSION_LDN_NY  = 1, // London + New York
   APX_SESSION_LONDON  = 2, // London only
   APX_SESSION_NEWYORK = 3, // New York only
   APX_SESSION_OVERLAP = 4  // London / NY overlap only
  };

//--- inputs
input string          InpGrpSignal      = "====== SIGNAL ENGINE ======"; // ====== SIGNAL ENGINE ======
input int             InpMinScore       = 70;          // Minimum confluence score (0-100)
input bool            InpPremiumOnly    = false;       // Premium-only mode (score 85+ only, fewer signals)
input int             InpCooldownBars   = 2;           // Bars to wait after a signal
input int             InpEmaFast        = 21;          // Fast EMA
input int             InpEmaSlow        = 50;          // Slow EMA
input int             InpRsiPeriod      = 14;          // RSI period
input int             InpStochK         = 5;           // Stochastic %K
input int             InpStochD         = 3;           // Stochastic %D
input int             InpStochSlowing   = 3;           // Stochastic slowing
input double          InpStochZone      = 35.0;        // Stoch trigger zone (CALL below X, PUT above 100-X)
input ENUM_TIMEFRAMES InpHtf1           = PERIOD_M15;  // Higher timeframe #1 (trend filter)
input ENUM_TIMEFRAMES InpHtf2           = PERIOD_H1;   // Higher timeframe #2 (trend filter)
input int             InpHtfEma         = 50;          // Higher timeframe EMA

input string          InpGrpFilter      = "====== FILTERS ======"; // ====== FILTERS ======
input int             InpAtrFast        = 14;          // ATR fast (volatility)
input int             InpAtrSlow        = 100;         // ATR slow (volatility baseline)
input double          InpMinVolRatio    = 0.60;        // Skip if volatility below x baseline
input double          InpMaxVolRatio    = 2.50;        // Skip if volatility above x baseline (news spikes)
input int             InpSrLookback     = 40;          // Support/resistance lookback (bars)
input double          InpSrAtrMult      = 0.80;        // Skip CALL under resistance / PUT over support within x ATR
input int             InpMaxConsecutive = 4;           // Skip after N same-color candles (exhaustion)
input bool            InpSmartFilter    = true;        // Smart filter: pause a direction after poor recent results
input int             InpSmartWindow    = 20;          // Smart filter: recent trades checked per direction
input double          InpSmartMinWr     = 50.0;        // Smart filter: pause below this win rate %
input int             InpMaxSpreadPts   = 30;          // Spread warning above (points)
input ENUM_APX_SESSION InpSession       = APX_SESSION_ALL; // Session filter
input int             InpBrokerGmtOffset= 2;           // Broker server time GMT offset (hours)

input string          InpGrpBinary      = "====== BINARY / STATS ======"; // ====== BINARY / STATS ======
input int             InpExpiryCandles  = 1;           // Expiry in candles (1 = next candle)
input double          InpPayoutPercent  = 85.0;        // Broker payout % (for break-even)
input int             InpStatsBars      = 2000;        // Bars used for win-rate statistics
input int             InpMaxHistory     = 3000;        // Bars of history to calculate
input bool            InpShowResults    = true;        // Show win / loss marks on chart

input string          InpGrpDisplay     = "====== DISPLAY ======"; // ====== DISPLAY ======
input bool            InpShowDashboard  = true;        // Show dashboard
input int             InpPanelX         = 14;          // Dashboard X (from left)
input int             InpPanelY         = 24;          // Dashboard Y (from top)
input int             InpPanelWidth     = 340;         // Dashboard width (px)
input int             InpFontSize       = 9;           // Dashboard font size
input bool            InpShowScoreLabels= true;        // Show score next to arrows
input int             InpArrowSize      = 3;           // Arrow size
input color           InpCallColor      = C'0,200,140';// CALL color
input color           InpPutColor       = C'255,77,94';// PUT color

input string          InpGrpAlerts      = "====== ALERTS ======"; // ====== ALERTS ======
input bool            InpAlertPopup     = true;        // Popup alert
input bool            InpAlertSound     = true;        // Sound alert
input string          InpSoundFile      = "alert2.wav";// Sound file
input bool            InpAlertPush      = false;       // Push notification (MT4 mobile)
input bool            InpAlertEmail     = false;       // Email alert

//--- buffers
double BuyBuf[];
double SellBuf[];
double WinBuf[];
double LossBuf[];
double BuyScoreBuf[];
double SellScoreBuf[];

//--- palette
const color C_BG     = C'13,17,23';
const color C_CARD   = C'22,27,36';
const color C_BORDER = C'40,47,60';
const color C_TEXT   = C'232,236,243';
const color C_MUTED  = C'132,142,158';
const color C_ACCENT = C'64,156,255';
const color C_GOLD   = C'255,196,0';
const color C_WARN   = C'255,170,60';

//--- state
int      g_warm         = 0;
int      g_srvOffset    = 0;
datetime g_lastBarTime  = 0;
datetime g_lastAlertBar = 0;
int      g_panelH       = 520;

// stats
int      g_wins=0, g_losses=0, g_draws=0;
int      g_bWins=0, g_bLoss=0, g_sWins=0, g_sLoss=0;
int      g_tWins=0, g_tLoss=0;
int      g_streak=0, g_bestWin=0, g_worstLoss=0;
string   g_last10="";
datetime g_lastSigTime=0;
int      g_lastSigDir=0;
double   g_lastSigScore=0;
bool     g_lastSigPending=false;
double   g_lastSigEntry=0;

// live
double   g_liveBuy=0, g_liveSell=0;
string   g_liveReason="";
int      g_trendChart=0, g_trendH1=0, g_trendH2=0;
double   g_rsi=0, g_stoch=0, g_volRatio=0;
bool     g_cBuy[7], g_cSell[7];          // checklist flags from last CalcScores call
bool     g_pauseBuy=false, g_pauseSell=false;
int      g_hW[24], g_hL[24];
string   CHK_NAMES[7] = {"Trend M5","Trend HTF1","Trend HTF2","Stoch trigger","RSI momentum","MACD momentum","Candle action"};

//+------------------------------------------------------------------+
int OnInit()
  {
   if(InpMinScore < 0 || InpMinScore > 100 || InpExpiryCandles < 1 ||
      InpAtrSlow <= InpAtrFast || InpEmaSlow <= InpEmaFast || InpPayoutPercent <= 0)
     {
      Print("Apex Pulse 5M: invalid input parameters.");
      return(INIT_PARAMETERS_INCORRECT);
     }

   IndicatorBuffers(6);
   SetIndexBuffer(0,BuyBuf);
   SetIndexStyle(0,DRAW_ARROW,STYLE_SOLID,InpArrowSize,InpCallColor);
   SetIndexArrow(0,233);
   SetIndexLabel(0,"CALL signal");
   SetIndexEmptyValue(0,EMPTY_VALUE);

   SetIndexBuffer(1,SellBuf);
   SetIndexStyle(1,DRAW_ARROW,STYLE_SOLID,InpArrowSize,InpPutColor);
   SetIndexArrow(1,234);
   SetIndexLabel(1,"PUT signal");
   SetIndexEmptyValue(1,EMPTY_VALUE);

   SetIndexBuffer(2,WinBuf);
   SetIndexStyle(2,InpShowResults ? DRAW_ARROW : DRAW_NONE,STYLE_SOLID,1,InpCallColor);
   SetIndexArrow(2,252);
   SetIndexLabel(2,"Win");
   SetIndexEmptyValue(2,EMPTY_VALUE);

   SetIndexBuffer(3,LossBuf);
   SetIndexStyle(3,InpShowResults ? DRAW_ARROW : DRAW_NONE,STYLE_SOLID,1,InpPutColor);
   SetIndexArrow(3,251);
   SetIndexLabel(3,"Loss");
   SetIndexEmptyValue(3,EMPTY_VALUE);

   SetIndexBuffer(4,BuyScoreBuf);
   SetIndexStyle(4,DRAW_NONE);
   SetIndexLabel(4,"CALL score");
   SetIndexEmptyValue(4,EMPTY_VALUE);

   SetIndexBuffer(5,SellScoreBuf);
   SetIndexStyle(5,DRAW_NONE);
   SetIndexLabel(5,"PUT score");
   SetIndexEmptyValue(5,EMPTY_VALUE);

   IndicatorShortName("Apex Pulse 5M");
   IndicatorDigits(Digits);

   g_warm = MathMax(MathMax(InpAtrSlow,InpEmaSlow),InpRsiPeriod) + 10;
   g_lastBarTime = 0;
   EventSetTimer(1);
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   EventKillTimer();
   DeleteObjects(APX_PREFIX);
   ChartRedraw();
  }

//+------------------------------------------------------------------+
int OnCalculate(const int rates_total,
                const int prev_calculated,
                const datetime &time[],
                const double &open[],
                const double &high[],
                const double &low[],
                const double &close[],
                const long &tick_volume[],
                const long &volume[],
                const int &spread[])
  {
   if(rates_total < g_warm + 20)
      return(0);

   // Wait until higher-timeframe history is loaded, otherwise history
   // would be calculated without the trend filter and change later.
   if(!HtfReady(InpHtf1) || !HtfReady(InpHtf2))
      return(0);

   g_srvOffset = (int)(TimeCurrent() - TimeLocal());

   bool firstRun = (prev_calculated <= 0);
   int  maxStart = rates_total - g_warm - 2;
   int  limit;

   if(firstRun)
     {
      ArrayInitialize(BuyBuf,EMPTY_VALUE);
      ArrayInitialize(SellBuf,EMPTY_VALUE);
      ArrayInitialize(WinBuf,EMPTY_VALUE);
      ArrayInitialize(LossBuf,EMPTY_VALUE);
      ArrayInitialize(BuyScoreBuf,EMPTY_VALUE);
      ArrayInitialize(SellScoreBuf,EMPTY_VALUE);
      DeleteObjects(APX_PREFIX+"S_");
      limit = MathMin(maxStart,InpMaxHistory);
     }
   else
      limit = MathMin(maxStart,rates_total - prev_calculated + 1);

   // The forming candle never carries a signal.
   BuyBuf[0]=EMPTY_VALUE;  SellBuf[0]=EMPTY_VALUE;
   WinBuf[0]=EMPTY_VALUE;  LossBuf[0]=EMPTY_VALUE;
   BuyScoreBuf[0]=EMPTY_VALUE; SellScoreBuf[0]=EMPTY_VALUE;

   for(int i=limit; i>=1; i--)
      EvaluateBar(i);

   bool newBar = (Time[0] != g_lastBarTime);
   if(newBar || firstRun)
     {
      g_lastBarTime = Time[0];
      UpdateStats();
      if(firstRun)
         g_lastAlertBar = Time[1];   // no alerts for history
      else
         CheckAlert();
     }

   UpdateLive();
   DrawDashboard();
   return(rates_total);
  }

//+------------------------------------------------------------------+
void OnTimer()
  {
   if(Bars < g_warm + 20)
      return;
   DrawDashboard();
   ChartRedraw();
  }

//+------------------------------------------------------------------+
//| Signal engine                                                     |
//+------------------------------------------------------------------+
void EvaluateBar(const int i)
  {
   BuyBuf[i]  = EMPTY_VALUE;
   SellBuf[i] = EMPTY_VALUE;

   double bs,ss;
   bool   bt,st;
   CalcScores(i,bs,ss,bt,st);
   BuyScoreBuf[i]  = bs;
   SellScoreBuf[i] = ss;

   string lbl = APX_PREFIX+"S_"+IntegerToString((long)Time[i]);
   string reason = "";
   int dir = 0;

   int minScore = InpPremiumOnly ? MathMax(InpMinScore,85) : InpMinScore;

   if(FiltersOk(i,reason) && !InCooldown(i))
     {
      if(bt && bs >= minScore && bs > ss)
         dir = 1;
      else if(st && ss >= minScore && ss > bs)
         dir = -1;
     }

   // Second-stage quality filters (all based on closed data only)
   if(dir != 0 && (!SrOk(i,dir) || !ExhaustionOk(i,dir) || !SmartOk(i,dir)))
      dir = 0;

   if(dir == 0)
     {
      if(ObjectFind(0,lbl) >= 0)
         ObjectDelete(0,lbl);
      return;
     }

   double off = iATR(NULL,0,14,i) * 0.6;
   if(dir > 0)
      BuyBuf[i] = Low[i] - off;
   else
      SellBuf[i] = High[i] + off;

   if(InpShowScoreLabels)
     {
      double sc    = (dir > 0) ? bs : ss;
      double price = (dir > 0) ? Low[i] - off*2.6 : High[i] + off*2.6;
      if(ObjectFind(0,lbl) < 0)
         ObjectCreate(0,lbl,OBJ_TEXT,0,Time[i],price);
      ObjectSetInteger(0,lbl,OBJPROP_TIME,Time[i]);
      ObjectSetDouble(0,lbl,OBJPROP_PRICE,price);
      ObjectSetString(0,lbl,OBJPROP_TEXT,IntegerToString((int)sc));
      ObjectSetString(0,lbl,OBJPROP_FONT,"Segoe UI Semibold");
      ObjectSetInteger(0,lbl,OBJPROP_FONTSIZE,7);
      ObjectSetInteger(0,lbl,OBJPROP_COLOR,(dir > 0) ? InpCallColor : InpPutColor);
      ObjectSetInteger(0,lbl,OBJPROP_ANCHOR,ANCHOR_CENTER);
      ObjectSetInteger(0,lbl,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,lbl,OBJPROP_HIDDEN,true);
     }
  }

//+------------------------------------------------------------------+
//| Confluence score 0-100 for each direction                        |
//|  Chart trend 20 | HTF1 15 | HTF2 10 | Stoch trigger 20            |
//|  RSI 10 | OsMA momentum 10 | Candle price action 15               |
//+------------------------------------------------------------------+
void CalcScores(const int i,double &buyS,double &sellS,bool &buyTrig,bool &sellTrig)
  {
   buyS=0; sellS=0; buyTrig=false; sellTrig=false;
   for(int q=0; q<7; q++) { g_cBuy[q]=false; g_cSell[q]=false; }

   double emaF  = iMA(NULL,0,InpEmaFast,0,MODE_EMA,PRICE_CLOSE,i);
   double emaF1 = iMA(NULL,0,InpEmaFast,0,MODE_EMA,PRICE_CLOSE,i+1);
   double emaS  = iMA(NULL,0,InpEmaSlow,0,MODE_EMA,PRICE_CLOSE,i);
   double rsi0  = iRSI(NULL,0,InpRsiPeriod,PRICE_CLOSE,i);
   double rsi1  = iRSI(NULL,0,InpRsiPeriod,PRICE_CLOSE,i+1);
   double k0    = iStochastic(NULL,0,InpStochK,InpStochD,InpStochSlowing,MODE_SMA,0,MODE_MAIN,i);
   double k1    = iStochastic(NULL,0,InpStochK,InpStochD,InpStochSlowing,MODE_SMA,0,MODE_MAIN,i+1);
   double d0    = iStochastic(NULL,0,InpStochK,InpStochD,InpStochSlowing,MODE_SMA,0,MODE_SIGNAL,i);
   double d1    = iStochastic(NULL,0,InpStochK,InpStochD,InpStochSlowing,MODE_SMA,0,MODE_SIGNAL,i+1);
   double os0   = iOsMA(NULL,0,12,26,9,PRICE_CLOSE,i);
   double os1   = iOsMA(NULL,0,12,26,9,PRICE_CLOSE,i+1);
   double atr   = iATR(NULL,0,InpAtrFast,i);

   double o=Open[i], c=Close[i], h=High[i], l=Low[i];
   double range=h-l, body=MathAbs(c-o);

   // 1) Chart trend (20)
   if(c > emaS && emaF > emaS && emaF > emaF1)    { buyS += 20; g_cBuy[0]=true; }
   else if(emaF > emaS)                             buyS += 10;
   if(c < emaS && emaF < emaS && emaF < emaF1)    { sellS += 20; g_cSell[0]=true; }
   else if(emaF < emaS)                             sellS += 10;

   // 2) Higher-timeframe trend (15 + 10)
   int t1 = HtfTrend(InpHtf1,i);
   int t2 = HtfTrend(InpHtf2,i);
   if(t1 > 0) { buyS += 15;  g_cBuy[1]=true; }
   if(t1 < 0) { sellS += 15; g_cSell[1]=true; }
   if(t2 > 0) { buyS += 10;  g_cBuy[2]=true; }
   if(t2 < 0) { sellS += 10; g_cSell[2]=true; }

   // 3) Stochastic trigger: pullback ends and momentum turns (20)
   buyTrig  = (k1 <= d1 && k0 > d0 && MathMin(k1,d1) <= InpStochZone);
   sellTrig = (k1 >= d1 && k0 < d0 && MathMax(k1,d1) >= 100.0 - InpStochZone);
   if(buyTrig)                   { buyS += 20; g_cBuy[3]=true; }
   else if(k0 > d0 && k0 > k1)     buyS += 8;
   if(sellTrig)                  { sellS += 20; g_cSell[3]=true; }
   else if(k0 < d0 && k0 < k1)     sellS += 8;

   // 4) RSI momentum, not overextended (10)
   if(rsi0 >= 45 && rsi0 <= 70 && rsi0 > rsi1) { buyS += 10;  g_cBuy[4]=true; }
   if(rsi0 <= 55 && rsi0 >= 30 && rsi0 < rsi1) { sellS += 10; g_cSell[4]=true; }

   // 5) MACD histogram (OsMA) acceleration (10)
   if(os0 > os1) { buyS += 10;  g_cBuy[5]=true; }
   if(os0 < os1) { sellS += 10; g_cSell[5]=true; }

   // 6) Candle price action (15): strong body, close near extreme, no exhaustion
   if(range > 0 && atr > 0)
     {
      bool sane = (body <= 2.0*atr);
      if(c > o)
        {
         if(sane && body >= 0.4*range && (c-l) >= 0.6*range) { buyS += 15; g_cBuy[6]=true; }
         else buyS += 5;
        }
      if(c < o)
        {
         if(sane && body >= 0.4*range && (h-c) >= 0.6*range) { sellS += 15; g_cSell[6]=true; }
         else sellS += 5;
        }
     }
  }

//+------------------------------------------------------------------+
//| Higher-timeframe trend using the last CLOSED HTF candle           |
//+------------------------------------------------------------------+
int HtfTrend(const ENUM_TIMEFRAMES tf,const int i)
  {
   int sh = iBarShift(NULL,tf,Time[i],false);
   if(sh < 0)
      return(0);
   sh += 1;                                    // last fully closed HTF bar
   if(sh + 2 >= iBars(NULL,tf))
      return(0);
   double ema  = iMA(NULL,tf,InpHtfEma,0,MODE_EMA,PRICE_CLOSE,sh);
   double ema1 = iMA(NULL,tf,InpHtfEma,0,MODE_EMA,PRICE_CLOSE,sh+1);
   double c    = iClose(NULL,tf,sh);
   if(ema <= 0 || c <= 0)
      return(0);
   if(c > ema && ema >= ema1) return(1);
   if(c < ema && ema <= ema1) return(-1);
   return(0);
  }

bool HtfReady(const ENUM_TIMEFRAMES tf)
  {
   ResetLastError();
   int n = iBars(NULL,tf);
   datetime t = iTime(NULL,tf,0);
   if(GetLastError() == 4066 || n < InpHtfEma + 10 || t <= 0)
      return(false);
   return(true);
  }

//+------------------------------------------------------------------+
bool FiltersOk(const int i,string &reason)
  {
   double atrF = iATR(NULL,0,InpAtrFast,i);
   double atrS = iATR(NULL,0,InpAtrSlow,i);
   if(atrS <= 0)
     {
      reason = "No data";
      return(false);
     }
   double ratio = atrF/atrS;
   if(ratio < InpMinVolRatio)
     {
      reason = "Low volatility";
      return(false);
     }
   if(ratio > InpMaxVolRatio)
     {
      reason = "Volatility spike";
      return(false);
     }
   if(!SessionOk(Time[i] + PeriodSeconds()))
     {
      reason = "Outside session";
      return(false);
     }
   reason = "";
   return(true);
  }

//+------------------------------------------------------------------+
//| Stage-2 quality filters                                          |
//+------------------------------------------------------------------+
// Don't buy straight into resistance / sell straight into support.
bool SrOk(const int i,const int dir)
  {
   if(InpSrLookback <= 0 || i + InpSrLookback >= Bars)
      return(true);
   double atr = iATR(NULL,0,InpAtrFast,i);
   if(atr <= 0)
      return(true);
   int hi = iHighest(NULL,0,MODE_HIGH,InpSrLookback,i+1);
   int lo = iLowest(NULL,0,MODE_LOW,InpSrLookback,i+1);
   if(hi < 0 || lo < 0)
      return(true);
   double res = High[hi], sup = Low[lo];
   if(dir > 0 && Close[i] < res && (res - Close[i]) < InpSrAtrMult*atr)
      return(false);
   if(dir < 0 && Close[i] > sup && (Close[i] - sup) < InpSrAtrMult*atr)
      return(false);
   return(true);
  }

// Skip exhausted moves: too many same-color candles or a climax candle.
bool ExhaustionOk(const int i,const int dir)
  {
   double atr = iATR(NULL,0,InpAtrFast,i);
   if(atr > 0 && MathAbs(Close[i]-Open[i]) > 2.2*atr)
      return(false);
   if(InpMaxConsecutive <= 0)
      return(true);
   int run = 0;
   for(int j=i; j<Bars && j<i+InpMaxConsecutive+1; j++)
     {
      bool bull = Close[j] > Open[j];
      bool bear = Close[j] < Open[j];
      if((dir > 0 && bull) || (dir < 0 && bear))
         run++;
      else
         break;
     }
   return(run < InpMaxConsecutive);
  }

// Outcome of a signal on bar j (1 = win, -1 = loss, 0 = draw / unresolved
// as of bar i). Deterministic from price, so history and live agree.
int SignalResult(const int j,const int dir,const int i)
  {
   int k = j - InpExpiryCandles;           // exit candle
   if(k < i || j-1 < 0)
      return(0);
   double diff = NormalizeDouble(Close[k] - Open[j-1],Digits);
   if(diff == 0)
      return(0);
   if(dir > 0)
      return((diff > 0) ? 1 : -1);
   return((diff < 0) ? 1 : -1);
  }

// Adaptive filter: pause a direction while its recent win rate is poor.
// Looks only at signals that were already resolved before bar i closed.
bool SmartOk(const int i,const int dir)
  {
   if(!InpSmartFilter || InpSmartWindow < 5)
      return(true);
   int w=0, l=0, n=0;
   int maxScan = MathMin(Bars - 2, i + 800);
   for(int j=i+1; j<=maxScan && n<InpSmartWindow; j++)
     {
      bool hit = (dir > 0) ? (BuyBuf[j] != EMPTY_VALUE) : (SellBuf[j] != EMPTY_VALUE);
      if(!hit)
         continue;
      int r = SignalResult(j,dir,i);
      if(r == 0)
         continue;
      n++;
      if(r > 0) w++; else l++;
     }
   if(n < MathMax(10,InpSmartWindow/2))
      return(true);                       // not enough evidence yet
   double wr = 100.0*w/n;
   return(wr >= InpSmartMinWr);
  }

bool InCooldown(const int i)
  {
   for(int k=1; k<=InpCooldownBars; k++)
     {
      int j = i + k;
      if(j >= Bars)
         break;
      if(BuyBuf[j] != EMPTY_VALUE || SellBuf[j] != EMPTY_VALUE)
         return(true);
     }
   return(false);
  }

int GmtHour(const datetime t)
  {
   return(TimeHour(t - InpBrokerGmtOffset*3600));
  }

bool SessionOk(const datetime t)
  {
   if(InpSession == APX_SESSION_ALL)
      return(true);
   int hr = GmtHour(t);
   bool london = (hr >= 7 && hr < 16);
   bool ny     = (hr >= 12 && hr < 21);
   switch(InpSession)
     {
      case APX_SESSION_LDN_NY:  return(london || ny);
      case APX_SESSION_LONDON:  return(london);
      case APX_SESSION_NEWYORK: return(ny);
      case APX_SESSION_OVERLAP: return(london && ny);
      default:                  return(true);
     }
   return(true);
  }

string SessionName(const datetime t)
  {
   int hr = GmtHour(t);
   bool london = (hr >= 7 && hr < 16);
   bool ny     = (hr >= 12 && hr < 21);
   if(london && ny) return("London + NY overlap");
   if(london)       return("London");
   if(ny)           return("New York");
   if(hr >= 23 || hr < 8) return("Asia / Tokyo");
   return("Off-hours");
  }

//+------------------------------------------------------------------+
//| Honest win-rate tracker                                          |
//| Entry = open of the candle after the signal.                     |
//| Exit  = close of the candle InpExpiryCandles later.              |
//+------------------------------------------------------------------+
void UpdateStats()
  {
   g_wins=0; g_losses=0; g_draws=0;
   g_bWins=0; g_bLoss=0; g_sWins=0; g_sLoss=0;
   g_tWins=0; g_tLoss=0;
   g_streak=0; g_bestWin=0; g_worstLoss=0;
   g_last10=""; g_lastSigTime=0; g_lastSigDir=0; g_lastSigScore=0;
   g_lastSigPending=false; g_lastSigEntry=0;
   ArrayInitialize(g_hW,0); ArrayInitialize(g_hL,0);

   int start = MathMin(InpStatsBars,Bars - g_warm - 2);
   datetime dayStart = iTime(NULL,PERIOD_D1,0);

   for(int i=start; i>=1; i--)
     {
      WinBuf[i]  = EMPTY_VALUE;
      LossBuf[i] = EMPTY_VALUE;
     }

   for(int i=start; i>=1; i--)
     {
      bool isBuy  = (BuyBuf[i]  != EMPTY_VALUE);
      bool isSell = (SellBuf[i] != EMPTY_VALUE);
      if(!isBuy && !isSell)
         continue;

      g_lastSigTime  = Time[i];
      g_lastSigDir   = isBuy ? 1 : -1;
      g_lastSigScore = isBuy ? BuyScoreBuf[i] : SellScoreBuf[i];
      g_lastSigEntry = Open[i-1];

      int j = i - InpExpiryCandles;
      if(j < 1)
        {
         g_lastSigPending = true;      // trade still running
         continue;
        }
      g_lastSigPending = false;

      double diff = NormalizeDouble(Close[j] - Open[i-1],Digits);
      int res;
      if(diff == 0)
         res = 0;
      else if(isBuy)
         res = (diff > 0) ? 1 : -1;
      else
         res = (diff < 0) ? 1 : -1;

      double off = iATR(NULL,0,14,j) * 1.4;
      double markPrice = isBuy ? Low[j] - off : High[j] + off;

      if(res == 0)
        {
         g_draws++;
         AddHistory("D");
         continue;
        }

      bool today = (Time[i] >= dayStart);
      if(res > 0)
        {
         g_wins++;
         if(isBuy) g_bWins++; else g_sWins++;
         if(today) g_tWins++;
         g_hW[TimeHour(Time[i-1])]++;
         g_streak = (g_streak > 0) ? g_streak + 1 : 1;
         g_bestWin = MathMax(g_bestWin,g_streak);
         WinBuf[j] = markPrice;
         AddHistory("W");
        }
      else
        {
         g_losses++;
         if(isBuy) g_bLoss++; else g_sLoss++;
         if(today) g_tLoss++;
         g_hL[TimeHour(Time[i-1])]++;
         g_streak = (g_streak < 0) ? g_streak - 1 : -1;
         g_worstLoss = MathMax(g_worstLoss,-g_streak);
         LossBuf[j] = markPrice;
         AddHistory("L");
        }
     }
  }

void AddHistory(const string r)
  {
   g_last10 = g_last10 + r;
   int n = StringLen(g_last10);
   if(n > 10)
      g_last10 = StringSubstr(g_last10,n - 10);
  }

//+------------------------------------------------------------------+
void CheckAlert()
  {
   if(Time[1] == g_lastAlertBar)
      return;
   int dir = (BuyBuf[1] != EMPTY_VALUE) ? 1 : ((SellBuf[1] != EMPTY_VALUE) ? -1 : 0);
   if(dir == 0)
      return;
   g_lastAlertBar = Time[1];

   double sc = (dir > 0) ? BuyScoreBuf[1] : SellScoreBuf[1];
   string msg = StringFormat("Apex Pulse 5M | %s %s | %s | score %d (%s) | expiry %d candle(s)",
                             Symbol(),TfName((ENUM_TIMEFRAMES)Period()),
                             (dir > 0) ? "CALL / BUY" : "PUT / SELL",
                             (int)sc,Grade(sc),InpExpiryCandles);
   if(InpAlertPopup) Alert(msg);
   if(InpAlertSound) PlaySound(InpSoundFile);
   if(InpAlertPush)  SendNotification(msg);
   if(InpAlertEmail) SendMail("Apex Pulse 5M signal",msg);
  }

//+------------------------------------------------------------------+
void UpdateLive()
  {
   bool bt,st;
   CalcScores(0,g_liveBuy,g_liveSell,bt,st);
   string reason = "";
   if(!FiltersOk(0,reason))
      g_liveReason = reason;
   else
      g_liveReason = "";

   double emaF = iMA(NULL,0,InpEmaFast,0,MODE_EMA,PRICE_CLOSE,1);
   double emaS = iMA(NULL,0,InpEmaSlow,0,MODE_EMA,PRICE_CLOSE,1);
   g_trendChart = (emaF > emaS) ? 1 : ((emaF < emaS) ? -1 : 0);
   g_trendH1 = HtfTrend(InpHtf1,1);
   g_trendH2 = HtfTrend(InpHtf2,1);
   g_rsi     = iRSI(NULL,0,InpRsiPeriod,PRICE_CLOSE,1);
   g_stoch   = iStochastic(NULL,0,InpStochK,InpStochD,InpStochSlowing,MODE_SMA,0,MODE_MAIN,1);
   double atrS = iATR(NULL,0,InpAtrSlow,1);
   g_volRatio = (atrS > 0) ? iATR(NULL,0,InpAtrFast,1)/atrS : 0;

   g_pauseBuy  = !SmartOk(0,1);
   g_pauseSell = !SmartOk(0,-1);

   int spr = (int)MarketInfo(Symbol(),MODE_SPREAD);
   if(g_liveReason == "" && InpMaxSpreadPts > 0 && spr > InpMaxSpreadPts)
      g_liveReason = "High spread (" + IntegerToString(spr) + " pts)";

   // leave checklist flags describing the last CLOSED candle
   double b1,s1; bool bt1,st1;
   CalcScores(1,b1,s1,bt1,st1);
  }

//+------------------------------------------------------------------+
//| Dashboard                                                        |
//+------------------------------------------------------------------+
void DrawDashboard()
  {
   if(!InpShowDashboard)
      return;

   int x  = InpPanelX, y = InpPanelY, w = InpPanelWidth;
   int fs = InpFontSize;
   int rh = (int)MathRound(fs*2.15);
   int lx = x + 16;
   int rx = x + w - 16;
   int vx = x + (int)(w*0.47);

   SetRect("bg",x,y,w,g_panelH,C_BG,C_BORDER);
   SetRect("accent",x,y,w,3,C_ACCENT,C_ACCENT);

   int cy = y + 14;

   //--- header
   SetLabel("title",lx,cy,"APEX PULSE 5M",C_TEXT,fs+3,"Segoe UI Semibold");
   SetLabel("badge",rx,cy+2,"PRO",C_GOLD,fs,"Segoe UI Semibold",ANCHOR_RIGHT_UPPER);
   cy += rh + 6;

   string tfTxt = Symbol() + "  ·  " + TfName((ENUM_TIMEFRAMES)Period());
   if(Period() != PERIOD_M5) tfTxt += "  (built for M5)";
   SetLabel("sym",lx,cy,tfTxt,C_MUTED,fs-1);
   int left = SecondsLeft();
   SetLabel("cd",rx,cy,"closes in " + StringFormat("%02d:%02d",left/60,left%60),
            left <= 15 ? C_WARN : C_TEXT,fs-1,"Consolas",ANCHOR_RIGHT_UPPER);
   cy += rh + 2;

   //--- signal card
   int cardTop = cy;
   int cardH   = (int)(fs*9.2);
   SetRect("card",x+10,cardTop,w-20,cardH,C_CARD,C_BORDER);
   cy += 10;
   SetLabel("sigcap",lx+6,cy,"NEXT CANDLE SIGNAL",C_MUTED,fs-2,"Segoe UI Semibold");

   int    dir   = (BuyBuf[1] != EMPTY_VALUE) ? 1 : ((SellBuf[1] != EMPTY_VALUE) ? -1 : 0);
   double score = (dir > 0) ? BuyScoreBuf[1] : ((dir < 0) ? SellScoreBuf[1] : MathMax(SafeScore(BuyScoreBuf[1]),SafeScore(SellScoreBuf[1])));
   string sigTxt = (dir > 0) ? "▲  CALL" : ((dir < 0) ? "▼  PUT" : "WAIT");
   color  sigClr = (dir > 0) ? InpCallColor : ((dir < 0) ? InpPutColor : C_MUTED);
   SetLabel("gradecap",rx-6,cy,(dir != 0) ? Grade(score) : "NO SETUP",(dir != 0) ? GradeColor(score) : C_MUTED,
            fs-2,"Segoe UI Semibold",ANCHOR_RIGHT_UPPER);
   cy += rh - 2;
   SetLabel("sig",lx+6,cy,sigTxt,sigClr,fs+11,"Segoe UI Semibold");
   SetLabel("score",rx-6,cy+4,IntegerToString((int)score),C_TEXT,fs+9,"Segoe UI Semibold",ANCHOR_RIGHT_UPPER);
   SetLabel("scorecap",rx-6,cy+(int)(fs*3.6),"/ 100 confidence",C_MUTED,fs-2,"Segoe UI",ANCHOR_RIGHT_UPPER);
   cy += (int)(fs*5.0);

   int trackW = w - 44;
   int fillW  = (int)MathMax(2,trackW*MathMin(score,100.0)/100.0);
   SetRect("track",lx+6,cy,trackW,5,C_BORDER,C_BORDER);
   SetRect("fill",lx+6,cy,fillW,5,(dir != 0) ? sigClr : C_MUTED,(dir != 0) ? sigClr : C_MUTED);
   cy = cardTop + cardH + 8;

   //--- setup checklist (last closed candle)
   int chkDir = (dir != 0) ? dir : ((SafeScore(BuyScoreBuf[1]) >= SafeScore(SellScoreBuf[1])) ? 1 : -1);
   int crh    = rh - 4;
   int chkH   = 4*crh + 14;
   SetRect("chk",x+10,cy,w-20,chkH,C_CARD,C_BORDER);
   SetLabel("chkcap",lx+6,cy+5,"SETUP CHECKLIST  ·  " + ((chkDir > 0) ? "CALL side" : "PUT side"),C_MUTED,fs-2,"Segoe UI Semibold");
   int passed = 0;
   for(int q=0; q<7; q++)
     {
      bool ok = (chkDir > 0) ? g_cBuy[q] : g_cSell[q];
      if(ok) passed++;
      int col = (q < 4) ? 0 : 1;
      int row = (q < 4) ? q : q-4;
      int cx  = lx + 6 + col*(int)(w*0.47);
      int cyy = cy + 5 + crh*(row+1) - 2;
      string nm = CHK_NAMES[q];
      if(q == 1) nm = "Trend " + TfName(InpHtf1);
      if(q == 2) nm = "Trend " + TfName(InpHtf2);
      SetLabel("chk"+IntegerToString(q),cx,cyy,(ok ? "✔  " : "✘  ") + nm,ok ? InpCallColor : C_MUTED,fs-1);
     }
   SetLabel("chk7",lx+6+(int)(w*0.47),cy+5+crh*4-2,IntegerToString(passed) + " / 7 confirmed",
            (passed >= 6) ? C_GOLD : C_TEXT,fs-1,"Segoe UI Semibold");
   cy += chkH + 8;

   //--- live preview & status
   string live;
   color  liveClr = C_MUTED;
   if(g_liveBuy >= g_liveSell)
     { live = "CALL " + IntegerToString((int)g_liveBuy); if(g_liveBuy >= InpMinScore) liveClr = InpCallColor; }
   else
     { live = "PUT " + IntegerToString((int)g_liveSell); if(g_liveSell >= InpMinScore) liveClr = InpPutColor; }
   Row("live","Forming candle",live + "  · unconfirmed",liveClr,cy,lx,vx,fs);
   cy += rh;
   Row("status","Status",(g_liveReason == "") ? "Scanning" : g_liveReason,
       (g_liveReason == "") ? C_TEXT : C_WARN,cy,lx,vx,fs);
   cy += rh;
   string smart = !InpSmartFilter ? "Off" : ((g_pauseBuy && g_pauseSell) ? "CALL + PUT paused" :
                  (g_pauseBuy ? "CALL paused (weak recent WR)" : (g_pauseSell ? "PUT paused (weak recent WR)" : "Active · both sides OK")));
   Row("smart","Smart filter",smart,(g_pauseBuy || g_pauseSell) ? C_WARN : C_TEXT,cy,lx,vx,fs);
   cy += rh;
   Sep("sep1",x,cy,w);
   cy += 10;

   //--- market
   SetLabel("trcap",lx,cy,"Trend",C_MUTED,fs);
   TrendCell("tr0",vx,cy,TfName((ENUM_TIMEFRAMES)Period()),g_trendChart,fs);
   TrendCell("tr1",vx+(int)(w*0.17),cy,TfName(InpHtf1),g_trendH1,fs);
   TrendCell("tr2",vx+(int)(w*0.34),cy,TfName(InpHtf2),g_trendH2,fs);
   cy += rh;
   Row("mom","RSI · Stoch",DoubleToString(g_rsi,1) + "  ·  " + DoubleToString(g_stoch,1),C_TEXT,cy,lx,vx,fs);
   cy += rh;
   string volTxt = (g_volRatio < InpMinVolRatio) ? "Low" : ((g_volRatio > InpMaxVolRatio) ? "Spike" : "Normal");
   Row("vol","Volatility",volTxt + "  (" + DoubleToString(g_volRatio,2) + "x)",
       (volTxt == "Normal") ? C_TEXT : C_WARN,cy,lx,vx,fs);
   cy += rh;
   Row("sess","Session",SessionName(TimeCurrent()),C_TEXT,cy,lx,vx,fs);
   cy += rh;
   Sep("sep2",x,cy,w);
   cy += 10;

   //--- performance
   SetLabel("perfcap",lx,cy,"PERFORMANCE  ·  last " + IntegerToString(InpStatsBars) + " bars",C_MUTED,fs-2,"Segoe UI Semibold");
   cy += rh - 2;

   int    total   = g_wins + g_losses;
   double wr      = (total > 0) ? 100.0*g_wins/total : 0;
   double be      = 100.0/(1.0 + InpPayoutPercent/100.0);
   double edge    = wr - be;
   bool   enough  = (total >= 30);
   color  wrClr   = !enough ? C_WARN : (edge > 0 ? InpCallColor : InpPutColor);

   Row("wr","Win rate",(total > 0 ? DoubleToString(wr,1) + "%" : "--") + "   " +
       IntegerToString(g_wins) + "W · " + IntegerToString(g_losses) + "L · " + IntegerToString(g_draws) + "D",
       wrClr,cy,lx,vx,fs);
   cy += rh;
   Row("be","Break-even @" + DoubleToString(InpPayoutPercent,0) + "%",DoubleToString(be,1) + "%",C_TEXT,cy,lx,vx,fs);
   cy += rh;
   string edgeTxt = !enough ? "Need 30+ trades (" + IntegerToString(total) + ")"
                            : ((edge >= 0 ? "+" : "") + DoubleToString(edge,1) + "%" + (edge > 0 ? "  profitable" : "  not profitable"));
   Row("edge","Edge",edgeTxt,wrClr,cy,lx,vx,fs);
   cy += rh;
   int bt = g_bWins + g_bLoss, st = g_sWins + g_sLoss;
   Row("dirs","CALL · PUT",
       (bt > 0 ? DoubleToString(100.0*g_bWins/bt,0) + "%" : "--") + "  ·  " +
       (st > 0 ? DoubleToString(100.0*g_sWins/st,0) + "%" : "--"),C_TEXT,cy,lx,vx,fs);
   cy += rh;
   Row("today","Today",IntegerToString(g_tWins) + "W · " + IntegerToString(g_tLoss) + "L",C_TEXT,cy,lx,vx,fs);
   cy += rh;
   int hh = TimeHour(TimeCurrent());
   int hn = g_hW[hh] + g_hL[hh];
   Row("hour","This hour (" + StringFormat("%02d:00",hh) + ")",
       (hn > 0 ? DoubleToString(100.0*g_hW[hh]/hn,0) + "%  · " + IntegerToString(g_hW[hh]) + "W " + IntegerToString(g_hL[hh]) + "L" : "no history"),
       (hn >= 5 && 100.0*g_hW[hh]/hn < be) ? C_WARN : C_TEXT,cy,lx,vx,fs);
   cy += rh;
   string strk = (g_streak > 0) ? "W" + IntegerToString(g_streak) : ((g_streak < 0) ? "L" + IntegerToString(-g_streak) : "--");
   Row("streak","Streak",strk + "  · best W" + IntegerToString(g_bestWin) + " · worst L" + IntegerToString(g_worstLoss),
       (g_streak >= 0) ? C_TEXT : C_WARN,cy,lx,vx,fs);
   cy += rh;
   Row("last10","Last 10",Spaced(g_last10),C_TEXT,cy,lx,vx,fs);
   cy += rh;

   string ls = "--";
   color  lsClr = C_MUTED;
   if(g_lastSigTime > 0)
     {
      ls = ((g_lastSigDir > 0) ? "CALL " : "PUT ") + TimeToString(g_lastSigTime + PeriodSeconds(),TIME_MINUTES) +
           " · " + IntegerToString((int)g_lastSigScore);
      lsClr = (g_lastSigDir > 0) ? InpCallColor : InpPutColor;
      if(g_lastSigPending)
        {
         double d = Close[0] - g_lastSigEntry;
         bool winning = (g_lastSigDir > 0) ? (d > 0) : (d < 0);
         ls += winning ? "  · running ✔" : "  · running ✘";
        }
     }
   Row("lastsig","Last signal",ls,lsClr,cy,lx,vx,fs);
   cy += rh + 4;

   Sep("sep3",x,cy,w);
   cy += 8;
   SetLabel("foot",lx,cy,"Non-repaint · closed-candle logic · demo first",C_MUTED,fs-2);
   cy += rh;

   g_panelH = cy - y;
   SetRect("bg",x,y,w,g_panelH,C_BG,C_BORDER);
  }

//+------------------------------------------------------------------+
//| UI helpers                                                       |
//+------------------------------------------------------------------+
void SetLabel(const string id,const int x,const int y,const string text,const color clr,
              const int size,const string font="Segoe UI",const ENUM_ANCHOR_POINT anchor=ANCHOR_LEFT_UPPER)
  {
   string name = APX_PREFIX + id;
   if(ObjectFind(0,name) < 0)
     {
      ObjectCreate(0,name,OBJ_LABEL,0,0,0);
      ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
      ObjectSetInteger(0,name,OBJPROP_BACK,false);
     }
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_ANCHOR,anchor);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clr);
   ObjectSetInteger(0,name,OBJPROP_FONTSIZE,size);
   ObjectSetString(0,name,OBJPROP_FONT,font);
   ObjectSetString(0,name,OBJPROP_TEXT,text);
  }

void SetRect(const string id,const int x,const int y,const int w,const int h,const color bg,const color border)
  {
   string name = APX_PREFIX + id;
   if(ObjectFind(0,name) < 0)
     {
      ObjectCreate(0,name,OBJ_RECTANGLE_LABEL,0,0,0);
      ObjectSetInteger(0,name,OBJPROP_CORNER,CORNER_LEFT_UPPER);
      ObjectSetInteger(0,name,OBJPROP_BORDER_TYPE,BORDER_FLAT);
      ObjectSetInteger(0,name,OBJPROP_SELECTABLE,false);
      ObjectSetInteger(0,name,OBJPROP_HIDDEN,true);
      ObjectSetInteger(0,name,OBJPROP_BACK,false);
     }
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,w);
   ObjectSetInteger(0,name,OBJPROP_YSIZE,h);
   ObjectSetInteger(0,name,OBJPROP_BGCOLOR,bg);
   ObjectSetInteger(0,name,OBJPROP_COLOR,border);
  }

void Row(const string id,const string caption,const string value,const color clr,
         const int y,const int lx,const int vx,const int fs)
  {
   SetLabel(id + "_c",lx,y,caption,C_MUTED,fs);
   SetLabel(id + "_v",vx,y,value,clr,fs,"Segoe UI Semibold");
  }

void Sep(const string id,const int x,const int y,const int w)
  {
   SetRect(id,x+14,y,w-28,1,C_BORDER,C_BORDER);
  }

void TrendCell(const string id,const int x,const int y,const string tf,const int t,const int fs)
  {
   string arrow = (t > 0) ? "▲" : ((t < 0) ? "▼" : "■");
   color  clr   = (t > 0) ? InpCallColor : ((t < 0) ? InpPutColor : C_MUTED);
   SetLabel(id,x,y,arrow + " " + tf,clr,fs,"Segoe UI Semibold");
  }

void DeleteObjects(const string prefix)
  {
   for(int k=ObjectsTotal(0,-1,-1)-1; k>=0; k--)
     {
      string name = ObjectName(0,k,-1,-1);
      if(StringFind(name,prefix) == 0)
         ObjectDelete(0,name);
     }
  }

//+------------------------------------------------------------------+
//| Misc helpers                                                     |
//+------------------------------------------------------------------+
int SecondsLeft()
  {
   datetime now = TimeLocal() + g_srvOffset;
   int left = (int)(Time[0] + PeriodSeconds() - now);
   if(left < 0) left = 0;
   if(left > PeriodSeconds()) left = PeriodSeconds();
   return(left);
  }

string TfName(const ENUM_TIMEFRAMES tf)
  {
   ENUM_TIMEFRAMES t = (tf == PERIOD_CURRENT) ? (ENUM_TIMEFRAMES)Period() : tf;
   string s = EnumToString(t);
   if(StringFind(s,"PERIOD_") == 0)
      s = StringSubstr(s,7);
   return(s);
  }

string Grade(const double s)
  {
   if(s >= 90) return("PREMIUM");
   if(s >= 80) return("STRONG");
   if(s >= 70) return("GOOD");
   return("WEAK");
  }

color GradeColor(const double s)
  {
   if(s >= 90) return(C_GOLD);
   if(s >= 80) return(C_ACCENT);
   return(C_TEXT);
  }

double SafeScore(const double v)
  {
   return((v == EMPTY_VALUE) ? 0.0 : v);
  }

string Spaced(const string s)
  {
   if(StringLen(s) == 0)
      return("--");
   string out = "";
   for(int k=0; k<StringLen(s); k++)
     {
      if(k > 0) out += " ";
      out += StringSubstr(s,k,1);
     }
   return(out);
  }
//+------------------------------------------------------------------+
