import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldHintLabel, TRADE_SETTINGS_FIELD_HELP } from "./AdminDashboardSupport";

type Props = any;

export function AdminTradeSettingsTab(props: Props) {
  const { riskParams, handleRiskParamChange, globalSettingsMutation, isCapitalSettingsChanged, isCapitalSettingsSaving, handleSaveCapitalSettings, isMarketHoursChanged, isMarketHoursSaving, handleSaveMarketHoursSettings, isDefaultRiskParametersChanged, isDefaultRiskSaving, handleSaveDefaultRiskSettings, isOperationalRiskAndLotSettingsChanged, isOperationalRiskAndLotSaving, handleSaveOperationalRiskAndLotSettings } = props;
  return (
            <TabsContent value="trades" className="p-4">
              <h2 className="text-xl font-semibold mb-4">Trade Settings</h2>
              <p className="text-gray-400">Configure global trade parameters, risk management, and trading hours.</p>
              <p className="text-xs text-gray-400 mt-2">
                All times are UTC, percentages are whole numbers (10 = 10%), and monetary values are in USD.
              </p>

              {/* This would be populated with trade settings controls */}
              <TooltipProvider delayDuration={120}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="col-span-1 md:col-span-2 rounded-md border border-cyan-900/60 bg-cyan-950/20 p-3">
                    <p className="text-sm text-cyan-100">
                      Each field includes a hidden <span className="font-medium">Hint</span> explainer with deeper behavior details, guardrail impact, and operational cautions.
                    </p>
                  </div>
                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base text-cyan-300">Default Capital Settings</CardTitle>
                        <p className="text-xs text-gray-400">
                          Global defaults used for new user account capital and challenge virtual capital.
                        </p>
                      </div>
                      {isCapitalSettingsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveCapitalSettings}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {isCapitalSettingsSaving ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <FieldHintLabel
                            label="Default User Starting Balance (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultUserStartingBalanceUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultUserStartingBalanceUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultUserStartingBalanceUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Starting cash balance assigned when a new user account is created</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Default User Starting Equity (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultUserStartingEquityUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultUserStartingEquityUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultUserStartingEquityUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Opening equity baseline used for new user account risk calculations</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Default Challenge Virtual Capital (USD)"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultChallengeVirtualCapitalUsd}
                          />
                          <Input
                            type="number"
                            min={1}
                            value={riskParams.defaultChallengeVirtualCapitalUsd}
                            onChange={(e) =>
                              handleRiskParamChange("defaultChallengeVirtualCapitalUsd", Math.max(1, Number(e.target.value) || 1))
                            }
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Prefilled virtual capital for new challenge drafts unless overridden</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600">
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base">Market Hours (UTC)</CardTitle>
                        <p className="text-xs text-gray-400">Configure trading hours in UTC timezone</p>
                      </div>
                      {isMarketHoursChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveMarketHoursSettings}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {isMarketHoursSaving ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <FieldHintLabel
                              label="Opening Time (UTC)"
                              hint={TRADE_SETTINGS_FIELD_HELP.marketOpenTime}
                            />
                            <Input
                              type="time"
                              value={riskParams.marketOpenTime}
                              onChange={(e) => handleRiskParamChange('marketOpenTime', e.target.value)}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">First UTC time when opening new trades is allowed</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Closing Time (UTC)"
                              hint={TRADE_SETTINGS_FIELD_HELP.marketCloseTime}
                            />
                            <Input
                              type="time"
                              value={riskParams.marketCloseTime}
                              onChange={(e) => handleRiskParamChange('marketCloseTime', e.target.value)}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Last UTC time when opening new trades is allowed</p>
                          </div>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id="weekend"
                              checked={riskParams.allowWeekendTrading}
                              onCheckedChange={(checked: any) => handleRiskParamChange('allowWeekendTrading', Boolean(checked))}
                            />
                            <Label htmlFor="weekend">Allow weekend trading</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Allow weekend trading hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.allowWeekendTrading}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When disabled, opening new trades is restricted to weekdays</p>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600">
                    <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <CardTitle className="text-sm sm:text-base min-w-0">Default Risk Parameters</CardTitle>
                      {isDefaultRiskParametersChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveDefaultRiskSettings}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {isDefaultRiskSaving ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        <div>
                          <FieldHintLabel
                            label="Default Leverage"
                            hint={TRADE_SETTINGS_FIELD_HELP.defaultLeverage}
                          />
                          <Input
                            type="number"
                            value={riskParams.defaultLeverage}
                            onChange={(e) => handleRiskParamChange('defaultLeverage', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Default leverage applied to new accounts unless an override is set</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Max Position Size"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxPositionSize}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxPositionSize}
                            onChange={(e) => handleRiskParamChange('maxPositionSize', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Largest size allowed for a single open position</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Trades Per User"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxTradesPerUser}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxTradesPerUser}
                            onChange={(e) => handleRiskParamChange('maxTradesPerUser', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per user</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Trades Per Instrument"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxTradesPerInstrument}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxTradesPerInstrument}
                            onChange={(e) => handleRiskParamChange('maxTradesPerInstrument', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum number of concurrent trades allowed per instrument</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Maximum Concurrent Lots Per User"
                            hint={TRADE_SETTINGS_FIELD_HELP.maxConcurrentLots}
                          />
                          <Input
                            type="number"
                            value={riskParams.maxConcurrentLots}
                            onChange={(e) => handleRiskParamChange('maxConcurrentLots', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Maximum total lots allowed across all open trades per user</p>
                        </div>
                        <div>
                          <FieldHintLabel
                            label="Minimum Price Distance (pips)"
                            hint={TRADE_SETTINGS_FIELD_HELP.minPriceDistancePips}
                          />
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={riskParams.minPriceDistancePips}
                            onChange={(e) => handleRiskParamChange('minPriceDistancePips', Number(e.target.value))}
                            className="bg-neutral-600"
                          />
                          <p className="text-xs text-gray-400 mt-1">Minimum distance enforced for pending orders and TP/SL (open + edits)</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600">
                      <CardTitle className="text-sm sm:text-base text-green-400">Trade Auto-Close Settings and Minimum Hold Times</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="enableAutoClose"
                              checked={riskParams.enableAutoClose}
                              onCheckedChange={(checked) => handleRiskParamChange('enableAutoClose', checked)}
                            />
                            <Label htmlFor="enableAutoClose" className="text-sm">Enable auto-close for trades</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Enable auto-close for trades hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.enableAutoClose}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When enabled, eligible open trades are closed after the configured hold period</p>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Auto-close after (days)"
                              hint={TRADE_SETTINGS_FIELD_HELP.autoCloseAfterDays}
                            />
                            <Input
                              type="number"
                              value={riskParams.autoCloseAfterDays}
                              onChange={(e) => handleRiskParamChange('autoCloseAfterDays', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Trades will auto-close after this many days</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Check frequency (minutes)"
                              hint={TRADE_SETTINGS_FIELD_HELP.autoCloseCheckFrequencyMinutes}
                            />
                            <Input
                              type="number"
                              value={riskParams.autoCloseCheckFrequencyMinutes}
                              onChange={(e) => handleRiskParamChange('autoCloseCheckFrequencyMinutes', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">How often the system checks for trades to close</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Minimum Hold Time (seconds)"
                              hint={TRADE_SETTINGS_FIELD_HELP.minHoldSec}
                            />
                            <Input
                              type="number"
                              value={riskParams.minHoldSec}
                              onChange={(e) => handleRiskParamChange('minHoldSec', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Global default - users can have overrides</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600">
                      <CardTitle className="text-sm sm:text-base text-orange-400">Loss Limit Controls</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-4">
                        <div className="flex items-center justify-between gap-2 mb-4">
                          <div className="flex items-center space-x-2">
                            <Switch
                              id="enableLossLimits"
                              checked={riskParams.enableLossLimits}
                              onCheckedChange={(checked) => handleRiskParamChange('enableLossLimits', checked)}
                            />
                            <Label htmlFor="enableLossLimits" className="text-sm">Enable loss limit protection</Label>
                          </div>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                aria-label="Enable loss limit protection hint"
                              >
                                Hint
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                              {TRADE_SETTINGS_FIELD_HELP.enableLossLimits}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        <p className="text-xs text-gray-400 mt-1">When enabled, trading is constrained if daily or lifetime loss thresholds are exceeded</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Daily Loss Limit (%)"
                              hint={TRADE_SETTINGS_FIELD_HELP.dailyLossLimitPct}
                            />
                            <Input
                              type="number"
                              value={riskParams.dailyLossLimitPct}
                              onChange={(e) => handleRiskParamChange('dailyLossLimitPct', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum daily loss as percentage of initial balance</p>
                          </div>
                          <div>
                            <FieldHintLabel
                              label="Lifetime Loss Limit (%)"
                              hint={TRADE_SETTINGS_FIELD_HELP.lifetimeLossLimitPct}
                            />
                            <Input
                              type="number"
                              value={riskParams.lifetimeLossLimitPct}
                              onChange={(e) => handleRiskParamChange('lifetimeLossLimitPct', Number(e.target.value))}
                              className="bg-neutral-600"
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum lifetime loss before account is disabled</p>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-neutral-700 border-gray-600 col-span-1 md:col-span-2">
                    <CardHeader className="border-b border-gray-600 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="min-w-0">
                        <CardTitle className="text-sm sm:text-base text-purple-400">Visual Lot Settings</CardTitle>
                        <p className="text-xs text-gray-400">Configure lot preset quick-select cards and dropdown maximum for the trader order form</p>
                      </div>
                      {isOperationalRiskAndLotSettingsChanged && (
                        <Button
                          size="sm"
                          onClick={handleSaveOperationalRiskAndLotSettings}
                          disabled={globalSettingsMutation.isPending}
                          className="shrink-0 w-full sm:w-auto text-xs sm:text-sm"
                        >
                          {isOperationalRiskAndLotSaving ? "Saving..." : "Save"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="pt-4">
                      <div className="space-y-6">
                        {/* Preset Cards Editor */}
                        <div>
                          <FieldHintLabel
                            label="Lot Preset Cards"
                            hint={TRADE_SETTINGS_FIELD_HELP.lotPresetCards}
                          />
                          <p className="text-xs text-gray-400 mb-3">Quick-select buttons shown to traders on the order form</p>
                          <p className="text-xs text-gray-400 mb-3">Each value is a lot-size shortcut and should stay within the dropdown maximum</p>
                          <div className="flex flex-wrap gap-2 mb-3">
                            {(() => {
                              try {
                                const presets: number[] = JSON.parse(riskParams.lotPresetCards || "[]");
                                return presets.map((value, index) => (
                                  <div key={index} className="flex items-center gap-1 bg-neutral-600 rounded-md px-2 py-1">
                                    <Input
                                      type="number"
                                      value={value}
                                      onChange={(e) => {
                                        const newValue = parseInt(e.target.value) || 1;
                                        const maxAllowed = Math.min(50, riskParams.lotDropdownMax || 50);
                                        const updated = [...presets];
                                        updated[index] = Math.max(1, Math.min(maxAllowed, newValue));
                                        handleRiskParamChange('lotPresetCards', JSON.stringify(updated));
                                      }}
                                      className="w-16 h-7 text-xs bg-neutral-700 border-gray-500 text-center"
                                      min={1}
                                      max={Math.min(50, riskParams.lotDropdownMax || 50)}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const updated = presets.filter((_, i) => i !== index);
                                        handleRiskParamChange('lotPresetCards', JSON.stringify(updated));
                                      }}
                                      className="text-gray-400 hover:text-red-400 px-1"
                                    >
                                      ×
                                    </button>
                                  </div>
                                ));
                              } catch {
                                return <span className="text-red-400 text-xs">Invalid preset data</span>;
                              }
                            })()}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                try {
                                  const presets: number[] = JSON.parse(riskParams.lotPresetCards || "[]");
                                  const maxAllowed = Math.min(50, riskParams.lotDropdownMax || 50);
                                  const newValue = presets.length > 0 ? Math.min((presets[presets.length - 1] || 1) * 2, maxAllowed) : 1;
                                  handleRiskParamChange('lotPresetCards', JSON.stringify([...presets, newValue]));
                                } catch {
                                  handleRiskParamChange('lotPresetCards', JSON.stringify([1]));
                                }
                              }}
                              className="h-7 text-xs bg-neutral-600 hover:bg-neutral-500"
                            >
                              + Add
                            </Button>
                          </div>
                        </div>

                        {/* Dropdown Max */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <FieldHintLabel
                              label="Dropdown Maximum Lots"
                              hint={TRADE_SETTINGS_FIELD_HELP.lotDropdownMax}
                            />
                            <Input
                              type="number"
                              value={riskParams.lotDropdownMax}
                              onChange={(e) => handleRiskParamChange('lotDropdownMax', Math.max(1, Math.min(50, Number(e.target.value) || 50)))}
                              className="bg-neutral-600"
                              min={1}
                              max={50}
                            />
                            <p className="text-xs text-gray-400 mt-1">Maximum lot value shown in the dropdown selector (1-50)</p>
                          </div>
                          <div className="flex items-end">
                            <div className="w-full p-3 bg-neutral-800 rounded-md border border-gray-600">
                              <p className="text-xs text-gray-400 mb-2">Preview (dropdown options):</p>
                              <div className="flex flex-wrap gap-1 text-xs">
                                {(() => {
                                  const max = riskParams.lotDropdownMax || 50;
                                  const options = Array.from({ length: Math.min(max, 50) }, (_v, i) => i + 1);
                                  return options.slice(0, 12).map(n => (
                                    <span key={n} className="px-1.5 py-0.5 bg-neutral-700 rounded">{n}</span>
                                  ));
                                })()}
                                {riskParams.lotDropdownMax > 12 && <span className="text-gray-500">...</span>}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                </div>
              </TooltipProvider>
            </TabsContent>

  );
}
