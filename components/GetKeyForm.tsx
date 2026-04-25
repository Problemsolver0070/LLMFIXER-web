"use client";

/**
 * GetKeyForm — email signup → backend issues an opto_ key → display once.
 *
 * Today: no auth, no payment gate. Backend stores user_id + email; the key
 * itself is never persisted (the user must save it from this view, since
 * we cannot show it again).
 *
 * Next iterations: PayPal Subscriptions checkout between the email submit
 * and the key reveal, plus email verification.
 */

import { useState, type FormEvent } from "react";

const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE as string | undefined)
  ?? "https://api.thefixer.in";

type View = "form" | "loading" | "key" | "error";

export default function GetKeyForm() {
  const [view, setView] = useState<View>("form");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    const trimmed = email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
      setError("That email address looks malformed.");
      return;
    }

    setView("loading");
    try {
      const r = await fetch(`${API_BASE}/v1/keys/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error?.message ?? "Could not issue a key right now. Please retry.");
        setView("form");
        return;
      }
      setIssuedKey(data.key);
      setView("key");
    } catch (err) {
      console.error("[GetKeyForm] signup failed:", err);
      setError("Network error. Please retry.");
      setView("form");
    }
  };

  const copyKey = async () => {
    if (!issuedKey) return;
    try {
      await navigator.clipboard.writeText(issuedKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — fallback would be a long-press select
    }
  };

  /* ----------------------------------------------------------------- */
  /*  KEY VIEW — issued, displayed once                                */
  /* ----------------------------------------------------------------- */
  if (view === "key" && issuedKey) {
    return (
      <div className="max-w-2xl w-full">
        <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
          Your API key
        </p>
        <h1 className="text-3xl sm:text-4xl font-light tracking-tight leading-tight mb-8">
          Save this. It cannot be shown again.
        </h1>

        <div className="border border-[color:var(--gold-bright)]/40 bg-[color:var(--cosmos-deep)]/60 backdrop-blur-sm">
          <div className="border-b border-white/[0.08] px-5 py-3 flex justify-between items-center text-xs tracking-wide text-[color:var(--celestial-dim)]">
            <span>opto_*** key</span>
            <button
              type="button"
              onClick={copyKey}
              className="text-[color:var(--gold-bright)] hover:text-[color:var(--celestial-white)] transition-colors cursor-pointer"
            >
              {copied ? "copied ✓" : "copy"}
            </button>
          </div>
          <pre className="overflow-x-auto p-5 text-sm font-mono leading-relaxed text-[color:var(--celestial-white)] break-all whitespace-pre-wrap">
{issuedKey}
          </pre>
        </div>

        <div className="mt-8 space-y-3 text-sm text-[color:var(--celestial-dim)] leading-relaxed">
          <p>
            Use it as <code className="text-[color:var(--celestial-white)] bg-[color:var(--cosmos-deep)]/60 px-2 py-0.5 rounded text-xs">Authorization: Bearer …</code> when calling{" "}
            <code className="text-[color:var(--celestial-white)] bg-[color:var(--cosmos-deep)]/60 px-2 py-0.5 rounded text-xs">https://api.thefixer.in/v1/chat/completions</code>{" "}
            (or the Anthropic <code className="text-[color:var(--celestial-white)] bg-[color:var(--cosmos-deep)]/60 px-2 py-0.5 rounded text-xs">/v1/messages</code> endpoint).
          </p>
          <p>
            Pass your provider key (OpenAI / Anthropic / Gemini) via{" "}
            <code className="text-[color:var(--celestial-white)] bg-[color:var(--cosmos-deep)]/60 px-2 py-0.5 rounded text-xs">x-openai-key</code>{" "}
            (or x-anthropic-key, x-gemini-key) headers. Your provider key is BYOK — never stored on our side beyond per-request use.
          </p>
          <p className="text-[color:var(--gold-bright)]/80">
            Preview access — unmetered until PayPal subscription rolls out.
          </p>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------------- */
  /*  FORM / LOADING                                                    */
  /* ----------------------------------------------------------------- */
  return (
    <div className="max-w-xl w-full">
      <p className="text-xs uppercase tracking-[0.3em] text-[color:var(--ethereal-glow)]/70 mb-6">
        Get an API key
      </p>
      <h1 className="text-4xl sm:text-5xl font-light tracking-tight leading-[1.05] mb-8">
        One email. One key. Save your team&apos;s tokens from there.
      </h1>
      <p className="text-base text-[color:var(--celestial-dim)] mb-10 leading-relaxed">
        We&apos;ll generate an <code className="text-[color:var(--celestial-white)]">opto_*</code> key for you. Drop it into your tool&apos;s settings, point it at <code className="text-[color:var(--celestial-white)]">api.thefixer.in/v1</code>, and you&apos;re live.
        During preview access, no payment is required.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label htmlFor="email" className="block text-xs uppercase tracking-wide text-[color:var(--celestial-dim)] mb-2">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            disabled={view === "loading"}
            placeholder="you@your-team.com"
            className="
              w-full px-4 py-3
              bg-[color:var(--cosmos-deep)]/60 backdrop-blur-sm
              border border-white/[0.08]
              text-base text-[color:var(--celestial-white)]
              focus:outline-none focus:border-[color:var(--gold-bright)]/60
              placeholder:text-[color:var(--celestial-dim)]/50
              transition-colors duration-200
              disabled:opacity-50
            "
          />
        </div>

        {error && (
          <p className="text-sm text-red-400/90">{error}</p>
        )}

        <button
          type="submit"
          disabled={view === "loading"}
          className="
            inline-flex items-center gap-2
            px-8 py-4
            border border-[color:var(--gold-bright)]/60
            text-[color:var(--gold-bright)]
            hover:bg-[color:var(--gold-bright)]/10
            transition-colors duration-300
            text-base tracking-wide
            cursor-pointer
            disabled:opacity-50 disabled:cursor-not-allowed
          "
        >
          {view === "loading" ? "Issuing key…" : "Generate my key"}
          {view !== "loading" && <span aria-hidden="true">→</span>}
        </button>

        <p className="text-xs text-[color:var(--celestial-dim)]/70 leading-relaxed">
          By generating a key you agree the email above is yours and may receive product updates.
          PayPal subscription gating arrives next — preview access is unmetered until then.
        </p>
      </form>
    </div>
  );
}
