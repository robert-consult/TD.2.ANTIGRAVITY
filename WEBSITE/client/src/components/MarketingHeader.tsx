import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { APP_CONFIG } from "@/lib/app-config";
import { Menu, X } from "lucide-react";
import { useState } from "react";

/**
 * Public marketing website header — NO authentication.
 *
 * Login/Signup buttons are native <a> tags that redirect the browser
 * to tradehub.example.com. They do NOT use wouter <Link> because
 * that only handles same-origin SPA routing.
 */
export function MarketingHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 w-full border-b bg-card/90 backdrop-blur">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold text-primary">
          <svg
            className="h-7 w-7 text-primary"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 3v16a2 2 0 0 0 2 2h16" />
            <path d="m19 9-5 5-4-4-3 3" />
          </svg>
          <span className="text-xl font-bold">TradeQuip</span>
        </Link>

        <nav className="hidden md:flex gap-6 text-sm">
          <Link href="/dashboard" className="hover:text-primary transition-colors">
            Dashboard
          </Link>
          <Link href="/education" className="hover:text-primary transition-colors">
            Education
          </Link>
          <Link href="/platform-guide" className="hover:text-primary transition-colors">
            Platform Guide
          </Link>
          <Link href="/contact" className="hover:text-primary transition-colors">
            Contact
          </Link>
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <a href={APP_CONFIG.loginUrl}>
            <Button 
              size="sm"
              className="bg-[#2BFF88] hover:bg-[#1FD86C] text-[#041016] border-none"
            >
              Login
            </Button>
          </a>
          <a href={APP_CONFIG.signupUrl}>
            <Button 
              size="sm"
              className="bg-[#01D8C1] hover:bg-[#00BFA9] text-black border-none"
            >
              Sign Up
            </Button>
          </a>
        </div>

        <button
          className="md:hidden p-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        >
          {mobileMenuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t bg-card">
          <nav className="flex flex-col p-4 gap-4">
            <Link href="/dashboard" className="hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>
              Dashboard
            </Link>
            <Link href="/education" className="hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>
              Education
            </Link>
            <Link href="/platform-guide" className="hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>
              Platform Guide
            </Link>
            <Link href="/contact" className="hover:text-primary transition-colors" onClick={() => setMobileMenuOpen(false)}>
              Contact
            </Link>
            <div className="flex gap-2 pt-2 border-t">
              <a href={APP_CONFIG.loginUrl} onClick={() => setMobileMenuOpen(false)}>
                <Button 
                  size="sm"
                  className="bg-[#2BFF88] hover:bg-[#1FD86C] text-[#041016] border-none"
                >
                  Login
                </Button>
              </a>
              <a href={APP_CONFIG.signupUrl} onClick={() => setMobileMenuOpen(false)}>
                <Button 
                  size="sm"
                  className="bg-[#01D8C1] hover:bg-[#00BFA9] text-black border-none"
                >
                  Sign Up
                </Button>
              </a>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
