import { useNavigate } from "@tanstack/react-router";
import { Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import {
  STATUS_DOT,
  STATUS_HEX,
  STATUS_LABEL,
  TIER_HEX,
  TIER_TEXT,
  tierOf,
  type Status,
} from "@/lib/oee/config";
import type { Line } from "@/lib/oee/data";
import { buildMachineModel, resolveModelKey, type ModelInstance } from "@/lib/oee/models";
import { cn } from "@/lib/utils";

// Configurable layout gap between machine bounding boxes
export const LINE_CHAIN_MACHINE_GAP = 1.4;

export function LineChainView3D({
  plantId,
  zoneId,
  line,
  className,
}: {
  plantId: string;
  zoneId: string;
  line: Line;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoveredMachineId, setHoveredMachineId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isPlayingRef = useRef(true);
  isPlayingRef.current = isPlaying;

  const navigate = useNavigate();
  const machines = line.machines;

  const modelInstancesRef = useRef<
    {
      machineId: string;
      instance: ModelInstance;
      hitMesh: THREE.Mesh;
      group: THREE.Group;
      centerOffset: number;
    }[]
  >([]);
  const animFrameRef = useRef<number | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Camera Orbit state
  const orbitRef = useRef({
    th: 0.78, // ~45 deg
    ph: 0.55, // ~30 deg elevation
    dist: 22,
    target: new THREE.Vector3(0, 1.0, 0),
    current: new THREE.Vector3(0, 1.0, 0),
    initialDist: 22,
    initialTarget: new THREE.Vector3(0, 1.0, 0),
  });

  const resetCamera = () => {
    orbitRef.current.th = 0.78;
    orbitRef.current.ph = 0.55;
    orbitRef.current.dist = orbitRef.current.initialDist;
    orbitRef.current.target.copy(orbitRef.current.initialTarget);
  };

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      rendererRef.current = renderer;
    } catch (e) {
      console.warn("WebGL failed for LineChainView3D, falling back", e);
      setHasError(true);
      return;
    }

    const scene = new THREE.Scene();
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(36, aspect, 0.1, 200);

    // Lighting rig
    const hemi = new THREE.HemisphereLight(0xffffff, 0x667788, 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(16, 24, 18);
    scene.add(sun);

    const fillSun = new THREE.DirectionalLight(0xffffff, 0.35);
    fillSun.position.set(-12, 8, -10);
    scene.add(fillSun);

    // Chain root group that will be centered at the origin
    const chainGroup = new THREE.Group();
    scene.add(chainGroup);

    // Build machines row with bounding-box-based dynamic positioning
    const machineEntries: {
      machineId: string;
      instance: ModelInstance;
      hitMesh: THREE.Mesh;
      group: THREE.Group;
      centerOffset: number;
    }[] = [];

    let currentX = 0;
    const machinePositions: {
      machineId: string;
      xStart: number;
      xEnd: number;
      xCenter: number;
      width: number;
      height: number;
      depth: number;
    }[] = [];

    // 1. Build and measure all machines
    machines.forEach((m, idx) => {
      const modelKey = resolveModelKey(m.id || m.name);
      try {
        const instance = buildMachineModel(modelKey, {
          lod: 1,
          status: m.status,
          seed: idx * 100 + 42,
        });

        // Compute natural bounding box
        const rawBounds = instance.getBounds();
        const rawWidth = Math.max(0.8, rawBounds.max.x - rawBounds.min.x);
        const rawHeight = Math.max(1.0, rawBounds.max.y - rawBounds.min.y);
        const rawDepth = Math.max(0.8, rawBounds.max.z - rawBounds.min.z);

        // Normalize scaling so tall or wide machines fit harmoniously
        const targetScale = Math.min(1.0, 3.2 / Math.max(rawWidth, rawHeight, rawDepth));
        instance.group.scale.setScalar(targetScale);

        const scaledWidth = rawWidth * targetScale;
        const scaledHeight = rawHeight * targetScale;
        const scaledDepth = rawDepth * targetScale;

        // Position along X axis
        const xStart = currentX;
        const xCenter = xStart + scaledWidth / 2;
        const xEnd = xStart + scaledWidth;

        instance.group.position.set(xCenter, 0, 0);

        // Invisible hit-box mesh for raycasting click/hover
        const hitGeo = new THREE.BoxGeometry(
          scaledWidth + 0.4,
          Math.max(2.5, scaledHeight + 0.5),
          scaledDepth + 0.6,
        );
        const hitMat = new THREE.MeshBasicMaterial({
          visible: false,
          transparent: true,
          opacity: 0,
        });
        const hitMesh = new THREE.Mesh(hitGeo, hitMat);
        hitMesh.position.set(xCenter, scaledHeight / 2, 0);
        hitMesh.userData = { machineId: m.id, machineCode: m.id };
        chainGroup.add(hitMesh);

        // Base plate under each machine
        const plateGeo = new THREE.BoxGeometry(scaledWidth + 0.2, 0.06, scaledDepth + 0.3);
        const plateMat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(STATUS_HEX[m.status]),
          roughness: 0.5,
          metalness: 0.2,
          transparent: true,
          opacity: 0.85,
        });
        const plate = new THREE.Mesh(plateGeo, plateMat);
        plate.position.set(xCenter, -0.03, 0);
        chainGroup.add(plate);

        chainGroup.add(instance.group);

        machineEntries.push({
          machineId: m.id,
          instance,
          hitMesh,
          group: instance.group,
          centerOffset: xCenter,
        });

        machinePositions.push({
          machineId: m.id,
          xStart,
          xEnd,
          xCenter,
          width: scaledWidth,
          height: scaledHeight,
          depth: scaledDepth,
        });

        // Advance to next machine with configurable gap
        currentX = xEnd + LINE_CHAIN_MACHINE_GAP;
      } catch (err) {
        console.warn(`Failed to build 3D model for machine ${m.id}:`, err);
      }
    });

    const totalChainWidth = Math.max(2.0, currentX - LINE_CHAIN_MACHINE_GAP);
    const chainCenterX = totalChainWidth / 2;

    // Offset chainGroup so it is perfectly centered at the world origin (0,0,0)
    chainGroup.position.set(-chainCenterX, 0, 0);

    // Continuous conveyor belt running along the entire chain
    const conveyorLength = totalChainWidth + 3.0;
    const conveyorGeo = new THREE.BoxGeometry(conveyorLength, 0.12, 0.7);
    const conveyorMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.7,
      roughness: 0.3,
    });
    const conveyorBelt = new THREE.Mesh(conveyorGeo, conveyorMat);
    conveyorBelt.position.set(0, 0.1, 0);
    scene.add(conveyorBelt);

    // Conveyor support legs
    const numLegs = Math.max(2, Math.floor(conveyorLength / 3));
    const legGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.6, 8);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.5 });
    for (let i = 0; i <= numLegs; i++) {
      const lx = -conveyorLength / 2 + (i * conveyorLength) / numLegs;
      const leg1 = new THREE.Mesh(legGeo, legMat);
      leg1.position.set(lx, -0.2, -0.28);
      scene.add(leg1);
      const leg2 = new THREE.Mesh(legGeo, legMat);
      leg2.position.set(lx, -0.2, 0.28);
      scene.add(leg2);
    }

    // Continuous ground foundation plate
    const groundGeo = new THREE.BoxGeometry(totalChainWidth + 5.0, 0.08, 6.5);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.15,
      roughness: 0.9,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.1, 0);
    scene.add(ground);

    // Grid helper
    const grid = new THREE.GridHelper(Math.max(24, totalChainWidth + 8), 24, 0x94a3b8, 0xcbd5e1);
    grid.position.y = -0.11;
    if (grid.material instanceof THREE.Material) {
      grid.material.transparent = true;
      grid.material.opacity = 0.25;
    }
    scene.add(grid);

    modelInstancesRef.current = machineEntries;

    // Camera initial framing based on total chain width
    const calculatedDist = Math.max(12, totalChainWidth * 1.35 + 4);
    orbitRef.current.dist = calculatedDist;
    orbitRef.current.initialDist = calculatedDist;
    orbitRef.current.target.set(0, 0.8, 0);
    orbitRef.current.initialTarget.set(0, 0.8, 0);

    // Raycaster for interactive hover & click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Controls state
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    let hasDraggedDistance = 0;
    const activePointers = new Map<number, { x: number; y: number }>();
    let prevPinchDist = 0;

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      hasDraggedDistance = 0;
      prevPinchDist = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      // Raycast machine hover
      raycaster.setFromCamera(mouse, camera);
      const hitMeshes = machineEntries.map((me) => me.hitMesh);
      const intersects = raycaster.intersectObjects(hitMeshes, false);

      if (intersects.length > 0) {
        const topHit = intersects[0].object;
        const mId = topHit.userData.machineId;
        if (mId) {
          setHoveredMachineId(mId);
          canvas.style.cursor = "pointer";
        }
      } else {
        if (!isDragging) {
          setHoveredMachineId(null);
          canvas.style.cursor = "grab";
        }
      }

      if (!isDragging) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      hasDraggedDistance += Math.hypot(dx, dy);
      dragStart = { x: e.clientX, y: e.clientY };

      if (activePointers.size === 2) {
        const [p1, p2] = Array.from(activePointers.values());
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (prevPinchDist > 0) {
          const factor = prevPinchDist / d;
          orbitRef.current.dist = Math.min(60, Math.max(4, orbitRef.current.dist * factor));
        }
        prevPinchDist = d;
        return;
      }

      if (e.shiftKey || e.button === 2) {
        // Pan
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        orbitRef.current.target.addScaledVector(right, -dx * 0.02);
        orbitRef.current.target.addScaledVector(up, dy * 0.02);
      } else {
        // Orbit
        orbitRef.current.th -= dx * 0.007;
        orbitRef.current.ph = Math.min(1.45, Math.max(0.12, orbitRef.current.ph - dy * 0.007));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 0) {
        isDragging = false;
        canvas.style.cursor = "grab";
      }

      // If it was a clean click (not a drag), handle machine click navigation
      if (hasDraggedDistance < 6) {
        const rect = canvas.getBoundingClientRect();
        mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        const hitMeshes = machineEntries.map((me) => me.hitMesh);
        const intersects = raycaster.intersectObjects(hitMeshes, false);

        if (intersects.length > 0) {
          const topHit = intersects[0].object;
          const mId = topHit.userData.machineId;
          if (mId) {
            navigate({
              to: "/live/$plantId/$zoneId/$lineId/$machineId",
              params: {
                plantId,
                zoneId,
                lineId: line.id,
                machineId: mId,
              },
            });
          }
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.08 : 0.92;
      orbitRef.current.dist = Math.min(60, Math.max(4, orbitRef.current.dist * zoomFactor));
    };

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onDblClick = () => resetCamera();

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    canvas.addEventListener("contextmenu", onContextMenu);
    canvas.addEventListener("dblclick", onDblClick);

    // Resize handler
    const resize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    // Render loop
    let lastTime = performance.now();
    let isVisible = true;

    const onVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    const loop = (now: number) => {
      animFrameRef.current = requestAnimationFrame(loop);
      if (!isVisible) return;

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Update machine model animations when playing
      if (isPlayingRef.current) {
        machineEntries.forEach(({ instance }) => {
          instance.update(dt, now / 1000);
        });
      }

      // Smooth camera interpolation
      const { th, ph, dist, target, current } = orbitRef.current;
      current.lerp(target, 0.1);

      const sinPh = Math.sin(ph);
      const cosPh = Math.cos(ph);
      const sinTh = Math.sin(th);
      const cosTh = Math.cos(th);

      camera.position.set(
        current.x + dist * sinPh * sinTh,
        current.y + dist * cosPh,
        current.z + dist * sinPh * cosTh,
      );
      camera.lookAt(current);

      renderer.render(scene, camera);
    };

    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      canvas.removeEventListener("dblclick", onDblClick);
      machineEntries.forEach(({ instance }) => instance.dispose());
      renderer.dispose();
    };
  }, [machines, navigate, plantId, zoneId, line.id]);

  // Update statuses on live refresh
  useEffect(() => {
    machines.forEach((m) => {
      const entry = modelInstancesRef.current.find((e) => e.machineId === m.id);
      if (entry) entry.instance.setStatus(m.status);
    });
  }, [machines]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-full w-full min-h-[380px] flex-col overflow-hidden rounded-lg bg-surface/30 select-none",
        className,
      )}
    >
      {/* 3D Canvas with interactive controls */}
      <canvas
        ref={canvasRef}
        className="h-full w-full cursor-grab active:cursor-grabbing touch-none"
      />

      {/* Interactive Machine Chips Overlay */}
      <div className="absolute inset-x-4 top-4 z-20 flex flex-wrap items-center justify-center gap-3 pointer-events-auto">
        {machines.map((m, idx) => {
          const isHovered = hoveredMachineId === m.id;
          const tier = tierOf(m.oee);

          return (
            <div key={m.id} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  navigate({
                    to: "/live/$plantId/$zoneId/$lineId/$machineId",
                    params: {
                      plantId,
                      zoneId,
                      lineId: line.id,
                      machineId: m.id,
                    },
                  })
                }
                onMouseEnter={() => setHoveredMachineId(m.id)}
                onMouseLeave={() => setHoveredMachineId(null)}
                className={cn(
                  "group flex items-center gap-2 rounded-full border bg-surface/95 px-3 py-1.5 shadow-sm backdrop-blur-md transition-all cursor-pointer",
                  isHovered
                    ? "border-primary ring-2 ring-primary/20 scale-105"
                    : "border-border/80 hover:border-foreground/50",
                )}
                style={{
                  borderColor: isHovered ? "var(--primary)" : TIER_HEX[tier],
                }}
              >
                <span className={cn("size-2 rounded-full", STATUS_DOT[m.status])} />
                <span className="font-mono text-xs font-bold text-foreground">{m.id}</span>
                <span className={cn("font-mono text-xs font-bold", TIER_TEXT[tier])}>
                  {m.oee.toFixed(0)}%
                </span>
              </button>

              {idx < machines.length - 1 && (
                <span className="text-xs font-bold text-muted-foreground/60 select-none">→</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Floating Toolbar: Status Pill + Play/Pause & Reset Camera Controls */}
      <div className="absolute bottom-3 inset-x-3 z-20 flex items-center justify-between pointer-events-none">
        <div className="flex items-center gap-2 pointer-events-auto">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-xs backdrop-blur-md border border-border/80 bg-surface/90",
              line.status === "running" && "text-status-running",
              line.status === "slow" && "text-status-slow",
              line.status === "down" && "text-status-down",
              line.status === "idle" && "text-muted-foreground",
            )}
          >
            <span className={cn("size-2 rounded-full", STATUS_DOT[line.status])} />
            <span>{STATUS_LABEL[line.status]}</span>
          </span>
          {hoveredMachineId && (
            <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-mono font-bold bg-primary/10 text-primary border border-primary/30 backdrop-blur-md shadow-xs">
              Selected: {hoveredMachineId} (Click to open telemetry)
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 rounded-md border border-border/80 bg-surface/90 p-1 shadow-sm backdrop-blur-md pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsPlaying((v) => !v)}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            title={isPlaying ? "Pause Animation" : "Play Animation"}
          >
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={resetCamera}
            className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
            title="Reset Camera View (Double click canvas)"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Fallback View */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/80 p-6 text-center">
          <p className="text-xs text-muted-foreground">
            3D machine chain view preview unavailable. Showing telemetry.
          </p>
        </div>
      )}
    </div>
  );
}
