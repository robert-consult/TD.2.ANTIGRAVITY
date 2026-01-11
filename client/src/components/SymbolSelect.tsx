import { useCallback } from "react";
import AsyncSelect from "react-select/async";
import { fetchWithIdentity } from "../lib/fetchWithIdentity";

interface Option {
  label: string;
  value: string;
  base: string;
  quote: string;
  displayName: string;
}

type Props = {
  onSelected: (opt: Option) => void;
  defaultSymbol?: string;
};

export default function SymbolSelect({ onSelected, defaultSymbol }: Props) {
  const loadOptions = useCallback(async (input: string) => {
    const resp = await fetchWithIdentity(`/api/instruments?search=${input}`);
    const data = await resp.json();
    return data.map((i: any) => ({
      label: `${i.symbol} · ${i.displayName}`,
      value: i.symbol,
      base: i.base,
      quote: i.quote,
      displayName: i.displayName,
    }));
  }, []);

  return (
    <AsyncSelect
      cacheOptions
      defaultOptions
      defaultInputValue={defaultSymbol}
      loadOptions={loadOptions}
      placeholder="Start typing a symbol…"
      onChange={(opt) => opt && onSelected(opt as Option)}
      styles={{
        container: (s) => ({ ...s, flex: 1 }),
        menu: (s) => ({ ...s, zIndex: 5 }),
        control: (s) => ({ ...s, backgroundColor: 'var(--background)', borderColor: 'var(--border)' }),
        option: (s, { isFocused, isSelected }) => ({
          ...s,
          backgroundColor: isSelected 
            ? 'var(--primary)' 
            : isFocused 
              ? 'var(--accent)' 
              : 'var(--background)',
          color: isSelected ? 'white' : 'var(--foreground)'
        }),
        singleValue: (s) => ({ ...s, color: 'var(--foreground)' }),
        input: (s) => ({ ...s, color: 'var(--foreground)' }),
      }}
    />
  );
}
