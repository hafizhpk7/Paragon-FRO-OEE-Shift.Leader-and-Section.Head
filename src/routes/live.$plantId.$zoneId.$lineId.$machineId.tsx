import { createFileRoute, useParams } from "@tanstack/react-router";
import { useState } from "react";

import { IsoBlock, IsoGround, IsoScene } from "@/components/oee/iso";
import { Donut, EmptyState, KpiCard, MetricBar, PageHeader, Panel } from "@/components/oee/ui";
import { STATUS_HEX } from "@/lib/oee/config";
import { getMachine, getLine } from "@/lib/oee/data";
import type { PeriodId } from "@/lib/oee/filters";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/live/$plantId/$zoneId/$lineId/$machineId")({
  head: () => ({
    meta: [
      { title: "Machine Detail — Live Monitor" },
      {
        name: "description",
        content:
          "Machine level live monitor: OEE breakdown, MTTR/MTBF, machine information sensors and the current stop with downstream effect.",
      },
      { property: "og:title", content: "Machine Detail — Live Monitor" },
      {
        property: "og:description",
        content: "Machine OEE, sensor readings and current stop detail with loss category path.",
      },
    ],
  }),
  component: MachineDetail,
});

function MachineDetail() {
  const { plantId, zoneId, lineId, machineId } = useParams({
    from: "/live/$plantId/$zoneId/$lineId/$machineId",
  });
  const [period, setPeriod] = useState<PeriodId>("live");
  const line = getLine(plantId, zoneId, lineId);
  const machine = getMachine(plantId, zoneId, lineId, machineId);

  if (!line || !machine) {
    return (
      <div className="p-6">
        <EmptyState message="Machine tidak ditemukan" />
      </div>
    );
  }

  const groups = Array.from(new Set(machine.sensors.map((s) => s.group)));
  const stop = machine.currentStop;

  return (
    <div className="flex min-h-screen flex-col bg-background font-sans text-foreground">
      <PageHeader
        title={`${machine.id} — Machine Detail`}
        crumbs={[
          { label: `Zone ${zoneId}`, to: "/live/$plantId/$zoneId", params: { plantId, zoneId } },
          {
            label: lineId,
            to: "/live/$plantId/$zoneId/$lineId",
            params: { plantId, zoneId, lineId },
          },
          { label: machine.id },
        ]}
        period={period}
        onPeriod={setPeriod}
        back={{
          label: lineId,
          to: "/live/$plantId/$zoneId/$lineId",
          params: { plantId, zoneId, lineId },
        }}
      />
      <main className="flex flex-1 flex-col gap-3 p-4">
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard label="Machine OEE" value={machine.oee.toFixed(1)} unit="%" />
          <KpiCard label="Availability" value={machine.availability.toFixed(1)} unit="%" />
          <KpiCard label="Performance" value={machine.performance.toFixed(1)} unit="%" />
          <KpiCard label="Quality" value={machine.quality.toFixed(1)} unit="%" />
          <KpiCard
            label="Status"
            value={machine.status.toUpperCase()}
            tone={machine.status === "down" ? "bad" : machine.status === "slow" ? "warn" : "good"}
            caption={stop ? `${stop.fault} · ${stop.elapsedMinutes}m elapsed` : "no active stop"}
          />
        </div>

        <div className="grid flex-1 auto-rows-fr gap-3 lg:grid-cols-2">
          <Panel title={`${machine.id} · ${machine.type}`} bodyClassName="p-0">
            <div className="h-[230px] w-full">
              <IsoScene viewBox="-110 -120 220 245">
                <IsoGround cols={2.4} rows={2.4} s={46} />
                <IsoBlock x={0.3} y={0.3} w={1.6} d={1.6} h={30} s={46} color="var(--grid)" />
                <IsoBlock
                  x={0.55}
                  y={0.55}
                  w={1.1}
                  d={1.1}
                  h={74}
                  s={46}
                  color={STATUS_HEX[machine.status]}
                />
                <IsoBlock x={0.9} y={0.9} w={0.4} d={0.4} h={98} s={46} color="var(--primary)" />
              </IsoScene>
            </div>
            <div className="grid grid-cols-3 gap-2 border-t border-border p-3 text-[11px]">
              <div className="rounded border border-border px-2 py-1.5">
                <p className="text-muted-foreground">MTTR</p>
                <p className="font-mono font-semibold">{machine.mttr} min</p>
              </div>
              <div className="rounded border border-border px-2 py-1.5">
                <p className="text-muted-foreground">MTBF</p>
                <p className="font-mono font-semibold">{machine.mtbf} min</p>
              </div>
              <div className="rounded border border-border px-2 py-1.5">
                <p className="text-muted-foreground">Stops this shift</p>
                <p className="font-mono font-semibold">{machine.stopsThisShift}</p>
              </div>
            </div>
          </Panel>

          <Panel title="Machine OEE">
            <div className="flex flex-wrap items-center gap-6">
              <Donut value={machine.oee} size={116} label="Machine OEE" />
              <div className="grid min-w-48 flex-1 gap-2">
                <MetricBar label="Availability" value={machine.availability} />
                <MetricBar label="Performance" value={machine.performance} />
                <MetricBar label="Quality" value={machine.quality} />
              </div>
            </div>
          </Panel>

          <Panel
            title="Machine Informations"
            subtitle="Values above the configured limit are shown in red"
          >
            <div className="space-y-3">
              {groups.map((g) => (
                <div key={g}>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {g}
                  </p>
                  <ul className="divide-y divide-border/70 rounded border border-border">
                    {machine.sensors
                      .filter((s) => s.group === g)
                      .map((s) => (
                        <li
                          key={s.key}
                          className="flex items-center justify-between px-2.5 py-1.5 text-[11px]"
                        >
                          <span>{s.label}</span>
                          <span
                            className={cn("font-mono", s.warn ? "font-semibold text-tier-bad" : "")}
                          >
                            {s.value.toLocaleString()} {s.unit}
                          </span>
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title="Current Stop">
            {stop ? (
              <div className="space-y-2 text-[11px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-tier-bad/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-tier-bad">
                    {stop.severity}
                  </span>
                  <span className="font-mono">
                    {line.id}·{machine.id}
                  </span>
                  <span className="font-mono text-muted-foreground">started {stop.startedAt}</span>
                </div>
                <p className="text-sm font-medium">{stop.fault}</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded border border-border px-2 py-1.5">
                    <p className="text-muted-foreground">Elapsed</p>
                    <p className="font-mono font-semibold text-tier-bad">
                      {Math.floor(stop.elapsedMinutes / 60)}h {stop.elapsedMinutes % 60}m
                    </p>
                  </div>
                  <div className="rounded border border-border px-2 py-1.5">
                    <p className="text-muted-foreground">Loss category</p>
                    <p className="font-medium">{stop.lossPath}</p>
                  </div>
                </div>
                <div className="rounded border border-border px-2 py-1.5">
                  <p className="text-muted-foreground">Downstream effect</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {stop.downstream.map((d) => (
                      <span
                        key={d}
                        className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px]"
                      >
                        {d}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState message="Tidak ada stop aktif pada mesin ini" />
            )}
          </Panel>
        </div>
      </main>
    </div>
  );
}
