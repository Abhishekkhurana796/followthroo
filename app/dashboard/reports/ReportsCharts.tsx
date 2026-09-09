"use client";

/**
 * The only two components that touch recharts, split out so the rest of Reports
 * does not have to wait for it.
 *
 * recharts is a single ~400 KB chunk — statically imported it nearly doubled
 * this route's JavaScript, for two charts below the tiles. ReportsClient loads
 * this file with next/dynamic instead, so the numbers paint immediately and the
 * charting library streams in behind them.
 */
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, Legend,
} from "recharts";

const COLORS = { sent: "var(--ink)", opened: "var(--accent)", clicked: "var(--info)", replied: "var(--success)" };
const shortDate = (d: string) => d.slice(5); // MM-DD

const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--line)",
  background: "var(--surface-raised)",
  color: "var(--ink)",
  fontSize: 12,
} as const;

const AXIS_TICK = { fontSize: 11, fill: "var(--ink-soft)" } as const;

export type SeriesPoint = { date: string; sent: number; opened: number; clicked: number; replied: number };
export type CampaignRow = { id: string; name: string; sent: number; replied: number };

export function EngagementChart({ series }: { series: SeriesPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={series} margin={{ left: -20, right: 8, top: 8 }}>
        <defs>
          {Object.entries(COLORS).map(([k, c]) => (
            <linearGradient key={k} id={`g-${k}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={c} stopOpacity={0.25} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS_TICK} interval="preserveStartEnd" minTickGap={28} />
        <YAxis allowDecimals={false} tick={AXIS_TICK} width={40} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area type="monotone" dataKey="sent" stroke={COLORS.sent} fill="url(#g-sent)" strokeWidth={2} />
        <Area type="monotone" dataKey="opened" stroke={COLORS.opened} fill="url(#g-opened)" strokeWidth={2} />
        <Area type="monotone" dataKey="clicked" stroke={COLORS.clicked} fill="url(#g-clicked)" strokeWidth={2} />
        <Area type="monotone" dataKey="replied" stroke={COLORS.replied} fill="url(#g-replied)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function CampaignChart({ rows }: { rows: CampaignRow[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ left: -20, right: 8, top: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" vertical={false} />
        <XAxis
          dataKey="name"
          tick={AXIS_TICK}
          tickFormatter={(n: string) => (n.length > 10 ? n.slice(0, 10) + "…" : n)}
        />
        <YAxis allowDecimals={false} tick={AXIS_TICK} width={40} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="sent" fill={COLORS.sent} radius={[4, 4, 0, 0]} />
        <Bar dataKey="replied" fill={COLORS.replied} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
