type ScrollListener = (progress: number, velocity: number) => void;

const listeners: Set<ScrollListener> = new Set();

let currentProgress = 0;
let currentVelocity = 0;

export function getScrollProgress(): number {
  return currentProgress;
}

export function getScrollVelocity(): number {
  return currentVelocity;
}

export function setScrollState(progress: number, velocity: number): void {
  currentProgress = progress;
  currentVelocity = velocity;
  listeners.forEach((fn) => fn(progress, velocity));
}

export function onScrollUpdate(fn: ScrollListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
