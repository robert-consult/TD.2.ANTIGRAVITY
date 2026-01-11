import React from "react";

export default function SpreadBadge({ spread }: { spread: string }) {
  // Determine color based on spread value
  // For TradeQuip Phase-2, using a consistent style for all spreads
  return (
    <span className="px-2 py-0.5 rounded bg-gray-700 text-xs font-semibold text-white">
      {spread}
    </span>
  );
}