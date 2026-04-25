"use client";

/**
 * ScrollBridge — pushes window scroll progress + velocity into the
 * shared scroll-state pub/sub that the cosmos engine subscribes to.
 *
 * The engine reads this via onScrollUpdate to drive its scroll-shifted
 * color and outward drift. Without this bridge, scroll has no effect on
 * the cosmos.
 */

import { useEffect } from "react";
import { setScrollState } from "@/lib/scroll-state";

export default function ScrollBridge() {
  useEffect(() => {
    let lastY = window.scrollY;
    let lastT = performance.now();
    let raf = 0;

    const update = () => {
      const y = window.scrollY;
      const t = performance.now();
      const dt = Math.max(t - lastT, 1);
      const velocity = (y - lastY) / dt;

      const docH = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docH > 0 ? Math.max(0, Math.min(1, y / docH)) : 0;

      setScrollState(progress, velocity);
      lastY = y;
      lastT = t;
    };

    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    update();

    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return null;
}
