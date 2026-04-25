"use client";

/**
 * SiteSections — the content of the landing page below the hero.
 *
 * Each section's <h2> is "born from the cosmos": when the heading scrolls
 * into view, ~2500 particles in the background field migrate to form the
 * outline of the heading text, the rendered <h2> fades in over them, then
 * particles relax back into ambient drift. Body paragraphs use the existing
 * Reveal fade-up.
 *
 * The choreography is owned by `useSectionCoalescence` (defined below),
 * which runs once per heading on intersection enter (re-trigger on scroll
 * back up — see implementation note).
 *
 * Reduced-motion: skips the migration. The <h2> is rendered fully opaque
 * from the start; body paragraphs still fade in via Reveal which already
 * respects prefers-reduced-motion.
 */

import { useEffect, useRef, type RefObject } from "react";
import { gsap } from "gsap";

import Reveal from "./Reveal";
import { onEngineReady, getCosmosEngine } from "@/lib/cosmos-ref";
import { textToPoints } from "@/lib/text-to-points";
import { screenRectToWorldPoints } from "@/lib/world-projection";

/* ---------------------------------------------------------------- */
/*  Coalescence hook                                                */
/* ---------------------------------------------------------------- */

/**
 * Run the particle-coalescence choreography for a section heading.
 *
 *   Phase 1 (0.0 → 0.7s)  seek 0 → 0.85    atoms migrate to text outline
 *   Phase 2 (0.5 → 0.9s)  glow 0 → 0.5     ignition pulse mid-form
 *   Phase 3 (0.55 → 1.3s) <h2> opacity 0 → 1
 *   Phase 4 (0.7 → 1.6s)  seek 0.85 → 0.20 particles relax into ambient
 *   Phase 5 (0.9 → 1.4s)  glow 0.5 → 0     bloom rolls off
 *
 * Total wall time: ~1.6s. After completion the targets remain set on the
 * particle buffer but seek strength is low — particles drift around the
 * formed shape rather than locking to it. The next section's enter will
 * overwrite the targets, which is the intended hand-off.
 *
 * Re-trigger policy: when the user scrolls back up and re-enters a
 * section we DO replay the migration. Rationale: the second pass sells
 * "the cosmos remembers" — it's a feature, not a bug. We use a small
 * cooldown (1.8s) to prevent double-firing on rapid scroll oscillation.
 *
 * Reduced-motion: the IntersectionObserver still fires but we early-return
 * with the heading set to opacity 1; no particle work happens at all.
 */
