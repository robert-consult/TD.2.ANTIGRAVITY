import { Trophy, User } from "lucide-react";

interface NavigationProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export function MobileNavigation({ activeTab, setActiveTab }: NavigationProps) {
  return (
    <div className="tq-mobile-nav bg-neutral-850 border-t border-gray-800 shrink-0 pb-[env(safe-area-inset-bottom)]">
      <div className="grid grid-cols-6">
        <button
          data-active={activeTab === "quotes"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "quotes"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("quotes")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          Quotes
        </button>
        <button
          data-active={activeTab === "chart"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "chart"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("chart")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 8h7" />
            <path d="M8 12h6" />
            <path d="M11 16h4" />
          </svg>
          Chart
        </button>
        <button
          data-active={activeTab === "trade"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "trade"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("trade")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
          Trade
        </button>
        <button
          data-active={activeTab === "history"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "history"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("history")}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v18h18" />
            <path d="m19 9-5-5-4 4-4 4" />
          </svg>
          History
        </button>
        <button
          data-active={activeTab === "leaderboard"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "leaderboard"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("leaderboard")}
        >
          <Trophy className="h-4 w-4" />
          Leaders
        </button>
        <button
          data-active={activeTab === "account"}
          className={`tq-mobile-nav-btn flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium border-t-2 ${
            activeTab === "account"
              ? "border-primary text-primary"
              : "border-transparent text-gray-400"
          }`}
          onClick={() => setActiveTab("account")}
        >
          <User className="h-4 w-4" />
          Account
        </button>
      </div>
    </div>
  );
}

export function SideNavigation({ activeTab, setActiveTab }: NavigationProps) {
  return (
    <div className="tq-side-nav h-full w-full bg-neutral-850 border-r border-gray-800">
      <nav className="py-4 sticky top-0">
        <div className="space-y-1 px-3">
          <button
            data-active={activeTab === "quotes"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "quotes" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("quotes")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`mr-3 h-5 w-5 ${
                activeTab === "quotes" ? "text-primary" : "text-gray-400"
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
            Quotes
          </button>
          <button
            data-active={activeTab === "chart"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "chart" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("chart")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`mr-3 h-5 w-5 ${
                activeTab === "chart" ? "text-primary" : "text-gray-400"
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="3" y1="15" x2="21" y2="15" />
              <line x1="9" y1="9" x2="9" y2="21" />
              <line x1="15" y1="9" x2="15" y2="21" />
            </svg>
            Chart
          </button>
          <button
            data-active={activeTab === "trade"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "trade" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("trade")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`mr-3 h-5 w-5 ${
                activeTab === "trade" ? "text-primary" : "text-gray-400"
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m17 2 4 4-4 4" />
              <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
              <path d="m7 22-4-4 4-4" />
              <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            </svg>
            Trade
          </button>
          <button
            data-active={activeTab === "history"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "history" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("history")}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`mr-3 h-5 w-5 ${
                activeTab === "history" ? "text-primary" : "text-gray-400"
              }`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
              <polyline points="14 2 14 8 20 8" />
              <line x1="16" y1="13" x2="8" y2="13" />
              <line x1="16" y1="17" x2="8" y2="17" />
              <line x1="10" y1="9" x2="8" y2="9" />
            </svg>
            History
          </button>
          <button
            data-active={activeTab === "leaderboard"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "leaderboard" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("leaderboard")}
          >
            <Trophy
              className={`mr-3 h-5 w-5 ${
                activeTab === "leaderboard" ? "text-primary" : "text-gray-400"
              }`}
            />
            Leaderboard
          </button>
          <button
            data-active={activeTab === "account"}
            className={`tq-side-nav-btn w-full flex items-center px-3 py-2.5 text-left text-sm font-medium rounded-md hover:bg-gray-800 ${
              activeTab === "account" ? "bg-gray-800 text-white" : "text-gray-300"
            }`}
            onClick={() => setActiveTab("account")}
          >
            <User
              className={`mr-3 h-5 w-5 ${
                activeTab === "account" ? "text-primary" : "text-gray-400"
              }`}
            />
            Account
          </button>
        </div>
      </nav>
    </div>
  );
}
