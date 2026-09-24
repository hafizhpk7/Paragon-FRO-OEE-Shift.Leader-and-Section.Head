import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useMemo, useState } from "react";

import { IsoBlock, IsoChip, IsoGround, IsoScene, ZoomableMap, iso } from "@/components/oee/iso";
import {
  Delta,
  EmptyState,
  KpiCard,
  PageHeader,
  Panel,
  StatusLegend,
  StatusPill,
} from "@/components/oee/ui";
import { STATUS_HEX, TIER_HEX, tierOf } from "@/lib/oee/config";
import { getZone, type Line } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { useApp } from "@/lib/oee/app-context";
import { comparisonContext, useLiveZoneState } from "@/lib/oee/live-display";
import { rand } from "@/lib/oee/rng";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$plantId/$zoneId/")({
  head: () => ({
    meta: [
      { title: "Zone View — Production Floor Map" },
      {
        name: "description",
        content:
          "Shift Leader home: zone KPI strip and an isometric production floor map with per-line and per-machine status.",
      },
      { property: "og:title", content: "Zone View — Production Floor Map" },
      {
        property: "og:description",
        content: "Zone KPI strip plus isometric production floor map with live line status.",
      },
    ],
  }),
  component: ZoneView,
});

const S = 40;
const GAP_X = 1.7;
const GAP_Y = 1.8;

function ZoneView() {
  const { plantId, zoneId } = useParams({ from: "/live/$plantId/$zoneId/" });
  const zone = getZone(plantId, zoneId);

  if (!zone) {
    return (
      <div className="p-6">
        <EmptyState message="Zone tidak ditemukan" />
      </div>
    );
  }

  return <ZoneContent plantId={plantId} zone={zone} />;
}

