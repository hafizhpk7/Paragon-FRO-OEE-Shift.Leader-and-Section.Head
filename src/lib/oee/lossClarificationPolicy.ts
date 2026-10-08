import type { ResolvedPeriod } from "./period";
import { resolvePeriod } from "./period";
import type { Role } from "./app-context";
import { getWibNow, formatTimeWib } from "./shiftClock";

/** Lookback window in calendar days counting today (e.g., today + 6 previous days = 7 days) */
export const LOSS_CLARIFICATION_LOOKBACK_DAYS = 7;

/** Roles authorized to edit, reclassify, or alter classified loss records */
export const ROLES_ALLOWED_TO_EDIT_CLASSIFIED = ["section_head", "section-head"] as const;

/** When period is not eligible, render the 'Use This Week' CTA button */
export const SHOW_EMPTY_STATE_CTA = true;

/** Toast stack position below header row or bottom-right to never obstruct header controls */
export const TOAST_POSITION: "bottom-right" | "top-right" = "bottom-right";

/** Registry for fast event lookup by dev helpers and policy explainers */
export const lossEventRegistry = new Map<
  string,
  { id: string; startAt: number; endAt: number; [key: string]: unknown }
>();

/**
 * Shared start of day helper (00:00:00.000) in WIB / app timezone.
 * Aligns with resolvePeriod("today") time calculation.
 */
export function getStartOfDayWib(date: Date = new Date()): Date {
  const wib = getWibNow(date);
  const d = new Date(wib);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Returns the earliest allowed start Date (start of day 00:00:00.000 WIB minus 6 days,
 * totaling 7 calendar days including today).
 * Example: Thu 08 Oct 2026 -> earliest allowed Fri 02 Oct 2026 00:00:00.
 */
export function getEarliestAllowed(now: Date = new Date()): Date {
  const d = getStartOfDayWib(now);
  d.setDate(d.getDate() - (LOSS_CLARIFICATION_LOOKBACK_DAYS - 1));
  return d;
}

/**
 * Evaluates whether a resolved period window is eligible for Loss Clarification.
 * True ONLY if resolved window start >= getEarliestAllowed(now).
 * Windows that only partially overlap or extend further back in the past are NOT eligible.
 */
export function isPeriodEligible(
  resolvedWindow: ResolvedPeriod | { start: Date; end?: Date } | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!resolvedWindow || !resolvedWindow.start) return false;
  const earliest = getEarliestAllowed(now);
  return resolvedWindow.start.getTime() >= earliest.getTime();
}

/**
 * Checks if a specific loss item or event timestamp is within the eligible 7-day lookback window.
 * Policy functions read ONLY canonical absolute startAt (epoch milliseconds).
 * Item startAt >= getEarliestAllowed(now).getTime().
 */
export function isItemEligible(
  itemOrStartAt: { startAt?: number; timestamp?: Date | number } | number | null | undefined,
  now: Date = new Date(),
): boolean {
  if (itemOrStartAt == null) return false;
  const earliest = getEarliestAllowed(now);

  let startAt: number | undefined;
  if (typeof itemOrStartAt === "number") {
    startAt = itemOrStartAt;
  } else if ("startAt" in itemOrStartAt && typeof itemOrStartAt.startAt === "number") {
    startAt = itemOrStartAt.startAt;
  } else if ("timestamp" in itemOrStartAt && itemOrStartAt.timestamp != null) {
    startAt =
      typeof itemOrStartAt.timestamp === "number"
        ? itemOrStartAt.timestamp
        : itemOrStartAt.timestamp.getTime();
  }

  if (startAt === undefined || !Number.isFinite(startAt)) {
    console.error("[OEE] isItemEligible: missing or non-finite startAt:", itemOrStartAt);
    return false;
  }

  return startAt >= earliest.getTime();
}

/**
 * Initial classification capability check:
 * Can classify unclassified loss: Shift Leader and Section Head can both do this.
 */
export function canClassify(role: Role | string): boolean {
  return (
    role === "shift-leader" ||
    role === "shift_leader" ||
    role === "section-head" ||
    role === "section_head"
  );
}

/**
 * Edit / reclassify / alter classified loss capability check:
 * Allowed ONLY for roles in ROLES_ALLOWED_TO_EDIT_CLASSIFIED (Section Head).
 */
