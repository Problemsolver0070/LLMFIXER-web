/**
 * Module-level singleton bridge for accessing the CosmosEngine
 * from React components outside the canvas subtree.
 * Mirrors the pattern used by lib/scroll-state.ts.
 */
import type { CosmosEngine } from "@/components/canvas/cosmos-engine";

type EngineReadyCallback = (engine: CosmosEngine) => void;

let _engine: CosmosEngine | null = null;
const _callbacks: Set<EngineReadyCallback> = new Set();

export function setCosmosEngine(engine: CosmosEngine | null): void {
  _engine = engine;
  if (engine) {
    _callbacks.forEach((cb) => cb(engine));
    _callbacks.clear();
  }
}

export function getCosmosEngine(): CosmosEngine | null {
  return _engine;
}

/**
 * Register a callback that fires when the engine is ready.
 * If the engine is already initialized, fires immediately.
 * Returns an unsubscribe function.
 */
export function onEngineReady(cb: EngineReadyCallback): () => void {
  if (_engine) {
    cb(_engine);
  } else {
    _callbacks.add(cb);
  }
  return () => _callbacks.delete(cb);
}
