import { memo, useState } from "react";
import { Calendar as CalendarIcon, ChevronDown, Check, AlertCircle, ArrowLeft } from "lucide-react";
import { format, differenceInCalendarDays, isAfter, startOfDay } from "date-fns";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CUSTOM_RANGE_MAX_DAYS, PERIOD_OPTIONS, usePeriod, type PeriodKey } from "@/lib/oee/period";
import { cn } from "@/lib/utils";

export const PeriodDropdown = memo(function PeriodDropdown({ className }: { className?: string }) {
  const { periodKey, setPeriodKey, customRange, setCustomRange, resolved } = usePeriod();

  const [isOpen, setIsOpen] = useState(false);
  const [activeView, setActiveView] = useState<"menu" | "custom">("menu");

  // Custom range draft state
  const today = startOfDay(new Date());
  const [startDateStr, setStartDateStr] = useState<string>(() => {
    return format(
      customRange?.startDate ?? new Date(Date.now() - 7 * 24 * 3600 * 1000),
      "yyyy-MM-dd",
    );
  });
  const [endDateStr, setEndDateStr] = useState<string>(() => {
    return format(customRange?.endDate ?? new Date(), "yyyy-MM-dd");
  });

  const [hasCompare, setHasCompare] = useState<boolean>(() =>
    Boolean(customRange?.compareStartDate),
  );
  const [compareStartDateStr, setCompareStartDateStr] = useState<string>(() => {
    return format(
      customRange?.compareStartDate ?? new Date(Date.now() - 14 * 24 * 3600 * 1000),
      "yyyy-MM-dd",
    );
  });
  const [compareEndDateStr, setCompareEndDateStr] = useState<string>(() => {
    return format(
      customRange?.compareEndDate ?? new Date(Date.now() - 7 * 24 * 3600 * 1000),
      "yyyy-MM-dd",
    );
  });

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  const daysDiff =
    !isNaN(startDate.getTime()) && !isNaN(endDate.getTime())
      ? differenceInCalendarDays(endDate, startDate) + 1
      : 0;

  const isRangeTooLong = daysDiff > CUSTOM_RANGE_MAX_DAYS;
  const isEndInFuture = isAfter(startDate, endDate);
  const isInvalid = isRangeTooLong || isEndInFuture || daysDiff <= 0;

  const handleOpenChange = (nextOpen: boolean) => {
    setIsOpen(nextOpen);
    if (!nextOpen) {
      setActiveView("menu");
    }
  };

  const handleSelectOption = (key: PeriodKey) => {
    if (key === "custom") {
      setActiveView("custom");
    } else {
      setPeriodKey(key);
      setIsOpen(false);
      setActiveView("menu");
    }
  };

  const handleApplyCustom = () => {
    if (isInvalid) return;

    const s = new Date(`${startDateStr}T00:00:00`);
    const e = new Date(`${endDateStr}T23:59:59`);

    let cmpS: Date | undefined;
    let cmpE: Date | undefined;
    if (hasCompare) {
      cmpS = new Date(`${compareStartDateStr}T00:00:00`);
      cmpE = new Date(`${compareEndDateStr}T23:59:59`);
    }

    setCustomRange({
      startDate: s,
      endDate: e,
      compareStartDate: cmpS,
      compareEndDate: cmpE,
    });
    setPeriodKey("custom");
    setIsOpen(false);
    setActiveView("menu");
  };

  const currentLabel =
    periodKey === "custom"
      ? resolved.periodLabel
      : (PERIOD_OPTIONS.find((o) => o.key === periodKey)?.label ?? "This Shift");

  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <Popover open={isOpen} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-medium text-foreground shadow-xs transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer select-none"
          >
            <CalendarIcon className="size-3.5 text-muted-foreground shrink-0" />
            <span className="text-muted-foreground">Period:</span>
            <span className="font-semibold text-foreground truncate max-w-[170px]">
              {currentLabel}
            </span>
            <ChevronDown className="size-3 text-muted-foreground shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className={cn(
            "p-1 shadow-xl border-border bg-background",
            activeView === "custom" ? "w-80 p-4" : "w-48",
          )}
        >
          {activeView === "menu" ? (
            <div className="flex flex-col gap-0.5">
              {PERIOD_OPTIONS.map((option) => {
                const isSelected = periodKey === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => handleSelectOption(option.key)}
                    className={cn(
                      "flex items-center justify-between rounded px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer",
                      isSelected
                        ? "bg-primary/10 font-semibold text-primary"
                        : "text-foreground hover:bg-muted/80",
                    )}
                  >
                    <span>{option.label}</span>
                    {isSelected && <Check className="size-3.5 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="space-y-3.5">
              <div className="flex items-center justify-between border-b border-border/80 pb-2">
                <button
                  type="button"
                  onClick={() => setActiveView("menu")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-foreground hover:text-primary cursor-pointer"
                >
                  <ArrowLeft className="size-3.5 text-muted-foreground" />
                  <span>Custom Date Range</span>
                </button>
                <span className="text-[10px] text-muted-foreground font-mono">Max 31 days</span>
              </div>

              {/* Date Inputs */}
              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Start Date
                  </label>
                  <input
                    type="date"
                    max={format(today, "yyyy-MM-dd")}
                    value={startDateStr}
                    onChange={(e) => setStartDateStr(e.target.value)}
                    className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">End Date</label>
                  <input
                    type="date"
                    max={format(today, "yyyy-MM-dd")}
                    value={endDateStr}
                    onChange={(e) => setEndDateStr(e.target.value)}
                    className="w-full rounded border border-border bg-surface px-2.5 py-1.5 text-xs font-mono outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Validation Error Banner */}
              {isRangeTooLong && (
                <div className="flex items-center gap-1.5 rounded bg-rose-500/10 border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>Maximum range is 1 month (31 days)</span>
                </div>
              )}

              {isEndInFuture && (
                <div className="flex items-center gap-1.5 rounded bg-rose-500/10 border border-rose-500/30 px-2.5 py-1.5 text-[11px] text-rose-600 dark:text-rose-400">
                  <AlertCircle className="size-3.5 shrink-0" />
                  <span>End date must be on or after start date</span>
                </div>
              )}

              {/* Optional Compare Range */}
              <div className="border-t border-border/70 pt-2.5">
                <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hasCompare}
                    onChange={(e) => setHasCompare(e.target.checked)}
                    className="rounded border-border text-primary focus:ring-primary"
                  />
                  <span>Custom &quot;Compare to&quot; period</span>
                </label>

                {hasCompare && (
                  <div className="mt-2.5 grid grid-cols-2 gap-2 text-xs">
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Compare Start</label>
                      <input
                        type="date"
                        max={format(today, "yyyy-MM-dd")}
                        value={compareStartDateStr}
                        onChange={(e) => setCompareStartDateStr(e.target.value)}
                        className="w-full rounded border border-border bg-surface px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">Compare End</label>
                      <input
                        type="date"
                        max={format(today, "yyyy-MM-dd")}
                        value={compareEndDateStr}
                        onChange={(e) => setCompareEndDateStr(e.target.value)}
                        className="w-full rounded border border-border bg-surface px-2 py-1 text-xs font-mono outline-none focus:border-primary"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-2.5">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveView("menu")}
                  className="h-7 text-xs px-2.5"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={isInvalid}
                  onClick={handleApplyCustom}
                  className="h-7 text-xs px-3"
                >
                  Apply
                </Button>
              </div>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
});
