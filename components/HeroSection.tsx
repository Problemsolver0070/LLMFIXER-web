"use client";

/**
 * HeroSection — orchestrates the 0-3s genesis sequence and renders the
 * hero copy that fades in once the cosmos has formed the mark.
 *
 * Choreography (when the engine is ready):
 *   t = 0.0s   particles drift from their seeded sphere (existing curl noise)
 *   t = 0.5s   seekStrength ramps 0 → 0.75    (atoms begin pulling to targets)
 *   t = 1.5s   logoGlow ramps 0 → 1            (ignition pulse)
 *   t = 2.0s   logoGlow eases 1 → 0            (bloom rolloff)
 *   t = 2.0s   seekStrength eases 0.75 → 0.30  (mark holds + relaxes)
 *   t = 2.4s   hero copy fades in              (the form is visible, content arrives)
 *   t > 3s     ambient — every 14-20s a soft logoGlow pulse (cosmic event)
 *
 * Personalization:
 *  - Returning visitors start the timeline with a slight head-start in
 *    seekStrength so coalescence completes ~0.15s earlier and the hero
 *    copy fades in 0.15s sooner. The first ambient pulse fires at t=8s
 *    instead of t=14s — the place "remembers" them.
 *  - Every visitor gets a slightly different mark: a tilt+aspect rotation
 *    of the satellite ring, a dwell-driven density (6500-11000 particles),
 *    and 0-3 dwell-scaled inner sub-peaks within the central cluster.
 *    The brand DNA (1 cluster + 6 satellites in roughly the same angular
 *    spread) is invariant.
 *
 * Reduced-motion: instant teleport to the mark + immediate copy reveal,
 * no GSAP timeline, no ambient pulses. Visit is still recorded.
 */

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { onEngineReady } from "@/lib/cosmos-ref";
import { getTilt } from "@/lib/tilt-state";
import { getVisitorSignature, recordVisit } from "@/lib/visitor-signature";

/* ------------------------------------------------------------------ */
/*  Per-visitor random utilities                                      */
/* ------------------------------------------------------------------ */

/** mulberry32 — small fast deterministic PRNG. */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate target positions for the brand mark — a central focal cluster
 * plus 6 asymmetric satellites — varied per-visit by tilt, dwell, and seed.
 *
 * Brand DNA preserved:
 *  - exactly 1 central focal cluster (~62% of count)
 *  - exactly 6 satellites, same base angular spread
 * Personalized:
 *  - whole satellite ring rotated by `axisRotation`
 *  - total particle count scales with `count` (caller-determined from dwell)
 *  - 0-3 inner sub-peaks added inside the central cluster (dwell-driven)
 */
