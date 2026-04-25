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
 * Reduced-motion: instant teleport to the mark + immediate copy reveal,
 * no GSAP timeline, no ambient pulses.
 */

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { onEngineReady } from "@/lib/cosmos-ref";

/**
 * Generate target positions for the brand mark — a central focal cluster
 * plus 6 asymmetric satellites.  Mirrors the SVG #02 skeleton in 3D.
 */
function generateMarkPoints(total: number): Float32Array {
  const points = new Float32Array(total * 3);
  const centralCount = Math.floor(total * 0.62);
  const satCountPerNode = Math.floor((total - centralCount) / 6);

  // Box-Muller for proper Gaussian samples (mean 0, stdev 1)
  const gauss = () => {
    const u = Math.random() || 1e-9;
    const v = Math.random() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Central focal cluster — flatter on Z so the mark reads as 2D-ish but
  // still has subtle volume.  ~2.0 stdev = visible cluster ~5-6 units wide.
  for (let i = 0; i < centralCount; i++) {
    points[i * 3]     = gauss() * 2.0;
    points[i * 3 + 1] = gauss() * 2.0;
    points[i * 3 + 2] = gauss() * 0.6;
  }

  // 6 satellites — angles intentionally not evenly spaced to match the
  // asymmetric character of the SVG mark.
  const satOrbits: { angle: number; radius: number }[] = [
    { angle: 0.45,  radius: 8.5 },
    { angle: 1.55,  radius: 9.6 },  // alpha satellite — slightly farther
    { angle: 2.50,  radius: 7.8 },
    { angle: 3.45,  radius: 8.2 },
    { angle: 4.30,  radius: 7.4 },
    { angle: 5.25,  radius: 9.0 },
  ];

  let pi = centralCount;
  for (const { angle, radius } of satOrbits) {
    const cx = Math.cos(angle) * radius;
    const cy = Math.sin(angle) * radius;
    for (let j = 0; j < satCountPerNode; j++) {
      points[pi * 3]     = cx + gauss() * 0.95;
      points[pi * 3 + 1] = cy + gauss() * 0.95;
      points[pi * 3 + 2] = gauss() * 0.45;
      pi++;
    }
  }

  return points;
}

export default function HeroSection() {
  const heroRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let ambientInterval: ReturnType<typeof setInterval> | null = null;
    let timeline: gsap.core.Timeline | null = null;

    // Failsafe — surface hero copy at 3.2s even if the engine never initializes.
    const failsafe = setTimeout(() => {
      if (heroRef.current) heroRef.current.style.opacity = "1";
    }, 3200);

    const unsubscribe = onEngineReady((engine) => {
      clearTimeout(failsafe);

      // Load the mark's target positions into the particle system.
      const TARGET_COUNT = 8000;
      const points = generateMarkPoints(TARGET_COUNT);
      engine.particles.setTargetPositions(points, TARGET_COUNT);

      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reducedMotion) {
        // Snap to form immediately.
        engine.particles.setSeekStrength(1.0);
        engine.particles.teleportToTargets();
        if (heroRef.current) heroRef.current.style.opacity = "1";
        return;
      }

      // ---- Genesis timeline ----
      const seekState = { value: 0 };
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

      // Mark relaxes — particles still drawn to it but ambient drift returns
      timeline.to(seekState, {
        value: 0.30,
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
        }, 2.4);
      }

      // ---- Ambient enrichment ----
      // Soft logoGlow pulse every 14-20 seconds. Reads as a distant
      // cosmic event — supernova flickering somewhere in the field.
      const schedulePulse = () => {
        const delay = 14000 + Math.random() * 6000;
        ambientInterval = setTimeout(() => {
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
            onComplete: schedulePulse,
          });
        }, delay);
      };
      schedulePulse();
    });

    return () => {
      clearTimeout(failsafe);
      unsubscribe();
      timeline?.kill();
      if (ambientInterval) clearTimeout(ambientInterval);
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