function ZoneContent({
  plantId,
  zone,
}: {
  plantId: string;
  zone: NonNullable<ReturnType<typeof getZone>>;
}) {
  const [period, setPeriod] = useState<PeriodId>("live");
  const [selected, setSelected] = useState<Line | null>(null);
  const [showIssues, setShowIssues] = useState(false);
  const navigate = useNavigate();
  const { role } = useApp();

  const liveState = useLiveZoneState(
    period,
    zone.id,
    { availability: zone.availability, performance: zone.performance, quality: zone.quality },
    zone.lines,
  );
  const statusForLine = (line: Line) => liveState.lineStatuses[line.id] ?? line.status;
  const down = zone.lines.filter((l) => statusForLine(l) === "down").length;
  const slow = zone.lines.filter((l) => statusForLine(l) === "slow").length;
  const idle = zone.lines.filter((l) => statusForLine(l) === "idle").length;
  const machineCount = zone.lines.reduce((a, l) => a + l.machines.length, 0);
  const rows = 3;
  const cols = 5;
  const compareLabel = comparisonContext(period);
  const issues = useMemo(() => {
    const priority = { down: 0, slow: 1, idle: 2 } as const;
    const reasons = {
      down: ["Mechanical Breakdown", "Conveyor Jam", "Setup/Changeover"],
      slow: ["Reduced Speed", "Material Shortage", "Minor Stops"],
      idle: ["No Production Order", "Waiting Material", "Planned Cleaning"],
    } as const;
    return zone.lines
      .map((line) => ({ line, status: liveState.lineStatuses[line.id] ?? line.status }))
      .filter((item) => item.status !== "running")
      .map((item) => ({
        ...item,
        reason:
          item.line.fault ??
          reasons[item.status][
            Math.floor(
              rand(`${zone.id}-${item.line.id}-reason`, 0, reasons[item.status].length, 4),
            ) % reasons[item.status].length
          ],
        duration: rand(
          `${zone.id}-${item.line.id}-duration`,
          8,
          item.status === "down" ? 78 : 48,
          0,
        ),
      }))
      .sort((a, b) => priority[a.status] - priority[b.status] || b.duration - a.duration);
  }, [liveState.lineStatuses, zone.id, zone.lines]);

  // Shift Leader enters here directly, so no Plant in the breadcrumb; Section Head
  // arrives by drill-down, so Plant is included (§4.1.3).
  const crumbs =
    role === "section-head"
      ? [
          { label: "Kemas", to: "/live" },
          { label: plantId, to: "/live/$plantId", params: { plantId } },
          { label: `${zone.name} · Shift 1` },
        ]
      : [{ label: "Kemas", to: "/" }, { label: `${zone.name} · Shift 1` }];

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={zone.name}
        crumbs={crumbs}
        period={period}
        onPeriod={setPeriod}
        meta="Week 32 · 05-Aug 14:22"
        {...(role === "section-head"
          ? { back: { label: "Plant View", to: "/live/$plantId", params: { plantId } } }
          : {})}
      />
      <main className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            label="Zone OEE"
            value={liveState.metrics.oee.toFixed(1)}
            unit="%"
            tone={
              tierOf(liveState.metrics.oee) === "good"
                ? "good"
                : tierOf(liveState.metrics.oee) === "warn"
                  ? "warn"
                  : "bad"
            }
            caption={
              liveState.metrics.oee >= 75
                ? "On target"
                : `${(75 - liveState.metrics.oee).toFixed(1)}% below target`
            }
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Availability"
            value={liveState.metrics.availability.toFixed(1)}
            unit="%"
            caption={
              <Delta
                value={liveState.metrics.availability - liveState.previousMetrics.availability}
              />
            }
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Performance"
            value={liveState.metrics.performance.toFixed(1)}
            unit="%"
            caption={
              <Delta
                value={liveState.metrics.performance - liveState.previousMetrics.performance}
              />
            }
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          <KpiCard
            label="Quality"
            value={liveState.metrics.quality.toFixed(1)}
            unit="%"
            caption={
              <Delta value={liveState.metrics.quality - liveState.previousMetrics.quality} />
            }
            comparisonLabel={compareLabel}
            isUpdating={liveState.isUpdating}
          />
          {/* §7 point 5: one name only — "LINES DOWN". */}
          <KpiCard
            label="Lines Down"
            value={`${down} of ${zone.lines.length}`}
            tone={down > 0 ? "bad" : "good"}
            caption={`${slow} slow · ${idle} idle`}
            onClick={() => setShowIssues(true)}
          >
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">
              View Details <ArrowRight className="size-3" />
            </span>
          </KpiCard>
        </div>

        <Panel
          className="flex-1"
          title="Production Floor Map"
          subtitle={`${zone.lines.length} lines · ${machineCount} machines · bays ${rows} × ${cols} (${rows * cols - zone.lines.length} spare)`}
          action={<StatusLegend />}
          bodyClassName="relative p-0"
        >
          <ZoomableMap className="min-h-[440px] flex-1">
            <IsoScene viewBox="-185 -95 470 360">
              <IsoGround cols={cols * GAP_X + 0.5} rows={rows * GAP_Y + 0.5} s={S} />
              {zone.lines.map((l, i) => {
                const bx = 0.4 + (i % cols) * GAP_X;
                const by = 0.4 + Math.floor(i / cols) * GAP_Y;
                const isSel = selected?.id === l.id;
                const lineStatus = statusForLine(l);
                return (
                  <g key={l.id}>
                    <IsoBlock
                      x={bx}
                      y={by}
                      w={0.9}
                      d={0.9}
                      h={isSel ? 30 : 20}
                      s={S}
                      color={STATUS_HEX[lineStatus]}
                      onClick={() => setSelected(isSel ? null : l)}
                      dim={!!selected && !isSel}
                    />
                    {/* machine status dots inside the line footprint */}
                    {l.machines.map((m, mi) => {
                      const p = iso(bx + 0.18 + mi * 0.2, by + 0.45, isSel ? 32 : 22, S);
                      return (
                        <circle
                          key={m.id}
                          cx={p.x}
                          cy={p.y}
                          r={2.6}
                          fill={
                            STATUS_HEX[liveState.machineStatuses[`${l.id}:${m.id}`] ?? m.status]
                          }
                          stroke="var(--surface)"
                          strokeWidth={0.8}
                        />
                      );
                    })}
                    <IsoChip
                      x={bx + 0.45}
                      y={by + 0.45}
                      s={S}
                      h={isSel ? 32 : 22}
                      label={l.id}
                      value={`${l.oee.toFixed(0)}%`}
                      color={TIER_HEX[tierOf(l.oee)]}
                    />
                  </g>
                );
              })}
            </IsoScene>
          </ZoomableMap>

          {selected && (
            <div className="absolute right-4 top-14 w-64 rounded-lg border border-border bg-surface p-3 shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold">{selected.id}</span>
                <StatusPill status={statusForLine(selected)} />
              </div>
              <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">OEE</dt>
                  <dd className="font-mono">{selected.oee.toFixed(1)}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Output</dt>
                  <dd className="font-mono">
                    {selected.outputActual.toLocaleString()} /{" "}
                    {selected.outputTarget.toLocaleString()}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Machines</dt>
                  <dd className="font-mono">{selected.machines.length}</dd>
                </div>
                {selected.fault && (
                  <div className="rounded bg-tier-bad/10 px-2 py-1 text-tier-bad">
                    {selected.fault}
                  </div>
                )}
              </dl>
              <div className="mt-2 flex flex-wrap gap-1">
                {selected.machines.map((m) => (
                  <span
                    key={m.id}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]"
                  >
                    {m.id}
                  </span>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/live/$plantId/$zoneId/$lineId",
                    params: { plantId, zoneId, lineId: selected.id },
                  })
                }
                className="mt-2 w-full rounded-md bg-primary px-2 py-1.5 text-[11px] font-medium text-primary-foreground"
              >
                Click to open line detail →
              </button>
            </div>
          )}
        </Panel>
      </main>
      <Dialog open={showIssues} onOpenChange={setShowIssues}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Lines requiring attention</DialogTitle>
            <DialogDescription>
              Current Down, Slow, and Idle lines in {zone.name}, sorted by operational priority.
            </DialogDescription>
          </DialogHeader>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Line Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Downtime Reason</TableHead>
                <TableHead className="text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.line.id}>
                  <TableCell className="font-mono font-semibold">{issue.line.id}</TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        "inline-flex rounded px-2 py-0.5 text-[10px] font-semibold uppercase",
                        issue.status === "down" && "bg-tier-bad/15 text-tier-bad",
                        issue.status === "slow" && "bg-tier-warn/20 text-tier-warn",
                        issue.status === "idle" && "bg-grid text-muted-foreground",
                      )}
                    >
                      {issue.status}
                    </span>
                  </TableCell>
                  <TableCell>{issue.reason}</TableCell>
                  <TableCell className="text-right font-mono">{issue.duration} mins</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </DialogContent>
      </Dialog>
    </div>
  );
}
