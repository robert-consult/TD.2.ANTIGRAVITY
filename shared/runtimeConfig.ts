export type ControlledReloadDomain = "quotes.transport.feed" | "quotes.providers";
export type ControlledReloadRequiredScope = "runtime" | "reload" | "restart" | "deploy";
export type ControlledReloadState = "idle" | "pending" | "applied" | "failed";
export type ControlledReloadAckState = "applied" | "failed";
export type RuntimeGovernanceValue = string | number | boolean | null;
export type RuntimeGovernanceEntrySource = "runtime" | "env" | "db" | "manifest" | "derived";
export type RuntimeGovernanceEntryMutability =
  | "admin-runtime"
  | "controlled-reload"
  | "deploy-readonly"
  | "secret-readiness"
  | "code-invariant";

export type ControlledReloadAcknowledgement = {
  actorId: string;
  role: string;
  nodeId: string;
  version: number;
  status: ControlledReloadAckState;
  updatedAt: number;
  error: string | null;
  effectiveState: Record<string, unknown> | null;
};

export type ControlledReloadStatus = {
  domain: ControlledReloadDomain;
  requestedVersion: number;
  requestedAt: number | null;
  requestedBy: string | null;
  requiredScope: ControlledReloadRequiredScope;
  changedKeys: string[];
  status: ControlledReloadState;
  acknowledgements: ControlledReloadAcknowledgement[];
  lastAppliedVersion: number | null;
  lastAppliedAt: number | null;
  lastError: string | null;
  effectiveState: Record<string, unknown> | null;
  updatedAt: number | null;
};

export type EffectiveQuoteTransportState = {
  configured: {
    feedPollMs: number;
    staleThresholdMs: number;
    fxRolloverTz: string;
    fxRolloverTime: string;
  };
  applied: {
    feedPollMs: number;
    staleThresholdMs: number;
    fxRolloverTz: string;
    fxRolloverTime: string;
    lastReloadedAt: number | null;
  };
  reloadStatus: ControlledReloadStatus;
};

export type EffectiveProviderSkippedReason =
  | "not-found"
  | "disabled"
  | "invalid-config"
  | "missing-secret"
  | "load-error";

export type EffectiveProviderCandidate = {
  providerKey: string;
  displayName: string | null;
  driver: string | null;
  configuredOrder: number;
  isConfiguredActive: boolean;
  isConfiguredFallback: boolean;
  isEnabled: boolean;
  configUsable: boolean;
  missingSecrets: string[];
  skippedReason: EffectiveProviderSkippedReason | null;
  error: string | null;
};

export type EffectiveProviderSelection = {
  configuredActiveKey: string | null;
  configuredFallbackKeys: string[];
  effectiveProviderKey: string | null;
  effectiveProviderDisplayName: string | null;
  effectiveProviderDriver: string | null;
  candidateOrder: string[];
  candidates: EffectiveProviderCandidate[];
  diagnostics: {
    providerCacheTtlMs: number;
    envFallbackMode: "disabled" | "diagnostic-only";
    allowLegacyEnvFallback: boolean;
    legacyEnvCandidateKeys: string[];
  };
  reloadStatus: ControlledReloadStatus;
};

export type RuntimeGovernanceEntry = {
  key: string;
  label: string;
  value: RuntimeGovernanceValue;
  source: RuntimeGovernanceEntrySource;
  mutability: RuntimeGovernanceEntryMutability;
  secret: boolean;
  secretConfigured: boolean | null;
  manifestValue: RuntimeGovernanceValue;
  manifestPath: string | null;
  alignedWithManifest: boolean | null;
  notes: string | null;
};

export type RuntimeGovernanceSection = {
  id: string;
  title: string;
  description: string;
  entries: RuntimeGovernanceEntry[];
};

export type RuntimeDocumentationReconciliation = {
  id: string;
  label: string;
  docPath: string;
  exists: boolean;
  lastModifiedAt: number | null;
  liveStatus: "aligned" | "partial" | "missing-doc";
  liveChecks: string[];
  notes: string | null;
};

export type RuntimeGovernanceSnapshot = {
  generatedAt: number;
  sections: RuntimeGovernanceSection[];
  reloads: ControlledReloadStatus[];
  documentation: RuntimeDocumentationReconciliation[];
};
