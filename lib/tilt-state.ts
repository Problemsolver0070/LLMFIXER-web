/**
 * tilt-state — module-level singleton holding the most recent
 * DeviceOrientationEvent reading. Mirrors the lib/scroll-state.ts pattern.
 *
 * CosmosCanvas.handleOrientation calls setTilt(beta, gamma) on every
 * orientation reading; HeroSection reads getTilt() once at coalescence
 * time to drive the per-visitor mark variation.
 *
 * Returns null when no reading has ever been received (desktop, or mobile
 * before the user has tilted the device / granted iOS permission).
 */

export interface TiltReading {
  /** Front-back tilt in degrees, [-180, 180]. */
  beta: number;
  /** Left-right tilt in degrees, [-90, 90]. */
  gamma: number;
}

let _tilt: TiltReading | null = null;

export function setTilt(beta: number, gamma: number): void {
  _tilt = { beta, gamma };
}

export function getTilt(): TiltReading | null {
  return _tilt;
}

export function clearTilt(): void {
  _tilt = null;
}
