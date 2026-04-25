"use client";

/**
 * SiteSections — the content sections below the hero. Each section
 * uses the simple Reveal fade-up wrapper as it enters the viewport.
 * No engine-target hijacking, no particle coalescence — the original
 * engine handles its own ambient drift; sections sit on top of it.
 */

import Reveal from "./Reveal";

/* ---------------------------------------------------------------- */
/*  What                                                            */
/* ---------------------------------------------------------------- */

function WhatSection() {
  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-4xl">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            What it is
          </p>
        </Reveal>
        <Reveal delay={120}>
          <h2 className="text-4xl sm:text-5xl md:text-6xl font-light tracking-tight leading-[1.05] mb-10">
            An optimization layer between your tools and any frontier model.
          </h2>
        </Reveal>
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
  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-6xl w-full">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            How it works
          </p>
        </Reveal>
        <Reveal delay={120}>
          <h2 className="text-4xl sm:text-5xl font-light tracking-tight leading-tight mb-16 max-w-3xl">
            Three things keep the model precise without paying for everything.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-white/[0.08]">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={140 + i * 120} className="bg-[color:var(--cosmos-void)] p-8 sm:p-10">
              <div className="text-[color:var(--gold-bright)] text-sm font-medium tracking-wide mb-4">
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
  return (
    <section className="content-layer min-h-[100vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-5xl w-full">
        <Reveal>
          <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
            Integrate in one line
          </p>
        </Reveal>
        <Reveal delay={120}>
          <h2 className="text-4xl sm:text-5xl font-light tracking-tight leading-tight mb-16 max-w-3xl">
            Change the base URL. Keep your stack.
          </h2>
        </Reveal>

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

function CTASection() {
  return (
    <section className="content-layer min-h-[80vh] flex items-center justify-center px-6 sm:px-10 py-32">
      <div className="max-w-3xl text-center">
        <Reveal>
          <h2 className="text-4xl sm:text-6xl font-light tracking-tight leading-[1.05] mb-8">
            Save your team&apos;s tokens.
            <br />
            <span className="text-[color:var(--gold-bright)]">Without rewriting anything.</span>
          </h2>
        </Reveal>
        <Reveal delay={160}>
          <p className="text-lg text-[color:var(--celestial-dim)] mb-12 max-w-xl mx-auto">
            Bring your own keys. Keep your tools. Watch the bills shrink.
          </p>
        </Reveal>
        <Reveal delay={280}>
          <a
            href="mailto:venu-kumar@thefixer.in?subject=Opto%20API%20key%20request"
            className="inline-flex items-center gap-2 px-8 py-4 border border-[color:var(--gold-bright)]/60 text-[color:var(--gold-bright)] hover:bg-[color:var(--gold-bright)]/10 transition-colors duration-300 text-base tracking-wide"
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
