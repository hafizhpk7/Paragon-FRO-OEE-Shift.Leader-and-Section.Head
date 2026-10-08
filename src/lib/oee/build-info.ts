export const BUILD_ID = "r9 · 08 Oct 2026 11:30 WIB";

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
  customRangeTime: true,
  customRangeCompareAllDay: true,
  lossClarificationLookbackGate: true,
  sectionHeadOnlyClassifiedEdit: true,
  lossCanonicalTimestamps: true,
  lossActionGateFix: true,
};

if (typeof window !== "undefined") {
  console.info("[OEE] build", BUILD_ID, FEATURES);
}
