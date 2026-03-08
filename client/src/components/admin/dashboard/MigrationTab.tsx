import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  FieldHintLabel,
  MIGRATION_FIELD_HELP,
  type MigrationExportJob,
  type MigrationImportJob,
  type SystemConfigData,
} from "./AdminDashboardSupport";

export function MigrationTab() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ===== Migration chunking settings (stored in system_config) =====
  const systemConfigQuery = useQuery<SystemConfigData>({
    queryKey: ["/api/admin/system-config"],
    queryFn: () => axios.get("/api/admin/system-config").then((r) => r.data),
  });

  const [chunkingEnabledDraft, setChunkingEnabledDraft] = useState<boolean>(false);
  const [chunkSizeGbDraft, setChunkSizeGbDraft] = useState<string>("50");
  const [chunkSettingsDirty, setChunkSettingsDirty] = useState(false);

  useEffect(() => {
    const cfg = systemConfigQuery.data;
    if (!cfg) return;
    if (!chunkSettingsDirty) {
      setChunkingEnabledDraft(Boolean(cfg.migrationChunkingEnabled));
      const mb = Number(cfg.migrationChunkSizeMb ?? 51200);
      const gb = mb / 1024;
      const gbStr = Number.isFinite(gb) ? String(Math.round(gb * 100) / 100) : "50";
      setChunkSizeGbDraft(gbStr);
    }
  }, [systemConfigQuery.data, chunkSettingsDirty]);

  const saveChunkSettingsMutation = useMutation({
    mutationFn: async (payload: { migrationChunkingEnabled: boolean; migrationChunkSizeMb: number }) => {
      return axios.put("/api/admin/system-config", payload).then((r) => r.data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/system-config"] });
      setChunkSettingsDirty(false);
      toast({ title: "Migration settings saved", description: "Chunking settings updated." });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error.response?.data?.message || "Failed to save migration settings",
        variant: "destructive",
      });
    },
  });

  const humanBytes = (n?: number | null) => {
    const v = Number(n ?? 0);
    if (!Number.isFinite(v) || v <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    let x = v;
    while (x >= 1024 && i < units.length - 1) {
      x /= 1024;
      i++;
    }
    const rounded = i === 0 ? String(Math.round(x)) : String(Math.round(x * 100) / 100);
    return `${rounded} ${units[i]}`;
  };

  const chunkingSummary = useMemo(() => {
    const enabled = chunkingEnabledDraft;
    const gb = Number(chunkSizeGbDraft);
    const mb = Math.floor((Number.isFinite(gb) ? gb : 50) * 1024);
    if (!enabled) return "Chunking: Disabled (single file)";
    return `Chunking: Enabled (${Number.isFinite(gb) ? gb : 50} GB approx ${mb} MB)`;
  }, [chunkingEnabledDraft, chunkSizeGbDraft]);

  const handleSaveChunkSettings = () => {
    const gb = Number(chunkSizeGbDraft);
    if (chunkingEnabledDraft) {
      if (!Number.isFinite(gb) || gb <= 0) {
        toast({ title: "Invalid chunk size", description: "Enter a positive size in GB", variant: "destructive" });
        return;
      }
    }

    const mb = Math.floor((Number.isFinite(gb) && gb > 0 ? gb : 50) * 1024);
    saveChunkSettingsMutation.mutate({
      migrationChunkingEnabled: Boolean(chunkingEnabledDraft),
      migrationChunkSizeMb: chunkingEnabledDraft ? Math.max(256, mb) : mb,
    });
  };

  const downloadTextFile = (filename: string, content: string) => {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const getScriptContext = (job: MigrationExportJob) => {
    const manifest = job.manifest;
    if (!manifest || !Array.isArray(manifest.chunks) || manifest.chunks.length === 0) return null;
    const chunks = [...manifest.chunks].sort((a: any, b: any) => Number(a?.index ?? 0) - Number(b?.index ?? 0));
    const base = typeof window !== "undefined" ? window.location.origin : "";
    const headLinkHash = String(manifest?.chunkChain?.headLinkHash || "");
    const dataSha256 = String(manifest?.dataSha256 || "");
    return { base, jobId: job.id, chunks, headLinkHash, dataSha256 };
  };

  const buildDownloadVerifyScript = (ctx: {
    base: string;
    jobId: string;
    chunks: any[];
    headLinkHash: string;
    dataSha256: string;
  }) => {
    const files = ctx.chunks.map((c: any) => `"${String(c?.file || "")}"`).join(" ");
    const shas = ctx.chunks.map((c: any) => `"${String(c?.sha256 || "")}"`).join(" ");
    const indexes = ctx.chunks.map((c: any) => String(c?.index ?? 0)).join(" ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
CONCURRENCY="\${CONCURRENCY:-10}"
if ! [[ "\$CONCURRENCY" =~ ^[0-9]+$ ]]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -gt 10 ]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -lt 1 ]; then CONCURRENCY=1; fi
echo "Parallelism: \${CONCURRENCY} (hard max 10)"

mkdir -p "\$OUT_DIR"
curl -f -L -o "\$OUT_DIR/\${JOB}-manifest.json" "\$BASE/api/admin/migration/export-jobs/\${JOB}/manifest"

INDEXES=(${indexes})
FILES=(${files})
SHAS=(${shas})
HEAD_LINK_HASH="${ctx.headLinkHash}"
DATA_SHA256="${ctx.dataSha256}"

download_one() {
  local idx="$1"
  local file="$2"
  local url="\$BASE/api/admin/migration/export-jobs/\$JOB/chunks/\$idx"
  curl -f -L -C - -o "\$OUT_DIR/\$file" "\$url"
}

pids=()
for i in "\${!INDEXES[@]}"; do
  download_one "\${INDEXES[\$i]}" "\${FILES[\$i]}" &
  pids+=($!)
  if [ \${#pids[@]} -ge "\$CONCURRENCY" ]; then
    wait "\${pids[0]}"
    pids=("\${pids[@]:1}")
  fi
done
for pid in "\${pids[@]}"; do wait "\$pid"; done

for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then
    echo "SHA mismatch: \$file"
    exit 1
  fi
done

prev="GENESIS"
for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  sha=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  prev=$(printf "%s:%s" "\$prev" "\$sha" | sha256sum | awk '{print \$1}')
done

if [ -n "\$HEAD_LINK_HASH" ] && [ "\$prev" != "\$HEAD_LINK_HASH" ]; then
  echo "Chain head mismatch: expected \$HEAD_LINK_HASH got \$prev"
  exit 1
fi

if [ -n "\$DATA_SHA256" ]; then
  data=$(cat "\${FILES[@]/#/\$OUT_DIR/}" | sha256sum | awk '{print \$1}')
  if [ "\$data" != "\$DATA_SHA256" ]; then
    echo "Data SHA mismatch: expected \$DATA_SHA256 got \$data"
    exit 1
  fi
fi

echo "OK: all chunks verified"
`;
  };

  const buildMissingScript = (ctx: {
    base: string;
    jobId: string;
    chunks: any[];
    headLinkHash: string;
    dataSha256: string;
  }) => {
    const files = ctx.chunks.map((c: any) => `"${String(c?.file || "")}"`).join(" ");
    const shas = ctx.chunks.map((c: any) => `"${String(c?.sha256 || "")}"`).join(" ");
    const indexes = ctx.chunks.map((c: any) => String(c?.index ?? 0)).join(" ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
CONCURRENCY="\${CONCURRENCY:-10}"
if ! [[ "\$CONCURRENCY" =~ ^[0-9]+$ ]]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -gt 10 ]; then CONCURRENCY=10; fi
if [ "\$CONCURRENCY" -lt 1 ]; then CONCURRENCY=1; fi
echo "Parallelism: \${CONCURRENCY} (hard max 10)"

mkdir -p "\$OUT_DIR"
curl -f -L -o "\$OUT_DIR/\${JOB}-manifest.json" "\$BASE/api/admin/migration/export-jobs/\${JOB}/manifest"

INDEXES=(${indexes})
FILES=(${files})
SHAS=(${shas})
HEAD_LINK_HASH="${ctx.headLinkHash}"
DATA_SHA256="${ctx.dataSha256}"

download_one() {
  local idx="$1"
  local file="$2"
  local url="\$BASE/api/admin/migration/export-jobs/\$JOB/chunks/\$idx"
  curl -f -L -C - -o "\$OUT_DIR/\$file" "\$url"
}

needs_download() {
  local file="$1"
  local expected="$2"
  if [ ! -f "\$OUT_DIR/\$file" ]; then return 0; fi
  local actual
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then return 0; fi
  return 1
}

pids=()
for i in "\${!INDEXES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  if needs_download "\$file" "\$expected"; then
    download_one "\${INDEXES[\$i]}" "\$file" &
    pids+=($!)
    if [ \${#pids[@]} -ge "\$CONCURRENCY" ]; then
      wait "\${pids[0]}"
      pids=("\${pids[@]:1}")
    fi
  fi
done
for pid in "\${pids[@]}"; do wait "\$pid"; done

for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  expected="\${SHAS[\$i]}"
  actual=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  if [ "\$actual" != "\$expected" ]; then
    echo "SHA mismatch: \$file"
    exit 1
  fi
done

prev="GENESIS"
for i in "\${!FILES[@]}"; do
  file="\${FILES[\$i]}"
  sha=$(sha256sum "\$OUT_DIR/\$file" | awk '{print \$1}')
  prev=$(printf "%s:%s" "\$prev" "\$sha" | sha256sum | awk '{print \$1}')
done

if [ -n "\$HEAD_LINK_HASH" ] && [ "\$prev" != "\$HEAD_LINK_HASH" ]; then
  echo "Chain head mismatch: expected \$HEAD_LINK_HASH got \$prev"
  exit 1
fi

if [ -n "\$DATA_SHA256" ]; then
  data=$(cat "\${FILES[@]/#/\$OUT_DIR/}" | sha256sum | awk '{print \$1}')
  if [ "\$data" != "\$DATA_SHA256" ]; then
    echo "Data SHA mismatch: expected \$DATA_SHA256 got \$data"
    exit 1
  fi
fi

echo "OK: chunks verified"
`;
  };

  const buildImportScript = (ctx: { base: string; jobId: string; chunks: any[] }) => {
    const files = ctx.chunks
      .map((c: any) => `-F "data=@$OUT_DIR/${String(c?.file || "")}"`)
      .join(" \\\n  ");
    const base = ctx.base.replace(/"/g, '\\"');
    const jobId = ctx.jobId.replace(/"/g, '\\"');

    return `#!/usr/bin/env bash
set -euo pipefail

BASE="\${BASE:-${base}}"
JOB="\${JOB:-${jobId}}"
OUT_DIR="\${OUT_DIR:-./export_\${JOB}}"
MANIFEST="\${MANIFEST:-\${JOB}-manifest.json}"
MODE="\${MODE:-DRY_RUN}"

echo "NOTE: requires admin auth (session cookie or header)."

curl -f -L -X POST "\$BASE/api/admin/migration/import-jobs" \\
  -F "manifest=@$OUT_DIR/$MANIFEST" \\
  ${files} \\
  -F "mode=$MODE" \\
  -F "idStrategy=PRESERVE"
`;
  };

  // ===== Export form =====
  const [exportScope, setExportScope] = useState("FULL_PLATFORM");
  const [exportUserId, setExportUserId] = useState("");
  const [exportSince, setExportSince] = useState("");

  // ===== Import form (supports chunked imports) =====
  const [importMode, setImportMode] = useState("DRY_RUN");
  const [importManifestFile, setImportManifestFile] = useState<File | null>(null);
  const [importDataFiles, setImportDataFiles] = useState<File[]>([]);
  const [importManifestMeta, setImportManifestMeta] = useState<{
    chunked: boolean;
    chunkCount: number;
    expectedFiles: string[];
  } | null>(null);

  const [purgeDays, setPurgeDays] = useState("30");
  const [importPurgeDays, setImportPurgeDays] = useState("30");

  const exportJobsQuery = useQuery<MigrationExportJob[]>({
    queryKey: ["/api/admin/migration/export-jobs"],
    queryFn: () => axios.get("/api/admin/migration/export-jobs").then((r) => r.data),
    refetchInterval: 5000,
  });

  const importJobsQuery = useQuery<MigrationImportJob[]>({
    queryKey: ["/api/admin/migration/import-jobs"],
    queryFn: () => axios.get("/api/admin/migration/import-jobs").then((r) => r.data),
    refetchInterval: 5000,
  });

  const exportMutation = useMutation({
    mutationFn: (payload: any) => axios.post("/api/admin/migration/export-jobs", payload).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({ title: "Export job created", description: "Job queued for processing" });
    },
    onError: (error: any) => {
      toast({
        title: "Export failed",
        description: error.response?.data?.message || "Failed to create export job",
        variant: "destructive",
      });
    },
  });

  const importMutation = useMutation({
    mutationFn: (form: FormData) =>
      axios.post("/api/admin/migration/import-jobs", form, { headers: { "Content-Type": "multipart/form-data" } })
        .then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({ title: "Import job created", description: "Job queued for processing" });
      setImportManifestFile(null);
      setImportDataFiles([]);
      setImportManifestMeta(null);
    },
    onError: (error: any) => {
      toast({
        title: "Import failed",
        description: error.response?.data?.message || "Failed to create import job",
        variant: "destructive",
      });
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (payload: { olderThanDays: number }) =>
      axios.post("/api/admin/migration/export-jobs/purge", payload).then((r) => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({
        title: "Exports purged",
        description: `Jobs: ${data?.jobsPurged ?? 0} | Files: ${data?.filesRemoved ?? 0}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge export files",
        variant: "destructive",
      });
    },
  });

  const purgeJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      axios.delete(`/api/admin/migration/export-jobs/${jobId}/files`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/export-jobs"] });
      toast({ title: "Export files removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge export files",
        variant: "destructive",
      });
    },
  });

  const importPurgeMutation = useMutation({
    mutationFn: (payload: { olderThanDays: number }) =>
      axios.post("/api/admin/migration/import-jobs/purge", payload).then((r) => r.data),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({
        title: "Import uploads purged",
        description: `Jobs: ${data?.jobsPurged ?? 0} | Files: ${data?.filesRemoved ?? 0}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge import uploads",
        variant: "destructive",
      });
    },
  });

  const importPurgeJobMutation = useMutation({
    mutationFn: (jobId: string) =>
      axios.delete(`/api/admin/migration/import-jobs/${jobId}/files`).then((r) => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/migration/import-jobs"] });
      toast({ title: "Import files removed" });
    },
    onError: (error: any) => {
      toast({
        title: "Purge failed",
        description: error.response?.data?.message || "Failed to purge import files",
        variant: "destructive",
      });
    },
  });

  const formatTs = (ts?: number | null) => {
    if (!ts || !Number.isFinite(ts)) return "-";
    return new Date(ts).toLocaleString();
  };

  const totalRows = (totals?: Record<string, number> | null) => {
    if (!totals) return 0;
    return Object.values(totals).reduce((sum, val) => sum + Number(val || 0), 0);
  };

  const handleExport = () => {
    const payload: any = { scope: exportScope };
    if (exportScope === "USER_BUNDLE") {
      const id = Number(exportUserId);
      if (!exportUserId.trim() || !Number.isFinite(id) || id <= 0) {
        toast({ title: "Missing user ID", description: "Enter a valid user ID", variant: "destructive" });
        return;
      }
      payload.userId = id;
    }
    if (exportScope === "DELTA") {
      if (!exportSince) {
        toast({ title: "Missing timestamp", description: "Select a delta start time", variant: "destructive" });
        return;
      }
      const sinceTs = new Date(exportSince).getTime();
      if (!Number.isFinite(sinceTs)) {
        toast({ title: "Invalid timestamp", description: "Select a valid date/time", variant: "destructive" });
        return;
      }
      payload.sinceTs = sinceTs;
    }
    exportMutation.mutate(payload);
  };

  const parseManifestFile = async (file: File) => {
    try {
      const text = await file.text();
      const manifest = JSON.parse(text);
      const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
      const expectedFiles = chunks
        .map((c: any) => String(c?.file || ""))
        .filter((name: string) => name.trim().length > 0);
      const chunkingFlag = Boolean(manifest?.chunking?.enabled ?? false);
      const chunked = chunkingFlag || expectedFiles.length > 1;
      const chunkCount = expectedFiles.length > 0 ? expectedFiles.length : 1;
      setImportManifestMeta({ chunked, chunkCount, expectedFiles });
    } catch {
      setImportManifestMeta(null);
      toast({
        title: "Invalid manifest",
        description: "Could not parse JSON. Please select a valid migration manifest file.",
        variant: "destructive",
      });
    }
  };

  const importSelection = useMemo(() => {
    const meta = importManifestMeta;
    const selected = importDataFiles;

    if (!meta) {
      return {
        chunked: false,
        expectedCount: 0,
        selectedCount: selected.length,
        missing: [] as string[],
        extra: [] as string[],
        ok: selected.length > 0,
      };
    }

    const expected = meta.expectedFiles || [];
    const selectedNames = new Set(selected.map((f) => f.name));
    const missing = expected.filter((n) => !selectedNames.has(n));
    const extra = selected
      .map((f) => f.name)
      .filter((n) => expected.length > 0 && !expected.includes(n));

    const ok = meta.chunked ? (missing.length === 0 && extra.length === 0 && expected.length > 0) : selected.length > 0;

    return {
      chunked: meta.chunked,
      expectedCount: meta.chunkCount,
      selectedCount: selected.length,
      missing,
      extra,
      ok,
    };
  }, [importManifestMeta, importDataFiles]);

  const handleImport = () => {
    if (!importManifestFile) {
      toast({ title: "Missing manifest", description: "Select a manifest file", variant: "destructive" });
      return;
    }
    if (importDataFiles.length === 0) {
      toast({ title: "Missing data", description: "Select data file(s)", variant: "destructive" });
      return;
    }
    if (!importSelection.ok) {
      const missingText = importSelection.missing.length ? `Missing: ${importSelection.missing.join(", ")}` : "";
      const extraText = importSelection.extra.length ? `Extra: ${importSelection.extra.join(", ")}` : "";
      toast({
        title: "Data files do not match manifest",
        description: [missingText, extraText].filter(Boolean).join(" | ") || "Please select the required data files.",
        variant: "destructive",
      });
      return;
    }
    const form = new FormData();
    form.append("manifest", importManifestFile);
    if (importSelection.chunked) {
      for (const f of importDataFiles) {
        form.append("data", f);
      }
    } else {
      form.append("data", importDataFiles[0]);
    }
    form.append("mode", importMode);
    form.append("idStrategy", "PRESERVE");
    importMutation.mutate(form);
  };

  const handlePurge = () => {
    const days = Number(purgeDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid days", description: "Enter a positive number", variant: "destructive" });
      return;
    }
    purgeMutation.mutate({ olderThanDays: Math.floor(days) });
  };

  const handleImportPurge = () => {
    const days = Number(importPurgeDays);
    if (!Number.isFinite(days) || days <= 0) {
      toast({ title: "Invalid days", description: "Enter a positive number", variant: "destructive" });
      return;
    }
    importPurgeMutation.mutate({ olderThanDays: Math.floor(days) });
  };

  return (
    <TooltipProvider delayDuration={120}>
      <div className="space-y-6">
        <div className="rounded-md border border-cyan-700/40 bg-cyan-950/20 p-3 text-xs text-cyan-100/90">
          Migration controls include hidden <span className="font-medium">Hint</span> explainers for data integrity, chunking behavior, and retention impact.
        </div>
        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Migration Export/Import Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div className="w-full">
                <FieldHintLabel
                  label="Chunk exports/imports"
                  hint={MIGRATION_FIELD_HELP.chunkingEnabled.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.chunkingEnabled.inline}</p>
              </div>
              <Switch
                checked={chunkingEnabledDraft}
                onCheckedChange={(v) => {
                  setChunkingEnabledDraft(Boolean(v));
                  setChunkSettingsDirty(true);
                }}
                disabled={systemConfigQuery.isLoading}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
              <div>
                <FieldHintLabel label="Chunk size (GB)" hint={MIGRATION_FIELD_HELP.chunkSizeGb.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.chunkSizeGb.inline}</p>
                <Input
                  type="number"
                  min={0.25}
                  step={0.25}
                  value={chunkSizeGbDraft}
                  onChange={(e) => {
                    setChunkSizeGbDraft(e.target.value);
                    setChunkSettingsDirty(true);
                  }}
                  className="bg-neutral-600 mt-2"
                  disabled={systemConfigQuery.isLoading}
                  title={MIGRATION_FIELD_HELP.chunkSizeGb.tooltip}
                />
                <p className="text-xs text-gray-400 mt-1">Stored as MB in DB. Minimum 0.25GB.</p>
              </div>
              <div className="md:col-span-2 flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">{chunkingSummary}</div>
                <Button
                  onClick={handleSaveChunkSettings}
                  disabled={systemConfigQuery.isLoading || saveChunkSettingsMutation.isPending || !chunkSettingsDirty}
                >
                  {saveChunkSettingsMutation.isPending ? "Saving..." : "Save Migration Settings"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">Export (Backup or Migration)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FieldHintLabel label="Scope" hint={MIGRATION_FIELD_HELP.exportScope.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportScope.inline}</p>
                <Select value={exportScope} onValueChange={setExportScope}>
                  <SelectTrigger className="bg-neutral-600 mt-2" title={MIGRATION_FIELD_HELP.exportScope.tooltip}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FULL_PLATFORM">Full platform</SelectItem>
                    <SelectItem value="USER_BUNDLE">Single trader bundle</SelectItem>
                    <SelectItem value="DELTA">Delta since timestamp</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {exportScope === "USER_BUNDLE" && (
                <div>
                  <FieldHintLabel label="Trader User ID" hint={MIGRATION_FIELD_HELP.exportUserId.tooltip} labelClassName="text-base font-medium" />
                  <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportUserId.inline}</p>
                  <Input
                    type="number"
                    value={exportUserId}
                    onChange={(e) => setExportUserId(e.target.value)}
                    className="bg-neutral-600 mt-2"
                    placeholder="e.g. 123"
                    title={MIGRATION_FIELD_HELP.exportUserId.tooltip}
                  />
                </div>
              )}

              {exportScope === "DELTA" && (
                <div>
                  <FieldHintLabel label="Since (local time)" hint={MIGRATION_FIELD_HELP.exportSince.tooltip} labelClassName="text-base font-medium" />
                  <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.exportSince.inline}</p>
                  <Input
                    type="datetime-local"
                    value={exportSince}
                    onChange={(e) => setExportSince(e.target.value)}
                    className="bg-neutral-600 mt-2"
                    title={MIGRATION_FIELD_HELP.exportSince.tooltip}
                  />
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  NDJSON + manifest export. Includes audit trails and hashes.
                </div>
                <Button onClick={handleExport} disabled={exportMutation.isPending}>
                  {exportMutation.isPending ? "Creating..." : "Create Export Job"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-neutral-700 border-gray-600">
            <CardHeader>
              <CardTitle className="text-base">Import (Dry Run or Write)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <FieldHintLabel label="Mode" hint={MIGRATION_FIELD_HELP.importMode.tooltip} labelClassName="text-base font-medium" />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importMode.inline}</p>
                <Select value={importMode} onValueChange={setImportMode}>
                  <SelectTrigger className="bg-neutral-600 mt-2" title={MIGRATION_FIELD_HELP.importMode.tooltip}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DRY_RUN">Dry run (validate only)</SelectItem>
                    <SelectItem value="IMPORT">Import (write data)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <FieldHintLabel
                  label="Manifest (manifest.json)"
                  hint={MIGRATION_FIELD_HELP.importManifestFile.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importManifestFile.inline}</p>
                <Input
                  type="file"
                  accept=".json,application/json"
                  className="bg-neutral-600 mt-2"
                  title={MIGRATION_FIELD_HELP.importManifestFile.tooltip}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null;
                    setImportManifestFile(file);
                    setImportDataFiles([]);
                    if (file) {
                      parseManifestFile(file);
                    } else {
                      setImportManifestMeta(null);
                    }
                  }}
                />
              </div>

              <div>
                <FieldHintLabel
                  label={importManifestMeta?.chunked ? "Data parts (*.ndjson) - select all" : "Data (data.ndjson)"}
                  hint={MIGRATION_FIELD_HELP.importDataFiles.tooltip}
                  labelClassName="text-base font-medium"
                />
                <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importDataFiles.inline}</p>
                <Input
                  type="file"
                  multiple={Boolean(importManifestMeta?.chunked)}
                  accept=".ndjson,application/x-ndjson"
                  className="bg-neutral-600 mt-2"
                  title={MIGRATION_FIELD_HELP.importDataFiles.tooltip}
                  onChange={(e) => setImportDataFiles(Array.from(e.target.files || []))}
                />
                {importManifestMeta?.chunked && (
                  <div className="text-xs text-gray-400 mt-2 space-y-1">
                    <div>
                      Expected parts: {importSelection.expectedCount} | Selected: {importSelection.selectedCount}
                    </div>
                    {importSelection.missing.length > 0 && (
                      <div className="text-amber-300">Missing: {importSelection.missing.join(", ")}</div>
                    )}
                    {importSelection.extra.length > 0 && (
                      <div className="text-amber-300">Extra: {importSelection.extra.join(", ")}</div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  Preserves legacy IDs. Use empty target DB to avoid conflicts.
                </div>
                <Button onClick={handleImport} disabled={importMutation.isPending}>
                  {importMutation.isPending ? "Uploading..." : "Create Import Job"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Export Retention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <FieldHintLabel
                label="Purge exports older than (days)"
                hint={MIGRATION_FIELD_HELP.purgeDays.tooltip}
                labelClassName="text-base font-medium"
              />
              <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.purgeDays.inline}</p>
              <Input
                type="number"
                min={1}
                value={purgeDays}
                onChange={(e) => setPurgeDays(e.target.value)}
                className="bg-neutral-600 mt-1 w-40"
                title={MIGRATION_FIELD_HELP.purgeDays.tooltip}
              />
              <p className="text-xs text-gray-400">
                Deletes export files from server storage; job metadata remains.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handlePurge}
              disabled={purgeMutation.isPending}
            >
              {purgeMutation.isPending ? "Purging..." : "Purge Exports"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Recent Export Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {exportJobsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Loading export jobs...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Job ID</TableHead>
                    <TableHead className="text-xs">Scope</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Rows</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Download</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(exportJobsQuery.data || []).map((job) => {
                    const manifestChunks = Array.isArray(job.manifest?.chunks) ? job.manifest.chunks : [];
                    const chunkCount = manifestChunks.length;
                    const scriptCtx = chunkCount > 0 ? getScriptContext(job) : null;

                    return (
                      <TableRow key={job.id}>
                        <TableCell className="text-xs text-gray-200">{job.id}</TableCell>
                        <TableCell className="text-xs text-gray-300">{job.scope}</TableCell>
                        <TableCell className="text-xs text-gray-300">{job.status}</TableCell>
                        <TableCell className="text-xs text-gray-300">{totalRows(job.totals)}</TableCell>
                        <TableCell className="text-xs text-gray-400">{formatTs(job.createdAt)}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex gap-2">
                            {job.status === "READY" && (job.dataPath || job.manifestPath) ? (
                              <>
                                <Button size="sm" variant="outline" asChild>
                                  <a href={`/api/admin/migration/export-jobs/${job.id}/manifest`} rel="noreferrer">
                                    Manifest
                                  </a>
                                </Button>
                                <Button size="sm" variant="outline" asChild>
                                  <a href={`/api/admin/migration/export-jobs/${job.id}/data`} rel="noreferrer">
                                    {chunkCount > 1 ? "Part 0" : "Data"}
                                  </a>
                                </Button>
                                {chunkCount > 1 && (
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button size="sm" variant="outline">Parts ({chunkCount})</Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-lg bg-neutral-800 border-gray-700">
                                      <DialogHeader>
                                        <DialogTitle>Export parts ({chunkCount})</DialogTitle>
                                      </DialogHeader>
                                      {scriptCtx && (
                                        <div className="space-y-2">
                                          <div className="text-xs text-gray-400">
                                            Generated Linux scripts enforce a hard concurrency cap of 10.
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `download_${job.id}.sh`,
                                                  buildDownloadVerifyScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Download + Verify)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `download_missing_${job.id}.sh`,
                                                  buildMissingScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Only Missing/Corrupt Parts)
                                            </Button>
                                            <Button
                                              size="sm"
                                              variant="outline"
                                              onClick={() =>
                                                downloadTextFile(
                                                  `import_upload_${job.id}.sh`,
                                                  buildImportScript(scriptCtx)
                                                )
                                              }
                                            >
                                              Download Linux Script (Import Upload)
                                            </Button>
                                          </div>
                                        </div>
                                      )}
                                      <div className="space-y-2 max-h-[60vh] overflow-auto mt-3">
                                        {manifestChunks.map((c: any) => (
                                          <div key={String(c?.index ?? c?.file)} className="flex items-center justify-between gap-3">
                                            <div className="text-xs text-gray-300 truncate">
                                              {String(c?.file || `Part ${c?.index}`)}
                                            </div>
                                            <div className="flex items-center gap-2">
                                              <span className="text-xs text-gray-500">{humanBytes(c?.sizeBytes ?? null)}</span>
                                              <Button size="sm" variant="outline" asChild>
                                                <a
                                                  href={`/api/admin/migration/export-jobs/${job.id}/chunks/${c?.index ?? 0}`}
                                                  rel="noreferrer"
                                                >
                                                  Download
                                                </a>
                                              </Button>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                )}
                              </>
                            ) : (
                              <span className="text-gray-500">-</span>
                            )}
                            {(job.dataPath || job.manifestPath) && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => purgeJobMutation.mutate(job.id)}
                                disabled={purgeJobMutation.isPending}
                              >
                                Purge
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {(exportJobsQuery.data || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 text-sm">
                        No export jobs yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Recent Import Jobs</CardTitle>
          </CardHeader>
          <CardContent>
            {importJobsQuery.isLoading ? (
              <div className="text-sm text-gray-400">Loading import jobs...</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Job ID</TableHead>
                    <TableHead className="text-xs">Mode</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Rows</TableHead>
                    <TableHead className="text-xs">Created</TableHead>
                    <TableHead className="text-xs">Purge</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(importJobsQuery.data || []).map((job) => (
                    <TableRow key={job.id}>
                      <TableCell className="text-xs text-gray-200">{job.id}</TableCell>
                      <TableCell className="text-xs text-gray-300">{job.mode}</TableCell>
                      <TableCell className="text-xs text-gray-300">{job.status}</TableCell>
                      <TableCell className="text-xs text-gray-300">{totalRows(job.totals)}</TableCell>
                      <TableCell className="text-xs text-gray-400">{formatTs(job.createdAt)}</TableCell>
                      <TableCell className="text-xs">
                        {(job.dataPath || job.manifestPath) ? (
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => importPurgeJobMutation.mutate(job.id)}
                            disabled={importPurgeJobMutation.isPending}
                          >
                            Purge
                          </Button>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(importJobsQuery.data || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-gray-400 text-sm">
                        No import jobs yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="bg-neutral-700 border-gray-600">
          <CardHeader>
            <CardTitle className="text-base">Import Upload Retention</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="space-y-2">
              <FieldHintLabel
                label="Purge imports older than (days)"
                hint={MIGRATION_FIELD_HELP.importPurgeDays.tooltip}
                labelClassName="text-base font-medium"
              />
              <p className="text-xs text-gray-400 mt-1">{MIGRATION_FIELD_HELP.importPurgeDays.inline}</p>
              <Input
                type="number"
                min={1}
                value={importPurgeDays}
                onChange={(e) => setImportPurgeDays(e.target.value)}
                className="bg-neutral-600 mt-1 w-40"
                title={MIGRATION_FIELD_HELP.importPurgeDays.tooltip}
              />
              <p className="text-xs text-gray-400">
                Deletes uploaded manifest/data files from server storage.
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={handleImportPurge}
              disabled={importPurgeMutation.isPending}
            >
              {importPurgeMutation.isPending ? "Purging..." : "Purge Imports"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
