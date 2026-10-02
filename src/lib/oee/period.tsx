/**
 * Global Period Resolution and State Management for OEE Dashboard.
 * Standardizes period windows, like-for-like comparison windows, and custom range rules across all plants.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { getShiftInfo, getPreviousShiftInfo, getWibNow, SHIFT_SECONDS } from "./shiftClock";

export type PeriodKey = "this-shift" | "today" | "this-week" | "this-month" | "custom";

export const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "this-shift", label: "This Shift" },
  { key: "today", label: "Today" },
  { key: "this-week", label: "This Week" },
  { key: "this-month", label: "This Month" },
  { key: "custom", label: "Custom Range" },
];

/** Maximum allowed span in days for Custom Range filter (inclusive) */
export const CUSTOM_RANGE_MAX_DAYS = 31;

/** Comparison mode rule: 'like_for_like' compares elapsed window; 'full_previous' compares full window */
export type ComparisonMode = "like_for_like" | "full_previous";
export const COMPARISON_MODE: ComparisonMode = "like_for_like";

export type CustomRangeConfig = {
  startDate: Date;
  endDate: Date;
  compareStartDate?: Date;
  compareEndDate?: Date;
};

export type ShiftDefinition = {
  startHour: number;
  endHour: number;
  code: string;
};

export type ResolvedPeriod = {
  periodKey: PeriodKey;
  start: Date;
  end: Date;
  compareStart: Date;
  compareEnd: Date;
  compareLabel: string;
  periodLabel: string;
  isCurrentDayOrShift: boolean;
  isPastClosed: boolean;
  elapsedMs: number;
  totalPeriodMs: number;
};

function formatShortDate(d: Date): string {
  const day = String(d.getDate()).padStart(2, "0");
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
  const m = months[d.getMonth()];
  return `${day} ${m}`;
}

/**
 * Resolves period windows, comparison intervals and labels uniformly across the entire app.
 *
 * @param periodKey - One of 'this-shift' | 'today' | 'this-week' | 'this-month' | 'custom'
 * @param now - Reference current time (Asia/Jakarta timezone)
 * @param shiftConfig - Optional plant-specific shift configuration
 * @param customRange - User selected custom date range
 */
