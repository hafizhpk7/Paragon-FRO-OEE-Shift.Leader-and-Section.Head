/**
 * Unified Machine Events & Shift Timeline Generator.
 * SINGLE SOURCE OF TRUTH for:
 * - Shift timeline windows (30s buckets, 960 total per 8h shift)
 * - Event log (run, speed_loss, minor_stop, downtime, planned)
 * - OEE, Availability, Performance, Quality KPIs
 * - MTTR, MTBF, Stops this shift
 * - Live active stop state & downstream impacts
 * - Loss classification persistence
 */

import { useSyncExternalStore } from "react";
import { J2_LINES_CONFIG } from "./j2-layout-config";
import { autoParent, componentOf, type LossComponent, type LossParent } from "./lossTree";
import { makeRng } from "./rng";
import { formatTimeWib, getShiftInfo, SHIFT_SECONDS, type ShiftInfo } from "./shiftClock";
import type { PeriodKey } from "./period";

export type EventType = "run" | "speed_loss" | "minor_stop" | "downtime" | "planned";

export interface LossCause {
  id: string;
  durationSec: number;
  l0Component: LossComponent;
  l1Parent: LossParent;
  l2CategoryId: string;
  l2CategoryName: string;
  l3ReasonId: string;
  l3ReasonName: string;
  causeMachineCode?: string;
  note?: string;
}

export interface MachineEvent {
  id: string;
  machineCode: string;
  startSec: number; // Seconds from shift start (0..28800)
  endSec: number; // Seconds from shift start (0..28800)
  durationSec: number;
  startAt: number; // Canonical absolute epoch milliseconds
  endAt: number; // Canonical absolute epoch milliseconds
  type: EventType;
  speedPct?: number; // For speed_loss (e.g. 78%)
  plcAlarm?: string;
  orderId: string;
  sku: string;
  productName: string;
  isOngoing?: boolean;
  source?: "PLC" | "Operator" | "You";
  causes: LossCause[];
  note?: string;
  causeMachineCode?: string;
}

export interface ProductionOrder {
  id: string;
  sku: string;
  productName: string;
  planQty: number;
  startSec: number;
  endSec: number;
}

export interface TimelineWindow {
  index: number;
  startSec: number;
  endSec: number;
  output: number;
  targetOutput: number;
  speedPpm: number;
  type: EventType;
  eventId?: string;
  needsReason?: boolean;
}

export interface ShiftSnapshot {
  machineCode: string;
  shiftKey: string;
  shiftLabel: string;
  idealRatePpm: number;
  planUnits: number;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  totalOutput: number;
  goodOutput: number;
  rejects: number;
  rejectRatePct: number;
  outputVsPlanPct: number;
  totalLossSec: number;
  totalLossMin: number;
  stopsThisShift: number;
  mttrMin: number | null;
  mtbfMin: number | null;
  unclassifiedCount: number;
  unclassifiedSec: number;
  status: {
    state: "running" | "slow" | "down" | "idle" | "off";
    tone: "good" | "warn" | "bad" | "info" | "off";
    label: string;
    detail: string;
    sinceSec: number;
  };
  activeStop?: {
    event: MachineEvent;
    severity: "CRITICAL" | "WARNING" | "INFO";
    fault: string;
    startedAtTime: string;
    elapsedSec: number;
    downstreamMachines: string[];
    isClassified: boolean;
    lossBreadcrumb?: string;
  };
}

export interface ShiftTimelineResult {
  shift: ShiftInfo;
  machineCode: string;
  idealRatePpm: number;
  orders: ProductionOrder[];
  events: MachineEvent[];
  windows: TimelineWindow[];
  snapshot: ShiftSnapshot;
}

export const WINDOW_SEC = 30;
export const DOWNTIME_THRESHOLD_SEC = 600; // 10 minutes

// In-memory fallback for saved classifications if localStorage fails
const memoryClassificationStore = new Map<string, LossCause[]>();
let classificationVersion = 0;
const classificationListeners = new Set<() => void>();

