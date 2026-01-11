import { useEffect, useRef } from "react";

interface MiniDonutProps {
  value: number;
  label: string;
  size?: number;
  strokeWidth?: number;
  format?: (val: number) => string;
}

export default function MiniDonut({
  value,
  label,
  size = 120,
  strokeWidth = 10,
  format = (val) => `${Math.round(val * 100)}%`,
}: MiniDonutProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Ensure value is between 0 and 1
  const normalizedValue = Math.max(0, Math.min(1, value));
  
  // Calculate dimensions
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - normalizedValue);
  const center = size / 2;
  
  // Color based on value (gradient from red to yellow to green)
  const getColor = (val: number) => {
    if (val < 0.5) {
      // Red to yellow gradient (0-50%)
      return `hsl(${val * 120}, 100%, 50%)`;
    } else {
      // Yellow to green gradient (50-100%)
      return `hsl(${60 + (val - 0.5) * 120}, 100%, 45%)`;
    }
  };
  
  // Animation effect
  useEffect(() => {
    if (!svgRef.current) return;
    
    const circle = svgRef.current.querySelector('.progress-ring__circle');
    if (!circle) return;
    
    const animateCircle = () => {
      (circle as SVGCircleElement).style.strokeDashoffset = String(strokeDashoffset);
      (circle as SVGCircleElement).style.stroke = getColor(normalizedValue);
    };
    
    // Animate with a slight delay for visual effect
    const timer = setTimeout(() => {
      animateCircle();
    }, 100);
    
    return () => clearTimeout(timer);
  }, [normalizedValue, strokeDashoffset]);
  
  return (
    <div className="flex flex-col items-center">
      <div className="relative">
        <svg 
          ref={svgRef}
          width={size} 
          height={size} 
          viewBox={`0 0 ${size} ${size}`}
          className="transform -rotate-90"
        >
          {/* Background circle */}
          <circle
            className="progress-ring__background"
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
          />
          
          {/* Progress circle */}
          <circle
            className="progress-ring__circle"
            cx={center}
            cy={center}
            r={radius}
            fill="transparent"
            stroke={getColor(normalizedValue)}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference}
            style={{
              transition: 'stroke-dashoffset 1s ease-in-out, stroke 1s ease-in-out'
            }}
          />
        </svg>
        
        {/* Value in center */}
        <div 
          className="absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{ transform: 'rotate(90deg)' }}
        >
          <span className="text-lg font-bold">{format(normalizedValue)}</span>
        </div>
      </div>
      
      <span className="mt-2 text-sm text-muted-foreground">{label}</span>
    </div>
  );
}