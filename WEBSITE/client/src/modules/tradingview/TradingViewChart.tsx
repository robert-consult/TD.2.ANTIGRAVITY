import { useEffect, useRef, useState } from "react";

interface TradingViewChartProps {
  symbol: string;
}

export function TradingViewChart({ symbol }: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const containerId = `tv_chart_${symbol.replace(/[^a-zA-Z0-9]/g, '_')}`;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadScript = (): Promise<void> => {
      return new Promise((resolve) => {
        if ((window as any).TradingView) {
          setScriptLoaded(true);
          resolve();
          return;
        }
        
        const existingScript = document.querySelector('script[src="https://s3.tradingview.com/tv.js"]');
        if (existingScript) {
          existingScript.addEventListener('load', () => {
            setScriptLoaded(true);
            resolve();
          });
          if ((window as any).TradingView) {
            setScriptLoaded(true);
            resolve();
          }
          return;
        }

        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/tv.js";
        script.async = true;
        script.onload = () => {
          setScriptLoaded(true);
          resolve();
        };
        document.head.appendChild(script);
      });
    };

    loadScript();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!scriptLoaded) return;
    if (!containerRef.current) return;
    if (!(window as any).TradingView) return;

    if (widgetRef.current) {
      try {
        if (containerRef.current) {
          containerRef.current.innerHTML = '';
        }
      } catch (e) {
        console.warn('Error cleaning up TradingView widget:', e);
      }
      widgetRef.current = null;
    }

    const widgetContainer = document.createElement('div');
    widgetContainer.id = containerId;
    widgetContainer.style.width = '100%';
    widgetContainer.style.height = '100%';
    containerRef.current.appendChild(widgetContainer);

    try {
      widgetRef.current = new (window as any).TradingView.widget({
        width: "100%",
        height: "100%",
        symbol: symbol,
        interval: "D",
        timezone: "Etc/UTC",
        theme: "dark",
        style: "1",
        locale: "en",
        enable_publishing: false,
        allow_symbol_change: true,
        container_id: containerId,
        hide_side_toolbar: false,
        studies: [
          "MASimple@tv-basicstudies",
          "RSI@tv-basicstudies"
        ]
      });
    } catch (e) {
      console.error('Error creating TradingView widget:', e);
    }

    return () => {
      if (widgetRef.current) {
        try {
          if (containerRef.current) {
            containerRef.current.innerHTML = '';
          }
        } catch (e) {
          console.warn('Error cleaning up TradingView widget on unmount:', e);
        }
        widgetRef.current = null;
      }
    };
  }, [symbol, scriptLoaded, containerId]);

  return (
    <div 
      ref={containerRef}
      className="w-full h-full min-h-[600px] bg-card rounded-lg overflow-hidden" 
    />
  );
}
