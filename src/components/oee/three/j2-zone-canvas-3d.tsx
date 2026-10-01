import React, { useEffect, useRef } from "react";
import * as THREE from "three";

import { STATUS_HEX } from "@/lib/oee/config";
import type { Zone } from "@/lib/oee/data";
import { J2_LINES_CONFIG, MACHINE_GAP, type J2LineConfig } from "@/lib/oee/j2-layout-config";
import {
  CELL_SIZE_ZONE,
  MAX_ANIMATED_MACHINES,
  buildMachineModel,
  resolveModelKey,
  type ModelInstance,
} from "@/lib/oee/models";

export function J2ZoneCanvas3D({
  zone,
  hoveredLineCode,
  hoveredMachineCode,
  onHoverMachine,
  onLeaveMachine,
  onClickMachine,
}: {
  zone: Zone;
  hoveredLineCode?: string | null;
  hoveredMachineCode?: string | null;
  onHoverMachine?: (
    lineCode: string,
    machineCode: string,
    clientX: number,
    clientY: number,
  ) => void;
  onLeaveMachine?: () => void;
  onClickMachine?: (lineCode: string, machineCode: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const modelInstancesRef = useRef<
    Map<
      string,
      { instance: ModelInstance; plateMesh: THREE.Mesh; lineCode: string; machineCode: string }
    >
  >(new Map());
  const animFrameRef = useRef<number | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const linesForZone = J2_LINES_CONFIG.filter((l) => l.zoneId === zone.id);

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
      console.warn("WebGL initialization failed for J2ZoneCanvas3D", e);
      return;
    }

    const scene = new THREE.Scene();
    const aspect = container.clientWidth / Math.max(container.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 300);

    // Lighting
    const hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 0.9);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffffff, 0.85);
    sun.position.set(16, 26, 20);
    scene.add(sun);

    const fillSun = new THREE.DirectionalLight(0xffffff, 0.3);
    fillSun.position.set(-10, 8, -8);
    scene.add(fillSun);

    // Zone Ground Floor Plate
    const groundGeo = new THREE.BoxGeometry(40, 0.08, 48);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.85,
      metalness: 0.05,
      transparent: true,
      opacity: 0.5,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -0.06, 0);
    scene.add(ground);

    // Camera target
    camera.position.set(24, 32, 36);
    camera.lookAt(0, 0, 0);

    // Build machines for this zone
    const instances = new Map<
      string,
      { instance: ModelInstance; plateMesh: THREE.Mesh; lineCode: string; machineCode: string }
    >();

    linesForZone.forEach((lineCfg) => {
      const isRtl = lineCfg.flowDirection === "right-to-left";
      const lineData = zone.lines.find((l) => l.id === lineCfg.code);

      lineCfg.machines.forEach((mCfg, mIdx) => {
        const uniqueKey = `${lineCfg.code}-${mCfg.code}-${mIdx}`;
        const modelKey = resolveModelKey(mCfg.code);
        const machineData = lineData?.machines.find(
          (m) => m.id === mCfg.code || m.code === mCfg.code,
        );
        const status = machineData?.status ?? "running";

        try {
          const modelInst = buildMachineModel(modelKey, {
            lod: 1,
            seed: mIdx * 60 + 23,
            status,
          });

          // Normalize scale
          const bounds = modelInst.getBounds();
          const sizeX = Math.max(0.1, bounds.max.x - bounds.min.x);
          const sizeZ = Math.max(0.1, bounds.max.z - bounds.min.z);
          const maxDim = Math.max(sizeX, sizeZ);
          const scaleFactor = Math.min(1.0, (CELL_SIZE_ZONE * 0.72) / maxDim);
          modelInst.group.scale.setScalar(scaleFactor);

          // Position
          const bx = (lineCfg.zoneViewLayout.x + (mCfg.offsetX ?? mIdx * MACHINE_GAP)) * 1.6 - 12;
          let bz = (lineCfg.zoneViewLayout.y + (mCfg.offsetY ?? 0)) * 1.6 - 18;
          if (mCfg.subRow === "top") bz -= 1.2;

          modelInst.group.position.set(bx, 0, bz);

          // Flow orientation
          if (isRtl) {
            modelInst.group.rotation.y = Math.PI;
          }

          // Status base plate (machine status color)
          const plateGeo = new THREE.BoxGeometry(
            CELL_SIZE_ZONE * 0.85,
            0.06,
            CELL_SIZE_ZONE * 0.85,
          );
          const plateMat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(STATUS_HEX[status]),
            roughness: 0.5,
            metalness: 0.2,
            transparent: true,
            opacity: 0.85,
          });
          const plate = new THREE.Mesh(plateGeo, plateMat);
          plate.position.set(bx, -0.03, bz);
          plate.userData = { lineCode: lineCfg.code, machineCode: mCfg.code };
          scene.add(plate);

          scene.add(modelInst.group);
          instances.set(uniqueKey, {
            instance: modelInst,
            plateMesh: plate,
            lineCode: lineCfg.code,
            machineCode: mCfg.code,
          });
        } catch (err) {
          console.warn(`Error building model for ${mCfg.code}:`, err);
        }
      });
    });

    modelInstancesRef.current = instances;

    // Raycast for hover/click
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      let found = false;
      for (const hit of intersects) {
        let cur: THREE.Object3D | null = hit.object;
        while (cur && cur !== scene) {
          if (cur.userData && cur.userData.lineCode) {
            onHoverMachine?.(cur.userData.lineCode, cur.userData.machineCode, e.clientX, e.clientY);
            found = true;
            break;
          }
          cur = cur.parent;
        }
        if (found) break;
      }
      if (!found) {
        onLeaveMachine?.();
      }
    };

    const onClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children, true);

      for (const hit of intersects) {
        let cur: THREE.Object3D | null = hit.object;
        while (cur && cur !== scene) {
          if (cur.userData && cur.userData.lineCode) {
            onClickMachine?.(cur.userData.lineCode, cur.userData.machineCode);
            return;
          }
          cur = cur.parent;
        }
      }
    };

    canvas.addEventListener("mousemove", onPointerMove);
    canvas.addEventListener("click", onClick);

    // Resize Handler with requestAnimationFrame debounce
    let resizeRaf: number | null = null;
    const resize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };

    const handleResize = () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        resizeRaf = null;
        resize();
      });
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);
    resize();

    // Render loop with MAX_ANIMATED_MACHINES cap
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

      let animatedCount = 0;
      instances.forEach(({ instance, lineCode }) => {
        const isLineHovered = hoveredLineCode === lineCode;
        if (isLineHovered || animatedCount < MAX_ANIMATED_MACHINES) {
          instance.update(dt, now / 1000);
          animatedCount++;
        }
      });

      renderer.render(scene, camera);
    };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (resizeRaf !== null) cancelAnimationFrame(resizeRaf);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      resizeObserver.disconnect();
      canvas.removeEventListener("mousemove", onPointerMove);
      canvas.removeEventListener("click", onClick);

      instances.forEach(({ instance }) => instance.dispose());
      renderer.dispose();
    };
  }, [zone, linesForZone, onClickMachine, onHoverMachine, onLeaveMachine, hoveredLineCode]);

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full overflow-hidden">
      <canvas ref={canvasRef} className="h-full w-full touch-none cursor-pointer" />
    </div>
  );
}
