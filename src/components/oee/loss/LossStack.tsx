import React, { useState, useEffect } from "react";
import { LossClarification } from "./LossClarification";
import { MachineEvents } from "./MachineEvents";
import type { ShiftInfo } from "@/lib/oee/shiftClock";
import type { ResolvedPeriod } from "@/lib/oee/period";
import type {
  MachineEvent,
  ProductionOrder,
  ShiftSnapshot,
  TimelineWindow,
} from "@/lib/oee/machineEvents";

export interface LossStackProps {
  shift: ShiftInfo;
  machineCode: string;
  idealRatePpm: number;
  orders: ProductionOrder[];
  events: MachineEvent[];
  windows: TimelineWindow[];
  snapshot: ShiftSnapshot;
  selectedEventId: string | null;
  onSelectEventId: (id: string | null) => void;
  isLivePeriod?: boolean;
  forcedFocus?: "loss" | "events" | null;
  resolved?: ResolvedPeriod;
  className?: string;
}

export function LossStack({
  shift,
  machineCode,
  idealRatePpm,
  orders,
  events,
  windows,
  snapshot,
  selectedEventId,
  onSelectEventId,
  isLivePeriod = true,
  forcedFocus,
  resolved,
  className,
}: LossStackProps) {
  // First visit default: 'loss' if unclassified/ongoing exists, otherwise 'events' (§3.5)
  const [focus, setFocus] = useState<"loss" | "events">(() => {
    try {
      const saved = localStorage.getItem("fro-oee-machine-focus");
      if (saved === "loss" || saved === "events") return saved;
    } catch {
      // fallback
    }
    return snapshot.unclassifiedCount > 0 || snapshot.activeStop ? "loss" : "events";
  });

  // Handle external focus triggers (e.g. from ActiveStopBanner "Clarify now")
  useEffect(() => {
    if (forcedFocus) {
      setFocus(forcedFocus);
      try {
        localStorage.setItem("fro-oee-machine-focus", forcedFocus);
      } catch {
        // ignore
      }
    }
  }, [forcedFocus]);

  const handleSetFocus = (target: "loss" | "events") => {
    setFocus(target);
    try {
      localStorage.setItem("fro-oee-machine-focus", target);
    } catch {
      // ignore
    }
  };

  const handleSelectEventFromChart = (eventId: string) => {
    onSelectEventId(eventId);
    handleSetFocus("loss");
  };

  return (
    <div className={`flex flex-col gap-3 w-full ${className || ""}`}>
      {/* 1. Loss Clarification Panel (Top) */}
      <LossClarification
        shift={shift}
        machineCode={machineCode}
        orders={orders}
        events={events}
        snapshot={snapshot}
        selectedEventId={selectedEventId}
        onSelectEventId={onSelectEventId}
        isExpanded={focus === "loss"}
        onToggleExpand={() => handleSetFocus(focus === "loss" ? "events" : "loss")}
        resolved={resolved}
      />

      {/* 2. Machine Events Panel (Bottom) */}
      <MachineEvents
        shift={shift}
        machineCode={machineCode}
        idealRatePpm={idealRatePpm}
        events={events}
        windows={windows}
        snapshot={snapshot}
        selectedEventId={selectedEventId}
        onSelectEvent={handleSelectEventFromChart}
        isExpanded={focus === "events"}
        onToggleExpand={() => handleSetFocus(focus === "events" ? "loss" : "events")}
        isLivePeriod={isLivePeriod}
        resolved={resolved}
      />
    </div>
  );
}
