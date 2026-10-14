import React, { useMemo, useState, useEffect, useRef } from "react";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  HelpCircle,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Split as SplitIcon,
  Tag,
  Trash2,
  Wrench,
  Lock,
  Calendar,
} from "lucide-react";
import {
  autoParent,
  categoriesOf,
  componentBlock,
  componentOf,
  COMPONENTS,
  parentBlock,
  PARENTS,
  type LossComponent,
  type LossParent,
} from "@/lib/oee/lossTree";
import {
  formatDuration,
  formatEventDuration,
  formatTimeWib,
  type ShiftInfo,
} from "@/lib/oee/shiftClock";
import {
  getLineSiblingMachines,
  saveEventClassification,
  saveBatchClassification,
  type EventType,
  type LossCause,
  type MachineEvent,
  type ProductionOrder,
  type ShiftSnapshot,
} from "@/lib/oee/machineEvents";
import {
  isPeriodEligible,
  isItemEligible,
  getEarliestAllowed,
  formatEarliestDateString,
  canEditClassified,
  SHOW_EMPTY_STATE_CTA,
} from "@/lib/oee/lossClarificationPolicy";
import { useApp } from "@/lib/oee/app-context";
import { usePeriod, type ResolvedPeriod } from "@/lib/oee/period";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface LossClarificationProps {
  shift: ShiftInfo;
  machineCode: string;
  orders: ProductionOrder[];
  events: MachineEvent[];
  snapshot: ShiftSnapshot;
  selectedEventId: string | null;
  onSelectEventId: (id: string | null) => void;
  selectedEventIds?: string[];
  onSelectEventIds?: (ids: string[]) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSaveSuccess?: () => void;
  resolved?: ResolvedPeriod;
  className?: string;
}

type TabKey = "unclassified" | "classified" | "all";
type StepLevel = 0 | 1 | 2 | 3;

