import { useEffect, useMemo, useState } from "react";

import { GROUP, PLANTS, getLine, getMachine, getPlant, type Line } from "./data";
import type { PeriodId } from "./filters";
import { rand } from "./rng";
import type { Status } from "./config";

const LIVE_REFRESH_MS = 30_000;
const FLASH_MS = 1_200;

export type LiveMetrics = {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

export type MetricDeltas = {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

function clampPercentage(value: number) {
  return Math.min(99.9, Math.max(0, Math.round(value * 10) / 10));
}

function nextStatus(status: Status, seed: string): Status {
  const roll = rand(seed, 0, 1, 3);
  if (status === "running") return roll < 0.7 ? "slow" : "down";
  if (status === "slow") return roll < 0.65 ? "running" : "down";
  if (status === "down") return roll < 0.65 ? "slow" : "running";
  return roll < 0.7 ? "running" : "slow";
}

/**
 * Real-time live clock that ticks continuously every second when period is "live".
 * Avoids SSR hydration mismatch by only enabling client ticking after mount.
 */
export function useLiveClock(period: PeriodId): string | null {
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    let isMounted = true;
    setMounted(true);
    setNow(new Date());
    if (period !== "live") return;
    const timer = window.setInterval(() => {
      if (isMounted) {
        setNow(new Date());
      }
    }, 1_000);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
    };
  }, [period]);

  if (period !== "live") return "Static snapshot";
  if (!mounted || !now) return null;

  const day = String(now.getDate()).padStart(2, "0");
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const month = months[now.getMonth()];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  return `${day}-${month} ${hh}:${mm}:${ss}`;
}

/**
 * Dynamic comparison context text for '% Difference' indicators.
 * - 'live' => "Compared to 30s ago"
 * - 'today' => "Compared to yesterday"
 * - 'this-week' => "Compared to last week"
 */
export function comparisonContext(period: PeriodId): string {
  switch (period) {
    case "live":
      return "Compared to 30s ago";
    case "today":
      return "Compared to yesterday";
    case "this-week":
      return "Compared to last week";
    case "yesterday":
      return "Compared to day before";
    case "last-week":
      return "Compared to previous week";
    case "last-shift":
      return "Compared to previous shift";
    default:
      return "Compared to previous period";
  }
}

/**
 * Baseline static deltas for non-live periods
 */
export function getStaticMetricDeltas(period: PeriodId, seed: string = "default"): MetricDeltas {
  const hash = Array.from(seed).reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const mod = (offset: number) => (((hash + offset) % 7) - 3) / 10;

  switch (period) {
    case "today":
      return {
        oee: +(0.6 + mod(1)).toFixed(1),
        availability: +(1.2 + mod(2)).toFixed(1),
        performance: +(-0.8 + mod(3)).toFixed(1),
        quality: +(0.3 + mod(4)).toFixed(1),
      };
    case "this-week":
      return {
        oee: +(2.4 + mod(2)).toFixed(1),
        availability: +(1.8 + mod(3)).toFixed(1),
        performance: +(1.1 + mod(4)).toFixed(1),
        quality: +(-0.2 + mod(5)).toFixed(1),
      };
    case "yesterday":
      return {
        oee: +(-0.4 + mod(1)).toFixed(1),
        availability: +(-0.6 + mod(2)).toFixed(1),
        performance: +(0.4 + mod(3)).toFixed(1),
        quality: +(0.1 + mod(4)).toFixed(1),
      };
    case "last-week":
      return {
        oee: +(-1.3 + mod(2)).toFixed(1),
        availability: +(-1.1 + mod(3)).toFixed(1),
        performance: +(-0.5 + mod(4)).toFixed(1),
        quality: +(0.2 + mod(5)).toFixed(1),
      };
    case "last-shift":
      return {
        oee: +(0.5 + mod(1)).toFixed(1),
        availability: +(0.7 + mod(2)).toFixed(1),
        performance: +(-0.3 + mod(3)).toFixed(1),
        quality: +(0.1 + mod(4)).toFixed(1),
      };
    default:
      return {
        oee: +(0.4 + mod(1)).toFixed(1),
        availability: +(0.5 + mod(2)).toFixed(1),
        performance: +(-0.2 + mod(3)).toFixed(1),
        quality: +(0.1 + mod(4)).toFixed(1),
      };
  }
}