export function useClassificationVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      classificationListeners.add(cb);
      return () => classificationListeners.delete(cb);
    },
    () => classificationVersion,
    () => 0,
  );
}

export function notifyClassificationChanged() {
  classificationVersion++;
  classificationListeners.forEach((l) => l());
}

export function getSavedClassifications(
  shiftKey: string,
  machineCode: string,
): Record<string, LossCause[]> {
  const key = `fro-oee-loss:${shiftKey}:${machineCode}`;
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  const result: Record<string, LossCause[]> = {};
  memoryClassificationStore.forEach((causes, k) => {
    if (k.startsWith(`${shiftKey}:${machineCode}:`)) {
      const eventId = k.split(":")[2];
      result[eventId] = causes;
    }
  });
  return result;
}

import { toast } from "sonner";
import {
  canEditClassified,
  isItemEligible,
  explainLossPolicy,
  lossEventRegistry,
} from "./lossClarificationPolicy";
import type { Role } from "./app-context";

/**
 * Normalizes event timestamps to ensure canonical absolute epoch milliseconds.
 * If startAt is non-finite, logs console.error and derives a fallback.
 */
export function normalizeEventTimestamps(event: MachineEvent, windowStartMs: number): MachineEvent {
  let startAt = event.startAt;
  let endAt = event.endAt;

  if (typeof startAt !== "number" || !Number.isFinite(startAt)) {
    console.error(`[OEE] normalizeEventTimestamps: invalid startAt on event ${event.id}:`, startAt);
    startAt = windowStartMs + (Number.isFinite(event.startSec) ? event.startSec * 1000 : 0);
  }

  if (typeof endAt !== "number" || !Number.isFinite(endAt)) {
    const durationMs = Number.isFinite(event.durationSec) ? event.durationSec * 1000 : 0;
    endAt = startAt + durationMs;
  }

  return {
    ...event,
    startAt,
    endAt,
  };
}

export function saveEventClassification(
  shiftKey: string,
  machineCode: string,
  eventId: string,
  causes: LossCause[],
  note?: string,
  causeMachineCode?: string,
  role?: Role | string,
  itemStartAt?: number, // Canonical absolute epoch milliseconds
): { success: boolean; error?: string } {
  const currentRole = (role ||
    (typeof window !== "undefined" ? localStorage.getItem("paragon_oee_role") : null) ||
    "section-head") as string;
  const now = new Date();

  // 1. Invariant: Valid canonical timestamp
  if (itemStartAt === undefined || !Number.isFinite(itemStartAt)) {
    console.error(
      `[OEE] Cannot save: invalid or missing itemStartAt for event ${eventId}:`,
      itemStartAt,
    );
    const explanation = explainLossPolicy(eventId, itemStartAt, false, currentRole, now);
    console.warn("[OEE] Loss policy rejected action (invalid timestamp):", explanation);
    toast.error("Cannot save: this loss has no valid start time");
    return { success: false, error: "Cannot save: this loss has no valid start time" };
  }

  // 2. 7-day lookback gate: check isItemEligible
  if (!isItemEligible(itemStartAt, now)) {
    const explanation = explainLossPolicy(eventId, itemStartAt, false, currentRole, now);
    console.warn("[OEE] Loss policy rejected action (out of range):", explanation);
    toast.error("Only the last 7 days can be clarified");
    return { success: false, error: "Only the last 7 days can be clarified" };
  }

  // 3. Role check: editing existing classified item requires canEditClassified
  const existing = getSavedClassifications(shiftKey, machineCode);
  const existingCauses = existing[eventId];
  const isAlreadyClassified = existingCauses && existingCauses.length > 0;

  if (isAlreadyClassified && !canEditClassified(currentRole)) {
    const explanation = explainLossPolicy(eventId, itemStartAt, true, currentRole, now);
    console.warn("[OEE] Loss policy rejected action (role denied):", explanation);
    toast.error("Only Section Head can edit classified loss");
    return { success: false, error: "Only Section Head can edit classified loss" };
  }

  const key = `fro-oee-loss:${shiftKey}:${machineCode}`;
  existing[eventId] = causes;
  try {
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // fallback to memory
  }
  memoryClassificationStore.set(`${shiftKey}:${machineCode}:${eventId}`, causes);
  notifyClassificationChanged();
  return { success: true };
}

