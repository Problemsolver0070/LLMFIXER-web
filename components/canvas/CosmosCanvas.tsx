"use client";

/**
 * CosmosCanvas — React component that hosts the full-viewport
 * Three.js WebGPU particle cosmos background.
 *
 * - Fixed behind all DOM content
 * - Handles mouse, touch, device orientation interaction
 * - Initializes and disposes the CosmosEngine lifecycle
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { CosmosEngine } from "./cosmos-engine";
import { setCosmosEngine } from "@/lib/cosmos-ref";
import { setTilt } from "@/lib/tilt-state";

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */
/* iOS DeviceOrientation permission flow lives in components/GyroPrompt.tsx
 * — an explicit user-gesture button. CosmosCanvas just registers the
 * deviceorientation listener unconditionally; on iOS without permission
 * the listener stays silent, on iOS with permission (or non-iOS) it fires
 * normally. */

export default function CosmosCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CosmosEngine | null>(null);
  const [failed, setFailed] = useState(false);

  /* ---- Mouse handler (stable ref) ---- */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    engineRef.current?.setMousePosition(e.clientX, e.clientY);
    // Mechanic 3: any mouse motion counts as interaction → resets idle timer.
    engineRef.current?.notifyInteraction();
  }, []);

  const handleMouseLeave = useCallback(() => {
    engineRef.current?.clearMouseInfluence();
  }, []);

  /* ---- Click detection for tap-novas (mechanic 5) ---- */
  // Track mousedown so we can distinguish a true "click" (no significant
  // drag between down and up) from a click-and-drag-select gesture.
  // 10px drag threshold — same value used for the touch path.
  const DRAG_THRESHOLD_PX = 10;
  const mouseDownStateRef = useRef({ x: 0, y: 0, active: false });

  const handleMouseDown = useCallback((e: MouseEvent) => {
    mouseDownStateRef.current.x = e.clientX;
    mouseDownStateRef.current.y = e.clientY;
    mouseDownStateRef.current.active = true;
    // Mechanic 3: a click is interaction even without movement.
    engineRef.current?.notifyInteraction();
  }, []);

  const handleMouseUp = useCallback((e: MouseEvent) => {
    const s = mouseDownStateRef.current;
    if (!s.active) return;
    s.active = false;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.sqrt(dx * dx + dy * dy) <= DRAG_THRESHOLD_PX) {
      engineRef.current?.triggerNova(e.clientX, e.clientY);
    }
    // Mechanic 3: any click (drag or tap) counts as interaction.
    engineRef.current?.notifyInteraction();
  }, []);

  /* ---- Touch handlers: hold → gravitational well, drag → velocity wake ---- */
  // maxMovement tracks the largest displacement from startX/startY across the
  // whole touch lifetime — used in handleTouchEnd to distinguish a genuine
  // tap (mechanic 5) from a drag gesture. Threshold: DRAG_THRESHOLD_PX.
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    prevX: 0,
    prevY: 0,
    prevTime: 0,
    maxMovement: 0,
    holdTimer: 0 as ReturnType<typeof setInterval> | 0,
  });

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    const now = performance.now();
    const state = touchStateRef.current;
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.startTime = now;
    state.prevX = touch.clientX;
    state.prevY = touch.clientY;
    state.prevTime = now;
    state.maxMovement = 0;

    engineRef.current?.setMousePosition(touch.clientX, touch.clientY, 1.0);
    // Mechanic 3: touch counts as interaction → resets idle timer.
    engineRef.current?.notifyInteraction();

    // Hold detection — ramp influence while finger stays still
    if (state.holdTimer) clearInterval(state.holdTimer);
    state.holdTimer = setInterval(() => {
      const dx = state.prevX - state.startX;
      const dy = state.prevY - state.startY;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        const heldMs = performance.now() - state.startTime;
        if (heldMs > 300) {
          const holdStrength = Math.min((heldMs - 300) / 2000, 1.0);
          engineRef.current?.setMousePosition(
            state.prevX,
            state.prevY,
            1.0 + holdStrength * 2.0,
          );
        }
      }
    }, 50);
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;

    const state = touchStateRef.current;
    const now = performance.now();
    const dt = Math.max(now - state.prevTime, 1);
    const dx = touch.clientX - state.prevX;
    const dy = touch.clientY - state.prevY;
    const velocity = (Math.sqrt(dx * dx + dy * dy) / dt) * 1000;

    // Track total displacement from touch origin so handleTouchEnd can
    // decide tap-vs-drag for mechanic 5 (nova trigger).
    const totalDx = touch.clientX - state.startX;
    const totalDy = touch.clientY - state.startY;
    const totalMove = Math.sqrt(totalDx * totalDx + totalDy * totalDy);
    if (totalMove > state.maxMovement) state.maxMovement = totalMove;

    // Faster drag → stronger particle wake (1.0 → 2.5)
    const influence = 1.0 + Math.min(velocity / 800, 1.0) * 1.5;
    engineRef.current?.setMousePosition(touch.clientX, touch.clientY, influence);
    // Mechanic 3: touch motion counts as interaction.
    engineRef.current?.notifyInteraction();

    state.prevX = touch.clientX;
    state.prevY = touch.clientY;
    state.prevTime = now;
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const state = touchStateRef.current;
    if (state.holdTimer) {
      clearInterval(state.holdTimer);
      state.holdTimer = 0;
    }
    engineRef.current?.clearMouseInfluence();

    // Mechanic 5: nova on a true tap (drag below threshold for the entire
    // touch lifetime). Use the lifted-finger coords (changedTouches[0]) so the
    // flare lands at the user's last known fingertip position. touchcancel
    // can fire without changedTouches in some engines — fall back to start.
    if (state.maxMovement <= DRAG_THRESHOLD_PX) {
      const released = e.changedTouches?.[0];
      const cx = released?.clientX ?? state.startX;
      const cy = released?.clientY ?? state.startY;
      engineRef.current?.triggerNova(cx, cy);
    }
  }, []);

  /* ---- Device orientation: adaptive centering gyro ---- */
  const gyroBaseRef = useRef<{ beta: number; gamma: number } | null>(null);

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;

    // Mirror raw reading into tilt-state singleton so HeroSection
    // (and any other consumer) can read the latest orientation.
    setTilt(e.beta, e.gamma);

    // Calibrate on first reading — user's current holding angle becomes center
    if (!gyroBaseRef.current) {
      gyroBaseRef.current = { beta: e.beta, gamma: e.gamma };
    }

    const base = gyroBaseRef.current;
    const relativeGamma = e.gamma - base.gamma;
    const relativeBeta = e.beta - base.beta;

    // Slow adaptive drift — baseline follows gradual posture changes (1% per reading)
    base.beta += (e.beta - base.beta) * 0.01;
    base.gamma += (e.gamma - base.gamma) * 0.01;

    // Mechanic 4: tilt parallaxes the CAMERA, not the cursor. Map ±45° tilt
    // to ±1 normalized offset; the engine clamps and scales by its tilt
    // magnitude. The static star sky at z=-50..-80 visibly shifts more
    // than the foreground particles thanks to perspective projection.
    const xNorm = Math.max(-1, Math.min(1, relativeGamma / 45));
    const yNorm = Math.max(-1, Math.min(1, relativeBeta / 45));
    engineRef.current?.setTiltOffset(xNorm, yNorm);

    // Mechanic 3: any gyro reading counts as interaction.
    engineRef.current?.notifyInteraction();
  }, []);

  /* ---- Resize handler ---- */
  const handleResize = useCallback(() => {
    engineRef.current?.handleResize();
  }, []);

  /* ---- Init / teardown ---- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    const engine = new CosmosEngine(canvas);
    engineRef.current = engine;

    const bootstrap = async () => {
      try {
        await engine.init();
        if (disposed) {
          engine.dispose();
          return;
        }
        engine.start();
        setCosmosEngine(engine);

        // Attach event listeners after successful init
        window.addEventListener("mousemove", handleMouseMove, { passive: true });
        window.addEventListener("mouseleave", handleMouseLeave, { passive: true });
        // Mechanic 5: click-nova requires mousedown + mouseup with no
        // significant drag between them (DRAG_THRESHOLD_PX).
        window.addEventListener("mousedown", handleMouseDown, { passive: true });
        window.addEventListener("mouseup", handleMouseUp, { passive: true });
        window.addEventListener("resize", handleResize, { passive: true });

        // Touch interaction — hold for gravitational well, drag for velocity wake
        window.addEventListener("touchstart", handleTouchStart, { passive: true });
        window.addEventListener("touchmove", handleTouchMove, { passive: true });
        window.addEventListener("touchend", handleTouchEnd, { passive: true });
        window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

        // Device orientation listener registered unconditionally. On iOS
        // without permission it stays silent until GyroPrompt grants it;
        // on Android / desktop / iOS-with-permission it fires normally.
        window.addEventListener("deviceorientation", handleOrientation, { passive: true });
      } catch (err) {
        console.error("[CosmosCanvas] Failed to initialise engine:", err);
        setFailed(true);
      }
    };

    bootstrap();

    return () => {
      disposed = true;

      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseleave", handleMouseLeave);
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      if (touchStateRef.current.holdTimer) {
        clearInterval(touchStateRef.current.holdTimer);
      }
      window.removeEventListener("deviceorientation", handleOrientation);

      setCosmosEngine(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, [handleMouseMove, handleMouseLeave, handleMouseDown, handleMouseUp, handleTouchStart, handleTouchMove, handleTouchEnd, handleOrientation, handleResize]);

  if (failed) {
    return (
      <div className="cosmos-canvas cosmos-fallback" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo/thefixer-mark.svg"
          alt=""
          className="cosmos-fallback-mark"
        />
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="cosmos-canvas"
      aria-hidden="true"
    />
  );
}
