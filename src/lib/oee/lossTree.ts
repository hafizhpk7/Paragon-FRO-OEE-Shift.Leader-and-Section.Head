/**
 * Official Paragon OEE FRO Loss Tree Taxonomy (L0 - L3).
 * Verbatim copy of standard loss categories and parent groupings.
 * DO NOT RENAME, MERGE OR TRANSLATE ANY LABEL.
 */

export type LossComponent = "Loading" | "Availability" | "Performance" | "Quality";

export type LossParent =
  | "Planned Downtime"
  | "Breakdown"
  | "Setup / Changeover"
  | "Minor Stop"
  | "Speed Loss"
  | "Scrap / Defect"
  | "Rework";

export interface LossReasonNode {
  id: string;
  name: string;
}

export interface LossCategoryNode {
  id: string;
  name: string;
  reasons: LossReasonNode[];
}

export interface LossParentNode {
  id: LossParent;
  name: string;
  component: LossComponent;
  hint: string;
  categories: LossCategoryNode[];
}

export const COMPONENTS: { id: LossComponent; name: string; description: string }[] = [
  {
    id: "Loading",
    name: "Loading",
    description: "Scheduled non-operating time and planned downtime",
  },
  {
    id: "Availability",
    name: "Availability",
    description: "Equipment breakdowns, failures, and setup/changeover losses",
  },
  {
    id: "Performance",
    name: "Performance",
    description: "Small stops (< 10 min), idling, and reduced operating speed",
  },
  {
    id: "Quality",
    name: "Quality",
    description: "Scrap, defects, startups losses, and rework during production",
  },
];