/**
 * Gets downstream machines on the same line that could be affected
 */
export function getLineSiblingMachines(machineCode: string): { code: string; name: string }[] {
  for (const line of J2_LINES_CONFIG) {
    const found = line.machines.find((m) => m.code === machineCode || m.id === machineCode);
    if (found) {
      return line.machines.map((m) => ({
        code: m.code || m.id || "",
        name: m.name || m.code || m.id || "",
      }));
    }
  }
  return [{ code: machineCode, name: machineCode }];
}

/**
 * Machine profiles specifying ideal production rates and default parameters
 */
export interface MachineProfile {
  idealRatePpm: number;
  planUnits: number;
  rejectRatePct: number;
  sku: string;
  productName: string;
}

export function getMachineProfile(machineCode: string): MachineProfile {
  // Tube Fillers (LTF / LTR)
  if (machineCode.startsWith("LTF") || machineCode.startsWith("LTR")) {
    return {
      idealRatePpm: 190,
      planUnits: 32000,
      rejectRatePct: 0.8,
      sku: "PO-2811 · 4000081204",
      productName: "Wardah Hydra Rose Gel Foam 100ML",
    };
  }
  // Bottle Fillers (LBF / LJF / Robofiller)
  if (
    machineCode.startsWith("LBF") ||
    machineCode.startsWith("LJF") ||
    machineCode.includes("RFL")
  ) {
    return {
      idealRatePpm: 120,
      planUnits: 22000,
      rejectRatePct: 0.9,
      sku: "PO-2811 · 4000081204",
      productName: "Wardah Hydra Rose Micellar Water 100ML",
    };
  }
  // Cappers
  if (machineCode.startsWith("LBC")) {
    return {
      idealRatePpm: 130,
      planUnits: 23000,
      rejectRatePct: 0.4,
      sku: "PO-2811 · 4000081204",
      productName: "Wardah Hydra Rose Micellar Water 100ML",
    };
  }
  // Carton / Case / Shrink
  return {
    idealRatePpm: 140,
    planUnits: 25000,
    rejectRatePct: 0.5,
    sku: "PO-2811 · 4000081204",
    productName: "Wardah Hydra Rose Micellar Water 100ML",
  };
}

/**
 * Sample pre-classification library for seeding 25% of items
 */
const SAMPLE_PRECLASSIFIED_REASONS = [
  {
    l0: "Availability" as LossComponent,
    l1: "Breakdown" as LossParent,
    catId: "BKD-MCH",
    catName: "Mechanical Failure",
    reasonId: "R-MCH-04",
    reasonName: "Pneumatic cylinder seal leak",
  },
  {
    l0: "Performance" as LossComponent,
    l1: "Minor Stop" as LossParent,
    catId: "MNR-JAM",
    catName: "Intermittent Jam",
    reasonId: "R-JAM-01",
    reasonName: "Bottle fallen / tilted on infeed",
  },
  {
    l0: "Availability" as LossComponent,
    l1: "Breakdown" as LossParent,
    catId: "BKD-ELE",
    catName: "Electrical Failure",
    reasonId: "R-ELE-02",
    reasonName: "Optical sensor misalignment / dirt",
  },
  {
    l0: "Performance" as LossComponent,
    l1: "Speed Loss" as LossParent,
    catId: "SPD-RAW",
    catName: "Material Flow Variability",
    reasonId: "R-SPD-01",
    reasonName: "Viscosity fluctuation requiring speed derate",
  },
  {
    l0: "Loading" as LossComponent,
    l1: "Planned Downtime" as LossParent,
    catId: "PLN-CLN",
    catName: "Sanitization & Cleaning",
    reasonId: "R-CLN-01",
    reasonName: "Line rinse & nozzle flush",
  },
];

/**
 * Generates the unified timeline and events, deterministic per (shiftKey + machineCode + period)
 */
