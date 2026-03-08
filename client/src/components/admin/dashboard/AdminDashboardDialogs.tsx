import SymbolSelect from "@/components/SymbolSelect";
import { InstrumentCatalogEnableDialog } from "@/components/admin/InstrumentCatalogEnableDialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FieldHintLabel, INSTRUMENTS_FIELD_HELP } from "./AdminDashboardSupport";

type Props = any;

export function AdminDashboardDialogs(props: Props) {
  const { editingUser, editDialogOpen, setEditDialogOpen, editForm, handleChange, globalSettingsData, setEditForm, handleSave, symbolDialogOpen, setSymbolDialogOpen, editingSymbol, handleSymbolChange, handleSymbolSave, symbolUpdateMutation, catalogEnableDialogOpen, setCatalogEnableDialogOpen, newSymbolDialogOpen, setNewSymbolDialogOpen, newSymbol, handleNewSymbolChange, handleNewSymbolSave, newSymbolMutation, deleteConfirmOpen, setDeleteConfirmOpen, handleDeleteSymbol, timelineDialogOpen, setTimelineDialogOpen, timelineUser, userTimeline, queueUserTimelineExport, freezeDialogOpen, setFreezeDialogOpen, freezeUser, freezeReason, setFreezeReason, freezeUserMutation, notesDialogOpen, setNotesDialogOpen, notesUser, newNote, setNewNote, addNoteMutation, userNotes, resolveNoteMutation } = props;
  return (
    <>
      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit User Settings: {editingUser?.email}</DialogTitle>
            <p className="text-xs text-blue-400 mt-1">User overrides take precedence and can exceed global limits</p>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6 py-4">
            <div className="space-y-4">
              <div>
                <Label htmlFor="leverage">Leverage</Label>
                <Input
                  id="leverage"
                  type="number"
                  value={editForm.leverage}
                  onChange={(e) => handleChange("leverage", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum leverage this user can use for trading</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrent">Max Concurrent Trades</Label>
                <Input
                  id="maxConcurrent"
                  type="number"
                  value={editForm.maxConcurrent}
                  onChange={(e) => handleChange("maxConcurrent", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum number of open positions allowed</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrentPerInstrument">Max Per Instrument (optional)</Label>
                <Input
                  id="maxConcurrentPerInstrument"
                  type="number"
                  value={editForm.maxConcurrentPerInstrument ?? ""}
                  onChange={(e) => handleChange("maxConcurrentPerInstrument", e.target.value === "" ? null : Number(e.target.value))}
                  className="bg-neutral-700"
                  placeholder="Use global default"
                />
                <p className="text-xs text-gray-400 mt-1">Leave blank to use global default</p>
              </div>

              <div>
                <Label htmlFor="maxConcurrentLots">Max Concurrent Lots</Label>
                <Input
                  id="maxConcurrentLots"
                  type="number"
                  value={editForm.maxConcurrentLots}
                  onChange={(e) => handleChange("maxConcurrentLots", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum total lots this user can have open at once</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="minHoldSec">Minimum Hold Time (seconds)</Label>
                <Input
                  id="minHoldSec"
                  type="number"
                  value={editForm.minHoldSec}
                  onChange={(e) => handleChange("minHoldSec", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Minimum time a position must be held before closing</p>
              </div>

              <div>
                <Label htmlFor="maxHoldSec">Maximum Hold Time (seconds)</Label>
                <Input
                  id="maxHoldSec"
                  type="number"
                  value={editForm.maxHoldSec}
                  onChange={(e) => handleChange("maxHoldSec", Number(e.target.value))}
                  className="bg-neutral-700"
                />
                <p className="text-xs text-gray-400 mt-1">Maximum time a position can be held before auto-closing</p>
              </div>
            </div>

            <div className="col-span-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="showOnLeaderboard"
                  checked={editForm.showOnLeaderboard}
                  onCheckedChange={(checked) => handleChange("showOnLeaderboard", Boolean(checked))}
                />
                <Label htmlFor="showOnLeaderboard">Show on Leaderboard</Label>
              </div>
              <p className="text-xs text-gray-400 mt-1">Whether this user's performance should be visible on the leaderboard</p>
            </div>
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="outline"
              onClick={() => {
                if (globalSettingsData) {
                  setEditForm((prev: any) => ({
                    ...prev,
                    leverage: globalSettingsData.defaultLeverage,
                    maxConcurrent: globalSettingsData.maxTradesPerUser,
                    maxConcurrentPerInstrument: null,
                    maxConcurrentLots: globalSettingsData.maxConcurrentLots,
                    minHoldSec: 60,
                    maxHoldSec: globalSettingsData.autoCloseAfterDays * 24 * 3600,
                  }));
                }
              }}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              Sync to Defaults
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button onClick={handleSave} className="bg-blue-600 hover:bg-blue-700">
                Save Changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Symbol Dialog */}
      <Dialog open={symbolDialogOpen} onOpenChange={setSymbolDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <TooltipProvider delayDuration={120}>
            <DialogHeader>
              <DialogTitle>Edit Trading Instrument: {editingSymbol?.symbol}</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mt-3">
              Symbol edits include hidden <span className="font-medium">Hint</span> explainers for pricing precision, lot guardrails, and live-trading impact.
            </div>

            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div>
                  <FieldHintLabel label="Symbol" hint={INSTRUMENTS_FIELD_HELP.symbol.tooltip} />
                  <div className="pt-1" title={INSTRUMENTS_FIELD_HELP.symbol.tooltip}>
                    <SymbolSelect
                      defaultSymbol={editingSymbol?.symbol || ''}
                      onSelected={(opt) => {
                        // Auto-fill all fields from the selected symbol
                        handleSymbolChange("symbol", opt.value);
                        handleSymbolChange("name", opt.displayName);
                        handleSymbolChange("baseCurrency", opt.base);
                        handleSymbolChange("quoteCurrency", opt.quote);
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.symbol.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Display Name" hint={INSTRUMENTS_FIELD_HELP.displayName.tooltip} />
                  <Input
                    id="name"
                    value={editingSymbol?.name || ''}
                    onChange={(e) => handleSymbolChange("name", e.target.value)}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.displayName.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.displayName.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Category" hint={INSTRUMENTS_FIELD_HELP.category.tooltip} />
                  <Select
                    value={editingSymbol?.category || ''}
                    onValueChange={(val) => handleSymbolChange("category", val)}
                  >
                    <SelectTrigger className="bg-neutral-700 mt-1" title={INSTRUMENTS_FIELD_HELP.category.tooltip}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-gray-700">
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="stocks">Stocks</SelectItem>
                      <SelectItem value="etf">ETFs</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="commodities">Commodities</SelectItem>
                      <SelectItem value="bonds">Bonds</SelectItem>
                      <SelectItem value="funds">Funds</SelectItem>
                      <SelectItem value="mutual_funds">Mutual Funds</SelectItem>
                      <SelectItem value="indices">Indices</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.category.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Minimum Spread (pips)" hint={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip} />
                  <Input
                    id="minSpreadPips"
                    type="number"
                    step="0.1"
                    value={editingSymbol?.minSpreadPips || 2}
                    onChange={(e) => handleSymbolChange("minSpreadPips", Number(e.target.value))}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minSpreadPips.inline}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Base Currency" hint={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip} />
                    <Input
                      id="baseCurrency"
                      value={editingSymbol?.baseCurrency || ''}
                      onChange={(e) => handleSymbolChange("baseCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.baseCurrency.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Currency" hint={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip} />
                    <Input
                      id="quoteCurrency"
                      value={editingSymbol?.quoteCurrency || ''}
                      onChange={(e) => handleSymbolChange("quoteCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteCurrency.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Pip Decimals" hint={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip} />
                    <Input
                      id="pipDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={editingSymbol?.pipDecimals ?? ""}
                      onChange={(e) =>
                        handleSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.pipDecimals.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Decimals" hint={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip} />
                    <Input
                      id="quoteDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={editingSymbol?.quoteDecimals ?? ""}
                      onChange={(e) =>
                        handleSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteDecimals.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Min Lot Size" hint={INSTRUMENTS_FIELD_HELP.minLot.tooltip} />
                    <Input
                      id="minLot"
                      type="number"
                      value={editingSymbol?.minLot || 1}
                      onChange={(e) => handleSymbolChange("minLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.minLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minLot.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Max Lot Size" hint={INSTRUMENTS_FIELD_HELP.maxLot.tooltip} />
                    <Input
                      id="maxLot"
                      type="number"
                      value={editingSymbol?.maxLot || 50}
                      onChange={(e) => handleSymbolChange("maxLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.maxLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.maxLot.inline}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-4">
                  <div>
                    <FieldHintLabel label="Enabled for Trading" hint={INSTRUMENTS_FIELD_HELP.enabled.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.enabled.inline}</p>
                  </div>
                  <Switch
                    id="enabled"
                    checked={editingSymbol?.enabled}
                    onCheckedChange={(checked) => handleSymbolChange("enabled", Boolean(checked))}
                    title={INSTRUMENTS_FIELD_HELP.enabled.tooltip}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setSymbolDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button
                onClick={handleSymbolSave}
                className="bg-blue-600 hover:bg-blue-700"
                disabled={symbolUpdateMutation.isPending}
              >
                {symbolUpdateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      <InstrumentCatalogEnableDialog open={catalogEnableDialogOpen} onOpenChange={setCatalogEnableDialogOpen} />

      {/* New Symbol Dialog */}
      <Dialog open={newSymbolDialogOpen} onOpenChange={setNewSymbolDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl">
          <TooltipProvider delayDuration={120}>
            <DialogHeader>
              <DialogTitle>Add New Trading Instrument</DialogTitle>
            </DialogHeader>
            <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mt-3">
              New symbol setup includes hidden <span className="font-medium">Hint</span> explainers for naming standards, precision controls, and exposure guardrails.
            </div>

            <div className="grid grid-cols-2 gap-6 py-4">
              <div className="space-y-4">
                <div>
                  <FieldHintLabel label="Symbol" hint={INSTRUMENTS_FIELD_HELP.symbol.tooltip} />
                  <div className="pt-1" title={INSTRUMENTS_FIELD_HELP.symbol.tooltip}>
                    <SymbolSelect
                      defaultSymbol={newSymbol.symbol || ''}
                      onSelected={(opt) => {
                        // Auto-fill all fields from the selected symbol
                        handleNewSymbolChange("symbol", opt.value);
                        handleNewSymbolChange("name", opt.displayName);
                        handleNewSymbolChange("baseCurrency", opt.base);
                        handleNewSymbolChange("quoteCurrency", opt.quote);
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.symbol.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Display Name" hint={INSTRUMENTS_FIELD_HELP.displayName.tooltip} />
                  <Input
                    id="new-name"
                    value={newSymbol.name}
                    onChange={(e) => handleNewSymbolChange("name", e.target.value)}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.displayName.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.displayName.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Category" hint={INSTRUMENTS_FIELD_HELP.category.tooltip} />
                  <Select
                    value={(newSymbol.category as string) || ''}
                    onValueChange={(val) => handleNewSymbolChange("category", val)}
                  >
                    <SelectTrigger className="bg-neutral-700 mt-1" title={INSTRUMENTS_FIELD_HELP.category.tooltip}>
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent className="bg-neutral-800 border-gray-700">
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="stocks">Stocks</SelectItem>
                      <SelectItem value="etf">ETFs</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="commodities">Commodities</SelectItem>
                      <SelectItem value="bonds">Bonds</SelectItem>
                      <SelectItem value="funds">Funds</SelectItem>
                      <SelectItem value="mutual_funds">Mutual Funds</SelectItem>
                      <SelectItem value="indices">Indices</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.category.inline}</p>
                </div>

                <div>
                  <FieldHintLabel label="Minimum Spread (pips)" hint={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip} />
                  <Input
                    id="new-minSpreadPips"
                    type="number"
                    step="0.1"
                    value={newSymbol.minSpreadPips}
                    onChange={(e) => handleNewSymbolChange("minSpreadPips", Number(e.target.value))}
                    className="bg-neutral-700 mt-1"
                    title={INSTRUMENTS_FIELD_HELP.minSpreadPips.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minSpreadPips.inline}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Base Currency" hint={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip} />
                    <Input
                      id="new-baseCurrency"
                      value={newSymbol.baseCurrency}
                      onChange={(e) => handleNewSymbolChange("baseCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.baseCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.baseCurrency.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Currency" hint={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip} />
                    <Input
                      id="new-quoteCurrency"
                      value={newSymbol.quoteCurrency}
                      onChange={(e) => handleNewSymbolChange("quoteCurrency", e.target.value)}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteCurrency.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteCurrency.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Pip Decimals" hint={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip} />
                    <Input
                      id="new-pipDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={newSymbol.pipDecimals ?? ""}
                      onChange={(e) =>
                        handleNewSymbolChange("pipDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.pipDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.pipDecimals.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Quote Decimals" hint={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip} />
                    <Input
                      id="new-quoteDecimals"
                      type="number"
                      min={0}
                      max={12}
                      value={newSymbol.quoteDecimals ?? ""}
                      onChange={(e) =>
                        handleNewSymbolChange("quoteDecimals", e.target.value === "" ? null : Number(e.target.value))
                      }
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.quoteDecimals.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.quoteDecimals.inline}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <FieldHintLabel label="Min Lot Size" hint={INSTRUMENTS_FIELD_HELP.minLot.tooltip} />
                    <Input
                      id="new-minLot"
                      type="number"
                      value={newSymbol.minLot}
                      onChange={(e) => handleNewSymbolChange("minLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.minLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.minLot.inline}</p>
                  </div>
                  <div>
                    <FieldHintLabel label="Max Lot Size" hint={INSTRUMENTS_FIELD_HELP.maxLot.tooltip} />
                    <Input
                      id="new-maxLot"
                      type="number"
                      value={newSymbol.maxLot}
                      onChange={(e) => handleNewSymbolChange("maxLot", Number(e.target.value))}
                      className="bg-neutral-700 mt-1"
                      title={INSTRUMENTS_FIELD_HELP.maxLot.tooltip}
                    />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.maxLot.inline}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-4">
                  <div>
                    <FieldHintLabel label="Enabled for Trading" hint={INSTRUMENTS_FIELD_HELP.enabled.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.enabled.inline}</p>
                  </div>
                  <Switch
                    id="new-enabled"
                    checked={newSymbol.enabled}
                    onCheckedChange={(checked) => handleNewSymbolChange("enabled", Boolean(checked))}
                    title={INSTRUMENTS_FIELD_HELP.enabled.tooltip}
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setNewSymbolDialogOpen(false)} className="bg-neutral-700">
                Cancel
              </Button>
              <Button
                onClick={handleNewSymbolSave}
                className="bg-green-600 hover:bg-green-700"
                disabled={newSymbolMutation.isPending}
              >
                {newSymbolMutation.isPending ? 'Creating...' : 'Create Instrument'}
              </Button>
            </DialogFooter>
          </TooltipProvider>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent className="bg-neutral-800 text-white border-gray-700">
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="text-gray-400">
              This will remove the trading instrument from the platform.
              Any open trades using this instrument will not be affected,
              but new trades cannot be opened.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="bg-neutral-700 text-white">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteSymbol}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* User Timeline Dialog - Vertical Timeline with Dots */}
      <Dialog open={timelineDialogOpen} onOpenChange={setTimelineDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-3xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Activity Timeline: {timelineUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto py-4 pl-4">
            {userTimeline.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No activity found</p>
            ) : (
              <div className="relative">
                {/* Vertical timeline line */}
                <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-gray-600"></div>

                {userTimeline.map((event: any, index: number) => {
                  const dotColor =
                    event.type === 'ACCOUNT_CREATED' ? 'bg-emerald-500' :
                      event.type === 'LOGIN' ? (event.description?.includes('Failed') ? 'bg-red-500' : 'bg-green-500') :
                        event.type === 'LOGOUT' ? 'bg-yellow-500' :
                          event.type === 'TRADE' || event.type === 'TRADE_OPENED' || event.type === 'TRADE_CLOSED' ? 'bg-blue-500' :
                            event.type === 'FREEZE' || event.type === 'UNFREEZE' ? 'bg-amber-500' :
                              event.type === 'STATUS_CHANGE' ? 'bg-purple-500' :
                                event.type === 'ADMIN_ACTION' ? 'bg-orange-500' :
                                  'bg-gray-400';

                  const formatSessionLength = (seconds: number | undefined) => {
                    if (!seconds) return 'Unknown';
                    const hours = Math.floor(seconds / 3600);
                    const mins = Math.floor((seconds % 3600) / 60);
                    const secs = seconds % 60;
                    if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
                    if (mins > 0) return `${mins}m ${secs}s`;
                    return `${secs}s`;
                  };

                  return (
                    <div key={event.id} className="relative pl-8 pb-6 last:pb-0">
                      {/* Timeline dot */}
                      <div className={`absolute left-0 top-1 w-4 h-4 rounded-full ${dotColor} border-2 border-neutral-800 z-10`}></div>

                      {/* Content card */}
                      <div className={`p-3 rounded-lg ${event.severity === 'HIGH' || event.severity === 'CRITICAL' ? 'bg-red-900/30 border border-red-600/50' :
                        event.severity === 'WARN' ? 'bg-amber-900/30 border border-amber-600/50' :
                          'bg-neutral-700/50'
                        }`}>
                        <div className="flex flex-wrap justify-between items-start gap-2 mb-1">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs px-2 py-0.5 rounded ${event.type === 'ACCOUNT_CREATED' ? 'bg-emerald-600' :
                              event.type === 'LOGIN' ? 'bg-green-600' :
                                event.type === 'LOGOUT' ? 'bg-yellow-600' :
                                  event.type === 'TRADE' || event.type === 'TRADE_OPENED' ? 'bg-blue-600' :
                                    event.type === 'TRADE_CLOSED' ? 'bg-indigo-600' :
                                      event.type === 'FREEZE' ? 'bg-amber-600' :
                                        event.type === 'UNFREEZE' ? 'bg-cyan-600' :
                                          event.type === 'STATUS_CHANGE' ? 'bg-purple-600' :
                                            event.type === 'ADMIN_ACTION' ? 'bg-orange-600' :
                                              'bg-gray-600'
                              }`}>{event.type === 'ACCOUNT_CREATED' ? 'CREATED' : event.type}</span>
                            <span className="font-medium text-sm">{event.title}</span>
                          </div>
                          <span className="text-xs text-gray-400">
                            {(() => {
                              if (!event.timestamp) return 'No date';
                              const ts = event.timestamp;
                              if (typeof ts === 'string') {
                                const d = new Date(ts);
                                return isNaN(d.getTime()) ? ts : d.toLocaleString();
                              }
                              if (typeof ts === 'number') {
                                const d = new Date(ts > 1e12 ? ts : ts * 1000);
                                return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                              }
                              return String(ts);
                            })()}
                          </span>
                        </div>
                        {event.description && (
                          <p className="text-sm text-gray-400">{event.description}</p>
                        )}
                        {event.reasonCode && (
                          <p className="text-xs text-amber-400 mt-1">Reason: {event.reasonCode}</p>
                        )}

                        {/* Login/Logout specific info */}
                        {event.type === 'LOGIN' && event.loginIp && (
                          <div className="mt-2 text-xs text-gray-500">
                            <span>IP: {event.loginIp}</span>
                          </div>
                        )}
                        {event.type === 'LOGOUT' && (
                          <div className="mt-2 text-xs text-gray-500 space-y-1">
                            {event.sessionLengthSec !== undefined && (
                              <div>Session Length: <span className="text-green-400">{formatSessionLength(event.sessionLengthSec)}</span></div>
                            )}
                            {event.loginIp && <div>IP: {event.loginIp}</div>}
                          </div>
                        )}

                        {/* Other metadata */}
                        {event.metadata && event.type !== 'LOGIN' && event.type !== 'LOGOUT' && (
                          <div className="mt-2 text-xs text-gray-500">
                            {event.metadata.ipAddress && <span className="mr-3">IP: {event.metadata.ipAddress}</span>}
                            {event.metadata.profit !== undefined && <span className="mr-3">P/L: ${Number(event.metadata.profit).toFixed(2)}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="csv"
              onClick={() => queueUserTimelineExport("csv")}
            >
              Export CSV
            </Button>
            <Button
              variant="jsonl"
              onClick={() => queueUserTimelineExport("jsonl")}
            >
              Export JSONL
            </Button>
            <Button
              variant="parquet"
              onClick={() => queueUserTimelineExport("parquet")}
            >
              Export Parquet
            </Button>
            <Button variant="outline" onClick={() => setTimelineDialogOpen(false)} className="bg-neutral-700">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Freeze User Dialog */}
      <Dialog open={freezeDialogOpen} onOpenChange={setFreezeDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700">
          <DialogHeader>
            <DialogTitle>Freeze Account: {freezeUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-gray-400 text-sm">
              Freezing an account will prevent the user from opening new trades.
              They will still be able to close existing positions.
            </p>
            <div>
              <Label htmlFor="freezeReasonCode">Reason Code</Label>
              <select
                id="freezeReasonCode"
                value={freezeReason.code}
                onChange={(e) => setFreezeReason((prev: any) => ({ ...prev, code: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 mt-1"
              >
                <option value="">Select a reason...</option>
                <option value="COMPLIANCE_REVIEW">Compliance Review</option>
                <option value="SUSPICIOUS_ACTIVITY">Suspicious Activity</option>
                <option value="KYC_REQUIRED">KYC Documentation Required</option>
                <option value="MARGIN_CALL">Margin Call - Risk Management</option>
                <option value="USER_REQUEST">User Requested</option>
                <option value="ADMIN_DISCRETION">Admin Discretion</option>
              </select>
            </div>
            <div>
              <Label htmlFor="freezeReasonText">Additional Notes (Optional)</Label>
              <textarea
                id="freezeReasonText"
                value={freezeReason.text}
                onChange={(e) => setFreezeReason((prev: any) => ({ ...prev, text: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 mt-1 h-20"
                placeholder="Add any additional details..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFreezeDialogOpen(false)} className="bg-neutral-700">
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (freezeUser && freezeReason.code) {
                  freezeUserMutation.mutate({
                    userId: freezeUser.id,
                    reasonCode: freezeReason.code,
                    reasonText: freezeReason.text || undefined,
                  });
                }
              }}
              disabled={!freezeReason.code || freezeUserMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {freezeUserMutation.isPending ? 'Freezing...' : 'Freeze Account'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* User Notes Dialog */}
      <Dialog open={notesDialogOpen} onOpenChange={setNotesDialogOpen}>
        <DialogContent className="bg-neutral-800 text-white border-gray-700 max-w-2xl max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Admin Notes: {notesUser?.email}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="border border-gray-600 rounded p-3">
              <div className="flex gap-2 mb-2">
                <select
                  value={newNote.type}
                  onChange={(e) => setNewNote((prev: any) => ({ ...prev, type: e.target.value as 'NOTE' | 'FLAG' }))}
                  className="p-2 rounded bg-neutral-700 border border-gray-600 text-sm"
                >
                  <option value="NOTE">Note</option>
                  <option value="FLAG">Flag</option>
                </select>
                <select
                  value={newNote.severity}
                  onChange={(e) => setNewNote((prev: any) => ({ ...prev, severity: e.target.value as any }))}
                  className="p-2 rounded bg-neutral-700 border border-gray-600 text-sm"
                >
                  <option value="INFO">Info</option>
                  <option value="WARN">Warning</option>
                  <option value="HIGH">High Priority</option>
                  <option value="CRITICAL">Critical</option>
                </select>
                {newNote.type === 'FLAG' && (
                  <Input
                    placeholder="Flag code (e.g. KYC_PENDING)"
                    value={newNote.flagCode}
                    onChange={(e) => setNewNote((prev: any) => ({ ...prev, flagCode: e.target.value }))}
                    className="bg-neutral-700 flex-1"
                  />
                )}
              </div>
              <textarea
                value={newNote.content}
                onChange={(e) => setNewNote((prev: any) => ({ ...prev, content: e.target.value }))}
                className="w-full p-2 rounded bg-neutral-700 border border-gray-600 h-16"
                placeholder="Add note content..."
              />
              <Button
                size="sm"
                onClick={() => {
                  if (notesUser && newNote.content.trim()) {
                    addNoteMutation.mutate({
                      userId: notesUser.id,
                      type: newNote.type,
                      severity: newNote.severity,
                      content: newNote.content,
                      flagCode: newNote.flagCode || undefined,
                    });
                  }
                }}
                disabled={!newNote.content.trim() || addNoteMutation.isPending}
                className="mt-2 bg-blue-600 hover:bg-blue-700"
              >
                {addNoteMutation.isPending ? 'Adding...' : 'Add Note'}
              </Button>
            </div>

            <div className="max-h-[40vh] overflow-y-auto space-y-2">
              {userNotes.length === 0 ? (
                <p className="text-gray-400 text-center py-4">No notes yet</p>
              ) : (
                userNotes.map((note: any) => (
                  <div
                    key={note.id}
                    className={`p-3 rounded border-l-4 ${note.isResolved ? 'opacity-50 border-gray-500 bg-neutral-700' :
                      note.severity === 'CRITICAL' ? 'border-red-500 bg-red-900/20' :
                        note.severity === 'HIGH' ? 'border-orange-500 bg-orange-900/20' :
                          note.severity === 'WARN' ? 'border-amber-500 bg-amber-900/20' :
                            'border-blue-500 bg-neutral-700'
                      }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="flex gap-2 items-center">
                        <span className={`text-xs px-2 py-0.5 rounded ${note.type === 'FLAG' ? 'bg-red-600' : 'bg-blue-600'}`}>
                          {note.type}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded bg-neutral-600">{note.severity}</span>
                        {note.flagCode && (
                          <span className="text-xs text-amber-400">{note.flagCode}</span>
                        )}
                      </div>
                      <span className="text-xs text-gray-400">
                        {new Date(Number(note.createdAt) * 1000).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm mt-2">{note.content}</p>
                    {!note.isResolved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resolveNoteMutation.mutate(note.id)}
                        className="mt-2 h-6 text-xs"
                      >
                        Mark Resolved
                      </Button>
                    )}
                    {note.isResolved && (
                      <p className="text-xs text-green-400 mt-2">
                        Resolved {note.resolvedAt ? new Date(Number(note.resolvedAt) * 1000).toLocaleDateString() : ''}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotesDialogOpen(false)} className="bg-neutral-700">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