/**
 * LEVEL 1: Group Site Map (Multi-Plant View)
 * Context-aware 30s data polling for Plant-level metrics and Group aggregate.
 */
export function useLiveGroupState(period: PeriodId) {
  const initialPlants = useMemo(() => {
    const map: Record<
      string,
      { oee: number; availability: number; performance: number; quality: number }
    > = {};
    for (const p of PLANTS) {
      map[p.id] = {
        oee: p.oee,
        availability: p.availability,
        performance: p.performance,
        quality: p.quality,
      };
    }
    return map;
  }, []);

  const [group, setGroup] = useState<LiveMetrics>({
    oee: GROUP.oee,
    availability: GROUP.availability,
    performance: GROUP.performance,
    quality: GROUP.quality,
  });
  const [prevGroup, setPrevGroup] = useState<LiveMetrics>(() => ({
    oee: clampPercentage(GROUP.oee - 0.3),
    availability: clampPercentage(GROUP.availability - 0.4),
    performance: clampPercentage(GROUP.performance + 0.2),
    quality: clampPercentage(GROUP.quality - 0.1),
  }));

  const [plants, setPlants] = useState(initialPlants);
  const [prevPlants, setPrevPlants] = useState(() => {
    const map: Record<
      string,
      { oee: number; availability: number; performance: number; quality: number }
    > = {};
    for (const p of PLANTS) {
      map[p.id] = {
        oee: clampPercentage(p.oee - 0.4),
        availability: clampPercentage(p.availability - 0.3),
        performance: clampPercentage(p.performance + 0.2),
        quality: clampPercentage(p.quality - 0.1),
      };
    }
    return map;
  });

  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setGroup({
      oee: GROUP.oee,
      availability: GROUP.availability,
      performance: GROUP.performance,
      quality: GROUP.quality,
    });
    setPlants(initialPlants);
    setIsUpdating(false);
  }, [initialPlants, period]);

  useEffect(() => {
    if (period !== "live") return;

    let isMounted = true;
    let flashTimer: number | undefined;

    const refresh = () => {
      if (!isMounted) return;

      setGroup((currentGroup) => {
        setPrevGroup(currentGroup);
        return currentGroup;
      });

      setPlants((currentPlants) => {
        setPrevPlants(currentPlants);

        const nextPlants: Record<
          string,
          { oee: number; availability: number; performance: number; quality: number }
        > = {};
        let totalOee = 0;
        let totalA = 0;
        let totalP = 0;
        let totalQ = 0;

        for (const p of PLANTS) {
          const jitterA = Math.random() * 1.4 - 0.7;
          const jitterP = Math.random() * 1.6 - 0.8;
          const jitterQ = Math.random() * 0.4 - 0.2;

          const availability = clampPercentage(p.availability + jitterA);
          const performance = clampPercentage(p.performance + jitterP);
          const quality = clampPercentage(p.quality + jitterQ);
          const oee = clampPercentage((availability * performance * quality) / 10_000);

          nextPlants[p.id] = { oee, availability, performance, quality };
          totalOee += oee;
          totalA += availability;
          totalP += performance;
          totalQ += quality;
        }

        const count = PLANTS.length || 1;
        setGroup({
          oee: clampPercentage(totalOee / count),
          availability: clampPercentage(totalA / count),
          performance: clampPercentage(totalP / count),
          quality: clampPercentage(totalQ / count),
        });

        return nextPlants;
      });

      if (isMounted) {
        setIsUpdating(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          if (isMounted) setIsUpdating(false);
        }, FLASH_MS);
      }
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [period]);

  const staticDeltas = useMemo(() => getStaticMetricDeltas(period, "group"), [period]);

  const groupDeltas = useMemo<MetricDeltas>(() => {
    if (period === "live") {
      return {
        oee: +(group.oee - prevGroup.oee).toFixed(1),
        availability: +(group.availability - prevGroup.availability).toFixed(1),
        performance: +(group.performance - prevGroup.performance).toFixed(1),
        quality: +(group.quality - prevGroup.quality).toFixed(1),
      };
    }
    return staticDeltas;
  }, [group, prevGroup, period, staticDeltas]);

  const plantDeltas = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of PLANTS) {
      if (period === "live") {
        const current = plants[p.id]?.oee ?? p.oee;
        const prev = prevPlants[p.id]?.oee ?? p.oee;
        map[p.id] = +(current - prev).toFixed(1);
      } else {
        map[p.id] = getStaticMetricDeltas(period, p.id).oee;
      }
    }
    return map;
  }, [period, plants, prevPlants]);

  return {
    group,
    plants,
    groupDeltas,
    plantDeltas,
    isUpdating,
  };
}

