import type { UseFormReturn } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  MARKET_TIME_IN_FORCE_VALUES,
  PENDING_TIME_IN_FORCE_VALUES,
} from "@shared/trading/timeInForce";

export const tradeFormSchema = z.object({
  lots: z.string().refine(
    (val) => !isNaN(Number(val)) && Number(val) >= 1 && Number(val) <= 50 && Number.isInteger(Number(val)),
    {
      message: "Lots must be a whole number between 1 and 50",
    },
  ),
  takeProfit: z.string().optional(),
  stopLoss: z.string().optional(),
  limitPrice: z.string().optional(),
  stopPrice: z.string().optional(),
  timeInForce: z.string().optional(),
  expiresAt: z.string().optional(),
});

export type TradeFormValues = z.infer<typeof tradeFormSchema>;

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

export const toastTemplates = {
  orderPlaced: { text: "Successfully placed a {side} order for {symbol}" },
  tradeExecutedTitle: { text: "Trade Executed" },
  tradeErrorTitle: { text: "Trade Error" },
  missingTradeInfo: { text: "Missing required trade information" },
  marketPriceMissing: { text: "Current price is not available for market order" },
  limitPriceMissing: { text: "Please enter a valid limit price" },
  stopPriceMissing: { text: "Please enter a valid stop price" },
  invalidOrderType: { text: "Invalid order type" },
};

const pendingBuyButtonClass =
  "!border-lime-400 !bg-lime-500 hover:!bg-lime-600 !text-black font-bold";
const pendingSellButtonClass =
  "!border-orange-400 !bg-orange-500 hover:!bg-orange-600 !text-white font-bold";
const pendingInactiveButtonClass =
  "border-gray-700 bg-neutral-900 text-gray-400 hover:bg-neutral-800 hover:text-gray-200";

export const formatTemplate = (template: string, vars: Record<string, string | number | boolean | null | undefined>) =>
  template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key: string) => {
    const value = vars?.[key];
    return value === null || value === undefined ? "" : String(value);
  });

export function getSideLabel(side: unknown): string {
  const key = String(side ?? "").trim().toUpperCase();
  if (!key) return "—";
  return sideLabels[key]?.label ?? key;
}

export function getOrderTypeLabel(type: unknown): string {
  const raw = String(type ?? "").trim();
  if (!raw) return orderTypeLabels.unknown.label;
  const key = raw.toLowerCase();
  return orderTypeLabels[key]?.label ?? raw;
}

export function getPendingOrderLabel(side: "BUY" | "SELL", type: unknown): string {
  const sideKey = String(side ?? "").trim().toUpperCase();
  const typeKey = String(type ?? "").trim().toLowerCase();
  const direct = pendingOrderLabels[sideKey]?.[typeKey]?.label;
  if (direct) return direct;
  const sideLabel = getSideLabel(sideKey);
  const typeLabel = getOrderTypeLabel(typeKey);
  return `${sideLabel} ${typeLabel}`.trim();
}

interface TradeOrderTabProps {
  form: UseFormReturn<TradeFormValues>;
  onSubmit: (values: TradeFormValues) => void;
  orderType: string;
  setOrderType: (nextOrderType: string) => void;
  pendingSide: "BUY" | "SELL";
  setPendingSide: (nextPendingSide: "BUY" | "SELL") => void;
  timeInForceValue: string;
  lotDropdownOptions: Array<number | string>;
  lotPresetCards: Array<number | string>;
  handleLotsPreset: (lots: string) => void;
  priceDecimals: number;
  currentPrice?: number;
  setAutoEntry: (value: boolean) => void;
  setAutoTp: (value: boolean) => void;
  setAutoSl: (value: boolean) => void;
}