export function resolvePeriod(
  periodKey: PeriodKey = "this-shift",
  now: Date = new Date(),
  shiftConfig?: ShiftDefinition[],
  customRange?: CustomRangeConfig | null,
): ResolvedPeriod {
  const wibNow = getWibNow(now);
  const nowTs = wibNow.getTime();

  if (periodKey === "this-shift") {
    const shift = getShiftInfo(wibNow);
    const prevShift = getPreviousShiftInfo(wibNow);
    const start = new Date(shift.startSec * 1000);
    const end = new Date(Math.min(nowTs, shift.endSec * 1000));
    const elapsedMs = Math.max(0, end.getTime() - start.getTime());
    const totalPeriodMs = SHIFT_SECONDS * 1000;

    const compareStart = new Date(prevShift.startSec * 1000);
    const compareEnd =
      COMPARISON_MODE === "like_for_like"
        ? new Date(compareStart.getTime() + elapsedMs)
        : new Date(prevShift.endSec * 1000);

    return {
      periodKey,
      start,
      end,
      compareStart,
      compareEnd,
      compareLabel: "vs last shift",
      periodLabel: "This Shift",
      isCurrentDayOrShift: true,
      isPastClosed: false,
      elapsedMs,
      totalPeriodMs,
    };
  }

  if (periodKey === "today") {
    const start = new Date(wibNow);
    start.setHours(0, 0, 0, 0);
    const end = new Date(wibNow);
    const elapsedMs = Math.max(0, end.getTime() - start.getTime());
    const totalPeriodMs = 24 * 3600 * 1000;

    const compareStart = new Date(start);
    compareStart.setDate(compareStart.getDate() - 1);
    const compareEnd =
      COMPARISON_MODE === "like_for_like"
        ? new Date(compareStart.getTime() + elapsedMs)
        : new Date(compareStart.getTime() + totalPeriodMs);

    return {
      periodKey,
      start,
      end,
      compareStart,
      compareEnd,
      compareLabel: "vs yesterday",
      periodLabel: "Today",
      isCurrentDayOrShift: true,
      isPastClosed: false,
      elapsedMs,
      totalPeriodMs,
    };
  }

  if (periodKey === "this-week") {
    // Week starts Monday (ISO standard)
    const start = new Date(wibNow);
    const dayOfWeek = (start.getDay() + 6) % 7; // 0 = Monday, 6 = Sunday
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);

    const end = new Date(wibNow);
    const elapsedMs = Math.max(0, end.getTime() - start.getTime());
    const totalPeriodMs = 7 * 24 * 3600 * 1000;

    const compareStart = new Date(start);
    compareStart.setDate(compareStart.getDate() - 7);
    const compareEnd =
      COMPARISON_MODE === "like_for_like"
        ? new Date(compareStart.getTime() + elapsedMs)
        : new Date(compareStart.getTime() + totalPeriodMs);

    return {
      periodKey,
      start,
      end,
      compareStart,
      compareEnd,
      compareLabel: "vs last week",
      periodLabel: "This Week",
      isCurrentDayOrShift: true,
      isPastClosed: false,
      elapsedMs,
      totalPeriodMs,
    };
  }

  if (periodKey === "this-month") {
    const start = new Date(wibNow.getFullYear(), wibNow.getMonth(), 1, 0, 0, 0, 0);
    const end = new Date(wibNow);
    const elapsedMs = Math.max(0, end.getTime() - start.getTime());

    const daysInCurrentMonth = new Date(wibNow.getFullYear(), wibNow.getMonth() + 1, 0).getDate();
    const totalPeriodMs = daysInCurrentMonth * 24 * 3600 * 1000;

    // Previous month start
    const compareStart = new Date(wibNow.getFullYear(), wibNow.getMonth() - 1, 1, 0, 0, 0, 0);
    const daysInPrevMonth = new Date(wibNow.getFullYear(), wibNow.getMonth(), 0).getDate();

    let compareEnd: Date;
    if (COMPARISON_MODE === "like_for_like") {
      const targetDay = Math.min(wibNow.getDate(), daysInPrevMonth);
      compareEnd = new Date(
        compareStart.getFullYear(),
        compareStart.getMonth(),
        targetDay,
        wibNow.getHours(),
        wibNow.getMinutes(),
        wibNow.getSeconds(),
      );
    } else {
      compareEnd = new Date(compareStart.getTime() + daysInPrevMonth * 24 * 3600 * 1000);
    }

    return {
      periodKey,
      start,
      end,
      compareStart,
      compareEnd,
      compareLabel: "vs last month",
      periodLabel: "This Month",
      isCurrentDayOrShift: true,
      isPastClosed: false,
      elapsedMs,
      totalPeriodMs,
    };
  }

  // Custom Range
  if (customRange && customRange.startDate && customRange.endDate) {
    const rawStart = new Date(customRange.startDate);
    rawStart.setHours(0, 0, 0, 0);
    let rawEnd = new Date(customRange.endDate);
    rawEnd.setHours(23, 59, 59, 999);

    // End date cannot be in the future (cap to now)
    if (rawEnd.getTime() > nowTs) {
      rawEnd = new Date(nowTs);
    }

    // Clamp range to max CUSTOM_RANGE_MAX_DAYS
    const maxMs = CUSTOM_RANGE_MAX_DAYS * 24 * 3600 * 1000;
    if (rawEnd.getTime() - rawStart.getTime() > maxMs) {
      rawEnd = new Date(rawStart.getTime() + maxMs - 1000);
    }

    const totalPeriodMs = Math.max(1000, rawEnd.getTime() - rawStart.getTime());
    const isCurrentDayOrShift = rawEnd.getTime() >= nowTs - 24 * 3600 * 1000;
    const isPastClosed = !isCurrentDayOrShift;

    let compareStart: Date;
    let compareEnd: Date;
    let compareLabel = "vs previous period";

    if (customRange.compareStartDate && customRange.compareEndDate) {
      compareStart = new Date(customRange.compareStartDate);
      compareStart.setHours(0, 0, 0, 0);
      compareEnd = new Date(customRange.compareEndDate);
      compareEnd.setHours(23, 59, 59, 999);
      compareLabel = `vs ${formatShortDate(compareStart)} – ${formatShortDate(compareEnd)}`;
    } else {
      compareStart = new Date(rawStart.getTime() - totalPeriodMs);
      compareEnd = new Date(rawStart.getTime());
    }

    const periodLabel = `${formatShortDate(rawStart)} – ${formatShortDate(rawEnd)}`;

    return {
      periodKey: "custom",
      start: rawStart,
      end: rawEnd,
      compareStart,
      compareEnd,
      compareLabel,
      periodLabel,
      isCurrentDayOrShift,
      isPastClosed,
      elapsedMs: totalPeriodMs,
      totalPeriodMs,
    };
  }

  // Default fallback to This Shift
  return resolvePeriod("this-shift", now, shiftConfig);
}