/**
 * LEVEL 2: Plant View (Zone Map)
 * Context-aware 30s data polling for Plant-level metrics and Zone-level metrics.
 */
export function useLivePlantState(period: PeriodId, plantId: string) {
  const basePlant = useMemo(() => getPlant(plantId), [plantId]);

  const initialZones = useMemo(() => {
    const map: Record<
      string,
      {
        name: string;
        lines: Line[];
        oee: number;
        availability: number;
        performance: number;
        quality: number;
      }
    > = {};
    if (basePlant) {
      for (const z of basePlant.zones) {
        map[z.id] = {
          name: z.name,
          lines: z.lines,
          oee: z.oee,
          availability: z.availability,
          performance: z.performance,
          quality: z.quality,
        };
      }
    }
    return map;
  }, [basePlant]);

  const [plant, setPlant] = useState<LiveMetrics>(() => ({
    oee: basePlant?.oee ?? 75,
    availability: basePlant?.availability ?? 85,
    performance: basePlant?.performance ?? 85,
    quality: basePlant?.quality ?? 95,
  }));

  const [prevPlant, setPrevPlant] = useState<LiveMetrics>(() => ({
    oee: clampPercentage((basePlant?.oee ?? 75) - 0.4),
    availability: clampPercentage((basePlant?.availability ?? 85) - 0.5),
    performance: clampPercentage((basePlant?.performance ?? 85) + 0.3),
    quality: clampPercentage((basePlant?.quality ?? 95) - 0.1),
  }));

  const [zones, setZones] = useState(initialZones);
  const [prevZones, setPrevZones] = useState(() => {
    const map: Record<
      string,
      {
        name: string;
        lines: Line[];
        oee: number;
        availability: number;
        performance: number;
        quality: number;
      }
    > = {};
    if (basePlant) {
      for (const z of basePlant.zones) {
        map[z.id] = {
          name: z.name,
          lines: z.lines,
          oee: clampPercentage(z.oee - 0.5),
          availability: clampPercentage(z.availability - 0.4),
          performance: clampPercentage(z.performance + 0.3),
          quality: clampPercentage(z.quality - 0.1),
        };
      }
    }
    return map;
  });

  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!basePlant) return;
    setPlant({
      oee: basePlant.oee,
      availability: basePlant.availability,
      performance: basePlant.performance,
      quality: basePlant.quality,
    });
    setZones(initialZones);
    setIsUpdating(false);
  }, [basePlant, initialZones, period]);

  useEffect(() => {
    if (period !== "live" || !basePlant) return;

    let isMounted = true;
    let flashTimer: number | undefined;

    const refresh = () => {
      if (!isMounted) return;

      setPlant((currPlant) => {
        setPrevPlant(currPlant);
        return currPlant;
      });

      setZones((currZones) => {
        setPrevZones(currZones);

        const nextZones: Record<
          string,
          {
            name: string;
            lines: Line[];
            oee: number;
            availability: number;
            performance: number;
            quality: number;
          }
        > = {};
        let totalOee = 0;
        let totalA = 0;
        let totalP = 0;
        let totalQ = 0;

        for (const z of basePlant.zones) {
          const jitterA = Math.random() * 1.5 - 0.75;
          const jitterP = Math.random() * 1.6 - 0.8;
          const jitterQ = Math.random() * 0.4 - 0.2;

          const availability = clampPercentage(z.availability + jitterA);
          const performance = clampPercentage(z.performance + jitterP);
          const quality = clampPercentage(z.quality + jitterQ);
          const oee = clampPercentage((availability * performance * quality) / 10_000);

          nextZones[z.id] = {
            name: z.name,
            lines: z.lines,
            oee,
            availability,
            performance,
            quality,
          };
          totalOee += oee;
          totalA += availability;
          totalP += performance;
          totalQ += quality;
        }

        const count = basePlant.zones.length || 1;
        setPlant({
          oee: clampPercentage(totalOee / count),
          availability: clampPercentage(totalA / count),
          performance: clampPercentage(totalP / count),
          quality: clampPercentage(totalQ / count),
        });

        return nextZones;
      });

      if (isMounted) {
        setIsUpdating(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          if (isMounted) setIsUpdating(false);
        }, FLASH_MS);
      }
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [basePlant, period]);

  const staticDeltas = useMemo(() => getStaticMetricDeltas(period, plantId), [period, plantId]);

  const plantDeltas = useMemo<MetricDeltas>(() => {
    if (period === "live") {
      return {
        oee: +(plant.oee - prevPlant.oee).toFixed(1),
        availability: +(plant.availability - prevPlant.availability).toFixed(1),
        performance: +(plant.performance - prevPlant.performance).toFixed(1),
        quality: +(plant.quality - prevPlant.quality).toFixed(1),
      };
    }
    return staticDeltas;
  }, [plant, prevPlant, period, staticDeltas]);

  const zoneDeltas = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    if (basePlant) {
      for (const z of basePlant.zones) {
        if (period === "live") {
          const current = zones[z.id]?.oee ?? z.oee;
          const prev = prevZones[z.id]?.oee ?? z.oee;
          map[z.id] = +(current - prev).toFixed(1);
        } else {
          map[z.id] = getStaticMetricDeltas(period, `${plantId}-${z.id}`).oee;
        }
      }
    }
    return map;
  }, [basePlant, period, plantId, prevZones, zones]);

  return {
    plant,
    zones,
    plantDeltas,
    zoneDeltas,
    isUpdating,
  };
}

