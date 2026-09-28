import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Context,
  type ReactNode,
} from "react";

import { DEFAULT_PLANT_ID } from "./data";
import { snapResolution, type ResolutionId, type SpanId, type PeriodId } from "./filters";

export type Role = "shift-leader" | "section-head";

export type Filters = {
  span: SpanId;
  resolution: ResolutionId;
  /** Section Head only (single select) */
  plantId: string;
  zoneIds: string[];
  lineIds: string[];
  sku: string | "all";
};

type Ctx = {
  role: Role;
  setRole: (r: Role) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isDarkMode: boolean;
  setIsDarkMode: (dark: boolean) => void;
  livePeriod: PeriodId;
  setLivePeriod: (p: PeriodId) => void;
  filters: Filters;
  /** Applies the cascading rules from §5 automatically. */
  setFilters: (patch: Partial<Filters>) => void;
};

// Keep a single context instance across hot-module reloads. Without this, a
// reloaded copy of this module creates a new context and consumers rendered by
// the still-mounted provider read `null` and crash.
const globalStore = globalThis as unknown as { __oeeAppContext?: Context<Ctx | null> };
const AppContext = (globalStore.__oeeAppContext ??= createContext<Ctx | null>(null));

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("shift-leader");
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [livePeriod, setLivePeriod] = useState<PeriodId>("live");
  const [filters, setFiltersState] = useState<Filters>({
    span: "this-week",
    resolution: "1d",
    plantId: DEFAULT_PLANT_ID,
    zoneIds: ["A"],
    lineIds: [],
    sku: "all",
  });

  const setFilters = useCallback((patch: Partial<Filters>) => {
    setFiltersState((prev) => {
      const next: Filters = { ...prev, ...patch };
      // Plant resets Zone & Line, but never Span/Resolution/SKU.
      if (patch.plantId && patch.plantId !== prev.plantId) {
        next.zoneIds = [];
        next.lineIds = [];
      }
      // Zone limits the available Lines -> drop lines that no longer apply.
      if (patch.zoneIds && patch.zoneIds !== prev.zoneIds) {
        next.lineIds = [];
      }
      // Span change may invalidate resolution -> auto snap to nearest coarser.
      next.resolution = snapResolution(next.span, next.resolution);
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);

  const value = useMemo(
    () => ({
      role,
      setRole,
      isCollapsed,
      setIsCollapsed,
      isDarkMode,
      setIsDarkMode,
      livePeriod,
      setLivePeriod,
      filters,
      setFilters,
    }),
    [role, isCollapsed, isDarkMode, livePeriod, filters, setFilters],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): Ctx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}
