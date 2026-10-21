import { Panel } from "@/components/oee/ui";
import { type Line, type Plant } from "@/lib/oee/data";
import { type ResolvedPeriod } from "@/lib/oee/period";
import { useAlarms } from "@/lib/oee/alarm-service";
import { cn } from "@/lib/utils";

export function PlantAlarmsSection({
  plant,
  resolved,
}: {
  plant: Plant;
  resolved: ResolvedPeriod;
}) {
  const { alarms } = useAlarms({ plant, resolved });

  const occurring = alarms.filter((a) => a.status === "OCCURRING").length;
  const resolvedCount = alarms.length - occurring;

  const resolvedWording =
    resolved.periodKey === "this-shift"
      ? "resolved this shift"
      : resolved.periodKey === "today"
        ? "resolved today"
        : resolved.periodKey === "this-week"
          ? "resolved this week"
          : resolved.periodKey === "this-month"
            ? "resolved this month"
            : "resolved in selected period";

  return (
    <Panel
      title="Alarms"
      subtitle={`${occurring} occurring · ${resolvedCount} ${resolvedWording}`}
      className="min-h-0 max-h-[420px] lg:max-h-none"
      bodyClassName="p-0 overflow-hidden"
    >
      <div className="min-h-0 flex-1 w-full min-w-0 overflow-x-auto overflow-y-auto">
        <table className="w-full min-w-[480px] text-[11px]">
          <thead className="sticky top-0 bg-surface text-left text-muted-foreground">
            <tr className="border-b border-border">
              <th className="px-3 py-2 font-medium">Line</th>
              <th className="px-3 py-2 font-medium">Issue</th>
              <th className="px-3 py-2 font-medium">Start</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {alarms.map((a) => (
              <tr key={a.id} className="border-b border-border/60">
                <td className="px-3 py-2 font-mono">{a.lineId}</td>
                <td className="px-3 py-2">{a.issue}</td>
                <td className="px-3 py-2 font-mono whitespace-nowrap">{a.start}</td>
                <td className="px-3 py-2 font-mono">{a.durationMinutes} min</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                      a.status === "OCCURRING"
                        ? "bg-tier-bad/15 text-tier-bad"
                        : "bg-grid text-muted-foreground",
                    )}
                  >
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
            {alarms.length === 0 && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-muted-foreground">
                  No alarms {resolvedWording}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

export function LineAlarmsSection({
  line,
  plantId,
  resolved,
}: {
  line: Line;
  plantId?: string;
  resolved: ResolvedPeriod;
}) {
  const { alarms, includesCurrentDay } = useAlarms({ line, resolved });

  return (
    <Panel
      title={includesCurrentDay ? "Active Alarms" : "Alarms"}
      subtitle="Shares the same source as Alarms on Plant View"
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border">
        {alarms.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2 text-[11px]">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                a.severity === "CRITICAL"
                  ? "bg-tier-bad/15 text-tier-bad"
                  : "bg-tier-warn/20 text-tier-warn",
              )}
            >
              {a.severity}
            </span>
            <span className="font-mono">
              {a.lineId}·{a.machineId}
            </span>
            <span className="font-mono text-muted-foreground whitespace-nowrap">{a.start}</span>
            <span className="flex-1 min-w-[140px]">{a.issue}</span>
            <span className="font-mono text-muted-foreground">{a.durationMinutes} min</span>
            <span
              className={cn(
                "font-semibold uppercase",
                a.status === "OCCURRING" ? "text-tier-bad" : "text-muted-foreground",
              )}
            >
              {a.status}
            </span>
          </li>
        ))}
        {alarms.length === 0 && (
          <li className="p-4 text-center text-xs text-muted-foreground">
            No alarms in selected period
          </li>
        )}
      </ul>
    </Panel>
  );
}