/**
 * Live zone state with:
 * 1. 30-second polling cycle in 'live' mode with realistic fluctuations
 * 2. Subtle UI updating flash trigger
 * 3. Dynamic delta metrics based on selected period
 */
export function useLiveZoneState(
  period: PeriodId,
  zoneId: string,
  base: Omit<LiveMetrics, "oee">,
  lines: Line[],
) {
  const {
    availability: baseAvailability,
    performance: basePerformance,
    quality: baseQuality,
  } = base;

  const baseMetrics = useMemo(
    () => ({
      availability: baseAvailability,
      performance: basePerformance,
      quality: baseQuality,
      oee: clampPercentage((baseAvailability * basePerformance * baseQuality) / 10_000),
    }),
    [baseAvailability, basePerformance, baseQuality],
  );

  // Realistic baseline deltas when viewing historical/static periods
  const staticDeltas = useMemo<MetricDeltas>(() => {
    switch (period) {
      case "today":
        return { availability: 1.2, performance: -0.8, quality: 0.3, oee: 0.6 };
      case "this-week":
        return { availability: 2.4, performance: 1.1, quality: -0.2, oee: 2.8 };
      case "yesterday":
        return { availability: -0.6, performance: 0.4, quality: 0.1, oee: -0.2 };
      case "last-week":
        return { availability: -1.1, performance: -0.5, quality: 0.2, oee: -1.3 };
      case "last-shift":
        return { availability: 0.7, performance: -0.3, quality: 0.1, oee: 0.5 };
      default:
        return { availability: 0.5, performance: -0.2, quality: 0.1, oee: 0.4 };
    }
  }, [period]);

  // For live mode, initialize previous metrics with realistic 30s-ago offsets
  const initialLivePrevious = useMemo(
    () => ({
      availability: clampPercentage(baseAvailability - 0.4),
      performance: clampPercentage(basePerformance + 0.3),
      quality: clampPercentage(baseQuality - 0.1),
      oee: clampPercentage(
        ((baseAvailability - 0.4) * (basePerformance + 0.3) * (baseQuality - 0.1)) / 10_000,
      ),
    }),
    [baseAvailability, basePerformance, baseQuality],
  );

  const [metrics, setMetrics] = useState<LiveMetrics>(baseMetrics);
  const [previousMetrics, setPreviousMetrics] = useState<LiveMetrics>(
    period === "live" ? initialLivePrevious : baseMetrics,
  );
  const [lineStatuses, setLineStatuses] = useState<Record<string, Status>>({});
  const [machineStatuses, setMachineStatuses] = useState<Record<string, Status>>({});
  const [refreshCount, setRefreshCount] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setMetrics(baseMetrics);
    setPreviousMetrics(period === "live" ? initialLivePrevious : baseMetrics);
    setLineStatuses({});
    setMachineStatuses({});
    setRefreshCount(0);
    setIsUpdating(false);
  }, [baseMetrics, initialLivePrevious, period, zoneId]);

  // Live polling cycle: triggers every 30 seconds
  useEffect(() => {
    if (period !== "live") return;

    let isMounted = true;
    let flashTimer: number | undefined;

    const refresh = () => {
      if (!isMounted) return;

      setRefreshCount((current) => {
        const next = current + 1;

        setMetrics((currentMetrics) => {
          setPreviousMetrics(currentMetrics);

          const jitterA = Math.random() * 1.6 - 0.8;
          const jitterP = Math.random() * 1.8 - 0.9;
          const jitterQ = Math.random() * 0.6 - 0.3;

          const availability = clampPercentage(baseAvailability + jitterA);
          const performance = clampPercentage(basePerformance + jitterP);
          const quality = clampPercentage(baseQuality + jitterQ);
          const oee = clampPercentage((availability * performance * quality) / 10_000);

          return { availability, performance, quality, oee };
        });

        if (lines.length > 0 && Math.random() < 0.4) {
          const lineIndex = Math.floor(Math.random() * lines.length);
          const line = lines[lineIndex];
          if (line) {
            setLineStatuses((currentStatuses) => {
              const status = nextStatus(
                currentStatuses[line.id] ?? line.status,
                `${zoneId}-${line.id}-${next}-${Date.now()}`,
              );
              return { ...currentStatuses, [line.id]: status };
            });

            const machine = line.machines[0];
            if (machine) {
              setMachineStatuses((currentStatuses) => ({
                ...currentStatuses,
                [`${line.id}:${machine.id}`]: nextStatus(
                  currentStatuses[`${line.id}:${machine.id}`] ?? machine.status,
                  `${zoneId}-${line.id}-${machine.id}-${next}-${Date.now()}`,
                ),
              }));
            }
          }
        }

        if (isMounted) {
          setIsUpdating(true);
          if (flashTimer) window.clearTimeout(flashTimer);
          flashTimer = window.setTimeout(() => {
            if (isMounted) setIsUpdating(false);
          }, FLASH_MS);
        }

        return next;
      });
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [baseAvailability, basePerformance, baseQuality, lines, period, zoneId]);

  // Compute percentage differences
  const deltas = useMemo<MetricDeltas>(() => {
    if (period === "live") {
      return {
        availability: Math.round((metrics.availability - previousMetrics.availability) * 10) / 10,
        performance: Math.round((metrics.performance - previousMetrics.performance) * 10) / 10,
        quality: Math.round((metrics.quality - previousMetrics.quality) * 10) / 10,
        oee: Math.round((metrics.oee - previousMetrics.oee) * 10) / 10,
      };
    }
    return staticDeltas;
  }, [metrics, previousMetrics, period, staticDeltas]);

  return {
    metrics,
    previousMetrics,
    deltas,
    lineStatuses,
    machineStatuses,
    refreshCount,
    isUpdating,
  };
}

/**
 * LEVEL 4: Line Detail Page
 * Context-aware 30s data polling for Line-level metrics (OEE, Performance, Speed, Output Actual, etc.)
 */
export function useLiveLineState(
  period: PeriodId,
  plantId: string,
  zoneId: string,
  lineId: string,
) {
  const baseLine = useMemo(() => getLine(plantId, zoneId, lineId), [plantId, zoneId, lineId]);

  const [line, setLine] = useState(() => {
    const availability = baseLine?.availability ?? 85;
    const performance = baseLine?.performance ?? 85;
    const quality = baseLine?.quality ?? 98;
    const oee = clampPercentage((availability * performance * quality) / 10_000);
    return {
      oee,
      availability,
      performance,
      quality,
      speed: baseLine?.speed ?? 120,
      outputActual: baseLine?.outputActual ?? 12000,
      runningMinutes: baseLine?.runningMinutes ?? 240,
      status: baseLine?.status ?? "running",
    };
  });

  const [prevLine, setPrevLine] = useState(() => {
    const a = clampPercentage((baseLine?.availability ?? 85) - 0.4);
    const p = clampPercentage((baseLine?.performance ?? 85) + 0.3);
    const q = clampPercentage((baseLine?.quality ?? 98) - 0.1);
    const oee = clampPercentage((a * p * q) / 10_000);
    return {
      oee,
      availability: a,
      performance: p,
      quality: q,
      speed: (baseLine?.speed ?? 120) - 2,
      outputActual: (baseLine?.outputActual ?? 12000) - 6,
      runningMinutes: (baseLine?.runningMinutes ?? 240) - 1,
      status: baseLine?.status ?? "running",
    };
  });

  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!baseLine) return;
    const availability = baseLine.availability;
    const performance = baseLine.performance;
    const quality = baseLine.quality;
    const oee = clampPercentage((availability * performance * quality) / 10_000);
    setLine({
      oee,
      availability,
      performance,
      quality,
      speed: baseLine.speed,
      outputActual: baseLine.outputActual,
      runningMinutes: baseLine.runningMinutes,
      status: baseLine.status,
    });
    setIsUpdating(false);
  }, [baseLine, period]);

  useEffect(() => {
    if (period !== "live" || !baseLine) return;

    let isMounted = true;
    let flashTimer: number | undefined;

    const refresh = () => {
      if (!isMounted) return;

      setLine((curr) => {
        setPrevLine(curr);

        const jitterA = Math.random() * 1.4 - 0.7;
        const jitterP = Math.random() * 1.6 - 0.8;
        const jitterQ = Math.random() * 0.4 - 0.2;
        const jitterSpeed = Math.floor(Math.random() * 7 - 3);
        const unitsProduced = Math.floor(Math.random() * 6 + 4);

        const availability = clampPercentage(baseLine.availability + jitterA);
        const performance = clampPercentage(baseLine.performance + jitterP);
        const quality = clampPercentage(baseLine.quality + jitterQ);
        const oee = clampPercentage((availability * performance * quality) / 10_000);

        return {
          oee,
          availability,
          performance,
          quality,
          speed: Math.max(0, baseLine.speed + jitterSpeed),
          outputActual: curr.outputActual + unitsProduced,
          runningMinutes: curr.runningMinutes + 0.5,
          status: curr.status,
        };
      });

      if (isMounted) {
        setIsUpdating(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          if (isMounted) setIsUpdating(false);
        }, FLASH_MS);
      }
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [baseLine, period]);

  const staticDeltas = useMemo(
    () => getStaticMetricDeltas(period, `${plantId}-${zoneId}-${lineId}`),
    [period, plantId, zoneId, lineId],
  );

  const deltas = useMemo(() => {
    if (period === "live") {
      return {
        oee: +(line.oee - prevLine.oee).toFixed(1),
        availability: +(line.availability - prevLine.availability).toFixed(1),
        performance: +(line.performance - prevLine.performance).toFixed(1),
        quality: +(line.quality - prevLine.quality).toFixed(1),
        speed: +(line.speed - prevLine.speed).toFixed(1),
      };
    }
    return {
      oee: staticDeltas.oee,
      availability: staticDeltas.availability,
      performance: staticDeltas.performance,
      quality: staticDeltas.quality,
      speed: 1.5,
    };
  }, [line, prevLine, period, staticDeltas]);

  return {
    line,
    deltas,
    isUpdating,
  };
}

