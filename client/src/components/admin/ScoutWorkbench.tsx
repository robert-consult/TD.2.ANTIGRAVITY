import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { z } from "zod";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useMailboxE2eeBootstrap } from "@/hooks/use-mailbox";
import ScoutChallengesPanel from "@/components/admin/ScoutChallengesPanel";
import { FeatureErrorBoundary } from "@/components/app/FeatureErrorBoundary";

import { PIPELINE_STAGES, LEADERBOARD_MODES, PARTNER_GATE_LEVEL_OPTIONS, PartnerGateLevel, PartnerGateDraft, CandidateRow, CandidateDetailRow, ScoutConfig, WatchlistRow, PartnerRow, InquiryRoutingAdminRow, InquiryRoutingResp, ScoutInquiryRow, ScoutInquiryListResp, ScoutMailboxMessage, ScoutMailboxThreadResp, InquiryRoutingDraft, CrmDraft, candidateRowSchema, watchlistRowSchema, candidateDetailRowSchema, scoutConfigSchema, partnerRowSchema, inquiryRoutingRespSchema, scoutInquiryListRespSchema, scoutMailboxThreadRespSchema, candidatesRespSchema, watchlistRespSchema, candidateDetailRespSchema, configRespSchema, partnersRespSchema, partnerCreateRespSchema, partnerInviteRespSchema, partnerPatchRespSchema, genericMutationRespSchema, parseApiPayload, readApiErrorMessage, createIdempotencyKey, formatPct, formatUsd, formatWhen, clampInviteExpiryDays, DEFAULT_PARTNER_GATE_DRAFT, parsePartnerGateDraft } from "./scout-workbench/support";
function ScoutWorkbenchContent() {
  useMailboxE2eeBootstrap();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("discovery");

  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<number | null>(null);
  const [inquiryStatusFilter, setInquiryStatusFilter] = useState("");
  const [selectedInquiryThreadId, setSelectedInquiryThreadId] = useState<number | null>(null);

  const [configDraft, setConfigDraft] = useState<ScoutConfig | null>(null);
  const [inquiryRoutingDraft, setInquiryRoutingDraft] = useState<InquiryRoutingDraft | null>(null);
  const [crmDrafts, setCrmDrafts] = useState<Record<number, CrmDraft>>({});
  const [crmDirtyByUser, setCrmDirtyByUser] = useState<Record<number, true>>({});

  const [newPartner, setNewPartner] = useState({ name: "", ipWhitelist: "" });
  const [lastIssuedKey, setLastIssuedKey] = useState<string | null>(null);
  const [inviteDraft, setInviteDraft] = useState({
    email: "",
    fundName: "",
    adminNotes: "",
    expiresInDays: 7,
  });
  const [inviteExpiryOverridden, setInviteExpiryOverridden] = useState(false);
  const [approvalNotesByPartner, setApprovalNotesByPartner] = useState<Record<number, string>>({});
  const [partnerGateDrafts, setPartnerGateDrafts] = useState<Record<number, PartnerGateDraft>>({});

  const candidatesQuery = useQuery<{ results: CandidateRow[]; total: number }>({
    queryKey: ["/api/admin/scout/candidates", search, stageFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "50");
      params.set("offset", "0");
      if (search.trim()) params.set("q", search.trim());
      if (stageFilter) params.set("stage", stageFilter);
      const res = await axios.get(`/api/admin/scout/candidates?${params.toString()}`);
      return parseApiPayload(candidatesRespSchema, res.data, "SCOUT_CANDIDATES_SCHEMA_INVALID");
    },
    refetchOnWindowFocus: false,
  });

  const watchlistQuery = useQuery<{ rows: WatchlistRow[] }>({
    queryKey: ["/api/admin/scout/watchlist"],
    queryFn: () =>
      axios
        .get("/api/admin/scout/watchlist")
        .then((r) => parseApiPayload(watchlistRespSchema, r.data, "SCOUT_WATCHLIST_SCHEMA_INVALID")),
    refetchOnWindowFocus: false,
  });

  const candidateDetailQuery = useQuery<{ row: CandidateDetailRow }>({
    queryKey: ["/api/admin/scout/candidates/detail", selectedCandidateId],
    queryFn: async () => {
      const id = Number(selectedCandidateId);
      const res = await axios.get(`/api/admin/scout/candidates/${id}?days=180`);
      return parseApiPayload(candidateDetailRespSchema, res.data, "SCOUT_CANDIDATE_DETAIL_SCHEMA_INVALID");
    },
    enabled: selectedCandidateId != null,
    refetchOnWindowFocus: false,
  });

  const configQuery = useQuery<{ config: ScoutConfig }>({
    queryKey: ["/api/admin/scout/config"],
    queryFn: () =>
      axios
        .get("/api/admin/scout/config")
        .then((r) => parseApiPayload(configRespSchema, r.data, "SCOUT_CONFIG_SCHEMA_INVALID")),
    refetchOnWindowFocus: false,
  });

  const defaultInviteExpiryDays = useMemo(
    () => clampInviteExpiryDays(configQuery.data?.config?.partnerInviteDefaultExpiryDays, 7),
    [configQuery.data?.config?.partnerInviteDefaultExpiryDays],
  );

  const partnersQuery = useQuery<{ rows: PartnerRow[] }>({
    queryKey: ["/api/admin/partners"],
    queryFn: () =>
      axios
        .get("/api/admin/partners")
        .then((r) => parseApiPayload(partnersRespSchema, r.data, "SCOUT_PARTNERS_SCHEMA_INVALID")),
    refetchOnWindowFocus: false,
  });

  const inquiryRoutingQuery = useQuery<InquiryRoutingResp>({
    queryKey: ["/api/admin/scout/inquiry-routing"],
    queryFn: () =>
      axios
        .get("/api/admin/scout/inquiry-routing")
        .then((r) => parseApiPayload(inquiryRoutingRespSchema, r.data, "SCOUT_INQUIRY_ROUTING_SCHEMA_INVALID")),
    refetchOnWindowFocus: false,
  });

  const inquiriesQuery = useQuery<ScoutInquiryListResp>({
    queryKey: ["/api/admin/scout/inquiries", inquiryStatusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("limit", "120");
      params.set("offset", "0");
      if (inquiryStatusFilter) params.set("status", inquiryStatusFilter);
      const res = await axios.get(`/api/admin/scout/inquiries?${params.toString()}`);
      return parseApiPayload(scoutInquiryListRespSchema, res.data, "SCOUT_INQUIRIES_SCHEMA_INVALID");
    },
    refetchOnWindowFocus: false,
  });

  const inquiryThreadQuery = useQuery<ScoutMailboxThreadResp>({
    queryKey: ["/api/mailbox/thread", selectedInquiryThreadId],
    queryFn: async () => {
      const id = Number(selectedInquiryThreadId);
      const res = await axios.get(`/api/mailbox/${id}?limit=120`);
      return parseApiPayload(scoutMailboxThreadRespSchema, res.data, "SCOUT_MAILBOX_THREAD_SCHEMA_INVALID");
    },
    enabled: selectedInquiryThreadId != null,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!configQuery.data?.config) return;
    const cfg = configQuery.data.config;
    setConfigDraft({
      ...cfg,
      partnerGatingConfig: cfg.partnerGatingConfig ?? {
        viewDataRoom: "INVITED",
        runSimulations: "IDENTITY",
        requestAllocation: "COMPLIANT",
        directContact: "ADMIN_APPROVED",
      },
      partnerPasswordRotationDays: Number(cfg.partnerPasswordRotationDays ?? 90),
      partnerPasswordReminderLogins: Number(cfg.partnerPasswordReminderLogins ?? 3),
      partnerInviteDefaultExpiryDays: Number(cfg.partnerInviteDefaultExpiryDays ?? 7),
    });
  }, [configQuery.data?.config]);

  useEffect(() => {
    if (inviteExpiryOverridden) return;
    setInviteDraft((prev) => {
      if (prev.expiresInDays === defaultInviteExpiryDays) return prev;
      return { ...prev, expiresInDays: defaultInviteExpiryDays };
    });
  }, [defaultInviteExpiryDays, inviteExpiryOverridden]);

  useEffect(() => {
    if (!inquiryRoutingQuery.data?.config) return;
    setInquiryRoutingDraft({
      inboxAlias: inquiryRoutingQuery.data.config.inboxAlias || "inquiries@",
      routeAdminEmails: [...(inquiryRoutingQuery.data.config.routeAdminEmails ?? [])],
      viewerAdminEmails: [...(inquiryRoutingQuery.data.config.viewerAdminEmails ?? [])],
    });
  }, [inquiryRoutingQuery.data?.config]);

  useEffect(() => {
    const rows = watchlistQuery.data?.rows ?? [];
    setCrmDrafts((prev) => {
      let changed = Object.keys(prev).length !== rows.length;
      const next: Record<number, CrmDraft> = {};
      for (const row of rows) {
        const serverDraft: CrmDraft = {
          stage: row.pipeline.stage,
          isPartnerVisible: row.pipeline.isPartnerVisible,
          tier: row.tier,
          notes: row.notes ?? "",
        };
        const preserved = crmDirtyByUser[row.userId] ? prev[row.userId] : undefined;
        const candidate = preserved ?? serverDraft;
        next[row.userId] = candidate;

        const prevDraft = prev[row.userId];
        if (
          !prevDraft ||
          prevDraft.stage !== candidate.stage ||
          prevDraft.isPartnerVisible !== candidate.isPartnerVisible ||
          prevDraft.tier !== candidate.tier ||
          prevDraft.notes !== candidate.notes
        ) {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [watchlistQuery.data?.rows, crmDirtyByUser]);

  useEffect(() => {
    const rows = watchlistQuery.data?.rows ?? [];
    const allowedUserIds = new Set(rows.map((row) => Number(row.userId)));
    setCrmDirtyByUser((prev) => {
      let changed = false;
      const next: Record<number, true> = {};
      for (const key of Object.keys(prev)) {
        const userId = Number(key);
        if (allowedUserIds.has(userId)) {
          next[userId] = true;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [watchlistQuery.data?.rows]);

  useEffect(() => {
    const rows = inquiriesQuery.data?.rows ?? [];
    if (!rows.length) {
      setSelectedInquiryThreadId(null);
      return;
    }
    if (
      selectedInquiryThreadId &&
      rows.some((row) => Number(row.mailboxThreadId || 0) === Number(selectedInquiryThreadId))
    ) {
      return;
    }
    const firstThreadId = rows.find((row) => Number(row.mailboxThreadId || 0) > 0)?.mailboxThreadId ?? null;
    setSelectedInquiryThreadId(firstThreadId ? Number(firstThreadId) : null);
  }, [inquiriesQuery.data?.rows, selectedInquiryThreadId]);

  useEffect(() => {
    const rows = partnersQuery.data?.rows ?? [];
    if (!rows.length) return;
    const fallbackFromConfig: PartnerGateDraft = configDraft?.partnerGatingConfig
      ? {
          viewDataRoom: configDraft.partnerGatingConfig.viewDataRoom,
          runSimulations: configDraft.partnerGatingConfig.runSimulations,
          requestAllocation: configDraft.partnerGatingConfig.requestAllocation,
          directContact: configDraft.partnerGatingConfig.directContact,
        }
      : DEFAULT_PARTNER_GATE_DRAFT;

    setPartnerGateDrafts((prev) => {
      let changed = false;
      const next: Record<number, PartnerGateDraft> = { ...prev };
      const seen = new Set<number>();
      for (const row of rows) {
        seen.add(Number(row.id));
        const parsed = parsePartnerGateDraft(row.gating_overrides, fallbackFromConfig);
        const current = next[row.id];
        if (
          !current ||
          current.viewDataRoom !== parsed.viewDataRoom ||
          current.runSimulations !== parsed.runSimulations ||
          current.requestAllocation !== parsed.requestAllocation ||
          current.directContact !== parsed.directContact
        ) {
          next[row.id] = parsed;
          changed = true;
        }
      }
      for (const idText of Object.keys(next)) {
        const id = Number(idText);
        if (!seen.has(id)) {
          delete next[id];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [
    partnersQuery.data?.rows,
    configDraft?.partnerGatingConfig?.viewDataRoom,
    configDraft?.partnerGatingConfig?.runSimulations,
    configDraft?.partnerGatingConfig?.requestAllocation,
    configDraft?.partnerGatingConfig?.directContact,
  ]);

  const addWatchlistMutation = useMutation({
    mutationFn: (payload: { userId: number; tier?: string; notes?: string | null }) =>
      axios
        .post("/api/admin/scout/watchlist", payload)
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_WATCHLIST_UPSERT_SCHEMA_INVALID")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/candidates"] });
    },
  });

  const removeWatchlistMutation = useMutation({
    mutationFn: (id: number) =>
      axios
        .delete(`/api/admin/scout/watchlist/${id}`)
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_WATCHLIST_DELETE_SCHEMA_INVALID")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/candidates"] });
    },
  });

  const updatePipelineMutation = useMutation({
    mutationFn: (payload: {
      userId: number;
      stage: string;
      isPartnerVisible: boolean;
    }) =>
      axios
        .put(`/api/admin/scout/pipeline/${payload.userId}`, payload, {
          headers: { "x-idempotency-key": createIdempotencyKey("scout-pipeline") },
        })
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_PIPELINE_UPDATE_SCHEMA_INVALID")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/watchlist"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/candidates"] });
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: (payload: Partial<ScoutConfig>) =>
      axios
        .put("/api/admin/scout/config", payload)
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_CONFIG_UPDATE_SCHEMA_INVALID")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/config"] });
      toast({ title: "Scout config saved" });
    },
    onError: (error: unknown) => {
      const fieldErrors = axios.isAxiosError(error) ? error.response?.data?.errors?.fieldErrors : undefined;
      const firstField = fieldErrors && typeof fieldErrors === "object" ? Object.keys(fieldErrors)[0] : null;
      const firstMessage =
        firstField && Array.isArray(fieldErrors[firstField]) ? String(fieldErrors[firstField][0] || "") : "";
      toast({
        title: "Failed to save scout config",
        description: firstMessage || readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const createPartnerMutation = useMutation({
    mutationFn: (payload: typeof newPartner) =>
      axios
        .post("/api/admin/partners", payload, {
          headers: { "x-idempotency-key": createIdempotencyKey("partner-create") },
        })
        .then((r) => parseApiPayload(partnerCreateRespSchema, r.data, "SCOUT_PARTNER_CREATE_SCHEMA_INVALID")),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      setNewPartner({ name: "", ipWhitelist: "" });
      setLastIssuedKey(String(data?.apiKey || ""));
      toast({ title: "Partner created", description: "Copy the API key now." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Failed to create partner",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const invitePartnerMutation = useMutation({
    mutationFn: (payload: typeof inviteDraft) =>
      axios
        .post("/api/admin/partners/invite", {
          email: payload.email,
          fundName: payload.fundName || null,
          adminNotes: payload.adminNotes || null,
          expiresInDays: payload.expiresInDays,
        }, {
          headers: { "x-idempotency-key": createIdempotencyKey("partner-invite") },
        })
        .then((r) => parseApiPayload(partnerInviteRespSchema, r.data, "SCOUT_PARTNER_INVITE_SCHEMA_INVALID")),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      setInviteDraft({
        email: "",
        fundName: "",
        adminNotes: "",
        expiresInDays: defaultInviteExpiryDays,
      });
      setInviteExpiryOverridden(false);
      const apiKey = String(data?.credentials?.apiKey || "");
      const username = String(data?.credentials?.username || "");
      const tempPassword = String(data?.credentials?.tempPassword || "");
      setLastIssuedKey(apiKey || null);
      toast({
        title: "Partner invited",
        description:
          username && tempPassword
            ? `Credentials issued for ${username}. Email status: ${String(data?.invite?.emailStatus || "QUEUED")}.`
            : "Partner invite created.",
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Failed to invite partner",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const partnerApprovalMutation = useMutation({
    mutationFn: (payload: { id: number; action: "APPROVE" | "HOLD" | "REVOKE"; adminNotes?: string }) =>
      axios
        .put(`/api/admin/partners/${payload.id}/approve`, {
          action: payload.action,
          adminNotes: payload.adminNotes || null,
        })
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_PARTNER_APPROVAL_SCHEMA_INVALID")),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      toast({ title: `Partner ${variables.action.toLowerCase()} applied` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Failed to update partner approval",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const partnerGateOverrideMutation = useMutation({
    mutationFn: (payload: { id: number; draft: PartnerGateDraft }) =>
      axios
        .put(`/api/admin/partners/${payload.id}/gating-overrides`, payload.draft)
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_GATING_OVERRIDE_SCHEMA_INVALID")),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      toast({ title: "Partner gating overrides saved", description: `Partner #${variables.id}` });
    },
    onError: (error: unknown) => {
      toast({
        title: "Failed to save gating overrides",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const patchPartnerMutation = useMutation({
    mutationFn: (payload: { id: number; patch: Record<string, unknown> }) =>
      axios
        .put(`/api/admin/partners/${payload.id}`, payload.patch)
        .then((r) => parseApiPayload(partnerPatchRespSchema, r.data, "SCOUT_PARTNER_PATCH_SCHEMA_INVALID")),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partners"] });
      if (data?.apiKey) {
        setLastIssuedKey(String(data.apiKey));
        toast({ title: "Partner key rotated", description: "Copy the new API key now." });
      }
    },
  });

  const saveInquiryRoutingMutation = useMutation({
    mutationFn: (payload: InquiryRoutingDraft) =>
      axios
        .put("/api/admin/scout/inquiry-routing", {
          inboxAlias: payload.inboxAlias.trim(),
          routeAdminEmails: payload.routeAdminEmails,
          viewerAdminEmails: payload.viewerAdminEmails,
        })
        .then((r) => parseApiPayload(genericMutationRespSchema, r.data, "SCOUT_INQUIRY_ROUTING_UPDATE_SCHEMA_INVALID")),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/inquiry-routing"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/scout/inquiries"] });
      toast({ title: "Inquiry routing saved" });
    },
    onError: (error: unknown) => {
      toast({
        title: "Failed to save inquiry routing",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    },
  });

  const candidates = candidatesQuery.data?.results ?? [];
  const watchlistRows = watchlistQuery.data?.rows ?? [];
  const partnerRows = partnersQuery.data?.rows ?? [];
  const defaultPartnerGateDraft: PartnerGateDraft = configDraft?.partnerGatingConfig
    ? {
        viewDataRoom: configDraft.partnerGatingConfig.viewDataRoom,
        runSimulations: configDraft.partnerGatingConfig.runSimulations,
        requestAllocation: configDraft.partnerGatingConfig.requestAllocation,
        directContact: configDraft.partnerGatingConfig.directContact,
      }
    : DEFAULT_PARTNER_GATE_DRAFT;
  const inquiryRows = inquiriesQuery.data?.rows ?? [];
  const routingAdmins = inquiryRoutingQuery.data?.availableAdmins ?? [];
  const selectedInquiry = inquiryRows.find(
    (row) => Number(row.mailboxThreadId || 0) === Number(selectedInquiryThreadId || 0),
  );

  const summary = useMemo(() => {
    const watched = candidates.filter((c) => c.watchlist).length;
    const ready = candidates.filter((c) => c.stage === "PARTNER_READY").length;
    return {
      total: candidatesQuery.data?.total ?? candidates.length,
      watched,
      ready,
    };
  }, [candidates, candidatesQuery.data?.total]);

  const markCrmDraftDirty = (userId: number) => {
    setCrmDirtyByUser((prev) => (prev[userId] ? prev : { ...prev, [userId]: true }));
  };

  const updateCrmDraft = (userId: number, nextDraft: CrmDraft) => {
    setCrmDrafts((prev) => ({
      ...prev,
      [userId]: nextDraft,
    }));
    markCrmDraftDirty(userId);
  };

  const upsertWatchlist = async (userId: number, tier?: string, notes?: string | null) => {
    try {
      await addWatchlistMutation.mutateAsync({ userId, tier, notes: notes ?? null });
      toast({ title: "Watchlist updated" });
    } catch (error: unknown) {
      toast({
        title: "Watchlist update failed",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const saveCrmRow = async (row: WatchlistRow) => {
    const draft = crmDrafts[row.userId];
    if (!draft) return;

    try {
      await Promise.all([
        updatePipelineMutation.mutateAsync({
          userId: row.userId,
          stage: draft.stage,
          isPartnerVisible: draft.isPartnerVisible,
        }),
        addWatchlistMutation.mutateAsync({
          userId: row.userId,
          tier: draft.tier,
          notes: draft.notes,
        }),
      ]);
      setCrmDirtyByUser((prev) => {
        if (!prev[row.userId]) return prev;
        const next = { ...prev };
        delete next[row.userId];
        return next;
      });
      toast({ title: "CRM row saved" });
    } catch (error: unknown) {
      toast({
        title: "CRM save failed",
        description: readApiErrorMessage(error) || "Unknown error",
        variant: "destructive",
      });
    }
  };

  const toggleInquiryEmail = (email: string, listKey: "routeAdminEmails" | "viewerAdminEmails", checked: boolean) => {
    setInquiryRoutingDraft((prev) => {
      if (!prev) return prev;
      const target = new Set(prev[listKey].map((entry) => entry.toLowerCase()));
      const normalized = email.trim().toLowerCase();
      if (checked) target.add(normalized);
      else target.delete(normalized);
      return {
        ...prev,
        [listKey]: Array.from(target).sort(),
      };
    });
  };

  return (
    <div className="space-y-4" data-testid="admin-scout-workbench">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card className="bg-neutral-800 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Candidates</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.total}</div>
          </CardContent>
        </Card>
        <Card className="bg-neutral-800 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">On Watchlist</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.watched}</div>
          </CardContent>
        </Card>
        <Card className="bg-neutral-800 border-gray-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Partner Ready</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-semibold">{summary.ready}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList className="bg-neutral-700 w-full h-auto p-1 grid grid-cols-2 md:grid-cols-6 gap-1">
          <TabsTrigger value="discovery" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            Discovery
          </TabsTrigger>
          <TabsTrigger value="crm" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            CRM
          </TabsTrigger>
          <TabsTrigger value="config" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            Config
          </TabsTrigger>
          <TabsTrigger value="challenges" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            Challenges
          </TabsTrigger>
          <TabsTrigger value="partners" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            Partners
          </TabsTrigger>
          <TabsTrigger value="inbox" className="data-[state=active]:bg-neutral-600 text-xs sm:text-sm px-2 py-1.5">
            Inbox
          </TabsTrigger>
        </TabsList>

        <TabsContent value="discovery" className="space-y-3">
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Discovery Engine</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search email / username / name"
                  className="bg-neutral-700 border-neutral-600"
                  data-testid="scout-discovery-search"
                />
                <select
                  value={stageFilter}
                  onChange={(e) => setStageFilter(e.target.value)}
                  className="h-10 rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                  data-testid="scout-discovery-stage"
                >
                  <option value="">All stages</option>
                  {PIPELINE_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {stage}
                    </option>
                  ))}
                </select>
                <Button
                  variant="outline"
                  className="border-neutral-600"
                  onClick={() => candidatesQuery.refetch()}
                  disabled={candidatesQuery.isFetching}
                >
                  {candidatesQuery.isFetching ? "Refreshing..." : "Refresh"}
                </Button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-700 text-gray-300">
                      <th className="py-2 text-left">Trader</th>
                      <th className="py-2 text-left">Stage</th>
                      <th className="py-2 text-right">Trades</th>
                      <th className="py-2 text-right">Net</th>
                      <th className="py-2 text-right">Sharpe</th>
                      <th className="py-2 text-left">Style</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((row) => (
                      <tr key={row.userId} className="border-b border-neutral-800/80">
                        <td className="py-2">
                          <div className="font-medium text-white">{row.username || row.name || `User #${row.userId}`}</div>
                          <div className="text-xs text-gray-400">{row.email || "-"}</div>
                        </td>
                        <td className="py-2 text-gray-300">{row.stage}</td>
                        <td className="py-2 text-right text-gray-300">{row.performance.trades}</td>
                        <td className={`py-2 text-right ${row.performance.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {formatUsd(row.performance.netProfit)}
                        </td>
                        <td className="py-2 text-right text-gray-300">
                          {row.metrics.sharpeRatio == null ? "-" : row.metrics.sharpeRatio.toFixed(2)}
                        </td>
                        <td className="py-2 text-gray-300">{row.metrics.styleCluster || "-"}</td>
                        <td className="py-2 text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600"
                            disabled={addWatchlistMutation.isPending}
                            onClick={() =>
                              upsertWatchlist(
                                row.userId,
                                row.watchlist?.tier || "B_LIST",
                                row.watchlist?.notes ?? null,
                              )
                            }
                          >
                            {row.watchlist ? "Update Watchlist" : "Add Watchlist"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="ml-2"
                            onClick={() => setSelectedCandidateId(row.userId)}
                          >
                            View Full Profile
                          </Button>
                        </td>
                      </tr>
                    ))}
                    {!candidatesQuery.isLoading && candidates.length === 0 && (
                      <tr>
                        <td colSpan={7} className="py-6 text-center text-gray-400">
                          No candidates found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {selectedCandidateId && (
                <Card className="bg-neutral-800 border-neutral-700">
                  <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <CardTitle className="text-sm">
                      Candidate Profile: {candidateDetailQuery.data?.row?.username || `User #${selectedCandidateId}`}
                    </CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedCandidateId(null)}>
                      Close
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {candidateDetailQuery.isLoading ? (
                      <div className="text-sm text-gray-400">Loading candidate profile...</div>
                    ) : candidateDetailQuery.data?.row ? (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-sm">
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-gray-400 text-xs">Stage</div>
                            <div>{candidateDetailQuery.data.row.pipeline.stage}</div>
                          </div>
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-gray-400 text-xs">Sharpe / Sortino</div>
                            <div>
                              {candidateDetailQuery.data.row.metrics.sharpeRatio == null
                                ? "-"
                                : candidateDetailQuery.data.row.metrics.sharpeRatio.toFixed(2)}
                              {" / "}
                              {candidateDetailQuery.data.row.metrics.sortinoRatio == null
                                ? "-"
                                : candidateDetailQuery.data.row.metrics.sortinoRatio.toFixed(2)}
                            </div>
                          </div>
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-gray-400 text-xs">Win Rate / Max DD</div>
                            <div>
                              {formatPct(candidateDetailQuery.data.row.performance.winRate)}
                              {" / "}
                              {formatPct(candidateDetailQuery.data.row.performance.maxDrawdown)}
                            </div>
                          </div>
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-gray-400 text-xs">Net PnL</div>
                            <div
                              className={
                                candidateDetailQuery.data.row.performance.netProfit >= 0
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              {formatUsd(candidateDetailQuery.data.row.performance.netProfit)}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-gray-400">
                          Email verified: {formatWhen(candidateDetailQuery.data.row.verification.emailVerifiedAt)} | SMS
                          verified: {formatWhen(candidateDetailQuery.data.row.verification.smsVerifiedAt)} | KYC:{" "}
                          {candidateDetailQuery.data.row.kycStatus || "-"} | Tier:{" "}
                          {candidateDetailQuery.data.row.userTier || "-"}
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-xs text-gray-400 mb-1">Attribution by Symbol</div>
                            <div className="max-h-44 overflow-auto text-xs">
                              {(candidateDetailQuery.data.row.attributionBySymbol || []).slice(0, 10).map((item) => (
                                <div key={`${item.symbol}-${item.category}`} className="flex items-center justify-between py-1">
                                  <span>
                                    {item.symbol} <span className="text-gray-500">({item.category})</span>
                                  </span>
                                  <span className={item.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                                    {formatUsd(item.netProfit)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                          <div className="rounded border border-neutral-700 p-2">
                            <div className="text-xs text-gray-400 mb-1">Attribution by Hour (UTC)</div>
                            <div className="max-h-44 overflow-auto text-xs">
                              {(candidateDetailQuery.data.row.attributionByHourUtc || []).map((item) => (
                                <div key={item.hourUtc} className="flex items-center justify-between py-1">
                                  <span>{String(item.hourUtc).padStart(2, "0")}:00</span>
                                  <span className={item.netProfit >= 0 ? "text-emerald-400" : "text-red-400"}>
                                    {formatUsd(item.netProfit)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="text-sm text-red-400">Candidate profile unavailable.</div>
                    )}
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crm" className="space-y-3">
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Recruitment CRM</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-700 text-gray-300">
                      <th className="py-2 text-left">Trader</th>
                      <th className="py-2 text-left">Stage</th>
                      <th className="py-2 text-left">Visible</th>
                      <th className="py-2 text-left">Tier</th>
                      <th className="py-2 text-left">Notes</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {watchlistRows.map((row) => {
                      const draft = crmDrafts[row.userId] ?? {
                        stage: row.pipeline.stage,
                        isPartnerVisible: row.pipeline.isPartnerVisible,
                        tier: row.tier,
                        notes: row.notes ?? "",
                      };

                      return (
                        <tr key={row.id} className="border-b border-neutral-800/80">
                          <td className="py-2">
                            <div className="font-medium text-white">{row.user.username || row.user.name || `User #${row.userId}`}</div>
                            <div className="text-xs text-gray-400">{row.user.email || "-"}</div>
                          </td>
                          <td className="py-2">
                            <select
                              value={draft.stage}
                              onChange={(e) => updateCrmDraft(row.userId, { ...draft, stage: e.target.value })}
                              className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2"
                            >
                              {PIPELINE_STAGES.map((stage) => (
                                <option key={stage} value={stage}>
                                  {stage}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2">
                            <Switch
                              checked={draft.isPartnerVisible}
                              onCheckedChange={(checked) =>
                                updateCrmDraft(row.userId, { ...draft, isPartnerVisible: Boolean(checked) })
                              }
                            />
                          </td>
                          <td className="py-2">
                            <select
                              value={draft.tier}
                              onChange={(e) => updateCrmDraft(row.userId, { ...draft, tier: e.target.value })}
                              className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2"
                            >
                              <option value="A_LIST">A_LIST</option>
                              <option value="B_LIST">B_LIST</option>
                              <option value="INCUBATOR">INCUBATOR</option>
                            </select>
                          </td>
                          <td className="py-2 min-w-[220px]">
                            <Input
                              value={draft.notes}
                              onChange={(e) => updateCrmDraft(row.userId, { ...draft, notes: e.target.value })}
                              className="bg-neutral-700 border-neutral-600"
                              placeholder="Admin notes"
                            />
                          </td>
                          <td className="py-2 text-right whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600 mr-2"
                              onClick={() => saveCrmRow(row)}
                              disabled={updatePipelineMutation.isPending || addWatchlistMutation.isPending}
                            >
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => removeWatchlistMutation.mutate(row.id)}
                              disabled={removeWatchlistMutation.isPending}
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                    {!watchlistQuery.isLoading && watchlistRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-6 text-center text-gray-400">
                          Watchlist is empty.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="space-y-3">
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Scout Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {configDraft ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span className="text-sm">Enable Partner Portal</span>
                      <Switch
                        checked={configDraft.partnerPortalEnabled}
                        onCheckedChange={(checked) =>
                          setConfigDraft((prev) => (prev ? { ...prev, partnerPortalEnabled: Boolean(checked) } : prev))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span className="text-sm">Enable Pro Profiles</span>
                      <Switch
                        checked={configDraft.traderProProfilesEnabled}
                        onCheckedChange={(checked) =>
                          setConfigDraft((prev) => (prev ? { ...prev, traderProProfilesEnabled: Boolean(checked) } : prev))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span className="text-sm">Enable Challenges</span>
                      <Switch
                        checked={configDraft.traderCompeteEnabled}
                        onCheckedChange={(checked) =>
                          setConfigDraft((prev) => (prev ? { ...prev, traderCompeteEnabled: Boolean(checked) } : prev))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span className="text-sm">Enable Community</span>
                      <Switch
                        checked={configDraft.traderCommunityEnabled}
                        onCheckedChange={(checked) =>
                          setConfigDraft((prev) => (prev ? { ...prev, traderCommunityEnabled: Boolean(checked) } : prev))
                        }
                      />
                    </label>
                    <label className="flex items-center justify-between rounded border border-neutral-700 px-3 py-2">
                      <span className="text-sm">Enable Partner Allocations</span>
                      <Switch
                        checked={configDraft.partnerAllocationsEnabled}
                        onCheckedChange={(checked) =>
                          setConfigDraft((prev) => (prev ? { ...prev, partnerAllocationsEnabled: Boolean(checked) } : prev))
                        }
                      />
                    </label>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Leaderboard Mode</div>
                      <select
                        value={configDraft.leaderboardMode}
                        onChange={(e) =>
                          setConfigDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  leaderboardMode: e.target.value as ScoutConfig["leaderboardMode"],
                                }
                              : prev,
                          )
                        }
                        className="h-10 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                      >
                        {LEADERBOARD_MODES.map((mode) => (
                          <option key={mode} value={mode}>
                            {mode}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="text-xs text-gray-400 mb-1">Sharpe Alert Threshold</div>
                      <Input
                        value={String(configDraft.scoutMinSharpeAlert)}
                        onChange={(e) =>
                          setConfigDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  scoutMinSharpeAlert: Number(e.target.value) || 0,
                                }
                              : prev,
                          )
                        }
                        inputMode="decimal"
                        className="bg-neutral-700 border-neutral-600"
                      />
                    </div>
                  </div>

                  <div className="rounded border border-neutral-700 p-3 space-y-3">
                    <div className="text-sm font-semibold">Partner Onboarding Policy</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Data Room Gate</div>
                        <select
                          value={configDraft.partnerGatingConfig.viewDataRoom}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerGatingConfig: {
                                      ...prev.partnerGatingConfig,
                                      viewDataRoom: e.target.value as ScoutConfig["partnerGatingConfig"]["viewDataRoom"],
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="h-10 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                        >
                          {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Simulation Gate</div>
                        <select
                          value={configDraft.partnerGatingConfig.runSimulations}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerGatingConfig: {
                                      ...prev.partnerGatingConfig,
                                      runSimulations:
                                        e.target.value as ScoutConfig["partnerGatingConfig"]["runSimulations"],
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="h-10 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                        >
                          {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Allocation Gate</div>
                        <select
                          value={configDraft.partnerGatingConfig.requestAllocation}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerGatingConfig: {
                                      ...prev.partnerGatingConfig,
                                      requestAllocation:
                                        e.target.value as ScoutConfig["partnerGatingConfig"]["requestAllocation"],
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="h-10 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                        >
                          {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Direct Contact Gate</div>
                        <select
                          value={configDraft.partnerGatingConfig.directContact}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerGatingConfig: {
                                      ...prev.partnerGatingConfig,
                                      directContact:
                                        e.target.value as ScoutConfig["partnerGatingConfig"]["directContact"],
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="h-10 w-full rounded-md border border-neutral-600 bg-neutral-700 px-3 text-sm"
                        >
                          {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Password Rotation Days</div>
                        <Input
                          value={String(configDraft.partnerPasswordRotationDays)}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerPasswordRotationDays: Math.max(
                                      7,
                                      Math.min(365, Number(e.target.value) || 90),
                                    ),
                                  }
                                : prev,
                            )
                          }
                          inputMode="numeric"
                          className="bg-neutral-700 border-neutral-600"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Password Reminder Logins</div>
                        <Input
                          value={String(configDraft.partnerPasswordReminderLogins)}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerPasswordReminderLogins: Math.max(
                                      1,
                                      Math.min(20, Number(e.target.value) || 3),
                                    ),
                                  }
                                : prev,
                            )
                          }
                          inputMode="numeric"
                          className="bg-neutral-700 border-neutral-600"
                        />
                      </div>
                      <div>
                        <div className="text-xs text-gray-400 mb-1">Default Invite Expiry (days)</div>
                        <Input
                          value={String(configDraft.partnerInviteDefaultExpiryDays)}
                          onChange={(e) =>
                            setConfigDraft((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    partnerInviteDefaultExpiryDays: Math.max(
                                      1,
                                      Math.min(180, Number(e.target.value) || 7),
                                    ),
                                  }
                                : prev,
                            )
                          }
                          inputMode="numeric"
                          className="bg-neutral-700 border-neutral-600"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={() => saveConfigMutation.mutate(configDraft)}
                      disabled={saveConfigMutation.isPending}
                    >
                      {saveConfigMutation.isPending ? "Saving..." : "Save Config"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-400">Loading config...</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="challenges" className="space-y-3">
          <ScoutChallengesPanel />
        </TabsContent>

        <TabsContent value="partners" className="space-y-3">
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Partner Management</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded border border-neutral-700 bg-neutral-900/50 p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-300">Invite-First Onboarding</div>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                  <Input
                    placeholder="Partner email"
                    value={inviteDraft.email}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, email: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="Fund name (optional)"
                    value={inviteDraft.fundName}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, fundName: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="Admin notes (optional)"
                    value={inviteDraft.adminNotes}
                    onChange={(e) => setInviteDraft((prev) => ({ ...prev, adminNotes: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      max={180}
                      placeholder="Expiry days"
                      value={inviteDraft.expiresInDays}
                      title={`Expires in ${inviteDraft.expiresInDays} day${inviteDraft.expiresInDays === 1 ? "" : "s"}`}
                      onChange={(e) => {
                        const nextExpiry = clampInviteExpiryDays(e.target.value, defaultInviteExpiryDays);
                        setInviteDraft((prev) => ({ ...prev, expiresInDays: nextExpiry }));
                        setInviteExpiryOverridden(nextExpiry !== defaultInviteExpiryDays);
                      }}
                      className="bg-neutral-700 border-neutral-600 w-24"
                    />
                    <Button
                      onClick={() => invitePartnerMutation.mutate(inviteDraft)}
                      disabled={invitePartnerMutation.isPending || !inviteDraft.email.trim()}
                    >
                      {invitePartnerMutation.isPending ? "Inviting..." : "Send Invite"}
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded border border-neutral-700 bg-neutral-900/50 p-3 space-y-3">
                <div className="text-xs font-semibold text-gray-300">Manual Partner Provisioning</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input
                    placeholder="Partner name"
                    value={newPartner.name}
                    onChange={(e) => setNewPartner((prev) => ({ ...prev, name: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Input
                    placeholder="IP whitelist CSV (optional)"
                    value={newPartner.ipWhitelist}
                    onChange={(e) => setNewPartner((prev) => ({ ...prev, ipWhitelist: e.target.value }))}
                    className="bg-neutral-700 border-neutral-600"
                  />
                  <Button
                    onClick={() => createPartnerMutation.mutate(newPartner)}
                    disabled={createPartnerMutation.isPending || !newPartner.name.trim()}
                  >
                    {createPartnerMutation.isPending ? "Creating..." : "Create Partner"}
                  </Button>
                </div>
              </div>

              {lastIssuedKey && (
                <div className="rounded border border-amber-500/40 bg-amber-900/20 p-3">
                  <div className="text-xs text-amber-200 mb-1">Copy this API key now (shown once):</div>
                  <code className="text-xs break-all text-amber-100">{lastIssuedKey}</code>
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-neutral-700 text-gray-300">
                      <th className="py-2 text-left">Partner</th>
                      <th className="py-2 text-left">Contact</th>
                      <th className="py-2 text-left">Invite</th>
                      <th className="py-2 text-left">Onboarding</th>
                      <th className="py-2 text-left">Key Prefix</th>
                      <th className="py-2 text-left">IP Whitelist</th>
                      <th className="py-2 text-right">Allocations</th>
                      <th className="py-2 text-right">Inquiries</th>
                      <th className="py-2 text-right">Updated</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {partnerRows.map((row) => {
                      const gateDraft =
                        partnerGateDrafts[row.id] ??
                        parsePartnerGateDraft(row.gating_overrides, defaultPartnerGateDraft);
                      return (
                      <tr key={row.id} className="border-b border-neutral-800/80">
                        <td className="py-2 text-white">{row.name}</td>
                        <td className="py-2 text-gray-300">
                          <div>{row.contact_email || "-"}</div>
                          <div className="text-[11px] text-gray-500">{row.contact_username || "-"}</div>
                        </td>
                        <td className="py-2 text-gray-300">
                          <div>{row.invite_status || "-"}</div>
                          <div className="text-[11px] text-gray-500">
                            {row.invite_expires_at ? `exp ${formatWhen(row.invite_expires_at)}` : "no expiry"}
                          </div>
                          <div className="text-[11px] text-gray-500">{row.latest_invite_email_status || "-"}</div>
                        </td>
                        <td className="py-2 text-gray-300">
                          <div>{row.onboarding_step || "-"}</div>
                          <div className="text-[11px] text-gray-500">
                            {row.approved_at ? `approved ${formatWhen(row.approved_at)}` : "pending"}
                          </div>
                        </td>
                        <td className="py-2 text-gray-300">{row.api_key_prefix || "-"}</td>
                        <td className="py-2 text-gray-300 max-w-[240px] truncate">{row.ip_whitelist || "(any)"}</td>
                        <td className="py-2 text-right">{row.allocation_count}</td>
                        <td className="py-2 text-right">{row.inquiry_count}</td>
                        <td className="py-2 text-right text-xs text-gray-400">{formatWhen(row.updated_at)}</td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-neutral-600 mr-2"
                            onClick={() =>
                              patchPartnerMutation.mutate({
                                id: row.id,
                                patch: { isActive: !row.is_active },
                              })
                            }
                          >
                            {row.is_active ? "Disable" : "Enable"}
                          </Button>
                          <Button
                            size="sm"
                            onClick={() =>
                              patchPartnerMutation.mutate({
                                id: row.id,
                                patch: { rotateKey: true },
                              })
                            }
                          >
                            Rotate Key
                          </Button>
                          <div className="mt-2 flex flex-wrap justify-end gap-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() =>
                                partnerApprovalMutation.mutate({
                                  id: row.id,
                                  action: "APPROVE",
                                  adminNotes: approvalNotesByPartner[row.id] || "",
                                })
                              }
                              disabled={partnerApprovalMutation.isPending}
                            >
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-neutral-600"
                              onClick={() =>
                                partnerApprovalMutation.mutate({
                                  id: row.id,
                                  action: "HOLD",
                                  adminNotes: approvalNotesByPartner[row.id] || "",
                                })
                              }
                              disabled={partnerApprovalMutation.isPending}
                            >
                              Hold
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() =>
                                partnerApprovalMutation.mutate({
                                  id: row.id,
                                  action: "REVOKE",
                                  adminNotes: approvalNotesByPartner[row.id] || "",
                                })
                              }
                              disabled={partnerApprovalMutation.isPending}
                            >
                              Revoke
                            </Button>
                          </div>
                          <Input
                            placeholder="Approval notes"
                            value={approvalNotesByPartner[row.id] ?? ""}
                            onChange={(e) =>
                              setApprovalNotesByPartner((prev) => ({
                                ...prev,
                                [row.id]: e.target.value,
                              }))
                            }
                            className="mt-2 h-8 bg-neutral-900 border-neutral-700 text-xs"
                          />
                          <div className="mt-2 rounded border border-neutral-700 bg-neutral-900/60 p-2 text-left">
                            <div className="text-[11px] text-gray-400 mb-1">Gate overrides</div>
                            <div className="grid grid-cols-2 gap-1">
                              <select
                                value={gateDraft.viewDataRoom}
                                onChange={(e) =>
                                  setPartnerGateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...gateDraft,
                                      viewDataRoom: e.target.value as PartnerGateLevel,
                                    },
                                  }))
                                }
                                className="h-8 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px]"
                              >
                                {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                                  <option key={`view-${row.id}-${level}`} value={level}>
                                    Data: {level}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={gateDraft.runSimulations}
                                onChange={(e) =>
                                  setPartnerGateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...gateDraft,
                                      runSimulations: e.target.value as PartnerGateLevel,
                                    },
                                  }))
                                }
                                className="h-8 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px]"
                              >
                                {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                                  <option key={`sim-${row.id}-${level}`} value={level}>
                                    Sim: {level}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={gateDraft.requestAllocation}
                                onChange={(e) =>
                                  setPartnerGateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...gateDraft,
                                      requestAllocation: e.target.value as PartnerGateLevel,
                                    },
                                  }))
                                }
                                className="h-8 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px]"
                              >
                                {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                                  <option key={`alloc-${row.id}-${level}`} value={level}>
                                    Alloc: {level}
                                  </option>
                                ))}
                              </select>
                              <select
                                value={gateDraft.directContact}
                                onChange={(e) =>
                                  setPartnerGateDrafts((prev) => ({
                                    ...prev,
                                    [row.id]: {
                                      ...gateDraft,
                                      directContact: e.target.value as PartnerGateLevel,
                                    },
                                  }))
                                }
                                className="h-8 rounded border border-neutral-700 bg-neutral-800 px-2 text-[11px]"
                              >
                                {PARTNER_GATE_LEVEL_OPTIONS.map((level) => (
                                  <option key={`contact-${row.id}-${level}`} value={level}>
                                    Contact: {level}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="mt-1 flex justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 border-neutral-600 text-[11px]"
                                onClick={() =>
                                  partnerGateOverrideMutation.mutate({
                                    id: row.id,
                                    draft: gateDraft,
                                  })
                                }
                                disabled={partnerGateOverrideMutation.isPending}
                              >
                                {partnerGateOverrideMutation.isPending ? "Saving..." : "Save Overrides"}
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                      );
                    })}
                    {!partnersQuery.isLoading && partnerRows.length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-6 text-center text-gray-400">
                          No partners configured.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="inbox" className="space-y-3">
          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Partner Inquiry Routing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {inquiryRoutingDraft ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="md:col-span-2">
                      <div className="text-xs text-gray-400 mb-1">Mailbox alias</div>
                      <Input
                        value={inquiryRoutingDraft.inboxAlias}
                        onChange={(e) =>
                          setInquiryRoutingDraft((prev) =>
                            prev ? { ...prev, inboxAlias: e.target.value } : prev,
                          )
                        }
                        placeholder="inquiries@"
                        className="bg-neutral-700 border-neutral-600"
                      />
                    </div>
                    <div className="rounded border border-neutral-700 px-3 py-2 text-xs text-gray-300">
                      Messaging:{" "}
                      {inquiryRoutingQuery.data?.messaging.messagingEnabled ? "enabled" : "disabled"} | E2EE:{" "}
                      {inquiryRoutingQuery.data?.messaging.messagingE2eeEnabled ? "enabled" : "disabled"} | required:{" "}
                      {inquiryRoutingQuery.data?.messaging.messagingE2eeRequired ? "yes" : "no"}
                    </div>
                  </div>

                  {inquiryRoutingQuery.data?.resolved.missingKeyAdminIds?.length ? (
                    <div className="rounded border border-amber-500/40 bg-amber-900/20 px-3 py-2 text-xs text-amber-200">
                      Missing mailbox keys for admin user IDs:{" "}
                      {inquiryRoutingQuery.data.resolved.missingKeyAdminIds.join(", ")}
                    </div>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="text-gray-300 border-b border-neutral-700">
                        <tr>
                          <th className="py-2 text-left">Admin Email</th>
                          <th className="py-2 text-left">Mailbox Key</th>
                          <th className="py-2 text-center">Route To</th>
                          <th className="py-2 text-center">Viewer</th>
                        </tr>
                      </thead>
                      <tbody>
                        {routingAdmins.map((row) => {
                          const email = String(row.email || "").toLowerCase();
                          const isRoute = inquiryRoutingDraft.routeAdminEmails.includes(email);
                          const isViewer = inquiryRoutingDraft.viewerAdminEmails.includes(email);
                          return (
                            <tr key={row.userId} className="border-b border-neutral-800/80">
                              <td className="py-2">
                                <div className="font-medium text-white">{row.email}</div>
                                <div className="text-[11px] text-gray-500">
                                  {row.name || row.username || `Admin #${row.userId}`}
                                </div>
                              </td>
                              <td className="py-2 text-gray-300">
                                {row.hasMailboxKey
                                  ? `Ready (${formatWhen(row.mailboxPublicKeyUpdatedAt)})`
                                  : "Missing key"}
                              </td>
                              <td className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={isRoute}
                                  onChange={(e) =>
                                    toggleInquiryEmail(email, "routeAdminEmails", e.target.checked)
                                  }
                                  className="h-4 w-4"
                                />
                              </td>
                              <td className="py-2 text-center">
                                <input
                                  type="checkbox"
                                  checked={isViewer}
                                  onChange={(e) =>
                                    toggleInquiryEmail(email, "viewerAdminEmails", e.target.checked)
                                  }
                                  className="h-4 w-4"
                                />
                              </td>
                            </tr>
                          );
                        })}
                        {!inquiryRoutingQuery.isLoading && routingAdmins.length === 0 && (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-gray-400">
                              No active admin accounts found.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      onClick={() => saveInquiryRoutingMutation.mutate(inquiryRoutingDraft)}
                      disabled={saveInquiryRoutingMutation.isPending}
                    >
                      {saveInquiryRoutingMutation.isPending ? "Saving..." : "Save Inquiry Routing"}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-sm text-gray-400">Loading inquiry routing...</div>
              )}
            </CardContent>
          </Card>

          <Card className="bg-neutral-800 border-gray-700">
            <CardHeader>
              <CardTitle className="text-base">Partner Inquiry Mailbox</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={inquiryStatusFilter}
                  onChange={(e) => setInquiryStatusFilter(e.target.value)}
                  className="h-9 rounded-md border border-neutral-600 bg-neutral-700 px-2 text-sm"
                >
                  <option value="">All statuses</option>
                  <option value="OPEN">OPEN</option>
                  <option value="FORWARDED">FORWARDED</option>
                  <option value="ANSWERED">ANSWERED</option>
                  <option value="CLOSED">CLOSED</option>
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-neutral-600"
                  onClick={() => inquiriesQuery.refetch()}
                  disabled={inquiriesQuery.isFetching}
                >
                  {inquiriesQuery.isFetching ? "Refreshing..." : "Refresh"}
                </Button>
                <div className="text-xs text-gray-400">
                  Showing {inquiryRows.length} / {inquiriesQuery.data?.total ?? 0}
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-3">
                <div className="rounded border border-neutral-700 bg-neutral-900/60 max-h-[460px] overflow-y-auto">
                  {inquiriesQuery.isLoading ? (
                    <div className="px-3 py-3 text-sm text-gray-400">Loading inquiries...</div>
                  ) : inquiryRows.length === 0 ? (
                    <div className="px-3 py-3 text-sm text-gray-400">No inquiries found.</div>
                  ) : (
                    inquiryRows.map((row) => {
                      const threadId = Number(row.mailboxThreadId || 0);
                      const isSelected = threadId > 0 && threadId === selectedInquiryThreadId;
                      return (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setSelectedInquiryThreadId(threadId > 0 ? threadId : null)}
                          className={`w-full text-left px-3 py-2 border-b border-neutral-800/70 hover:bg-white/[0.04] ${
                            isSelected ? "bg-cyan-500/10" : ""
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm text-white">{row.subject || `Inquiry #${row.id}`}</div>
                            <div className="text-[11px] text-gray-400">{row.status || "-"}</div>
                          </div>
                          <div className="text-[11px] text-gray-400 truncate mt-0.5">
                            {row.partnerName || `Partner #${row.partnerId}`} | {row.senderName || "Sender"}{" "}
                            {row.senderEmail ? `(${row.senderEmail})` : ""}
                          </div>
                          <div className="text-[11px] text-gray-500 mt-1">{formatWhen(row.createdAt)}</div>
                        </button>
                      );
                    })
                  )}
                </div>

                <div className="rounded border border-neutral-700 bg-neutral-900/60 min-h-[460px] p-3">
                  {!selectedInquiryThreadId ? (
                    <div className="text-sm text-gray-400">Select an inquiry thread to inspect mailbox messages.</div>
                  ) : inquiryThreadQuery.isLoading ? (
                    <div className="text-sm text-gray-400">Loading mailbox thread...</div>
                  ) : inquiryThreadQuery.data ? (
                    <div className="space-y-3">
                      <div className="rounded border border-neutral-700 p-2 text-xs text-gray-300">
                        <div className="font-medium text-white">{inquiryThreadQuery.data.thread?.subject || "Thread"}</div>
                        <div className="mt-1 text-gray-400">
                          Inquiry: {selectedInquiry?.id ?? "-"} | Trader: {selectedInquiry?.userHashId || "-"}
                        </div>
                      </div>
                      <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                        {(inquiryThreadQuery.data.messages ?? []).map((message) => (
                          <div
                            key={message.id}
                            className={`rounded border p-2 text-xs ${
                              message.senderIsAdmin
                                ? "border-cyan-500/30 bg-cyan-500/10"
                                : "border-emerald-500/30 bg-emerald-500/10"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-gray-200">
                                {message.senderUsername || message.senderEmail || "System"}
                              </div>
                              <div className="text-gray-400">{formatWhen(message.createdAt)}</div>
                            </div>
                            <div className="mt-1 whitespace-pre-wrap break-words text-gray-100">{message.body}</div>
                          </div>
                        ))}
                        {!inquiryThreadQuery.data.messages?.length && (
                          <div className="text-sm text-gray-400">No mailbox messages yet.</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-red-400">Mailbox thread unavailable.</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ScoutWorkbench() {
  return (
    <FeatureErrorBoundary featureName="Scout Workbench">
      <ScoutWorkbenchContent />
    </FeatureErrorBoundary>
  );
}
