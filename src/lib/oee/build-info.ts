export const BUILD_ID = "r6 · 02 Oct 2026 08:30 WIB";

export const FEATURES = {
  periodFilterNew: true,
  comparisonSingleRow: true,
  liveClockChip: true,
  liveUpdatedIndicator: true,
  hoverPoOutput: true,
  bottleneckMarker: true,
  poHover: true,
  lineOutputBreakdown: true,
  lineConditionLayout: true,
  mpqTargetRemoved: true,
  machinesSectionRemoved: true,
  mttrMtbfRemoved: true,
  lossMoveToClassified: true,
  analyticsKpiCleanup: true,
  round3ParitySelectors: true,
  round3DomParityAudit: true,
  round3FullWidthLineCondition: true,
  round3CustomRangePortalFix: true,
  interactiveOpenMap: true,
  upcomingPlantsKlangBatang: true,
};

if (typeof window !== "undefined") {
  console.info("[OEE] build", BUILD_ID, FEATURES);
}
