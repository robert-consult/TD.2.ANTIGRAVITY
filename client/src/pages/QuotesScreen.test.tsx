import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import QuotesScreen from "@/pages/QuotesScreen";

const useQuotesMock = vi.fn();
const useQueryMock = vi.fn();

vi.mock("@/hooks/use-quotes", () => ({
  useQuotes: () => useQuotesMock(),
}));

vi.mock("@tanstack/react-query", async () => {
  const actual = await vi.importActual<typeof import("@tanstack/react-query")>("@tanstack/react-query");
  return {
    ...actual,
    useQuery: (args: any) => useQueryMock(args),
  };
});

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({
    isAuthenticated: true,
  }),
}));

vi.mock("@/components/SymbolSubscriptionDialog", () => ({
  SymbolSubscriptionDialog: (props: { open: boolean; mode: "add" | "manage" }) =>
    props.open ? <div data-testid={`dialog-${props.mode}`}>{props.mode}</div> : null,
}));

type QuotesStateMock = {
  quotes: any[];
  isLoading: boolean;
  isConnected: boolean;
  hasStaleData: boolean;
  supportsCustom: boolean;
  effectiveMode: "BASIC_ONLY" | "BASIC_PLUS_CUSTOM" | "CUSTOM_ONLY";
};

function setQuotesState(overrides: Partial<QuotesStateMock> = {}) {
  useQuotesMock.mockReturnValue({
    quotes: [],
    isLoading: false,
    isConnected: true,
    hasStaleData: false,
    supportsCustom: false,
    effectiveMode: "BASIC_ONLY",
    ...overrides,
  });
}

function setQuoteModeState(mode: QuotesStateMock["effectiveMode"], supportsCustom: boolean) {
  useQueryMock.mockImplementation((args: any) => {
    const key = args?.queryKey?.[0];
    if (key === "/api/quote-subscriptions/allowed-symbols") {
      return { data: { symbols: [] } };
    }
    if (key === "/api/quote-subscriptions/me") {
      return {
        data: {
          effectiveMode: mode,
          supportsCustom,
        },
      };
    }
    return { data: undefined };
  });
}

function buildQuotes(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    symbol: `SYM${String(index).padStart(3, "0")}`,
    name: `Instrument ${index}`,
    price: 1.2 + index / 1000,
    change: 0,
    spread: 0.0002,
    percent_change: 0,
    bid: 1.1 + index / 1000,
    ask: 1.3 + index / 1000,
  }));
}

describe("QuotesScreen", () => {
  it("hides customization icons when custom mode is not supported", () => {
    setQuotesState({ supportsCustom: false, effectiveMode: "BASIC_ONLY" });
    setQuoteModeState("BASIC_ONLY", false);
    render(<QuotesScreen onSelectSymbol={vi.fn()} />);

    expect(screen.queryByLabelText("Add quote symbol")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Manage quote symbols")).not.toBeInTheDocument();
  });

  it("shows customization icons when custom mode is supported", () => {
    setQuotesState({ supportsCustom: true, effectiveMode: "BASIC_PLUS_CUSTOM" });
    setQuoteModeState("BASIC_PLUS_CUSTOM", true);
    render(<QuotesScreen onSelectSymbol={vi.fn()} />);

    expect(screen.getByLabelText("Add quote symbol")).toBeInTheDocument();
    expect(screen.getByLabelText("Manage quote symbols")).toBeInTheDocument();
  });

  it("closes customization dialogs immediately when support is withdrawn", () => {
    let supportsCustom = true;
    let mode: QuotesStateMock["effectiveMode"] = "BASIC_PLUS_CUSTOM";
    useQuotesMock.mockImplementation(() => ({
      quotes: [],
      isLoading: false,
      isConnected: true,
      hasStaleData: false,
      supportsCustom,
      effectiveMode: mode,
    }));
    useQueryMock.mockImplementation((args: any) => {
      const key = args?.queryKey?.[0];
      if (key === "/api/quote-subscriptions/allowed-symbols") {
        return { data: { symbols: [] } };
      }
      if (key === "/api/quote-subscriptions/me") {
        return {
          data: {
            effectiveMode: mode,
            supportsCustom,
          },
        };
      }
      return { data: undefined };
    });

    const { rerender } = render(<QuotesScreen onSelectSymbol={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("Add quote symbol"));
    expect(screen.getByTestId("dialog-add")).toBeInTheDocument();

    supportsCustom = false;
    mode = "BASIC_ONLY";
    rerender(<QuotesScreen onSelectSymbol={vi.fn()} />);

    expect(screen.queryByTestId("dialog-add")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add quote symbol")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Manage quote symbols")).not.toBeInTheDocument();
  });

  it("virtualizes large quote lists without breaking symbol selection", () => {
    const onSelectSymbol = vi.fn();
    setQuotesState({
      quotes: buildQuotes(500),
    });
    setQuoteModeState("BASIC_ONLY", false);

    const { container } = render(<QuotesScreen onSelectSymbol={onSelectSymbol} />);

    const mountedRows = container.querySelectorAll(".tq-quote-row");
    expect(mountedRows.length).toBeGreaterThan(0);
    expect(mountedRows.length).toBeLessThan(500);
    expect(screen.queryByText("SYM499")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("SYM000"));
    expect(onSelectSymbol).toHaveBeenCalledWith("SYM000");

    fireEvent.change(screen.getByPlaceholderText("Search instruments..."), {
      target: { value: "SYM499" },
    });
    fireEvent.click(screen.getByText("SYM499"));
    expect(onSelectSymbol).toHaveBeenCalledWith("SYM499");
  });
});
