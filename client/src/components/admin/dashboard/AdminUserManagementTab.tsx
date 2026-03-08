import type { KeyboardEvent } from "react";
import GriftAdmin, { KycQueueTab } from "@/components/admin/GriftAdmin";
import UserActivityAdmin from "@/components/admin/UserActivityAdmin";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FieldHintLabel, USER_MANAGEMENT_FIELD_HELP, parseUserAgent } from "./AdminDashboardSupport";
import type { UserColumnKey } from "./AdminDashboardSupport";

type Props = any;

export function AdminUserManagementTab(props: Props) {
  const { queueUserExport, setUserFilterTab, setSelectedUserIds, userFilterTab, users, onlineData, selectedUserIds, bulkToggleStatusMutation, isLoadingOnline, allLoginHistory, isLoadingLoginHistory, auditTrailData, isLoadingAuditTrail, auditEventFilter, setAuditEventFilter, isLoadingKycQueue, policySummary, path2WindowDays, isLoadingPolicyConfig, policyConfig, setPolicyConfig, setPolicyConfigChanged, policyConfigChanged, policyConfigMutation, kycCandidates, inviteKycMutation, updateKycStatusMutation, griftSummary, isLoadingGriftSummary, isLoadingGriftUsers, isLoadingGriftAlerts, isLoading, visibleColumns, setVisibleColumns, filteredUsers, handleSelectAll, columnFilters, setColumnFilters, handleSelectUser, updateBalance, mutation, handleEdit, openTimeline, openNotes, toggleUserStatusMutation, unfreezeUserMutation, openFreeze } = props;
  return (
            <TabsContent value="users" className="p-2 sm:p-4">
              <TooltipProvider delayDuration={120}>
                <div className="flex flex-wrap justify-between items-start gap-2 mb-4">
                  <div>
                    <FieldHintLabel
                      label="User Management"
                      hint={USER_MANAGEMENT_FIELD_HELP.overview.tooltip}
                      labelClassName="text-lg sm:text-xl font-semibold"
                    />
                    <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.overview.inline}</p>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      onClick={() => queueUserExport("csv")}
                      variant="csv"
                      size="sm"
                      className="text-xs sm:text-sm"
                      title={USER_MANAGEMENT_FIELD_HELP.exportCsv.tooltip}
                    >
                      Export CSV
                    </Button>
                    <Button
                      onClick={() => queueUserExport("jsonl")}
                      variant="jsonl"
                      size="sm"
                      className="text-xs sm:text-sm"
                      title={USER_MANAGEMENT_FIELD_HELP.exportJsonl.tooltip}
                    >
                      Export JSONL
                    </Button>
                    <Button
                      onClick={() => queueUserExport("parquet")}
                      variant="parquet"
                      size="sm"
                      className="text-xs sm:text-sm"
                      title={USER_MANAGEMENT_FIELD_HELP.exportParquet.tooltip}
                    >
                      Export Parquet
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                  User management controls include hidden <span className="font-medium">Hint</span> explainers for tab intent, bulk actions, and sensitive account operations.
                </div>

                <div className="mb-2">
                  <FieldHintLabel label="User Mini-tabs" hint={USER_MANAGEMENT_FIELD_HELP.miniTabs.tooltip} />
                  <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.miniTabs.inline}</p>
                </div>

                {/* Mini-tabs for filtering */}
                <div className="flex flex-wrap gap-1.5 sm:gap-2 mb-4 p-1 bg-neutral-700 rounded">
                  <button
                    onClick={() => { setUserFilterTab("all"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "all" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabAll.tooltip}
                  >
                    All ({users.length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("active"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "active" ? "bg-green-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabActive.tooltip}
                  >
                    Active ({users.filter((u: any) => !u.isDisabled && !u.isFrozen).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("disabled"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "disabled" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabDisabled.tooltip}
                  >
                    Disabled ({users.filter((u: any) => u.isDisabled).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("frozen"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "frozen" ? "bg-blue-500 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabFrozen.tooltip}
                  >
                    Frozen ({users.filter((u: any) => u.isFrozen && !u.isDisabled).length})
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("online"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "online" ? "bg-cyan-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabOnline.tooltip}
                  >
                    <span className="hidden sm:inline">Online ({onlineData?.onlineCount || 0}) / Offline ({onlineData?.offlineCount || 0})</span>
                    <span className="sm:hidden">On/Off ({onlineData?.onlineCount || 0}/{onlineData?.offlineCount || 0})</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("logins"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "logins" ? "bg-purple-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabLogins.tooltip}
                  >
                    <span className="hidden sm:inline">Login History</span>
                    <span className="sm:hidden">Logins</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("audit"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "audit" ? "bg-orange-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabAudit.tooltip}
                  >
                    <span className="hidden sm:inline">Audit Trail</span>
                    <span className="sm:hidden">Audit</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("kyc"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "kyc" ? "bg-teal-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabKyc.tooltip}
                  >
                    KYC Queue
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("grift"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "grift" ? "bg-red-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabGrift.tooltip}
                  >
                    <span className="hidden sm:inline">Grift Detection ({griftSummary?.openAlerts || 0})</span>
                    <span className="sm:hidden">Grift ({griftSummary?.openAlerts || 0})</span>
                  </button>
                  <button
                    onClick={() => { setUserFilterTab("activity"); setSelectedUserIds([]); }}
                    className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded text-xs sm:text-sm transition ${userFilterTab === "activity" ? "bg-indigo-600 text-white" : "text-gray-300 hover:bg-neutral-600"}`}
                    title={USER_MANAGEMENT_FIELD_HELP.tabActivity.tooltip}
                  >
                    Activity
                  </button>
                </div>

                {userFilterTab !== "logins" && userFilterTab !== "online" && userFilterTab !== "audit" && userFilterTab !== "kyc" && userFilterTab !== "grift" && userFilterTab !== "activity" && selectedUserIds.length > 0 && (
                  <div className="bg-neutral-700 p-3 rounded mb-4 flex items-center gap-4 flex-wrap">
                    <div className="w-full">
                      <FieldHintLabel label="Bulk User Actions" hint={USER_MANAGEMENT_FIELD_HELP.bulkActions.tooltip} />
                      <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.bulkActions.inline}</p>
                    </div>
                    <span className="text-sm" title={USER_MANAGEMENT_FIELD_HELP.bulkActions.tooltip}>{selectedUserIds.length} user(s) selected</span>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkToggleStatusMutation.isPending}
                      onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: true })}
                      className="bg-amber-600 hover:bg-amber-700 border-0"
                      title={USER_MANAGEMENT_FIELD_HELP.disableSelectedAction.tooltip}
                    >
                      {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Disable Selected'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={bulkToggleStatusMutation.isPending}
                      onClick={() => bulkToggleStatusMutation.mutate({ userIds: selectedUserIds, disabled: false })}
                      className="bg-green-600 hover:bg-green-700 border-0"
                      title={USER_MANAGEMENT_FIELD_HELP.enableSelectedAction.tooltip}
                    >
                      {bulkToggleStatusMutation.isPending ? 'Processing...' : 'Enable Selected'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedUserIds([])} title={USER_MANAGEMENT_FIELD_HELP.clearSelectionAction.tooltip}>
                      Clear Selection
                    </Button>
                  </div>
                )}

                {userFilterTab === "online" ? (
                  /* Online Users View */
                  <div className="overflow-x-auto">
                    {isLoadingOnline ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                          <FieldHintLabel label="Online Session View" hint={USER_MANAGEMENT_FIELD_HELP.onlineOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.onlineOverview.inline}</p>
                        </div>
                        <div className="flex gap-4 mb-4">
                          <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-green-400">{onlineData?.onlineCount || 0}</div>
                            <div className="text-sm text-gray-400">Online Now</div>
                          </div>
                          <div className="bg-neutral-700/50 rounded-lg p-4 flex-1">
                            <div className="text-3xl font-bold text-gray-400">{onlineData?.offlineCount || 0}</div>
                            <div className="text-sm text-gray-400">Offline</div>
                          </div>
                        </div>
                        <Table className="border-collapse">
                          <TableHeader>
                            <TableRow className="border-b border-gray-700">
                              <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">IP Address</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">Login Time</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.onlineOverview.tooltip}>Session Duration</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {(!onlineData?.onlineUsers || onlineData.onlineUsers.length === 0) ? (
                              <TableRow>
                                <TableCell colSpan={4} className="text-center py-4 text-gray-400">
                                  No users currently online
                                </TableCell>
                              </TableRow>
                            ) : (
                              onlineData.onlineUsers.map((user: any) => {
                                const formatDuration = (seconds: number) => {
                                  const hours = Math.floor(seconds / 3600);
                                  const mins = Math.floor((seconds % 3600) / 60);
                                  const secs = seconds % 60;
                                  if (hours > 0) return `${hours}h ${mins}m ${secs}s`;
                                  if (mins > 0) return `${mins}m ${secs}s`;
                                  return `${secs}s`;
                                };

                                return (
                                  <TableRow key={user.id} className="border-b border-gray-700">
                                    <TableCell className="py-3 px-4">
                                      <div>
                                        <div className="font-medium flex items-center gap-2">
                                          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                                          {user.email}
                                        </div>
                                        <div className="text-xs text-gray-400">
                                          {user.name || user.username || `User #${user.userId}`}
                                        </div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="font-mono text-sm">{user.ip || 'Unknown'}</span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-gray-400">
                                        {(() => {
                                          if (!user.loginTime) return 'N/A';
                                          const d = new Date(user.loginTime);
                                          return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                                        })()}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-green-400 font-medium">
                                        {formatDuration(user.sessionDuration)}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </div>
                ) : userFilterTab === "logins" ? (
                  /* Login History View */
                  <div className="overflow-x-auto">
                    {isLoadingLoginHistory ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <>
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-4">
                          <FieldHintLabel label="Login Trail" hint={USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.inline}</p>
                        </div>
                        <Table className="border-collapse">
                          <TableHeader>
                            <TableRow className="border-b border-gray-700">
                              <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">IP Address</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">User Agent</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.loginTrailOverview.tooltip}>Status</TableHead>
                              <TableHead className="py-3 px-4 text-left text-gray-400">Time</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {allLoginHistory.length === 0 ? (
                              <TableRow>
                                <TableCell colSpan={5} className="text-center py-4">
                                  No login history found
                                </TableCell>
                              </TableRow>
                            ) : (
                              allLoginHistory.map((entry: any) => {
                                const ipValue = entry.ipAddress ?? entry.ip ?? entry.ip_address;
                                const userAgentValue = entry.userAgent ?? entry.user_agent;
                                return (
                                  <TableRow key={entry.id} className={`border-b border-gray-700 ${!entry.success ? 'bg-red-900/20' : ''}`}>
                                    <TableCell className="py-3 px-4">
                                      <div>
                                        <div className="font-medium">{entry.email}</div>
                                        <div className="text-xs text-gray-400">{entry.username || `User #${entry.userId}`}</div>
                                      </div>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="font-mono text-sm">{ipValue || 'Unknown'}</span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-xs text-gray-400 max-w-xs truncate block" title={userAgentValue || ''}>
                                        {userAgentValue ? (userAgentValue.length > 50 ? userAgentValue.substring(0, 50) + '...' : userAgentValue) : 'Unknown'}
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      {entry.success ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-green-600 text-white">Success</span>
                                      ) : (
                                        <div>
                                          <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Failed</span>
                                          {entry.failureReason && (
                                            <div className="text-xs text-red-400 mt-1">{entry.failureReason}</div>
                                          )}
                                        </div>
                                      )}
                                    </TableCell>
                                    <TableCell className="py-3 px-4">
                                      <span className="text-sm text-gray-400">
                                        {(() => {
                                          if (!entry.createdAt) return 'N/A';
                                          const ts = entry.createdAt;
                                          // Handle string ISO dates
                                          if (typeof ts === 'string') {
                                            const d = new Date(ts);
                                            if (!isNaN(d.getTime())) return d.toLocaleString();
                                            // Try as numeric string
                                            const num = Number(ts);
                                            if (!isNaN(num)) {
                                              const d2 = new Date(num > 1e12 ? num : num * 1000);
                                              return isNaN(d2.getTime()) ? 'Invalid Date' : d2.toLocaleString();
                                            }
                                            return ts;
                                          }
                                          // Handle numeric timestamps
                                          if (typeof ts === 'number') {
                                            const d = new Date(ts > 1e12 ? ts : ts * 1000);
                                            return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleString();
                                          }
                                          return String(ts);
                                        })()}
                                      </span>
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            )}
                          </TableBody>
                        </Table>
                      </>
                    )}
                  </div>
                ) : userFilterTab === "audit" ? (
                  /* Audit Trail View */
                  <div className="overflow-x-auto">
                    {isLoadingAuditTrail ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
                          <FieldHintLabel label="Audit Trail" hint={USER_MANAGEMENT_FIELD_HELP.auditOverview.tooltip} />
                          <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.auditOverview.inline}</p>
                        </div>
                        <div className="grid gap-4 mb-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                          <div className="bg-blue-900/30 border border-blue-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-blue-400">{auditTrailData?.signups?.length || 0}</div>
                            <div className="text-sm text-gray-400">Recent Signups</div>
                          </div>
                          <div className="bg-green-900/30 border border-green-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-green-400">{auditTrailData?.logins?.filter((l: any) => l.success).length || 0}</div>
                            <div className="text-sm text-gray-400">Successful Logins</div>
                          </div>
                          <div className="bg-red-900/30 border border-red-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-red-400">{auditTrailData?.logins?.filter((l: any) => !l.success).length || 0}</div>
                            <div className="text-sm text-gray-400">Failed Logins</div>
                          </div>
                          <div className="bg-orange-900/30 border border-orange-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-orange-400">{auditTrailData?.adminActions?.length || 0}</div>
                            <div className="text-sm text-gray-400">Admin Actions</div>
                          </div>
                          <div className="bg-cyan-900/30 border border-cyan-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-cyan-300">{auditTrailData?.tradeAuditEvents?.length || 0}</div>
                            <div className="text-sm text-gray-400">Trade Audit Events</div>
                          </div>
                          <div className="bg-purple-900/30 border border-purple-600/50 rounded-lg p-4">
                            <div className="text-3xl font-bold text-purple-300">{auditTrailData?.orderIntentEvents?.length || 0}</div>
                            <div className="text-sm text-gray-400">Order Intent Events</div>
                          </div>
                        </div>

                        {/* Event Type Filter */}
                        <div className="space-y-2">
                          <FieldHintLabel label="Event Type Filter" hint={USER_MANAGEMENT_FIELD_HELP.auditEventFilter.tooltip} />
                          <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.auditEventFilter.inline}</p>
                          <div className="flex gap-2 flex-wrap">
                            {[
                              { value: "all", label: "All Events", color: "bg-gray-600" },
                              { value: "signup", label: "Signups", color: "bg-blue-600" },
                              { value: "login_success", label: "Login Success", color: "bg-green-600" },
                              { value: "login_fail", label: "Login Fail", color: "bg-red-600" },
                              { value: "admin", label: "Admin Actions", color: "bg-orange-600" },
                              { value: "identity", label: "Identity", color: "bg-indigo-600" },
                              { value: "trade_audit", label: "Trade Audit", color: "bg-cyan-700" },
                              { value: "order_intent", label: "Order Intent", color: "bg-purple-700" },
                            ].map(filter => (
                              <button
                                key={filter.value}
                                onClick={() => setAuditEventFilter(filter.value as any)}
                                className={`px-3 py-1.5 rounded text-sm transition ${auditEventFilter === filter.value
                                  ? `${filter.color} text-white`
                                  : "bg-neutral-700 text-gray-300 hover:bg-neutral-600"
                                  }`}
                                title={USER_MANAGEMENT_FIELD_HELP.auditEventFilter.tooltip}
                              >
                                {filter.label}
                              </button>
                            ))}
                          </div>
                        </div>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <CardTitle className="text-base">Combined Audit Timeline</CardTitle>
                          </CardHeader>
                          <CardContent>
                            <div className="overflow-x-auto">
                              <Table className="border-collapse min-w-[1000px]">
                                <TableHeader>
                                  <TableRow className="border-b border-gray-700">
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Time</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Event</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">User</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Details</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">IP</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Location</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Timezone</TableHead>
                                    <TableHead className="py-3 px-3 text-left text-gray-400">Device</TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {(() => {
                                    let allEvents = [
                                      ...(auditTrailData?.signups?.map((s: any) => ({
                                        type: 'SIGNUP' as const,
                                        time: s.createdAt,
                                        email: s.email,
                                        detail: `New user: ${s.username}`,
                                        id: `signup-${s.id}`,
                                        ip: s.signupIp || null,
                                        location: [s.signupCity, s.signupRegion, s.signupCountryCode].filter(Boolean).join(', ') || null,
                                        coords: s.signupLatitude && s.signupLongitude ? `${Number(s.signupLatitude).toFixed(2)}, ${Number(s.signupLongitude).toFixed(2)}` : null,
                                        timezone: s.signupClientTz || s.signupInferredTz || null,
                                        device: [s.signupDeviceType, s.signupBrowser, s.signupOs].filter(Boolean).join(' / ') || parseUserAgent(s.signupUserAgent),
                                        userAgent: s.signupUserAgent || null,
                                        link: null as string | null,
                                      })) || []),
                                      ...(auditTrailData?.logins?.map((l: any) => {
                                        const loginIp = l.ip ?? l.ipAddress ?? l.ip_address ?? null;
                                        const loginUa = l.userAgent ?? l.user_agent ?? null;
                                        return {
                                          type: l.success ? 'LOGIN_SUCCESS' as const : 'LOGIN_FAIL' as const,
                                          time: l.createdAt,
                                          email: l.email,
                                          detail: l.success ? 'Successful login' : 'Failed login attempt',
                                          id: `login-${l.id}`,
                                          ip: loginIp,
                                          location: [l.city, l.region, l.countryCode].filter(Boolean).join(', ') || null,
                                          coords: l.latitude && l.longitude ? `${Number(l.latitude).toFixed(2)}, ${Number(l.longitude).toFixed(2)}` : null,
                                          timezone: l.clientTz || null,
                                          device: parseUserAgent(loginUa),
                                          userAgent: loginUa,
                                          link: null as string | null,
                                        };
                                      }) || []),
                                      ...(auditTrailData?.adminActions?.map((a: any) => ({
                                        type: 'ADMIN_ACTION' as const,
                                        time: a.createdAt,
                                        email: `Admin #${a.adminId} → User #${a.userId}`,
                                        detail: a.actionType,
                                        id: `admin-${a.id}`,
                                        ip: a.ip || null,
                                        location: null,
                                        coords: null,
                                        timezone: null,
                                        device: parseUserAgent(a.userAgent),
                                        userAgent: a.userAgent || null,
                                        link: null as string | null,
                                      })) || [])
                                      ,
                                      ...(auditTrailData?.identityEvents?.map((e: any) => ({
                                        type: 'IDENTITY_EVENT' as const,
                                        time: e.at,
                                        email: e.email || `User #${e.userId ?? "?"}`,
                                        detail: [e.category, e.type, e.title].filter(Boolean).join(" • "),
                                        id: `identity-${e.id}`,
                                        ip: null,
                                        location: null,
                                        coords: null,
                                        timezone: null,
                                        device: null,
                                        userAgent: null,
                                        link: [e.correlationId ? `corr:${e.correlationId}` : null, e.sessionId ? `session:${e.sessionId}` : null].filter(Boolean).join(" | "),
                                      })) || []),
                                      ...(auditTrailData?.tradeAuditEvents?.map((t: any) => ({
                                        type: 'TRADE_AUDIT' as const,
                                        time: Number(t.eventAtSec || 0),
                                        email: t.userEmail || t.username || `User #${t.userId ?? t.actorUserId ?? "?"}`,
                                        detail: [
                                          t.eventType,
                                          t.symbol ? `${t.symbol}${t.side ? ` ${t.side}` : ""}` : null,
                                          t.qtyLots != null ? `${Number(t.qtyLots)} lots` : null,
                                          t.riskResult ? `risk:${t.riskResult}` : null,
                                          t.reasonCode ? `reason:${t.reasonCode}` : null,
                                        ].filter(Boolean).join(" • "),
                                        id: `trade-audit-${t.id}`,
                                        ip: t.ip || null,
                                        location: null,
                                        coords: null,
                                        timezone: null,
                                        device: parseUserAgent(t.userAgent),
                                        userAgent: t.userAgent || null,
                                        link: [
                                          t.tradeId != null ? `trade:${t.tradeId}` : null,
                                          t.orderId ? `order:${t.orderId}` : null,
                                          t.executionId ? `exec:${t.executionId}` : null,
                                          t.positionId ? `pos:${t.positionId}` : null,
                                          t.correlationId ? `corr:${t.correlationId}` : null,
                                          t.sessionId ? `session:${t.sessionId}` : null,
                                        ].filter(Boolean).join(" | "),
                                      })) || []),
                                      ...(auditTrailData?.orderIntentEvents?.map((o: any) => ({
                                        type: 'ORDER_INTENT' as const,
                                        time: Number(o.eventAtSec || 0),
                                        email: o.userEmail || o.username || `User #${o.userId ?? "?"}`,
                                        detail: [
                                          o.eventCode,
                                          o.symbol ? `${o.symbol}${o.side ? ` ${o.side}` : ""}` : null,
                                          o.qtyLots != null ? `${Number(o.qtyLots)} lots` : null,
                                          o.decision ? `decision:${o.decision}` : null,
                                          o.rejectCheck ? `check:${o.rejectCheck}` : null,
                                          o.rejectReason ? `reason:${o.rejectReason}` : null,
                                        ].filter(Boolean).join(" • "),
                                        id: `order-intent-${o.id}`,
                                        ip: o.ip || null,
                                        location: null,
                                        coords: null,
                                        timezone: null,
                                        device: parseUserAgent(o.userAgent),
                                        userAgent: o.userAgent || null,
                                        link: [
                                          o.correlationId ? `corr:${o.correlationId}` : null,
                                          o.sessionId ? `session:${o.sessionId}` : null,
                                        ].filter(Boolean).join(" | "),
                                      })) || [])
                                    ];

                                    // Apply event type filter
                                    if (auditEventFilter !== "all") {
                                      allEvents = allEvents.filter(event => {
                                        if (auditEventFilter === "signup") return event.type === "SIGNUP";
                                        if (auditEventFilter === "login_success") return event.type === "LOGIN_SUCCESS";
                                        if (auditEventFilter === "login_fail") return event.type === "LOGIN_FAIL";
                                        if (auditEventFilter === "admin") return event.type === "ADMIN_ACTION";
                                        if (auditEventFilter === "identity") return event.type === "IDENTITY_EVENT";
                                        if (auditEventFilter === "trade_audit") return event.type === "TRADE_AUDIT";
                                        if (auditEventFilter === "order_intent") return event.type === "ORDER_INTENT";
                                        return true;
                                      });
                                    }

                                    allEvents = allEvents
                                      .filter((event) => Number.isFinite(Number(event.time)) && Number(event.time) > 0)
                                      .sort((a, b) => b.time - a.time)
                                      .slice(0, 200);

                                    if (allEvents.length === 0) {
                                      return (
                                        <TableRow>
                                          <TableCell colSpan={8} className="text-center py-4 text-gray-400">
                                            No audit events found
                                          </TableCell>
                                        </TableRow>
                                      );
                                    }

                                    return allEvents.map((event) => (
                                      <TableRow key={event.id} className="border-b border-gray-700">
                                        <TableCell className="py-3 px-3">
                                          <span className="text-sm text-gray-400 whitespace-nowrap">
                                            {new Date(event.time * 1000).toLocaleString()}
                                          </span>
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          <span className={`text-xs px-2 py-0.5 rounded whitespace-nowrap ${event.type === 'SIGNUP' ? 'bg-blue-600 text-white' :
                                            event.type === 'LOGIN_SUCCESS' ? 'bg-green-600 text-white' :
                                              event.type === 'LOGIN_FAIL' ? 'bg-red-600 text-white' :
                                                event.type === 'ADMIN_ACTION' ? 'bg-orange-600 text-white' :
                                                  event.type === 'IDENTITY_EVENT' ? 'bg-indigo-600 text-white' :
                                                    event.type === 'TRADE_AUDIT' ? 'bg-cyan-700 text-white' :
                                                      'bg-purple-700 text-white'
                                            }`}>
                                            {event.type.replace('_', ' ')}
                                          </span>
                                        </TableCell>
                                        <TableCell className="py-3 px-3 font-medium text-sm">{event.email}</TableCell>
                                        <TableCell className="py-3 px-3 text-gray-400 text-sm">
                                          <div>{event.detail}</div>
                                          {event.link ? (
                                            <div className="text-[10px] font-mono text-gray-500 mt-1 break-all">{event.link}</div>
                                          ) : null}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.ip ? (
                                            <span className="text-xs font-mono text-cyan-400" title={event.ip}>
                                              {event.ip.length > 15 ? event.ip.slice(0, 15) + '...' : event.ip}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.location ? (
                                            <div className="text-xs">
                                              <div className="text-gray-300">{event.location}</div>
                                              {event.coords && <div className="text-gray-500 text-[10px]">{event.coords}</div>}
                                            </div>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.timezone ? (
                                            <span className="text-xs text-purple-400">{event.timezone}</span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                        <TableCell className="py-3 px-3">
                                          {event.device ? (
                                            <span className="text-xs text-yellow-400" title={event.userAgent || ''}>
                                              {event.device.length > 30 ? event.device.slice(0, 30) + '...' : event.device}
                                            </span>
                                          ) : (
                                            <span className="text-xs text-gray-500">-</span>
                                          )}
                                        </TableCell>
                                      </TableRow>
                                    ));
                                  })()}
                                </TableBody>
                              </Table>
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    )}
                  </div>
                ) : userFilterTab === "kyc" ? (
                  /* KYC Queue View */
                  <div className="overflow-x-auto">
                    {isLoadingKycQueue ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <div className="bg-teal-900/20 border border-teal-600/50 rounded-lg p-4">
                          <FieldHintLabel
                            label="Contender Pipeline"
                            hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                            labelClassName="text-lg font-semibold text-teal-400"
                          />
                          <p className="text-xs text-gray-300 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          <p className="text-sm text-gray-400 mt-2">
                            Users who meet performance criteria (P1: {policySummary?.policyContenderPath1MinAgeDays ?? 30}+ days, {Math.round((policySummary?.policyContenderPath1MinBalancePct ?? 1.2) * 100)}%+ balance, {policySummary?.policyContenderPath1MinTradesLifetime ?? 30}+ trades)
                            or (P2: {policySummary?.policyContenderPath2MinAgeDays ?? 90}+ days, {Math.round((policySummary?.policyContenderPath2MinReturnLast90 ?? 0.1) * 100)}%+ last-{path2WindowDays}d return, {policySummary?.policyContenderPath2MinTradesLast90 ?? 20}+ trades, last trade within {policySummary?.policyContenderPath2MaxDaysSinceLastTrade ?? 14} days)
                            will appear here for KYC/funding consideration.
                          </p>
                        </div>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <FieldHintLabel
                              label="Policy Controls"
                              hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                              labelClassName="text-base font-semibold"
                            />
                            <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          </CardHeader>
                          <CardContent>
                            {isLoadingPolicyConfig || !policyConfig ? (
                              <div className="text-sm text-gray-400">Loading policy controls...</div>
                            ) : (
                              <div className="space-y-4">
                                <div className="grid gap-4 md:grid-cols-2">
                                  <div className="rounded-md border border-green-600/50 p-3">
                                    <div className="text-sm font-medium text-green-500 mb-3">Path 1 Criteria</div>
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Age (days)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath1MinAgeDays}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinAgeDays.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinAgeDays: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Trades (lifetime)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath1MinTradesLifetime}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinTradesLifetime.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinTradesLifetime: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Balance Multiplier (1.20 = 120%)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.tooltip}
                                          labelClassName="text-sm text-green-500"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.inline}</p>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={policyConfig.policyContenderPath1MinBalancePct}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath1MinBalancePct.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath1MinBalancePct: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                  <div className="rounded-md border border-teal-600/50 p-3">
                                    <div className="text-sm font-medium text-teal-400 mb-3">Path 2 Criteria</div>
                                    <div className="space-y-4">
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Age (days)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MinAgeDays}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinAgeDays.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinAgeDays: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label={`Min Trades (last ${path2WindowDays}d)`}
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MinTradesLast90}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinTradesLast90.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinTradesLast90: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Min Return (0.10 = 10%)"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.inline}</p>
                                        <Input
                                          type="number"
                                          step="0.01"
                                          value={policyConfig.policyContenderPath2MinReturnLast90}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MinReturnLast90.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MinReturnLast90: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                      <div className="space-y-2">
                                        <FieldHintLabel
                                          label="Max Days Since Last Trade"
                                          hint={USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.tooltip}
                                          labelClassName="text-sm text-teal-400"
                                        />
                                        <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.inline}</p>
                                        <Input
                                          type="number"
                                          value={policyConfig.policyContenderPath2MaxDaysSinceLastTrade}
                                          title={USER_MANAGEMENT_FIELD_HELP.kycPath2MaxDaysSinceLastTrade.tooltip}
                                          onChange={(e) => {
                                            setPolicyConfig({
                                              ...policyConfig,
                                              policyContenderPath2MaxDaysSinceLastTrade: Number(e.target.value),
                                            });
                                            setPolicyConfigChanged(true);
                                          }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="rounded-md border border-gray-600/70 p-3">
                                  <div className="text-sm font-medium text-gray-200">Messaging and OTP Limits</div>
                                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                                    <div className="space-y-2">
                                      <FieldHintLabel label="Email Resend Cooldown (sec)" hint={USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyEmailResendCooldownSec}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycEmailResendCooldownSec.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyEmailResendCooldownSec: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="Email Daily Send Cap" hint={USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyEmailDailySendCap}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycEmailDailySendCap.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyEmailDailySendCap: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="SMS Resend Cooldown (sec)" hint={USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policySmsResendCooldownSec}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycSmsResendCooldownSec.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policySmsResendCooldownSec: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="SMS Daily Send Cap" hint={USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policySmsDailySendCap}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycSmsDailySendCap.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policySmsDailySendCap: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="OTP Max Attempts" hint={USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyOtpMaxAttempts}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycOtpMaxAttempts.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyOtpMaxAttempts: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                    <div className="space-y-2">
                                      <FieldHintLabel label="OTP Lock Minutes" hint={USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.tooltip} />
                                      <p className="text-xs text-gray-400">{USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.inline}</p>
                                      <Input
                                        type="number"
                                        value={policyConfig.policyOtpLockMinutes}
                                        title={USER_MANAGEMENT_FIELD_HELP.kycOtpLockMinutes.tooltip}
                                        onChange={(e) => {
                                          setPolicyConfig({
                                            ...policyConfig,
                                            policyOtpLockMinutes: Number(e.target.value),
                                          });
                                          setPolicyConfigChanged(true);
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between gap-4">
                                  <div>
                                    <FieldHintLabel label="Auto-promote Performer" hint={USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.tooltip} />
                                    <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.inline}</p>
                                  </div>
                                  <Switch
                                    checked={Boolean(policyConfig.policyAutoPromotePerformer)}
                                    title={USER_MANAGEMENT_FIELD_HELP.kycAutoPromotePerformer.tooltip}
                                    onCheckedChange={(checked) => {
                                      setPolicyConfig({
                                        ...policyConfig,
                                        policyAutoPromotePerformer: checked,
                                      });
                                      setPolicyConfigChanged(true);
                                    }}
                                  />
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    disabled={!policyConfigChanged || policyConfigMutation.isPending}
                                    onClick={() => policyConfig && policyConfigMutation.mutate(policyConfig)}
                                    title={USER_MANAGEMENT_FIELD_HELP.kycSaveControls.tooltip}
                                  >
                                    {policyConfigMutation.isPending ? "Saving..." : "Save Controls"}
                                  </Button>
                                </div>
                              </div>
                            )}
                          </CardContent>
                        </Card>

                        <Card className="bg-neutral-700 border-gray-600">
                          <CardHeader>
                            <FieldHintLabel
                              label="KYC Candidates Queue"
                              hint={USER_MANAGEMENT_FIELD_HELP.kycOverview.tooltip}
                              labelClassName="text-base font-semibold"
                            />
                            <p className="text-xs text-gray-400 mt-1">{USER_MANAGEMENT_FIELD_HELP.kycOverview.inline}</p>
                          </CardHeader>
                          <CardContent>
                            <Table className="border-collapse">
                              <TableHeader>
                                <TableRow className="border-b border-gray-700">
                                  <TableHead className="py-3 px-4 text-left text-gray-400">User</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Account Age</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Trades (L/{path2WindowDays}d)</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Balance %</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Return {path2WindowDays}d</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Path</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400">Tier</TableHead>
                                  <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.kycInviteAction.tooltip}>Actions</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {(!kycCandidates || kycCandidates.length === 0) ? (
                                  <TableRow>
                                    <TableCell colSpan={8} className="text-center py-8 text-gray-400">
                                      <div className="space-y-2">
                                        <div className="text-lg">No KYC candidates yet</div>
                                        <div className="text-sm">Users will appear here when they meet the contender eligibility criteria</div>
                                      </div>
                                    </TableCell>
                                  </TableRow>
                                ) : (
                                  kycCandidates.map((candidate: any) => (
                                    <TableRow key={candidate.userId} className="border-b border-gray-700">
                                      <TableCell className="py-3 px-4">
                                        <div>
                                          <div className="font-medium">{candidate.email}</div>
                                          <div className="text-xs text-gray-400">@{candidate.username}</div>
                                        </div>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">{candidate.accountAgeDays} days</TableCell>
                                      <TableCell className="py-3 px-4">{candidate.tradesLifetime} / {candidate.tradesLast90d}</TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className={candidate.balancePctOfStart >= 1 ? "text-green-400" : "text-red-400"}>
                                          {candidate.balancePctOfStart >= 1 ? "+" : ""}
                                          {((candidate.balancePctOfStart - 1) * 100).toFixed(2)}%
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        {(candidate.returnLast90d * 100).toFixed(2)}%
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className="text-xs px-2 py-0.5 rounded bg-blue-700 text-white">
                                          {candidate.contenderPath1 ? "P1" : candidate.contenderPath2 ? "P2" : "N/A"}
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <span className="text-xs px-2 py-0.5 rounded bg-gray-600 text-white">
                                          {candidate.userTier} / {candidate.contenderTier}
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-3 px-4">
                                        <div className="flex gap-2">
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-xs bg-green-700 hover:bg-green-600 border-0"
                                            onClick={() => inviteKycMutation.mutate({ userId: candidate.userId })}
                                            disabled={inviteKycMutation.isPending}
                                            title={USER_MANAGEMENT_FIELD_HELP.kycInviteAction.tooltip}
                                          >
                                            Invite KYC
                                          </Button>
                                          <Button
                                            size="sm"
                                            variant="outline"
                                            className="text-xs bg-red-700 hover:bg-red-600 border-0"
                                            onClick={() => updateKycStatusMutation.mutate({ userId: candidate.userId, status: 'REJECTED' })}
                                            disabled={updateKycStatusMutation.isPending}
                                            title={USER_MANAGEMENT_FIELD_HELP.kycRejectAction.tooltip}
                                          >
                                            Reject
                                          </Button>
                                        </div>
                                      </TableCell>
                                    </TableRow>
                                  ))
                                )}
                              </TableBody>
                            </Table>
                          </CardContent>
                        </Card>

                        <KycQueueTab />
                      </div>
                    )}
                  </div>
                ) : userFilterTab === "activity" ? (
                  /* Activity View */
                  <div className="overflow-x-auto">
                    <UserActivityAdmin />
                  </div>
                ) : userFilterTab === "grift" ? (
                  /* Grift Detection View */
                  <div className="overflow-x-auto">
                    {(isLoadingGriftSummary || isLoadingGriftUsers || isLoadingGriftAlerts) ? (
                      <div className="flex items-center justify-center h-40">
                        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-red-500"></div>
                      </div>
                    ) : (
                      <GriftAdmin />
                    )}
                  </div>
                ) : isLoading ? (
                  <div className="flex items-center justify-center h-40">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90 mb-3">
                      <FieldHintLabel label="User List Controls" hint={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip} />
                      <p className="text-xs text-cyan-100/90 mt-1">{USER_MANAGEMENT_FIELD_HELP.columnsPicker.inline}</p>
                    </div>
                    {/* Column visibility dropdown */}
                    <div className="flex justify-end mb-2">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="bg-neutral-700 text-xs" title={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip}>
                            Columns ▾
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48 bg-neutral-800 border-gray-600">
                          {([
                            { key: 'name', label: 'Names' },
                            { key: 'phone', label: 'Phone' },
                            { key: 'username', label: 'Username' },
                            { key: 'email', label: 'Email' },
                            { key: 'status', label: 'Status' },
                            { key: 'balance', label: 'Balance' },
                            { key: 'leverage', label: 'Leverage' },
                            { key: 'maxTrades', label: 'Max Trades' },
                            { key: 'minHold', label: 'Min Hold' },
                            { key: 'maxHold', label: 'Max Hold' },
                            { key: 'leaderboard', label: 'Leaderboard' },
                          ] as { key: UserColumnKey; label: string }[]).map(col => (
                            <DropdownMenuCheckboxItem
                              key={col.key}
                              checked={visibleColumns[col.key]}
                              onCheckedChange={(checked) => setVisibleColumns((prev: any) => ({ ...prev, [col.key]: !!checked }))}
                              className="text-xs cursor-pointer focus:bg-neutral-700"
                              title={USER_MANAGEMENT_FIELD_HELP.columnsPicker.tooltip}
                            >
                              {col.label}
                            </DropdownMenuCheckboxItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="overflow-x-auto">
                      <Table className="border-collapse">
                        <TableHeader>
                          <TableRow className="border-b border-gray-700">
                            <TableHead className="py-3 px-2 w-10">
                              <Checkbox
                                checked={selectedUserIds.length > 0 && selectedUserIds.length === filteredUsers.length}
                                onCheckedChange={(checked) => handleSelectAll(!!checked)}
                                title={USER_MANAGEMENT_FIELD_HELP.selectAllVisible.tooltip}
                              />
                            </TableHead>
                            {visibleColumns.name && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Names"
                                    hint={USER_MANAGEMENT_FIELD_HELP.nameFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.name}
                                    onChange={(e) => setColumnFilters((prev: any) => ({ ...prev, name: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.nameFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.phone && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Phone"
                                    hint={USER_MANAGEMENT_FIELD_HELP.phoneFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.phone}
                                    onChange={(e) => setColumnFilters((prev: any) => ({ ...prev, phone: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.phoneFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.username && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Username"
                                    hint={USER_MANAGEMENT_FIELD_HELP.usernameFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.username}
                                    onChange={(e) => setColumnFilters((prev: any) => ({ ...prev, username: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.usernameFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.email && (
                              <TableHead className="py-2 px-4 text-left text-gray-400">
                                <div className="space-y-1">
                                  <FieldHintLabel
                                    label="Email"
                                    hint={USER_MANAGEMENT_FIELD_HELP.emailFilter.tooltip}
                                    labelClassName="text-xs font-medium text-gray-300"
                                  />
                                  <Input
                                    placeholder="Search..."
                                    value={columnFilters.email}
                                    onChange={(e) => setColumnFilters((prev: any) => ({ ...prev, email: e.target.value }))}
                                    className="h-7 text-xs bg-neutral-700 w-full"
                                    title={USER_MANAGEMENT_FIELD_HELP.emailFilter.tooltip}
                                  />
                                </div>
                              </TableHead>
                            )}
                            {visibleColumns.status && <TableHead className="py-3 px-4 text-left text-gray-400">Status</TableHead>}
                            {visibleColumns.balance && <TableHead className="py-3 px-4 text-left text-gray-400">Balance</TableHead>}
                            {visibleColumns.leverage && <TableHead className="py-3 px-4 text-left text-gray-400">Leverage</TableHead>}
                            {visibleColumns.maxTrades && <TableHead className="py-3 px-4 text-left text-gray-400">Max Trades</TableHead>}
                            {visibleColumns.minHold && <TableHead className="py-3 px-4 text-left text-gray-400">Min Hold (s)</TableHead>}
                            {visibleColumns.maxHold && <TableHead className="py-3 px-4 text-left text-gray-400">Max Hold (s)</TableHead>}
                            {visibleColumns.leaderboard && <TableHead className="py-3 px-4 text-left text-gray-400" title={USER_MANAGEMENT_FIELD_HELP.leaderboardVisibility.tooltip}>Leaderboard</TableHead>}
                            <TableHead className="py-3 px-4 text-left text-gray-400">
                              <div className="flex items-center gap-2">
                                <span>Actions</span>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                                      aria-label="User row actions hint"
                                    >
                                      Hint
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                                    {USER_MANAGEMENT_FIELD_HELP.rowActions.tooltip}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredUsers.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={10} className="text-center py-4">
                                No users found
                              </TableCell>
                            </TableRow>
                          ) : (
                            filteredUsers.map((user: any) => (
                              <TableRow
                                key={user.id}
                                className={`border-b border-gray-700 ${user.isFrozen ? 'bg-blue-900/20' : user.isDisabled ? 'bg-red-900/20' : ''}`}
                              >
                                <TableCell className="py-3 px-2">
                                  <Checkbox
                                    checked={selectedUserIds.includes(user.id)}
                                    onCheckedChange={(checked) => handleSelectUser(user.id, !!checked)}
                                    title={USER_MANAGEMENT_FIELD_HELP.selectAllVisible.tooltip}
                                  />
                                </TableCell>
                                {visibleColumns.name && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.name || '-'}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.phone && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.phone || '-'}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.username && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm font-medium">{user.username}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.email && (
                                  <TableCell className="py-3 px-4">
                                    <span className="text-sm">{user.email}</span>
                                  </TableCell>
                                )}
                                {visibleColumns.status && (
                                  <TableCell className="py-3 px-4">
                                    <div className="flex flex-col gap-1">
                                      {user.isAdmin && (
                                        <span className="text-xs px-2 py-0.5 rounded bg-purple-600 text-white">Admin</span>
                                      )}
                                      {user.isFrozen ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-blue-600 text-white">Frozen</span>
                                      ) : user.isDisabled ? (
                                        <span className="text-xs px-2 py-0.5 rounded bg-red-600 text-white">Disabled</span>
                                      ) : (
                                        <span className="text-xs px-2 py-0.5 rounded bg-green-600 text-white">Active</span>
                                      )}
                                    </div>
                                  </TableCell>
                                )}
                                {visibleColumns.balance && (
                                  <TableCell className="py-3 px-4">
                                    <Input
                                      type="text"
                                      defaultValue={user.balance}
                                      title={USER_MANAGEMENT_FIELD_HELP.balanceEditor.tooltip}
                                      onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                                        if (e.key === 'Enter') {
                                          updateBalance(user.id, e.currentTarget.value);
                                        }
                                      }}
                                      onBlur={(e) => updateBalance(user.id, e.currentTarget.value)}
                                      className="w-28 h-8 bg-neutral-700"
                                    />
                                  </TableCell>
                                )}
                                {visibleColumns.leverage && (
                                  <TableCell className="py-3 px-4">{user.leverage || 'Default'}</TableCell>
                                )}
                                {visibleColumns.maxTrades && (
                                  <TableCell className="py-3 px-4">{user.maxConcurrent || 'Default'}</TableCell>
                                )}
                                {visibleColumns.minHold && (
                                  <TableCell className="py-3 px-4">{user.minHoldSec || 'Default'}</TableCell>
                                )}
                                {visibleColumns.maxHold && (
                                  <TableCell className="py-3 px-4">{user.maxHoldSec || 'Default'}</TableCell>
                                )}
                                {visibleColumns.leaderboard && (
                                  <TableCell className="py-3 px-4">
                                    <Switch
                                      checked={user.showOnLeaderboard !== false}
                                      title={USER_MANAGEMENT_FIELD_HELP.leaderboardVisibility.tooltip}
                                      onCheckedChange={(checked) => {
                                        const settings = {
                                          userId: user.id,
                                          leverage: user.leverage || 50,
                                          maxConcurrent: user.maxConcurrent || 5,
                                          maxConcurrentLots: user.maxConcurrentLots || 50,
                                          minHoldSec: user.minHoldSec || 60,
                                          maxHoldSec: user.maxHoldSec || 86400,
                                          showOnLeaderboard: checked
                                        };
                                        mutation.mutate(settings);
                                      }}
                                    />
                                  </TableCell>
                                )}
                                <TableCell className="py-3 px-4">
                                  <div className="flex flex-wrap gap-1">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleEdit(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.editAction.tooltip}
                                    >
                                      Edit
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openTimeline(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.timelineAction.tooltip}
                                    >
                                      Timeline
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => openNotes(user)}
                                      className="bg-neutral-700 hover:bg-neutral-600 h-7 text-xs px-2"
                                      title={USER_MANAGEMENT_FIELD_HELP.notesAction.tooltip}
                                    >
                                      Notes
                                    </Button>
                                    {user.isDisabled ? (
                                      /* Disabled users (including frozen+disabled) only get Enable button */
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: false })}
                                        disabled={toggleUserStatusMutation.isPending}
                                        className="bg-green-600 hover:bg-green-700 border-0 h-7 text-xs px-2"
                                        title={USER_MANAGEMENT_FIELD_HELP.enableAction.tooltip}
                                      >
                                        {toggleUserStatusMutation.isPending ? '...' : 'Enable'}
                                      </Button>
                                    ) : user.isFrozen ? (
                                      /* Frozen only users get Unfreeze + Disable */
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => unfreezeUserMutation.mutate(user.id)}
                                          disabled={unfreezeUserMutation.isPending}
                                          className="bg-blue-600 hover:bg-blue-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.unfreezeAction.tooltip}
                                        >
                                          {unfreezeUserMutation.isPending ? '...' : 'Unfreeze'}
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                          disabled={toggleUserStatusMutation.isPending}
                                          className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.disableAction.tooltip}
                                        >
                                          {toggleUserStatusMutation.isPending ? '...' : 'Disable'}
                                        </Button>
                                      </>
                                    ) : (
                                      /* Active users get Freeze + Disable */
                                      <>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => openFreeze(user)}
                                          className="bg-amber-600 hover:bg-amber-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.freezeAction.tooltip}
                                        >
                                          Freeze
                                        </Button>
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          onClick={() => toggleUserStatusMutation.mutate({ userId: user.id, disabled: true })}
                                          disabled={toggleUserStatusMutation.isPending}
                                          className="bg-red-600 hover:bg-red-700 border-0 h-7 text-xs px-2"
                                          title={USER_MANAGEMENT_FIELD_HELP.disableAction.tooltip}
                                        >
                                          {toggleUserStatusMutation.isPending ? '...' : 'Disable'}
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                      <p className="text-xs text-gray-400 mt-3">{USER_MANAGEMENT_FIELD_HELP.rowActions.inline}</p>
                    </div>
                  </>
                )}
              </TooltipProvider>
            </TabsContent>

  );
}