export function TradeOrderTab({
  form,
  onSubmit,
  orderType,
  setOrderType,
  pendingSide,
  setPendingSide,
  timeInForceValue,
  lotDropdownOptions,
  lotPresetCards,
  handleLotsPreset,
  priceDecimals,
  currentPrice,
  setAutoEntry,
  setAutoTp,
  setAutoSl,
}: TradeOrderTabProps) {
  return (
    <TabsContent value="place-order" className="p-0 m-0 flex-1 min-h-0">
      <div className="flex flex-col lg:flex-row h-full min-h-0">
        <div className="w-full flex flex-col h-full min-h-0">
          <div className="p-4 flex-1 flex flex-col min-h-0">
            <Form {...form}>
              <form id="trade-order-form" onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col flex-1">
                <div className="space-y-5">
                  <div className="space-y-2">
                    <FormLabel>Order Type</FormLabel>
                    <div className="flex space-x-2">
                      <Button
                        type="button"
                        variant={orderType === "Market" ? "default" : "outline"}
                        className={`flex-1 py-2 px-4 ${orderType === "Market"
                          ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                          : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                          }`}
                        onClick={() => setOrderType("Market")}
                      >
                        {getOrderTypeLabel("Market")}
                      </Button>
                      <Button
                        type="button"
                        variant={orderType === "Limit" ? "default" : "outline"}
                        className={`flex-1 py-2 px-4 ${orderType === "Limit"
                          ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                          : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                          }`}
                        onClick={() => setOrderType("Limit")}
                      >
                        {getOrderTypeLabel("Limit")}
                      </Button>
                      <Button
                        type="button"
                        variant={orderType === "Stop" ? "default" : "outline"}
                        className={`flex-1 py-2 px-4 ${orderType === "Stop"
                          ? "bg-sky-600 hover:bg-sky-700 border border-sky-500 text-white font-medium"
                          : "bg-neutral-900 border border-gray-800 text-gray-400 hover:bg-neutral-800"
                          }`}
                        onClick={() => setOrderType("Stop")}
                      >
                        {getOrderTypeLabel("Stop")}
                      </Button>
                    </div>
                  </div>

                  {orderType !== "Market" && (
                    <div className="flex gap-2 my-3">
                      <Button
                        type="button"
                        variant="outline"
                        className={`flex-1 py-2 ${
                          pendingSide === "BUY" ? pendingBuyButtonClass : pendingInactiveButtonClass
                        }`}
                        onClick={() => setPendingSide("BUY")}
                      >
                        {getPendingOrderLabel("BUY", orderType)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className={`flex-1 py-2 ${
                          pendingSide === "SELL" ? pendingSellButtonClass : pendingInactiveButtonClass
                        }`}
                        onClick={() => setPendingSide("SELL")}
                      >
                        {getPendingOrderLabel("SELL", orderType)}
                      </Button>
                    </div>
                  )}

                  <FormField
                    control={form.control}
                    name="timeInForce"
                    render={({ field }) => {
                      const allowedTimeInForce =
                        orderType === "Market" ? MARKET_TIME_IN_FORCE_VALUES : PENDING_TIME_IN_FORCE_VALUES;
                      return (
                        <FormItem>
                          <FormLabel>Time In Force</FormLabel>
                          <Select value={field.value ?? "GTC"} onValueChange={field.onChange}>
                            <FormControl>
                              <SelectTrigger className="bg-neutral-900 border-gray-700 text-white">
                                <SelectValue placeholder="Select duration" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {allowedTimeInForce.map((value) => (
                                <SelectItem key={value} value={value}>
                                  {value}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-gray-400">
                            {orderType === "Market"
                              ? "IOC/FOK are accepted for immediate fills; pending-only expiries are hidden here."
                              : "DAY expires at the end of the UTC day. GTD expires at the time you choose below."}
                          </p>
                        </FormItem>
                      );
                    }}
                  />

                  {orderType !== "Market" && timeInForceValue === "GTD" && (
                    <FormField
                      control={form.control}
                      name="expiresAt"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Good Till</FormLabel>
                          <FormControl>
                            <Input
                              type="datetime-local"
                              value={field.value ?? ""}
                              onChange={field.onChange}
                              className="bg-neutral-900 border-gray-700 text-white"
                            />
                          </FormControl>
                        </FormItem>
                      )}
                    />
                  )}

                  <FormField
                    control={form.control}
                    name="lots"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position Size (Lots)</FormLabel>
                        <div className="relative">
                          <Select value={field.value?.toString() || "1"} onValueChange={(value) => field.onChange(value)}>
                            <FormControl>
                              <SelectTrigger className="w-full py-2 pl-3 pr-12 bg-neutral-800 border border-gray-700 rounded-md text-white">
                                <SelectValue placeholder="1" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent
                              className="w-[4.75rem] min-w-[4.75rem] overflow-y-auto bg-neutral-900 border-gray-700"
                              style={{ maxHeight: "clamp(6.75rem, calc(100dvh - 24rem), 18rem)" }}
                            >
                              {lotDropdownOptions.map((lot) => (
                                <SelectItem
                                  key={lot}
                                  value={lot.toString()}
                                  className="h-9 text-sm text-white hover:bg-neutral-800"
                                >
                                  {lot}
                                </SelectItem>
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
                        <div className="mt-2 flex flex-wrap gap-1.5 sm:gap-2">
                          {lotPresetCards.map((preset) => {
                            const value = preset.toString();
                            return (
                              <Button
                                key={value}
                                type="button"
                                variant="outline"
                                className={`h-9 px-1.5 text-[0.7rem] sm:text-xs leading-none grow shrink basis-[18%] sm:basis-[31%] ${field.value === value
                                  ? "bg-primary-800 text-white font-medium"
                                  : "bg-neutral-800 text-gray-300"
                                  }`}
                                onClick={() => handleLotsPreset(value)}
                              >
                                {value}
                              </Button>
                            );
                          })}
                        </div>
                      </FormItem>
                    )}
                  />

                  {orderType === "Limit" && (
                    <FormField
                      control={form.control}
                      name="limitPrice"
                      render={({ field }) => (
                        <FormItem className="mb-5">
                          <FormLabel>Limit Price</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                {...field}
                                onFocus={() => setAutoEntry(false)}
                                onBlur={() => setAutoEntry(false)}
                                className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                placeholder={currentPrice ? currentPrice.toFixed(priceDecimals) : "0.0000"}
                              />
                            </FormControl>
                          </div>
                        </FormItem>
                      )}
                    />
                  )}

                  {orderType === "Stop" && (
                    <FormField
                      control={form.control}
                      name="stopPrice"
                      render={({ field }) => (
                        <FormItem className="mb-5">
                          <FormLabel>Stop Price</FormLabel>
                          <div className="relative">
                            <FormControl>
                              <Input
                                {...field}
                                onFocus={() => setAutoEntry(false)}
                                onBlur={() => setAutoEntry(false)}
                                className="w-full py-2 pl-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400"
                                placeholder={currentPrice ? currentPrice.toFixed(priceDecimals) : "0.0000"}
                              />
                            </FormControl>
                          </div>
                        </FormItem>
                      )}
                    />
                  )}

                  <div className="space-y-2">
                    <FormLabel>Take Profit / Stop Loss</FormLabel>
                    <div
                      className="grid gap-3"
                      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(16rem, 100%), 1fr))" }}
                    >
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
                                  className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary"
                                  placeholder={currentPrice ? (currentPrice + currentPrice * 0.01).toFixed(priceDecimals) : "0.00"}
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
                                  className="w-full py-2 pl-10 pr-3 bg-neutral-800 border border-gray-700 rounded-md text-white placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-primary"
                                  placeholder={currentPrice ? (currentPrice - currentPrice * 0.01).toFixed(priceDecimals) : "0.00"}
                                />
                              </FormControl>
                            </div>
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>
                </div>
              </form>
            </Form>
          </div>
        </div>
      </div>
    </TabsContent>
  );
}

interface TradeActionBarProps {
  activeTab: string;
  orderType: string;
  pendingSide: "BUY" | "SELL";
  currentPrice?: number;
  executeTradePending: boolean;
  tradeDirection: "BUY" | "SELL" | null;
  setTradeDirection: (direction: "BUY" | "SELL") => void;
  form: UseFormReturn<TradeFormValues>;
  bidPrice?: number;
  askPrice?: number;
  priceDecimals: number;
}

export function TradeActionBar({
  activeTab,
  orderType,
  pendingSide,
  currentPrice,
  executeTradePending,
  tradeDirection,
  setTradeDirection,
  form,
  bidPrice,
  askPrice,
  priceDecimals,
}: TradeActionBarProps) {
  if (activeTab !== "place-order") return null;

  return (
    <div
      className="tq-trade-action-bar shrink-0 border-t border-gray-800 bg-neutral-900 px-3 sm:px-gutter"
      style={{
        paddingTop: "clamp(0.5rem, 1cqi, 0.75rem)",
        paddingBottom: "calc(env(safe-area-inset-bottom) + clamp(0.5rem, 1cqi, 0.75rem))",
      }}
    >
      {orderType !== "Market" ? (
        <Button
          type="submit"
          form="trade-order-form"
          variant="outline"
          className={`w-full py-3 px-4 shadow-md transition-all ${
            pendingSide === "BUY" ? pendingBuyButtonClass : pendingSellButtonClass
          }`}
          disabled={executeTradePending || !currentPrice}
          onClick={() => setTradeDirection(pendingSide)}
        >
          {executeTradePending ? (
            <div className="animate-spin mr-2 h-4 w-4 border-t-2 rounded-full inline-block"></div>
          ) : null}
          Place {getPendingOrderLabel(pendingSide, orderType)}
          {(() => {
            const entryPrice = orderType === "Limit" ? form.getValues("limitPrice") : form.getValues("stopPrice");
            return entryPrice ? <span className="text-xs block">@ {entryPrice}</span> : null;
          })()}
        </Button>
      ) : (
        <div className="flex gap-3">
          <Button
            type="submit"
            form="trade-order-form"
            className="btn-sell flex-1 min-w-0 py-3 px-4 text-white font-bold bg-orange-500 hover:bg-orange-600 shadow-md transition-all uppercase"
            disabled={executeTradePending || !currentPrice}
            onClick={() => setTradeDirection("SELL")}
          >
            {executeTradePending && tradeDirection === "SELL" ? (
              <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-white rounded-full"></div>
            ) : null}
            {getSideLabel("SELL")}
            {bidPrice && <span className="text-xs block">@ {bidPrice.toFixed(priceDecimals)}</span>}
          </Button>
          <Button
            type="submit"
            form="trade-order-form"
            className="btn-buy flex-1 min-w-0 py-3 px-4 text-black font-bold bg-lime-500 hover:bg-lime-600 shadow-md transition-all uppercase"
            disabled={executeTradePending || !currentPrice}
            onClick={() => setTradeDirection("BUY")}
          >
            {executeTradePending && tradeDirection === "BUY" ? (
              <div className="animate-spin mr-2 h-4 w-4 border-t-2 border-black rounded-full"></div>
            ) : null}
            {getSideLabel("BUY")}
            {askPrice && <span className="text-xs block">@ {askPrice.toFixed(priceDecimals)}</span>}
          </Button>
        </div>
      )}
    </div>
  );
}
