import { useState } from "react";
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line as RLine,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type AxisDomain,
} from "recharts";
import { ChevronDown, ChevronRight } from "lucide-react";

import { TIER_HEX, tierOf } from "@/lib/oee/config";
import type { LossNode, Point } from "@/lib/oee/data";
import { cn } from "@/lib/utils";

import { METRIC_CONFIG, METRICS_ORDER, type MetricId } from "./metric-dropdown";

const AXIS = { fontSize: 10, fill: "var(--muted-foreground)" } as const;

export type Measure = "minutes" | "occurrences";

export function MeasureToggle({
  value,
  onChange,
}: {
  value: Measure;
  onChange: (m: Measure) => void;
}) {
  return (
    <div className="flex items-center rounded-lg bg-muted p-0.5 text-[11px]">
      {(
        [
          ["minutes", "By minutes"],
          ["occurrences", "By occurrences"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={cn(
            "rounded-md px-3 py-1.5 font-semibold transition-colors",
            value === id
              ? "bg-surface text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Sparkline({ data, dataKey = "v" }: { data: Point[]; dataKey?: string }) {
  return (
    <div className="h-8 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <RLine
            type="monotone"
            dataKey={dataKey}
            stroke="var(--primary)"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function formatKNumber(num: number): string {
  if (num === 0) return "0";
  if (Math.abs(num) >= 1_000_000) {
    const formatted = (num / 1_000_000).toFixed(1);
    return `${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}M`;
  }
  if (Math.abs(num) >= 1_000) {
    const formatted = (num / 1_000).toFixed(1);
    return `${formatted.endsWith(".0") ? formatted.slice(0, -2) : formatted}K`;
  }
  return num.toString();
}

interface TooltipEntry {
  dataKey?: string | number;
  name?: string;
  value?: number | string | null;
  color?: string;
}

function CustomTrendTooltip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
  unit?: string;
}) {
  if (!active || !payload || !payload.length) return null;

  const FIXED_ORDER = [
    "OEE",
    "Availability",
    "Performance",
    "Quality",
    "Actual",
    "Plan",
    "Speed",
    "Cumulative %",
  ];

  const sortedPayload = [...payload].sort((a, b) => {
    const idxA = FIXED_ORDER.indexOf(String(a.dataKey));
    const idxB = FIXED_ORDER.indexOf(String(b.dataKey));
    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
    if (idxA !== -1) return -1;
    if (idxB !== -1) return 1;
    return 0;
  });

  return (
    <div className="rounded-lg border border-border bg-surface p-2.5 shadow-lg text-[11px] min-w-[140px] z-50">
      <p className="font-semibold text-foreground mb-1.5 border-b border-border/60 pb-1">{label}</p>
      <div className="space-y-1">
        {sortedPayload.map((entry) => {
          const key = String(entry.dataKey);
          const rawVal = entry.value;
          let formattedVal = "—";
          if (rawVal !== null && rawVal !== undefined && !isNaN(Number(rawVal))) {
            const num = Number(rawVal);
            if (unit === "pcs" || key === "Actual" || key === "Plan") {
              formattedVal = `${num.toLocaleString()} pcs`;
            } else if (unit === "ppm" || key === "Speed") {
              formattedVal = `${num.toFixed(1)} ppm`;
            } else if (unit) {
              formattedVal = `${num.toFixed(1)} ${unit}`;
            } else {
              formattedVal = `${num.toFixed(1)}%`;
            }
          }

          const config = METRIC_CONFIG[key as MetricId];
          const fallbackColors = [
            "var(--primary)",
            "var(--tier-warn)",
            "var(--tier-good)",
            "var(--loss-quality)",
          ];
          const dotColor =
            config?.dot ??
            entry.color ??
            fallbackColors[sortedPayload.indexOf(entry) % fallbackColors.length];

          return (
            <div key={key} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: dotColor }}
                />
                <span className="text-muted-foreground truncate">{key}</span>
              </div>
              <span className="font-mono font-medium text-foreground shrink-0">{formattedVal}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DEFAULT_LINE_COLORS = [
  "var(--primary)",
  "var(--tier-warn)",
  "var(--tier-good)",
  "var(--loss-quality)",
  "var(--muted-foreground)",
];

export function TrendChart({
  data,
  keys,
  selectedMetrics,
  reference,
  height,
  domain,
  unit,
  yTickFormatter,
}: {
  data: Point[];
  keys?: string[];
  selectedMetrics?: MetricId[];
  reference?: number;
  height?: number;
  domain?: [string | number, string | number] | (string | number)[];
  unit?: string;
  yTickFormatter?: (value: number) => string;
}) {
  const activeMetrics = selectedMetrics ?? keys ?? ["OEE"];

  // Sort active metrics if using multi-metric selector, otherwise preserve keys order
  const sortedMetrics = keys ? keys : METRICS_ORDER.filter((m) => activeMetrics.includes(m));

  // Show reference target line if reference is set and (OEE is selected OR this is a single/custom metric chart like Speed)
  const showReference =
    reference !== undefined && (!selectedMetrics || selectedMetrics.includes("OEE"));

  if (!data || data.length === 0) {
    return (
      <div className="flex h-[250px] w-full items-center justify-center text-sm text-muted-foreground">
        No data
      </div>
    );
  }

  // Determine YAxis domain & tick formatter
  const yDomain = domain ?? (selectedMetrics ? [0, 100] : ["auto", "auto"]);
  const tickFormatter =
    yTickFormatter ??
    (unit === "pcs"
      ? formatKNumber
      : unit === "ppm"
        ? (v: number) => String(Math.round(v))
        : undefined);

  return (
    <div
      className="relative h-[250px] max-h-[350px] min-h-[200px] w-full"
      style={height ? { height } : undefined}
    >
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis dataKey="label" tick={AXIS} stroke="var(--grid)" />
          <YAxis
            tick={AXIS}
            stroke="var(--grid)"
            domain={yDomain as AxisDomain}
            tickFormatter={tickFormatter}
            width={38}
          />
          <Tooltip content={<CustomTrendTooltip unit={unit} />} />
          <Legend
            wrapperStyle={{ fontSize: 10, paddingTop: 4 }}
            formatter={(value) => <span className="text-foreground font-medium">{value}</span>}
          />
          {showReference && (
            <ReferenceLine y={reference} stroke="var(--muted-foreground)" strokeDasharray="4 4" />
          )}
          {sortedMetrics.map((m, i) => {
            const config = METRIC_CONFIG[m as MetricId];
            const strokeColor =
              config?.stroke ?? DEFAULT_LINE_COLORS[i % DEFAULT_LINE_COLORS.length];

            return (
              <RLine
                key={m}
                name={m}
                type="monotone"
                dataKey={m}
                stroke={strokeColor}
                strokeWidth={1.8}
                dot={{ r: 2 }}
                connectNulls={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarByLine({
  data,
  onSelect,
  height,
}: {
  data: { label: string; value: number }[];
  onSelect?: (label: string) => void;
  height?: number;
}) {
  return (
    <div className="relative min-h-[250px] w-full flex-1" style={height ? { height } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ ...AXIS, fontSize: 9 }}
            stroke="var(--grid)"
            interval={0}
            angle={-35}
            height={40}
            textAnchor="end"
          />
          <YAxis tick={AXIS} stroke="var(--grid)" domain={[0, 100]} />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="value"
            radius={[3, 3, 0, 0]}
            onClick={(d: { label?: string }) => d.label && onSelect?.(d.label)}
          >
            {data.map((d) => (
              <Cell key={d.label} fill={TIER_HEX[tierOf(d.value)]} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ParetoChart({
  data,
  selected,
  onSelect,
  height,
}: {
  data: { label: string; value: number; id: string }[];
  selected?: string | undefined;
  onSelect?: (id: string) => void;
  height?: number;
}) {
  const total = data.reduce((a, b) => a + b.value, 0) || 1;
  let running = 0;
  const rows = data.map((d) => {
    running += d.value;
    return { ...d, cumulative: Math.round((running / total) * 1000) / 10 };
  });
  return (
    <div className="relative min-h-[250px] w-full flex-1" style={height ? { height } : undefined}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--grid)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ ...AXIS, fontSize: 9 }}
            stroke="var(--grid)"
            interval={0}
            angle={-25}
            height={48}
            textAnchor="end"
          />
          <YAxis yAxisId="left" tick={AXIS} stroke="var(--grid)" />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={AXIS}
            stroke="var(--grid)"
            domain={[0, 100]}
            unit="%"
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 11,
            }}
          />
          <Bar
            yAxisId="left"
            dataKey="value"
            radius={[3, 3, 0, 0]}
            onClick={(d: { id?: string }) => d.id && onSelect?.(d.id)}
            className={onSelect ? "cursor-pointer" : ""}
          >
            {rows.map((d) => (
              <Cell
                key={d.id}
                fill={selected === d.id ? "var(--primary)" : "var(--grid)"}
                stroke={selected === d.id ? "var(--primary)" : "var(--border)"}
              />
            ))}
          </Bar>
          <RLine
            yAxisId="right"
            type="monotone"
            dataKey="cumulative"
            stroke="var(--tier-warn)"
            strokeWidth={1.8}
            dot={{ r: 2 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** OEE Waterfall — structure per BR 2.3.3; "Unutilized" renamed "Idle, no order". */
export function Waterfall({
  milestones,
  losses,
}: {
  milestones: { label: string; value: number }[];
  losses: { label: string; value: number; group: string }[];
}) {
  const max = milestones[0]?.value ?? 1;
  const groupColor: Record<string, string> = {
    Loading: "var(--loss-loading)",
    Availability: "var(--loss-availability)",
    Performance: "var(--loss-performance)",
    Quality: "var(--loss-quality)",
  };
  const stageLosses = [
    losses.filter((loss) => loss.group === "Loading"),
    losses.filter((loss) => loss.group === "Availability"),
    losses.filter((loss) => loss.group === "Performance"),
    losses.filter((loss) => loss.group === "Quality"),
  ];
  const stageNames = ["Loading", "Availability", "Performance", "Quality"];
  const effective = milestones[4];

  return (
    <div className="flex h-full min-h-[580px] flex-col">
      {stageNames.map((stage, stageIndex) => {
        const milestone = milestones[stageIndex];
        if (!milestone) return null;
        let remaining = milestone.value;
        const items = stageLosses[stageIndex] ?? [];
        const milestonePct = Math.round((milestone.value / max) * 1000) / 10;

        return (
          <div
            key={stage}
            className="grid flex-1 grid-cols-[34px_minmax(0,1fr)] border-b border-border/70 last:border-b-0"
          >
            <div className="relative flex items-center justify-center border-r border-border">
              <span className="-rotate-90 whitespace-nowrap text-[10px] font-semibold text-muted-foreground">
                {stage}
              </span>
            </div>
            <div className="flex min-w-0 flex-col justify-evenly gap-2 px-4 py-2.5">
              <div className="relative h-8 w-full overflow-hidden rounded-md bg-muted">
                <div
                  className="absolute inset-y-0 left-0 bg-loss-milestone"
                  style={{ width: `${milestonePct}%` }}
                />
                <span className="absolute inset-y-0 left-3 flex items-center text-[11px] font-semibold">
                  {milestone.label} · {milestone.value} min
                  {stageIndex > 0 ? ` (${milestonePct.toFixed(1)}%)` : ""}
                </span>
              </div>
              {items.map((loss) => {
                const before = remaining;
                remaining = Math.max(0, remaining - loss.value);
                const left = (remaining / max) * 100;
                const width = (Math.min(loss.value, before) / max) * 100;
                return (
                  <div key={loss.label} className="relative h-7 w-full bg-muted/50">
                    <div
                      className="absolute inset-y-1 rounded-sm"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        background: groupColor[stage],
                      }}
                    />
                    <span
                      className="absolute inset-y-0 flex items-center whitespace-nowrap text-[10px] font-medium"
                      style={{ right: `${Math.max(0, 100 - left)}%`, marginRight: 8 }}
                    >
                      {loss.label} · {loss.value} min
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {effective && (
        <div className="grid grid-cols-[34px_minmax(0,1fr)]">
          <div className="border-r border-border" />
          <div className="px-4 pb-2.5 pt-3">
            <div className="relative h-8 w-full overflow-hidden rounded-md bg-muted">
              <div
                className="absolute inset-y-0 left-0 bg-loss-effective"
                style={{ width: `${(effective.value / max) * 100}%` }}
              />
              <span
                className="absolute inset-y-0 flex items-center whitespace-nowrap pl-3 text-[11px] font-semibold text-loss-effective-foreground"
                style={{ left: `${(effective.value / max) * 100}%` }}
              >
                {effective.label} · {effective.value} min (
                {((effective.value / max) * 100).toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Generic recursive loss tree (2-3 levels) — §4.2.2. */
export function LossTree({
  nodes,
  measure,
  onOpen,
}: {
  nodes: LossNode[];
  measure: Measure;
  onOpen: (node: LossNode) => void;
}) {
  const val = (n: LossNode) => (measure === "minutes" ? n.minutes : n.occurrences);
  const total = nodes.reduce((a, b) => a + val(b), 0) || 1;
  return (
    <ul className="h-full divide-y divide-border/70">
      {nodes.map((n) => (
        <LossTreeRow
          key={n.id}
          node={n}
          measure={measure}
          total={total}
          depth={0}
          rootLabel={n.label}
          onOpen={onOpen}
        />
      ))}
    </ul>
  );
}

function LossTreeRow({
  node,
  measure,
  total,
  depth,
  rootLabel,
  onOpen,
}: {
  node: LossNode;
  measure: Measure;
  total: number;
  depth: number;
  rootLabel: string;
  onOpen: (node: LossNode) => void;
}) {
  const [open, setOpen] = useState(node.label === "Breakdown" || node.label === "Bearing seizure");
  const val = (n: LossNode) => (measure === "minutes" ? n.minutes : n.occurrences);
  const value = val(node);
  const pct = Math.round((value / total) * 1000) / 10;
  const hasChildren = !!node.children?.length;
  const canExpand =
    hasChildren && (depth > 0 || rootLabel === "Breakdown" || rootLabel === "Minor Stop");
  const children = [...(node.children ?? [])].sort((a, b) => val(b) - val(a));
  const tones: Record<string, string> = {
    Breakdown: "var(--loss-breakdown)",
    "Minor Stop": "var(--loss-minor-stop)",
    "Setup + Idle": "var(--loss-setup)",
    "Speed Loss": "var(--loss-speed)",
    Reject: "var(--loss-reject)",
    Rework: "var(--loss-rework)",
    "Planned Downtime": "var(--loss-planned)",
  };
  const baseTone = tones[rootLabel] ?? "var(--primary)";
  const barTone =
    depth === 0
      ? baseTone
      : `color-mix(in oklab, ${baseTone} ${depth === 1 ? 78 : 50}%, var(--surface))`;
  return (
    <li className={depth === 0 ? "" : "border-t border-border/60"}>
      <div className="grid min-h-12 grid-cols-[minmax(150px,1.05fr)_minmax(150px,1.35fr)_72px_58px] items-center gap-3 px-2 py-2 hover:bg-muted/40">
        <div className="flex min-w-0 items-center" style={{ paddingLeft: depth * 20 }}>
          <button
            type="button"
            aria-label={canExpand ? (open ? "Collapse" : "Expand") : "No children"}
            onClick={() => canExpand && setOpen((o) => !o)}
            className={cn(
              "mr-1 grid size-5 shrink-0 place-items-center text-loss-caret",
              !canExpand && "invisible",
            )}
          >
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          <button
            type="button"
            onClick={() => onOpen(node)}
            title="Open root cause pareto"
            className={cn(
              "truncate text-left text-[11px] hover:underline",
              depth === 0 ? "font-semibold" : "font-medium text-muted-foreground",
            )}
          >
            {node.label}
          </button>
        </div>
        <div className="h-3.5 overflow-hidden rounded-sm bg-transparent">
          <div
            className="h-full rounded-sm"
            style={{ width: `${Math.min(100, pct * 4)}%`, background: barTone }}
          />
        </div>
        <span className="text-right font-mono text-[11px] font-semibold">
          {measure === "minutes" ? `${value} min` : `${value}×`}
        </span>
        <span
          className={cn(
            "rounded-md px-2 py-1 text-center font-mono text-[10px]",
            depth === 0
              ? "bg-loss-badge text-loss-badge-foreground"
              : depth === 1
                ? "bg-muted font-semibold text-muted-foreground"
                : "text-muted-foreground",
          )}
        >
          {Math.round(pct)}%
        </span>
      </div>
      {open && canExpand && (
        <ul>
          {children.map((c) => (
            <LossTreeRow
              key={c.id}
              node={c}
              measure={measure}
              total={total}
              depth={depth + 1}
              rootLabel={rootLabel}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function DivergingList({
  rows,
  unit = "%",
}: {
  rows: { label: string; delta: number }[];
  unit?: string;
}) {
  const max = Math.max(...rows.map((r) => Math.abs(r.delta)), 1);
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => {
        const pct = (Math.abs(r.delta) / max) * 50;
        const good = r.delta >= 0;
        return (
          <li key={r.label} className="flex items-center gap-2">
            <span className="w-20 shrink-0 truncate font-mono text-[11px]">{r.label}</span>
            <div className="relative h-2.5 flex-1 rounded bg-grid/40">
              <span className="absolute left-1/2 top-0 h-full w-px bg-border" />
              <span
                className="absolute top-0 h-full rounded"
                style={{
                  width: `${pct}%`,
                  left: good ? "50%" : `${50 - pct}%`,
                  background: good ? "var(--tier-good)" : "var(--tier-bad)",
                }}
              />
            </div>
            <span
              className={cn(
                "w-14 shrink-0 text-right font-mono text-[11px]",
                good ? "text-tier-good" : "text-tier-bad",
              )}
            >
              {r.delta > 0 ? "+" : ""}
              {r.delta.toFixed(1)}
              {unit}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