function useSectionCoalescence(
  ref: RefObject<HTMLHeadingElement | null>,
  text: string,
  /** Optional vertical squish — useful for multi-line headings. */
  yScale: number = 1.0,
): void {
  // Sample count: 2500 is the spec default and reads as a clean text outline
  // at hero-tier sizes. Headings with very long copy (>~60 chars) benefit
  // from a slightly higher count so the strokes don't read as dotted; we
  // bump those to 3200.
  const sampleCount = text.length > 60 ? 3200 : 2500;

  // Keep the rasterized normalized points in a ref so we don't pay for
  // canvas rasterization on every IntersectionObserver fire.
  const normalizedRef = useRef<Float32Array | null>(null);
  // GSAP timeline reference — kill on cleanup or re-enter.
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const lastTriggerRef = useRef<number>(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Reduced-motion: surface the heading immediately, skip everything else.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.style.opacity = "1";
      return;
    }

    // Heading starts invisible — particles form it before it appears.
    el.style.opacity = "0";
    el.style.transition = "opacity 0.75s cubic-bezier(.2,.7,.2,1)";

    // ---- Pre-rasterize once per section (cheap one-shot) ----
    // We sample the text at fontSize 64 — large enough that the bitmap has
    // good interior density when sub-sampled to 2500 points but small
    // enough that the rasterization cost is < 10ms.
    normalizedRef.current = textToPoints(text, {
      fontSize: 64,
      sampleCount,
      jitter: 0.02,
    });

    const triggerCoalescence = () => {
      const now = performance.now();
      // Cooldown — drop re-fires within 1.8s of the last fire.
      if (now - lastTriggerRef.current < 1800) return;
      lastTriggerRef.current = now;

      const engine = getCosmosEngine();
      const headingEl = ref.current;
      const normalized = normalizedRef.current;
      if (!engine || !headingEl || !normalized || normalized.length === 0) {
        // Engine not ready yet — surface the heading so content isn't blocked.
        if (headingEl) headingEl.style.opacity = "1";
        return;
      }

      // ---- Project the normalized points into world space ----
      const rect = headingEl.getBoundingClientRect();
      const worldPoints = screenRectToWorldPoints(
        rect,
        normalized,
        engine.cameraRef,
        yScale,
      );
      const pointCount = worldPoints.length / 3;

      // ---- Hand the targets to the engine ----
      engine.particles.setTargetPositions(worldPoints, pointCount);

      // ---- GSAP choreography ----
      // Start each phase from a clean baseline. Even if a previous timeline
      // left seek/glow somewhere mid-curve, our phase 1 starts at 0 → 0.85;
      // setting the engine value here avoids a visible "jump" if the user
      // re-enters mid-relax.
      timelineRef.current?.kill();
      engine.particles.setSeekStrength(0);
      const seekState = { value: 0 };
      const glowState = { value: 0 };
      const tl = gsap.timeline();
      timelineRef.current = tl;

      // Phase 1 — atoms migrate to the text outline (start abrupt, ease in).
      tl.to(seekState, {
        value: 0.85,
        duration: 0.7,
        ease: "power2.in",
        onUpdate: () => engine.particles.setSeekStrength(seekState.value),
      }, 0);

      // Phase 2 — ignition glow at the midpoint of formation.
      tl.to(glowState, {
        value: 0.5,
        duration: 0.4,
        ease: "power2.in",
        onUpdate: () => engine.particles.setLogoGlow(glowState.value),
      }, 0.5);

      // Phase 3 — heading text fades in over the formed particle shape.
      tl.to(headingEl, {
        opacity: 1,
        duration: 0.75,
        ease: "power2.out",
      }, 0.55);

      // Phase 4 — particles relax: seek loosens, atoms drift around the form.
      tl.to(seekState, {
        value: 0.20,
        duration: 0.9,
        ease: "power1.inOut",
        onUpdate: () => engine.particles.setSeekStrength(seekState.value),
      }, 0.7);

      // Phase 5 — glow rolls off back to ambient.
      tl.to(glowState, {
        value: 0,
        duration: 0.5,
        ease: "power2.out",
        onUpdate: () => engine.particles.setLogoGlow(glowState.value),
      }, 0.9);
    };

    // Make sure the engine exists before installing the observer — if it
    // isn't ready yet we wait once and then install. The observer also
    // works fine if the engine arrives later (engine null-check above).
    let unsubscribeReady: (() => void) | null = null;
    if (!getCosmosEngine()) {
      unsubscribeReady = onEngineReady(() => {
        // No-op — the IntersectionObserver below will pick it up on next fire.
      });
    }

    // ---- IntersectionObserver — fire when heading is ~30% in viewport ----
    // threshold: 0.3 → "atom recognizes it's about to be seen"
    // rootMargin: -10% bottom → trigger slightly before the heading's true
    //                            top edge crosses the viewport center, so
    //                            the formation completes as it lands.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.28) {
            triggerCoalescence();
          }
        }
      },
      { threshold: [0, 0.28, 0.5], rootMargin: "0px 0px -10% 0px" },
    );

    observer.observe(el);

    return () => {
      observer.disconnect();
      timelineRef.current?.kill();
      timelineRef.current = null;
      unsubscribeReady?.();
    };
  }, [ref, text, yScale, sampleCount]);
}

/* ---------------------------------------------------------------- */
/*  What                                                            */
/* ---------------------------------------------------------------- */

const WHAT_HEADING =
  "An optimization layer between your tools and any frontier model.";

function WhatSection() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSectionCoalescence(headingRef, WHAT_HEADING, 1.0);

  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-4xl">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            What it is
          </p>
        </Reveal>
        <h2
          ref={headingRef}
          className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight leading-[1.05] mb-10"
        >
          {WHAT_HEADING}
        </h2>
        <Reveal delay={240}>
          <p className="text-lg sm:text-xl text-[color:var(--celestial-dim)] leading-relaxed max-w-3xl">
            The Fixer reduces LLM token consumption by{" "}
            <span className="text-[color:var(--celestial-white)]">70-90%</span>{" "}
            while preserving perfect recall. Your tools — Cursor, Claude Code,
            Aider, the SDK call you wrote yesterday — stay unchanged. The cosmos
            behind the API remembers everything; it only ever speaks the parts
            that matter for the question at hand.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/*  How                                                             */
/* ---------------------------------------------------------------- */

const HOW_HEADING =
  "Three things keep the model precise without paying for everything.";

const PILLARS: { title: string; copy: string }[] = [
  {
    title: "The Vault",
    copy: "Every word of your conversation is stored, partitioned by your key, encrypted at rest. Nothing about your context is ever forgotten.",
  },
  {
    title: "Dense Briefing",
    copy: "While you're idle between turns, a fast model summarizes the world into a precise briefing — ready before you ask the next question.",
  },
  {
    title: "Context-on-Demand",
    copy: "The frontier model receives only what's relevant, plus a tool to pull exact passages from the Vault when it needs the original wording.",
  },
];

function HowSection() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSectionCoalescence(headingRef, HOW_HEADING, 1.0);

  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-6xl w-full">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            How it works
          </p>
        </Reveal>
        <h2
          ref={headingRef}
          className="text-4xl sm:text-5xl font-light tracking-tight leading-tight mb-16 max-w-3xl"
        >
          {HOW_HEADING}
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.08]">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={140 + i * 120} className="bg-[color:var(--cosmos-void)] p-8 sm:p-10">
              <div className="text-[color:var(--warm-cream)] text-sm font-medium tracking-wide mb-4">
                0{i + 1}
              </div>
              <h3 className="text-2xl font-light mb-4">{p.title}</h3>
              <p className="text-[color:var(--celestial-dim)] leading-relaxed">
                {p.copy}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/*  Integration                                                     */
