import React from "react";
import { AlertCircle, AlertTriangle, ArrowRight, Info, Wrench } from "lucide-react";
import type { ShiftSnapshot } from "@/lib/oee/machineEvents";
import { formatDuration } from "@/lib/oee/shiftClock";
import { cn } from "@/lib/utils";

export interface ActiveStopBannerProps {
  lineId: string;
  machineCode: string;
  snapshot: ShiftSnapshot;
  onClarifyNow: () => void;
  className?: string;
}

export function ActiveStopBanner({
  lineId,
  machineCode,
  snapshot,
  onClarifyNow,
  className,
}: ActiveStopBannerProps) {
  const activeStop = snapshot.activeStop;

  // Banner is only rendered when there is an active non-running stop
  if (!activeStop) return null;

  const severity = activeStop.severity;
  const isCritical = severity === "CRITICAL";
  const isWarning = severity === "WARNING";

  return (
    <div
      role="alert"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-all animate-in fade-in slide-in-from-top-1 duration-200 shadow-xs",
        isCritical &&
          "border-destructive/40 bg-destructive/10 text-foreground dark:border-destructive/50 dark:bg-destructive/15",
        isWarning &&
          "border-amber-500/40 bg-amber-500/10 text-foreground dark:border-amber-500/50 dark:bg-amber-500/15",
        !isCritical &&
          !isWarning &&
          "border-border/80 bg-surface/90 text-foreground dark:bg-surface/50",
        className,
      )}
    >
      {/* Left side: Severity badge + Line.Machine + Start Time + Fault Name + Elapsed */}
      <div className="flex flex-wrap items-center gap-2.5 min-w-0 flex-1">
        {/* Severity Pill */}
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
            isCritical && "bg-destructive text-destructive-foreground",
            isWarning && "bg-amber-500 text-black dark:bg-amber-400 font-extrabold",
            !isCritical && !isWarning && "bg-muted text-muted-foreground",
          )}
        >
          {isCritical ? (
            <AlertCircle className="size-3" />
          ) : isWarning ? (
            <AlertTriangle className="size-3" />
          ) : (
            <Info className="size-3" />
          )}
          <span>{severity}</span>
        </span>

        {/* Machine & Start Info */}
        <span className="font-mono text-xs font-semibold text-foreground">
          {lineId}·{machineCode}
        </span>
        <span className="text-xs text-muted-foreground">
          started <span className="font-mono">{activeStop.startedAtTime}</span>
        </span>

        {/* Separator dot */}
        <span className="text-muted-foreground/50">·</span>

        {/* Fault Title */}
        <span className="text-xs font-bold text-foreground truncate max-w-[260px] sm:max-w-[340px]">
          {activeStop.fault}
        </span>

        {/* Live Elapsed Counter */}
        <div className="flex items-center gap-1 rounded bg-background/80 px-2 py-0.5 border border-border/80 font-mono text-xs font-bold">
          <span className="text-muted-foreground text-[10px] uppercase">Elapsed:</span>
          <span
            className={cn(
              "tabular-nums",
              isCritical
                ? "text-destructive font-extrabold"
                : isWarning
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-foreground",
            )}
          >
            {formatDuration(activeStop.elapsedSec)}
          </span>
        </div>

        {/* Classification Breadcrumb or Awaiting Reason */}
        {activeStop.isClassified && activeStop.lossBreadcrumb ? (
          <span className="hidden xl:inline-flex items-center gap-1 rounded-full bg-surface px-2.5 py-0.5 text-[10px] font-medium border border-border text-muted-foreground">
            <Wrench className="size-3 text-primary" />
            <span className="truncate max-w-[220px]">{activeStop.lossBreadcrumb}</span>
          </span>
        ) : (
          <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-destructive/15 text-destructive px-2 py-0.5 text-[10px] font-bold border border-destructive/30">
            Awaiting reason
          </span>
        )}

        {/* Downstream effect chips */}
        {activeStop.downstreamMachines.length > 0 && (
          <div className="hidden 2xl:flex items-center gap-1 text-[10px] text-muted-foreground">
            <span>Downstream:</span>
            {activeStop.downstreamMachines.map((mCode) => (
              <span
                key={mCode}
                className="rounded border border-border/80 bg-background/70 px-1.5 py-0.5 font-mono text-[10px] font-semibold"
              >
                {mCode}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right side: Clarify now action button */}
      <button
        type="button"
        onClick={onClarifyNow}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 cursor-pointer active:scale-95 shrink-0"
      >
        <span>Clarify now</span>
        <ArrowRight className="size-3.5" />
      </button>
    </div>
  );
}
