import { useEffect, useRef } from "react";

export function TickerTape() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      "symbols": [
        { "proName": "FOREXCOM:SPX500", "title": "S&P 500" },
        { "proName": "FOREXCOM:NAS100", "title": "Nasdaq 100" },
        { "proName": "FOREXCOM:US30", "title": "Dow 30" },
        { "proName": "FOREXCOM:JP225", "title": "Nikkei 225" },
        { "proName": "OANDA:XAUUSD", "title": "Gold" },
        { "proName": "OANDA:XAGUSD", "title": "Silver" },
        { "proName": "AMEX:SPY", "title": "SPY" },
        { "proName": "NASDAQ:QQQ", "title": "QQQ" },
        { "proName": "NASDAQ:TQQQ", "title": "TQQQ" },
        { "proName": "NASDAQ:SQQQ", "title": "SQQQ" },
        { "proName": "TVC:USOIL", "title": "WTI Oil" },
        { "proName": "TVC:UKOIL", "title": "Brent Oil" },
        { "proName": "OANDA:NATGASUSD", "title": "Nat Gas" },
        { "proName": "BINANCE:BTCUSDT", "title": "Bitcoin" },
        { "proName": "BINANCE:ETHUSDT", "title": "Ethereum" },
        { "proName": "BINANCE:SOLUSDT", "title": "Solana" },
        { "proName": "FX:GBPUSD", "title": "GBP/USD" },
        { "proName": "FX:EURUSD", "title": "EUR/USD" },
        { "proName": "NASDAQ:NVDA", "title": "NVIDIA" },
        { "proName": "NASDAQ:GOOGL", "title": "Alphabet" },
        { "proName": "NASDAQ:QCOM", "title": "Qualcomm" },
        { "proName": "NASDAQ:ASML", "title": "ASML" },
        { "proName": "NYSE:TSM", "title": "TSMC" },
        { "proName": "NASDAQ:NFLX", "title": "Netflix" },
        { "proName": "NASDAQ:AMD", "title": "AMD" },
        { "proName": "NASDAQ:HOOD", "title": "Robinhood" }
      ],
      "showSymbolLogo": true,
      "colorTheme": "dark",
      "isTransparent": false,
      "displayMode": "adaptive",
      "locale": "en"
    });

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(script);
  }, []);

  return (
    <div className="ticker-container w-full h-[72px] mb-8 rounded-lg overflow-hidden border border-border/50 bg-card shadow-sm">
      <div className="tradingview-widget-container" ref={containerRef}>
        <div className="tradingview-widget-container__widget"></div>
      </div>
    </div>
  );
}
