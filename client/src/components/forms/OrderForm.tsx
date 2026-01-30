import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap, Layers, AlertTriangle } from "lucide-react";
import { useLotSettings } from "@/hooks/use-lot-settings";

// --- Schema Definitions ---
export const tradeFormSchema = z.object({
    lots: z.string().refine(
        (val) => !isNaN(Number(val)) && Number(val) >= 1 && Number(val) <= 50 && Number.isInteger(Number(val)), {
        message: "Lots must be a whole number between 1 and 50",
    }),
    takeProfit: z.string().optional(),
    stopLoss: z.string().optional(),
    limitPrice: z.string().optional(),
    stopPrice: z.string().optional(),
});

export type TradeFormValues = z.infer<typeof tradeFormSchema>;

interface OrderFormProps {
    selectedSymbol: string;
    currentPrice?: number;
    // We pass bid/ask specifically if available, else standard price usage
    bidPrice?: number;
    askPrice?: number;
    onPlaceOrder: (values: TradeFormValues, type: string, direction: "BUY" | "SELL") => void;
    isSubmitting?: boolean;
}

export function OrderForm({
    selectedSymbol,
    currentPrice,
    bidPrice,
    askPrice,
    onPlaceOrder,
    isSubmitting = false
}: OrderFormProps) {
    const [orderType, setOrderType] = useState<string>("Market");
    // For pending orders, we need to know the intended side ahead of time
    const [pendingSide, setPendingSide] = useState<"BUY" | "SELL">("BUY");
    // Direction for market orders is determined at submission time (by which button is clicked)
    const [marketDirection, setMarketDirection] = useState<"BUY" | "SELL" | null>(null);

    const [autoEntry, setAutoEntry] = useState(true);
    const [autoTp, setAutoTp] = useState(true);
    const [autoSl, setAutoSl] = useState(true);

    const { lotDropdownOptions, lotPresetCards } = useLotSettings();
    const lotPresets = useMemo(() => lotPresetCards.map(String), [lotPresetCards]);

    const form = useForm<TradeFormValues>({
        resolver: zodResolver(tradeFormSchema),
        defaultValues: {
            lots: "1",
            takeProfit: "",
            stopLoss: "",
            limitPrice: "",
            stopPrice: "",
        },
    });

    // Reset form when symbol changes
    useEffect(() => {
        form.reset({
            lots: "1",
            takeProfit: "",
            stopLoss: "",
            limitPrice: "",
            stopPrice: "",
        });
    }, [selectedSymbol, form]);

    // Reset auto-tracking when order type or pendingSide changes
    useEffect(() => {
        setAutoEntry(true);
        setAutoTp(true);
        setAutoSl(true);
    }, [orderType, pendingSide]);

    // Auto-suggest logic
    useEffect(() => {
        if (orderType === "Market" || !currentPrice) return;
        // Fallback to currentPrice if bid/ask not explicitly provided
        const baseAsk = askPrice ?? currentPrice;
        const baseBid = bidPrice ?? currentPrice;

        const pip = selectedSymbol.includes("JPY") ? 0.01 : 0.0001;
        const decimals = selectedSymbol.includes("JPY") ? 3 : 5;

        if (orderType === "Limit" && autoEntry) {
            // Buy Limit is placed BELOW price, Sell Limit ABOVE
            const price = pendingSide === "BUY" ? (baseAsk - 10 * pip) : (baseBid + 10 * pip);
            form.setValue("limitPrice", price.toFixed(decimals));
        }
        if (orderType === "Stop" && autoEntry) {
            // Buy Stop is placed ABOVE price, Sell Stop BELOW
            const price = pendingSide === "BUY" ? (baseAsk + 10 * pip) : (baseBid - 10 * pip);
            form.setValue("stopPrice", price.toFixed(decimals));
        }

        // TP/SL logic based on entry
        // If Market, entry is current. If Pending, entry is the form value.
        let entryForCalc = currentPrice;
        if (orderType !== "Market") {
            const entryStr = orderType === "Limit" ? form.getValues("limitPrice") : form.getValues("stopPrice");
            entryForCalc = parseFloat(entryStr || "0");
        }

        if (entryForCalc && entryForCalc > 0) {
            if (autoTp) {
                // TP is always beneficial direction
                const tp = pendingSide === "BUY" ? entryForCalc + 10 * pip : entryForCalc - 10 * pip;
                form.setValue("takeProfit", tp.toFixed(decimals));
            }
            if (autoSl) {
                // SL is always detrimental direction
                const sl = pendingSide === "BUY" ? entryForCalc - 10 * pip : entryForCalc + 10 * pip;
                form.setValue("stopLoss", sl.toFixed(decimals));
            }
        }
    }, [askPrice, bidPrice, currentPrice, orderType, pendingSide, autoEntry, autoTp, autoSl, selectedSymbol, form]);

    // Helper Labels
    const sideLabels: Record<string, { label: string }> = {
        BUY: { label: "Buy" },
        SELL: { label: "Sell" },
    };
    const orderTypeLabels: Record<string, { label: string }> = {
        market: { label: "Market" },
        limit: { label: "Limit" },
        stop: { label: "Stop" },
        unknown: { label: "Unknown" },
    };
    const pendingOrderLabels: Record<string, Record<string, { label: string }>> = {
        BUY: {
            limit: { label: "Buy Limit" },
            stop: { label: "Buy Stop" },
        },
        SELL: {
            limit: { label: "Sell Limit" },
            stop: { label: "Sell Stop" },
        },
    };

    const getSideLabel = (side: string) => sideLabels[side]?.label ?? side;
    const getOrderTypeLabel = (type: string) => orderTypeLabels[type.toLowerCase()]?.label ?? type;
    const getPendingOrderLabel = (side: "BUY" | "SELL", type: string) => {
        return pendingOrderLabels[side][type.toLowerCase()]?.label ?? `${getSideLabel(side)} ${getOrderTypeLabel(type)}`;
    }

    const handleLotsPreset = (lots: string) => {
        form.setValue("lots", lots, { shouldValidate: true, shouldDirty: true, shouldTouch: true });
    };

    const handleSubmit = (values: TradeFormValues) => {
        const direction = orderType === "Market" && marketDirection ? marketDirection : pendingSide;
        onPlaceOrder(values, orderType, direction);
    };

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-5">
                <div className="space-y-2">
                    <FormLabel>Order Type</FormLabel>
                    <div className="flex space-x-2">
                        {["Market", "Limit", "Stop"].map((type) => (
                            <Button
                                key={type}
                                type="button"
                                variant={orderType === type ? "default" : "outline"}
                                className={`flex-1 py-2 px-4 ${orderType === type
                                    ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                                    : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                                    }`}
                                onClick={() => setOrderType(type)}
                            >
                                {getOrderTypeLabel(type)}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* BUY/SELL side selector for Limit/Stop orders */}
                {orderType !== "Market" && (
                    <div className="flex gap-2 my-3">
                        <Button
                            type="button"
                            variant={pendingSide === "BUY" ? "default" : "outline"}
                            className={`flex-1 py-2 ${pendingSide === "BUY"
                                ? "bg-lime-600 hover:bg-lime-700 text-black font-bold"
                                : "bg-neutral-900 border border-gray-700 text-gray-400"
                                }`}
                            onClick={() => setPendingSide("BUY")}
                        >
                            {getPendingOrderLabel("BUY", orderType)}
                        </Button>
                        <Button
                            type="button"
                            variant={pendingSide === "SELL" ? "default" : "outline"}
                            className={`flex-1 py-2 ${pendingSide === "SELL"
                                ? "bg-orange-600 hover:bg-orange-700 text-white font-bold"
                                : "bg-neutral-900 border border-gray-700 text-gray-400"
                                }`}
                            onClick={() => setPendingSide("SELL")}
                        >
                            {getPendingOrderLabel("SELL", orderType)}
                        </Button>
                    </div>
                )}

                <FormField
                    control={form.control}
                    name="lots"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Position Size (Lots)</FormLabel>
                            <div className="relative">
                                <Select
                                    value={field.value?.toString() || "1"}
                                    onValueChange={(value) => field.onChange(value)}
                                >
                                    <FormControl>
                                        <SelectTrigger className="w-full py-2 pl-3 pr-12 bg-neutral-800 border border-gray-700 rounded-md text-white">
                                            <SelectValue placeholder="1" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent className="max-h-[calc(8*2.25rem)] overflow-y-auto w-24 bg-neutral-900 border-gray-700">
                                        {lotDropdownOptions.map((num) => (
                                            <SelectItem key={num} value={num.toString()} className="text-white hover:bg-neutral-800">{num}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none">
                                    <span className="text-gray-400">Lots</span>
                                </div>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                                1 lot = $100,000 (${Number(field.value || 1) * 100000} total)
                            </div>
                            <div className="mt-2 grid grid-cols-3 sm:grid-cols-5 gap-2">
                                {lotPresets.map((preset) => (
                                    <Button
                                        key={preset}
                                        type="button"
                                        variant="outline"
                                        className={`py-1 px-2 text-xs ${field.value === preset
                                            ? "bg-primary-800 text-white font-medium"
                                            : "bg-neutral-800 text-gray-300"
                                            }`}
                                        onClick={() => handleLotsPreset(preset)}
                                    >
                                        {preset}
                                    </Button>
                                ))}
                            </div>
                        </FormItem>
                    )}
                />

                {/* Limit Price */}
                {orderType === "Limit" && (
                    <FormField
                        control={form.control}
                        name="limitPrice"
                        render={({ field }) => (
                            <FormItem className="mb-5">
                                <FormLabel>Limit Price</FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        onFocus={() => setAutoEntry(false)}
                                        onBlur={() => setAutoEntry(false)}
                                        className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                        placeholder={currentPrice ? currentPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4) : "0.0000"}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}

                {/* Stop Price */}
                {orderType === "Stop" && (
                    <FormField
                        control={form.control}
                        name="stopPrice"
                        render={({ field }) => (
                            <FormItem className="mb-5">
                                <FormLabel>Stop Price</FormLabel>
                                <FormControl>
                                    <Input
                                        {...field}
                                        onFocus={() => setAutoEntry(false)}
                                        onBlur={() => setAutoEntry(false)}
                                        className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                        placeholder={currentPrice ? currentPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4) : "0.0000"}
                                    />
                                </FormControl>
                            </FormItem>
                        )}
                    />
                )}

                <div className="space-y-2">
                    <FormLabel>Take Profit / Stop Loss</FormLabel>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <FormField
                            control={form.control}
                            name="takeProfit"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <span className="text-xs font-semibold text-success-500">TP</span>
                                        </div>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                onFocus={() => setAutoTp(false)}
                                                onBlur={() => setAutoTp(false)}
                                                className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                            />
                                        </FormControl>
                                    </div>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="stopLoss"
                            render={({ field }) => (
                                <FormItem>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                                            <span className="text-xs font-semibold text-danger-500">SL</span>
                                        </div>
                                        <FormControl>
                                            <Input
                                                {...field}
                                                onFocus={() => setAutoSl(false)}
                                                onBlur={() => setAutoSl(false)}
                                                className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                            />
                                        </FormControl>
                                    </div>
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="pt-3">
                    {orderType !== "Market" ? (
                        <Button
                            type="submit"
                            className={`w-full py-3 px-4 font-bold shadow-md transition-all ${pendingSide === "BUY"
                                ? "bg-lime-500 hover:bg-lime-600 text-black"
                                : "bg-orange-500 hover:bg-orange-600 text-white"
                                }`}
                            disabled={isSubmitting || !currentPrice}
                            onClick={() => {
                                // For pending orders, direction is predetermined
                            }}
                        >
                            {isSubmitting ? <div className="animate-spin mr-2 h-4 w-4 border-t-2 rounded-full inline-block"></div> : null}
                            Place {getPendingOrderLabel(pendingSide, orderType)}
                            {(() => {
                                const entryPrice = orderType === "Limit"
                                    ? form.getValues("limitPrice")
                                    : form.getValues("stopPrice");
                                return entryPrice ? (
                                    <span className="text-xs block">@ {entryPrice}</span>
                                ) : null;
                            })()}
                        </Button>
                    ) : (
                        <div className="flex space-x-3">
                            <Button
                                type="submit"
                                className="btn-sell flex-1 py-3 px-4 text-white font-bold bg-orange-500 hover:bg-orange-600 shadow-md transition-all uppercase"
                                disabled={isSubmitting || !currentPrice}
                                onClick={() => setMarketDirection("SELL")}
                            >
                                {isSubmitting && marketDirection === "SELL" ? (
                                    <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-white rounded-full"></div>
                                ) : null}
                                {getSideLabel("SELL")}
                                {bidPrice && (
                                    <span className="text-xs block">@ {bidPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                                )}
                            </Button>
                            <Button
                                type="submit"
                                className="btn-buy flex-1 py-3 px-4 text-black font-bold bg-lime-500 hover:bg-lime-600 shadow-md transition-all uppercase"
                                disabled={isSubmitting || !currentPrice}
                                onClick={() => setMarketDirection("BUY")}
                            >
                                {isSubmitting && marketDirection === "BUY" ? (
                                    <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-black rounded-full"></div>
                                ) : null}
                                {getSideLabel("BUY")}
                                {askPrice && (
                                    <span className="text-xs block">@ {askPrice.toFixed(selectedSymbol.includes("JPY") ? 2 : 4)}</span>
                                )}
                            </Button>
                        </div>
                    )}
                </div>
            </form>
        </Form>
    );
}
