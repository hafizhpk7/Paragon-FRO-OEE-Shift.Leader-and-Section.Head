import { Pause, Play, RotateCcw } from "lucide-react";
import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";

import { STATUS_DOT, STATUS_LABEL, type Status } from "@/lib/oee/config";
import {
  DEFAULT_CAMERA,
  buildMachineModel,
  resolveModelKey,
  type ModelInstance,
} from "@/lib/oee/models";
import { cn } from "@/lib/utils";

export function MachineView3D({
  machineCode,
  machineName,
  status,
  className,
}: {
  machineCode: string;
  machineName?: string;
  status: Status;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [hasError, setHasError] = useState(false);
  const isPlayingRef = useRef(true);
  isPlayingRef.current = isPlaying;

  const modelKey = resolveModelKey(machineCode);
  const camPreset = DEFAULT_CAMERA[modelKey] || DEFAULT_CAMERA.filling;

  // Refs for animation loop & cleanup
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const modelInstanceRef = useRef<ModelInstance | null>(null);
  const animFrameRef = useRef<number | null>(null);

  // Camera Orbit state
  const orbitRef = useRef({
    th: camPreset.th,
    ph: camPreset.ph,
    dist: camPreset.dist,
    target: new THREE.Vector3(...camPreset.target),
    current: new THREE.Vector3(...camPreset.target),
  });

  const resetCamera = () => {
    orbitRef.current.th = camPreset.th;
    orbitRef.current.ph = camPreset.ph;
    orbitRef.current.dist = camPreset.dist;
    orbitRef.current.target.set(...camPreset.target);
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
      console.warn("WebGL initialization failed, showing fallback block", e);
      setHasError(true);
      return;
    }

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(
      camPreset.fov,
      container.clientWidth / Math.max(container.clientHeight, 1),
      0.1,
      200,
    );
    cameraRef.current = camera;

    // Lighting rig
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.9);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(8, 14, 10);
    scene.add(sun);

    const fillSun = new THREE.DirectionalLight(0xffffff, 0.3);
    fillSun.position.set(-6, 5, -4);
    scene.add(fillSun);

    // Floor grid
    const grid = new THREE.GridHelper(32, 32, 0x8894a8, 0xb8c1d0);
    grid.position.y = -0.01;
    if (grid.material instanceof THREE.Material) {
      grid.material.transparent = true;
      grid.material.opacity = 0.25;
    }
    scene.add(grid);

    // Build model
    let modelInstance: ModelInstance;
    try {
      modelInstance = buildMachineModel(modelKey, {
        lod: 2,
        status,
        seed: 42,
      });
      scene.add(modelInstance.group);
      modelInstanceRef.current = modelInstance;
    } catch (err) {
      console.warn(`Failed to build 3D model for ${machineCode}:`, err);
      setHasError(true);
      return;
    }

    // Pointer controls (Orbit, Pan, Zoom)
    let isDragging = false;
    let dragStart = { x: 0, y: 0 };
    const activePointers = new Map<number, { x: number; y: number }>();
    let prevPinchDist = 0;

    const onPointerDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      isDragging = true;
      dragStart = { x: e.clientX, y: e.clientY };
      prevPinchDist = 0;
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isDragging) return;
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (activePointers.size === 2) {
        const [p1, p2] = Array.from(activePointers.values());
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        if (prevPinchDist > 0) {
          const factor = prevPinchDist / d;
          orbitRef.current.dist = Math.min(
            camPreset.maxDist,
            Math.max(camPreset.minDist, orbitRef.current.dist * factor),
          );
        }
        prevPinchDist = d;
        return;
      }

      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      dragStart = { x: e.clientX, y: e.clientY };

      if (e.shiftKey || e.button === 2) {
        // Pan
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        orbitRef.current.target.addScaledVector(right, -dx * 0.015);
      } else {
        // Orbit
        orbitRef.current.th -= dx * 0.007;
        orbitRef.current.ph = Math.min(1.5, Math.max(0.1, orbitRef.current.ph - dy * 0.007));
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size === 0) {
        isDragging = false;
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      orbitRef.current.dist = Math.min(
        camPreset.maxDist,
        Math.max(camPreset.minDist, orbitRef.current.dist * (1 + e.deltaY * 0.001)),
      );
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

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

    // Animation Loop
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

      if (isPlayingRef.current && modelInstanceRef.current) {
        modelInstanceRef.current.update(dt, now / 1000);
      }

      // Smooth camera interpolation
      const orbit = orbitRef.current;
      orbit.current.lerp(orbit.target, 0.1);

      camera.position.set(
        orbit.current.x + orbit.dist * Math.sin(orbit.ph) * Math.sin(orbit.th),
        orbit.current.y + orbit.dist * Math.cos(orbit.ph),
        orbit.current.z + orbit.dist * Math.sin(orbit.ph) * Math.cos(orbit.th),
      );
      camera.lookAt(orbit.current);

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

      modelInstance.dispose();
      renderer.dispose();
    };
  }, [machineCode, modelKey, camPreset, status]);

  // Update status dynamically on live refresh
  useEffect(() => {
    if (modelInstanceRef.current) {
      modelInstanceRef.current.setStatus(status);
    }
  }, [status]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-full w-full min-h-[420px] flex-col overflow-hidden rounded-lg bg-surface/50 select-none",
        className,
      )}
    >
      {/* 3D Canvas */}
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none cursor-grab active:cursor-grabbing"
      />

      {/* Fallback View if WebGL fails */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-muted/80 p-6 text-center">
          <div className="size-16 rounded-xl bg-primary/20 flex items-center justify-center text-primary font-bold text-xl">
            {machineCode}
          </div>
          <p className="text-xs text-muted-foreground">
            3D rendering preview unavailable. Showing fallback telemetry.
          </p>
        </div>
      )}

      {/* Top Toolbar Controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsPlaying(!isPlaying)}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-xs backdrop-blur-md transition-colors hover:bg-muted cursor-pointer"
        >
          {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          <span>{isPlaying ? "Pause" : "Play"}</span>
        </button>
        <button
          type="button"
          onClick={resetCamera}
          className="flex items-center gap-1.5 rounded-md border border-border bg-surface/90 px-2.5 py-1 text-xs font-medium text-foreground shadow-xs backdrop-blur-md transition-colors hover:bg-muted cursor-pointer"
        >
          <RotateCcw className="size-3.5" />
          <span>Reset</span>
        </button>
      </div>

      {/* Bottom Status Pill */}
      <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider shadow-xs backdrop-blur-md border border-border/80 bg-surface/90",
            status === "running" && "text-status-running",
            status === "slow" && "text-status-slow",
            status === "down" && "text-status-down",
            status === "idle" && "text-muted-foreground",
          )}
        >
          <span className={cn("size-2 rounded-full", STATUS_DOT[status])} />
          <span>{STATUS_LABEL[status]}</span>
        </span>
      </div>

      {/* Bottom Interaction Hint */}
      <div className="absolute bottom-3 right-3 z-10 hidden sm:block text-[11px] text-muted-foreground select-none pointer-events-none bg-surface/60 px-2 py-0.5 rounded backdrop-blur-xs">
        Drag: rotate · Scroll: zoom · Shift+drag: pan
      </div>
    </div>
  );
}
