import type { Grant } from "../types";

interface Props {
  grants: Grant[];
}

interface CardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: string;
  accent: string;
}

function Card({ label, value, sub, icon, accent }: CardProps) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`text-2xl p-2 rounded-lg ${accent}`}>{icon}</div>
      <div className="min-w-0">
        <p className="text-gray-400 text-xs font-medium uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-bold text-white mt-0.5">{value}</p>
        {sub && <p className="text-gray-500 text-xs mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  );
}

function parseScore(g: Grant): number {
  // Prefer the personalized computed score; fall back to Weighted Score
  const computed = g.score;
  if (typeof computed === "number" && !isNaN(computed)) return computed;
  const v = g["Weighted Score"];
  if (typeof v === "number") return v;
  const n = parseFloat(String(v));
  return isNaN(n) ? 0 : n;
}

function getUpcomingDeadlines(grants: Grant[]): number {
  const now = Date.now();
  const soon = now + 90 * 24 * 60 * 60 * 1000;
  return grants.filter((g) => {
    const raw = g["Deadline/Next Cohort"];
    if (!raw) return false;
    const d = new Date(raw);
    return !isNaN(d.getTime()) && d.getTime() > now && d.getTime() < soon;
  }).length;
}

export default function SummaryCards({ grants }: Props) {
  const total = grants.length;

  const sorted = [...grants].sort((a, b) => parseScore(b) - parseScore(a));
  const topGrant = sorted[0];
  const topName = topGrant ? String(topGrant.Name || "—") : "—";
  const topScore = topGrant ? parseScore(topGrant).toFixed(1) : "—";

  const upcoming = getUpcomingDeadlines(grants);

  const nonDilutive = grants.filter((g) => {
    const v = String(g["Non-dilutive?"] || "").toLowerCase();
    return v === "yes" || v === "true" || v === "y";
  }).length;

  const avgScore =
    total > 0
      ? (grants.reduce((s, g) => s + parseScore(g), 0) / total).toFixed(1)
      : "—";

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <Card
        label="Total Grants"
        value={total}
        sub={`Avg score: ${avgScore}`}
        icon="📋"
        accent="bg-blue-900/40"
      />
      <Card
        label="Top Match"
        value={topScore}
        sub={topName}
        icon="🏆"
        accent="bg-yellow-900/40"
      />
      <Card
        label="Upcoming Deadlines"
        value={upcoming}
        sub="Within 90 days"
        icon="📅"
        accent="bg-orange-900/40"
      />
      <Card
        label="Non-Dilutive"
        value={nonDilutive}
        sub={`of ${total} total`}
        icon="✅"
        accent="bg-green-900/40"
      />
    </div>
  );
}