function generateMarkPoints(
  count: number,
  axisRotation: number,
  subPeakCount: number,
  rand: () => number,
): Float32Array {
  const points = new Float32Array(count * 3);
  const centralCount = Math.floor(count * 0.62);
  const satCountPerNode = Math.floor((count - centralCount) / 6);

  // Box-Muller for proper Gaussian samples (mean 0, stdev 1) — driven by
  // the seeded PRNG so the mark is deterministic per page load.
  const gauss = () => {
    const u = rand() || 1e-9;
    const v = rand() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // ---- Central focal cluster ----
  // Sub-peaks: 0-3 small offset attractors inside the central cloud.
  // Each sub-peak grabs a fraction of the central particles.
  const subPeaks: { x: number; y: number; z: number }[] = [];
  for (let s = 0; s < subPeakCount; s++) {
    subPeaks.push({
      x: (rand() - 0.5) * 3.0,
      y: (rand() - 0.5) * 3.0,
      z: (rand() - 0.5) * 0.8,
    });
  }
  const subPeakShare = subPeaks.length > 0 ? 0.18 : 0; // ~18% per sub-peak slot
  for (let i = 0; i < centralCount; i++) {
    const useSub =
      subPeaks.length > 0 && rand() < subPeakShare * subPeaks.length;
    if (useSub) {
      const sp = subPeaks[Math.min(subPeaks.length - 1, (rand() * subPeaks.length) | 0)];
      points[i * 3]     = sp.x + gauss() * 1.1;
      points[i * 3 + 1] = sp.y + gauss() * 1.1;
      points[i * 3 + 2] = sp.z + gauss() * 0.4;
    } else {
      points[i * 3]     = gauss() * 2.0;
      points[i * 3 + 1] = gauss() * 2.0;
      points[i * 3 + 2] = gauss() * 0.6;
    }
  }

  // ---- 6 satellites ----
  // Angles intentionally not evenly spaced to match the asymmetric
  // character of the SVG mark; rotated as a whole by `axisRotation`.
  const baseSatOrbits: { angle: number; radius: number }[] = [
    { angle: 0.45, radius: 8.5 },
    { angle: 1.55, radius: 9.6 }, // alpha satellite — slightly farther
    { angle: 2.50, radius: 7.8 },
    { angle: 3.45, radius: 8.2 },
    { angle: 4.30, radius: 7.4 },
    { angle: 5.25, radius: 9.0 },
  ];

  let pi = centralCount;
  for (const { angle, radius } of baseSatOrbits) {
    const rotated = angle + axisRotation;
    const cx = Math.cos(rotated) * radius;
    const cy = Math.sin(rotated) * radius;
    for (let j = 0; j < satCountPerNode; j++) {
      points[pi * 3]     = cx + gauss() * 0.95;
      points[pi * 3 + 1] = cy + gauss() * 0.95;
      points[pi * 3 + 2] = gauss() * 0.45;
      pi++;
    }
  }

  return points;
}

/** Clamp helper. */
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export default function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Read prior visitor state synchronously — drives genesis-pace tweaks.
    const visitor = getVisitorSignature();
    const isReturning = visitor.isReturning;
    const visitCount = visitor.visitCount;

    // Seed varies per page load: 1000-bucketed wallclock + visitCount means
    // the same returning visitor sees a fresh mark every time, but a fresh
    // visitor on the same instant gets a consistent reproducible mark.
    const seed = (Date.now() % 1000) + visitCount;
    const rand = mulberry32(seed);

    // dwell tracking — page-load → first-input. Use performance.now() so
    // it represents page-load-to-now elapsed ms when read at coalescence.
    let firstInputAt: number | null = null;
    const captureFirstInput = () => {
      if (firstInputAt == null) firstInputAt = performance.now();
    };
    window.addEventListener("pointerdown", captureFirstInput, { once: true, passive: true });
    window.addEventListener("keydown", captureFirstInput, { once: true, passive: true });
    window.addEventListener("touchstart", captureFirstInput, { once: true, passive: true });

    let ambientTimeout: ReturnType<typeof setTimeout> | null = null;
    let timeline: gsap.core.Timeline | null = null;
    let visitRecorded = false;

    // Failsafe — surface hero copy at 3.2s even if the engine never initializes.
    const failsafe = setTimeout(() => {
      if (heroRef.current) heroRef.current.style.opacity = "1";
      if (!visitRecorded) {
        visitRecorded = true;
        recordVisit({ dwellMs: performance.now() });
      }
    }, 3200);

    const unsubscribe = onEngineReady((engine) => {
      clearTimeout(failsafe);

      // ---- Per-visitor mark generation ----
      // Effective dwell at coalescence = first-input ms, or the elapsed
      // page-load → now (capped at 3000ms baseline if user has been quiet).
      const elapsed = performance.now();
      const dwellMs = firstInputAt ?? Math.min(elapsed, 3000);

      // Density: patient visitors get richer marks, quick-input visitors
      // get sharper simpler marks. Range: 6500 → 11000.
      const TARGET_COUNT = Math.floor(clamp(6500 + dwellMs * 1.2, 6500, 11000));

      // Sub-peak count: 0-3 inner sub-densities scaled by dwell.
      // 0 sub-peaks at low dwell (<800ms), up to 3 at high dwell (>2400ms).
      const subPeakCount = clamp(Math.floor((dwellMs - 800) / 600) + 1, 0, 3);

      // Tilt-rotated symmetry axis. Mobile: live gamma reading; desktop:
      // use aspect-ratio fallback so different screen shapes get
      // slightly different marks.
      const tilt = getTilt();
      let axisRotation: number;
      if (tilt) {
        axisRotation = (tilt.gamma / 90) * 0.25; // ~14° per 90° gamma
      } else {
        const aspect = window.innerWidth / Math.max(window.innerHeight, 1);
        axisRotation = (aspect - 1) * 0.05;
      }

      const points = generateMarkPoints(TARGET_COUNT, axisRotation, subPeakCount, rand);
      engine.particles.setTargetPositions(points, TARGET_COUNT);

      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reducedMotion) {
        // Snap to form immediately — but still record the visit so future
        // returns recognize them.
        engine.particles.setSeekStrength(1.0);
        engine.particles.teleportToTargets();
        if (heroRef.current) heroRef.current.style.opacity = "1";
        if (!visitRecorded) {
          visitRecorded = true;
          recordVisit({
            dwellMs: performance.now(),
            ...(tilt ? { tilt: { beta: tilt.beta, gamma: tilt.gamma } } : {}),
          });
        }
        return;
      }

      // ---- Genesis timeline ----
      // Returning visitors get a head-start: seekStrength begins at 0.10
      // (vs 0 for fresh) so coalescence completes ~0.15s earlier and the
      // hero-copy fade is offset accordingly. Total duration relationships
      // (build → ignite → relax → copy) are preserved.
      const seekStart = isReturning ? 0.10 : 0;
      const copyOffset = isReturning ? 2.25 : 2.4;

      const seekState = { value: seekStart };
      const glowState = { value: 0 };

      timeline = gsap.timeline();

      // Atoms begin pulling toward the mark
      timeline.to(seekState, {
        value: 0.75,
        duration: 1.3,
        ease: "power2.in",
        onUpdate: () => engine.particles.setSeekStrength(seekState.value),
      }, 0.5);

      // Ignition pulse — the moment the mark coalesces
      timeline.to(glowState, {
        value: 1.0,
        duration: 0.5,
        ease: "power2.in",
        onUpdate: () => engine.particles.setLogoGlow(glowState.value),
      }, 1.5);
      timeline.to(glowState, {
        value: 0.0,
        duration: 0.7,
        ease: "power2.out",
        onUpdate: () => engine.particles.setLogoGlow(glowState.value),
      }, 2.0);

      // Mark relaxes — particles still drawn to it but ambient drift returns.
      // Bumped from 0.30 → 0.45 so the central cluster stays visibly cohesive
      // post-genesis instead of dispersing into uniform "dirt-like" haze.
      timeline.to(seekState, {
        value: 0.45,
        duration: 1.6,
        ease: "power1.inOut",
        onUpdate: () => engine.particles.setSeekStrength(seekState.value),
      }, 2.0);

      // Hero copy arrives once the mark is visible
      if (heroRef.current) {
        timeline.to(heroRef.current, {
          opacity: 1,
          duration: 0.7,
          ease: "power2.out",
        }, copyOffset);
      }

      // ---- Record the visit at coalescence ----
      // Slight extra delay so dwellMs reflects "page-load to coalescence",
      // not just engine-ready. Fires once even if engine restarts.
      timeline.call(() => {
        if (visitRecorded) return;
        visitRecorded = true;
        const tiltAtRecord = getTilt();
        recordVisit({
          dwellMs: performance.now(),
          ...(tiltAtRecord
            ? { tilt: { beta: tiltAtRecord.beta, gamma: tiltAtRecord.gamma } }
            : {}),
        });
      }, undefined, 3.0);

      // ---- Ambient enrichment ----
      // Soft logoGlow pulse on a recurring schedule. Reads as a distant
      // cosmic event — supernova flickering somewhere in the field.
      // Returning visitors get the first pulse at t=8s (the place
      // remembers them and "smiles" earlier); fresh visitors at t=14-20s.
      const firstPulseDelay = isReturning ? 8000 : 14000 + Math.random() * 6000;

      const schedulePulse = (delay: number) => {
        ambientTimeout = setTimeout(() => {
          const pulse = { value: 0 };
          gsap.to(pulse, {
            value: 0.35,
            duration: 0.9,
            ease: "power2.in",
            onUpdate: () => engine.particles.setLogoGlow(pulse.value),
          });
          gsap.to(pulse, {
            value: 0,
            duration: 1.6,
            delay: 0.9,
            ease: "power2.out",
            onUpdate: () => engine.particles.setLogoGlow(pulse.value),
            onComplete: () => schedulePulse(14000 + Math.random() * 6000),
          });
        }, delay);
      };
      schedulePulse(firstPulseDelay);
    });

    return () => {
      clearTimeout(failsafe);
      unsubscribe();
      timeline?.kill();
      if (ambientTimeout) clearTimeout(ambientTimeout);
      window.removeEventListener("pointerdown", captureFirstInput);
      window.removeEventListener("keydown", captureFirstInput);
      window.removeEventListener("touchstart", captureFirstInput);
    };
  }, []);

  return (
    <main className="content-layer min-h-screen flex items-center justify-center p-8">
      <div
        ref={heroRef}
        className="text-center"
        style={{ opacity: 0, transition: "opacity 0.6s ease-out" }}
      >
        <h1 className="text-5xl sm:text-6xl font-light tracking-tight mb-4">
          The Fixer
        </h1>
        <p className="text-lg text-[color:var(--celestial-dim)] max-w-md mx-auto">
          Light emerges where atoms meet.
        </p>
      </div>
    </main>
  );
}