/**
 * LEVEL 5: Machine Detail Page
 * Context-aware 30s data polling for Machine-level metrics and Sensor readings.
 */
export function useLiveMachineState(
  period: PeriodId,
  plantId: string,
  zoneId: string,
  lineId: string,
  machineId: string,
) {
  const baseMachine = useMemo(
    () => getMachine(plantId, zoneId, lineId, machineId),
    [plantId, zoneId, lineId, machineId],
  );

  const [machine, setMachine] = useState<LiveMetrics>(() => ({
    oee: baseMachine?.oee ?? 75,
    availability: baseMachine?.availability ?? 85,
    performance: baseMachine?.performance ?? 85,
    quality: baseMachine?.quality ?? 98,
  }));

  const [prevMachine, setPrevMachine] = useState<LiveMetrics>(() => ({
    oee: clampPercentage((baseMachine?.oee ?? 75) - 0.4),
    availability: clampPercentage((baseMachine?.availability ?? 85) - 0.5),
    performance: clampPercentage((baseMachine?.performance ?? 85) + 0.3),
    quality: clampPercentage((baseMachine?.quality ?? 98) - 0.1),
  }));

  const [sensors, setSensors] = useState(() => baseMachine?.sensors ?? []);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (!baseMachine) return;
    setMachine({
      oee: baseMachine.oee,
      availability: baseMachine.availability,
      performance: baseMachine.performance,
      quality: baseMachine.quality,
    });
    setSensors(baseMachine.sensors);
    setIsUpdating(false);
  }, [baseMachine, period]);

  useEffect(() => {
    if (period !== "live" || !baseMachine) return;

    let isMounted = true;
    let flashTimer: number | undefined;

    const refresh = () => {
      if (!isMounted) return;

      setMachine((currMachine) => {
        setPrevMachine(currMachine);

        const jitterA = Math.random() * 1.4 - 0.7;
        const jitterP = Math.random() * 1.6 - 0.8;
        const jitterQ = Math.random() * 0.4 - 0.2;

        const availability = clampPercentage(baseMachine.availability + jitterA);
        const performance = clampPercentage(baseMachine.performance + jitterP);
        const quality = clampPercentage(baseMachine.quality + jitterQ);
        const oee = clampPercentage((availability * performance * quality) / 10_000);

        return { oee, availability, performance, quality };
      });

      setSensors((currentSensors) =>
        currentSensors.map((s) => {
          let jitter = 0;
          if (s.unit === "°C") jitter = Math.round((Math.random() * 1.2 - 0.6) * 10) / 10;
          else if (s.unit === "mm/s") jitter = Math.round((Math.random() * 0.2 - 0.1) * 10) / 10;
          else if (s.unit === "bar") jitter = Math.round((Math.random() * 0.1 - 0.05) * 10) / 10;
          else if (s.unit === "ppm") jitter = Math.floor(Math.random() * 5 - 2);

          const nextVal = +(s.value + jitter).toFixed(1);
          return {
            ...s,
            value: nextVal,
            warn: s.limit !== undefined ? nextVal > s.limit : false,
          };
        }),
      );

      if (isMounted) {
        setIsUpdating(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => {
          if (isMounted) setIsUpdating(false);
        }, FLASH_MS);
      }
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      isMounted = false;
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [baseMachine, period]);

  const staticDeltas = useMemo(
    () => getStaticMetricDeltas(period, `${plantId}-${zoneId}-${lineId}-${machineId}`),
    [period, plantId, zoneId, lineId, machineId],
  );

  const deltas = useMemo<MetricDeltas>(() => {
    if (period === "live") {
      return {
        oee: +(machine.oee - prevMachine.oee).toFixed(1),
        availability: +(machine.availability - prevMachine.availability).toFixed(1),
        performance: +(machine.performance - prevMachine.performance).toFixed(1),
        quality: +(machine.quality - prevMachine.quality).toFixed(1),
      };
    }
    return staticDeltas;
  }, [machine, prevMachine, period, staticDeltas]);

  return {
    machine,
    sensors,
    deltas,
    isUpdating,
  };
}
