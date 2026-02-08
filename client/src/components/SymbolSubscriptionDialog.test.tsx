import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SymbolSubscriptionDialog } from "@/components/SymbolSubscriptionDialog";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: (props: { open: boolean; children: ReactNode }) => (props.open ? <div>{props.children}</div> : null),
  DialogContent: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogDescription: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogFooter: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogHeader: (props: { children: ReactNode }) => <div>{props.children}</div>,
  DialogTitle: (props: { children: ReactNode }) => <div>{props.children}</div>,
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>("@/lib/queryClient");
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

type SymbolRow = {
  id: number;
  symbol: string;
  name: string;
  category: string | null;
  enabled: boolean;
};

const baseSubscriptions: SymbolRow[] = [
  { id: 1, symbol: "EURUSD", name: "Euro / US Dollar", category: "forex", enabled: true },
];

const availableRows: SymbolRow[] = [
  ...baseSubscriptions,
  { id: 2, symbol: "AAPL", name: "Apple Inc.", category: "stocks", enabled: false },
];

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const response = await fetch(String(queryKey[0]));
          return await response.json();
        },
      },
      mutations: {
        retry: false,
      },
    },
  });
}

function asJsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function installFetchMock() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");

    if (url.pathname === "/api/quote-subscriptions/me/subscriptions") {
      return asJsonResponse({ subscriptions: baseSubscriptions });
    }

    if (url.pathname === "/api/quote-subscriptions/available-symbols") {
      const q = String(url.searchParams.get("q") ?? "").toUpperCase();
      const rows = q
        ? availableRows.filter((row) => row.symbol.includes(q) || row.name.toUpperCase().includes(q))
        : availableRows;
      return asJsonResponse({ q, limit: 180, rows });
    }

    return asJsonResponse({});
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderDialog() {
  const queryClient = createQueryClient();
  const onOpenChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <SymbolSubscriptionDialog
        open={true}
        onOpenChange={onOpenChange}
        mode="add"
        effectiveMode="BASIC_PLUS_CUSTOM"
      />
    </QueryClientProvider>,
  );
  return { onOpenChange };
}

describe("SymbolSubscriptionDialog", () => {
  beforeEach(() => {
    vi.mocked(apiRequest).mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("debounces available symbol search requests by 300ms", async () => {
    const fetchMock = installFetchMock();
    renderDialog();

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/quote-subscriptions/available-symbols?limit=180&excludeAllowed=true"),
      ),
    );

    fetchMock.mockClear();
    vi.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("Search symbols, names, or categories..."), {
      target: { value: "AAPL" },
    });

    await act(async () => {
      vi.advanceTimersByTime(299);
    });

    const beforeDebounce = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("/api/quote-subscriptions/available-symbols?q=AAPL&limit=180&excludeAllowed=true"),
    );
    expect(beforeDebounce.length).toBe(0);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });

    const calls = fetchMock.mock.calls.filter(([arg]) =>
      String(arg).includes("/api/quote-subscriptions/available-symbols?q=AAPL&limit=180&excludeAllowed=true"),
    );
    expect(calls.length).toBeGreaterThan(0);
  });

  it("saves updated symbol ids when a new symbol is added", async () => {
    installFetchMock();
    vi.mocked(apiRequest).mockResolvedValue(
      asJsonResponse({ ok: true, subscriptions: [...baseSubscriptions, availableRows[1]] }),
    );

    renderDialog();

    await waitFor(() => expect(screen.getByText("AAPL")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Add$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save Added Symbols" }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/quote-subscriptions/me/subscriptions",
        { symbolIds: [1, 2] },
      );
    });
  });
});
