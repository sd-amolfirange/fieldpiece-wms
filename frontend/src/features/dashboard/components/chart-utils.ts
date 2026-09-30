// Helpers for the dashboard chart kit (charts.tsx): series colours and share maths.

export const CHART_COLORS = [
  "var(--brand-500)",
  "var(--ink-900)",
  "var(--info)",
  "var(--success)",
  "var(--danger)",
  "var(--ink-400)",
  "var(--warning)",
  "var(--brand-800)",
];

/** Share of `part` in `whole`, as a whole-number percentage (0 when whole is 0). */
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

/** Tone for a used-share: under 75% fine, 75-100% watch, over 100% over budget. */
export const usageColor = (used: number) =>
  used > 100 ? "var(--danger)" : used >= 75 ? "var(--warning)" : "var(--success)";