export function getShiftTimeline(
  machineCode: string,
  shift: ShiftInfo = getShiftInfo(),
  liveNowSec?: number,
  plantId: string = "J2",
  periodKey: PeriodKey = "this-shift",
): ShiftTimelineResult {
  const profile = getMachineProfile(machineCode);
  const shiftKey = shift.shiftKey;
  const seed = `${plantId}:${shiftKey}:${machineCode}:${periodKey}`;
  const rng = makeRng(seed);

  // Time reveal boundary
  const revealSec =
    liveNowSec !== undefined ? Math.min(SHIFT_SECONDS, Math.max(0, liveNowSec)) : shift.elapsedSec;

  // Orders definition
  const orders: ProductionOrder[] = [
    {
      id: "PO-2811",
      sku: profile.sku,
      productName: profile.productName,
      planQty: Math.round(profile.planUnits * 0.65),
      startSec: 0,
      endSec: 18000,
    },
    {
      id: "PO-2810",
      sku: profile.sku.replace("2811", "2810"),
      productName: "Wardah Nature Daily Aloe Toner 150ML",
      planQty: Math.round(profile.planUnits * 0.35),
      startSec: 18000,
      endSec: 28800,
    },
  ];

  // Saved user classifications from persistent store
  const savedClassifications = getSavedClassifications(shiftKey, machineCode);

  // Determine target event count based on period guideline
  let targetEventCount = 8;
  if (periodKey === "today") targetEventCount = 18;
  else if (periodKey === "this-week") targetEventCount = 30;
  else if (periodKey === "this-month") targetEventCount = 50;
  else if (periodKey === "custom-range") targetEventCount = 25;

  const windowStartMs = shift.startSec * 1000;
  const rawEvents: MachineEvent[] = [];

  // 1. First event: Planned briefing
  const firstEvId = `${plantId}-${machineCode}-EV-01`;
  rawEvents.push(
    normalizeEventTimestamps(
      {
        id: firstEvId,
        machineCode,
        startSec: 0,
        endSec: 900,
        durationSec: 900,
        startAt: windowStartMs,
        endAt: windowStartMs + 900 * 1000,
        type: "planned",
        orderId: "PO-2811",
        sku: orders[0].sku,
        productName: orders[0].productName,
        source: "Operator",
        causes: [
          {
            id: `C-${firstEvId}-0`,
            durationSec: 900,
            l0Component: "Loading",
            l1Parent: "Planned Downtime",
            l2CategoryId: "PLN-BRK",
            l2CategoryName: "Break & Rest Time",
            l3ReasonId: "R-BRK-02",
            l3ReasonName: "Shift handover & briefing",
          },
        ],
      },
      windowStartMs,
    ),
  );

  // 2. Generate remaining events spread across timeline
  const intervalSpacing = Math.floor((SHIFT_SECONDS - 1800) / targetEventCount);

  for (let i = 1; i < targetEventCount; i++) {
    const evId = `${plantId}-${machineCode}-EV-${String(i + 1).padStart(2, "0")}`;
    const startSec = 1000 + i * intervalSpacing + Math.floor(rng() * 120);
    if (startSec >= SHIFT_SECONDS - 60) break;

    const rType = rng();
    let type: EventType = "minor_stop";
    let durationSec = 30 + Math.floor(rng() * 90); // 30s-2m
    let speedPct: number | undefined;
    let plcAlarm: string | undefined;

    if (rType < 0.2) {
      type = "downtime";
      durationSec = 660 + Math.floor(rng() * 900); // 11-25 mins
      plcAlarm = "Pneumatic cylinder seal leak";
    } else if (rType < 0.4) {
      type = "speed_loss";
      durationSec = 900 + Math.floor(rng() * 900); // 15-30 mins
      speedPct = 75 + Math.floor(rng() * 15);
    } else if (rType < 0.85) {
      type = "minor_stop";
      durationSec = 30 + Math.floor(rng() * 150); // 30-180s
      plcAlarm = rng() > 0.5 ? "Infeed conveyor blockage" : undefined;
    } else {
      type = "planned";
      durationSec = 600 + Math.floor(rng() * 600);
    }

    const endSec = Math.min(SHIFT_SECONDS, startSec + durationSec);
    const order = startSec >= 18000 ? orders[1] : orders[0];

    // Pre-classify roughly 25% of events (every 4th item)
    const isPreClassified = i % 4 === 0;
    const sampleReason = SAMPLE_PRECLASSIFIED_REASONS[i % SAMPLE_PRECLASSIFIED_REASONS.length];

    const causes: LossCause[] = isPreClassified
      ? [
          {
            id: `C-${evId}-0`,
            durationSec,
            l0Component: sampleReason.l0,
            l1Parent: sampleReason.l1,
            l2CategoryId: sampleReason.catId,
            l2CategoryName: sampleReason.catName,
            l3ReasonId: sampleReason.reasonId,
            l3ReasonName: sampleReason.reasonName,
            causeMachineCode: machineCode,
          },
        ]
      : [];

    rawEvents.push(
      normalizeEventTimestamps(
        {
          id: evId,
          machineCode,
          startSec,
          endSec,
          durationSec,
          startAt: windowStartMs + startSec * 1000,
          endAt: windowStartMs + endSec * 1000,
          type,
          speedPct,
          plcAlarm,
          orderId: order.id,
          sku: order.sku,
          productName: order.productName,
          source: isPreClassified ? "PLC" : undefined,
          causes,
        },
        windowStartMs,
      ),
    );
  }

  // Ongoing stop if currently near active time in live mode
  if (revealSec < SHIFT_SECONDS && revealSec > 3600) {
    const ongoingStart = Math.max(1200, revealSec - 600);
    const ongoingId = `${plantId}-${machineCode}-EV-ONGOING`;
    rawEvents.push(
      normalizeEventTimestamps(
        {
          id: ongoingId,
          machineCode,
          startSec: ongoingStart,
          endSec: revealSec,
          durationSec: Math.max(30, revealSec - ongoingStart),
          startAt: windowStartMs + ongoingStart * 1000,
          endAt: windowStartMs + revealSec * 1000,
          type: "minor_stop",
          orderId: ongoingStart >= 18000 ? "PO-2810" : "PO-2811",
          sku: ongoingStart >= 18000 ? orders[1].sku : orders[0].sku,
          productName: ongoingStart >= 18000 ? orders[1].productName : orders[0].productName,
          plcAlarm: "Conveyor jam at infeed",
          isOngoing: true,
          causes: [],
        },
        windowStartMs,
      ),
    );
  }

  // 3. Apply saved classifications from persistent store
  const activeEvents = rawEvents
    .filter((e) => e.startSec < revealSec || periodKey !== "this-shift")
    .map((e) => {
      const isOngoing = Boolean(e.isOngoing && revealSec < SHIFT_SECONDS);
      const effEnd = isOngoing ? revealSec : e.endSec;
      const effDur = Math.max(30, effEnd - e.startSec);
      let effType = e.type;
      if (effType === "minor_stop" && effDur >= DOWNTIME_THRESHOLD_SEC) {
        effType = "downtime";
      }

      // Check if user has saved classifications for this event
      const userCauses = savedClassifications[e.id];
      const baseEvent: MachineEvent = {
        ...e,
        endSec: effEnd,
        durationSec: effDur,
        endAt: windowStartMs + effEnd * 1000,
        type: effType,
        isOngoing,
        source: userCauses && userCauses.length > 0 ? ("You" as const) : e.source,
        causes: userCauses && userCauses.length > 0 ? userCauses : e.causes,
      };

      const normalized = normalizeEventTimestamps(baseEvent, windowStartMs);
      lossEventRegistry.set(normalized.id, normalized);
      return normalized;
    });

  // 4. Generate 30s Timeline Windows (0..960)
  const totalWindows = Math.floor(SHIFT_SECONDS / WINDOW_SEC);
  const windows: TimelineWindow[] = [];

  let producedCount = 0;
  let rejectsCount = 0;
  let plannedSec = 0;
  let downSec = 0;
  let minorSec = 0;
  let speedLossSec = 0;

  for (let wIdx = 0; wIdx < totalWindows; wIdx++) {
    const wStart = wIdx * WINDOW_SEC;
    const wEnd = wStart + WINDOW_SEC;
    const isFuture = wStart >= revealSec;

    // Find active event overlapping window center
    const wMid = wStart + WINDOW_SEC / 2;
    const activeEv = activeEvents.find((e) => wMid >= e.startSec && wMid < e.endSec);

    let type: EventType = "run";
    let speedPpm = profile.idealRatePpm;
    let unitsInWindow = (profile.idealRatePpm * WINDOW_SEC) / 60;
    const targetUnitsInWindow = (profile.idealRatePpm * WINDOW_SEC) / 60;
    let needsReason = false;

    if (isFuture) {
      windows.push({
        index: wIdx,
        startSec: wStart,
        endSec: wEnd,
        output: 0,
        targetOutput: targetUnitsInWindow,
        speedPpm: 0,
        type: "run",
      });
      continue;
    }

    if (activeEv) {
      type = activeEv.type;
      const classifiedSec = activeEv.causes.reduce((sum, c) => sum + c.durationSec, 0);
      needsReason = type !== "run" && classifiedSec < activeEv.durationSec;

      if (type === "planned") {
        speedPpm = 0;
        unitsInWindow = 0;
        plannedSec += WINDOW_SEC;
      } else if (type === "downtime") {
        speedPpm = 0;
        unitsInWindow = 0;
        downSec += WINDOW_SEC;
      } else if (type === "minor_stop") {
        speedPpm = 0;
        unitsInWindow = 0;
        minorSec += WINDOW_SEC;
      } else if (type === "speed_loss") {
        const pct = activeEv.speedPct ?? 78;
        speedPpm = Math.round((profile.idealRatePpm * pct) / 100);
        unitsInWindow = Math.round((targetUnitsInWindow * pct) / 100);
        speedLossSec += WINDOW_SEC * (1 - pct / 100);
      }
    }

    // Accumulate production & rejects
    producedCount += unitsInWindow;
    if (unitsInWindow > 0) {
      rejectsCount += (unitsInWindow * profile.rejectRatePct) / 100;
    }

    windows.push({
      index: wIdx,
      startSec: wStart,
      endSec: wEnd,
      output: Math.round(unitsInWindow),
      targetOutput: Math.round(targetUnitsInWindow),
      speedPpm: Math.round(speedPpm),
      type,
      eventId: activeEv?.id,
      needsReason,
    });
  }

  // 5. Calculate Standard OEE Metrics (Shift-to-date)
  const sptSec = Math.max(0, revealSec - plannedSec);
  const gotSec = Math.max(0, sptSec - downSec);
  const netSec = Math.max(0, gotSec - minorSec - speedLossSec);

  const roundedProduced = Math.round(producedCount);
  const roundedRejects = Math.round(rejectsCount);
  const roundedGood = Math.max(0, roundedProduced - roundedRejects);

  let availability: number | null = null;
  let performance: number | null = null;
  let quality: number | null = null;
  let oee: number | null = null;

  if (sptSec >= 60 && gotSec > 0 && roundedProduced > 0) {
    availability = Math.min(100, Math.max(0, (gotSec / sptSec) * 100));
    performance = Math.min(100, Math.max(0, (netSec / gotSec) * 100));
    quality = Math.min(100, Math.max(0, (roundedGood / roundedProduced) * 100));
    oee = Math.min(100, Math.max(0, (availability * performance * quality) / 10000));
  }

  const stopEvents = activeEvents.filter((e) => e.type === "downtime" || e.type === "minor_stop");
  const stopsThisShift = stopEvents.length;
  const totalStopSec = downSec + minorSec;

  const mttrMin = stopsThisShift > 0 ? Math.round(totalStopSec / stopsThisShift / 60) : null;
  const mtbfMin =
    stopsThisShift > 0 ? Math.round((sptSec - totalStopSec) / stopsThisShift / 60) : null;

  const unclassifiedEvents = activeEvents.filter((e) => {
    if (e.type === "run" || e.type === "planned") return false;
    const classifiedSec = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
    return classifiedSec < e.durationSec;
  });

  const unclassifiedCount = unclassifiedEvents.length;
  const unclassifiedSec = unclassifiedEvents.reduce((sum, e) => {
    const classified = e.causes.reduce((cSum, c) => cSum + c.durationSec, 0);
    return sum + Math.max(0, e.durationSec - classified);
  }, 0);

  // Active stop banner state
  const ongoingEvent = activeEvents.find((e) => e.isOngoing);
  let activeStop: ShiftSnapshot["activeStop"] = undefined;

  if (ongoingEvent) {
    const isClassified =
      ongoingEvent.causes.length > 0 &&
      ongoingEvent.causes.reduce((sum, c) => sum + c.durationSec, 0) >= ongoingEvent.durationSec;

    const lossBreadcrumb = isClassified
      ? `${ongoingEvent.causes[0].l1Parent} › ${ongoingEvent.causes[0].l2CategoryName} › ${ongoingEvent.causes[0].l3ReasonName}`
      : undefined;

    activeStop = {
      event: ongoingEvent,
      severity: ongoingEvent.durationSec >= DOWNTIME_THRESHOLD_SEC ? "CRITICAL" : "WARNING",
      fault: ongoingEvent.plcAlarm || "Unclassified Stop",
      startedAtTime: formatTimeWib(ongoingEvent.startSec),
      elapsedSec: ongoingEvent.durationSec,
      downstreamMachines: ["LBC01", "LCF01", "LSW01"],
      isClassified,
      lossBreadcrumb,
    };
  }

  // Machine status
  let statusState: ShiftSnapshot["status"]["state"] = "running";
  let statusTone: ShiftSnapshot["status"]["tone"] = "good";
  let statusLabel = "RUNNING";
  let statusDetail = "Production Nominal";
  let sinceSec = Math.max(0, revealSec - 3600);

  if (ongoingEvent) {
    if (ongoingEvent.type === "downtime") {
      statusState = "down";
      statusTone = "bad";
      statusLabel = "DOWN";
      statusDetail = ongoingEvent.plcAlarm || "Downtime Breakdown";
      sinceSec = ongoingEvent.startSec;
    } else if (ongoingEvent.type === "minor_stop") {
      statusState = "down";
      statusTone = "bad";
      statusLabel = "STOPPED";
      statusDetail = ongoingEvent.plcAlarm || "Minor Stop";
      sinceSec = ongoingEvent.startSec;
    } else if (ongoingEvent.type === "speed_loss") {
      statusState = "slow";
      statusTone = "warn";
      statusLabel = "SLOW";
      statusDetail = `Speed derated (${ongoingEvent.speedPct || 78}%)`;
      sinceSec = ongoingEvent.startSec;
    }
  }

  const snapshot: ShiftSnapshot = {
    machineCode,
    shiftKey,
    shiftLabel: shift.label,
    idealRatePpm: profile.idealRatePpm,
    planUnits: profile.planUnits,
    oee,
    availability,
    performance,
    quality,
    totalOutput: roundedProduced,
    goodOutput: roundedGood,
    rejects: roundedRejects,
    rejectRatePct: profile.rejectRatePct,
    outputVsPlanPct: profile.planUnits > 0 ? (roundedProduced / profile.planUnits) * 100 : 0,
    totalLossSec: Math.round(downSec + minorSec + speedLossSec),
    totalLossMin: Math.round((downSec + minorSec + speedLossSec) / 60),
    stopsThisShift,
    mttrMin,
    mtbfMin,
    unclassifiedCount,
    unclassifiedSec,
    status: {
      state: statusState,
      tone: statusTone,
      label: statusLabel,
      detail: statusDetail,
      sinceSec,
    },
    activeStop,
  };

  return {
    shift,
    machineCode,
    idealRatePpm: profile.idealRatePpm,
    orders,
    events: activeEvents,
    windows,
    snapshot,
  };
}
