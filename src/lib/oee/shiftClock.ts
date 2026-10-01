/**
 * Shift Clock and Time Utilities for Paragon Plant Jatake 2 (J2).
 * Timezone: WIB (Western Indonesia Time, UTC+7).
 * 3 standard 8-hour shifts per day:
 * - Shift A: 07:00:00 - 14:59:59 WIB
 * - Shift B: 15:00:00 - 22:59:59 WIB
 * - Shift C: 23:00:00 - 06:59:59 WIB (next day)
 */

export type ShiftCode = "A" | "B" | "C";

export const SHIFT_SECONDS = 8 * 3600; // 28,800 seconds (960 windows of 30s)
export const WIB_OFFSET_HOURS = 7;

export interface ShiftInfo {
  code: ShiftCode;
  label: string; // e.g. "Shift A — 07:00-14:59 WIB"
  startHour: number;
  endHour: number;
  dateKey: string; // YYYY-MM-DD in WIB
  shiftKey: string; // YYYY-MM-DD:A
  startSec: number; // Unix timestamp in seconds
  endSec: number; // Unix timestamp in seconds
  elapsedSec: number; // Elapsed seconds from shift start to now (clamped to 0..28800)
  isCurrent: boolean;
}

/**
 * Gets current WIB date and time components
 */
export function getWibNow(refDate: Date = new Date()): Date {
  const utc = refDate.getTime() + refDate.getTimezoneOffset() * 60000;
  return new Date(utc + 3600000 * WIB_OFFSET_HOURS);
}

/**
 * Formats a Date or timestamp as HH:MM or HH:MM:SS in WIB
 */
export function formatTimeWib(dateOrSec: Date | number, includeSec = false): string {
  const d = typeof dateOrSec === "number" ? new Date(dateOrSec * 1000) : dateOrSec;
  const wib = getWibNow(d);
  const h = String(wib.getHours()).padStart(2, "0");
  const m = String(wib.getMinutes()).padStart(2, "0");
  if (!includeSec) return `${h}:${m}`;
  const s = String(wib.getSeconds()).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/**
 * Formats seconds into "Xh Ym" or "Xm Ys" or "Xs"
 */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}h ${m}m`;
  }
  if (m > 0) {
    return `${m}m ${s > 0 ? `${s}s` : ""}`.trim();
  }
  return `${s}s`;
}

/**
 * Formats seconds into clean "Xm Ys" for loss events
 */
export function formatEventDuration(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

/**
 * Calculates shift info for any given reference timestamp
 */
export function getShiftInfo(refDate: Date = new Date()): ShiftInfo {
  const wib = getWibNow(refDate);
  const hour = wib.getHours();
  const minute = wib.getMinutes();
  const second = wib.getSeconds();

  let code: ShiftCode = "A";
  let startHour = 7;
  let endHour = 15;
  const year = wib.getFullYear();
  const month = String(wib.getMonth() + 1).padStart(2, "0");
  let day = wib.getDate();

  if (hour >= 7 && hour < 15) {
    code = "A";
    startHour = 7;
    endHour = 15;
  } else if (hour >= 15 && hour < 23) {
    code = "B";
    startHour = 15;
    endHour = 23;
  } else {
    code = "C";
    startHour = 23;
    endHour = 7;
    // If before 07:00, this Shift C started yesterday at 23:00
    if (hour < 7) {
      const yesterday = new Date(wib.getTime() - 86400000);
      day = yesterday.getDate();
    }
  }

  const dateKey = `${year}-${month}-${String(day).padStart(2, "0")}`;
  const shiftKey = `${dateKey}:${code}`;
  const label = `Shift ${code} · ${String(startHour).padStart(2, "0")}:00-${String(
    (endHour + 24 - 1) % 24,
  ).padStart(2, "0")}:59 WIB`;

  // Calculate start and end epoch seconds
  const startWib = new Date(wib);
  if (code === "C" && hour < 7) {
    startWib.setDate(startWib.getDate() - 1);
  }
  startWib.setHours(startHour, 0, 0, 0);
  const startSec = Math.floor((startWib.getTime() - 3600000 * WIB_OFFSET_HOURS) / 1000);
  const endSec = startSec + SHIFT_SECONDS;

  // Elapsed seconds into shift
  let elapsedSec = 0;
  if (code === "C") {
    if (hour >= 23) {
      elapsedSec = (hour - 23) * 3600 + minute * 60 + second;
    } else {
      elapsedSec = 3600 + hour * 3600 + minute * 60 + second;
    }
  } else {
    elapsedSec = (hour - startHour) * 3600 + minute * 60 + second;
  }
  elapsedSec = Math.min(SHIFT_SECONDS, Math.max(0, elapsedSec));

  return {
    code,
    label,
    startHour,
    endHour,
    dateKey,
    shiftKey,
    startSec,
    endSec,
    elapsedSec,
    isCurrent: true,
  };
}

/**
 * Returns the previous shift info
 */
export function getPreviousShiftInfo(refDate: Date = new Date()): ShiftInfo {
  const current = getShiftInfo(refDate);
  const prevDate = new Date(current.startSec * 1000 - 3600 * 1000);
  const prev = getShiftInfo(prevDate);
  return {
    ...prev,
    isCurrent: false,
    elapsedSec: SHIFT_SECONDS,
  };
}