export const PARENTS: LossParentNode[] = [
  {
    id: "Planned Downtime",
    name: "Planned Downtime",
    component: "Loading",
    hint: "Scheduled maintenance, briefings, cleanings, and meal breaks",
    categories: [
      {
        id: "PLN-BRK",
        name: "Break & Rest Time",
        reasons: [
          { id: "R-BRK-01", name: "Scheduled meal break" },
          { id: "R-BRK-02", name: "Shift handover & briefing" },
          { id: "R-BRK-03", name: "Operator rest time" },
        ],
      },
      {
        id: "PLN-MNT",
        name: "Scheduled Maintenance",
        reasons: [
          { id: "R-MNT-01", name: "Autonomous maintenance (TPM)" },
          { id: "R-MNT-02", name: "Planned preventative maintenance" },
          { id: "R-MNT-03", name: "Tool & die scheduled overhaul" },
        ],
      },
      {
        id: "PLN-CLN",
        name: "Cleaning & Sanitation",
        reasons: [
          { id: "R-CLN-01", name: "End-of-shift washdown (CIP)" },
          { id: "R-CLN-02", name: "Deep sanitization protocol" },
          { id: "R-CLN-03", name: "Line line-clearance cleaning" },
        ],
      },
      {
        id: "PLN-NO-DEM",
        name: "No Production Demand",
        reasons: [
          { id: "R-DEM-01", name: "No production scheduled" },
          { id: "R-DEM-02", name: "Trial / R&D testing" },
        ],
      },
    ],
  },
  {
    id: "Breakdown",
    name: "Breakdown",
    component: "Availability",
    hint: "Unscheduled equipment failures lasting 10 minutes or longer",
    categories: [
      {
        id: "BKD-MCH",
        name: "Mechanical Failure",
        reasons: [
          { id: "R-MCH-01", name: "Conveyor jam at infeed" },
          { id: "R-MCH-02", name: "Nozzle actuator cylinder failure" },
          { id: "R-MCH-03", name: "Drive belt / chain snapped or slipping" },
          { id: "R-MCH-04", name: "Pneumatic cylinder seal leak" },
          { id: "R-MCH-05", name: "Chuck head / capping clutch seized" },
          { id: "R-MCH-06", name: "Vacuum pump loss of suction" },
          { id: "R-MCH-07", name: "Gearbox bearing overheating" },
          { id: "R-MCH-08", name: "Cutting blade dull or broken" },
        ],
      },
      {
        id: "BKD-ELE",
        name: "Electrical & Control",
        reasons: [
          { id: "R-ELE-01", name: "PLC communication fault" },
          { id: "R-ELE-02", name: "Servo motor overload alarm" },
          { id: "R-ELE-03", name: "Proximity / photo sensor misalignment" },
          { id: "R-ELE-04", name: "Safety interlock / E-stop tripped" },
          { id: "R-ELE-05", name: "Heating element burnt out" },
          { id: "R-ELE-06", name: "VFD inverter drive fault" },
        ],
      },
      {
        id: "BKD-UTL",
        name: "Utilities Failure",
        reasons: [
          { id: "R-UTL-01", name: "Compressed air pressure drop (< 5.0 bar)" },
          { id: "R-UTL-02", name: "Steam pressure insufficient" },
          { id: "R-UTL-03", name: "Chilled water supply disruption" },
          { id: "R-UTL-04", name: "Electrical supply voltage fluctuation" },
        ],
      },
      {
        id: "BKD-MAT",
        name: "Material Incompatibility",
        reasons: [
          { id: "R-MAT-01", name: "Bottle dimension out of spec" },
          { id: "R-MAT-02", name: "Cap threading defective" },
          { id: "R-MAT-03", name: "Bulk product viscosity too high" },
          { id: "R-MAT-04", name: "Label liner tearing repeatedly" },
        ],
      },
    ],
  },
  {
    id: "Setup / Changeover",
    name: "Setup / Changeover",
    component: "Availability",
    hint: "Product recipe changes, format tooling adjustments, and calibration",
    categories: [
      {
        id: "STP-SKU",
        name: "SKU / Format Changeover",
        reasons: [
          { id: "R-STP-01", name: "Tooling replacement for new bottle size" },
          { id: "R-STP-02", name: "Guide rail and puck width adjustment" },
          { id: "R-STP-03", name: "Capper chuck replacement" },
          { id: "R-STP-04", name: "Cartoner carton former adjustment" },
        ],
      },
      {
        id: "STP-CAL",
        name: "Warm-up & Calibration",
        reasons: [
          { id: "R-CAL-01", name: "Fill volume calibration run" },
          { id: "R-CAL-02", name: "Heat tunnel temperature stabilization" },
          { id: "R-CAL-03", name: "Checkweigher tare calibration" },
          { id: "R-CAL-04", name: "Vision inspection camera teach-in" },
        ],
      },
      {
        id: "STP-CLN",
        name: "Cleaning for Product Change",
        reasons: [
          { id: "R-SCC-01", name: "Flavor / formulation rinse out" },
          { id: "R-SCC-02", name: "Hopper and tank drain & wipe" },
          { id: "R-SCC-03", name: "Label reel and coder ribbon reload" },
        ],
      },
    ],
  },
  {
    id: "Minor Stop",
    name: "Minor Stop",
    component: "Performance",
    hint: "Short intermittent stoppages and jams lasting under 10 minutes",
    categories: [
      {
        id: "MNR-JAM",
        name: "Intermittent Jam",
        reasons: [
          { id: "R-JAM-01", name: "Bottle fallen / tilted on infeed" },
          { id: "R-JAM-02", name: "Cap chute jam" },
          { id: "R-JAM-03", name: "Carton flap misfeed" },
          { id: "R-JAM-04", name: "Label web misaligned" },
          { id: "R-JAM-05", name: "Shrink film wrinkle clearance" },
          { id: "R-JAM-06", name: "Outfeed conveyor accumulation backup" },
        ],
      },
      {
        id: "MNR-OPR",
        name: "Operator Action & Refill",
        reasons: [
          { id: "R-OPR-01", name: "Cap feeder hopper manual refill" },
          { id: "R-OPR-02", name: "Carton magazine reload" },
          { id: "R-OPR-03", name: "Label roll splicing" },
          { id: "R-OPR-04", name: "Quick manual sensor cleaning" },
          { id: "R-OPR-05", name: "Nozzle dripping wipe down" },
        ],
      },
    ],
  },
  {
    id: "Speed Loss",
    name: "Speed Loss",
    component: "Performance",
    hint: "Operating below the standard rated speed due to quality or flow constraints",
    categories: [
      {
        id: "SPD-QLT",
        name: "Reduced Speed for Quality",
        reasons: [
          { id: "R-SPD-01", name: "Slow run to prevent foaming" },
          { id: "R-SPD-02", name: "Slow run due to delicate packaging" },
          { id: "R-SPD-03", name: "Reduced speed during heat tunnel heating" },
          { id: "R-SPD-04", name: "Capper torque stabilization speed" },
        ],
      },
      {
        id: "SPD-FLW",
        name: "Line Balancing & Flow Constraints",
        reasons: [
          { id: "R-FLW-01", name: "Downstream machine bottleneck throttling" },
          { id: "R-FLW-02", name: "Upstream supply starvation" },
          { id: "R-FLW-03", name: "Operator training pace" },
        ],
      },
    ],
  },
  {
    id: "Scrap / Defect",
    name: "Scrap / Defect",
    component: "Quality",
    hint: "Unacceptable products, rejected units, and non-recoverable waste",
    categories: [
      {
        id: "QDF-VOL",
        name: "Fill / Volume Rejection",
        reasons: [
          { id: "R-VOL-01", name: "Underfilled bottle (< lower spec limit)" },
          { id: "R-VOL-02", name: "Overfilled bottle (> upper spec limit)" },
          { id: "R-VOL-03", name: "Nozzle splash / external contamination" },
        ],
      },
      {
        id: "QDF-CAP",
        name: "Capping / Seal Defect",
        reasons: [
          { id: "R-CAP-01", name: "Canted / crooked cap" },
          { id: "R-CAP-02", name: "Loose cap (insufficient torque)" },
          { id: "R-CAP-03", name: "Stripped cap thread (over-torque)" },
          { id: "R-CAP-04", name: "Induction foil seal missing or incomplete" },
        ],
      },
      {
        id: "QDF-LAB",
        name: "Labelling & Code Defect",
        reasons: [
          { id: "R-LAB-01", name: "Skewed / bubbled label" },
          { id: "R-LAB-02", name: "Missing expiry / batch inkjet code" },
          { id: "R-LAB-03", name: "Unreadable barcode scan" },
        ],
      },
    ],
  },
  {
    id: "Rework",
    name: "Rework",
    component: "Quality",
    hint: "Recoverable units requiring manual re-capping, re-packing, or relabeling",
    categories: [
      {
        id: "RWK-PKG",
        name: "Packaging Rework",
        reasons: [
          { id: "R-RWK-01", name: "Manual cap retorquing" },
          { id: "R-RWK-02", name: "Manual label removal and re-application" },
          { id: "R-RWK-03", name: "Carton repack due to damaged carton box" },
        ],
      },
    ],
  },
];

