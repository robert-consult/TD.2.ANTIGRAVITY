import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useQueryMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQuery: (...args: any[]) => useQueryMock(...args),
}));

import { GovernanceVisibilityTab } from "./GovernanceVisibilityTab";

describe("GovernanceVisibilityTab", () => {
  it("renders reload traces, section values, and documentation rows", () => {
    useQueryMock.mockReturnValue({
      isLoading: false,
      data: {
        generatedAt: 1_700_000_000,
        sections: [
          {
            id: "identity-session",
            title: "Identity And Session",
            description: "Session posture",
            entries: [
              {
                key: "cookieSecure",
                label: "Session Cookie Secure",
                value: true,
                source: "derived",
                mutability: "deploy-readonly",
                secret: false,
                secretConfigured: null,
                manifestValue: "true",
                manifestPath: "k8s/01-configmap.yaml",
                alignedWithManifest: true,
                notes: null,
              },
            ],
          },
        ],
        reloads: [
          {
            domain: "quotes.transport.feed",
            requestedVersion: 2,
            requestedAt: 1_700_000_100,
            requestedBy: "admin@local.test",
            requiredScope: "reload",
            changedKeys: ["feedPollMs"],
            status: "applied",
            acknowledgements: [
              {
                actorId: "quote-feed:pod-a",
                role: "quote-feed",
                nodeId: "pod-a",
                version: 2,
                status: "applied",
                updatedAt: 1_700_000_120,
                error: null,
                effectiveState: null,
              },
            ],
            lastAppliedVersion: 2,
            lastAppliedAt: 1_700_000_120,
            lastError: null,
            effectiveState: null,
            updatedAt: 1_700_000_120,
          },
        ],
        documentation: [
          {
            id: "wave5-completion",
            label: "Wave 5 Completion Record",
            docPath: "REPORTS AND REVIEWS/HARDCODING AUDIT/09_WAVE_5_COMPLETION.md",
            exists: true,
            lastModifiedAt: 1_700_000_200,
            liveStatus: "aligned",
            liveChecks: ["/api/admin/runtime-config/governance"],
            notes: "doc note",
          },
        ],
      },
    });

    render(<GovernanceVisibilityTab />);

    expect(screen.getByTestId("governance-visibility-tab")).toBeInTheDocument();
    expect(screen.getByText("Controlled Reload Traces")).toBeInTheDocument();
    expect(screen.getByText("quotes.transport.feed")).toBeInTheDocument();
    expect(screen.getByText("Identity And Session")).toBeInTheDocument();
    expect(screen.getByText("Session Cookie Secure")).toBeInTheDocument();
    expect(screen.getByText("Wave 5 Completion Record")).toBeInTheDocument();
  });
});
