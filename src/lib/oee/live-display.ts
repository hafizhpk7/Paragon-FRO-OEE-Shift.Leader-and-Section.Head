import { useEffect, useMemo, useState } from "react";

import type { Line } from "./data";
import type { PeriodId } from "./filters";
import { rand } from "./rng";
import type { Status } from "./config";

const LIVE_REFRESH_MS = 30_000;
const FLASH_MS = 900;

type LiveMetrics = {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
};

function clampPercentage(value: number) {
  return Math.min(99.9, Math.max(0, Math.round(value * 10) / 10));
}

function metricsFrom(base: Omit<LiveMetrics, "oee">, seed: string): LiveMetrics {
  const availability = clampPercentage(base.availability + rand(`${seed}-a`, -0.7, 0.7, 1));
  const performance = clampPercentage(base.performance + rand(`${seed}-p`, -0.8, 0.8, 1));
  const quality = clampPercentage(base.quality + rand(`${seed}-q`, -0.25, 0.25, 1));
  return {
    availability,
    performance,
    quality,
    oee: clampPercentage((availability * performance * quality) / 10_000),
  };
}

function nextStatus(status: Status, seed: string): Status {
  const roll = rand(seed, 0, 1, 3);
  if (status === "running") return roll < 0.7 ? "slow" : "down";
  if (status === "slow") return roll < 0.65 ? "running" : "down";
  if (status === "down") return roll < 0.65 ? "slow" : "running";
  return roll < 0.7 ? "running" : "slow";
}

export function useLiveClock(period: PeriodId) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (period !== "live") return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, [period]);

  if (period !== "live") return "Static snapshot";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })
    .format(now)
    .replace(",", " ·");
}

export function comparisonContext(period: PeriodId) {
  if (period === "live") return "Compared to 30s ago";
  if (period === "today") return "Compared to yesterday";
  if (period === "this-week") return "Compared to last week";
  return undefined;
}

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
  const [metrics, setMetrics] = useState(baseMetrics);
  const [previousMetrics, setPreviousMetrics] = useState(baseMetrics);
  const [lineStatuses, setLineStatuses] = useState<Record<string, Status>>({});
  const [machineStatuses, setMachineStatuses] = useState<Record<string, Status>>({});
  const [refreshCount, setRefreshCount] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setMetrics(baseMetrics);
    setPreviousMetrics(baseMetrics);
    setLineStatuses({});
    setMachineStatuses({});
    setRefreshCount(0);
    setIsUpdating(false);
  }, [baseMetrics, period, zoneId]);

  useEffect(() => {
    if (period !== "live") return;
    let flashTimer: number | undefined;
    const refresh = () => {
      setRefreshCount((current) => {
        const next = current + 1;
        setMetrics((currentMetrics) => {
          setPreviousMetrics(currentMetrics);
          return metricsFrom(
            { availability: baseAvailability, performance: basePerformance, quality: baseQuality },
            `${zoneId}-live-${next}`,
          );
        });

        if (lines.length > 0 && rand(`${zoneId}-status-roll-${next}`, 0, 1, 3) < 0.75) {
          const lineIndex = Math.floor(rand(`${zoneId}-line-${next}`, 0, lines.length, 4));
          const line = lines[Math.min(lineIndex, lines.length - 1)];
          if (line) {
            setLineStatuses((currentStatuses) => {
              const status = nextStatus(
                currentStatuses[line.id] ?? line.status,
                `${zoneId}-${line.id}-${next}`,
              );
              return { ...currentStatuses, [line.id]: status };
            });
            const machine = line.machines[0];
            if (machine) {
              setMachineStatuses((currentStatuses) => ({
                ...currentStatuses,
                [`${line.id}:${machine.id}`]: nextStatus(
                  currentStatuses[`${line.id}:${machine.id}`] ?? machine.status,
                  `${zoneId}-${line.id}-${machine.id}-${next}`,
                ),
              }));
            }
          }
        }

        setIsUpdating(true);
        if (flashTimer) window.clearTimeout(flashTimer);
        flashTimer = window.setTimeout(() => setIsUpdating(false), FLASH_MS);
        return next;
      });
    };

    const timer = window.setInterval(refresh, LIVE_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      if (flashTimer) window.clearTimeout(flashTimer);
    };
  }, [baseAvailability, basePerformance, baseQuality, lines, period, zoneId]);

  return { metrics, previousMetrics, lineStatuses, machineStatuses, refreshCount, isUpdating };
}
