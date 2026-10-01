import { Link, createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowDownUp } from "lucide-react";

import { BarByLine, DivergingList, Sparkline, TrendChart } from "@/components/oee/charts";
import { FilterBar } from "@/components/oee/filter-bar";
import {
  Delta,
  Donut,
  KpiCard,
  KpiComparison,
  KpiDelta,
  NoDataForFilters,
  PageHeader,
  Panel,
} from "@/components/oee/ui";
import { useApp } from "@/lib/oee/app-context";
import {
  biggestLoss,
  bucketsFor,
  comparison,
  formatDeltaPercent,
  getCompareLabel,
  getPriorPeriodKpis,
  trendSeries,
} from "@/lib/oee/data";
import { RESOLUTIONS, SPANS } from "@/lib/oee/filters";
import { useScope } from "@/lib/oee/scope";

export const Route = createFileRoute("/analytics/")({
  head: () => ({
    meta: [
      { title: "OEE Analytics Dashboard — Shift Leader & Section Head" },
      {
        name: "description",
        content:
          "OEE analytics with filter bar, summary cards, OEE trend, period comparison and OEE by line ranking.",
      },
      { property: "og:title", content: "OEE Analytics Dashboard" },
      {
        property: "og:description",
        content:
          "Summary cards, OEE trend, period comparison and OEE by line ranking on mock data.",
      },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { role, filters } = useApp();
  const scope = useScope();
  const [sortAsc, setSortAsc] = useState(true);
  const [selectedLines, setSelectedLines] = useState<string[]>([]);

  const title =
    role === "section-head" ? "Section Head Dashboard — OEE" : "Shift Leader Dashboard — OEE";
  const resMinutes = RESOLUTIONS.find((r) => r.id === filters.resolution)?.minutes ?? 1440;
  const days = SPANS.find((s) => s.id === filters.span)?.days ?? 1;

  const avg = (key: "oee" | "availability" | "performance" | "quality") =>
    scope.lines.length
      ? Math.round((scope.lines.reduce((a, l) => a + l[key], 0) / scope.lines.length) * 10) / 10
      : 0;

  const currOee = avg("oee");
  const currAvail = avg("availability");
  const currPerf = avg("performance");
  const currQual = avg("quality");

  const prior = useMemo(
    () => getPriorPeriodKpis(scope.seed, scope.lines),
    [scope.seed, scope.lines],
  );
  const compareLabel = getCompareLabel(filters.span);

  const deltaOee = formatDeltaPercent(currOee, prior.avgOee);
  const deltaAvail = formatDeltaPercent(currAvail, prior.avgAvailability);
  const deltaPerf = formatDeltaPercent(currPerf, prior.avgPerformance);
  const deltaQual = formatDeltaPercent(currQual, prior.avgQuality);

  const trend = useMemo(() => {
    const buckets = bucketsFor(resMinutes, days);
    const keys = scope.zoneIds.length ? scope.zoneIds.map((z) => `Zone ${z}`) : ["All zones"];
    return trendSeries(scope.seed, buckets, keys, currOee, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.seed, resMinutes, days]);

  const spark = (offset: number) =>
    bucketsFor(1440, 7).map((label, i) => ({
      label,
      v: Math.round((currOee + offset + Math.sin(i + offset) * 3) * 10) / 10,
    }));

  const byLine = useMemo(() => {
    const rows = scope.lines
      .filter((l) => selectedLines.length === 0 || selectedLines.includes(l.id))
      .map((l) => ({ label: l.id, value: l.oee }));
    return rows.sort((a, b) => (sortAsc ? a.value - b.value : b.value - a.value));
  }, [scope.lines, selectedLines, sortAsc]);

  const cmp = useMemo(() => comparison(scope.seed, scope.lines), [scope.seed, scope.lines]);
  const loss = useMemo(() => biggestLoss(scope.seed), [scope.seed]);
  const priorLossMin = prior.getCategoryMinutes(loss.label);

  const goodOutput = scope.lines.reduce((a, l) => a + l.outputActual, 0);
  const planOutput = scope.lines.reduce((a, l) => a + l.outputTarget, 0) || 1;
  const attained = Math.round((goodOutput / planOutput) * 1000) / 10;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={title}
        crumbs={[{ label: "Kemas", to: "/live" }, { label: title }]}
        meta={`Week 32 · ${scope.spanLabel}`}
      />
      <FilterBar />

      {!scope.hasData ? (
        <main className="flex-1 p-4">
          <NoDataForFilters />
        </main>
      ) : (
        <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
            <div className="flex flex-col items-center justify-between rounded-lg border border-border bg-surface p-3 min-h-[148px]">
              <Donut value={currOee} size={84} label="Average OEE" />
              <div className="mt-1 flex flex-col items-center text-center leading-tight">
                <KpiComparison text={`${compareLabel} ${prior.avgOee.toFixed(1)}%`} />
                <KpiDelta
                  text={deltaOee.text}
                  tone={deltaOee.tone}
                  ariaLabel={deltaOee.ariaLabel}
                />
              </div>
            </div>

            <KpiCard
              label="Availability"
              value={currAvail.toFixed(1)}
              unit="%"
              comparisonText={`${compareLabel} ${prior.avgAvailability.toFixed(1)}%`}
              deltaText={deltaAvail.text}
              deltaTone={deltaAvail.tone}
              deltaAriaLabel={deltaAvail.ariaLabel}
            >
              <Sparkline data={spark(2)} />
            </KpiCard>

            <KpiCard
              label="Performance"
              value={currPerf.toFixed(1)}
              unit="%"
              comparisonText={`${compareLabel} ${prior.avgPerformance.toFixed(1)}%`}
              deltaText={deltaPerf.text}
              deltaTone={deltaPerf.tone}
              deltaAriaLabel={deltaPerf.ariaLabel}
            >
              <Sparkline data={spark(-4)} />
            </KpiCard>

            <KpiCard
              label="Quality"
              value={currQual.toFixed(1)}
              unit="%"
              comparisonText={`${compareLabel} ${prior.avgQuality.toFixed(1)}%`}
              deltaText={deltaQual.text}
              deltaTone={deltaQual.tone}
              deltaAriaLabel={deltaQual.ariaLabel}
            >
              <Sparkline data={spark(8)} />
            </KpiCard>

            <KpiCard
              label="Good output vs plan"
              value={goodOutput.toLocaleString()}
              comparisonText={`${compareLabel} ${prior.goodOutput.toLocaleString()}`}
              caption={`${attained}% attained · ${Math.max(0, planOutput - goodOutput).toLocaleString()} short`}
            >
              <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-grid">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(attained, 100)}%` }}
                />
              </div>
            </KpiCard>

            <KpiCard
              label="Biggest loss this week"
              value={loss.label}
              comparisonText={`${compareLabel} ${priorLossMin.toLocaleString()} min`}
              caption={`${loss.minutes.toLocaleString()} min lost`}
            >
              <Link
                to="/analytics/loss-tree"
                className="text-[11px] font-medium text-primary hover:underline"
              >
                Open loss anatomy →
              </Link>
            </KpiCard>
          </div>

          <div className="grid w-full flex-1 items-stretch gap-3 grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
            <Panel
              title="OEE Trend"
              subtitle="Dashed line = reference target 75%"
              bodyClassName="relative min-h-[250px] h-full w-full flex-1"
            >
              <TrendChart
                data={trend}
                keys={Object.keys(trend[0] ?? {}).filter((k) => k !== "label")}
                reference={75}
              />
            </Panel>

            <Panel
              className="h-full"
              title="OEE Comparison"
              subtitle="Read-only comparison of two periods"
              action={
                <div className="flex items-center gap-1 text-[10px]">
                  <select
                    aria-label="Compare period"
                    className="rounded border border-border bg-surface px-1 py-0.5"
                  >
                    {SPANS.map((s) => (
                      <option key={s.id}>{`Compare: ${s.label}`}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Against period"
                    className="rounded border border-border bg-surface px-1 py-0.5"
                  >
                    {SPANS.map((s) => (
                      <option key={s.id}>{`Against: ${s.label}`}</option>
                    ))}
                  </select>
                </div>
              }
            >
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold text-muted-foreground">
                  {cmp.before.toFixed(1)}%
                </span>
                <span className="text-muted-foreground">→</span>
                <span className="font-mono text-2xl font-semibold">{cmp.after.toFixed(1)}%</span>
                <Delta value={cmp.delta} />
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                By OEE Component
              </p>
              <div className="mt-1.5">
                <DivergingList rows={cmp.components} />
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                By Line
              </p>
              <div className="mt-1.5 max-h-40 overflow-auto pr-1">
                <DivergingList rows={cmp.byLine} />
              </div>
            </Panel>
          </div>

          <Panel
            className="min-h-[340px] flex-1"
            title="OEE by Line"
            subtitle={sortAsc ? "Lowest → highest" : "Highest → lowest"}
            action={
              <div className="flex items-center gap-2">
                <select
                  aria-label="Select Line"
                  multiple={false}
                  value={selectedLines[0] ?? "all"}
                  onChange={(e) =>
                    setSelectedLines(e.target.value === "all" ? [] : [e.target.value])
                  }
                  className="rounded border border-border bg-surface px-1.5 py-0.5 text-[11px]"
                >
                  <option value="all">Select Line: all</option>
                  {scope.lines.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setSortAsc((s) => !s)}
                  className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]"
                >
                  <ArrowDownUp className="size-3" /> Sort
                </button>
              </div>
            }
            bodyClassName="relative min-h-[250px] h-full w-full flex-1"
          >
            {byLine.length === 0 ? <NoDataForFilters /> : <BarByLine data={byLine} />}
          </Panel>
        </main>
      )}
    </div>
  );
}
