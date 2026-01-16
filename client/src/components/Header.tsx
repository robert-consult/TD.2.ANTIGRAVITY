import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Link } from "wouter";
import { User, Settings, LogOut, ChevronDown } from "lucide-react";
import { TierBadge } from "@/components/TierBadge";
import type { UserTier } from "@shared/schema";

type HeaderProps = {
  title?: string;
};

export function Header({ title = "TradeQuip" }: HeaderProps) {
  const { user, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
  };

  const userInitials = user?.username 
    ? user.username.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() || "U";

  return (
    <header className="bg-[#0F0F0F] border-b border-white/5 py-3 px-gutter shrink-0">
      <div className="flex justify-between items-center">
        <div className="flex items-center">
          <h1 className="text-xl font-bold text-white">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="inline-block mr-2 h-5 w-5 text-primary"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 3v18h18" />
              <path d="m19 9-5-5-4 4-4 4" />
              <path d="m14 4 5 5" />
            </svg>
            {title}
          </h1>
        </div>

        {user && (
          <div className="flex items-center relative">
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-3 bg-white/[0.03] hover:bg-white/[0.08] border border-white/10 hover:border-white/20 px-2 py-1.5 rounded-full transition-all duration-200 group"
            >
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center ring-2 ring-[#1A1A1A]">
                <span className="text-xs font-semibold text-white">{userInitials}</span>
              </div>
              <div className="hidden md:flex items-center gap-2 pr-1">
                <span className="text-sm font-medium text-white/90">{user.username || user.email?.split("@")[0]}</span>
                <TierBadge tier={((user as any)?.userTier as UserTier) || "CANDIDATE"} size="sm" showLabel={false} />
              </div>
              <ChevronDown className={`h-4 w-4 text-gray-400 group-hover:text-gray-300 transition-transform duration-200 ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
            
            {dropdownOpen && (
              <>
                <div 
                  className="fixed inset-0 z-40" 
                  onClick={() => setDropdownOpen(false)}
                />
                <div className="absolute right-0 top-full mt-2 w-64 bg-[#1A1A1A] border border-white/10 rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.5)] z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                  <div className="p-4 border-b border-white/5">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center ring-2 ring-white/10">
                        <span className="text-sm font-semibold text-white">{userInitials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white truncate">{user.username || user.email?.split("@")[0]}</span>
                          <TierBadge tier={((user as any)?.userTier as UserTier) || "CANDIDATE"} size="sm" />
                        </div>
                        <div className="text-xs text-gray-500 truncate mt-0.5">{user.email}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <span className="flex items-center gap-1.5 text-xs text-green-400">
                        <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse"></span>
                        Online
                      </span>
                      <span className="text-gray-600">•</span>
                      <span className="text-xs text-gray-500">Real-time Data</span>
                    </div>
                  </div>
                  
                  <div className="p-2">
                    <Link 
                      href="/profile"
                      onClick={() => setDropdownOpen(false)}
                      className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                      Profile Settings
                    </Link>
                    
                    <div className="h-px bg-white/5 my-2" />
                    
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Sign out
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