/* ---------------------------------------------------------------- */

const INTEGRATION_HEADING = "Change the base URL. Keep your stack.";

const SNIPPETS: { label: string; code: string }[] = [
  {
    label: "OpenAI SDK",
    code: `import OpenAI from "openai";
const openai = new OpenAI({
  baseURL: "https://api.thefixer.in/v1",
  apiKey:  "opto_…",         // The Fixer key
  defaultHeaders: { "x-openai-key": "sk-…" }, // your key, never seen
});`,
  },
  {
    label: "Anthropic SDK",
    code: `import Anthropic from "@anthropic-ai/sdk";
const claude = new Anthropic({
  baseURL: "https://api.thefixer.in",
  apiKey:  "opto_…",
  defaultHeaders: { "x-anthropic-key": "sk-ant-…" },
});`,
  },
  {
    label: "Cursor / Claude Code",
    code: `# In your editor's settings:
OPENAI_BASE_URL = https://api.thefixer.in/v1
OPENAI_API_KEY  = opto_…

# Models stay the same. Tokens drop. Quality holds.`,
  },
];

function IntegrationSection() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSectionCoalescence(headingRef, INTEGRATION_HEADING, 1.0);

  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-5xl w-full">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            Integrate in one line
          </p>
        </Reveal>
        <h2
          ref={headingRef}
          className="text-4xl sm:text-5xl font-light tracking-tight leading-tight mb-16 max-w-3xl"
        >
          {INTEGRATION_HEADING}
        </h2>

        <div className="space-y-8">
          {SNIPPETS.map((s, i) => (
            <Reveal key={s.label} delay={120 + i * 100}>
              <div className="border border-white/[0.08] bg-[color:var(--cosmos-void)]/60 backdrop-blur-sm">
                <div className="border-b border-white/[0.08] px-5 py-3 text-xs tracking-wide text-[color:var(--celestial-dim)]">
                  {s.label}
                </div>
                <pre className="overflow-x-auto p-5 text-sm text-[color:var(--celestial-white)] font-mono leading-relaxed">
                  {s.code}
                </pre>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/*  CTA                                                             */
/* ---------------------------------------------------------------- */

// CTA splits across two visual lines but is one heading semantically.
// We use the first line as the particle text — it's what the eye locks
// onto first. The "Without rewriting anything." continuation arrives via
// the heading's inner spans (it's part of the same <h2> opacity fade).
const CTA_HEADING_PARTICLES = "Save your team's tokens.";

function CTASection() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useSectionCoalescence(headingRef, CTA_HEADING_PARTICLES, 1.0);

  return (
    <section className="content-layer min-h-[80vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-3xl text-center">
        <h2
          ref={headingRef}
          className="text-4xl sm:text-6xl font-light tracking-tight leading-[1.05] mb-8"
        >
          Save your team&apos;s tokens.
          <br />
          <span className="text-[color:var(--warm-cream)]">Without rewriting anything.</span>
        </h2>
        <Reveal delay={160}>
          <p className="text-lg text-[color:var(--celestial-dim)] mb-12 max-w-xl mx-auto">
            Bring your own keys. Keep your tools. Watch the bills shrink.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <a
            href="mailto:venu-kumar@thefixer.in?subject=Opto%20API%20key%20request"
            className="inline-flex items-center gap-2 px-8 py-4 border border-[color:var(--warm-cream)]/60 text-[color:var(--warm-cream)] hover:bg-[color:var(--warm-cream)]/10 transition-colors duration-300 text-base tracking-wide"
          >
            Get an API key
            <span aria-hidden="true">→</span>
          </a>
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- */
/*  Footer                                                          */
/* ---------------------------------------------------------------- */

function FooterSection() {
  const year = new Date().getFullYear();
  return (
    <footer className="content-layer border-t border-white/[0.06] px-6 sm:px-10 py-12">
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row gap-6 justify-between items-start sm:items-center text-sm text-[color:var(--celestial-dim)]">
        <div>The Fixer · {year}</div>
        <nav className="flex gap-8">
          <a href="https://github.com/Problemsolver0070/LLMFIXER" className="hover:text-[color:var(--celestial-white)] transition-colors">GitHub</a>
          <a href="mailto:venu-kumar@thefixer.in" className="hover:text-[color:var(--celestial-white)] transition-colors">Contact</a>
        </nav>
      </div>
    </footer>
  );
}

/* ---------------------------------------------------------------- */
/*  Composed                                                        */
/* ---------------------------------------------------------------- */

export default function SiteSections() {
  return (
    <>
      <WhatSection />
      <HowSection />
      <IntegrationSection />
      <CTASection />
      <FooterSection />
    </>
  );
}
