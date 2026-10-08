/**
 * Metrics Engine & Live Telemetry Store for OEE Dashboard.
 *
 * Implements:
 * - Deterministic, single-source-of-truth OEE / Availability / Performance / Quality metrics hierarchy
 *   (Machine -> Line (Bottleneck) -> Zone -> Plant -> Group)
 * - Shared live tick subscription with background tab pause and instant visible recomputation
 * - Frozen bottleneck configuration per line
 * - Live dynamic PO progression accessor
 */

import { useEffect, useState, useSyncExternalStore } from "react";
import {
  PLANTS,
  getPlant,
  getZone,
  getLine,
  getMachine,
  type Plant,
  type Zone,
  type Line,
  type Machine,
} from "./data";
import { J2_LINES_CONFIG } from "./j2-layout-config";
import { makeRng, rand } from "./rng";
import { resolvePeriod, type ResolvedPeriod, type PeriodKey } from "./period";

/** Live tick interval in milliseconds for dashboard telemetry */
export const LIVE_TICK_MS = 5000;

/** Whether to simulate subtle drift (±0.1–0.3 pt) on closed past windows */
export const SIMULATE_DRIFT_ON_CLOSED_WINDOWS = true;

/** Whether to show comparison row on Line Detail Output card */
export const SHOW_COMPARISON_ON_OUTPUT_CARD = true;

/** Placeholder string when a line is idle/off with no running PO */
export const PO_IDLE_PLACEHOLDER = "-";

/**
 * Deterministic Bottleneck configuration by line across all plants.
 * Frozen at startup so bottleneck machine is stable.
 */
export const BOTTLENECK_BY_LINE: Record<string, string> = (() => {
  const map: Record<string, string> = {};

  // For Jatake 2 (J2): initialize from layout config
  for (const lineCfg of J2_LINES_CONFIG) {
    const key = `J2:${lineCfg.code}`;
    // Prefer culprit or filler/wrapper or first machine
    const firstMachine = lineCfg.machines[0]?.code ?? "LTF01";
    // Check if line has a specific designated bottleneck
    const filler = lineCfg.machines.find(
      (m) => m.code.startsWith("LTF") || m.code.startsWith("LFL"),
    );
    map[key] = filler?.code ?? firstMachine;
  }

  // For all other plants in registry (J1, J4, etc.)
  for (const plant of PLANTS) {
    if (plant.id === "J2" || !plant.isOperational || !plant.zones) continue;
    for (const zone of plant.zones) {
      for (const line of zone.lines) {
        const key = `${plant.id}:${line.id}`;
        const first = line.machines[0]?.id ?? `${line.id}-M1`;
        map[key] = line.bottleneck && line.bottleneck !== "-" ? line.bottleneck : first;
      }
    }
  }

  return map;
})();

/**
 * Retrieves the bottleneck machine code/ID for any plant and line.
 *
 * @param plantId - e.g. "J2", "J1", "J4"
 * @param lineId - e.g. "TUP01", "BOP02"
 */
export function getBottleneck(plantId: string, lineId: string): string {
  const key = `${plantId}:${lineId}`;
  if (BOTTLENECK_BY_LINE[key]) {
    return BOTTLENECK_BY_LINE[key];
  }
  const line =
    getLine(plantId, "A", lineId) || getLine(plantId, "B", lineId) || getLine(plantId, "C", lineId);
  return line?.machines[0]?.id ?? "M01";
}

/**
 * Accessor for the rated maximum run rate of a machine (in ppm).
 * Ensures consistency: Actual <= MachineMax and SkuStandard <= MachineMax.
 */
export function getMachineMaxRunRate(plantId: string, machineCode: string): number {
  if (machineCode.startsWith("LTF") || machineCode.startsWith("LTR")) {
    return 200;
  }
  if (
    machineCode.startsWith("LBF") ||
    machineCode.startsWith("LJF") ||
    machineCode.includes("RFL")
  ) {
    return 150;
  }
  if (machineCode.startsWith("LBC")) {
    return 160;
  }
  const seed = `${plantId}:${machineCode}:maxrate`;
  const rng = makeRng(seed);
  return Math.round(140 + rng() * 60);
}

