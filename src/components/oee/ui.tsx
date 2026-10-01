import { Link } from "@tanstack/react-router";
import { ArrowDown, ArrowUp, Menu } from "lucide-react";
import { type ReactNode } from "react";

import {
  STATUS_DOT,
  STATUS_LABEL,
  TIER_HEX,
  TIER_TEXT,
  tierOf,
  type Status,
} from "@/lib/oee/config";
import { PERIODS, type PeriodId } from "@/lib/oee/filters";
import { comparisonContext, useLiveClock } from "@/lib/oee/live-display";
import { useApp } from "@/lib/oee/app-context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function Panel({
  title,
  subtitle,
  action,
  className,
  bodyClassName,
  children,
}: {
  title?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col rounded-lg border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)]",
        className,
      )}
    >
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0">
            {title && <h2 className="truncate text-sm font-semibold tracking-tight">{title}</h2>}
            {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cn("flex min-h-0 min-w-0 w-full flex-1 flex-col p-4", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

export function Donut({
  value,
  size = 96,
  label = "OEE",
  caption,
}: {
  value: number;
  size?: number;
  label?: string;
  caption?: string;
}) {
  const stroke = Math.max(7, size * 0.1);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tier = tierOf(value);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--grid)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={TIER_HEX[tier]}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.min(value, 100)) / 100} ${c}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span
          className={cn("font-mono font-semibold", TIER_TEXT[tier])}
          style={{ fontSize: size * 0.24 }}
        >
          {value.toFixed(0)}%
        </span>
        <span className="mt-0.5 text-[9px] uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {caption && <span className="text-[9px] text-muted-foreground">{caption}</span>}
      </div>
    </div>
  );
}

export function ComparisonLabel({ period, className }: { period: PeriodId; className?: string }) {
  return (
    <span
      className={cn(
        "block font-sans text-[10px] text-muted-foreground leading-tight tracking-normal",
        className,
      )}
    >
      {comparisonContext(period)}
    </span>
  );
}

export function Delta({
  value,
  suffix = "%",
  period,
  className,
}: {
  value: number;
  suffix?: string;
  period?: PeriodId;
  className?: string;
}) {
  const up = value >= 0;
  return (
    <div className={cn("inline-flex flex-col items-start gap-0.5", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-0.5 font-mono text-[11px] font-medium",
          up ? "text-tier-good" : "text-tier-bad",
        )}
      >
        {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
        {up ? "+" : "-"}
        {Math.abs(value).toFixed(1)}
        {suffix}
      </span>
      {period && <ComparisonLabel period={period} />}
    </div>
  );
}

export function KpiComparison({
  current,
  previous,
  label,
  className,
}: {
  current: number;
  previous: number;
  label?: string;
  className?: string;
}) {
  const isUp = current >= previous;
  const isDiff = current !== previous;
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-sans text-muted-foreground/90 truncate",
        className,
      )}
    >
      {isDiff && isUp && (
        <ArrowUp className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[2.5]" />
      )}
      {isDiff && !isUp && (
        <ArrowDown className="size-3 text-red-600 dark:text-red-400 shrink-0 stroke-[2.5]" />
      )}
      {label && <span>{label}</span>}
      <span>{previous.toFixed(1)}%</span>
    </div>
  );
}

export function KpiCard({
  label,
  value,
  unit,
  caption,
  tone,
  children,
  comparisonLabel,
  period,
  delta,
  trend,
  isUpdating = false,
  onClick,
  className,
}: {
  label: string;
  value: string | number;
  unit?: string;
  caption?: ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
  children?: ReactNode;
  comparisonLabel?: string;
  period?: PeriodId;
  delta?: number;
  trend?: "up" | "down" | "neutral";
  isUpdating?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const toneClass =
    tone === "good"
      ? "text-tier-good"
      : tone === "warn"
        ? "text-tier-warn"
        : tone === "bad"
          ? "text-tier-bad"
          : "text-foreground";

  const content = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {label}
        </span>
        {isUpdating && (
          <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-medium text-primary animate-pulse">
            <span className="size-1 rounded-full bg-primary animate-ping" />
            live sync
          </span>
        )}
      </div>
      <div className="relative flex items-baseline gap-1">
        <span
          className={cn(
            "rounded px-1 -mx-1 font-mono text-2xl font-semibold leading-none transition-all duration-300",
            toneClass,
            isUpdating &&
              "bg-primary/20 text-primary shadow-[0_0_12px_rgba(59,130,246,0.35)] ring-1 ring-primary/40 animate-pulse scale-105 inline-block",
          )}
        >
          {value}
        </span>
        {unit && <span className="text-xs text-muted-foreground">{unit}</span>}
      </div>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {delta !== undefined && <Delta value={delta} />}
        {caption && <div className="text-[11px] text-muted-foreground">{caption}</div>}
        {comparisonLabel ? (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground leading-tight">
            {trend === "up" && (
              <ArrowUp className="size-3 text-emerald-600 dark:text-emerald-400 shrink-0 stroke-[2.5]" />
            )}
            {trend === "down" && (
              <ArrowDown className="size-3 text-red-600 dark:text-red-400 shrink-0 stroke-[2.5]" />
            )}
            <span>{comparisonLabel}</span>
          </div>
        ) : period && delta !== undefined ? (
          <ComparisonLabel period={period} />
        ) : null}
      </div>
      {children}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "group relative flex min-w-0 flex-col justify-between gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left shadow-none transition-colors duration-150 cursor-pointer hover:bg-gray-50 dark:hover:bg-muted/60 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col justify-between gap-1.5 rounded-lg border border-border bg-surface px-3 py-2.5",
        className,
      )}
    >
      {content}
    </div>
  );
}

