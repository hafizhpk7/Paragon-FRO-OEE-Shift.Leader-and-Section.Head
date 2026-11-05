/**
 * Single Source of Truth Selectors and DOM Parity Audit Engine for OEE Dashboard.
 * All UI surfaces (KPI cards, map labels, hover cards, 3D views, tables) query this module.
 */

import {
  getMetrics,
  getActivePO,
  getBottleneck,
  getActualRunRate,
  getSkuStandardRunRate,
  getMachineMaxRunRate,
  getMachineStopsCount,
  type EntityMetrics,
  type EntityType,
} from "./metrics-engine";
import { resolvePeriod, type PeriodKey, type ResolvedPeriod } from "./period";
import { PLANTS, getPlant, getZone, getLine, getMachine, plantAlarms, lineAlarms } from "./data";
import type { Status } from "./config";

export const DEBUG_PARITY = true;

/**
 * Main metric selector.
 */
export function selectMetrics(
  plantId: string,
  entityType: EntityType,
  entityId: string = "",
  period?: PeriodKey | ResolvedPeriod,
): EntityMetrics {
  return getMetrics(plantId, entityType, entityId, period);
}

/**
 * Status selector ensuring single source of truth across stack lights, hover badges, map colors.
 */
export function selectStatus(plantId: string, lineId: string, machineId?: string): Status {
  const l =
    getLine(plantId, "A", lineId) || getLine(plantId, "B", lineId) || getLine(plantId, "C", lineId);

  if (machineId) {
    const cleanId = machineId.replace(new RegExp(`^${lineId}-`), "");
    const m =
      l?.machines.find(
        (mach) =>
          mach.id === machineId ||
          mach.code === machineId ||
          mach.key === machineId ||
          mach.id === cleanId ||
          mach.code === cleanId ||
          mach.key === `${lineId}-${cleanId}`,
      ) ||
      getMachine(plantId, "A", lineId, machineId) ||
      getMachine(plantId, "B", lineId, machineId) ||
      getMachine(plantId, "C", lineId, machineId);
    if (m) return m.status;
  }

  if (!l || !l.machines || l.machines.length === 0) return l?.status ?? "running";

  // Derive line status from machines (worst wins: down > slow > running > idle)
  const machineStatuses = l.machines.map((mach) =>
    selectStatus(plantId, lineId, mach.code || mach.id),
  );
  if (machineStatuses.includes("down")) return "down";
  if (machineStatuses.includes("slow")) return "slow";
  if (machineStatuses.every((s) => s === "idle")) return "idle";
  return "running";
}

/**
 * Active PO selector.
 */
export function selectPO(plantId: string, lineId: string) {
  return getActivePO(plantId, lineId);
}

/**
 * Bottleneck machine selector.
 */
export function selectBottleneck(plantId: string, lineId: string) {
  return getBottleneck(plantId, lineId);
}

/**
 * Lines down counts selector.
 */
export function selectLinesDown(plantId: string, zoneId?: string) {
  const plant = getPlant(plantId);
  const zones = zoneId && plant ? plant.zones.filter((z) => z.id === zoneId) : (plant?.zones ?? []);
  const lines = zones.flatMap((z) => z.lines);

  let running = 0;
  let slow = 0;
  let down = 0;
  let idle = 0;

  for (const l of lines) {
    if (l.status === "running") running++;
    else if (l.status === "slow") slow++;
    else if (l.status === "down") down++;
    else if (l.status === "idle") idle++;
  }

  return {
    total: lines.length,
    running,
    slow,
    down,
    idle,
    downAndSlow: down + slow,
  };
}

/**
 * Alarms count selector.
 */
export function selectAlarmCounts(plantId: string, zoneId?: string) {
  const plant = getPlant(plantId);
  if (!plant) return { total: 0, occurring: 0, resolved: 0 };
  const alarms = plantAlarms(plant);
  const filtered = zoneId ? alarms.filter((a) => a.zoneId === zoneId) : alarms;

  const occurring = filtered.filter((a) => a.status === "OCCURRING").length;
  const resolved = filtered.length - occurring;

  return {
    total: filtered.length,
    occurring,
    resolved,
  };
}

/* ------------------------------------------------------------------ FORMATTERS */

export function formatPct(val: number, compact: boolean = false): string {
  if (val === undefined || isNaN(val)) return "-";
  if (compact) return `${Math.round(val)}%`;
  return `${val.toFixed(1)}%`;
}

export function formatCount(val: number): string {
  if (val === undefined || isNaN(val)) return "-";
  return val.toLocaleString();
}

export function formatRate(val: number): string {
  if (val === undefined || isNaN(val)) return "-";
  return `${val.toLocaleString()} ppm`;
}

/* ------------------------------------------------------------------ DOM PARITY AUDIT */

export type ParityMismatch = {
  key: string;
  expected: number;
  actualValues: number[];
  elementsCount: number;
  message: string;
};

declare global {
  interface Window {
    runParityAudit: () => ParityMismatch[];
  }
}

export interface MachineNotTaggedState {
  notTaggedCount: number;
  taggedCount: number;
  allCount: number;
  notTaggedDurationSec: number;
  taggedDurationSec: number;
  totalDurationSec: number;
  activeStopNotTagged: boolean;
}