/**
 * Accessor for the standard run rate of a SKU on a line (in ppm).
 */
export function getSkuStandardRunRate(plantId: string, lineId: string, sku?: string): number {
  const bottleneck = getBottleneck(plantId, lineId);
  const maxRate = getMachineMaxRunRate(plantId, bottleneck);
  const seed = `${plantId}:${lineId}:${sku || "default"}:skurate`;
  const rng = makeRng(seed);
  // Standard SKU rate is typically 80-92% of machine rated max
  return Math.min(maxRate, Math.round(maxRate * (0.8 + rng() * 0.12)));
}

/**
 * Accessor for the live actual run rate of a line (in ppm).
 * Consistent with latest line speed and never exceeds MachineMax.
 */
export function getActualRunRate(
  plantId: string,
  lineId: string,
  period: ResolvedPeriod | PeriodKey = "this-shift",
): number {
  const bottleneck = getBottleneck(plantId, lineId);
  const maxRate = getMachineMaxRunRate(plantId, bottleneck);
  const skuRate = getSkuStandardRunRate(plantId, lineId);
  const metrics = getMetrics(plantId, "line", lineId, period);

  // Derive actual run rate from performance and OEE telemetry
  const performanceRatio = metrics.performance / 100;
  const tick = globalTickCount;
  const seed = `${plantId}:${lineId}:actualrate`;
  const rng = makeRng(seed);
  const drift = Math.sin(tick * 0.3 + rng() * 5) * 3;

  const rawActual = Math.round(skuRate * performanceRatio + drift);
  return Math.min(maxRate, Math.max(0, rawActual));
}

/**
 * Accessor for the number of stops for a machine across the selected period.
 */
export function getMachineStopsCount(
  plantId: string,
  machineCode: string,
  period: ResolvedPeriod | PeriodKey = "this-shift",
): number {
  const resolved = typeof period === "string" ? resolvePeriod(period) : period;
  const seed = `${plantId}:${machineCode}:${resolved.periodKey}:stopscount`;
  const rng = makeRng(seed);

  let baseStops = 4;
  switch (resolved.periodKey) {
    case "this-shift":
      baseStops = Math.floor(2 + rng() * 3); // 2-4
      break;
    case "today":
      baseStops = Math.floor(6 + rng() * 4); // 6-9
      break;
    case "this-week":
      baseStops = Math.floor(16 + rng() * 8); // 16-23
      break;
    case "this-month":
      baseStops = Math.floor(40 + rng() * 18); // 40-57
      break;
    case "custom":
    case "custom-range" as unknown as PeriodKey: {
      const minutes = Math.max(
        5,
        Math.round((resolved.end.getTime() - resolved.start.getTime()) / (1000 * 60)),
      );
      const days = Math.max(0.1, minutes / (60 * 24));
      baseStops = Math.min(60, Math.max(2, Math.floor(days * (2 + rng() * 2))));
      break;
    }
  }

  return baseStops;
}

export type ActivePOInfo = {
  poNumber: string;
  batch: string;
  totalMPQ: number;
  currentOutput: number;
};

// Global simulated output tracker for live progress
const poProgressState: Record<string, { currentOutput: number; lastTick: number }> = {};

/**
 * Accessor for the active PO running on a line.
 * Returns null if the line is idle/off.
 *
 * @param plantId - e.g. "J2", "J1"
 * @param lineId - e.g. "TUP01"
 */
export function getActivePO(plantId: string, lineId: string): ActivePOInfo | null {
  const key = `${plantId}:${lineId}`;
  const seed = `${key}-po`;
  const rng = makeRng(seed);

  // Check line status
  const line =
    getLine(plantId, "A", lineId) || getLine(plantId, "B", lineId) || getLine(plantId, "C", lineId);

  if (line && line.status === "idle") {
    return null;
  }

  const poNum = Math.floor(41000 + rng() * 8999);
  const batchNum = Math.floor(2200 + rng() * 99);
  const totalMPQ = Math.floor(15000 + rng() * 6000);

  if (!poProgressState[key]) {
    const baseOutput = Math.floor(totalMPQ * (0.35 + rng() * 0.45));
    poProgressState[key] = { currentOutput: baseOutput, lastTick: Date.now() };
  }

  const state = poProgressState[key];
  return {
    poNumber: `PO-${poNum}`,
    batch: `B${batchNum}`,
    totalMPQ,
    currentOutput: Math.min(totalMPQ, state.currentOutput),
  };
}

