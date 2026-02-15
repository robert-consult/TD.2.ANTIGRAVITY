import * as React from "react";

import { cn } from "@/lib/utils";

type AppShellProps = {
  header?: React.ReactNode;
  sidebar?: React.ReactNode;
  mobileNav?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
};

export function AppShell({
  header,
  sidebar,
  mobileNav,
  children,
  className,
  contentClassName,
}: AppShellProps) {
  return (
    <div
      className={cn(
        "h-dvh flex flex-col overflow-hidden bg-background text-foreground",
        className
      )}
    >
      {header ? <div className="shrink-0">{header}</div> : null}

      <div className="@container/app flex-1 min-h-0 overflow-hidden flex flex-col">
        <div className="flex-1 min-h-0 overflow-hidden flex">
          {sidebar ? (
            <aside className="hidden @3xl/app:block w-sidebar shrink-0">
              {sidebar}
            </aside>
          ) : null}

          <main
            className={cn("flex-1 min-w-0 min-h-0 overflow-hidden", contentClassName)}
          >
            {children}
          </main>
        </div>

        {mobileNav ? (
          <>
            <div
              aria-hidden
              className="shrink-0 h-[calc(4.5rem+env(safe-area-inset-bottom))] @3xl/app:hidden"
            />
            <div className="fixed inset-x-0 bottom-0 z-40 @3xl/app:hidden">
              {mobileNav}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
