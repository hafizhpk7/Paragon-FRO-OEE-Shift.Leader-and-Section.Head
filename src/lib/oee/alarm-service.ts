import { useEffect, useMemo, useState } from "react";
import { type Alarm, type Line, type Plant } from "@/lib/oee/data";
import { type ResolvedPeriod } from "@/lib/oee/period";
import { formatTimeWib, getWibNow } from "@/lib/oee/shiftClock";
import { pick, rand } from "@/lib/oee/rng";

const STANDARD_FAULTS = [
  "Bearing seizure on main drive",
  "Conveyor jam at infeed",
  "Servo overload trip",
  "Film splice sensor fault",
  "Vacuum pressure low",
  "Cartoner glue temperature low",
  "Pneumatic cylinder seal leak",
  "Safety gate interlock tripped",
  "Bottle infeed track sensor fault",
  "Outfeed reject bin full",
];

/**
 * Evaluates the period context to determine:
 * 1. includesCurrentDay: Whether the period includes the ongoing today (allows live real-time updates)
 * 2. isStrictlyToday: Whether the period spans only today (determines time-only vs date+time formatting)
 */
export function getPeriodAlarmContext(resolved: ResolvedPeriod, now: Date = new Date()) {
  const wibNow = getWibNow(now);
  // Start of today in WIB: 00:00:00 WIB
  const startOfTodayMs =
    Date.UTC(wibNow.getUTCFullYear(), wibNow.getUTCMonth(), wibNow.getUTCDate(), 0, 0, 0, 0) -
    7 * 3600000;
  const endOfTodayMs = startOfTodayMs + 24 * 3600 * 1000 - 1;

  let includesCurrentDay = false;
  let isStrictlyToday = false;

  if (resolved.periodKey === "this-shift" || resolved.periodKey === "today") {
    includesCurrentDay = true;
    isStrictlyToday = true;
  } else if (resolved.periodKey === "this-week" || resolved.periodKey === "this-month") {
    includesCurrentDay = true;
    isStrictlyToday = false;
  } else if (resolved.periodKey === "custom") {
    const endMs = resolved.end.getTime();
    const startMs = resolved.start.getTime();

    // Custom Range includes current day ONLY IF the selected end-date is today (or greater)
    includesCurrentDay = endMs >= startOfTodayMs;

    // Strictly for today ONLY IF it only spans today's date
    isStrictlyToday = startMs >= startOfTodayMs && endMs <= endOfTodayMs + 1000;
  }

  return {
    includesCurrentDay,
    isStrictlyToday,
    startOfTodayMs,
    endOfTodayMs,
  };
}

/**
 * Formats alarm timestamp:
 * - If strictly for TODAY ("This Shift", "Today", or Custom Range spanning only today): time only (e.g. "14:30:45")
 * - If multi-day or strictly historical ("This Week", "This Month", or multi-day/historical Custom Range): date + time (e.g. "21 Oct, 14:30:45")
 */
export function formatAlarmTimestamp(timestamp: number, isStrictlyToday: boolean): string {
  const timeStr = formatTimeWib(timestamp, true);
  if (isStrictlyToday) {
    return timeStr;
  }
  const wib = getWibNow(new Date(timestamp));
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
  const dNum = String(wib.getUTCDate()).padStart(2, "0");
  const mName = months[wib.getUTCMonth()];
  return `${dNum} ${mName}, ${timeStr}`;
}