export type PeriodContextValue = {
  periodKey: PeriodKey;
  setPeriodKey: (key: PeriodKey) => void;
  customRange: CustomRangeConfig | null;
  setCustomRange: (range: CustomRangeConfig | null) => void;
  resolved: ResolvedPeriod;
};

const PeriodContext = createContext<PeriodContextValue | null>(null);

const STORAGE_PERIOD_KEY = "paragon_oee_global_period";
const STORAGE_CUSTOM_KEY = "paragon_oee_global_custom_range";
const STORAGE_VERSION_KEY = "paragon_oee_storage_version";
export const STORAGE_VERSION = "v4";

// Run one-time migration on load to clear stale/legacy period values
if (typeof window !== "undefined") {
  try {
    const currentVer = localStorage.getItem(STORAGE_VERSION_KEY);
    if (currentVer !== STORAGE_VERSION) {
      const savedPeriod = localStorage.getItem(STORAGE_PERIOD_KEY);
      if (
        savedPeriod &&
        !["this-shift", "today", "this-week", "this-month", "custom"].includes(savedPeriod)
      ) {
        localStorage.removeItem(STORAGE_PERIOD_KEY);
      }
      localStorage.setItem(STORAGE_VERSION_KEY, STORAGE_VERSION);
    }
  } catch {
    // ignore
  }
}

export function PeriodProvider({ children }: { children: ReactNode }) {
  const [periodKey, setPeriodKeyState] = useState<PeriodKey>(() => {
    if (typeof window === "undefined") return "this-shift";
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const urlPeriod = urlParams.get("period") as PeriodKey | null;
      if (urlPeriod && PERIOD_OPTIONS.some((o) => o.key === urlPeriod)) {
        return urlPeriod;
      }
      const savedPeriod = localStorage.getItem(STORAGE_PERIOD_KEY) as PeriodKey | null;
      if (savedPeriod && PERIOD_OPTIONS.some((o) => o.key === savedPeriod)) {
        return savedPeriod;
      }
    } catch {
      // ignore
    }
    return "this-shift";
  });

  const [customRange, setCustomRangeState] = useState<CustomRangeConfig | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const savedCustom = localStorage.getItem(STORAGE_CUSTOM_KEY);
      if (savedCustom) {
        const parsed = JSON.parse(savedCustom);
        return {
          startDate: new Date(parsed.startDate),
          endDate: new Date(parsed.endDate),
          compareStartDate: parsed.compareStartDate ? new Date(parsed.compareStartDate) : undefined,
          compareEndDate: parsed.compareEndDate ? new Date(parsed.compareEndDate) : undefined,
        };
      }
    } catch {
      // ignore
    }
    return null;
  });

  const [now, setNow] = useState<Date>(() => new Date());

  // Period clock tick every minute to advance current shift window
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const setPeriodKey = (nextKey: PeriodKey) => {
    setPeriodKeyState(nextKey);
    try {
      localStorage.setItem(STORAGE_PERIOD_KEY, nextKey);
      // Sync URL query without full reload
      const url = new URL(window.location.href);
      url.searchParams.set("period", nextKey);
      window.history.replaceState({}, "", url.toString());
    } catch {
      // ignore
    }
  };

  const setCustomRange = (range: CustomRangeConfig | null) => {
    setCustomRangeState(range);
    try {
      if (range) {
        localStorage.setItem(STORAGE_CUSTOM_KEY, JSON.stringify(range));
      } else {
        localStorage.removeItem(STORAGE_CUSTOM_KEY);
      }
    } catch {
      // ignore
    }
  };

  const resolved = resolvePeriod(periodKey, now, undefined, customRange);

  return (
    <PeriodContext.Provider
      value={{
        periodKey,
        setPeriodKey,
        customRange,
        setCustomRange,
        resolved,
      }}
    >
      {children}
    </PeriodContext.Provider>
  );
}

/**
 * Hook to access and update global Period filter across all Live Monitor pages.
 */
export function usePeriod(): PeriodContextValue {
  const ctx = useContext(PeriodContext);
  if (!ctx) {
    // Graceful fallback if rendered outside provider
    const fallback = resolvePeriod("this-shift");
    return {
      periodKey: "this-shift",
      setPeriodKey: () => {},
      customRange: null,
      setCustomRange: () => {},
      resolved: fallback,
    };
  }
  return ctx;
}
