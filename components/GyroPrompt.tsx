"use client";

/**
 * GyroPrompt — explicit iOS DeviceOrientation permission button.
 *
 * iOS 13+ requires DeviceOrientationEvent.requestPermission() to be called
 * from a deliberate user-gesture event handler (tap/click). Our previous
 * implicit "fire on first touchstart" path was unreliable: the user's first
 * touch is often a scroll, which can suppress the permission dialog, and
 * React's strict-mode double-mount also interfered.
 *
 * This component handles the flow explicitly:
 *   - Detects iOS (presence of requestPermission)
 *   - Shows a small floating button on first visit if permission isn't granted
 *   - On click: calls requestPermission() inside a guaranteed user gesture
 *   - On grant: persists in localStorage and hides itself; iOS will then
 *     start firing deviceorientation events that CosmosCanvas already listens
 *     for, so gyro tilt + parallax come alive immediately
 *   - On deny: persists denial so we don't keep nagging
 */

import { useEffect, useState } from "react";

interface DeviceOrientationEventiOS {
  requestPermission?: () => Promise<"granted" | "denied">;
}

const STORAGE_KEY = "fixer:gyroPermission";

type PermissionState = "unknown" | "needed" | "granted" | "denied";

export default function GyroPrompt() {
  const [state, setState] = useState<PermissionState>("unknown");

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Check stored prior decision
    let prior: string | null = null;
    try {
      prior = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode / blocked — treat as fresh
    }
    if (prior === "granted" || prior === "denied") {
      setState(prior);
      return;
    }

    // Probe whether iOS-style permission is required
    const DOE = (typeof DeviceOrientationEvent !== "undefined"
      ? (DeviceOrientationEvent as unknown as DeviceOrientationEventiOS)
      : undefined);
    const needsPermission = !!DOE && typeof DOE.requestPermission === "function";

    setState(needsPermission ? "needed" : "granted");
  }, []);

  const handleClick = async () => {
    const DOE = DeviceOrientationEvent as unknown as DeviceOrientationEventiOS;
    if (typeof DOE.requestPermission !== "function") {
      setState("granted");
      return;
    }
    try {
      const result = await DOE.requestPermission();
      const next: PermissionState = result === "granted" ? "granted" : "denied";
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore storage failures
      }
      setState(next);
    } catch {
      setState("denied");
      try {
        window.localStorage.setItem(STORAGE_KEY, "denied");
      } catch { /* noop */ }
    }
  };

  if (state !== "needed") return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Enable cosmic tilt response"
      className="
        fixed bottom-6 left-1/2 -translate-x-1/2 z-50
        px-5 py-3 rounded-full
        bg-[color:var(--cosmos-deep)]/85 backdrop-blur-sm
        border border-[color:var(--warm-cream)]/40
        text-sm tracking-wide
        text-[color:var(--warm-cream)]
        hover:bg-[color:var(--cosmos-nebula)]/85
        transition-colors duration-300
        cursor-pointer
        shadow-[0_0_20px_rgba(240,224,188,0.15)]
      "
    >
      Tap to feel the cosmos
    </button>
  );
}