/**
 * Advance running PO outputs on live tick
 */
function advancePoProgress() {
  for (const key in poProgressState) {
    const state = poProgressState[key];
    const add = Math.floor(Math.random() * 4 + 2);
    state.currentOutput += add;
    state.lastTick = Date.now();
  }
}

/* ------------------------------------------------------------------ LIVE TICK BUS */

type TickListener = () => void;
const listeners = new Set<TickListener>();
let globalTickCount = 0;
let tickTimer: number | null = null;
let isTabVisible = true;

function notifyTick() {
  globalTickCount++;
  advancePoProgress();
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // ignore
    }
  });
}

function startTickTimer() {
  if (typeof window === "undefined") return;
  if (tickTimer) return;
  tickTimer = window.setInterval(() => {
    if (isTabVisible) {
      notifyTick();
    }
  }, LIVE_TICK_MS);
}

function stopTickTimer() {
  if (tickTimer) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

// Setup visibility listener once
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    isTabVisible = !document.hidden;
    if (isTabVisible) {
      // Immediate recompute upon returning to tab
      notifyTick();
      startTickTimer();
    }
  });
  startTickTimer();
}

/**
 * Shared hook to subscribe to the live tick.
 * Returns the current tick count which increments every LIVE_TICK_MS.
 */
export function useLiveTick(): number {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => listeners.delete(onStoreChange);
    },
    () => globalTickCount,
    () => 0,
  );
}

/* ------------------------------------------------------------------ METRICS ENGINE */

export type EntityType = "plant" | "zone" | "line" | "machine" | "group";

export type EntityMetrics = {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  compareAvailability: number;
  comparePerformance: number;
  compareQuality: number;
  compareOee: number;
  deltaAvailability: number;
  deltaPerformance: number;
  deltaQuality: number;
  deltaOee: number;
  stopsCount?: number;
  speed?: number;
  runningMinutes?: number;
  outputActual?: number;
  outputTarget?: number;
  outputGood?: number;
  outputReject?: number;
  compareOutputActual?: number;
  deltaOutputActual?: number;
};

// Caching layer for fast hierarchical aggregation
const metricsCache = new Map<string, { metrics: EntityMetrics; expiry: number }>();

function clampPct(v: number) {
  return Math.min(99.9, Math.max(0, Math.round(v * 10) / 10));
}

function calcOee(a: number, p: number, q: number) {
  return clampPct((a * p * q) / 10000);
}

export const BASE_BUCKET_MINUTES = 5;

/**
 * Deterministic seeded baseline generator for a machine.
 * Base resolution = 5-minute buckets (BASE_BUCKET_MINUTES = 5), lazy and deterministic.
 */