export function MetricBar({ label, value }: { label: string; value: number }) {
  const tier = tierOf(value);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn("font-mono", TIER_TEXT[tier])}>{value.toFixed(1)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-grid">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(value, 100)}%`, background: TIER_HEX[tier] }}
        />
      </div>
    </div>
  );
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[10px] uppercase tracking-wide text-muted-foreground">
      {(["running", "slow", "down", "idle"] as Status[]).map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-sm", STATUS_DOT[s])} />
          {STATUS_LABEL[s]}
        </span>
      ))}
    </div>
  );
}

export type Crumb = { label: string; to?: string; params?: Record<string, string> };

export function PeriodDropdown({
  value,
  onChange,
}: {
  value: PeriodId;
  onChange: (p: PeriodId) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs">
      <span className="text-muted-foreground">Period</span>
      <select
        aria-label="Period"
        value={value}
        onChange={(e) => onChange(e.target.value as PeriodId)}
        className="bg-transparent font-medium outline-none"
      >
        {PERIODS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PageHeader({
  title,
  crumbs,
  period,
  onPeriod,
  meta,
  back,
  children,
}: {
  title: string;
  crumbs: Crumb[];
  period?: PeriodId;
  onPeriod?: (p: PeriodId) => void;
  meta?: string;
  back?: { label: string; to: string; params?: Record<string, string> };
  children?: ReactNode;
}) {
  const { toggleMobileSidebar } = useApp();
  const liveTime = useLiveClock(period ?? "today");
  const displayMeta = period === "live" ? (liveTime ?? meta ?? "Live Monitor") : meta;

  return (
    <header className="sticky top-0 z-20 w-full min-w-0 border-b border-border bg-background/90 px-3 sm:px-4 py-2.5 sm:py-3 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-2.5 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={toggleMobileSidebar}
            className="inline-flex lg:hidden items-center justify-center rounded-md border border-border bg-surface p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-95 shrink-0"
            aria-label="Toggle navigation menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {back && (
                <Link
                  to={back.to}
                  params={back.params as never}
                  className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground shrink-0"
                >
                  ‹ Back to {back.label}
                </Link>
              )}
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">
                {title}
              </h1>
            </div>
            <nav className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] sm:text-[11px] text-muted-foreground">
              {crumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 && <span className="opacity-50">›</span>}
                  {c.to ? (
                    <Link
                      to={c.to}
                      params={c.params as never}
                      className="hover:text-foreground hover:underline"
                    >
                      {c.label}
                    </Link>
                  ) : (
                    <span>{c.label}</span>
                  )}
                </span>
              ))}
            </nav>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {displayMeta && (
            <span
              suppressHydrationWarning
              className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-surface px-2.5 py-1 font-mono text-[10px] sm:text-[11px] text-muted-foreground shadow-xs shrink-0"
            >
              {period === "live" && (
                <span className="relative flex h-2 w-2" title="Live clock active">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
                </span>
              )}
              <span suppressHydrationWarning>{displayMeta}</span>
            </span>
          )}
          {children}
          {period && onPeriod && <PeriodDropdown value={period} onChange={onPeriod} />}
        </div>
      </div>
    </header>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="grid min-h-32 place-items-center rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
      {message}
    </div>
  );
}

export function NoDataForFilters() {
  return <EmptyState message="Tidak ada data untuk kombinasi filter ini" />;
}

export { KpiStrip, type KpiItem, type KpiStripProps } from "./kpi-strip";
