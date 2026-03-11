export function openChart(symbol: string) {
  const newWindow = window.open("", "_blank");
  
  if (!newWindow) {
    alert("Pop-up blocked! Please allow pop-ups to view the chart.");
    return;
  }

  const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <title>Chart: ${symbol}</title>
          <style>
              body, html { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: #131722; }
              .chart-container { height: 100vh; width: 100vw; }
          </style>
      </head>
      <body>
          <div class="chart-container" id="chart_div"></div>
          <script type="text/javascript" src="https://s3.tradingview.com/tv.js"><\/script>
          <script type="text/javascript">
              new TradingView.widget({
                  "width": "100%",
                  "height": "100%",
                  "symbol": "${symbol}",
                  "interval": "D",
                  "timezone": "Etc/UTC",
                  "theme": "dark",
                  "style": "1",
                  "locale": "en",
                  "toolbar_bg": "#f1f3f6",
                  "enable_publishing": false,
                  "allow_symbol_change": true,
                  "container_id": "chart_div"
              });
          <\/script>
      </body>
      </html>
  `;

  newWindow.document.write(htmlContent);
  newWindow.document.close();
}

export interface MarketPair {
  symbol: string;
  title: string;
  desc: string;
  category: "Forex" | "Indices" | "ETFs" | "Commodities" | "Energy" | "Stocks";
  region?: "US" | "Europe" | "Asia";
}

export const MARKET_PAIRS: MarketPair[] = [
  // --- GLOBAL EQUITIES: US ---
  { symbol: "NASDAQ:ARM", title: "ARM", desc: "Arm Holdings plc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:MSTR", title: "MSTR", desc: "MicroStrategy Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:COIN", title: "COIN", desc: "Coinbase Global Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:SHOP", title: "SHOP", desc: "Shopify Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:PLTR", title: "PLTR", desc: "Palantir Technologies", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:APP", title: "APP", desc: "AppLovin Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:HOOD", title: "HOOD", desc: "Robinhood Markets", category: "Stocks", region: "US" },
  { symbol: "NYSE:RCL", title: "RCL", desc: "Royal Caribbean Group", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:NVDA", title: "NVDA", desc: "NVIDIA Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:TSLA", title: "TSLA", desc: "Tesla Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:NET", title: "NET", desc: "Cloudflare Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:KKR", title: "KKR", desc: "KKR & Co Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:AMD", title: "AMD", desc: "Advanced Micro Devices", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:MRVL", title: "MRVL", desc: "Marvell Technology", category: "Stocks", region: "US" },
  { symbol: "NYSE:VRT", title: "VRT", desc: "Vertiv Holdings Co", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:META", title: "META", desc: "Meta Platforms Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:AMZN", title: "AMZN", desc: "Amazon.com Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:GOOGL", title: "GOOGL", desc: "Alphabet Inc Class A", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:MSFT", title: "MSFT", desc: "Microsoft Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:AVGO", title: "AVGO", desc: "Broadcom Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:LLY", title: "LLY", desc: "Eli Lilly and Co", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:SMCI", title: "SMCI", desc: "Super Micro Computer", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:CRWD", title: "CRWD", desc: "CrowdStrike Holdings", category: "Stocks", region: "US" },
  { symbol: "NYSE:XYZ", title: "XYZ", desc: "Block Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:NFLX", title: "NFLX", desc: "Netflix Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:AAPL", title: "AAPL", desc: "Apple Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:BA", title: "BA", desc: "Boeing Co", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:ABNB", title: "ABNB", desc: "Airbnb Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:UBER", title: "UBER", desc: "Uber Technologies", category: "Stocks", region: "US" },
  { symbol: "NYSE:SNOW", title: "SNOW", desc: "Snowflake Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:INTC", title: "INTC", desc: "Intel Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:QCOM", title: "QCOM", desc: "Qualcomm Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:ADBE", title: "ADBE", desc: "Adobe Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:XOM", title: "XOM", desc: "Exxon Mobil Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:PYPL", title: "PYPL", desc: "PayPal Holdings Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:MU", title: "MU", desc: "Micron Technology", category: "Stocks", region: "US" },
  { symbol: "NYSE:PFE", title: "PFE", desc: "Pfizer Inc", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:TEAM", title: "TEAM", desc: "Atlassian Corp", category: "Stocks", region: "US" },
  { symbol: "NASDAQ:DDOG", title: "DDOG", desc: "Datadog Inc", category: "Stocks", region: "US" },
  { symbol: "NYSE:COP", title: "COP", desc: "ConocoPhillips", category: "Stocks", region: "US" },

  // --- GLOBAL EQUITIES: EUROPE ---
  { symbol: "NASDAQ:ASML", title: "ASML", desc: "ASML Holding NV (Netherlands)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:SAP", title: "SAP", desc: "SAP SE (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:MC", title: "LVMH", desc: "LVMH Moët Hennessy (France)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:SHEL", title: "Shell", desc: "Shell plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:BP", title: "BP", desc: "BP plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:TTE", title: "Total", desc: "TotalEnergies SE (France)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:RIO", title: "Rio Tinto", desc: "Rio Tinto plc (UK/AUS)", category: "Stocks", region: "Europe" },
  { symbol: "SIX:NESN", title: "Nestlé", desc: "Nestlé SA (Swiss)", category: "Stocks", region: "Europe" },
  { symbol: "SIX:NOVN", title: "Novartis", desc: "Novartis AG (Swiss)", category: "Stocks", region: "Europe" },
  { symbol: "SIX:ROG", title: "Roche", desc: "Roche Holding AG (Swiss)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:AZN", title: "AstraZeneca", desc: "AstraZeneca plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:GSK", title: "GSK", desc: "GSK plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "BME:SAN", title: "Santander", desc: "Banco Santander SA (Spain)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:BNP", title: "BNP", desc: "BNP Paribas SA (France)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:HSBA", title: "HSBC", desc: "HSBC Holdings plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "SIX:UBSG", title: "UBS", desc: "UBS Group AG (Swiss)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:SIE", title: "Siemens", desc: "Siemens AG (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:AIR", title: "Airbus", desc: "Airbus SE (France)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:MBG", title: "Mercedes", desc: "Mercedes-Benz Group (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:BMW", title: "BMW", desc: "BMW AG (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:VOW3", title: "VW", desc: "Volkswagen AG Pref (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "BIT:ENEL", title: "Enel", desc: "Enel SpA (Italy)", category: "Stocks", region: "Europe" },
  { symbol: "BIT:ENI", title: "Eni", desc: "Eni SpA (Italy)", category: "Stocks", region: "Europe" },
  { symbol: "BME:ITX", title: "Inditex", desc: "Inditex (Spain)", category: "Stocks", region: "Europe" },
  { symbol: "XETR:DTE", title: "DT", desc: "Deutsche Telekom AG (Germany)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:OR", title: "L'Oréal", desc: "L'Oréal SA (France)", category: "Stocks", region: "Europe" },
  { symbol: "EPA:SAN", title: "Sanofi", desc: "Sanofi SA (France)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:NG", title: "National Grid", desc: "National Grid plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "LSE:VOD", title: "Vodafone", desc: "Vodafone Group plc (UK)", category: "Stocks", region: "Europe" },
  { symbol: "BIT:ISP", title: "Intesa", desc: "Intesa Sanpaolo SpA (Italy)", category: "Stocks", region: "Europe" },

  // --- GLOBAL EQUITIES: ASIA-PACIFIC ---
  { symbol: "NYSE:TSM", title: "TSMC", desc: "Taiwan Semiconductor (Taiwan)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:SSNLF", title: "Samsung", desc: "Samsung Electronics (S.Korea)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:TCEHY", title: "Tencent", desc: "Tencent Holdings (CN)", category: "Stocks", region: "Asia" },
  { symbol: "NYSE:BABA", title: "Alibaba", desc: "Alibaba Group (CN)", category: "Stocks", region: "Asia" },
  { symbol: "NASDAQ:PDD", title: "PDD", desc: "PDD Holdings Inc (CN)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:MPNGY", title: "Meituan", desc: "Meituan (CN)", category: "Stocks", region: "Asia" },
  { symbol: "NASDAQ:JD", title: "JD.com", desc: "JD.com Inc (CN)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:AAGIY", title: "AIA", desc: "AIA Group Ltd (HK)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:PNGAY", title: "Ping An", desc: "Ping An Insurance (CN)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:HKXCY", title: "HKEX", desc: "HK Exchanges & Clearing (HK)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:CICHY", title: "CCB", desc: "China Construction Bank (CN)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:BACHY", title: "BoC", desc: "Bank of China Ltd (CN)", category: "Stocks", region: "Asia" },
  { symbol: "NYSE:TM", title: "Toyota", desc: "Toyota Motor Corp (Japan)", category: "Stocks", region: "Asia" },
  { symbol: "NYSE:SONY", title: "Sony", desc: "Sony Group Corp (Japan)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:SFTBY", title: "SoftBank", desc: "SoftBank Group Corp (Japan)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:NTTYY", title: "NTT", desc: "Nippon Telegraph & Tel (Japan)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:RELIANCE", title: "Reliance", desc: "Reliance Industries (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:TCS", title: "TCS", desc: "Tata Consultancy Svcs (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:HDFCBANK", title: "HDFC Bank", desc: "HDFC Bank Ltd (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:INFY", title: "Infosys", desc: "Infosys Ltd (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:ICICIBANK", title: "ICICI Bank", desc: "ICICI Bank Ltd (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:SBIN", title: "SBI", desc: "State Bank of India (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:AXISBANK", title: "Axis Bank", desc: "Axis Bank Ltd (India)", category: "Stocks", region: "Asia" },
  { symbol: "BSE:LT", title: "L&T", desc: "Larsen & Toubro Ltd (India)", category: "Stocks", region: "Asia" },
  { symbol: "ASX:BHP", title: "BHP", desc: "BHP Group Ltd (AUS)", category: "Stocks", region: "Asia" },
  { symbol: "ASX:CSL", title: "CSL", desc: "CSL Ltd (AUS)", category: "Stocks", region: "Asia" },
  { symbol: "ASX:CBA", title: "CBA", desc: "Commonwealth Bank (AUS)", category: "Stocks", region: "Asia" },
  { symbol: "ASX:NAB", title: "NAB", desc: "National Australia Bank (AUS)", category: "Stocks", region: "Asia" },
  { symbol: "HKEX:941", title: "China Mobile", desc: "China Mobile Ltd (CN)", category: "Stocks", region: "Asia" },
  { symbol: "OTC:XIACY", title: "Xiaomi", desc: "Xiaomi Corp (CN)", category: "Stocks", region: "Asia" },

  // --- Forex Majors (Top 7) ---
  { symbol: "FX:EURUSD", title: "EUR/USD", desc: "Euro / US Dollar", category: "Forex" },
  { symbol: "FX:USDJPY", title: "USD/JPY", desc: "US Dollar / Japanese Yen", category: "Forex" },
  { symbol: "FX:GBPUSD", title: "GBP/USD", desc: "British Pound / US Dollar", category: "Forex" },
  { symbol: "FX:AUDUSD", title: "AUD/USD", desc: "Australian Dollar / US Dollar", category: "Forex" },
  { symbol: "FX:USDCAD", title: "USD/CAD", desc: "US Dollar / Canadian Dollar", category: "Forex" },
  { symbol: "FX:USDCHF", title: "USD/CHF", desc: "US Dollar / Swiss Franc", category: "Forex" },
  { symbol: "FX:NZDUSD", title: "NZD/USD", desc: "New Zealand Dollar / US Dollar", category: "Forex" },

  // --- Forex Liquid Minors / Crosses (G10) ---
  { symbol: "FX:EURJPY", title: "EUR/JPY", desc: "Euro / Japanese Yen", category: "Forex" },
  { symbol: "FX:GBPJPY", title: "GBP/JPY", desc: "British Pound / Japanese Yen", category: "Forex" },
  { symbol: "FX:EURGBP", title: "EUR/GBP", desc: "Euro / British Pound", category: "Forex" },
  { symbol: "FX:AUDJPY", title: "AUD/JPY", desc: "Australian Dollar / Japanese Yen", category: "Forex" },
  { symbol: "FX:EURAUD", title: "EUR/AUD", desc: "Euro / Australian Dollar", category: "Forex" },
  { symbol: "FX:EURCHF", title: "EUR/CHF", desc: "Euro / Swiss Franc", category: "Forex" },
  { symbol: "FX:AUDNZD", title: "AUD/NZD", desc: "Australian Dollar / New Zealand Dollar", category: "Forex" },
  { symbol: "FX:NZDJPY", title: "NZD/JPY", desc: "New Zealand Dollar / Japanese Yen", category: "Forex" },
  { symbol: "FX:GBPAUD", title: "GBP/AUD", desc: "British Pound / Australian Dollar", category: "Forex" },
  { symbol: "FX:GBPCAD", title: "GBP/CAD", desc: "British Pound / Canadian Dollar", category: "Forex" },
  { symbol: "FX:EURNZD", title: "EUR/NZD", desc: "Euro / New Zealand Dollar", category: "Forex" },
  { symbol: "FX:AUDCAD", title: "AUD/CAD", desc: "Australian Dollar / Canadian Dollar", category: "Forex" },
  { symbol: "FX:GBPCHF", title: "GBP/CHF", desc: "British Pound / Swiss Franc", category: "Forex" },
  { symbol: "FX:AUDCHF", title: "AUD/CHF", desc: "Australian Dollar / Swiss Franc", category: "Forex" },
  { symbol: "FX:EURCAD", title: "EUR/CAD", desc: "Euro / Canadian Dollar", category: "Forex" },
  { symbol: "FX:CADJPY", title: "CAD/JPY", desc: "Canadian Dollar / Japanese Yen", category: "Forex" },
  { symbol: "FX:GBPNZD", title: "GBP/NZD", desc: "British Pound / New Zealand Dollar", category: "Forex" },
  { symbol: "FX:CADCHF", title: "CAD/CHF", desc: "Canadian Dollar / Swiss Franc", category: "Forex" },
  { symbol: "FX:CHFJPY", title: "CHF/JPY", desc: "Swiss Franc / Japanese Yen", category: "Forex" },
  { symbol: "FX:NZDCAD", title: "NZD/CAD", desc: "New Zealand Dollar / Canadian Dollar", category: "Forex" },
  { symbol: "FX:NZDCHF", title: "NZD/CHF", desc: "New Zealand Dollar / Swiss Franc", category: "Forex" },

  // --- Forex USD vs EM / Exotics ---
  { symbol: "FX_IDC:USDCNY", title: "USD/CNY", desc: "US Dollar / Chinese Yuan", category: "Forex" },
  { symbol: "FX:USDHKD", title: "USD/HKD", desc: "US Dollar / Hong Kong Dollar", category: "Forex" },
  { symbol: "FX_IDC:USDKRW", title: "USD/KRW", desc: "US Dollar / Korean Won", category: "Forex" },
  { symbol: "FX_IDC:USDSGD", title: "USD/SGD", desc: "US Dollar / Singapore Dollar", category: "Forex" },
  { symbol: "FX:USDNOK", title: "USD/NOK", desc: "US Dollar / Norwegian Krone", category: "Forex" },
  { symbol: "FX:USDSEK", title: "USD/SEK", desc: "US Dollar / Swedish Krona", category: "Forex" },
  { symbol: "FX_IDC:USDINR", title: "USD/INR", desc: "US Dollar / Indian Rupee", category: "Forex" },
  { symbol: "FX:USDZAR", title: "USD/ZAR", desc: "US Dollar / South African Rand", category: "Forex" },
  { symbol: "FX:USDMXN", title: "USD/MXN", desc: "US Dollar / Mexican Peso", category: "Forex" },
  { symbol: "FX_IDC:USDBRL", title: "USD/BRL", desc: "US Dollar / Brazilian Real", category: "Forex" },
  { symbol: "FX:USDTRY", title: "USD/TRY", desc: "US Dollar / Turkish Lira", category: "Forex" },
  { symbol: "FX_IDC:USDPLN", title: "USD/PLN", desc: "US Dollar / Polish Zloty", category: "Forex" },

  // --- Commodities: Precious Metals (Spot/CFD) ---
  { symbol: "OANDA:XAUUSD", title: "Gold Spot", desc: "Gold Spot / USD", category: "Commodities" },
  { symbol: "OANDA:XAGUSD", title: "Silver Spot", desc: "Silver Spot / USD", category: "Commodities" },
  { symbol: "OANDA:XPTUSD", title: "Platinum Spot", desc: "Platinum Spot / USD", category: "Commodities" },
  { symbol: "OANDA:XPDUSD", title: "Palladium Spot", desc: "Palladium Spot / USD", category: "Commodities" },

  // --- Commodities: Agri/Soft (Spot/CFD) ---
  { symbol: "CORN", title: "Corn", desc: "Corn Cash Contract", category: "Commodities" },
  { symbol: "OANDA:CORNUSD", title: "Corn / USD", desc: "Corn CFD (OANDA)", category: "Commodities" },
  { symbol: "OANDA:WHEATUSD", title: "Wheat", desc: "Wheat / USD (OANDA)", category: "Commodities" },
  { symbol: "OANDA:SUGARUSD", title: "Sugar", desc: "Sugar / USD (OANDA)", category: "Commodities" },
  { symbol: "FOREXCOM:COFFEE", title: "Coffee", desc: "Coffee C CFD", category: "Commodities" },

  // --- Energy: Spot/CFD & ETFs ---
  { symbol: "TVC:USOIL", title: "WTI Crude", desc: "WTI Crude Oil (CFD)", category: "Energy" },
  { symbol: "TVC:UKOIL", title: "Brent Crude", desc: "Brent Crude Oil (CFD)", category: "Energy" },
  { symbol: "OANDA:NATGASUSD", title: "Natural Gas", desc: "Natural Gas (CFD)", category: "Energy" },
  { symbol: "AMEX:USO", title: "USO", desc: "United States Oil Fund LP", category: "Energy" },
  { symbol: "AMEX:UNG", title: "UNG", desc: "United States Natural Gas Fund", category: "Energy" },
  { symbol: "AMEX:XLE", title: "XLE", desc: "Energy Select Sector SPDR", category: "Energy" },
  { symbol: "AMEX:XOP", title: "XOP", desc: "Oil & Gas E&P ETF", category: "Energy" },
  { symbol: "NASDAQ:ICLN", title: "ICLN", desc: "Global Clean Energy ETF", category: "Energy" },
  { symbol: "AMEX:DBC", title: "DBC", desc: "Invesco DB Commodity Index", category: "Energy" },

  // --- Major Global Indices (CFD) ---
  { symbol: "FOREXCOM:SPX500", title: "US500 (S&P)", desc: "S&P 500 CFD", category: "Indices" },
  { symbol: "FOREXCOM:US30", title: "US30 (Dow)", desc: "Dow Jones CFD", category: "Indices" },
  { symbol: "FOREXCOM:NAS100", title: "US100 (Nasdaq)", desc: "Nasdaq 100 CFD", category: "Indices" },
  { symbol: "FX:GER30", title: "GER30 (DAX)", desc: "Germany DAX 30 CFD", category: "Indices" },
  { symbol: "OANDA:UK100GBP", title: "UK100 (FTSE)", desc: "UK FTSE 100 CFD", category: "Indices" },
  { symbol: "FOREXCOM:EU50", title: "EU50 (Stoxx)", desc: "Euro Stoxx 50 CFD", category: "Indices" },
  { symbol: "FOREXCOM:JP225", title: "JP225 (Nikkei)", desc: "Japan Nikkei 225 CFD", category: "Indices" },
  { symbol: "FOREXCOM:HK50", title: "HK50 (Hang Seng)", desc: "Hong Kong 50 CFD", category: "Indices" },
  { symbol: "FOREXCOM:AUS200", title: "AUS200 (ASX)", desc: "Australia 200 CFD", category: "Indices" },

  // --- Core ETFs (Spot) ---
  { symbol: "AMEX:SPY", title: "SPY", desc: "SPDR S&P 500 ETF", category: "ETFs" },
  { symbol: "NASDAQ:QQQ", title: "QQQ", desc: "Invesco QQQ Trust", category: "ETFs" },
  { symbol: "NASDAQ:TQQQ", title: "TQQQ", desc: "3x Long Nasdaq-100", category: "ETFs" },
  { symbol: "NASDAQ:SQQQ", title: "SQQQ", desc: "3x Short Nasdaq-100", category: "ETFs" },
  { symbol: "AMEX:IWM", title: "IWM", desc: "iShares Russell 2000", category: "ETFs" },
  { symbol: "AMEX:VOO", title: "VOO", desc: "Vanguard S&P 500", category: "ETFs" },
  { symbol: "AMEX:IVV", title: "IVV", desc: "iShares Core S&P 500", category: "ETFs" },
  { symbol: "AMEX:GLD", title: "GLD", desc: "SPDR Gold Shares", category: "ETFs" },
];
