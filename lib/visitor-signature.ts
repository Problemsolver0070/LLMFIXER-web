/**
 * visitor-signature — opaque returning-visitor recognition.
 *
 * Persists a small JSON blob in localStorage under "fixer:visitor".
 * Used by HeroSection to subtly accelerate the genesis sequence and the
 * first ambient pulse for visitors who have been here before. The visitor
 * never sees a UI difference — only a feeling that the place is already
 * a little familiar with them.
 *
 * Schema kept intentionally loose (any extra metadata is merged in) so
 * future personalization signals can piggyback without a migration.
 */

const STORAGE_KEY = "fixer:visitor";

export interface VisitorMetadata {
  /** Most recent device-orientation reading captured during a visit (mobile only). */
  tilt?: { beta: number; gamma: number };
  /** Page-load → first-input or page-load → coalescence elapsed time, ms. */
  dwellMs?: number;
  /** Free-form extra fields — never required, never read by core logic. */
  [k: string]: unknown;
}

export interface VisitorSignature {
  isReturning: boolean;
  visitCount: number;
  lastVisitAt: number | null;
  /** Opaque JSON blob; readers should treat unknown keys as forward-compatible. */
  signature: Record<string, unknown>;
}

/** Default value used when no prior visit exists or storage is unavailable. */
function freshSignature(): VisitorSignature {
  return {
    isReturning: false,
    visitCount: 0,
    lastVisitAt: null,
    signature: {},
  };
}

/** Safe localStorage access — handles SSR + private-browsing exceptions. */
function readStorage(): Record<string, unknown> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeStorage(payload: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota exceeded — silently degrade */
  }
}

/**
 * Read prior visitor state. Returns fresh defaults when no record exists,
 * storage is unavailable, or the persisted blob is corrupt. Never throws.
 */
export function getVisitorSignature(): VisitorSignature {
  const blob = readStorage();
  if (!blob) return freshSignature();

  const visitCount =
    typeof blob.visitCount === "number" && Number.isFinite(blob.visitCount)
      ? blob.visitCount
      : 0;
  const lastVisitAt =
    typeof blob.lastVisitAt === "number" && Number.isFinite(blob.lastVisitAt)
      ? blob.lastVisitAt
      : null;
  const signature =
    blob.signature && typeof blob.signature === "object"
      ? (blob.signature as Record<string, unknown>)
      : {};

  return {
    isReturning: visitCount > 0,
    visitCount,
    lastVisitAt,
    signature,
  };
}

/**
 * Increment visitCount, update lastVisitAt, and merge optional metadata
 * into the signature blob. Safe to call repeatedly — but the intent is
 * once per visit, after the genesis sequence completes.
 */
export function recordVisit(metadata?: VisitorMetadata): void {
  const prior = getVisitorSignature();
  const mergedSignature: Record<string, unknown> = {
    ...prior.signature,
    ...(metadata ?? {}),
  };

  const next = {
    visitCount: prior.visitCount + 1,
    lastVisitAt: Date.now(),
    signature: mergedSignature,
  };

  writeStorage(next);
}
