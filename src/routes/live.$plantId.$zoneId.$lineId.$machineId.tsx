import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { memo, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Calendar,
  Clock,
  Gauge,
  HelpCircle,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Wrench,
} from "lucide-react";

import { MachineView3D } from "@/components/oee/three/machine-view-3d";
import { Delta, EmptyState, KpiCard, PageHeader, Panel } from "@/components/oee/ui";
import { ActiveStopBanner } from "@/components/oee/loss/ActiveStopBanner";
import { LossStack } from "@/components/oee/loss/LossStack";
import { OperationalParametersTable } from "@/components/oee/loss/OperationalParametersTable";
import { getLine, getMachine } from "@/lib/oee/data";
import { PERIODS, type PeriodId } from "@/lib/oee/filters";
import {
  getShiftTimeline,
  type ShiftSnapshot,
  type ShiftTimelineResult,
} from "@/lib/oee/machineEvents";
import {
  formatDuration,
  formatTimeWib,
  getPreviousShiftInfo,
  getShiftInfo,
  type ShiftInfo,
} from "@/lib/oee/shiftClock";
import { cn } from "@/lib/utils";

// Memoized 3D Machine Viewer to prevent Three.js scene remounting during 2s data ticks (§8)
const MemoizedMachineView3D = memo(MachineView3D);

export const Route = createFileRoute("/live/$plantId/$zoneId/$lineId/$machineId")({
  head: () => ({
    meta: [
      { title: "Machine Detail — Loss Clarification & Machine Events" },
      {
        name: "description",
        content:
          "Machine level digital twin with multi-tier Loss Clarification, 30s Machine Events timeline, operational parameters, and single-source-of-truth OEE.",
      },
      { property: "og:title", content: "Machine Detail — Loss Clarification" },
      {
        property: "og:description",
        content: "Complete L0-L3 loss taxonomy, shift timeline, and active stop resolution.",
      },
    ],
  }),
  component: MachineDetail,
});

