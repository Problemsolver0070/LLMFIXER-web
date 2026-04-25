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

/* ------------------------------------------------------------------ */
/*  iOS DeviceOrientation permission helper                           */
/* ------------------------------------------------------------------ */

interface DeviceOrientationEventiOS extends DeviceOrientationEvent {
  requestPermission?: () => Promise<"granted" | "denied">;
}

async function requestOrientationPermission(): Promise<boolean> {
  const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
  if (typeof DOE.requestPermission === "function") {
    try {
      const permission = await DOE.requestPermission();
      return permission === "granted";
    } catch {
      return false;
    }
  }
  // Non-iOS — permission not needed
  return true;
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function CosmosCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<CosmosEngine | null>(null);
  const [failed, setFailed] = useState(false);

  /* ---- Mouse handler (stable ref) ---- */
  const handleMouseMove = useCallback((e: MouseEvent) => {
    engineRef.current?.setMousePosition(e.clientX, e.clientY);
  }, []);

  const handleMouseLeave = useCallback(() => {
    engineRef.current?.clearMouseInfluence();
  }, []);

  /* ---- Touch handlers: hold → gravitational well, drag → velocity wake ---- */
  const touchStateRef = useRef({
    startX: 0,
    startY: 0,
    startTime: 0,
    prevX: 0,
    prevY: 0,
    prevTime: 0,
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

    engineRef.current?.setMousePosition(touch.clientX, touch.clientY, 1.0);

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

    // Faster drag → stronger particle wake (1.0 → 2.5)
    const influence = 1.0 + Math.min(velocity / 800, 1.0) * 1.5;
    engineRef.current?.setMousePosition(touch.clientX, touch.clientY, influence);

    state.prevX = touch.clientX;
    state.prevY = touch.clientY;
    state.prevTime = now;
  }, []);

  const handleTouchEnd = useCallback(() => {
    const state = touchStateRef.current;
    if (state.holdTimer) {
      clearInterval(state.holdTimer);
      state.holdTimer = 0;
    }
    engineRef.current?.clearMouseInfluence();
  }, []);

  /* ---- Device orientation: adaptive centering gyro ---- */
  const gyroBaseRef = useRef<{ beta: number; gamma: number } | null>(null);

  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    if (e.gamma == null || e.beta == null) return;

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

    // Map relative tilt to screen position (±45° range)
    const nx = (relativeGamma / 45) * window.innerWidth * 0.5 + window.innerWidth / 2;
    const ny = (relativeBeta / 45) * window.innerHeight * 0.5 + window.innerHeight / 2;

    engineRef.current?.setMousePosition(nx, ny);
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

    // iOS requires DeviceOrientationEvent.requestPermission() inside
    // a user gesture handler (touchstart/click). Hoist the handler so
    // it can be cleaned up if the component unmounts before the gesture.
    const requestGyro = async () => {
      if (disposed) return;
      const hasPermission = await requestOrientationPermission();
      if (hasPermission && !disposed) {
        window.addEventListener("deviceorientation", handleOrientation, {
          passive: true,
        });
      }
    };

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
        window.addEventListener("resize", handleResize, { passive: true });

        // Touch interaction — hold for gravitational well, drag for velocity wake
        window.addEventListener("touchstart", handleTouchStart, { passive: true });
        window.addEventListener("touchmove", handleTouchMove, { passive: true });
        window.addEventListener("touchend", handleTouchEnd, { passive: true });
        window.addEventListener("touchcancel", handleTouchEnd, { passive: true });

        // Attach one-shot touchstart listener for iOS gyroscope permission
        window.addEventListener("touchstart", requestGyro, { once: true });
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
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.removeEventListener("touchcancel", handleTouchEnd);
      if (touchStateRef.current.holdTimer) {
        clearInterval(touchStateRef.current.holdTimer);
      }
      window.removeEventListener("deviceorientation", handleOrientation);
      window.removeEventListener("touchstart", requestGyro);

      setCosmosEngine(null);
      engine.dispose();
      engineRef.current = null;
    };
  }, [handleMouseMove, handleMouseLeave, handleTouchStart, handleTouchMove, handleTouchEnd, handleOrientation, handleResize]);

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
