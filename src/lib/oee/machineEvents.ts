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

import { J2_LINES_CONFIG } from "./j2-layout-config";
import { autoParent, componentOf, type LossComponent, type LossParent } from "./lossTree";
import { makeRng } from "./rng";
import { formatTimeWib, getShiftInfo, SHIFT_SECONDS, type ShiftInfo } from "./shiftClock";

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

export function saveEventClassification(
  shiftKey: string,
  machineCode: string,
  eventId: string,
  causes: LossCause[],
  note?: string,
  causeMachineCode?: string,
) {
  const key = `fro-oee-loss:${shiftKey}:${machineCode}`;
  const existing = getSavedClassifications(shiftKey, machineCode);
  existing[eventId] = causes;
  try {
    localStorage.setItem(key, JSON.stringify(existing));
  } catch {
    // fallback to memory
  }
  memoryClassificationStore.set(`${shiftKey}:${machineCode}:${eventId}`, causes);
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
 * Generates the unified shift timeline, deterministic per (shiftKey + machineCode)
 */
export function getShiftTimeline(
  machineCode: string,
  shift: ShiftInfo = getShiftInfo(),
  liveNowSec?: number,
): ShiftTimelineResult {
  const profile = getMachineProfile(machineCode);
  const isLtf13 = machineCode === "LTF13";
  const shiftKey = shift.shiftKey;
  const rng = makeRng(shiftKey + machineCode);

  // Time reveal boundary: if live, reveals up to current elapsed seconds; otherwise full shift (28800)
  const revealSec =
    liveNowSec !== undefined ? Math.min(SHIFT_SECONDS, Math.max(0, liveNowSec)) : shift.elapsedSec;

  // 1. Orders definition
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
      productName: isLtf13
        ? "Wardah C-Defense Energizing Whip Foam 100ML"
        : "Wardah Nature Daily Aloe Toner 150ML",
      planQty: Math.round(profile.planUnits * 0.35),
      startSec: 18000,
      endSec: 28800,
    },
  ];

  // Saved user classifications
  const savedClassifications = getSavedClassifications(shiftKey, machineCode);

  // 2. Build deterministic events
  const rawEvents: MachineEvent[] = [];

  if (isLtf13) {
    // --- DEMO SCENARIO FOR LTF13 (Bad Day with Ongoing Downtime Stop) ---
    // Planned briefing
    rawEvents.push({
      id: "EV-01",
      machineCode,
      startSec: 0,
      endSec: 900,
      durationSec: 900,
      type: "planned",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      source: "Operator",
      causes: [
        {
          id: "C-01",
          durationSec: 900,
          l0Component: "Loading",
          l1Parent: "Planned Downtime",
          l2CategoryId: "PLN-BRK",
          l2CategoryName: "Break & Rest Time",
          l3ReasonId: "R-BRK-02",
          l3ReasonName: "Shift handover & briefing",
        },
      ],
    });

    // Stop 2: Minor stop 30s
    rawEvents.push({
      id: "EV-02",
      machineCode,
      startSec: 1500,
      endSec: 1530,
      durationSec: 30,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 3: Minor stop 60s
    rawEvents.push({
      id: "EV-03",
      machineCode,
      startSec: 2800,
      endSec: 2860,
      durationSec: 60,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      source: "PLC",
      causes: [
        {
          id: "C-03",
          durationSec: 60,
          l0Component: "Performance",
          l1Parent: "Minor Stop",
          l2CategoryId: "MNR-JAM",
          l2CategoryName: "Intermittent Jam",
          l3ReasonId: "R-JAM-01",
          l3ReasonName: "Bottle fallen / tilted on infeed",
        },
      ],
    });

    // Stop 4: Speed loss running slow (78% speed)
    rawEvents.push({
      id: "EV-04",
      machineCode,
      startSec: 3600,
      endSec: 4800,
      durationSec: 1200,
      type: "speed_loss",
      speedPct: 78,
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 5: Downtime 12m (pre-classified)
    rawEvents.push({
      id: "EV-05",
      machineCode,
      startSec: 5400,
      endSec: 6120,
      durationSec: 720,
      type: "downtime",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      plcAlarm: "Pneumatic cylinder seal leak",
      source: "Operator",
      causes: [
        {
          id: "C-05",
          durationSec: 720,
          l0Component: "Availability",
          l1Parent: "Breakdown",
          l2CategoryId: "BKD-MCH",
          l2CategoryName: "Mechanical Failure",
          l3ReasonId: "R-MCH-04",
          l3ReasonName: "Pneumatic cylinder seal leak",
        },
      ],
    });

    // Stop 6: Minor stop 30s
    rawEvents.push({
      id: "EV-06",
      machineCode,
      startSec: 7200,
      endSec: 7230,
      durationSec: 30,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 7: Minor stop 60s
    rawEvents.push({
      id: "EV-07",
      machineCode,
      startSec: 8400,
      endSec: 8460,
      durationSec: 60,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 8: Minor stop 30s
    rawEvents.push({
      id: "EV-08",
      machineCode,
      startSec: 9600,
      endSec: 9630,
      durationSec: 30,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 9: Minor stop 30s
    rawEvents.push({
      id: "EV-09",
      machineCode,
      startSec: 10800,
      endSec: 10830,
      durationSec: 30,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 10: Minor stop 30s
    rawEvents.push({
      id: "EV-10",
      machineCode,
      startSec: 11400,
      endSec: 11430,
      durationSec: 30,
      type: "minor_stop",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      causes: [],
    });

    // Stop 11: Ongoing stop that began 20 minutes before revealSec (e.g. at revealSec - 1200)
    // Always ongoing in LIVE mode
    const ongoingStart = Math.max(1200, revealSec - 1200);
    rawEvents.push({
      id: "EV-11-ONGOING",
      machineCode,
      startSec: ongoingStart,
      endSec: revealSec,
      durationSec: Math.max(30, revealSec - ongoingStart),
      type: revealSec - ongoingStart >= DOWNTIME_THRESHOLD_SEC ? "downtime" : "minor_stop",
      orderId: ongoingStart >= 18000 ? "PO-2810" : "PO-2811",
      sku: ongoingStart >= 18000 ? orders[1].sku : orders[0].sku,
      productName: ongoingStart >= 18000 ? orders[1].productName : orders[0].productName,
      plcAlarm: "Conveyor jam at infeed",
      isOngoing: true,
      causes: [],
    });
  } else {
    // Standard machine timeline: 1 planned briefing + 3-5 normal intermittent stops
    rawEvents.push({
      id: "EV-01",
      machineCode,
      startSec: 0,
      endSec: 900,
      durationSec: 900,
      type: "planned",
      orderId: "PO-2811",
      sku: orders[0].sku,
      productName: orders[0].productName,
      source: "Operator",
      causes: [
        {
          id: "C-01",
          durationSec: 900,
          l0Component: "Loading",
          l1Parent: "Planned Downtime",
          l2CategoryId: "PLN-BRK",
          l2CategoryName: "Break & Rest Time",
          l3ReasonId: "R-BRK-02",
          l3ReasonName: "Shift handover & briefing",
        },
      ],
    });

    const stopCount = 3 + Math.floor(rng() * 4);
    let curTime = 1800;
    for (let i = 0; i < stopCount && curTime < SHIFT_SECONDS - 1800; i++) {
      curTime += 1800 + Math.floor(rng() * 2400);
      if (curTime > revealSec && !shift.isCurrent) break;
      const dur = rng() > 0.75 ? 720 : 60 + Math.floor(rng() * 120);
      const isDown = dur >= DOWNTIME_THRESHOLD_SEC;
      const order = curTime >= 18000 ? orders[1] : orders[0];
      const evId = `EV-${String(i + 2).padStart(2, "0")}`;

      rawEvents.push({
        id: evId,
        machineCode,
        startSec: curTime,
        endSec: Math.min(SHIFT_SECONDS, curTime + dur),
        durationSec: dur,
        type: isDown ? "downtime" : "minor_stop",
        orderId: order.id,
        sku: order.sku,
        productName: order.productName,
        causes: [],
      });
      curTime += dur;
    }
  }

  // 3. Apply saved classifications from localStorage
  const activeEvents = rawEvents
    .filter((e) => e.startSec < revealSec)
    .map((e) => {
      const isOngoing = Boolean(e.isOngoing && revealSec < SHIFT_SECONDS);
      const effEnd = isOngoing ? revealSec : Math.min(revealSec, e.endSec);
      const effDur = Math.max(30, effEnd - e.startSec);
      let effType = e.type;
      if (effType === "minor_stop" && effDur >= DOWNTIME_THRESHOLD_SEC) {
        effType = "downtime";
      }

      // Check if user has saved classifications for this event
      const userCauses = savedClassifications[e.id];
      if (userCauses && userCauses.length > 0) {
        return {
          ...e,
          endSec: effEnd,
          durationSec: effDur,
          type: effType,
          isOngoing,
          source: "You" as const,
          causes: userCauses,
        };
      }

      // If pre-tagged with single cause
      let causes = e.causes;
      if (causes.length === 1) {
        // Automatically adjust single cause duration to match event duration
        causes = [
          {
            ...causes[0],
            durationSec: effDur,
            l1Parent:
              effType === "downtime" && causes[0].l1Parent === "Minor Stop"
                ? "Breakdown"
                : causes[0].l1Parent,
          },
        ];
      }

      return {
        ...e,
        endSec: effEnd,
        durationSec: effDur,
        type: effType,
        isOngoing,
        causes,
      };
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
      // Future window: placeholder
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
  // SPT (Scheduled Production Time) = revealSec - plannedSec
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

  // Stops count & MTTR / MTBF
  const stopEvents = activeEvents.filter((e) => e.type === "downtime" || e.type === "minor_stop");
  const stopsThisShift = stopEvents.length;
  const totalStopSec = downSec + minorSec;

  const mttrMin = stopsThisShift > 0 ? Math.round(totalStopSec / stopsThisShift / 60) : null;
  const mtbfMin =
    stopsThisShift > 0 ? Math.round((sptSec - totalStopSec) / stopsThisShift / 60) : null;

  // Unclassified losses count and duration
  const unclassifiedEvents = activeEvents.filter((e) => {
    if (e.type === "planned") return false;
    const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
    return classified < e.durationSec;
  });
  const unclassifiedCount = unclassifiedEvents.length;
  const unclassifiedSec = unclassifiedEvents.reduce((sum, e) => {
    const classified = e.causes.reduce((csum, c) => csum + c.durationSec, 0);
    return sum + (e.durationSec - classified);
  }, 0);

  // Status computation (Single object for card, twin badge, banner, events header)
  const currentEvent = activeEvents.find(
    (e) => revealSec >= e.startSec && revealSec <= e.endSec && e.startSec < revealSec,
  );
  let statusState: "running" | "slow" | "down" | "idle" | "off" = "running";
  let statusTone: "good" | "warn" | "bad" | "info" | "off" = "good";
  let statusLabel = "RUNNING";
  let statusDetail = "Effective production";
  let sinceSec = revealSec;

  if (revealSec >= SHIFT_SECONDS) {
    statusState = "off";
    statusTone = "off";
    statusLabel = "SHIFT ENDED";
    statusDetail = "Shift completed";
  } else if (currentEvent) {
    sinceSec = revealSec - currentEvent.startSec;
    if (currentEvent.type === "downtime") {
      statusState = "down";
      statusTone = "bad";
      statusLabel = "DOWN";
      statusDetail = currentEvent.plcAlarm || "Unscheduled breakdown stop";
    } else if (currentEvent.type === "minor_stop") {
      statusState = "down";
      statusTone = "warn";
      statusLabel = "MINOR STOP";
      statusDetail = currentEvent.plcAlarm || "Short intermittent stoppage";
    } else if (currentEvent.type === "speed_loss") {
      statusState = "slow";
      statusTone = "warn";
      statusLabel = "RUNNING SLOW";
      statusDetail = `Operating at ${currentEvent.speedPct ?? 78}% of standard rate`;
    } else if (currentEvent.type === "planned") {
      statusState = "idle";
      statusTone = "info";
      statusLabel = "PLANNED STOP";
      statusDetail = currentEvent.causes[0]?.l3ReasonName || "Scheduled rest / briefing";
    }
  }

  // Active stop banner data (only populated if not normal running)
  let activeStop: ShiftSnapshot["activeStop"] = undefined;
  if (currentEvent && currentEvent.type !== "run" && revealSec < SHIFT_SECONDS) {
    const isClassified = currentEvent.causes.length > 0;
    const firstCause = currentEvent.causes[0];
    const lossBreadcrumb = firstCause
      ? `${firstCause.l0Component} > ${firstCause.l1Parent} > ${firstCause.l2CategoryName} > ${firstCause.l3ReasonName}`
      : undefined;

    // Downstream siblings on same line
    const siblings = getLineSiblingMachines(machineCode)
      .filter((m) => m.code !== machineCode)
      .slice(0, 3)
      .map((m) => m.code);

    activeStop = {
      event: currentEvent,
      severity:
        currentEvent.type === "downtime"
          ? "CRITICAL"
          : currentEvent.type === "planned"
            ? "INFO"
            : "WARNING",
      fault:
        currentEvent.plcAlarm || currentEvent.causes[0]?.l3ReasonName || "Stop awaiting reason",
      startedAtTime: formatTimeWib(shift.startSec + currentEvent.startSec, false),
      elapsedSec: revealSec - currentEvent.startSec,
      downstreamMachines: siblings,
      isClassified,
      lossBreadcrumb,
    };
  }

  const snapshot: ShiftSnapshot = {
    machineCode,
    shiftKey: shift.shiftKey,
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
    outputVsPlanPct: Math.round((roundedProduced / (profile.planUnits || 1)) * 100),
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
