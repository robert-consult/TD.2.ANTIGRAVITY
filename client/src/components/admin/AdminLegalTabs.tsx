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
import { useToast } from '@/hooks/use-toast';
import { FileText, CheckCircle, Globe, Shield, AlertTriangle, Plus, RefreshCw } from 'lucide-react';
import AdminLegalDocsPage from '@/pages/AdminLegalDocs';
import AdminLegalAcceptancesPage from '@/pages/AdminLegalAcceptances';
import { fetchWithIdentity } from '@/lib/fetchWithIdentity';

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
                  <div><Label>Document Type</Label>
                    <Select value={newDoc.docType} onValueChange={v => setNewDoc({...newDoc, docType: v})}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="GLOBAL_MASTER_TERMS">Global Master Terms</SelectItem>
                        <SelectItem value="REGION_ADDENDUM">Region Addendum</SelectItem>
                        <SelectItem value="COUNTRY_ADDENDUM">Country Addendum</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Scope Key</Label><Input value={newDoc.scopeKey} onChange={e => setNewDoc({...newDoc, scopeKey: e.target.value})} placeholder="DEFAULT/ROW, REGION/EU, COUNTRY/US" /></div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>Version (semver)</Label><Input value={newDoc.version} onChange={e => setNewDoc({...newDoc, version: e.target.value})} placeholder="1.0.0" /></div>
                  <div><Label>Locale</Label><Input value={newDoc.locale} onChange={e => setNewDoc({...newDoc, locale: e.target.value})} placeholder="en" /></div>
                </div>
                <div><Label>Title</Label><Input value={newDoc.title} onChange={e => setNewDoc({...newDoc, title: e.target.value})} placeholder="TradeQuip Terms of Service" /></div>
                <div><Label>Body (Markdown)</Label><Textarea value={newDoc.body} onChange={e => setNewDoc({...newDoc, body: e.target.value})} rows={10} placeholder="# Terms of Service..." /></div>
              </div>
              <Button onClick={() => createMutation.mutate(newDoc)} disabled={createMutation.isPending}>Create Document</Button>
            </DialogContent>
          </Dialog>
        </div>
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
    <div className="space-y-4">
      <div><h3 className="text-lg font-semibold">Legal Acceptances</h3><p className="text-sm text-muted-foreground">Hash-chained tamper-evident acceptance ledger</p></div>
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
                  <TableCell><Button size="sm" variant="ghost" onClick={() => validateMutation.mutate(a.id)}><Shield className="w-4 h-4" /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
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
    <div className="space-y-6">
      <div><h3 className="text-lg font-semibold">Coverage & Enforcement</h3><p className="text-sm text-muted-foreground">Jurisdiction coverage and signup gate controls</p></div>
      
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
            <Label>Restricted ISO2 (comma/space/newline separated)</Label>
            <Textarea
              value={restrictedCountriesCsv}
              onChange={(e) => setRestrictedCountriesCsv(e.target.value)}
              placeholder="KP, IR, CU, SY"
              className="min-h-[72px]"
            />
          </div>
          <div className="grid gap-2">
            <Label>Restriction Message</Label>
            <Input
              value={restrictedMessage}
              onChange={(e) => setRestrictedMessage(e.target.value)}
              placeholder="This jurisdiction is not supported due to regulatory restrictions."
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
            <Input
              value={countryCheckIso2}
              onChange={(e) => setCountryCheckIso2(e.target.value)}
              placeholder="US"
              className="sm:max-w-[120px]"
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