/**
 * Single source of truth selector for Machine Loss Tagging counts.
 * Used by Loss Clarification header, Not Tagged tab, Machine Events counter, and Active Stop banner.
 */
export function selectMachineNotTaggedState(
  events: {
    type: string;
    durationSec: number;
    isTagged?: boolean;
    causes?: { l2CategoryName?: string }[];
    isOngoing?: boolean;
  }[],
  activeStopEvent?: { isTagged?: boolean; causes?: { l2CategoryName?: string }[] },
): MachineNotTaggedState {
  const lossEvents = events.filter((e) => e.type !== "run");

  let notTaggedCount = 0;
  let taggedCount = 0;
  let notTaggedDurationSec = 0;
  let taggedDurationSec = 0;

  for (const e of lossEvents) {
    const isTagged = Boolean(
      e.isTagged &&
        e.causes &&
        e.causes.length > 0 &&
        e.causes[0].l2CategoryName !== "Not Tagged Yet",
    );
    if (isTagged) {
      taggedCount++;
      taggedDurationSec += e.durationSec;
    } else {
      notTaggedCount++;
      notTaggedDurationSec += e.durationSec;
    }
  }

  const activeStopNotTagged = activeStopEvent
    ? !Boolean(
        activeStopEvent.isTagged &&
          activeStopEvent.causes &&
          activeStopEvent.causes.length > 0 &&
          activeStopEvent.causes[0].l2CategoryName !== "Not Tagged Yet",
      )
    : false;

  return {
    notTaggedCount,
    taggedCount,
    allCount: lossEvents.length,
    notTaggedDurationSec,
    taggedDurationSec,
    totalDurationSec: notTaggedDurationSec + taggedDurationSec,
    activeStopNotTagged,
  };
}

export function runParityAudit(): ParityMismatch[] {
  if (typeof document === "undefined") return [];

  const mismatches: ParityMismatch[] = [];
  const metricGroups = new Map<string, { rawValues: number[]; elements: Element[] }>();

  // 1. Group all rendered data-metric elements
  const elements = Array.from(document.querySelectorAll("[data-metric]"));
  for (const el of elements) {
    const key = el.getAttribute("data-metric");
    const rawStr = el.getAttribute("data-raw");
    if (!key || rawStr === null) continue;
    const rawVal = parseFloat(rawStr);
    if (isNaN(rawVal)) continue;

    if (!metricGroups.has(key)) {
      metricGroups.set(key, { rawValues: [], elements: [] });
    }
    const group = metricGroups.get(key)!;
    group.rawValues.push(rawVal);
    group.elements.push(el);
  }

  // 2. Check value consistency across elements sharing the same data-metric key
  for (const [key, group] of metricGroups.entries()) {
    if (group.rawValues.length > 1) {
      const first = group.rawValues[0];
      const diff = group.rawValues.some((v) => Math.abs(v - first) > 0.05);
      if (diff) {
        mismatches.push({
          key,
          expected: first,
          actualValues: group.rawValues,
          elementsCount: group.elements.length,
          message: `Mismatch on ${key}: values [${group.rawValues.join(", ")}] differ in DOM`,
        });
      }
    }
  }

  // 3. Line OEE vs Bottleneck Machine OEE parity on Line Detail
  const lineOeeEl = document.querySelector("[data-metric='line-oee']");
  const bnOeeEl = document.querySelector("[data-metric='line-bottleneck-machine-oee']");
  if (lineOeeEl && bnOeeEl) {
    const lVal = parseFloat(lineOeeEl.getAttribute("data-raw") || "");
    const bVal = parseFloat(bnOeeEl.getAttribute("data-raw") || "");
    if (!isNaN(lVal) && !isNaN(bVal) && Math.abs(lVal - bVal) > 0.05) {
      mismatches.push({
        key: "line-vs-bottleneck-parity",
        expected: bVal,
        actualValues: [lVal, bVal],
        elementsCount: 2,
        message: `Line OEE (${lVal}%) differs from bottleneck machine OEE (${bVal}%)`,
      });
    }
  }

  // 4. Parity check between Machine Not Tagged Tab count and Machine Events Not Tagged counter
  const notTaggedTab = document.querySelector("[data-metric='unclassified-tab-count']") ||
    document.querySelector("[data-metric='not-tagged-tab-count']");
  const notTaggedEvents = document.querySelector("[data-metric='unclassified-count']") ||
    document.querySelector("[data-metric='not-tagged-count']");

  if (notTaggedTab && notTaggedEvents) {
    const tabVal = parseFloat(notTaggedTab.getAttribute("data-raw") || "");
    const evVal = parseFloat(notTaggedEvents.getAttribute("data-raw") || "");
    if (!isNaN(tabVal) && !isNaN(evVal) && tabVal !== evVal) {
      mismatches.push({
        key: "not-tagged-parity",
        expected: tabVal,
        actualValues: [tabVal, evVal],
        elementsCount: 2,
        message: `Loss Clarification tab count (${tabVal}) differs from Machine Events counter (${evVal})`,
      });
    }
  }

  if (mismatches.length > 0) {
    console.warn("[OEE Parity Audit] Found mismatches:", mismatches);
  } else {
    console.info(
      "[OEE Parity Audit] PASS — 0 mismatches found across",
      elements.length,
      "elements.",
    );
  }

  return mismatches;
}

if (typeof window !== "undefined") {
  window.runParityAudit = runParityAudit;
}