/**
 * Maps an L1 parent name to its parent OEE component (L0)
 */
export function componentOf(parent: LossParent): LossComponent {
  const p = PARENTS.find((item) => item.id === parent);
  return p ? p.component : "Availability";
}

/**
 * Returns categories under a given L1 parent
 */
export function categoriesOf(parent: LossParent): LossCategoryNode[] {
  const p = PARENTS.find((item) => item.id === parent);
  return p ? p.categories : [];
}

/**
 * Automatic L1 assignment based on detected event type
 */
export function autoParent(
  eventType: "downtime" | "minor_stop" | "speed_loss" | "planned",
): LossParent {
  switch (eventType) {
    case "downtime":
      return "Breakdown";
    case "minor_stop":
      return "Minor Stop";
    case "speed_loss":
      return "Speed Loss";
    case "planned":
    default:
      return "Planned Downtime";
  }
}

/**
 * Checks if an L1 parent is blocked for a given detected event type
 */
export function parentBlock(
  parent: LossParent,
  eventType: "downtime" | "minor_stop" | "speed_loss" | "planned",
): string | null {
  if (eventType === "planned") {
    if (parent !== "Planned Downtime") {
      return "Planned stops can only be classified under Planned Downtime";
    }
    return null;
  }
  if (eventType === "speed_loss") {
    if (parent !== "Speed Loss" && parent !== "Scrap / Defect" && parent !== "Rework") {
      return "Speed losses cannot be classified under physical stoppage categories";
    }
    return null;
  }
  if (eventType === "downtime") {
    if (parent === "Minor Stop") {
      return "Downtimes (≥ 10 min) must use Breakdown or Setup / Changeover";
    }
    if (parent === "Speed Loss") {
      return "Machine stopped completely; cannot be classified as Speed Loss";
    }
    return null;
  }
  if (eventType === "minor_stop") {
    if (parent === "Breakdown") {
      return "Stops under 10 min are Minor Stops; promote to Breakdown only if ≥ 10 min";
    }
    if (parent === "Speed Loss") {
      return "Machine stopped with 0 output; cannot be Speed Loss";
    }
    return null;
  }
  return null;
}

/**
 * Checks if an L0 component is blocked for a given detected event type
 */
export function componentBlock(
  comp: LossComponent,
  eventType: "downtime" | "minor_stop" | "speed_loss" | "planned",
): string | null {
  if (eventType === "planned") {
    if (comp !== "Loading") {
      return "Planned stops belong exclusively to the Loading component";
    }
    return null;
  }
  if (eventType === "speed_loss") {
    if (comp === "Availability" || comp === "Loading") {
      return "Equipment was running, only Performance or Quality losses apply";
    }
    return null;
  }
  if (eventType === "downtime" || eventType === "minor_stop") {
    if (comp === "Loading") {
      return "Unplanned stop during production cannot be classified under Loading";
    }
    return null;
  }
  return null;
}

/**
 * Pre-tagged PLC categories for automatic telemetry faults
 */
export const PLC_CATEGORIES: Record<
  string,
  { parent: LossParent; categoryId: string; reasonId: string }
> = {
  "Conveyor jam at infeed": {
    parent: "Breakdown",
    categoryId: "BKD-MCH",
    reasonId: "R-MCH-01",
  },
  "Cap chute jam": {
    parent: "Minor Stop",
    categoryId: "MNR-JAM",
    reasonId: "R-JAM-02",
  },
  "Bottle fallen / tilted on infeed": {
    parent: "Minor Stop",
    categoryId: "MNR-JAM",
    reasonId: "R-JAM-01",
  },
  "Pneumatic cylinder seal leak": {
    parent: "Breakdown",
    categoryId: "BKD-MCH",
    reasonId: "R-MCH-04",
  },
  "PLC communication fault": {
    parent: "Breakdown",
    categoryId: "BKD-ELE",
    reasonId: "R-ELE-01",
  },
};
