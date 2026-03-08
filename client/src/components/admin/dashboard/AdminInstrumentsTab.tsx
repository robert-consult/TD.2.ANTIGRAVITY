import { InstrumentIngestionPanel } from "@/components/admin/InstrumentIngestionPanel";
import { PipDefaultsPanel } from "@/components/admin/PipDefaultsPanel";
import { QuoteSubscriptionsPanel } from "@/components/admin/QuoteSubscriptionsPanel";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { FieldHintLabel, INSTRUMENTS_FIELD_HELP } from "./AdminDashboardSupport";

type Props = any;

export function AdminInstrumentsTab(props: Props) {
  const { instrumentsSubTab, setInstrumentsSubTab, setCatalogEnableDialogOpen, setNewSymbolDialogOpen, isLoadingSymbols, symbols, handleEditSymbol, confirmDeleteSymbol } = props;
  return (
    <TabsContent value="instruments" className="p-4">
      <TooltipProvider delayDuration={120}>
        <Tabs value={instrumentsSubTab} onValueChange={(v) => setInstrumentsSubTab(v as any)} className="space-y-4">
          <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-3 gap-1">
            <TabsTrigger value="configured" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Configured</TabsTrigger>
            <TabsTrigger value="ingestor" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Ingestor</TabsTrigger>
            <TabsTrigger value="quoteSubscriptions" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">Quote Subscriptions</TabsTrigger>
          </TabsList>

          <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
            Instruments controls include hidden <span className="font-medium">Hint</span> explainers for symbol identity, risk-impacting fields, and rollout safety.
          </div>

          <TabsContent value="configured">
            <div className="flex justify-between items-center mb-4">
              <div>
                <FieldHintLabel
                  label="Trading Instruments"
                  hint={INSTRUMENTS_FIELD_HELP.configuredOverview.tooltip}
                  labelClassName="text-xl font-semibold"
                />
                <p className="text-xs text-gray-400 mt-1">{INSTRUMENTS_FIELD_HELP.configuredOverview.inline}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="bg-neutral-700 hover:bg-neutral-600"
                  onClick={() => setCatalogEnableDialogOpen(true)}
                  title={INSTRUMENTS_FIELD_HELP.addFromCatalog.tooltip}
                >
                  Add From Catalog
                </Button>
                <Button
                  variant="default"
                  className="bg-green-600 hover:bg-green-700"
                  onClick={() => setNewSymbolDialogOpen(true)}
                  title={INSTRUMENTS_FIELD_HELP.addNewInstrument.tooltip}
                >
                  Add New Instrument
                </Button>
              </div>
            </div>

            <p className="text-gray-400 mb-4">Configure the trading instruments available on the platform, including spread settings and lot limits.</p>

            {isLoadingSymbols ? (
              <div className="flex items-center justify-center h-40">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">Active Instruments</h3>
                  <Table className="border-collapse">
                    <TableHeader>
                      <TableRow className="border-b border-gray-700">
                        <TableHead className="py-3 px-4 text-left text-gray-400">Symbol</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Name</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Base/Quote</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Min Spread (pips)</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Min/Max Lot</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {symbols.filter((symbol: any) => symbol.enabled).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-4">
                            No active instruments configured
                          </TableCell>
                        </TableRow>
                      ) : (
                        symbols.filter((symbol: any) => symbol.enabled).map((symbol: any) => (
                          <TableRow key={symbol.id} className="border-b border-gray-700">
                            <TableCell className="py-3 px-4 font-semibold">{symbol.symbol}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.name}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.baseCurrency || "-"}/{symbol.quoteCurrency || "-"}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.minSpreadPips}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.minLot} / {symbol.maxLot} lots</TableCell>
                            <TableCell className="py-3 px-4">
                              <div className="flex items-center">
                                <div className="w-3 h-3 rounded-full mr-2 bg-green-500"></div>
                                <span>Active</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3 px-4">
                              <div className="flex space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditSymbol(symbol)}
                                  className="bg-neutral-700 hover:bg-neutral-600"
                                  title={INSTRUMENTS_FIELD_HELP.editAction.tooltip}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => confirmDeleteSymbol(symbol.id)}
                                  className="bg-red-800 hover:bg-red-700 border-red-700"
                                  title={INSTRUMENTS_FIELD_HELP.removeAction.tooltip}
                                >
                                  Remove
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div>
                  <h3 className="text-lg font-semibold mb-2 text-gray-300">Inactive Instruments</h3>
                  <Table className="border-collapse">
                    <TableHeader>
                      <TableRow className="border-b border-gray-700">
                        <TableHead className="py-3 px-4 text-left text-gray-400">Symbol</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Name</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Base/Quote</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Min Spread (pips)</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Min/Max Lot</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>
                        <TableHead className="py-3 px-4 text-left text-gray-400">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {symbols.filter((symbol: any) => !symbol.enabled).length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center py-4 text-gray-400">
                            No inactive instruments
                          </TableCell>
                        </TableRow>
                      ) : (
                        symbols.filter((symbol: any) => !symbol.enabled).map((symbol: any) => (
                          <TableRow key={symbol.id} className="border-b border-gray-700 opacity-75">
                            <TableCell className="py-3 px-4 font-semibold">{symbol.symbol}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.name}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.baseCurrency || "-"}/{symbol.quoteCurrency || "-"}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.minSpreadPips}</TableCell>
                            <TableCell className="py-3 px-4">{symbol.minLot} / {symbol.maxLot} lots</TableCell>
                            <TableCell className="py-3 px-4">
                              <div className="flex items-center">
                                <div className="w-3 h-3 rounded-full mr-2 bg-red-500"></div>
                                <span>Inactive</span>
                              </div>
                            </TableCell>
                            <TableCell className="py-3 px-4">
                              <div className="flex space-x-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleEditSymbol(symbol)}
                                  className="bg-neutral-700 hover:bg-neutral-600"
                                  title={INSTRUMENTS_FIELD_HELP.editAction.tooltip}
                                >
                                  Edit
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => confirmDeleteSymbol(symbol.id)}
                                  className="bg-red-800 hover:bg-red-700 border-red-700"
                                  title={INSTRUMENTS_FIELD_HELP.removeAction.tooltip}
                                >
                                  Remove
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="ingestor">
            <div className="space-y-4">
              <InstrumentIngestionPanel />
              <PipDefaultsPanel />
            </div>
          </TabsContent>

          <TabsContent value="quoteSubscriptions">
            <QuoteSubscriptionsPanel />
          </TabsContent>
        </Tabs>
      </TooltipProvider>
    </TabsContent>
  );
}
