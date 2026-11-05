export const BUILD_ID = "r24 · 05 Nov 2026 16:15 WIB";

export const FEATURES = {
  lossClarificationReadOnly: true,
  machineOutputRename: true,
  downtimeEventAlarms: true,
  lossTreeMasterV2: true,
  plcAlarmCodeMapping: true,
  alarmTableL2L3Source: true,
  waterfallKpiSync: true,
  waterfallLossCleanup: true,
  dynamicPeriodAlarms: true,
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
  analyticsKpiCleanup: true,
  round3ParitySelectors: true,
  round3DomParityAudit: true,
  round3FullWidthLineCondition: true,
  round3CustomRangePortalFix: true,
  interactiveOpenMap: true,
  upcomingPlantsKlangBatang: true,
  customRangeTime: true,
  customRangeCompareAllDay: true,
  lossCanonicalTimestamps: true,
  bop15Iso3D: true,
  bop15Iso3DIntegration: true,
  productionBlankScreenFix: true,
};

if (typeof window !== "undefined") {
  console.info("[OEE] build", BUILD_ID, FEATURES);
}