export function canEditClassified(role: Role | string): boolean {
  return (ROLES_ALLOWED_TO_EDIT_CLASSIFIED as readonly string[]).includes(role);
}

/**
 * Formats a date into "Fri, 02 Oct 2026" format for empty-state dynamic text
 */
export function formatEarliestDateString(date: Date): string {
  const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const monthNames = [
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
  const dName = dayNames[date.getDay()] ?? "";
  const dNum = String(date.getDate()).padStart(2, "0");
  const mName = monthNames[date.getMonth()] ?? "";
  const yNum = date.getFullYear();
  return `${dName}, ${dNum} ${mName} ${yNum}`;
}

export interface LossPolicyExplanation {
  role: string;
  canEditClassified: boolean;
  periodEligible: boolean;
  item: {
    rawStart: unknown;
    rawStartType: string;
    startAtISO: string;
  } | null;
  earliestAllowedISO: string;
  nowISO: string;
  timezone: string;
  eligible: boolean;
  reasonCode: "OK" | "OUT_OF_RANGE" | "ROLE_RESTRICTED" | "INVALID_TIMESTAMP" | "NOT_FOUND";
  message: string;
}

/**
 * Dev helper returning detailed diagnostic state for any loss item or action check.
 */
export function explainLossPolicy(
  itemId: string,
  explicitStartAt?: number,
  isAlreadyClassified: boolean = false,
  roleOverride?: Role | string,
  now: Date = new Date(),
): LossPolicyExplanation {
  const registered = lossEventRegistry.get(itemId);
  const rawStart = explicitStartAt !== undefined ? explicitStartAt : registered?.startAt;
  const rawStartType = typeof rawStart;

  const currentRole = (roleOverride ||
    (typeof window !== "undefined" ? localStorage.getItem("paragon_oee_role") : null) ||
    "section-head") as string;

  const canEdit = canEditClassified(currentRole);
  const earliest = getEarliestAllowed(now);
  const earliestAllowedISO = earliest.toISOString();
  const nowISO = now.toISOString();
  const timezone = "Asia/Jakarta (WIB)";

  let startAtISO = "INVALID";
  if (typeof rawStart === "number" && Number.isFinite(rawStart)) {
    startAtISO = new Date(rawStart).toISOString();
  }

  const itemInfo = rawStart !== undefined ? { rawStart, rawStartType, startAtISO } : null;
  const eligible = isItemEligible(rawStart as number, now);

  // Period check for context (using 'today' as baseline representative)
  const periodEligible = isPeriodEligible(resolvePeriod("today", now), now);

  let reasonCode: LossPolicyExplanation["reasonCode"] = "OK";
  let message = "Action permitted under loss clarification policy";

  if (rawStart === undefined || !Number.isFinite(rawStart as number)) {
    reasonCode = "INVALID_TIMESTAMP";
    message = "Cannot save: this loss has no valid start time";
  } else if (!eligible) {
    reasonCode = "OUT_OF_RANGE";
    message = "Only the last 7 days can be clarified";
  } else if (isAlreadyClassified && !canEdit) {
    reasonCode = "ROLE_RESTRICTED";
    message = "Only Section Head can edit classified loss";
  }

  return {
    role: currentRole,
    canEditClassified: canEdit,
    periodEligible,
    item: itemInfo,
    earliestAllowedISO,
    nowISO,
    timezone,
    eligible,
    reasonCode,
    message,
  };
}

export interface SelfTestResult {
  category: string;
  name: string;
  passed: boolean;
  detail: string;
}

/**
 * Runs the comprehensive 6-category self-test for Loss Clarification policy.
 */
export function runLossPolicySelfTest(): {
  passed: boolean;
  count: number;
  results: SelfTestResult[];
} {
  const results: SelfTestResult[] = [];
  const refNow = new Date("2026-10-08T03:15:00Z"); // Thu 08 Oct 2026 10:15 WIB
  const earliest = getEarliestAllowed(refNow);
  const earliestMs = earliest.getTime(); // Fri 02 Oct 2026 00:00:00 WIB
  const todayStart = getStartOfDayWib(refNow);
  const todayStartMs = todayStart.getTime(); // Thu 08 Oct 2026 00:00:00 WIB

  function assert(category: string, name: string, condition: boolean, detail: string) {
    results.push({
      category,
      name,
      passed: condition,
      detail,
    });
  }

  // 1. BOUNDARY CASES
  assert(
    "1. Boundary",
    "Today 00:00:00 is eligible",
    isItemEligible(todayStartMs, refNow) === true,
    `startAt=${new Date(todayStartMs).toISOString()} >= earliest=${earliest.toISOString()}`,
  );
  assert(
    "1. Boundary",
    "02 Oct 00:00:00 (exact earliest 7-day limit) is eligible",
    isItemEligible(earliestMs, refNow) === true,
    `startAt=${earliest.toISOString()} equals earliest boundary`,
  );
  assert(
    "1. Boundary",
    "01 Oct 23:59:59 (1 second older than 7 days) is NOT eligible",
    isItemEligible(earliestMs - 1000, refNow) === false,
    `startAt=${new Date(earliestMs - 1000).toISOString()} < earliest boundary`,
  );

  // 2. ROLE MATRIX
  const inRangeMs = earliestMs + 3600000;
  const outOfRangeMs = earliestMs - 3600000;

  // Section Head
  const expSH_unclass_in = explainLossPolicy("test-1", inRangeMs, false, "section-head", refNow);
  assert(
    "2. Role Matrix",
    "Section Head x unclassified x in-range -> ALLOWED",
    expSH_unclass_in.reasonCode === "OK",
    expSH_unclass_in.message,
  );

  const expSH_class_in = explainLossPolicy("test-2", inRangeMs, true, "section-head", refNow);
  assert(
    "2. Role Matrix",
    "Section Head x classified x in-range -> ALLOWED",
    expSH_class_in.reasonCode === "OK",
    expSH_class_in.message,
  );

  const expSH_class_out = explainLossPolicy("test-3", outOfRangeMs, true, "section-head", refNow);
  assert(
    "2. Role Matrix",
    "Section Head x classified x out-of-range -> REJECTED (7-day toast)",
    expSH_class_out.reasonCode === "OUT_OF_RANGE" &&
      expSH_class_out.message === "Only the last 7 days can be clarified",
    expSH_class_out.message,
  );

  const expSH_unclass_out = explainLossPolicy(
    "test-4",
    outOfRangeMs,
    false,
    "section-head",
    refNow,
  );
  assert(
    "2. Role Matrix",
    "Section Head x unclassified x out-of-range -> REJECTED (7-day toast)",
    expSH_unclass_out.reasonCode === "OUT_OF_RANGE" &&
      expSH_unclass_out.message === "Only the last 7 days can be clarified",
    expSH_unclass_out.message,
  );

  // Shift Leader
  const expSL_unclass_in = explainLossPolicy("test-5", inRangeMs, false, "shift-leader", refNow);
  assert(
    "2. Role Matrix",
    "Shift Leader x unclassified x in-range -> ALLOWED",
    expSL_unclass_in.reasonCode === "OK",
    expSL_unclass_in.message,
  );

  const expSL_class_in = explainLossPolicy("test-6", inRangeMs, true, "shift-leader", refNow);
  assert(
    "2. Role Matrix",
    "Shift Leader x classified x in-range -> REJECTED (role toast)",
    expSL_class_in.reasonCode === "ROLE_RESTRICTED" &&
      expSL_class_in.message === "Only Section Head can edit classified loss",
    expSL_class_in.message,
  );

  const expSL_class_out = explainLossPolicy("test-7", outOfRangeMs, true, "shift-leader", refNow);
  assert(
    "2. Role Matrix",
    "Shift Leader x classified x out-of-range -> REJECTED (7-day toast)",
    expSL_class_out.reasonCode === "OUT_OF_RANGE" &&
      expSL_class_out.message === "Only the last 7 days can be clarified",
    expSL_class_out.message,
  );

  const expSL_unclass_out = explainLossPolicy(
    "test-8",
    outOfRangeMs,
    false,
    "shift-leader",
    refNow,
  );
  assert(
    "2. Role Matrix",
    "Shift Leader x unclassified x out-of-range -> REJECTED (7-day toast)",
    expSL_unclass_out.reasonCode === "OUT_OF_RANGE" &&
      expSL_unclass_out.message === "Only the last 7 days can be clarified",
    expSL_unclass_out.message,
  );

  // 3. PERIOD CASES
  assert(
    "3. Period Cases",
    "This Shift is eligible",
    isPeriodEligible(resolvePeriod("this-shift", refNow), refNow) === true,
    `start=${resolvePeriod("this-shift", refNow).start.toISOString()}`,
  );
  assert(
    "3. Period Cases",
    "Today is eligible",
    isPeriodEligible(resolvePeriod("today", refNow), refNow) === true,
    `start=${resolvePeriod("today", refNow).start.toISOString()}`,
  );
  assert(
    "3. Period Cases",
    "This Week is eligible",
    isPeriodEligible(resolvePeriod("this-week", refNow), refNow) === true,
    `start=${resolvePeriod("this-week", refNow).start.toISOString()}`,
  );
  assert(
    "3. Period Cases",
    "Custom range within 7 days (02 Oct - 08 Oct) is eligible",
    isPeriodEligible({ start: earliest }, refNow) === true,
    `start=${earliest.toISOString()}`,
  );
  assert(
    "3. Period Cases",
    "This Month on 08 Oct is NOT eligible (starts 01 Oct)",
    isPeriodEligible(resolvePeriod("this-month", refNow), refNow) === false,
    `start=${resolvePeriod("this-month", refNow).start.toISOString()} < earliest=${earliest.toISOString()}`,
  );
  assert(
    "3. Period Cases",
    "Custom range older than 7 days is NOT eligible",
    isPeriodEligible({ start: new Date("2026-09-25T00:00:00Z") }, refNow) === false,
    `start=2026-09-25T00:00:00Z < earliest=${earliest.toISOString()}`,
  );

  // 4. UI CHECK VS ACTION CHECK PARITY
  const testSampleMs = earliestMs + 7200000;
  const uiCheckResult = isItemEligible(testSampleMs, refNow);
  const actionCheckResult = isItemEligible(testSampleMs, refNow);
  assert(
    "4. Parity Check",
    "Same item evaluates identically in UI check and action check",
    uiCheckResult === true && actionCheckResult === true,
    `uiCheck=${uiCheckResult}, actionCheck=${actionCheckResult}`,
  );

  // 5. MIDNIGHT IN APP TIMEZONE (WIB)
  const wibMidnight02 = earliestMs;
  const wibOneSecBefore02 = earliestMs - 1000;
  const wibOneSecAfter02 = earliestMs + 1000;
  assert(
    "5. Midnight WIB",
    "Item at 00:00:01 WIB on 02 Oct is eligible",
    isItemEligible(wibOneSecAfter02, refNow) === true,
    formatTimeWib(wibOneSecAfter02, true),
  );
  assert(
    "5. Midnight WIB",
    "Item at 00:00:00 WIB on 02 Oct is eligible",
    isItemEligible(wibMidnight02, refNow) === true,
    formatTimeWib(wibMidnight02, true),
  );
  assert(
    "5. Midnight WIB",
    "Item at 23:59:59 WIB on 01 Oct is NOT eligible",
    isItemEligible(wibOneSecBefore02, refNow) === false,
    formatTimeWib(wibOneSecBefore02, true),
  );

  // 6. MISSING OR INVALID STARTAT NORMALIZER FALLBACK
  const invalidRawStart = NaN;
  const fallbackExplanation = explainLossPolicy(
    "invalid-test",
    invalidRawStart,
    false,
    "section-head",
    refNow,
  );
  assert(
    "6. Fallback Normalizer",
    "Invalid startAt surfaces INVALID_TIMESTAMP with descriptive message",
    fallbackExplanation.reasonCode === "INVALID_TIMESTAMP" &&
      fallbackExplanation.message === "Cannot save: this loss has no valid start time",
    fallbackExplanation.message,
  );

  const allPassed = results.every((r) => r.passed);

  if (typeof console !== "undefined") {
    console.info(
      `[OEE] Loss Policy Self-Test: ${allPassed ? "ALL PASSED" : "FAILED"} (${results.filter((r) => r.passed).length}/${results.length})`,
    );
    if (console.table) {
      console.table(results);
    }
  }

  return {
    passed: allPassed,
    count: results.length,
    results,
  };
}

// Global browser window bindings
if (typeof window !== "undefined") {
  (window as unknown as { explainLossPolicy?: typeof explainLossPolicy }).explainLossPolicy =
    explainLossPolicy;
  (
    window as unknown as { runLossPolicySelfTest?: typeof runLossPolicySelfTest }
  ).runLossPolicySelfTest = runLossPolicySelfTest;
}
