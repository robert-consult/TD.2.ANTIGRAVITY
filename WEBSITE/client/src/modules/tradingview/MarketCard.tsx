import { motion } from "framer-motion";
import { ArrowUpRight, BarChart2 } from "lucide-react";

interface MarketCardProps {
  symbol: string;
  title: string;
  desc: string;
  onOpen: (symbol: string) => void;
}

export function MarketCard({ symbol, title, desc, onOpen }: MarketCardProps) {
  return (
    <motion.div
      whileHover={{ y: -5 }}
      whileTap={{ scale: 0.98 }}
      onClick={() => onOpen(symbol)}
      className="group cursor-pointer bg-card hover:bg-[#4265FC]/5 border border-border/50 hover:border-[#4265FC] p-6 rounded-xl transition-all duration-300 flex flex-col items-center justify-center text-center shadow-sm hover:shadow-[0_0_20px_rgba(66,101,252,0.3)] relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#4265FC]/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative z-10">
        <div className="flex items-center justify-center w-12 h-12 mb-4 rounded-full bg-[#4265FC]/10 text-[#4265FC] group-hover:bg-[#4265FC] group-hover:text-white transition-colors duration-300">
          <BarChart2 className="w-6 h-6" />
        </div>
        
        <h3 className="text-2xl font-bold mb-2 tracking-tight text-foreground group-hover:text-[#4265FC] transition-colors">
          {title}
        </h3>
        <p className="text-sm text-muted-foreground mb-6 font-medium">
          {desc}
        </p>
        
        <button className="inline-flex items-center gap-2 px-4 py-2 bg-secondary/50 border border-border/50 text-foreground group-hover:bg-[#4265FC] group-hover:text-white group-hover:border-[#4265FC] rounded-md text-sm font-medium transition-colors duration-200">
          View Chart
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>
    </motion.div>
  );
}