export function generateInitialAlarms({
  plant,
  line,
  resolved,
  includesCurrentDay,
  isStrictlyToday,
}: {
  plant?: Plant;
  line?: Line;
  resolved: ResolvedPeriod;
  includesCurrentDay: boolean;
  isStrictlyToday: boolean;
}): Alarm[] {
  const startMs = resolved.start.getTime();
  const endMs = resolved.end.getTime();
  const nowMs = Date.now();

  const lines: Line[] = line ? [line] : plant?.zones?.flatMap((z) => z.lines) || [];
  if (!lines.length) return [];

  const entityKey = line ? `line-${line.id}` : `plant-${plant?.id || "p"}`;

  // Case 1: HISTORICAL PERIOD (includesCurrentDay === false)
  // Must be static, bounded within [startMs, endMs], all resolved, deterministic seed
  if (!includesCurrentDay) {
    const alarms: Alarm[] = [];
    const durationSpan = Math.max(3600000, endMs - startMs);
    const count = line
      ? 3
      : Math.min(8, Math.max(3, Math.floor(durationSpan / (24 * 3600000)) * 2 || 4));

    for (let i = 0; i < count; i++) {
      const seed = `${entityKey}-hist-${startMs}-${endMs}-${i}`;
      const l = lines[i % lines.length];
      const frac = (i + 0.5) / count;
      const jitter = (rand(seed + "j", 0, 100, 0) / 100 - 0.5) * (durationSpan / count) * 0.4;
      const alarmTime = Math.min(
        endMs - 120000,
        Math.max(startMs + 60000, Math.floor(startMs + frac * durationSpan + jitter)),
      );
      const duration = rand(seed + "dur", 6, 85, 0);
      const m = l.machines[i % l.machines.length];

      alarms.push({
        id: `${entityKey}-hist-${i}`,
        lineId: l.id,
        machineId: m?.code || m?.id || "-",
        issue: pick(seed + "iss", STANDARD_FAULTS),
        timestamp: alarmTime,
        start: formatAlarmTimestamp(alarmTime, isStrictlyToday),
        durationMinutes: duration,
        status: "Resolved",
        severity: pick(seed + "sev", ["CRITICAL", "HIGH", "MEDIUM"] as const),
      });
    }

    return alarms.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }

  // Case 2: INCLUDES CURRENT DAY (Dynamic / Ongoing alarms possible)
  const alarms: Alarm[] = [];

  // Active / Occurring alarms
  if (line) {
    const seed = `${line.id}-la`;
    const culprit = line.machines.find((m) => m.status === "down");
    const culpritMachineId = culprit
      ? culprit.code || culprit.id
      : line.bottleneck && line.bottleneck !== "-"
        ? line.bottleneck
        : (line.machines[0]?.id ?? "-");

    if (line.status === "down" || line.fault) {
      const duration = culprit?.currentStop?.elapsedMinutes ?? rand(seed + "1", 12, 65, 0);
      const alarmTime = nowMs - duration * 60000;
      alarms.push({
        id: `${line.id}-active`,
        lineId: line.id,
        machineId: culpritMachineId,
        issue: line.fault || culprit?.currentStop?.fault || "Machine breakdown stop",
        timestamp: alarmTime,
        start: formatAlarmTimestamp(alarmTime, isStrictlyToday),
        durationMinutes: duration,
        status: "OCCURRING",
        severity: "CRITICAL",
      });
    }

    // Resolved alarm earlier in the period
    if (line.machines.length > 1) {
      const other =
        line.machines.find((m) => (m.code || m.id) !== culpritMachineId) || line.machines[1];
      const duration = rand(seed + "2", 8, 32, 0);
      const earlierOffset = rand(seed + "off", 45, 180, 0) * 60000;
      const alarmTime = Math.max(startMs + 60000, nowMs - earlierOffset);
      alarms.push({
        id: `${line.id}-r1`,
        lineId: line.id,
        machineId: other?.code || other?.id || "-",
        issue: pick(seed + "i", STANDARD_FAULTS),
        timestamp: alarmTime,
        start: formatAlarmTimestamp(alarmTime, isStrictlyToday),
        durationMinutes: duration,
        status: "Resolved",
        severity: "MEDIUM",
      });
    }
  } else if (plant) {
    plant.zones?.forEach((z) => {
      z.lines.forEach((l) => {
        if (l.status === "down" || l.status === "slow") {
          const m = l.machines[0];
          const seed = `${plant.id}-${l.id}-alarm`;
          const isDown = l.status === "down";
          const duration = rand(seed + "d", 10, 75, 0);
          const alarmTime = isDown
            ? nowMs - duration * 60000
            : Math.max(startMs + 60000, nowMs - (duration + 45) * 60000);

          alarms.push({
            id: `${l.id}-live`,
            lineId: l.id,
            machineId: m?.id ?? "-",
            issue: l.fault ?? pick(seed + "iss", STANDARD_FAULTS),
            timestamp: alarmTime,
            start: formatAlarmTimestamp(alarmTime, isStrictlyToday),
            durationMinutes: duration,
            status: isDown ? "OCCURRING" : "Resolved",
            severity: isDown ? "CRITICAL" : "MEDIUM",
          });
        }
      });
    });
  }

  return alarms.sort((a, b) =>
    a.status === b.status
      ? (b.timestamp ?? 0) - (a.timestamp ?? 0)
      : a.status === "OCCURRING"
        ? -1
        : 1,
  );
}

export function useAlarms({
  plant,
  line,
  resolved,
}: {
  plant?: Plant;
  line?: Line;
  resolved: ResolvedPeriod;
}) {
  const { includesCurrentDay, isStrictlyToday } = useMemo(
    () => getPeriodAlarmContext(resolved),
    [resolved],
  );

  const [alarms, setAlarms] = useState<Alarm[]>(() =>
    generateInitialAlarms({ plant, line, resolved, includesCurrentDay, isStrictlyToday }),
  );

  const startMs = resolved.start.getTime();
  const endMs = resolved.end.getTime();
  const plantId = plant?.id;
  const lineId = line?.id;
  const periodKey = resolved.periodKey;

  // Sync state whenever period or target plant/line changes
  useEffect(() => {
    setAlarms(
      generateInitialAlarms({ plant, line, resolved, includesCurrentDay, isStrictlyToday }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plantId, lineId, periodKey, startMs, endMs, includesCurrentDay, isStrictlyToday]);

  // Real-time polling / simulation: ONLY runs if includesCurrentDay is true
  useEffect(() => {
    if (!includesCurrentDay) {
      // Historical period: NO interval, static data
      return;
    }

    const interval = setInterval(() => {
      setAlarms((prev) => {
        const now = Date.now();
        let changed = false;
        const updated = prev.map((a) => {
          if (a.status === "OCCURRING" && a.timestamp) {
            const currentDuration = Math.max(1, Math.floor((now - a.timestamp) / 60000));
            if (currentDuration !== a.durationMinutes) {
              changed = true;
              return { ...a, durationMinutes: currentDuration };
            }
          }
          return a;
        });
        return changed ? updated : prev;
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [includesCurrentDay, periodKey, startMs, endMs]);

  return { alarms, includesCurrentDay, isStrictlyToday };
}
