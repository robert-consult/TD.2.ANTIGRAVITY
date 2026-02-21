import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { queryClient, apiRequest } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';
import { FileText, CheckCircle, Globe, Shield, AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import AdminLegalDocsPage from '@/pages/AdminLegalDocs';
import AdminLegalAcceptancesPage from '@/pages/AdminLegalAcceptances';
import { fetchWithIdentity } from '@/lib/fetchWithIdentity';

const LEGACY_DOC_FIELD_HELP = {
  docType: {
    inline: "Defines whether this record is a global master, region addendum, or country addendum document.",
    tooltip:
      "Choose the type that matches enforcement scope. Wrong type selection can cause incorrect legal resolution at signup.",
  },
  scopeKey: {
    inline: "Jurisdiction routing key used by legal resolution logic.",
    tooltip:
      "Examples: DEFAULT/ROW, REGION/EU, COUNTRY/US. Keep scope keys consistent with resolver expectations and policy records.",
  },
  version: {
    inline: "Semantic version string for this legal document revision.",
    tooltip:
      "Increment on legal text changes so acceptance records can map to immutable document versions for audit.",
  },
  locale: {
    inline: "Locale code for the document text variant.",
    tooltip:
      "Use normalized locale tags like en or en-US. Locale mismatch can cause fallback language behavior during acceptance.",
  },
  title: {
    inline: "Human-readable title shown to users and admins.",
    tooltip:
      "Keep titles explicit and stable so legal ops can quickly identify the exact agreement during support/audit workflows.",
  },
  body: {
    inline: "Full markdown body of the legal agreement text.",
    tooltip:
      "This is the canonical legal content captured by acceptance records. Draft carefully and validate formatting before activation.",
  },
} as const;

const LEGACY_ACCEPTANCES_FIELD_HELP = {
  validateAcceptance: {
    inline: "Runs a verification check for the selected acceptance record.",
    tooltip:
      "Use when investigating integrity concerns. Validation confirms hash/token continuity for that acceptance event.",
  },
} as const;

const LEGAL_COVERAGE_FIELD_HELP = {
  coverageEnforcement: {
    inline: "Block signup in jurisdictions that do not have active legal coverage.",
    tooltip:
      "Fail-closed control for uncovered jurisdictions. Keep on for strict legal gating; disable only with explicit policy approval.",
  },
  restrictedCountriesCsv: {
    inline: "ISO2 jurisdictions blocked at signup and legal resolution.",
    tooltip:
      "Enter uppercase ISO2 values separated by commas/spaces/newlines. This list should align with sanctions/compliance policy.",
  },
  restrictedMessage: {
    inline: "Public-facing message shown when a jurisdiction is restricted.",
    tooltip:
      "Use neutral compliance-safe language. Avoid exposing internal decision logic or legal strategy details.",
  },
  countryCheckIso2: {
    inline: "Test a specific ISO2 jurisdiction against current legal coverage and restrictions.",
    tooltip:
      "Diagnostic utility to confirm allow/block outcomes before rollout. Useful for QA and incident triage.",
  },
} as const;

function LegalFieldHintLabel({
  label,
  hint,
  labelClassName = "text-sm font-medium",
}: {
  label: string;
  hint: string;
  labelClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className={labelClassName}>{label}</Label>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
            aria-label={`${label} hint`}
          >
            Hint
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
          {hint}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export function AdminLegalDocs() {
  const { toast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [newDoc, setNewDoc] = useState({ docType: 'GLOBAL_MASTER_TERMS', scopeKey: 'DEFAULT/ROW', version: '1.0.0', locale: 'en', title: '', body: '' });
  
  const { data, isLoading, refetch } = useQuery<{ documents: any[], pagination: any }>({
    queryKey: ['/api/admin/legal-docs'],
  });
  
  const createMutation = useMutation({
    mutationFn: (doc: typeof newDoc) => apiRequest('POST', '/api/admin/legal-docs', doc),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/legal-docs'] }); setShowCreate(false); toast({ title: 'Document created' }); },
    onError: () => toast({ title: 'Error creating document', variant: 'destructive' }),
  });
  
  const activateMutation = useMutation({
    mutationFn: (id: number) => apiRequest('POST', `/api/admin/legal-docs/${id}/activate`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/legal-docs'] }); toast({ title: 'Document activated' }); },
  });
  
  return (
    <TooltipProvider delayDuration={120}>
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
        <div>
          <h3 className="text-lg font-semibold">Legal Documents</h3>
          <p className="text-sm text-muted-foreground">Manage terms, addendums, and legal agreements</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => refetch()}><RefreshCw className="w-4 h-4 mr-1" />Refresh</Button>
          <Dialog open={showCreate} onOpenChange={setShowCreate}>
            <DialogTrigger asChild><Button size="sm"><Plus className="w-4 h-4 mr-1" />New Document</Button></DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader><DialogTitle>Create Legal Document</DialogTitle></DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <LegalFieldHintLabel label="Document Type" hint={LEGACY_DOC_FIELD_HELP.docType.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.docType.inline}</p>
                    <Select value={newDoc.docType} onValueChange={v => setNewDoc({...newDoc, docType: v})}>
                      <SelectTrigger title={LEGACY_DOC_FIELD_HELP.docType.tooltip}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GLOBAL_MASTER_TERMS">Global Master Terms</SelectItem>
                        <SelectItem value="REGION_ADDENDUM">Region Addendum</SelectItem>
                        <SelectItem value="COUNTRY_ADDENDUM">Country Addendum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <LegalFieldHintLabel label="Scope Key" hint={LEGACY_DOC_FIELD_HELP.scopeKey.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.scopeKey.inline}</p>
                    <Input
                      value={newDoc.scopeKey}
                      onChange={e => setNewDoc({...newDoc, scopeKey: e.target.value})}
                      placeholder="DEFAULT/ROW, REGION/EU, COUNTRY/US"
                      title={LEGACY_DOC_FIELD_HELP.scopeKey.tooltip}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <LegalFieldHintLabel label="Version (semver)" hint={LEGACY_DOC_FIELD_HELP.version.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.version.inline}</p>
                    <Input
                      value={newDoc.version}
                      onChange={e => setNewDoc({...newDoc, version: e.target.value})}
                      placeholder="1.0.0"
                      title={LEGACY_DOC_FIELD_HELP.version.tooltip}
                    />
                  </div>
                  <div>
                    <LegalFieldHintLabel label="Locale" hint={LEGACY_DOC_FIELD_HELP.locale.tooltip} />
                    <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.locale.inline}</p>
                    <Input
                      value={newDoc.locale}
                      onChange={e => setNewDoc({...newDoc, locale: e.target.value})}
                      placeholder="en"
                      title={LEGACY_DOC_FIELD_HELP.locale.tooltip}
                    />
                  </div>
                </div>
                <div>
                  <LegalFieldHintLabel label="Title" hint={LEGACY_DOC_FIELD_HELP.title.tooltip} />
                  <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.title.inline}</p>
                  <Input
                    value={newDoc.title}
                    onChange={e => setNewDoc({...newDoc, title: e.target.value})}
                    placeholder="TradeQuip Terms of Service"
                    title={LEGACY_DOC_FIELD_HELP.title.tooltip}
                  />
                </div>
                <div>
                  <LegalFieldHintLabel label="Body (Markdown)" hint={LEGACY_DOC_FIELD_HELP.body.tooltip} />
                  <p className="text-xs text-gray-400 mt-1">{LEGACY_DOC_FIELD_HELP.body.inline}</p>
                  <Textarea
                    value={newDoc.body}
                    onChange={e => setNewDoc({...newDoc, body: e.target.value})}
                    rows={10}
                    placeholder="# Terms of Service..."
                    title={LEGACY_DOC_FIELD_HELP.body.tooltip}
                  />
                </div>
              </div>
              <Button onClick={() => createMutation.mutate(newDoc)} disabled={createMutation.isPending}>Create Document</Button>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
        Legal document fields include hidden <span className="font-medium">Hint</span> explainers for scope, versioning, and audit integrity.
      </div>
      
      {isLoading ? <p>Loading...</p> : (
        <div className="overflow-x-auto -mx-2 px-2">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="whitespace-nowrap">Title</TableHead>
              <TableHead className="whitespace-nowrap">Type</TableHead>
              <TableHead className="whitespace-nowrap">Scope</TableHead>
              <TableHead className="whitespace-nowrap">Version</TableHead>
              <TableHead className="whitespace-nowrap">Status</TableHead>
              <TableHead className="whitespace-nowrap">Actions</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.documents?.map((doc: any) => (
                <TableRow key={doc.id}>
                  <TableCell className="font-medium whitespace-nowrap">{doc.title}</TableCell>
                  <TableCell><Badge variant="outline" className="whitespace-nowrap">{doc.doc_type}</Badge></TableCell>
                  <TableCell><code className="text-xs whitespace-nowrap">{doc.scope_key}</code></TableCell>
                  <TableCell className="whitespace-nowrap">{doc.version}</TableCell>
                  <TableCell>{doc.is_active ? <Badge className="bg-green-500">Active</Badge> : <Badge variant="secondary">Draft</Badge>}</TableCell>
                  <TableCell>
                    {!doc.is_active && <Button size="sm" variant="outline" onClick={() => activateMutation.mutate(doc.id)}>Activate</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export function AdminLegalAcceptances() {
  const { data, isLoading } = useQuery<{ acceptances: any[], pagination: any }>({
    queryKey: ['/api/admin/legal-docs/acceptances/list'],
  });
  
  const validateMutation = useMutation({
    mutationFn: (id: number) => fetchWithIdentity(`/api/admin/legal-docs/acceptances/${id}/validate`).then(r => r.json()),
  });
  
  return (
    <TooltipProvider delayDuration={120}>
    <div className="space-y-4">
      <div><h3 className="text-lg font-semibold">Legal Acceptances</h3><p className="text-sm text-muted-foreground">Hash-chained tamper-evident acceptance ledger</p></div>
      <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
        Acceptance verification controls include hidden <span className="font-medium">Hint</span> explainers for integrity checks and audit diagnostics.
      </div>
      {isLoading ? <p>Loading...</p> : (
        <div className="overflow-x-auto -mx-2 px-2">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="whitespace-nowrap">User</TableHead>
              <TableHead className="whitespace-nowrap">Document</TableHead>
              <TableHead className="whitespace-nowrap">Version</TableHead>
              <TableHead className="whitespace-nowrap">Accepted At</TableHead>
              <TableHead className="whitespace-nowrap">Verified</TableHead>
              <TableHead className="whitespace-nowrap">Validate</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {data?.acceptances?.map((a: any) => (
                <TableRow key={a.id}>
                  <TableCell className="whitespace-nowrap">{a.email || a.username}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.doc_title}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.doc_version}</TableCell>
                  <TableCell className="whitespace-nowrap">{new Date(a.accepted_at * 1000).toLocaleString()}</TableCell>
                  <TableCell>{a.terms_token_verified ? <CheckCircle className="w-4 h-4 text-green-500" /> : <AlertTriangle className="w-4 h-4 text-yellow-500" />}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => validateMutation.mutate(a.id)}
                        title={LEGACY_ACCEPTANCES_FIELD_HELP.validateAcceptance.tooltip}
                      >
                        <Shield className="w-4 h-4" />
                      </Button>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="text-[11px] font-medium text-cyan-300 underline decoration-dotted underline-offset-2 hover:text-cyan-200"
                            aria-label="Validate acceptance hint"
                          >
                            Hint
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-sm text-xs leading-relaxed">
                          {LEGACY_ACCEPTANCES_FIELD_HELP.validateAcceptance.tooltip}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                    <p className="text-xs text-gray-400 mt-1">{LEGACY_ACCEPTANCES_FIELD_HELP.validateAcceptance.inline}</p>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
    </TooltipProvider>
  );
}

export function AdminLegalCoverage() {
  const { toast } = useToast();
  const { data: stats } = useQuery<any>({ queryKey: ['/api/admin/legal-docs-v2/coverage/stats'] });
  const { data: enforcement } = useQuery<{ enforced: boolean }>({ queryKey: ['/api/admin/legal-docs-v2/system-config/enforcement'] });
  const { data: restrictions } = useQuery<any>({ queryKey: ['/api/admin/system-config/jurisdiction-restrictions'] });

  const [restrictedCountriesCsv, setRestrictedCountriesCsv] = useState("");
  const [restrictedMessage, setRestrictedMessage] = useState("");
  const [countryCheckIso2, setCountryCheckIso2] = useState("");

  useEffect(() => {
    if (!restrictions) return;
    setRestrictedCountriesCsv(String(restrictions.restrictedCountriesCsv ?? ""));
    setRestrictedMessage(String(restrictions.restrictedMessage ?? ""));
  }, [restrictions]);
  
  const toggleMutation = useMutation({
    mutationFn: (enforce: boolean) => apiRequest('PATCH', '/api/admin/legal-docs-v2/system-config/enforcement', { enforce }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['/api/admin/legal-docs-v2/system-config/enforcement'] }); toast({ title: 'Enforcement updated' }); },
  });

  const saveRestrictionsMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/admin/system-config/jurisdiction-restrictions", {
        restrictedCountriesCsv,
        restrictedMessage,
      }),
    onSuccess: async () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config/jurisdiction-restrictions"] });
      toast({ title: "Restrictions updated" });
    },
    onError: () => toast({ title: "Failed to update restrictions", variant: "destructive" }),
  });

  const checkMutation = useMutation({
    mutationFn: async () => {
      const iso2 = countryCheckIso2.trim().toUpperCase();
      const res = await apiRequest("GET", `/api/legal/doc1/availability?country=${encodeURIComponent(iso2)}`);
      return await res.json();
    },
    onError: () => toast({ title: "Country check failed", variant: "destructive" }),
  });
  
  return (
    <TooltipProvider delayDuration={120}>
    <div className="space-y-6">
      <div><h3 className="text-lg font-semibold">Coverage & Enforcement</h3><p className="text-sm text-muted-foreground">Jurisdiction coverage and signup gate controls</p></div>
      <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
        Coverage controls include hidden <span className="font-medium">Hint</span> explainers for legal gating behavior and jurisdiction policy impact.
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Countries Covered</CardTitle></CardHeader><CardContent><div className="text-2xl font-bold">{stats?.totalCountriesCovered || 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Regions with Terms</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{stats?.regionsCovered?.map((r: string) => <Badge key={r} variant="secondary">{r}</Badge>)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Country-Specific Terms</CardTitle></CardHeader><CardContent><div className="flex flex-wrap gap-1">{stats?.countriesWithExplicitTerms?.map((c: string) => <Badge key={c}>{c}</Badge>)}</div></CardContent></Card>
      </div>
      
       <Card>
         <CardHeader><CardTitle className="text-sm font-medium flex items-center gap-2"><Shield className="w-4 h-4" />Coverage Enforcement</CardTitle>
           <CardDescription>When enabled, users from jurisdictions without active terms cannot sign up</CardDescription>
         </CardHeader>
         <CardContent>
           <div className="flex items-center gap-4">
             <div className="w-full">
               <LegalFieldHintLabel
                 label="Coverage Enforcement"
                 hint={LEGAL_COVERAGE_FIELD_HELP.coverageEnforcement.tooltip}
                 labelClassName="text-sm font-medium"
               />
               <p className="text-xs text-gray-400 mt-1">{LEGAL_COVERAGE_FIELD_HELP.coverageEnforcement.inline}</p>
             </div>
             <Switch checked={enforcement?.enforced || false} onCheckedChange={(v) => toggleMutation.mutate(v)} />
             <span>{enforcement?.enforced ? 'Enforcement ON - Signup blocked for uncovered jurisdictions' : 'Enforcement OFF - All users can sign up with fallback terms'}</span>
           </div>
         </CardContent>
       </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2"><AlertTriangle className="w-4 h-4" />Restricted Jurisdictions</CardTitle>
          <CardDescription>Blocked at signup and legal-doc resolution (ISO2 list)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2">
            <LegalFieldHintLabel
              label="Restricted ISO2 (comma/space/newline separated)"
              hint={LEGAL_COVERAGE_FIELD_HELP.restrictedCountriesCsv.tooltip}
            />
            <p className="text-xs text-gray-400">{LEGAL_COVERAGE_FIELD_HELP.restrictedCountriesCsv.inline}</p>
            <Textarea
              value={restrictedCountriesCsv}
              onChange={(e) => setRestrictedCountriesCsv(e.target.value)}
              placeholder="KP, IR, CU, SY"
              className="min-h-[72px]"
              title={LEGAL_COVERAGE_FIELD_HELP.restrictedCountriesCsv.tooltip}
            />
          </div>
          <div className="grid gap-2">
            <LegalFieldHintLabel label="Restriction Message" hint={LEGAL_COVERAGE_FIELD_HELP.restrictedMessage.tooltip} />
            <p className="text-xs text-gray-400">{LEGAL_COVERAGE_FIELD_HELP.restrictedMessage.inline}</p>
            <Input
              value={restrictedMessage}
              onChange={(e) => setRestrictedMessage(e.target.value)}
              placeholder="This jurisdiction is not supported due to regulatory restrictions."
              title={LEGAL_COVERAGE_FIELD_HELP.restrictedMessage.tooltip}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => saveRestrictionsMutation.mutate()} disabled={saveRestrictionsMutation.isPending}>
              Save
            </Button>
            <div className="flex flex-wrap gap-1">
              {(restrictions?.countries ?? []).map((c: string) => (
                <Badge key={c} variant="secondary">{c}</Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2"><Globe className="w-4 h-4" />Country Check</CardTitle>
          <CardDescription>Explains allow/block result for a specific jurisdiction</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="w-full sm:max-w-[240px]">
              <LegalFieldHintLabel label="Country ISO2" hint={LEGAL_COVERAGE_FIELD_HELP.countryCheckIso2.tooltip} />
              <p className="text-xs text-gray-400 mt-1">{LEGAL_COVERAGE_FIELD_HELP.countryCheckIso2.inline}</p>
            </div>
            <Input
              value={countryCheckIso2}
              onChange={(e) => setCountryCheckIso2(e.target.value)}
              placeholder="US"
              className="sm:max-w-[120px]"
              title={LEGAL_COVERAGE_FIELD_HELP.countryCheckIso2.tooltip}
            />
            <Button size="sm" variant="outline" onClick={() => checkMutation.mutate()} disabled={checkMutation.isPending}>
              Check
            </Button>
          </div>

          {checkMutation.data ? (
            <div className="grid gap-1 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={checkMutation.data.signupAllowed ? "default" : "destructive"}>
                  {checkMutation.data.signupAllowed ? "Signup Allowed" : "Signup Blocked"}
                </Badge>
                {checkMutation.data.restricted ? <Badge variant="destructive">Restricted</Badge> : null}
                {checkMutation.data.fallbackUsed ? <Badge variant="secondary">Fallback Terms</Badge> : null}
                {checkMutation.data.enforced ? <Badge variant="secondary">Enforced</Badge> : <Badge variant="outline">Not Enforced</Badge>}
              </div>
              <div className="text-muted-foreground">{String(checkMutation.data.message ?? "")}</div>
              {checkMutation.data.scopeKey ? <div className="text-xs">Scope: <span className="font-mono">{checkMutation.data.scopeKey}</span></div> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

export function AdminLegalPanel() {
  const [activeTab, setActiveTab] = useState("documents-v2");

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const target =
        detail?.target ||
        (detail?.systemConfigTabKey === "legalDocs"
          ? "legal-docs"
          : detail?.systemConfigTabKey === "legalAcceptances"
            ? "legal-acceptances"
            : null);

      if (target === "legal-docs" || target === "AdminLegalDocs") {
        setActiveTab("documents-v2");
      } else if (target === "legal-acceptances" || target === "AdminLegalAcceptances") {
        setActiveTab("acceptances-v2");
      }
    };
    window.addEventListener("admin:navigate", handler);
    return () => window.removeEventListener("admin:navigate", handler);
  }, []);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="mb-4 w-full flex">
        <TabsTrigger value="documents-v2" className="flex-1 text-xs sm:text-sm px-1 sm:px-3" title="Documents (DB)">
          <FileText className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Docs</span>
        </TabsTrigger>
        <TabsTrigger value="acceptances-v2" className="flex-1 text-xs sm:text-sm px-1 sm:px-3" title="Acceptances">
          <CheckCircle className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Accept</span>
        </TabsTrigger>
        <TabsTrigger value="coverage" className="flex-1 text-xs sm:text-sm px-1 sm:px-3" title="Coverage">
          <Globe className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Coverage</span>
        </TabsTrigger>
        <TabsTrigger value="documents-legacy" className="flex-1 text-xs sm:text-sm px-1 sm:px-3" title="Legacy Docs">
          <FileText className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Legacy</span>
        </TabsTrigger>
        <TabsTrigger value="acceptances-legacy" className="flex-1 text-xs sm:text-sm px-1 sm:px-3" title="Legacy Acceptances">
          <CheckCircle className="w-4 h-4 sm:mr-1" />
          <span className="hidden sm:inline">Acc-L</span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="documents-v2" className="mt-4"><AdminLegalDocsPage /></TabsContent>
      <TabsContent value="acceptances-v2" className="mt-4"><AdminLegalAcceptancesPage /></TabsContent>
      <TabsContent value="coverage" className="mt-4"><AdminLegalCoverage /></TabsContent>
      <TabsContent value="documents-legacy" className="mt-4"><AdminLegalDocs /></TabsContent>
      <TabsContent value="acceptances-legacy" className="mt-4"><AdminLegalAcceptances /></TabsContent>
    </Tabs>
  );
}
