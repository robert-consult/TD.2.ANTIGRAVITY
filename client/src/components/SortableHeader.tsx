import React from "react";
import { ArrowUpDown } from "lucide-react";

interface SortableHeaderProps {
  label: string;
  field: string;
  currentSort?: string;
  direction?: 'asc' | 'desc';
  onSort?: (field: string) => void;
}

export default function SortableHeader({ 
  label, 
  field, 
  currentSort, 
  direction = 'asc',
  onSort 
}: SortableHeaderProps) {
  const isActive = currentSort === field;
  
  const handleClick = () => {
    if (onSort) {
      onSort(field);
    }
  };

  return (
    <th 
      className={`cursor-pointer hover:bg-gray-800 px-4 py-2 text-left ${isActive ? 'text-sky-400' : ''}`}
      onClick={handleClick}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={14} className={isActive ? 'opacity-100' : 'opacity-50'} />
      </div>
    </th>
  );
}