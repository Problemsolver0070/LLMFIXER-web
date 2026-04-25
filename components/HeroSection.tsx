"use client";

/**
 * HeroSection — minimal genesis: when the engine is ready, ramp seek
 * strength + logo glow, fade in the hero copy. No tilt-driven mark
 * variation, no returning-visitor pacing tweaks — just the original
 * engine's natural behaviour with simple choreography on top.
 */

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { onEngineReady } from "@/lib/cosmos-ref";

/**
 * Procedural target points for the brand mark — central focal cluster
 * plus 6 satellites. Same skeleton every visit. No tilt / dwell / seed
 * overrides. The original engine's mark placement.
 */
function generateMarkPoints(total: number): Float32Array {
  const points = new Float32Array(total * 3);
  const centralCount = Math.floor(total * 0.62);
  const satCountPerNode = Math.floor((total - centralCount) / 6);

  const gauss = () => {
    const u = Math.random() || 1e-9;
    const v = Math.random() || 1e-9;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Central cluster
  for (let i = 0; i < centralCount; i++) {
    points[i * 3]     = gauss() * 2.0;
    points[i * 3 + 1] = gauss() * 2.0;
    points[i * 3 + 2] = gauss() * 0.6;
  }

  // 6 satellites — angles intentionally not evenly spaced
  const satOrbits: { angle: number; radius: number }[] = [
    { angle: 0.45, radius: 8.5 },
    { angle: 1.55, radius: 9.6 },
    { angle: 2.50, radius: 7.8 },
    { angle: 3.45, radius: 8.2 },
    { angle: 4.30, radius: 7.4 },
    { angle: 5.25, radius: 9.0 },
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
    let timeline: gsap.core.Timeline | null = null;

    const failsafe = setTimeout(() => {
      if (heroRef.current) heroRef.current.style.opacity = "1";
    }, 3200);

    const unsubscribe = onEngineReady((engine) => {
      clearTimeout(failsafe);

      const TARGET_COUNT = 8000;
      const points = generateMarkPoints(TARGET_COUNT);
      engine.particles.setTargetPositions(points, TARGET_COUNT);

      const reducedMotion =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      if (reducedMotion) {
        engine.particles.setSeekStrength(1.0);
        engine.particles.teleportToTargets();
        if (heroRef.current) heroRef.current.style.opacity = "1";
        return;
      }

      const seek = { value: 0 };
      const glow = { value: 0 };
      timeline = gsap.timeline();

      timeline.to(seek, {
        value: 0.75,
        duration: 1.3,
        ease: "power2.in",
        onUpdate: () => engine.particles.setSeekStrength(seek.value),
      }, 0.5);

      timeline.to(glow, {
        value: 1.0,
        duration: 0.5,
        ease: "power2.in",
        onUpdate: () => engine.particles.setLogoGlow(glow.value),
      }, 1.5);
      timeline.to(glow, {
        value: 0.0,
        duration: 0.7,
        ease: "power2.out",
        onUpdate: () => engine.particles.setLogoGlow(glow.value),
      }, 2.0);

      timeline.to(seek, {
        value: 0.30,
        duration: 1.6,
        ease: "power1.inOut",
        onUpdate: () => engine.particles.setSeekStrength(seek.value),
      }, 2.0);

      if (heroRef.current) {
        timeline.to(heroRef.current, {
          opacity: 1,
          duration: 0.7,
          ease: "power2.out",
        }, 2.4);
      }
    });

    return () => {
      clearTimeout(failsafe);
      unsubscribe();
      timeline?.kill();
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
