import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldHintLabel, VIEW_AS_TRADER_FIELD_HELP } from "./AdminDashboardSupport";

type Props = any;

export function AdminViewAsTab(props: Props) {
  const { isLoading, columnFilters, setColumnFilters, users, viewAsMutation } = props;
  return (
            <TabsContent value="view-as" className="p-4">
              <TooltipProvider delayDuration={120}>
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <FieldHintLabel
                      label="View as Trader"
                      hint={VIEW_AS_TRADER_FIELD_HELP.overview.tooltip}
                      labelClassName="text-xl font-semibold"
                    />
                    <p className="text-xs text-gray-400 mt-1">{VIEW_AS_TRADER_FIELD_HELP.overview.inline}</p>
                  </div>
                </div>
                <p className="text-gray-400 mb-4">
                  Select a trader to view the platform from their perspective. This is useful for debugging and support purposes.
                  All impersonation actions are logged for audit compliance.
                </p>

                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                  Impersonation controls include hidden <span className="font-medium">Hint</span> explainers for safe account selection and audit-aware action usage.
                </div>

                <div className="mb-4 max-w-md">
                  <FieldHintLabel label="Trader Search Filter" hint={VIEW_AS_TRADER_FIELD_HELP.searchFilter.tooltip} />
                  <Input
                    placeholder="Search by name, email, username, or phone..."
                    value={columnFilters.email}
                    onChange={(e) => setColumnFilters((prev: any) => ({ ...prev, email: e.target.value }))}
                    className="bg-neutral-700 border-gray-600 mt-1"
                    title={VIEW_AS_TRADER_FIELD_HELP.searchFilter.tooltip}
                  />
                  <p className="text-xs text-gray-400 mt-1">{VIEW_AS_TRADER_FIELD_HELP.searchFilter.inline}</p>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-gray-700">
                        <TableHead className="text-gray-300">ID</TableHead>
                        <TableHead className="text-gray-300">Name</TableHead>
                        <TableHead className="text-gray-300">Username</TableHead>
                        <TableHead className="text-gray-300">Email</TableHead>
                        <TableHead className="text-gray-300">Phone</TableHead>
                        <TableHead className="text-gray-300">Balance</TableHead>
                        <TableHead className="text-gray-300">Status</TableHead>
                        <TableHead className="text-gray-300">
                          <div className="flex items-center gap-2">
                            <span>Action</span>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                  aria-label="View as action hint"
                                >
                                  Hint
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                {VIEW_AS_TRADER_FIELD_HELP.viewAsAction.tooltip}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoading ? (
                        <TableRow><TableCell colSpan={8} className="text-center py-8">Loading...</TableCell></TableRow>
                      ) : (
                        users
                          .filter((user: any) => !user.isAdmin)
                          .filter((user: any) => !columnFilters.email ||
                            user.email.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.username?.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.phone?.toLowerCase().includes(columnFilters.email.toLowerCase()) ||
                            user.name?.toLowerCase().includes(columnFilters.email.toLowerCase())
                          )
                          .map((user: any) => (
                            <TableRow key={user.id} className="border-gray-700 hover:bg-neutral-700">
                              <TableCell className="py-3 text-gray-400">{user.id}</TableCell>
                              <TableCell className="py-3">{user.name || '-'}</TableCell>
                              <TableCell className="py-3">{user.username || '-'}</TableCell>
                              <TableCell className="py-3">{user.email}</TableCell>
                              <TableCell className="py-3 text-gray-400">{user.phone || '-'}</TableCell>
                              <TableCell className="py-3">${Number(user.balance || 0).toFixed(2)}</TableCell>
                              <TableCell className="py-3">
                                {user.isDisabled ? (
                                  <span className="text-red-400">Disabled</span>
                                ) : user.isFrozen ? (
                                  <span className="text-amber-400">Frozen</span>
                                ) : (
                                  <span className="text-green-400">Active</span>
                                )}
                              </TableCell>
                              <TableCell className="py-3">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => viewAsMutation.mutate(user.id)}
                                  disabled={viewAsMutation.isPending}
                                  className="bg-purple-600 hover:bg-purple-700 border-0"
                                  title={VIEW_AS_TRADER_FIELD_HELP.viewAsAction.tooltip}
                                >
                                  {viewAsMutation.isPending ? 'Starting...' : 'View As'}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))
                      )}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-gray-400 mt-3">{VIEW_AS_TRADER_FIELD_HELP.viewAsAction.inline}</p>
              </TooltipProvider>
            </TabsContent>

  );
}
