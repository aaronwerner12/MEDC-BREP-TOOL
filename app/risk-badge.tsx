import type { RiskLevel, Trend } from "@/lib/risk";

// Colored risk-index chip with an optional trend arrow. Presentational only.
export function RiskBadge({
  score,
  level,
  trend,
}: {
  score: number;
  level: RiskLevel;
  trend?: Trend;
}) {
  return (
    <span className={`risk-badge ${level}`} title="Retention risk index (0-100)">
      <span className="rb-score">{score}</span>
      {trend && trend !== "new" && (
        <span className={`rb-trend ${trend}`}>
          {trend === "up" ? "↑" : trend === "down" ? "↓" : "→"}
        </span>
      )}
    </span>
  );
}