function getRawMachineMetrics(
  plantId: string,
  lineId: string,
  machineId: string,
  periodKey: PeriodKey,
  isClosedPast: boolean,
  tick: number,
  resolvedPeriod?: ResolvedPeriod,
): EntityMetrics {
  const seed = `${plantId}-${lineId}-${machineId}-${periodKey}`;
  const r = makeRng(seed);

  let a = 82 + r() * 14;
  let p = 78 + r() * 18;
  let q = 96 + r() * 3.8;

  // Period-based variance
  if (periodKey === "this-week") {
    a += 1.2;
    p += 0.8;
  } else if (periodKey === "this-month") {
    a += 0.5;
    p += 1.4;
  } else if (periodKey === "custom" && resolvedPeriod) {
    // 5-minute bucket hash to create minute-precise deterministic shift
    const bucketStartMs = Math.floor(
      resolvedPeriod.start.getTime() / (BASE_BUCKET_MINUTES * 60 * 1000),
    );
    const bucketEndMs = Math.floor(
      resolvedPeriod.end.getTime() / (BASE_BUCKET_MINUTES * 60 * 1000),
    );
    const bucketSeed = `${seed}-${bucketStartMs}-${bucketEndMs}`;
    const bRng = makeRng(bucketSeed);
    a += bRng() * 2 - 1;
    p += bRng() * 2 - 1;
  }

  // Live drift
  if (!isClosedPast) {
    const liveDriftA = Math.sin(tick * 0.4 + r() * 10) * 0.4;
    const liveDriftP = Math.cos(tick * 0.3 + r() * 10) * 0.5;
    const liveDriftQ = Math.sin(tick * 0.2 + r() * 10) * 0.1;
    a += liveDriftA;
    p += liveDriftP;
    q += liveDriftQ;
  } else if (SIMULATE_DRIFT_ON_CLOSED_WINDOWS) {
    const closedDrift = Math.sin(tick * 0.1 + r() * 5) * 0.15;
    a += closedDrift;
    p += closedDrift * 0.8;
  }

  const availability = clampPct(a);
  const performance = clampPct(p);
  const quality = clampPct(q);
  const oee = calcOee(availability, performance, quality);

  // Compare window (fixed reference with deterministic delta)
  const cmpA = clampPct(availability - (r() * 2.8 - 1.2));
  const cmpP = clampPct(performance - (r() * 3.2 - 1.4));
  const cmpQ = clampPct(quality - (r() * 0.8 - 0.3));
  const cmpOee = calcOee(cmpA, cmpP, cmpQ);

  let stopsBase = 6;
  if (periodKey === "today") stopsBase = 18;
  else if (periodKey === "this-week") stopsBase = 32;
  else if (periodKey === "this-month") stopsBase = 52;
  else if (periodKey === "custom" && resolvedPeriod) {
    const hours = Math.max(
      1,
      (resolvedPeriod.end.getTime() - resolvedPeriod.start.getTime()) / (3600 * 1000),
    );
    stopsBase = Math.min(60, Math.max(2, Math.round(hours * 2.2)));
  } else if (periodKey === "custom-range") stopsBase = 28;

  const stopsCount = Math.max(1, Math.round(stopsBase + (r() * 4 - 2)));

  const outputTarget = 15000;
  const outputActual = Math.round(outputTarget * (oee / 100));
  const outputGood = Math.round(outputActual * (quality / 100));
  const outputReject = Math.max(0, outputActual - outputGood);
  const compareOutputActual = Math.round(outputTarget * (cmpOee / 100));
  const deltaOutputActual = outputActual - compareOutputActual;

  return {
    availability,
    performance,
    quality,
    oee,
    compareAvailability: cmpA,
    comparePerformance: cmpP,
    compareQuality: cmpQ,
    compareOee: cmpOee,
    deltaAvailability: clampPct(availability - cmpA),
    deltaPerformance: clampPct(performance - cmpP),
    deltaQuality: clampPct(quality - cmpQ),
    deltaOee: clampPct(oee - cmpOee),
    stopsCount,
    outputTarget,
    outputActual,
    outputGood,
    outputReject,
    compareOutputActual,
    deltaOutputActual,
  };
}

/**
 * Universal metrics engine function used across ALL pages and plants.
 * Ensures machine -> line (bottleneck) -> zone -> plant hierarchy consistency.
 *
 * @param plantId - e.g. "J2", "J1", "J4"
 * @param entityType - 'plant' | 'zone' | 'line' | 'machine' | 'group'
 * @param entityId - ID of entity (e.g. "A", "TUP01", "LTF01")
 * @param period - ResolvedPeriod object or PeriodKey
 */