export function LossClarification({
  shift,
  machineCode,
  orders,
  events,
  snapshot,
  selectedEventId,
  onSelectEventId,
  selectedEventIds: propSelectedEventIds,
  onSelectEventIds: propOnSelectEventIds,
  isExpanded,
  onToggleExpand,
  onSaveSuccess,
  resolved: propResolved,
  className,
}: LossClarificationProps) {
  const [internalSelectedEventIds, setInternalSelectedEventIds] = useState<string[]>([]);
  const selectedEventIds = propSelectedEventIds || internalSelectedEventIds;
  const onSelectEventIds = propOnSelectEventIds || setInternalSelectedEventIds;

  // Sync selectedEventId and selectedEventIds without infinite loops
  const prevPropIdRef = useRef(selectedEventId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedEventId !== prevPropIdRef.current) {
      prevPropIdRef.current = selectedEventId;
      if (selectedEventId && !selectedEventIds.includes(selectedEventId)) {
        onSelectEventIds([selectedEventId]);
      } else if (!selectedEventId && selectedEventIds.length > 0) {
        onSelectEventIds([]);
      }
    }
  }, [selectedEventId]);

  const prevIdsRef = useRef(selectedEventIds);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selectedEventIds !== prevIdsRef.current) {
      prevIdsRef.current = selectedEventIds;
      const primary = selectedEventIds.length > 0 ? selectedEventIds[0] : null;
      if (primary !== selectedEventId) {
        onSelectEventId(primary);
      }
    }
  }, [selectedEventIds]);

  const lockedType = useMemo(() => {
    if (selectedEventIds.length === 0) return null;
    const first = events.find((e) => e.id === selectedEventIds[0]);
    return first ? first.type : null;
  }, [selectedEventIds, events]);

  const selectedEvents = useMemo(() => {
    return selectedEventIds
      .map((id) => events.find((e) => e.id === id))
      .filter(Boolean) as MachineEvent[];
  }, [selectedEventIds, events]);

  const totalSelectedDuration = useMemo(() => {
    return selectedEvents.reduce((sum, e) => sum + e.durationSec, 0);
  }, [selectedEvents]);

  const spansMultiplePOs = useMemo(() => {
    const poSet = new Set(selectedEvents.map((e) => e.orderId));
    return poSet.size > 1;
  }, [selectedEvents]);

  const firstEventStart = useMemo(() => {
    if (selectedEvents.length === 0) return 0;
    return Math.min(...selectedEvents.map((e) => e.startAt ?? shift.startSec + e.startSec));
  }, [selectedEvents, shift.startSec]);

  const lastEventEnd = useMemo(() => {
    if (selectedEvents.length === 0) return 0;
    return Math.max(...selectedEvents.map((e) => e.endAt ?? shift.startSec + e.endSec));
  }, [selectedEvents, shift.startSec]);

  const lastCheckedIdRef = useRef<string | null>(null);

  // Esc clears selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onSelectEventIds([]);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onSelectEventIds]);
  const { role } = useApp();
  const { resolved: contextResolved, setPeriodKey } = usePeriod();
  const activeResolved = propResolved || contextResolved;

  // 7-day lookback gate: evaluated with active resolved period on shared data tick
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [shift?.shiftKey, activeResolved?.periodKey]);
  const isEligible = isPeriodEligible(activeResolved, now);
  const earliestDateStr = formatEarliestDateString(getEarliestAllowed(now));

  // Role permissions
  const isSectionHead = canEditClassified(role);

  // Tabs & filters
  const [activeTab, setActiveTab] = useState<TabKey>("unclassified");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [hideUnder1Min, setHideUnder1Min] = useState<boolean>(false);
  const [foldedOrders, setFoldedOrders] = useState<Record<string, boolean>>({});

  // Classification Form state for currently selected event
  const [activeStep, setActiveStep] = useState<StepLevel>(1);
  const [activeCauseIndex, setActiveCauseIndex] = useState<number>(0);
  const [selectedComp, setSelectedComp] = useState<LossComponent>("Availability");
  const [selectedParent, setSelectedParent] = useState<LossParent>("Breakdown");
  const [isL1Auto, setIsL1Auto] = useState<boolean>(true);
  const [selectedCatId, setSelectedCatId] = useState<string>("");
  const [selectedCatName, setSelectedCatName] = useState<string>("");
  const [selectedReasonId, setSelectedReasonId] = useState<string>("");
  const [selectedReasonName, setSelectedReasonName] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // Working split causes for the selected event
  const [workingCauses, setWorkingCauses] = useState<LossCause[]>([]);
  const [noteText, setNoteText] = useState<string>("");
  const [causeMachineCode, setCauseMachineCode] = useState<string>(machineCode);

  // Flash saved notification
  const [saveFlash, setSaveFlash] = useState<string | null>(null);

  // Line sibling machines for "Cause machine" select
  const siblingMachines = useMemo(() => getLineSiblingMachines(machineCode), [machineCode]);

  // Selected event lookup
  const selectedEvent = useMemo(() => {
    return events.find((e) => e.id === selectedEventId) || null;
  }, [events, selectedEventId]);

  // Sync working state ONLY when selected event ID changes
  const prevEventIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!selectedEventId) {
      prevEventIdRef.current = null;
      setWorkingCauses([]);
      setNoteText("");
      return;
    }

    if (prevEventIdRef.current !== selectedEventId) {
      prevEventIdRef.current = selectedEventId;

      if (!selectedEvent) return;

      setNoteText(selectedEvent.note || "");
      setCauseMachineCode(selectedEvent.causeMachineCode || machineCode);

      if (selectedEvent.causes && selectedEvent.causes.length > 0) {
        setWorkingCauses([...selectedEvent.causes]);
        const first = selectedEvent.causes[0];
        setSelectedComp(first.l0Component);
        setSelectedParent(first.l1Parent);
        setIsL1Auto(
          first.l1Parent ===
            autoParent(selectedEvent.type as "downtime" | "minor_stop" | "speed_loss" | "planned"),
        );
        setSelectedCatId(first.l2CategoryId);
        setSelectedCatName(first.l2CategoryName);
        setSelectedReasonId(first.l3ReasonId);
        setSelectedReasonName(first.l3ReasonName);
        setActiveStep(first.l3ReasonId ? 3 : first.l2CategoryId ? 2 : 1);
      } else {
        // Initialize default single cause matching event duration
        const defParent = autoParent(
          selectedEvent.type as "downtime" | "minor_stop" | "speed_loss" | "planned",
        );
        const defComp = componentOf(defParent);
        setSelectedComp(defComp);
        setSelectedParent(defParent);
        setIsL1Auto(true);
        setSelectedCatId("");
        setSelectedCatName("");
        setSelectedReasonId("");
        setSelectedReasonName("");
        setActiveStep(1);
        setWorkingCauses([
          {
            id: `C-${Date.now()}-0`,
            durationSec: selectedEvent.durationSec,
            l0Component: defComp,
            l1Parent: defParent,
            l2CategoryId: "",
            l2CategoryName: "",
            l3ReasonId: "",
            l3ReasonName: "",
            causeMachineCode: machineCode,
          },
        ]);
      }
      setActiveCauseIndex(0);
    }
  }, [selectedEventId, selectedEvent, machineCode]);

  // Keep ongoing duration in sync live without resetting selection
  useEffect(() => {
    if (selectedEvent?.isOngoing) {
      const dur = selectedEvent.durationSec;
      setWorkingCauses((prev) => {
        if (prev.length === 1 && prev[0].durationSec !== dur) {
          return [{ ...prev[0], durationSec: dur }];
        }
        return prev;
      });
    }
  }, [selectedEvent?.durationSec, selectedEvent?.isOngoing]);

  // Hourly summary buckets for collapsed strip (8 hours: 07:00..14:00)
  const hourlySummary = useMemo(() => {
    const shiftStartHour = shift.startHour;
    const hours = Array.from({ length: 8 }, (_, idx) => {
      const h = (shiftStartHour + idx) % 24;
      const hStartSec = idx * 3600;
      const hEndSec = hStartSec + 3600;
      const label = `${String(h).padStart(2, "0")}:00`;
      const isFuture = hStartSec >= shift.elapsedSec;
      const isCurrent = shift.elapsedSec >= hStartSec && shift.elapsedSec < hEndSec;

      const hourEvents = events.filter((e) => {
        if (e.type === "run") return false;
        const mid = e.startSec + e.durationSec / 2;
        return mid >= hStartSec && mid < hEndSec;
      });

      const stopCount = hourEvents.length;
      const unclassifiedCount = hourEvents.filter((e) => {
        if (e.type === "planned") return false;
        const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
        return classified < e.durationSec;
      }).length;

      return {
        label,
        isFuture,
        isCurrent,
        stopCount,
        unclassifiedCount,
      };
    });
    return hours;
  }, [events, shift]);

  // Filtered and grouped event list
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.type === "run") return false;
      if (hideUnder1Min && e.durationSec < 60) return false;

      if (typeFilter !== "all" && e.type !== typeFilter) return false;

      const isClassified =
        e.type === "planned" ||
        (e.causes.length > 0 &&
          e.causes.reduce((sum, c) => sum + c.durationSec, 0) >= e.durationSec);

      if (activeTab === "unclassified") return !isClassified;
      if (activeTab === "classified") return isClassified;
      return true;
    });
  }, [events, activeTab, typeFilter, hideUnder1Min]);

  // Invariant assertion (§2.3): When period is eligible, every displayed item must be eligible
  useEffect(() => {
    if (isEligible) {
      filteredEvents.forEach((ev) => {
        if (!isItemEligible(ev.startAt, now)) {
          console.error(
            `[OEE] Invariant violation: Displayed item ${ev.id} with startAt=${ev.startAt} (${new Date(ev.startAt).toISOString()}) failed isItemEligible`,
            ev,
          );
        }
      });
    }
  }, [isEligible, filteredEvents, now]);

  // Group filtered events by production order
  const eventsByOrder = useMemo(() => {
    const groups: { order: ProductionOrder; events: MachineEvent[] }[] = [];
    orders.forEach((order) => {
      const ordEvents = filteredEvents.filter((e) => e.orderId === order.id);
      if (ordEvents.length > 0) {
        // Sort newest first
        ordEvents.sort((a, b) => b.startSec - a.startSec);
        groups.push({ order, events: ordEvents });
      }
    });
    return groups;
  }, [orders, filteredEvents]);

  const handleCheckboxClick = (e: React.MouseEvent, ev: MachineEvent) => {
    e.stopPropagation();
    const isChecked = selectedEventIds.includes(ev.id);
    const nativeEvent = e.nativeEvent as MouseEvent;

    if (nativeEvent.shiftKey && lastCheckedIdRef.current) {
      const eligibleList = filteredEvents.filter((item) => {
        if (item.isOngoing) return false;
        if (lockedType && item.type !== lockedType) return false;
        if (!isItemEligible(item.startAt, now)) return false;
        const isClassified =
          item.type === "planned" ||
          (item.causes.length > 0 &&
            item.causes.reduce((s, c) => s + c.durationSec, 0) >= item.durationSec);
        if (isClassified && !isSectionHead) return false;
        return true;
      });

      const lastIdx = eligibleList.findIndex((item) => item.id === lastCheckedIdRef.current);
      const currIdx = eligibleList.findIndex((item) => item.id === ev.id);

      if (lastIdx !== -1 && currIdx !== -1) {
        const start = Math.min(lastIdx, currIdx);
        const end = Math.max(lastIdx, currIdx);
        const rangeIds = eligibleList.slice(start, end + 1).map((item) => item.id);
        const newSet = new Set([...selectedEventIds, ...rangeIds]);
        onSelectEventIds(Array.from(newSet));
        lastCheckedIdRef.current = ev.id;
        return;
      }
    }

    if (isChecked) {
      const next = selectedEventIds.filter((id) => id !== ev.id);
      onSelectEventIds(next);
      if (next.length === 0) {
        lastCheckedIdRef.current = null;
      }
    } else {
      if (lockedType && ev.type !== lockedType) {
        toast.error("Mixed types are not allowed in one group");
        return;
      }
      onSelectEventIds([...selectedEventIds, ev.id]);
      lastCheckedIdRef.current = ev.id;
    }
  };

  const handleBatchSave = () => {
    if (selectedEventIds.length < 2 || !selectedReasonId || !lockedType) return;

    const items = selectedEvents.map((e) => ({
      shiftKey: shift.shiftKey,
      eventId: e.id,
      startAt: e.startAt ?? shift.startSec + e.startSec,
      durationSec: e.durationSec,
      type: e.type,
      isOngoing: e.isOngoing,
      isAlreadyClassified:
        e.type === "planned" ||
        (e.causes.length > 0 && e.causes.reduce((s, c) => s + c.durationSec, 0) >= e.durationSec),
    }));

    const res = saveBatchClassification({
      machineCode,
      items,
      causeTemplate: {
        l0Component: selectedComp,
        l1Parent: selectedParent,
        l2CategoryId: selectedCatId,
        l2CategoryName: selectedCatName,
        l3ReasonId: selectedReasonId,
        l3ReasonName: selectedReasonName,
      },
      note: noteText,
      causeMachineCode,
      role,
      lockedType,
    });

    if (res && !res.success && res.failures) {
      toast.error(
        `Batch save failed for ${res.failures.length} event(s): ${res.failures
          .map((f) => f.reason)
          .join(", ")}`,
      );
      return;
    }

    setSaveFlash(`Saved · ${selectedReasonName} (${selectedEventIds.length} events)`);
    setTimeout(() => setSaveFlash(null), 3200);

    onSaveSuccess?.();

    onSelectEventIds([]);
    const nextUnclassified = events.find((e) => {
      if (e.type === "planned" || e.isOngoing || selectedEventIds.includes(e.id)) return false;
      const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
      return classified < e.durationSec;
    });

    if (nextUnclassified) {
      onSelectEventId(nextUnclassified.id);
    } else {
      onSelectEventId(null);
    }
  };

  // Tab counts
  const unclassifiedTotal = useMemo(() => {
    return events.filter((e) => {
      if (e.type === "run" || e.type === "planned") return false;
      const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
      return classified < e.durationSec;
    }).length;
  }, [events]);

  const classifiedTotal = useMemo(() => {
    return events.filter((e) => {
      if (e.type === "run") return false;
      if (e.type === "planned") return true;
      const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
      return classified >= e.durationSec && e.causes.length > 0;
    }).length;
  }, [events]);

  // Categories under active parent
  const activeCategories = useMemo(() => categoriesOf(selectedParent), [selectedParent]);

  // All reasons for search
  const allSearchableReasons = useMemo(() => {
    const list: {
      comp: LossComponent;
      parent: LossParent;
      catId: string;
      catName: string;
      reasonId: string;
      reasonName: string;
    }[] = [];
    PARENTS.forEach((p) => {
      p.categories.forEach((cat) => {
        cat.reasons.forEach((r) => {
          list.push({
            comp: p.component,
            parent: p.id,
            catId: cat.id,
            catName: cat.name,
            reasonId: r.id,
            reasonName: r.name,
          });
        });
      });
    });
    return list;
  }, []);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return allSearchableReasons.filter(
      (item) =>
        item.reasonName.toLowerCase().includes(q) ||
        item.catName.toLowerCase().includes(q) ||
        item.parent.toLowerCase().includes(q),
    );
  }, [allSearchableReasons, searchQuery]);

  // Split management
  const handleAddSplit = () => {
    if (!selectedEvent || selectedEvent.isOngoing || workingCauses.length >= 4) return;
    const remainingSec = Math.max(
      30,
      selectedEvent.durationSec - workingCauses.reduce((sum, c) => sum + c.durationSec, 0),
    );
    const newCause: LossCause = {
      id: `C-${Date.now()}-${workingCauses.length}`,
      durationSec: Math.min(60, remainingSec),
      l0Component: selectedComp,
      l1Parent: selectedParent,
      l2CategoryId: "",
      l2CategoryName: "",
      l3ReasonId: "",
      l3ReasonName: "",
      causeMachineCode: machineCode,
    };
    const updated = [...workingCauses, newCause];
    setWorkingCauses(updated);
    setActiveCauseIndex(updated.length - 1);
  };

  const handleRemoveSplit = (index: number) => {
    if (workingCauses.length <= 1) return;
    const updated = workingCauses.filter((_, idx) => idx !== index);
    setWorkingCauses(updated);
    setActiveCauseIndex(Math.max(0, index - 1));
  };

  const handleAdjustCauseDuration = (index: number, deltaSec: number) => {
    if (workingCauses.length <= 1) return;
    const cur = workingCauses[index];
    const newDur = Math.max(30, cur.durationSec + deltaSec);
    const updated = [...workingCauses];
    updated[index] = { ...cur, durationSec: newDur };
    setWorkingCauses(updated);
  };

  // Selection handlers
  const handlePickComponent = (comp: LossComponent) => {
    setSelectedComp(comp);
    const validParents = PARENTS.filter(
      (p) =>
        p.component === comp &&
        !parentBlock(
          p.id,
          selectedEvent?.type as "downtime" | "minor_stop" | "speed_loss" | "planned",
        ),
    );
    if (validParents.length === 1) {
      handlePickParent(validParents[0].id);
    } else {
      const firstParent = validParents[0] || PARENTS.find((p) => p.component === comp);
      if (firstParent) {
        setSelectedParent(firstParent.id);
        setIsL1Auto(false);
      }
      setActiveStep(1);
    }
  };

  const handlePickParent = (parent: LossParent) => {
    const isSameParent = parent === selectedParent;
    const autoP = selectedEvent
      ? autoParent(selectedEvent.type as "downtime" | "minor_stop" | "speed_loss" | "planned")
      : null;
    const isAuto = parent === autoP;

    setSelectedParent(parent);
    setSelectedComp(componentOf(parent));
    setIsL1Auto(isAuto);

    let nextCatId = isSameParent ? selectedCatId : "";
    let nextCatName = isSameParent ? selectedCatName : "";
    let nextReasonId = isSameParent ? selectedReasonId : "";
    let nextReasonName = isSameParent ? selectedReasonName : "";

    const cats = categoriesOf(parent);
    if (!isSameParent && cats.length === 1) {
      nextCatId = cats[0].id;
      nextCatName = cats[0].name;
      if (cats[0].reasons.length === 1) {
        nextReasonId = cats[0].reasons[0].id;
        nextReasonName = cats[0].reasons[0].name;
      }
    }

    setSelectedCatId(nextCatId);
    setSelectedCatName(nextCatName);
    setSelectedReasonId(nextReasonId);
    setSelectedReasonName(nextReasonName);

    const nextStep = nextCatId ? 3 : 2;
    setActiveStep(nextStep);

    // Sync cause in workingCauses
    const updated = [...workingCauses];
    if (updated[activeCauseIndex]) {
      updated[activeCauseIndex] = {
        ...updated[activeCauseIndex],
        l0Component: componentOf(parent),
        l1Parent: parent,
        l2CategoryId: nextCatId,
        l2CategoryName: nextCatName,
        l3ReasonId: nextReasonId,
        l3ReasonName: nextReasonName,
        causeMachineCode,
      };
      setWorkingCauses(updated);
    }
  };

  const handlePickCategory = (catId: string, catName: string) => {
    setSelectedCatId(catId);
    setSelectedCatName(catName);

    const cats = categoriesOf(selectedParent);
    const catObj = cats.find((c) => c.id === catId);
    let nextReasonId = "";
    let nextReasonName = "";
    if (catObj && catObj.reasons.length === 1) {
      nextReasonId = catObj.reasons[0].id;
      nextReasonName = catObj.reasons[0].name;
    }

    setSelectedReasonId(nextReasonId);
    setSelectedReasonName(nextReasonName);
    setActiveStep(3);

    const updated = [...workingCauses];
    if (updated[activeCauseIndex]) {
      updated[activeCauseIndex] = {
        ...updated[activeCauseIndex],
        l2CategoryId: catId,
        l2CategoryName: catName,
        l3ReasonId: nextReasonId,
        l3ReasonName: nextReasonName,
        causeMachineCode,
      };
      setWorkingCauses(updated);
    }
  };

  const handlePickReason = (reasonId: string, reasonName: string) => {
    setSelectedReasonId(reasonId);
    setSelectedReasonName(reasonName);
    setActiveStep(3);

    // Apply to current working cause
    const updated = [...workingCauses];
    if (updated[activeCauseIndex]) {
      updated[activeCauseIndex] = {
        ...updated[activeCauseIndex],
        l0Component: selectedComp,
        l1Parent: selectedParent,
        l2CategoryId: selectedCatId,
        l2CategoryName: selectedCatName,
        l3ReasonId: reasonId,
        l3ReasonName: reasonName,
        causeMachineCode,
      };
      setWorkingCauses(updated);
    }
  };

  const handleQuickPickSearchResult = (item: (typeof allSearchableReasons)[0]) => {
    setSelectedComp(item.comp);
    setSelectedParent(item.parent);
    setIsL1Auto(false);
    setSelectedCatId(item.catId);
    setSelectedCatName(item.catName);
    setSelectedReasonId(item.reasonId);
    setSelectedReasonName(item.reasonName);
    setActiveStep(3);
    setSearchQuery("");

    const updated = [...workingCauses];
    if (updated[activeCauseIndex]) {
      updated[activeCauseIndex] = {
        ...updated[activeCauseIndex],
        l0Component: item.comp,
        l1Parent: item.parent,
        l2CategoryId: item.catId,
        l2CategoryName: item.catName,
        l3ReasonId: item.reasonId,
        l3ReasonName: item.reasonName,
        causeMachineCode,
      };
      setWorkingCauses(updated);
    }
  };

  const handleResetToAutoL1 = () => {
    if (!selectedEvent) return;
    const defParent = autoParent(
      selectedEvent.type as "downtime" | "minor_stop" | "speed_loss" | "planned",
    );
    handlePickParent(defParent);
  };

  // Save classification handler
  const handleSave = () => {
    if (!selectedEvent || workingCauses.length === 0) return;

    // Check role permission if event is already classified
    const classifiedDuration = selectedEvent.causes.reduce((sum, c) => sum + c.durationSec, 0);
    const isAlreadyClassified =
      selectedEvent.type === "planned" ||
      (selectedEvent.causes.length > 0 && classifiedDuration >= selectedEvent.durationSec);

    if (isAlreadyClassified && !isSectionHead) {
      toast.error("Only Section Head can edit classified loss");
      return;
    }

    // Persist classification using canonical absolute epoch milliseconds (§2.1, §2.4)
    const eventStartAt = selectedEvent.startAt ?? (shift.startSec + selectedEvent.startSec) * 1000;

    const res = saveEventClassification(
      shift.shiftKey,
      machineCode,
      selectedEvent.id,
      workingCauses,
      noteText,
      causeMachineCode,
      role,
      eventStartAt,
    );

    if (res && !res.success) {
      return;
    }

    const primaryCause = workingCauses[0];
    const pathStr = primaryCause
      ? `${primaryCause.l1Parent} › ${primaryCause.l2CategoryName || primaryCause.l2CategoryId} › ${primaryCause.l3ReasonName || primaryCause.l3ReasonId}`
      : "Classified";

    setSaveFlash(`Saved · ${pathStr}`);
    setTimeout(() => {
      setSaveFlash(null);
    }, 3200);

    if (isAlreadyClassified) {
      toast.success("Classification updated");
    } else {
      toast.success("Classification saved");
    }

    onSaveSuccess?.();

    // If editing already-classified item, keep it selected in Classified (§2.5)
    if (isAlreadyClassified) {
      onSelectEventId(selectedEvent.id);
    } else {
      // Auto-advance to next unclassified non-planned non-ongoing event (§3.6)
      const nextUnclassified = events.find((e) => {
        if (e.id === selectedEvent.id || e.type === "planned" || e.isOngoing) return false;
        const classified = e.causes.reduce((sum, c) => sum + c.durationSec, 0);
        return classified < e.durationSec;
      });

      if (nextUnclassified) {
        onSelectEventId(nextUnclassified.id);
      } else {
        onSelectEventId(null);
      }
    }
  };

  // -------------------------------------------------------------
  // RENDER: COLLAPSED STRIP VIEW
  // -------------------------------------------------------------
  if (!isExpanded) {
    return (
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/80 bg-surface/95 px-4 py-2.5 shadow-xs backdrop-blur-md transition-all hover:border-border cursor-pointer select-none",
          className,
        )}
        onClick={onToggleExpand}
      >
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <h3 className="text-xs font-bold text-foreground">Loss Clarification</h3>
            <p className="text-[10px] text-muted-foreground">Stops per hour</p>
          </div>

          {/* 8 Hourly Cells */}
          <div className="flex items-center gap-1.5 overflow-x-auto">
            {hourlySummary.map((cell) => (
              <div
                key={cell.label}
                className={cn(
                  "flex flex-col items-center justify-center rounded border px-2 py-1 text-center text-[10px] min-w-[42px]",
                  cell.isCurrent
                    ? "border-primary bg-primary/10 font-bold"
                    : "border-border/70 bg-background/60",
                )}
              >
                <span className="text-[9px] text-muted-foreground">{cell.label}</span>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="font-mono font-semibold">
                    {cell.isFuture ? "-" : cell.stopCount}
                  </span>
                  {!cell.isFuture && cell.unclassifiedCount > 0 && (
                    <span className="flex size-3.5 items-center justify-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">
                      {cell.unclassifiedCount}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Totals & Expand Chevron */}
        <div className="flex items-center gap-3">
          <div className="text-right text-xs">
            <span className="font-semibold text-foreground">
              {snapshot.stopsThisShift} stops · {snapshot.totalLossMin}m
            </span>
            {snapshot.unclassifiedCount > 0 ? (
              <span className="ml-2 font-bold text-destructive">
                {snapshot.unclassifiedCount} unclassified ·{" "}
                {formatDuration(snapshot.unclassifiedSec)}
              </span>
            ) : (
              <span className="ml-2 font-medium text-tier-good">All classified</span>
            )}
          </div>
          <button
            type="button"
            className="flex size-7 items-center justify-center rounded-md border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Expand Loss Clarification"
          >
            <ChevronDown className="size-4" />
          </button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------
  // RENDER: EXPANDED FULL VIEW
  // -------------------------------------------------------------
  const totalClassifiedSec = workingCauses.reduce((sum, c) => sum + c.durationSec, 0);
  const eventDuration = selectedEvent?.durationSec || 0;
  const isFullyClassified = totalClassifiedSec >= eventDuration && selectedReasonId !== "";
  const isFullyClassifiedEvent = Boolean(
    selectedEvent &&
    (selectedEvent.type === "planned" ||
      (selectedEvent.causes.length > 0 &&
        selectedEvent.causes.reduce((sum, c) => sum + c.durationSec, 0) >=
          selectedEvent.durationSec)),
  );
  const isOngoing = Boolean(selectedEvent?.isOngoing);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-surface shadow-xs overflow-hidden transition-all",
        className,
      )}
    >
      {/* Top Header: Title, Tabs/Chip, Summary Status, Collapse Chevron */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface/90 px-4 py-2.5">
        <div className="flex items-center gap-4">
          <h3
            className="text-xs font-bold text-foreground cursor-pointer flex items-center gap-1.5"
            onClick={onToggleExpand}
          >
            <span>Loss Clarification</span>
          </h3>

          {!isEligible ? (
            <span className="inline-flex items-center rounded-full bg-muted border border-border px-2 py-0.5 text-[10px] font-semibold text-muted-foreground font-mono">
              Last 7 days only
            </span>
          ) : (
            /* Filter Tabs */
            <div className="flex items-center rounded-md border border-border/80 bg-background/80 p-0.5 text-xs font-medium">
              <button
                type="button"
                onClick={() => setActiveTab("unclassified")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors cursor-pointer",
                  activeTab === "unclassified"
                    ? "bg-surface font-bold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>Unclassified</span>
                <span
                  className={cn(
                    "ml-1.5 font-mono text-[11px] font-bold",
                    unclassifiedTotal > 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                  data-metric="unclassified-tab-count"
                >
                  {unclassifiedTotal}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("classified")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors cursor-pointer",
                  activeTab === "classified"
                    ? "bg-surface font-bold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>Classified</span>
                <span
                  className="ml-1.5 font-mono text-[11px] text-muted-foreground"
                  data-metric="classified-tab-count"
                >
                  {classifiedTotal}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("all")}
                className={cn(
                  "rounded px-2.5 py-1 text-xs transition-colors cursor-pointer",
                  activeTab === "all"
                    ? "bg-surface font-bold text-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>All</span>
                <span
                  className="ml-1.5 font-mono text-[11px] text-muted-foreground"
                  data-metric="all-tab-count"
                >
                  {events.filter((e) => e.type !== "run").length}
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Header Right Text & Flash & Collapse */}
        <div className="flex items-center gap-3">
          {!isEligible ? (
            <span
              className="text-xs font-mono font-medium text-muted-foreground cursor-help"
              title="Loss clarification is available for the last 7 days only"
            >
              —
            </span>
          ) : saveFlash ? (
            <span className="inline-flex items-center gap-1 rounded bg-tier-good/20 px-2 py-0.5 text-xs font-bold text-tier-good animate-in fade-in duration-200">
              <Check className="size-3.5" />
              <span>{saveFlash}</span>
            </span>
          ) : unclassifiedTotal > 0 ? (
            <span className="text-xs font-bold text-destructive" aria-live="polite">
              {unclassifiedTotal} need a reason · {formatDuration(snapshot.unclassifiedSec)}
            </span>
          ) : (
            <span className="text-xs font-semibold text-tier-good" aria-live="polite">
              Every loss has a reason
            </span>
          )}

          <button
            type="button"
            onClick={onToggleExpand}
            className="flex size-7 items-center justify-center rounded-md border border-border/80 bg-background hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            title="Collapse panel"
          >
            <ChevronUp className="size-4" />
          </button>
        </div>
      </div>

      {!isEligible ? (
        /* Empty State: Center in card min-h-[280px] */
        <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center bg-surface">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground mb-3 border border-border">
            <Calendar className="size-6 text-muted-foreground" />
          </div>
          <h4 className="text-sm font-bold text-foreground mb-1.5">
            Loss clarification is unavailable for this period
          </h4>
          <p className="text-xs text-muted-foreground max-w-md leading-relaxed mb-1">
            Loss can only be clarified within the last 7 days (from {earliestDateStr}). The selected
            period, {activeResolved?.periodLabel || "Custom Range"}, goes beyond that range.
          </p>
          <p className="text-[11px] text-muted-foreground/80 mb-4">
            Choose This Shift, Today, This Week, or a custom range within the last 7 days.
          </p>
          {SHOW_EMPTY_STATE_CTA && (
            <button
              type="button"
              onClick={() => setPeriodKey("this-week")}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs hover:bg-primary/90 transition-all cursor-pointer"
            >
              <span>Use This Week</span>
            </button>
          )}
        </div>
      ) : (
        /* Main Body: 2 Columns (Left = Event List, Right = Multi-layer Classification Form) */
        <div className="grid grid-cols-1 lg:grid-cols-12 min-h-[460px] divide-y lg:divide-y-0 lg:divide-x divide-border">
          {/* ========================================================= */}
          {/* LEFT COLUMN: Event List (5 cols desktop) */}
          {/* ========================================================= */}
          <div className="lg:col-span-5 flex flex-col min-h-0 bg-background/40">
            {/* Header Toolbar when >= 1 selected */}
            {selectedEventIds.length > 0 && (
              <div className="flex items-center justify-between bg-primary/10 border-b border-primary/20 px-3 py-1.5 text-xs">
                <span className="font-semibold text-foreground">
                  {selectedEventIds.length} selected · {formatDuration(totalSelectedDuration)}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectEventIds([])}
                    className="text-muted-foreground hover:text-foreground text-[11px] underline cursor-pointer"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const matching = filteredEvents
                        .filter((e) => {
                          if (e.isOngoing) return false;
                          if (lockedType && e.type !== lockedType) return false;
                          if (!isItemEligible(e.startAt, now)) return false;
                          const isClassified =
                            e.type === "planned" ||
                            (e.causes.length > 0 &&
                              e.causes.reduce((s, c) => s + c.durationSec, 0) >= e.durationSec);
                          if (isClassified && !isSectionHead) return false;
                          return true;
                        })
                        .map((e) => e.id);
                      onSelectEventIds(matching);
                    }}
                    className="rounded bg-primary text-primary-foreground px-2 py-0.5 text-[10px] font-bold cursor-pointer"
                  >
                    Select all of this type
                  </button>
                  {(() => {
                    const lastCheckedEv =
                      events.find((e) => e.id === lastCheckedIdRef.current) ||
                      selectedEvents[selectedEvents.length - 1];
                    if (!lastCheckedEv?.plcAlarm) return null;
                    return (
                      <button
                        type="button"
                        onClick={() => {
                          const alarm = lastCheckedEv.plcAlarm;
                          const matching = filteredEvents
                            .filter((e) => {
                              if (e.isOngoing) return false;
                              if (lockedType && e.type !== lockedType) return false;
                              if (e.plcAlarm !== alarm) return false;
                              if (!isItemEligible(e.startAt, now)) return false;
                              const isClassified =
                                e.type === "planned" ||
                                (e.causes.length > 0 &&
                                  e.causes.reduce((s, c) => s + c.durationSec, 0) >= e.durationSec);
                              if (isClassified && !isSectionHead) return false;
                              return true;
                            })
                            .map((e) => e.id);
                          onSelectEventIds(matching);
                        }}
                        className="rounded bg-primary/20 text-primary px-2 py-0.5 text-[10px] font-bold cursor-pointer"
                        title={`Select all with alarm ${lastCheckedEv.plcAlarm}`}
                      >
                        Select similar
                      </button>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Filter row */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 p-2.5 text-xs bg-surface/50">
              <div className="flex items-center gap-2">
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="h-7 rounded border border-border bg-background px-2 text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                >
                  <option value="all">All types</option>
                  <option value="downtime">Downtime (≥10m)</option>
                  <option value="minor_stop">Minor stop (&lt;10m)</option>
                  <option value="speed_loss">Speed loss</option>
                  <option value="planned">Planned stop</option>
                </select>

                <label className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={hideUnder1Min}
                    onChange={(e) => setHideUnder1Min(e.target.checked)}
                    className="size-3.5 rounded border-border text-primary focus:ring-0 cursor-pointer"
                  />
                  <span>Hide &lt; 1 min</span>
                </label>
              </div>

              <span className="text-[11px] text-muted-foreground font-mono">
                {filteredEvents.length} shown
              </span>
            </div>

            {/* Event list grouped by PO */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2.5 max-h-[480px]">
              {eventsByOrder.length === 0 ? (
                <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground">
                  <p className="text-xs">No events match these filters.</p>
                </div>
              ) : (
                eventsByOrder.map(({ order, events: ordEvents }) => {
                  const isFolded = foldedOrders[order.id] ?? false;
                  return (
                    <div
                      key={order.id}
                      className="rounded-md border border-border/80 bg-surface/90 overflow-hidden shadow-2xs"
                    >
                      {/* Sticky PO Group Header */}
                      <div
                        className="flex items-center justify-between px-3 py-1.5 bg-muted/40 border-b border-border/60 text-xs font-semibold cursor-pointer select-none hover:bg-muted/70 transition-colors"
                        onClick={() =>
                          setFoldedOrders((prev) => ({ ...prev, [order.id]: !isFolded }))
                        }
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="font-mono font-bold text-foreground">{order.id}</span>
                          <span className="text-muted-foreground font-normal truncate max-w-[200px]">
                            {order.sku} · {order.productName}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 text-muted-foreground font-mono text-[11px]">
                          <span>{ordEvents.length}</span>
                          {isFolded ? (
                            <Plus className="size-3.5" />
                          ) : (
                            <Minus className="size-3.5" />
                          )}
                        </div>
                      </div>

                      {/* Event Rows */}
                      {!isFolded && (
                        <div className="divide-y divide-border/60">
                          {ordEvents.map((ev) => {
                            const isSelected = ev.id === selectedEventId;
                            const classifiedDuration = ev.causes.reduce(
                              (sum, c) => sum + c.durationSec,
                              0,
                            );
                            const isFullySet =
                              ev.type === "planned" ||
                              (ev.causes.length > 0 && classifiedDuration >= ev.durationSec);
                            const isPartial =
                              ev.causes.length > 0 && classifiedDuration < ev.durationSec;

                            // Format time range strictly from canonical absolute timestamps (§2.1)
                            const timeRange = `${formatTimeWib(
                              ev.startAt ?? shift.startSec + ev.startSec,
                              true,
                            )} – ${
                              ev.isOngoing
                                ? "now"
                                : formatTimeWib(ev.endAt ?? shift.startSec + ev.endSec, true)
                            }`;

                            // Reason description text
                            const reasonSummary =
                              ev.causes.length > 1
                                ? `${ev.causes.length} causes`
                                : ev.causes.length === 1
                                  ? ev.causes[0].l3ReasonName
                                  : ev.plcAlarm || "";

                            const isSelectedInGroup = selectedEventIds.includes(ev.id);
                            const isAlreadyClassified =
                              ev.type === "planned" ||
                              (ev.causes.length > 0 &&
                                ev.causes.reduce((s, c) => s + c.durationSec, 0) >= ev.durationSec);
                            const isDisabled =
                              ev.isOngoing ||
                              !isItemEligible(ev.startAt, now) ||
                              (lockedType !== null && ev.type !== lockedType) ||
                              (isAlreadyClassified && !isSectionHead);
                            const disabledTooltip = ev.isOngoing
                              ? "Ongoing stop"
                              : !isItemEligible(ev.startAt, now)
                                ? "Only the last 7 days can be clarified"
                                : lockedType !== null && ev.type !== lockedType
                                  ? "Different loss type"
                                  : isAlreadyClassified && !isSectionHead
                                    ? "Only Section Head can edit classified loss"
                                    : "";

                            return (
                              <div
                                key={ev.id}
                                onClick={() => onSelectEventId(ev.id)}
                                className={cn(
                                  "flex items-start gap-2.5 p-2.5 text-xs transition-all cursor-pointer relative",
                                  isSelected
                                    ? "bg-primary/10 border-l-4 border-l-primary"
                                    : "hover:bg-muted/50 border-l-4",
                                  isSelectedInGroup && !isSelected && "bg-primary/5",
                                  isDisabled && "opacity-60",
                                  !isSelected &&
                                    ev.type === "downtime" &&
                                    "border-l-[var(--loss-down)]",
                                  !isSelected &&
                                    ev.type === "minor_stop" &&
                                    "border-l-[var(--loss-minor)]",
                                  !isSelected &&
                                    ev.type === "speed_loss" &&
                                    "border-l-[var(--loss-speed)]",
                                  !isSelected &&
                                    ev.type === "planned" &&
                                    "border-l-[var(--loss-planned)]",
                                )}
                              >
                                {/* Checkbox */}
                                <input
                                  type="checkbox"
                                  checked={isSelectedInGroup}
                                  disabled={isDisabled}
                                  title={disabledTooltip}
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={(e) =>
                                    handleCheckboxClick(e as unknown as React.MouseEvent, ev)
                                  }
                                  className={cn(
                                    "size-4 rounded border-border text-primary focus:ring-0 cursor-pointer shrink-0 mt-0.5",
                                    isDisabled && "opacity-40 cursor-not-allowed",
                                  )}
                                />

                                {/* Center: Type + Duration + Range + Reason */}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-foreground">
                                      {ev.type === "downtime"
                                        ? "Downtime"
                                        : ev.type === "minor_stop"
                                          ? "Minor stop"
                                          : ev.type === "speed_loss"
                                            ? "Speed loss"
                                            : "Planned stop"}{" "}
                                      <span className="font-mono font-semibold">
                                        {formatEventDuration(ev.durationSec)}
                                      </span>
                                    </span>
                                    {ev.speedPct && (
                                      <span className="text-muted-foreground font-mono text-[11px]">
                                        · {ev.speedPct}% speed
                                      </span>
                                    )}
                                  </div>

                                  <p className="font-mono text-[11px] text-muted-foreground mt-0.5">
                                    {timeRange}
                                  </p>

                                  {reasonSummary && (
                                    <p className="text-[11px] text-foreground/80 truncate mt-1">
                                      {reasonSummary}
                                    </p>
                                  )}
                                </div>

                                {/* Right tag pill */}
                                <div className="shrink-0 flex flex-col items-end gap-1">
                                  {ev.isOngoing && (
                                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-2 py-0.5 text-[10px] font-bold">
                                      <span className="size-1.5 rounded-full bg-amber-500 animate-pulse" />
                                      <span>Ongoing</span>
                                    </span>
                                  )}
                                  {!ev.isOngoing && ev.source === "PLC" && (
                                    <span className="rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/30 px-1.5 py-0.5 text-[10px] font-bold font-mono">
                                      PLC
                                    </span>
                                  )}
                                  {!ev.isOngoing && ev.source === "Operator" && (
                                    <span className="rounded bg-muted text-muted-foreground border border-border px-1.5 py-0.5 text-[10px] font-medium">
                                      Operator
                                    </span>
                                  )}
                                  {!ev.isOngoing && ev.source === "You" && (
                                    <span className="rounded bg-tier-good/20 text-tier-good border border-tier-good/40 px-1.5 py-0.5 text-[10px] font-bold">
                                      You
                                    </span>
                                  )}
                                  {isFullySet && !ev.isOngoing && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded bg-muted/80 text-muted-foreground border border-border px-1.5 py-0.5 text-[10px] font-medium"
                                      title={
                                        !isSectionHead
                                          ? "Classified · Read-only for Shift Leader"
                                          : "Classified · Editable by Section Head"
                                      }
                                    >
                                      {!isSectionHead ? (
                                        <Lock className="size-2.5 text-muted-foreground" />
                                      ) : (
                                        <Check className="size-2.5 text-tier-good" />
                                      )}
                                      <span>Classified</span>
                                    </span>
                                  )}
                                  {!isFullySet && !ev.isOngoing && !isPartial && (
                                    <span className="rounded bg-destructive/15 text-destructive border border-destructive/30 px-1.5 py-0.5 text-[10px] font-bold">
                                      Needs reason
                                    </span>
                                  )}
                                  {isPartial && !ev.isOngoing && (
                                    <span className="rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 px-1.5 py-0.5 text-[10px] font-bold">
                                      Partial
                                    </span>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* ========================================================= */}
          {/* RIGHT COLUMN: Multi-layer Classification Form (7 cols desktop) */}
          {/* ========================================================= */}
          <div className="lg:col-span-7 flex flex-col min-h-0 bg-surface">
            {!selectedEvent ? (
              <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
                <HelpCircle className="size-8 text-muted-foreground/60 mb-2" />
                <p className="text-xs font-medium">
                  Select an event from the list to classify its root cause.
                </p>
              </div>
            ) : isFullyClassifiedEvent && !isSectionHead ? (
              /* READ-ONLY MODE for Shift Leader on classified loss (§3) */
              <div className="flex flex-1 flex-col justify-between select-none">
                {/* Muted header notice line */}
                <div className="flex items-center gap-2 border-b border-border/80 bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground">
                  <Lock className="size-3.5 text-muted-foreground shrink-0" />
                  <span className="font-medium">
                    Read-only · Only Section Head can edit classified loss
                  </span>
                </div>

                {/* Read-only body: Event metadata & non-interactive L0 > L1 > L2 > L3 chips */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Event Summary Card */}
                  <div className="rounded-lg border border-border bg-card/60 p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-foreground text-sm">
                          {selectedEvent.type === "downtime"
                            ? "Downtime"
                            : selectedEvent.type === "minor_stop"
                              ? "Minor stop"
                              : selectedEvent.type === "speed_loss"
                                ? "Speed loss"
                                : "Planned stop"}
                        </span>
                        <span className="font-mono text-xs font-semibold text-foreground/90 bg-muted px-2 py-0.5 rounded border border-border">
                          {formatEventDuration(selectedEvent.durationSec)}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-muted-foreground">
                        {formatTimeWib(
                          selectedEvent.startAt ?? shift.startSec + selectedEvent.startSec,
                          true,
                        )}{" "}
                        –{" "}
                        {selectedEvent.isOngoing
                          ? "now"
                          : formatTimeWib(
                              selectedEvent.endAt ?? shift.startSec + selectedEvent.endSec,
                              true,
                            )}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-border/60 text-[11px]">
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Machine</span>
                        <span className="font-mono font-semibold text-foreground">
                          {machineCode}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">
                          Cause Machine
                        </span>
                        <span className="font-mono font-semibold text-foreground">
                          {selectedEvent.causeMachineCode || machineCode}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Time</span>
                        <span className="font-mono font-medium text-foreground">
                          {formatTimeWib(
                            selectedEvent.startAt ?? shift.startSec + selectedEvent.startSec,
                            true,
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-muted-foreground block text-[10px]">Classifier</span>
                        <span className="font-medium text-foreground">
                          {selectedEvent.source || "Section Head"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Causes List with Non-Interactive L0 > L1 > L2 > L3 Path Chips */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-foreground flex items-center justify-between">
                      <span>Classified Root Causes ({selectedEvent.causes.length})</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Read-only chips
                      </span>
                    </h4>

                    {selectedEvent.causes.map((c, idx) => (
                      <div
                        key={c.id || idx}
                        className="rounded-lg border border-border bg-surface p-3.5 space-y-2.5 shadow-2xs"
                      >
                        {/* Non-interactive L0 > L1 > L2 > L3 breadcrumb chips */}
                        <div className="flex flex-wrap items-center gap-1.5 text-xs">
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground border border-border">
                            L0: {c.l0Component}
                          </span>
                          <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground border border-border">
                            L1: {c.l1Parent}
                          </span>
                          <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground border border-border">
                            L2: {c.l2CategoryName || c.l2CategoryId}
                          </span>
                          <ChevronRight className="size-3 text-muted-foreground/60 shrink-0" />
                          <span className="rounded bg-muted px-2 py-0.5 text-[11px] font-bold text-foreground border border-border">
                            L3: {c.l3ReasonName || c.l3ReasonId}
                          </span>
                        </div>

                        {/* Cause info & duration */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-border/50">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[11px] text-muted-foreground font-semibold">
                              {c.l3ReasonId}
                            </span>
                            <span className="font-semibold text-foreground">{c.l3ReasonName}</span>
                          </div>
                          <span className="font-mono text-xs font-bold text-foreground">
                            {formatEventDuration(c.durationSec)}
                          </span>
                        </div>
                      </div>
                    ))}

                    {/* Note block */}
                    <div className="rounded-lg border border-border bg-surface p-3 space-y-1">
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                        Note
                      </span>
                      <p className="text-xs text-foreground/90 italic">
                        {selectedEvent.note ? `"${selectedEvent.note}"` : "No note entered"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Bottom: Read-only notice */}
                <div className="border-t border-border p-3 bg-muted/30 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Lock className="size-3.5" />
                    <span className="text-[11px]">
                      Editing classified loss is restricted to Section Head.
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold text-tier-good">
                      {formatEventDuration(selectedEvent.durationSec)} /{" "}
                      {formatEventDuration(selectedEvent.durationSec)}
                    </span>
                    <span className="rounded bg-tier-good/20 text-tier-good font-bold text-[10px] px-2 py-0.5">
                      Classified
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-between">
                {/* Top: Breadcrumbs & Split Steppers */}
                <div className="border-b border-border/70 p-3 bg-muted/20">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* L0 > L1 > L2 > L3 Breadcrumb Bar */}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
                      {/* L0 Chip */}
                      <button
                        type="button"
                        onClick={() => setActiveStep(0)}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] border transition-colors cursor-pointer",
                          activeStep === 0
                            ? "bg-primary text-primary-foreground border-primary font-bold"
                            : "bg-surface border-border text-foreground hover:bg-muted",
                        )}
                      >
                        L0: {selectedComp}
                      </button>
                      <ChevronRight className="size-3.5 text-muted-foreground" />
                      {/* L1 Chip */}
                      <button
                        type="button"
                        onClick={() => setActiveStep(1)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] border transition-colors cursor-pointer",
                          activeStep === 1
                            ? "bg-primary text-primary-foreground border-primary font-bold"
                            : "bg-surface border-border text-foreground hover:bg-muted",
                        )}
                      >
                        <span>L1: {selectedParent}</span>
                        {isL1Auto && (
                          <span className="rounded bg-primary/20 text-[9px] font-bold px-1 text-primary-foreground">
                            AUTO
                          </span>
                        )}
                      </button>
                      <ChevronRight className="size-3.5 text-muted-foreground" />

                      {/* L2 Chip */}
                      <button
                        type="button"
                        onClick={() => setActiveStep(2)}
                        className={cn(
                          "rounded px-2 py-0.5 text-[11px] border transition-colors cursor-pointer",
                          activeStep === 2
                            ? "bg-primary text-primary-foreground border-primary font-bold"
                            : selectedCatId
                              ? "bg-surface border-border text-foreground hover:bg-muted"
                              : "bg-muted/70 border-dashed border-border text-muted-foreground",
                        )}
                      >
                        L2: {selectedCatName || "Choose Category"}
                      </button>
                      <ChevronRight className="size-3.5 text-muted-foreground" />

                      {/* L3 Chip */}
                      <button
                        type="button"
                        onClick={() => setActiveStep(3)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] border transition-colors cursor-pointer",
                          activeStep === 3
                            ? "bg-primary text-primary-foreground border-primary font-bold"
                            : selectedReasonId
                              ? "bg-surface border-border text-foreground hover:bg-muted font-bold"
                              : "bg-muted/70 border-dashed border-border text-muted-foreground",
                        )}
                      >
                        <span>L3: {selectedReasonName || "Choose Reason"}</span>
                        {selectedReasonId && <Check className="size-3 text-tier-good" />}
                      </button>
                    </div>

                    {/* + Split Button */}
                    <button
                      type="button"
                      disabled={isOngoing || workingCauses.length >= 4}
                      onClick={handleAddSplit}
                      className={cn(
                        "inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold transition-colors",
                        isOngoing || workingCauses.length >= 4
                          ? "border-border/50 bg-muted/40 text-muted-foreground/60 cursor-not-allowed"
                          : "border-border bg-surface text-foreground hover:bg-muted cursor-pointer",
                      )}
                      title={
                        isOngoing
                          ? "Ongoing stops cannot be split until completed"
                          : workingCauses.length >= 4
                            ? "Maximum 4 causes per event"
                            : "Split event into multiple causes"
                      }
                    >
                      <SplitIcon className="size-3" />
                      <span>+ Split</span>
                    </button>
                  </div>

                  {/* Multiple causes list if split */}
                  {workingCauses.length > 1 && (
                    <div className="mt-2 flex flex-wrap gap-2 pt-2 border-t border-border/60">
                      {workingCauses.map((cause, idx) => (
                        <div
                          key={cause.id}
                          onClick={() => {
                            setActiveCauseIndex(idx);
                            setSelectedComp(cause.l0Component);
                            setSelectedParent(cause.l1Parent);
                            setSelectedCatId(cause.l2CategoryId);
                            setSelectedCatName(cause.l2CategoryName);
                            setSelectedReasonId(cause.l3ReasonId);
                            setSelectedReasonName(cause.l3ReasonName);
                          }}
                          className={cn(
                            "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer",
                            idx === activeCauseIndex
                              ? "border-primary bg-primary/10 font-bold"
                              : "border-border bg-surface hover:bg-muted",
                          )}
                        >
                          <span>Cause {idx + 1}:</span>
                          <span className="font-mono font-bold">
                            {formatEventDuration(cause.durationSec)}
                          </span>
                          <div className="flex items-center gap-0.5 ml-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdjustCauseDuration(idx, -30);
                              }}
                              className="size-4 rounded hover:bg-background flex items-center justify-center text-[10px]"
                            >
                              -
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleAdjustCauseDuration(idx, 30);
                              }}
                              className="size-4 rounded hover:bg-background flex items-center justify-center text-[10px]"
                            >
                              +
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveSplit(idx);
                              }}
                              className="size-4 rounded hover:bg-destructive/20 text-destructive flex items-center justify-center ml-1"
                            >
                              <Trash2 className="size-2.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Step Panels */}
                <div className="flex-1 p-3.5 overflow-y-auto max-h-[380px]">
                  {/* Search bar when level has multiple options */}
                  <div className="relative mb-3">
                    <Search className="absolute left-2.5 top-2 size-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Jump to a reason... (e.g. jam, leak, sensor, break)"
                      className="w-full rounded-md border border-border bg-background pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    {searchQuery && searchResults.length > 0 && (
                      <div className="absolute top-8 inset-x-0 z-30 rounded-md border border-border bg-surface shadow-md max-h-48 overflow-y-auto divide-y divide-border/60">
                        {searchResults.map((sr) => (
                          <div
                            key={sr.reasonId}
                            onClick={() => handleQuickPickSearchResult(sr)}
                            className="px-3 py-2 text-xs hover:bg-primary/10 cursor-pointer flex items-center justify-between"
                          >
                            <div>
                              <p className="font-bold text-foreground">{sr.reasonName}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {sr.comp} &gt; {sr.parent} &gt; {sr.catName}
                              </p>
                            </div>
                            <ChevronRight className="size-3.5 text-muted-foreground" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Level 0: OEE Component Cards */}
                  {activeStep === 0 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-bold text-foreground">
                          Step 1: Which OEE Component does this loss affect?
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {COMPONENTS.map((comp) => {
                          const blockReason = componentBlock(
                            comp.id,
                            selectedEvent.type as
                              "downtime" | "minor_stop" | "speed_loss" | "planned",
                          );
                          const isSelected = selectedComp === comp.id;
                          return (
                            <div
                              key={comp.id}
                              onClick={() => !blockReason && handlePickComponent(comp.id)}
                              className={cn(
                                "rounded-lg border p-3 transition-all relative select-none",
                                blockReason
                                  ? "border-border/40 bg-muted/20 opacity-50 cursor-not-allowed"
                                  : isSelected
                                    ? "border-primary bg-primary/10 ring-1 ring-primary cursor-pointer"
                                    : "border-border bg-surface hover:border-foreground/40 cursor-pointer",
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <h4 className="font-bold text-xs text-foreground">{comp.name}</h4>
                                {isSelected && <Check className="size-3.5 text-primary" />}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">
                                {comp.description}
                              </p>
                              {blockReason && (
                                <p className="text-[10px] font-semibold text-destructive mt-1.5">
                                  {blockReason}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Level 1: Parent Issue Cards */}
                  {activeStep === 1 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-foreground">
                            Which parent issue under {selectedComp}?
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Select the appropriate loss grouping
                          </p>
                        </div>
                        <div className="flex items-center gap-2 text-xs">
                          {!isL1Auto ? (
                            <button
                              type="button"
                              onClick={handleResetToAutoL1}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline cursor-pointer"
                            >
                              <RotateCcw className="size-3" />
                              <span>Reset to auto</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setActiveStep(0)}
                              className="text-[11px] text-muted-foreground hover:underline cursor-pointer"
                            >
                              Wrong? Back to L0
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {PARENTS.filter((p) => p.component === selectedComp).map((p) => {
                          const blockReason = parentBlock(
                            p.id,
                            selectedEvent.type as
                              "downtime" | "minor_stop" | "speed_loss" | "planned",
                          );
                          const isAuto =
                            p.id ===
                            autoParent(
                              selectedEvent.type as
                                "downtime" | "minor_stop" | "speed_loss" | "planned",
                            );
                          const isSelected = selectedParent === p.id;
                          return (
                            <div
                              key={p.id}
                              onClick={() => !blockReason && handlePickParent(p.id)}
                              className={cn(
                                "rounded-lg border p-3 transition-all relative select-none",
                                blockReason
                                  ? "border-border/40 bg-muted/20 opacity-50 cursor-not-allowed"
                                  : isSelected
                                    ? "border-primary bg-primary/10 ring-1 ring-primary cursor-pointer"
                                    : "border-border bg-surface hover:border-foreground/40 cursor-pointer",
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className={cn(
                                      "size-2 rounded-full",
                                      p.id === "Breakdown" && "bg-[var(--loss-down)]",
                                      p.id === "Setup / Changeover" && "bg-[var(--loss-setup)]",
                                      p.id === "Minor Stop" && "bg-[var(--loss-minor)]",
                                      p.id === "Speed Loss" && "bg-[var(--loss-speed)]",
                                      p.id === "Planned Downtime" && "bg-[var(--loss-planned)]",
                                      p.id === "Scrap / Defect" && "bg-[var(--loss-quality)]",
                                      p.id === "Rework" && "bg-[var(--loss-quality)]",
                                    )}
                                  />
                                  <h4 className="font-bold text-xs text-foreground">{p.name}</h4>
                                </div>
                                {isAuto && (
                                  <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                                    AUTO
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">{p.hint}</p>
                              <p className="text-[10px] text-muted-foreground/70 font-mono mt-2">
                                {p.categories.length} categories ·{" "}
                                {p.categories.reduce((acc, c) => acc + c.reasons.length, 0)} reasons
                              </p>
                              {blockReason && (
                                <p className="text-[10px] font-semibold text-destructive mt-1">
                                  {blockReason}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Level 2: Category Selection */}
                  {activeStep === 2 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-foreground">
                            Select Category under {selectedParent}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Choose the root functional area
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveStep(1)}
                          className="text-[11px] text-primary hover:underline cursor-pointer"
                        >
                          Back to Parent
                        </button>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {activeCategories.map((cat) => {
                          const isSelected = selectedCatId === cat.id;
                          return (
                            <div
                              key={cat.id}
                              onClick={() => handlePickCategory(cat.id, cat.name)}
                              className={cn(
                                "rounded-lg border p-3 transition-all cursor-pointer select-none",
                                isSelected
                                  ? "border-primary bg-primary/10 ring-1 ring-primary"
                                  : "border-border bg-surface hover:border-foreground/40",
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <h4 className="font-bold text-xs text-foreground">{cat.name}</h4>
                                {isSelected && <Check className="size-3.5 text-primary" />}
                              </div>
                              <p className="text-[10px] text-muted-foreground font-mono mt-1">
                                {cat.reasons.length} specific reasons
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Level 3: Specific Reason Tiles */}
                  {activeStep === 3 && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-xs font-bold text-foreground">
                            Select Root Cause Reason ({selectedCatName})
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            Pick the precise cause code for this event
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setActiveStep(2)}
                          className="text-[11px] text-primary hover:underline cursor-pointer"
                        >
                          Back to Category
                        </button>
                      </div>

                      <div className="grid grid-cols-1 gap-1.5">
                        {activeCategories
                          .find((c) => c.id === selectedCatId)
                          ?.reasons.map((r) => {
                            const isSelected = selectedReasonId === r.id;
                            return (
                              <div
                                key={r.id}
                                onClick={() => handlePickReason(r.id, r.name)}
                                className={cn(
                                  "flex items-center justify-between rounded-md border p-2.5 text-xs transition-all cursor-pointer select-none",
                                  isSelected
                                    ? "border-primary bg-primary/10 ring-1 ring-primary font-bold text-foreground"
                                    : "border-border bg-surface hover:bg-muted text-foreground/90",
                                )}
                              >
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-[10px] text-muted-foreground">
                                    {r.id}
                                  </span>
                                  <span>{r.name}</span>
                                </div>
                                {isSelected && <Check className="size-4 text-tier-good" />}
                              </div>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Bottom Footer: Note, Cause machine, Progress Bar, Save Button */}
                <div className="border-t border-border p-3 bg-muted/30 space-y-2.5">
                  {/* Note + Cause machine select */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <div className="sm:col-span-2">
                      <input
                        type="text"
                        value={noteText}
                        onChange={(e) => setNoteText(e.target.value)}
                        placeholder="What happened? How can we prevent this?"
                        className="w-full rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <select
                        value={causeMachineCode}
                        onChange={(e) => setCauseMachineCode(e.target.value)}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground font-mono font-medium focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                      >
                        {siblingMachines.map((sm) => (
                          <option key={sm.code} value={sm.code}>
                            Cause: {sm.code} ({sm.name})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Progress bar + Save Button */}
                  <div className="flex items-center justify-between gap-4">
                    {/* Progress Indicator */}
                    <div className="flex-1 flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            isFullyClassified ? "bg-tier-good" : "bg-primary",
                          )}
                          style={{
                            width: `${Math.min(
                              100,
                              (totalClassifiedSec / (eventDuration || 1)) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[11px] font-bold text-muted-foreground whitespace-nowrap">
                        {formatEventDuration(totalClassifiedSec)} /{" "}
                        {formatEventDuration(eventDuration)}
                      </span>
                    </div>

                    {/* Save Button */}
                    <button
                      type="button"
                      disabled={!selectedReasonId}
                      onClick={handleSave}
                      className={cn(
                        "rounded-md px-4 py-1.5 text-xs font-bold shadow-xs transition-all cursor-pointer whitespace-nowrap",
                        !selectedReasonId
                          ? "bg-muted text-muted-foreground/60 cursor-not-allowed"
                          : isOngoing
                            ? "bg-amber-500 text-black hover:bg-amber-400 font-extrabold"
                            : totalClassifiedSec < eventDuration
                              ? "bg-primary/80 text-primary-foreground hover:bg-primary"
                              : "bg-primary text-primary-foreground hover:bg-primary/90",
                      )}
                    >
                      {isOngoing
                        ? "Tag now"
                        : totalClassifiedSec < eventDuration
                          ? "Save partial"
                          : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
