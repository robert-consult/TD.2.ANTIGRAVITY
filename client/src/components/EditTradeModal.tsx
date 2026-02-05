import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useQuotes } from "@/hooks/use-quotes";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronUp, Check } from "lucide-react";
import { useTranslation } from "@/i18n";
import { ApiError, apiRequest } from "@/lib/queryClient";
import { useLotSettings } from "@/hooks/use-lot-settings";
import { getPipSize, getQuoteDecimals } from "@shared/pips";

const formatTemplate = (template: string, vars: Record<string, string | number | boolean | null | undefined>) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, key: string) => {
    const v = vars?.[key];
    return v === null || v === undefined ? "" : String(v);
  });

const schema = z.object({
  takeProfit: z.union([z.number(), z.nan()]).nullable().optional(),
  stopLoss: z.union([z.number(), z.nan()]).nullable().optional(),
});

type FormValues = z.infer<typeof schema>;

interface EditTradeModalProps {
  trade: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditTradeModal({ trade, open, onOpenChange }: EditTradeModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { quotes } = useQuotes();
  const { bundle } = useTranslation();
  const { minPriceDistancePips } = useLotSettings();
  const minPips = minPriceDistancePips;
  const autoFixPresets = useMemo(() => {
    const presets = [minPips, 50, 100, 150, 200];
    const seen = new Set<number>();
    const out: number[] = [];
    for (const p of presets) {
      if (!Number.isFinite(p) || p <= 0) continue;
      if (seen.has(p)) continue;
      seen.add(p);
      out.push(p);
    }
    return out;
  }, [minPips]);
  const [validationMessages, setValidationMessages] = useState<{ tp?: string; sl?: string }>({});
  const textTemplates = {
    priceLabelOrder: { text: "order price" },
    priceLabelCurrent: { text: "current price" },
    priceLabelOrderShort: { text: "Order" },
    priceLabelCurrentShort: { text: "Current" },
    pricePlaceholder: { text: "{label}: {price}" },
    tpAboveOrder: { text: "Take Profit must be at least {delta} ({pips} pips) above order price of {price}" },
    tpAboveCurrent: { text: "Take Profit must be at least {delta} ({pips} pips) above current price of {price}" },
    tpBelowOrder: { text: "Take Profit must be at least {delta} ({pips} pips) below order price of {price}" },
    tpBelowCurrent: { text: "Take Profit must be at least {delta} ({pips} pips) below current price of {price}" },
    slAboveOrder: { text: "Stop Loss must be at least {delta} ({pips} pips) above order price of {price}" },
    slAboveCurrent: { text: "Stop Loss must be at least {delta} ({pips} pips) above current price of {price}" },
    slBelowOrder: { text: "Stop Loss must be at least {delta} ({pips} pips) below order price of {price}" },
    slBelowCurrent: { text: "Stop Loss must be at least {delta} ({pips} pips) below current price of {price}" },
    targetsInvalidOrder: { text: "One or more targets are invalid relative to the order price." },
    targetsInvalidCurrent: { text: "One or more targets are invalid relative to the current price." },
    quickPresetsOrder: { text: "Quick presets: set TP/SL relative to the order price." },
    quickPresetsCurrent: { text: "Quick presets: set TP/SL relative to the current price." },
    presetAppliedTitle: { text: "TP/SL preset applied" },
    presetAppliedDescOrder: { text: "Set targets to ±{pips} pips from the order price." },
    presetAppliedDescCurrent: { text: "Set targets to ±{pips} pips from the current price." },
    applyPresetTitle: { text: "Apply TP/SL using the current preset (±{pips} pips)" },
    invalidTargetsError: { text: "Please correct the Take Profit and Stop Loss values according to the validation messages." },
    targetsUpdated: { text: "Trade targets updated successfully" },
    modalTitle: { text: "Edit Take Profit & Stop Loss" },
  };
  const sideLabels: Record<string, { label: string }> = {
    BUY: { label: "Buy" },
    SELL: { label: "Sell" },
  };

  const getSideLabel = (side: unknown) => {
    const key = String(side ?? "").trim().toUpperCase();
    if (!key) return "?";
    return sideLabels[key]?.label ?? key;
  };

  // Per-symbol preset persistence
  const getSymbolStorageKey = (t: any) => {
    const sid = t?.symbolId ?? t?.symbol_id;
    const sym = t?.symbol ?? t?.symbolName ?? t?.symbol_code;
    if (sid !== null && sid !== undefined && sid !== "") return `sid-${sid}`;
    if (typeof sym === 'string' && sym) return `sym-${sym.toUpperCase()}`;
    if (typeof sym === 'object' && sym?.symbol) return `sym-${String(sym.symbol).toUpperCase()}`;
    return "global";
  };

  const presetStorageKey = useMemo(() => {
    const symbolKey = getSymbolStorageKey(trade);
    return `tc3al:lastPresetPoints:${symbolKey}`;
  }, [trade?.symbolId, trade?.symbol, trade?.symbolName]);

  const skipNextSaveRef = useRef(false);
  const presetHydratedRef = useRef(false);
  const autoAppliedForTradeRef = useRef<number | null>(null);
  const [lastPresetPoints, setLastPresetPoints] = useState<number>(() => minPips);

  // Load preset whenever the symbol changes (hydrate from localStorage)
  useEffect(() => {
    if (typeof window === "undefined") return;
    presetHydratedRef.current = false;
    try {
      const raw = window.localStorage.getItem(presetStorageKey);
      const n = raw ? Number(raw) : minPips;
      const value = autoFixPresets.includes(n) ? n : minPips;
      skipNextSaveRef.current = true;
      setLastPresetPoints(value);
      presetHydratedRef.current = true;
    } catch {
      skipNextSaveRef.current = true;
      setLastPresetPoints(minPips);
      presetHydratedRef.current = true;
    }
  }, [autoFixPresets, minPips, presetStorageKey]);

  // Save preset whenever it changes (per-symbol)
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(presetStorageKey, String(lastPresetPoints));
    } catch {
      // ignore storage failures
    }
  }, [lastPresetPoints, presetStorageKey]);

  // Get current market price for this trade's symbol
  const getCurrentPrice = () => {
    const tradeSymbol =
      typeof trade.symbol === "string"
        ? trade.symbol
        : typeof trade.symbol === "object" && trade.symbol?.symbol
          ? trade.symbol.symbol
          : trade.symbolName || "";
    const quote = quotes.find((q) => q.symbol === tradeSymbol);

    // Server executions and triggers use BUY=bid and SELL=ask. Match that for validation UX.
    const side = String(trade.type ?? "").trim().toUpperCase();
    if (side === "BUY") return quote?.bid ?? quote?.price ?? trade.openPrice ?? 0;
    if (side === "SELL") return quote?.ask ?? quote?.price ?? trade.openPrice ?? 0;
    return quote?.price ?? trade.openPrice ?? 0;
  };

  // For pending orders, use the correct execution price based on order type
  // For active trades, use current market price
  const getReferencePrice = () => {
    if (trade.status === "PENDING") {
      const ot = String(trade.orderType ?? "").trim().toLowerCase();
      if (ot === "limit" && trade.limitPrice) return trade.limitPrice;
      if (ot === "stop" && trade.stopPrice) return trade.stopPrice;
      return trade.openPrice || 0;
    } else {
      // For active trades, use current market price
      return getCurrentPrice();
    }
  };

  const referencePrice = getReferencePrice();

  // Extract symbol string from various possible structures
  let tradeSymbol = '';
  if (typeof trade.symbol === 'string') {
    tradeSymbol = trade.symbol;
  } else if (typeof trade.symbol === 'object' && trade.symbol?.symbol) {
    tradeSymbol = trade.symbol.symbol;
  } else if (trade.symbolName) {
    tradeSymbol = trade.symbolName;
  }

  const tradeSymbolConfig =
    trade?.symbol && typeof trade.symbol === "object" ? trade.symbol : null;
  const pipCfg = useMemo(
    () => ({
      symbol: tradeSymbol,
      category: tradeSymbolConfig?.category,
      quoteCurrency: tradeSymbolConfig?.quoteCurrency,
      pipDecimals: tradeSymbolConfig?.pipDecimals,
      quoteDecimals: tradeSymbolConfig?.quoteDecimals,
    }),
    [
      tradeSymbol,
      tradeSymbolConfig?.category,
      tradeSymbolConfig?.quoteCurrency,
      tradeSymbolConfig?.pipDecimals,
      tradeSymbolConfig?.quoteDecimals,
    ],
  );
  const pipSize = getPipSize(pipCfg);
  const priceDecimals = getQuoteDecimals(pipCfg);
  const minDistance = minPips * pipSize; // Minimum distance (pips)

  // Safe formatted reference price (guards against undefined/NaN)
  const safeRefPrice = (referencePrice && Number.isFinite(referencePrice))
    ? referencePrice.toFixed(priceDecimals)
    : "—";
  const priceLabelShort = trade?.status === "PENDING"
    ? textTemplates.priceLabelOrderShort.text
    : textTemplates.priceLabelCurrentShort.text;
  const pricePlaceholder = formatTemplate(textTemplates.pricePlaceholder.text, {
    label: priceLabelShort,
    price: safeRefPrice,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      takeProfit: trade?.takeProfit || undefined,
      stopLoss: trade?.stopLoss || undefined,
    },
  });

  // Validation function for TP/SL placement (minimum minPips pips)
  const validateTPSL = (takeProfit: number | null, stopLoss: number | null) => {
    const messages: { tp?: string; sl?: string } = {};

    // Guard against invalid referencePrice
    if (!referencePrice || referencePrice <= 0) {
      setValidationMessages({});
      return true;
    }

    const isPending = trade.status === "PENDING";
    const tpAboveTemplate = isPending ? textTemplates.tpAboveOrder.text : textTemplates.tpAboveCurrent.text;
    const tpBelowTemplate = isPending ? textTemplates.tpBelowOrder.text : textTemplates.tpBelowCurrent.text;
    const slAboveTemplate = isPending ? textTemplates.slAboveOrder.text : textTemplates.slAboveCurrent.text;
    const slBelowTemplate = isPending ? textTemplates.slBelowOrder.text : textTemplates.slBelowCurrent.text;
    const refPriceStr = referencePrice.toFixed(priceDecimals);
    const deltaText = minDistance.toFixed(priceDecimals);
    const pips = minPips;

    const tp = typeof takeProfit === "number" && Number.isFinite(takeProfit) ? takeProfit : null;
    const sl = typeof stopLoss === "number" && Number.isFinite(stopLoss) ? stopLoss : null;

    if (trade.type === 'BUY') {
      // BUY: TP >= ref + minDistance ; SL <= ref - minDistance
      if (sl !== null && sl > (referencePrice - minDistance)) {
        messages.sl = formatTemplate(slBelowTemplate, {
          delta: deltaText,
          pips,
          price: refPriceStr,
        });
      }
      if (tp !== null && tp < (referencePrice + minDistance)) {
        messages.tp = formatTemplate(tpAboveTemplate, {
          delta: deltaText,
          pips,
          price: refPriceStr,
        });
      }
    } else if (trade.type === 'SELL') {
      // SELL: TP <= ref - minDistance ; SL >= ref + minDistance
      if (sl !== null && sl < (referencePrice + minDistance)) {
        messages.sl = formatTemplate(slAboveTemplate, {
          delta: deltaText,
          pips,
          price: refPriceStr,
        });
      }
      if (tp !== null && tp > (referencePrice - minDistance)) {
        messages.tp = formatTemplate(tpBelowTemplate, {
          delta: deltaText,
          pips,
          price: refPriceStr,
        });
      }
    }

    setValidationMessages(messages);
    return Object.keys(messages).length === 0;
  };

  // Refresh validation messages when translations change
  useEffect(() => {
    if (!open) return;
    if (!referencePrice || referencePrice <= 0) return;
    const tpRaw = form.getValues("takeProfit");
    const slRaw = form.getValues("stopLoss");
    const tp = typeof tpRaw === "number" && Number.isFinite(tpRaw) ? tpRaw : null;
    const sl = typeof slRaw === "number" && Number.isFinite(slRaw) ? slRaw : null;
    validateTPSL(tp, sl);
  }, [bundle?.locale, open, referencePrice, trade?.type]);

  // Run validation immediately on modal open (only when referencePrice is valid)
  useEffect(() => {
    if (!referencePrice || referencePrice <= 0) return;
    const tp = typeof trade?.takeProfit === "number" && Number.isFinite(trade.takeProfit) ? trade.takeProfit : null;
    const sl = typeof trade?.stopLoss === "number" && Number.isFinite(trade.stopLoss) ? trade.stopLoss : null;
    validateTPSL(tp, sl);
  }, [trade?.id, referencePrice, trade?.type]);

  // Auto-fix function to set TP/SL at ±N pips from reference price
  // Always applies the selected preset values (unconditionally overwrites current values)
  const autoFixTargets = (points: number = minPips) => {
    if (!referencePrice || referencePrice <= 0) return;

    const decimals = priceDecimals;

    // Convert "pips" → price distance; enforce minimum minPips
    const requestedDistance = points * pipSize;
    const distance = Math.max(minDistance, requestedDistance);

    const newTP =
      trade.type === "BUY"
        ? Number((referencePrice + distance).toFixed(decimals))
        : Number((referencePrice - distance).toFixed(decimals));

    const newSL =
      trade.type === "BUY"
        ? Number((referencePrice - distance).toFixed(decimals))
        : Number((referencePrice + distance).toFixed(decimals));

    // Always apply the preset values
    form.setValue("takeProfit", newTP, { shouldDirty: true, shouldTouch: true });
    form.setValue("stopLoss", newSL, { shouldDirty: true, shouldTouch: true });

    validateTPSL(newTP, newSL);
  };

  // Toast helper for preset applied
  const presetDescTemplate = trade?.status === "PENDING"
    ? textTemplates.presetAppliedDescOrder.text
    : textTemplates.presetAppliedDescCurrent.text;
  const invalidTargetsText = trade?.status === "PENDING"
    ? textTemplates.targetsInvalidOrder.text
    : textTemplates.targetsInvalidCurrent.text;
  const quickPresetsText = trade?.status === "PENDING"
    ? textTemplates.quickPresetsOrder.text
    : textTemplates.quickPresetsCurrent.text;
  const toastPresetApplied = (pips: number) => {
    toast({
      title: textTemplates.presetAppliedTitle.text,
      description: formatTemplate(presetDescTemplate, { pips }),
    });
  };

  // Auto-apply stored preset when modal opens for a trade with no TP/SL set
  useEffect(() => {
    if (!open) return;
    if (!presetHydratedRef.current) return;
    if (!referencePrice || referencePrice <= 0) return;

    // Only auto-apply once per trade
    if (autoAppliedForTradeRef.current === trade.id) return;

    // Check if trade has no TP/SL set
    const hasTP = typeof trade.takeProfit === "number" && Number.isFinite(trade.takeProfit) && trade.takeProfit > 0;
    const hasSL = typeof trade.stopLoss === "number" && Number.isFinite(trade.stopLoss) && trade.stopLoss > 0;

    if (!hasTP && !hasSL) {
      // Auto-apply the stored preset
      autoAppliedForTradeRef.current = trade.id;
      autoFixTargets(lastPresetPoints);
    }
  }, [open, trade?.id, referencePrice, lastPresetPoints]);

  const updateTargets = useMutation({
    mutationFn: async (data: FormValues) => {
      // Validate before submitting
      if (!validateTPSL(data.takeProfit || null, data.stopLoss || null)) {
        throw new Error(textTemplates.invalidTargetsError.text);
      }

      const startedAt = Date.now();
      let backoffMs = 1000;
      const maxWaitMs = 15_000;

      while (true) {
        try {
          const response = await apiRequest("PATCH", `/api/trades/${trade.id}/targets`, {
            takeProfit: data.takeProfit || null,
            stopLoss: data.stopLoss || null,
          });
          return response.json();
        } catch (err) {
          if (err instanceof ApiError && err.code === "QUOTE_STALE_MODIFY") {
            if (Date.now() - startedAt >= maxWaitMs) throw err;
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            backoffMs = Math.min(2000, Math.round(backoffMs * 1.5));
            continue;
          }
          throw err;
        }
      }
    },
    onSuccess: () => {
      toast({
        title: "Success",
        description: textTemplates.targetsUpdated.text,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/open"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trades/pending"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update trade targets",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (data: FormValues) => {
    // Run validation on submit
    const isValid = validateTPSL(data.takeProfit || null, data.stopLoss || null);
    if (isValid) {
      updateTargets.mutate(data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{textTemplates.modalTitle.text}</DialogTitle>
          <DialogDescription>
            {trade.status === 'PENDING' ? 'Order price' : 'Current price'}: {safeRefPrice} | Trade: {getSideLabel(trade.type)} {trade.lots} lots {tradeSymbol}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="takeProfit" className="text-green-500">Take Profit</Label>
              <Input
                id="takeProfit"
                type="number"
                step="0.00001"
                placeholder={pricePlaceholder}
                className="placeholder:text-gray-400 border-2 border-green-500 focus:border-green-400 focus:ring-green-500/20 text-green-400"
                {...form.register("takeProfit", {
                  valueAsNumber: true,
                  onChange: (e) => {
                    const value = parseFloat(e.target.value) || null;
                    const currentSL = form.getValues('stopLoss') || null;
                    validateTPSL(value, currentSL);
                  }
                })}
              />
              {validationMessages.tp && (
                <p className="text-sm text-red-500 mt-1">{validationMessages.tp}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="stopLoss" className="text-red-500">Stop Loss</Label>
              <Input
                id="stopLoss"
                type="number"
                step="0.00001"
                placeholder={pricePlaceholder}
                className="placeholder:text-gray-400 border-2 border-red-500 focus:border-red-400 focus:ring-red-500/20 text-red-400"
                {...form.register("stopLoss", {
                  valueAsNumber: true,
                  onChange: (e) => {
                    const value = parseFloat(e.target.value) || null;
                    const currentTP = form.getValues('takeProfit') || null;
                    validateTPSL(currentTP, value);
                  }
                })}
              />
              {validationMessages.sl && (
                <p className="text-sm text-red-500 mt-1">{validationMessages.sl}</p>
              )}
            </div>
          </div>

          {/* Auto-Fix UI with drop-up preset selector (shows when validation errors exist) */}
          {Object.keys(validationMessages).length > 0 && (
            <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs sm:text-sm text-amber-200">{invalidTargetsText}</div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!referencePrice || referencePrice <= 0}
                  className="border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10"
                  onClick={() => {
                    autoFixTargets(lastPresetPoints);
                    toastPresetApplied(lastPresetPoints);
                  }}
                  title={formatTemplate(textTemplates.applyPresetTitle.text, {
                    pips: lastPresetPoints,
                  })}
                >
                  Auto-Fix (±{lastPresetPoints})
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!referencePrice || referencePrice <= 0}
                      className="gap-2"
                    >
                      Presets
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent side="top" align="end" className="w-44">
                    {autoFixPresets.map((p) => (
                      <DropdownMenuItem
                        key={p}
                        onSelect={() => {
                          setLastPresetPoints(p);
                          autoFixTargets(p);
                          toastPresetApplied(p);
                        }}
                        className="flex items-center justify-between"
                      >
                        <span>±{p}</span>
                        {p === lastPresetPoints ? <Check className="h-4 w-4 opacity-80" /> : <span className="h-4 w-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          {/* Quick presets when targets are already valid */}
          {Object.keys(validationMessages).length === 0 && (
            <div className="rounded-md border border-white/10 bg-white/5 p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="text-xs sm:text-sm text-gray-200">{quickPresetsText}</div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!referencePrice || referencePrice <= 0}
                  className="border-emerald-500/25 bg-emerald-500/5 hover:bg-emerald-500/10"
                  onClick={() => {
                    autoFixTargets(lastPresetPoints);
                    toastPresetApplied(lastPresetPoints);
                  }}
                  title={formatTemplate(textTemplates.applyPresetTitle.text, {
                    pips: lastPresetPoints,
                  })}
                >
                  Auto-Fix (±{lastPresetPoints})
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!referencePrice || referencePrice <= 0}
                      className="gap-2"
                    >
                      Presets
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent side="top" align="end" className="w-44">
                    {autoFixPresets.map((p) => (
                      <DropdownMenuItem
                        key={p}
                        onSelect={() => {
                          setLastPresetPoints(p);
                          autoFixTargets(p);
                          toastPresetApplied(p);
                        }}
                        className="flex items-center justify-between"
                      >
                        <span>±{p}</span>
                        {p === lastPresetPoints ? <Check className="h-4 w-4 opacity-80" /> : <span className="h-4 w-4" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          )}

          {/* Trading Rules Info */}
          <div className="bg-gray-50 dark:bg-gray-800 p-3 rounded-md text-xs sm:text-sm">
            <p className="font-medium mb-1 text-gray-900 dark:text-gray-100">Trading Rules:</p>
            {trade.type === 'BUY' ? (
              <>
                <p className="text-green-600 dark:text-green-400">• Take Profit must be above current price by {minPips}+ pips</p>
                <p className="text-red-600 dark:text-red-400">• Stop Loss must be below current price by {minPips}+ pips</p>
              </>
            ) : (
              <>
                <p className="text-green-600 dark:text-green-400">• Take Profit must be below current price by {minPips}+ pips</p>
                <p className="text-red-600 dark:text-red-400">• Stop Loss must be above current price by {minPips}+ pips</p>
              </>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 border-2 border-gray-400 bg-gray-700 hover:bg-gray-600 text-white font-semibold"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={updateTargets.isPending || Object.keys(validationMessages).length > 0}
              className="flex-1"
            >
              {updateTargets.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
