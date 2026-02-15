import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, Volume2, VolumeX } from "lucide-react";
import { useNotifications } from "@/hooks/use-notifications";
import { isNotificationSoundEnabled, setNotificationSoundEnabled } from "@/lib/notificationSound";

const CLOSE_NOTIFICATIONS_EVENT = "tq:close-notifications";
const CLOSE_HEADER_MENU_EVENT = "tq:close-header-menu";

function toLocalDateLabel(value: number | null | undefined): string {
  if (!value) return "";
  const ms = value < 1e12 ? value * 1000 : value;
  const dt = new Date(ms);
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toLocaleString();
}

type PanelStyle = {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isNotificationSoundEnabled());
  const [panelStyle, setPanelStyle] = useState<PanelStyle>({ top: 56, left: 8, width: 320, maxHeight: 420 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { rows, unreadCount, isLoading, markRead, markAllRead, markReadMutation, config } = useNotifications(20);

  const hasRows = rows.length > 0;
  const unreadIds = useMemo(() => rows.filter((row) => !row.isRead).map((row) => row.id), [rows]);
  const globalSoundEnabled = config?.notificationSoundDefaultEnabled ?? true;
  const notificationsEnabled = config?.notificationsEnabled ?? true;

  useEffect(() => {
    if (!open) return;

    const recalc = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const horizontalPadding = 8;
      const verticalPadding = 8;
      const availableWidth = Math.max(120, vw - horizontalPadding * 2);
      const width = Math.min(380, availableWidth);

      let left = clamp(
        rect.right - width,
        horizontalPadding,
        Math.max(horizontalPadding, vw - width - horizontalPadding),
      );
      let top = rect.bottom + verticalPadding;
      const viewportMaxHeight = Math.max(120, vh - verticalPadding * 2);
      let maxHeight = Math.max(80, Math.min(viewportMaxHeight, vh - top - verticalPadding));

      if (maxHeight < 180) {
        const aboveSpace = rect.top - verticalPadding * 2;
        const preferredHeight = Math.min(460, viewportMaxHeight);
        const heightAbove = Math.max(80, Math.min(preferredHeight, aboveSpace));
        if (heightAbove > maxHeight) {
          top = Math.max(verticalPadding, rect.top - heightAbove - verticalPadding);
          maxHeight = Math.max(80, Math.min(viewportMaxHeight, vh - top - verticalPadding));
        }
      }

      if (left + width + horizontalPadding > vw) {
        left = Math.max(horizontalPadding, vw - width - horizontalPadding);
      }
      if (top + maxHeight + verticalPadding > vh) {
        top = Math.max(verticalPadding, vh - maxHeight - verticalPadding);
      }
      if (top < verticalPadding) {
        top = verticalPadding;
      }

      setPanelStyle({ top, left, width, maxHeight });
    };

    recalc();
    window.addEventListener("resize", recalc);
    window.addEventListener("orientationchange", recalc);
    window.addEventListener("scroll", recalc, true);

    return () => {
      window.removeEventListener("resize", recalc);
      window.removeEventListener("orientationchange", recalc);
      window.removeEventListener("scroll", recalc, true);
    };
  }, [open]);

  useEffect(() => {
    const handleClose = () => setOpen(false);
    window.addEventListener(CLOSE_NOTIFICATIONS_EVENT, handleClose);
    return () => window.removeEventListener(CLOSE_NOTIFICATIONS_EVENT, handleClose);
  }, []);

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          window.dispatchEvent(new Event(CLOSE_HEADER_MENU_EVENT));
          setOpen((prev) => !prev);
        }}
        data-testid="notifications-trigger"
        className="tq-notify-trigger relative h-10 w-10 rounded-full border border-white/10 bg-white/[0.03] text-gray-300 hover:text-white hover:bg-white/10 transition-colors flex items-center justify-center"
        aria-label="Notifications"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 ? (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-sky-500 text-[10px] leading-[18px] text-white font-semibold px-1 text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close notifications"
            className="tq-overlay-backdrop fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            data-testid="notifications-panel"
            className="tq-popup-panel tq-notify-panel fixed bg-[#151515] border border-white/10 rounded-xl shadow-[0_12px_36px_rgba(0,0,0,0.45)] z-50 overflow-hidden flex flex-col"
            style={{
              top: `${panelStyle.top}px`,
              left: `${panelStyle.left}px`,
              width: `${panelStyle.width}px`,
              maxHeight: `${panelStyle.maxHeight}px`,
            }}
          >
            <div className="tq-notify-head px-4 py-3 border-b border-white/10 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold text-white">Notifications</div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    if (!globalSoundEnabled) return;
                    const next = !soundEnabled;
                    setSoundEnabled(next);
                    setNotificationSoundEnabled(next);
                  }}
                  disabled={!globalSoundEnabled}
                  className="tq-notify-head-action text-xs px-2 py-1 rounded-md border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none transition-colors"
                  title={globalSoundEnabled ? "Toggle notification sound" : "Sound is disabled by admin"}
                >
                  {globalSoundEnabled && soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  onClick={() => markAllRead()}
                  disabled={!unreadIds.length || markReadMutation.isPending}
                  className="tq-notify-head-action text-xs px-2 py-1 rounded-md border border-white/15 text-gray-300 hover:text-white hover:bg-white/10 disabled:opacity-50 disabled:pointer-events-none transition-colors inline-flex items-center gap-1"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Mark all
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto">
              {!notificationsEnabled ? (
                <div className="px-4 py-6 text-sm text-gray-400">Notifications are currently disabled by admin.</div>
              ) : isLoading ? (
                <div className="px-4 py-6 text-sm text-gray-400">Loading notifications…</div>
              ) : !hasRows ? (
                <div className="px-4 py-6 text-sm text-gray-400">No notifications yet.</div>
              ) : (
                rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`tq-notify-row w-full text-left px-4 py-3 border-b border-white/5 hover:bg-white/[0.04] transition-colors ${row.isRead ? "opacity-75" : ""}`}
                    onClick={() => {
                      if (!row.isRead) {
                        markRead([row.id]);
                      }
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-white truncate">{row.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5 break-words">{row.message}</div>
                        <div className="text-[11px] text-gray-500 mt-1">{toLocalDateLabel(row.createdAt)}</div>
                      </div>
                      {!row.isRead ? <span className="mt-1 h-2 w-2 rounded-full bg-sky-400 shrink-0" /> : null}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
