export type ActivityEvent = {
  id: string;
  type: string;
  title: string;
  description: string;
  severity?: 'info' | 'warning' | 'error' | 'success';
  timestamp: string;
  metadata?: Record<string, any>;
};

function formatWhen(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function getDotColor(type: string, severity?: string) {
  if (severity === 'error') return 'bg-red-500 border-red-400';
  if (severity === 'warning') return 'bg-amber-500 border-amber-400';
  if (severity === 'success') return 'bg-green-500 border-green-400';
  
  switch (type) {
    case 'LOGIN':
      return 'bg-blue-500 border-blue-400';
    case 'TRADE_OPEN':
    case 'TRADE_CLOSE':
      return 'bg-emerald-500 border-emerald-400';
    case 'ADMIN_ACTION':
    case 'FREEZE':
    case 'UNFREEZE':
      return 'bg-amber-500 border-amber-400';
    case 'STATUS_CHANGE':
      return 'bg-purple-500 border-purple-400';
    default:
      return 'bg-neutral-500 border-neutral-400';
  }
}

export function ActivityTimeline({
  events,
  emptyText = "No activity yet.",
}: {
  events: ActivityEvent[];
  emptyText?: string;
}) {
  if (!events || events.length === 0) {
    return (
      <div className="rounded-md border border-neutral-700 bg-neutral-900/40 p-3 text-sm text-neutral-400">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-neutral-700 bg-neutral-900/40 p-3">
      <ol className="relative ml-2">
        <div className="absolute left-[7px] top-0 h-full w-px bg-neutral-700" />

        {events.map((e, idx) => (
          <li key={`${e.id}-${idx}`} className="relative pl-6 pb-5 last:pb-0">
            <span className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border ${getDotColor(e.type, e.severity)}`} />

            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold text-neutral-100">
                  {e.title}
                </span>
                <span className="text-xs text-neutral-400">
                  {formatWhen(e.timestamp)}
                </span>
              </div>

              <div className="text-xs text-neutral-300">
                {e.description}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default ActivityTimeline;