function MachineDetail() {
  const { plantId, zoneId, lineId, machineId } = useParams({
    from: "/live/$plantId/$zoneId/$lineId/$machineId",
  });
  const navigate = useNavigate();

  const [period, setPeriod] = useState<PeriodId>("live");
  const [tick, setTick] = useState<number>(0);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [forcedFocus, setForcedFocus] = useState<"loss" | "events" | null>(null);

  const line = getLine(plantId, zoneId, lineId);
  const machine = getMachine(plantId, zoneId, lineId, machineId);

  // 2s live data tick while period === "live"
  useEffect(() => {
    if (period !== "live") return;
    const interval = setInterval(() => {
      setTick((t) => t + 1);
    }, 2000);
    return () => clearInterval(interval);
  }, [period]);

  // Determine active shift configuration based on period
  const shiftInfo = useMemo(() => {
    // Reference tick to update shift elapsed time live
    void tick;
    if (period === "last-shift") {
      return getPreviousShiftInfo(new Date());
    }
    return getShiftInfo(new Date());
  }, [period, tick]);

  // Is multi-shift period (today, yesterday, this-week, last-week)
  const isMultiShift =
    period === "today" ||
    period === "yesterday" ||
    period === "this-week" ||
    period === "last-week";

  // Unified Shift Timeline (Single Source of Truth)
  const timeline: ShiftTimelineResult = useMemo(() => {
    // Reference tick for live 2s refresh
    void tick;
    return getShiftTimeline(
      machineId,
      shiftInfo,
      period === "live" ? shiftInfo.elapsedSec : undefined,
    );
  }, [machineId, shiftInfo, period, tick]);

  const { snapshot, orders, events, windows, idealRatePpm } = timeline;

  // Active current order
  const currentOrder = useMemo(() => {
    const elapsed = shiftInfo.elapsedSec;
    return (
      orders.find((o) => elapsed >= o.startSec && elapsed <= o.endSec) ||
      orders[0] || {
        id: "PO-2811",
        sku: "4000081204",
        productName: "Production Order",
      }
    );
  }, [orders, shiftInfo.elapsedSec]);

  // Reset selected event when machine code changes
  useEffect(() => {
    setSelectedEventId(null);
  }, [machineId]);

  if (!line || !machine) {
    return (
      <div className="p-6">
        <EmptyState message="Machine not found in Jatake 2 plant directory" />
      </div>
    );
  }

  // Handle "Clarify now" click from Active Stop Banner
  const handleClarifyNow = () => {
    if (snapshot.activeStop) {
      setSelectedEventId(snapshot.activeStop.event.id);
    }
    setForcedFocus("loss");
  };

  // Tone color for Status card and Twin badge
  const statusTone = snapshot.status.tone;
  const statusLabel = snapshot.status.label;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      {/* ========================================================= */}
      {/* 3.1 HEADER: Back button, title, breadcrumbs, live clock with shift chip, Period selector */}
      {/* ========================================================= */}
      <PageHeader
        title={`${machine.id} — Machine Detail`}
        crumbs={[
          { label: `Zone ${zoneId}`, to: "/live/$plantId/$zoneId", params: { plantId, zoneId } },
          {
            label: lineId,
            to: "/live/$plantId/$zoneId/$lineId",
            params: { plantId, zoneId, lineId },
          },
          { label: machine.id },
        ]}
        period={period}
        onPeriod={setPeriod}
        meta={
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface border border-border px-2.5 py-0.5 text-xs font-mono font-semibold text-foreground shadow-2xs">
              <span className="size-1.5 rounded-full bg-primary" />
              <span>{shiftInfo.label}</span>
            </span>
          </div>
        }
        back={{
          label: lineId,
          to: "/live/$plantId/$zoneId/$lineId",
          params: { plantId, zoneId, lineId },
        }}
      />

      <main className="flex flex-1 flex-col gap-3 p-3 sm:p-4 min-w-0 max-w-full overflow-x-hidden">
        {/* ========================================================= */}
        {/* DESKTOP TWO-COLUMN GRID (§3) */}
        {/* Left Column (28-30%, min 340px): 3D Machine Twin + MTTR/MTBF/Stops */}
        {/* Right Column (Rest): 6 KPI Strip + Active Stop Banner + Loss Stack */}
        {/* ========================================================= */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-3 items-start w-full">
          {/* ------------------------------------------------------- */}
          {/* LEFT COLUMN: MACHINE TWIN (3D) */}
          {/* ------------------------------------------------------- */}
          <div className="xl:col-span-4 flex flex-col h-full rounded-lg border border-border bg-surface shadow-xs overflow-hidden">
            {/* Panel Title & Current PO Header */}
            <div className="border-b border-border/80 px-4 py-3 bg-surface/90">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-foreground">{machine.name}</h3>
                <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                  {machine.id}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground font-mono truncate mt-1">
                {currentOrder.id} · {currentOrder.sku} · {currentOrder.productName}
              </p>
            </div>

            {/* 3D Machine Viewer Wrapper (fills height, min 280px) */}
            <div className="relative w-full flex-1 min-h-[320px] sm:min-h-[360px] xl:min-h-[440px] bg-surface/30">
              <MemoizedMachineView3D
                machineCode={machine.id}
                machineName={machine.name}
                status={machine.status}
                className="h-full w-full"
              />

              {/* Status Badge overlay bottom-left (§3.3) */}
              <div className="absolute bottom-3 left-3 z-20 pointer-events-none">
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-md backdrop-blur-md border",
                    statusTone === "bad" &&
                      "bg-destructive text-destructive-foreground border-destructive",
                    statusTone === "warn" &&
                      "bg-amber-500 text-black dark:bg-amber-400 font-extrabold border-amber-500",
                    statusTone === "good" && "bg-tier-good text-white border-tier-good",
                    statusTone === "info" && "bg-muted text-muted-foreground border-border",
                  )}
                >
                  <span
                    className={cn(
                      "size-2 rounded-full",
                      statusTone === "good"
                        ? "bg-white"
                        : statusTone === "bad"
                          ? "bg-destructive-foreground animate-pulse"
                          : "bg-black",
                    )}
                  />
                  <span>{statusLabel}</span>
                </span>
              </div>
            </div>

            {/* Under the viewer: MTTR, MTBF, Stops this shift tiles (§3.3, §5) */}
            <div className="grid grid-cols-3 gap-2 border-t border-border p-3 text-[11px] bg-muted/20">
              <div
                className="rounded border border-border bg-surface px-2.5 py-1.5"
                title="Mean Time To Repair = Total stop duration / Number of stops"
              >
                <p className="text-muted-foreground text-[10px] uppercase font-semibold">MTTR</p>
                <p className="font-mono font-bold text-xs text-foreground mt-0.5">
                  {snapshot.mttrMin !== null ? `${snapshot.mttrMin} min` : "—"}
                </p>
              </div>

              <div
                className="rounded border border-border bg-surface px-2.5 py-1.5"
                title="Mean Time Between Failures = (Scheduled production time - Total stop duration) / Number of stops"
              >
                <p className="text-muted-foreground text-[10px] uppercase font-semibold">MTBF</p>
                <p className="font-mono font-bold text-xs text-foreground mt-0.5">
                  {snapshot.mtbfMin !== null ? `${snapshot.mtbfMin} min` : "—"}
                </p>
              </div>

              <div
                className="rounded border border-border bg-surface px-2.5 py-1.5"
                title="Count of Downtime and Minor Stop events occurred during this shift"
              >
                <p className="text-muted-foreground text-[10px] uppercase font-semibold">
                  Stops this shift
                </p>
                <p className="font-mono font-bold text-xs text-foreground mt-0.5">
                  {snapshot.stopsThisShift}
                </p>
              </div>
            </div>
          </div>

          {/* ------------------------------------------------------- */}
          {/* RIGHT COLUMN: 6 KPI Strip + Banner + Loss Stack */}
          {/* ------------------------------------------------------- */}
          <div className="xl:col-span-8 flex flex-col gap-3 w-full">
            {/* 3.2 KPI STRIP (6 cards) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-2.5">
              {/* Card 1: Machine OEE */}
              <KpiCard
                label="Machine OEE"
                value={snapshot.oee !== null ? snapshot.oee.toFixed(1) : "—"}
                unit={snapshot.oee !== null ? "%" : ""}
                caption={
                  <span className="flex items-center gap-0.5 text-tier-good font-semibold">
                    <ArrowUp className="size-3" />
                    <span>+0.4%</span>
                  </span>
                }
                comparisonLabel="vs 30s ago"
              />

              {/* Card 2: Availability */}
              <KpiCard
                label="Availability"
                value={snapshot.availability !== null ? snapshot.availability.toFixed(1) : "—"}
                unit={snapshot.availability !== null ? "%" : ""}
                caption={
                  <span className="flex items-center gap-0.5 text-tier-good font-semibold">
                    <ArrowUp className="size-3" />
                    <span>+0.5%</span>
                  </span>
                }
                comparisonLabel="vs 30s ago"
              />

              {/* Card 3: Performance */}
              <KpiCard
                label="Performance"
                value={snapshot.performance !== null ? snapshot.performance.toFixed(1) : "—"}
                unit={snapshot.performance !== null ? "%" : ""}
                caption={
                  <span className="flex items-center gap-0.5 text-destructive font-semibold">
                    <ArrowDown className="size-3" />
                    <span>-0.3%</span>
                  </span>
                }
                comparisonLabel="vs 30s ago"
              />

              {/* Card 4: Quality */}
              <KpiCard
                label="Quality"
                value={snapshot.quality !== null ? snapshot.quality.toFixed(1) : "—"}
                unit={snapshot.quality !== null ? "%" : ""}
                caption={
                  <span className="flex items-center gap-0.5 text-tier-good font-semibold">
                    <ArrowUp className="size-3" />
                    <span>+0.1%</span>
                  </span>
                }
                comparisonLabel="vs 30s ago"
              />

              {/* Card 5: Output (pcs) with sub-line Good X · Rejects Y */}
              <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-3 shadow-2xs">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Output
                </p>
                <div className="my-1 flex items-baseline gap-1">
                  <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                    {snapshot.totalOutput.toLocaleString()}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">pcs</span>
                </div>
                <p className="text-[10px] text-muted-foreground truncate">
                  Good {snapshot.goodOutput.toLocaleString()} · Rej{" "}
                  <span className="font-semibold text-destructive">{snapshot.rejects}</span>
                </p>
              </div>

              {/* Card 6: Status Card with tone color & since duration */}
              <div
                className={cn(
                  "flex flex-col justify-between rounded-lg border p-3 shadow-2xs transition-colors",
                  statusTone === "bad" && "border-destructive/40 bg-destructive/10",
                  statusTone === "warn" && "border-amber-500/40 bg-amber-500/10",
                  statusTone === "good" && "border-tier-good/40 bg-tier-good/10",
                  statusTone === "info" && "border-border bg-surface",
                )}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Status
                </p>
                <div className="my-1">
                  <p
                    className={cn(
                      "font-bold text-base sm:text-lg tracking-tight",
                      statusTone === "bad" && "text-destructive font-extrabold",
                      statusTone === "warn" && "text-amber-600 dark:text-amber-400 font-extrabold",
                      statusTone === "good" && "text-tier-good",
                    )}
                  >
                    {statusLabel}
                  </p>
                </div>
                <p className="text-[10px] text-foreground/80 truncate">
                  {snapshot.status.detail} · {formatDuration(snapshot.status.sinceSec)}
                </p>
              </div>
            </div>

            {/* 3.4 ACTIVE STOP BANNER (only if not running) */}
            <ActiveStopBanner
              lineId={line.id}
              machineCode={machine.id}
              snapshot={snapshot}
              onClarifyNow={handleClarifyNow}
            />

            {/* 3.5 & 3.8 LOSS STACK (Accordion between Loss Clarification & Machine Events) */}
            {isMultiShift ? (
              /* Multi-shift notice per §3.8 */
              <div className="flex flex-col items-center justify-center rounded-lg border border-border/80 bg-surface p-8 text-center shadow-xs">
                <Calendar className="size-8 text-muted-foreground mb-2" />
                <h4 className="text-sm font-bold text-foreground">
                  Loss Clarification works per shift
                </h4>
                <p className="text-xs text-muted-foreground mt-1 max-w-md">
                  The selected period spans multiple shifts. To clarify losses or inspect the
                  30-second timeline, please select a single shift.
                </p>
                <div className="flex items-center gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => setPeriod("live")}
                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground shadow-xs hover:bg-primary/90 cursor-pointer"
                  >
                    Switch to Current Shift (LIVE)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPeriod("last-shift")}
                    className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-muted cursor-pointer"
                  >
                    Switch to Last Shift
                  </button>
                </div>
              </div>
            ) : (
              <LossStack
                shift={shiftInfo}
                machineCode={machine.id}
                idealRatePpm={idealRatePpm}
                orders={orders}
                events={events}
                windows={windows}
                snapshot={snapshot}
                selectedEventId={selectedEventId}
                onSelectEventId={setSelectedEventId}
                isLivePeriod={period === "live"}
                forcedFocus={forcedFocus}
              />
            )}
          </div>
        </div>

        {/* ========================================================= */}
        {/* 3.9 OPERATIONAL PARAMETERS TABLE (full width bottom) */}
        {/* ========================================================= */}
        <div className="w-full mt-2">
          <OperationalParametersTable
            machineCode={machine.id}
            snapshot={snapshot}
            tickSec={tick * 2}
          />
        </div>
      </main>
    </div>
  );
}