export function getMetrics(
  plantId: string,
  entityType: EntityType,
  entityId: string = "",
  period: ResolvedPeriod | PeriodKey = "this-shift",
): EntityMetrics {
  const resolved = typeof period === "string" ? resolvePeriod(period) : period;
  const isPastClosed = resolved.isPastClosed;
  const tick = globalTickCount;

  const periodSubKey =
    resolved.periodKey === "custom"
      ? `custom:${resolved.start.getTime()}:${resolved.end.getTime()}`
      : resolved.periodKey;
  const cacheKey = `${plantId}:${entityType}:${entityId}:${periodSubKey}:${tick}`;
  const cached = metricsCache.get(cacheKey);
  if (cached && cached.expiry > Date.now()) {
    return cached.metrics;
  }

  let result: EntityMetrics;

  if (entityType === "machine") {
    // Determine lineId from entityId or context
    const parts = entityId.split(":");
    const lineId = parts[0] ?? "";
    const machineId = parts[1] ?? entityId;
    result = getRawMachineMetrics(
      plantId,
      lineId,
      machineId,
      resolved.periodKey,
      isPastClosed,
      tick,
      resolved,
    );
  } else if (entityType === "line") {
    const lineId = entityId;
    const bottleneckMachineId = getBottleneck(plantId, lineId);
    // Line metrics are strictly equal to bottleneck machine's metrics
    const bnMetrics = getRawMachineMetrics(
      plantId,
      lineId,
      bottleneckMachineId,
      resolved.periodKey,
      isPastClosed,
      tick,
      resolved,
    );

    const line =
      getLine(plantId, "A", lineId) ||
      getLine(plantId, "B", lineId) ||
      getLine(plantId, "C", lineId);

    const outputTarget = line?.outputTarget ?? 15000;
    const speed = line?.speed ?? 150;
    const runningMinutes = line?.runningMinutes ?? 320;
    const outputActual = Math.round(outputTarget * (bnMetrics.oee / 100));
    const outputGood = Math.round(outputActual * (bnMetrics.quality / 100));
    const outputReject = Math.max(0, outputActual - outputGood);
    const compareOutputActual = Math.round(outputTarget * (bnMetrics.compareOee / 100));
    const deltaOutputActual = outputActual - compareOutputActual;

    result = {
      ...bnMetrics,
      speed,
      runningMinutes,
      outputActual,
      outputTarget,
      outputGood,
      outputReject,
      compareOutputActual,
      deltaOutputActual,
    };
  } else if (entityType === "zone") {
    const zoneId = entityId;
    const zone = getZone(plantId, zoneId);
    const lines = zone?.lines ?? [];

    if (lines.length === 0) {
      result = getRawMachineMetrics(
        plantId,
        zoneId,
        "dummy",
        resolved.periodKey,
        isPastClosed,
        tick,
      );
    } else {
      let sumA = 0;
      let sumP = 0;
      let sumQ = 0;
      let sumOee = 0;
      let sumCmpA = 0;
      let sumCmpP = 0;
      let sumCmpQ = 0;
      let sumCmpOee = 0;

      for (const l of lines) {
        const lineM = getMetrics(plantId, "line", l.id, resolved);
        sumA += lineM.availability;
        sumP += lineM.performance;
        sumQ += lineM.quality;
        sumOee += lineM.oee;
        sumCmpA += lineM.compareAvailability;
        sumCmpP += lineM.comparePerformance;
        sumCmpQ += lineM.compareQuality;
        sumCmpOee += lineM.compareOee;
      }

      const count = lines.length;
      const a = clampPct(sumA / count);
      const p = clampPct(sumP / count);
      const q = clampPct(sumQ / count);
      const oee = clampPct(sumOee / count);

      const cmpA = clampPct(sumCmpA / count);
      const cmpP = clampPct(sumCmpP / count);
      const cmpQ = clampPct(sumCmpQ / count);
      const cmpOee = clampPct(sumCmpOee / count);

      result = {
        availability: a,
        performance: p,
        quality: q,
        oee,
        compareAvailability: cmpA,
        comparePerformance: cmpP,
        compareQuality: cmpQ,
        compareOee: cmpOee,
        deltaAvailability: clampPct(a - cmpA),
        deltaPerformance: clampPct(p - cmpP),
        deltaQuality: clampPct(q - cmpQ),
        deltaOee: clampPct(oee - cmpOee),
      };
    }
  } else if (entityType === "plant") {
    const plant = getPlant(plantId);
    const zones = plant?.zones ?? [];

    if (zones.length === 0) {
      result = getRawMachineMetrics(
        plantId,
        "dummy",
        "dummy",
        resolved.periodKey,
        isPastClosed,
        tick,
      );
    } else {
      const targetPlant = getPlant(plantId);
      if (targetPlant && (!targetPlant.isOperational || !zones?.length)) {
        result = {
          availability: 0,
          performance: 0,
          quality: 0,
          oee: 0,
          compareAvailability: 0,
          comparePerformance: 0,
          compareQuality: 0,
          compareOee: 0,
          deltaAvailability: 0,
          deltaPerformance: 0,
          deltaQuality: 0,
          deltaOee: 0,
        };
      } else {
        let sumA = 0;
        let sumP = 0;
        let sumQ = 0;
        let sumOee = 0;
        let sumCmpA = 0;
        let sumCmpP = 0;
        let sumCmpQ = 0;
        let sumCmpOee = 0;

        for (const z of zones) {
          const zoneM = getMetrics(plantId, "zone", z.id, resolved);
          sumA += zoneM.availability;
          sumP += zoneM.performance;
          sumQ += zoneM.quality;
          sumOee += zoneM.oee;
          sumCmpA += zoneM.compareAvailability;
          sumCmpP += zoneM.comparePerformance;
          sumCmpQ += zoneM.compareQuality;
          sumCmpOee += zoneM.compareOee;
        }

        const count = zones.length || 1;
        const a = clampPct(sumA / count);
        const p = clampPct(sumP / count);
        const q = clampPct(sumQ / count);
        const oee = clampPct(sumOee / count);

        const cmpA = clampPct(sumCmpA / count);
        const cmpP = clampPct(sumCmpP / count);
        const cmpQ = clampPct(sumCmpQ / count);
        const cmpOee = clampPct(sumCmpOee / count);

        result = {
          availability: a,
          performance: p,
          quality: q,
          oee,
          compareAvailability: cmpA,
          comparePerformance: cmpP,
          compareQuality: cmpQ,
          compareOee: cmpOee,
          deltaAvailability: clampPct(a - cmpA),
          deltaPerformance: clampPct(p - cmpP),
          deltaQuality: clampPct(q - cmpQ),
          deltaOee: clampPct(oee - cmpOee),
        };
      }
    }
  } else {
    // Group
    let sumA = 0;
    let sumP = 0;
    let sumQ = 0;
    let sumOee = 0;
    let sumCmpA = 0;
    let sumCmpP = 0;
    let sumCmpQ = 0;
    let sumCmpOee = 0;

    const operationalPlants = PLANTS.filter((p) => p.isOperational);
    for (const p of operationalPlants) {
      const plantM = getMetrics(p.id, "plant", p.id, resolved);
      sumA += plantM.availability;
      sumP += plantM.performance;
      sumQ += plantM.quality;
      sumOee += plantM.oee;
      sumCmpA += plantM.compareAvailability;
      sumCmpP += plantM.comparePerformance;
      sumCmpQ += plantM.compareQuality;
      sumCmpOee += plantM.compareOee;
    }

    const count = operationalPlants.length || 1;
    const a = clampPct(sumA / count);
    const p = clampPct(sumP / count);
    const q = clampPct(sumQ / count);
    const oee = clampPct(sumOee / count);

    const cmpA = clampPct(sumCmpA / count);
    const cmpP = clampPct(sumCmpP / count);
    const cmpQ = clampPct(sumCmpQ / count);
    const cmpOee = clampPct(sumCmpOee / count);

    result = {
      availability: a,
      performance: p,
      quality: q,
      oee,
      compareAvailability: cmpA,
      comparePerformance: cmpP,
      compareQuality: cmpQ,
      compareOee: cmpOee,
      deltaAvailability: clampPct(a - cmpA),
      deltaPerformance: clampPct(p - cmpP),
      deltaQuality: clampPct(q - cmpQ),
      deltaOee: clampPct(oee - cmpOee),
    };
  }

  metricsCache.set(cacheKey, { metrics: result, expiry: Date.now() + 4000 });
  return result;
}
