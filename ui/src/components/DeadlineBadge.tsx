export default function DeadlineBadge({ value }: { value: string | number }) {
  const raw = String(value || "");
  if (!raw) return <span className="text-gray-500 text-xs" aria-label="No deadline">—</span>;
  const d = new Date(raw);
  if (isNaN(d.getTime())) return <span className="text-gray-300 text-xs">{raw}</span>;
  const now = Date.now();
  const days = Math.ceil((d.getTime() - now) / (1000 * 60 * 60 * 24));
  const isPast = days < 0;
  const isUrgent = !isPast && days < 30;
  const isSoon = !isPast && days < 90;
  const color = isPast
    ? "text-gray-500 line-through"
    : isUrgent
      ? "text-red-400"
      : isSoon
        ? "text-yellow-400"
        : "text-gray-300";
  const dateStr = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const urgencyText = isPast ? "Past" : isUrgent ? "Urgent" : isSoon ? "Soon" : "";
  return (
    <span
      className="inline-flex items-center gap-1 flex-wrap"
      aria-label={isPast ? `Deadline passed: ${dateStr}` : urgencyText ? `Deadline: ${dateStr}, ${urgencyText}` : `Deadline: ${dateStr}`}
    >
      <span className={`text-xs ${color}`} aria-hidden="true">{dateStr}</span>
      {isUrgent && (
        <span className="inline-block px-1 py-px text-[10px] font-bold uppercase tracking-wide bg-red-900/50 text-red-300 rounded leading-none">
          Urgent
        </span>
      )}
      {!isUrgent && isSoon && (
        <span className="inline-block px-1 py-px text-[10px] font-bold uppercase tracking-wide bg-yellow-900/40 text-yellow-400 rounded leading-none">
          Soon
        </span>
      )}
    </span>
  );
}
