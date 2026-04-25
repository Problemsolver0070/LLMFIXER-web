/**
 * ParticleSystem — manages GPU storage buffers, compute dispatch,
 * and the renderable mesh for the cosmos particle field.
 *
 * Supports two animation modes:
 * - GPU compute (WebGPU) — compute shader runs curl-noise on GPU
 * - CPU fallback (WebGL2) — cpuAnimate() runs curl-noise on CPU
 */
import {
  StorageInstancedBufferAttribute,
  Sprite,
  Group,
} from "three/webgpu";

import { PARTICLE_CONFIG } from "@/lib/theme";

import {
  createParticleComputeShader,
  uTime,
  uDeltaTime,
  uMouseX,
  uMouseY,
  uMouseInfluence,
  uScrollProgress,
  uDriftSpeed,
  uBoundaryRadius,
  uSeekStrength,
  uTiltX,
  uTiltY,
} from "./shaders/particle-compute";

import {
  createParticleMaterial,
  uMatTime,
  uMatScrollProgress,
  uMatParticleSize,
  uMatLogoGlow,
  uNoBloom,
  uPointerWorld,
  uPointerStrength,
  uTimeWarm,
  uTimeCool,
  uTimePurple,
} from "./shaders/particle-material";

/* ------------------------------------------------------------------ */
/*  Fast trig lookup (replaces Math.sin/cos in hot loop)              */
/* ------------------------------------------------------------------ */

const LUT_SIZE = 4096;
const LUT_MASK = LUT_SIZE - 1;
const TWO_PI = Math.PI * 2;
const INV_TWO_PI = 1 / TWO_PI;

const sinLUT = new Float32Array(LUT_SIZE);
const cosLUT = new Float32Array(LUT_SIZE);
for (let i = 0; i < LUT_SIZE; i++) {
  const angle = (i / LUT_SIZE) * TWO_PI;
  sinLUT[i] = Math.sin(angle);
  cosLUT[i] = Math.cos(angle);
}

/** Fast sin via lookup table — ~10x faster than Math.sin at ±0.001 precision */
function fsin(x: number): number {
  return sinLUT[((x * INV_TWO_PI * LUT_SIZE + LUT_SIZE * 4) | 0) & LUT_MASK];
}

/** Fast cos via lookup table */
function fcos(x: number): number {
  return cosLUT[((x * INV_TWO_PI * LUT_SIZE + LUT_SIZE * 4) | 0) & LUT_MASK];
}

/* ------------------------------------------------------------------ */
/*  Particle System                                                   */
/* ------------------------------------------------------------------ */

export class ParticleSystem {
  readonly maxParticles: number;
  private _activeCount: number;
  private _targetFloor: number = 0;

  /** GPU storage buffers (also readable as vertex attributes in WebGL2) */
  private posBuffer: StorageInstancedBufferAttribute;
  private velBuffer: StorageInstancedBufferAttribute;
  private targetBuffer: StorageInstancedBufferAttribute;
  /** Per-particle class id (encoded as float). 0=star, 1=dust, 2=nebula, 3=supernova */
  private typeBuffer: StorageInstancedBufferAttribute;

  /** GPU compute kernel (WebGPU only) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeUpdate: any;

  /** Renderable group */
  readonly group: Group;
  private sprite: Sprite;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private material: any;

  /** Mouse state for CPU animation */
  private _mouseX = 0;
  private _mouseY = 0;
  private _mouseInfluence = 0;
  private _scrollProgress = 0;
  private _seekStrength = 0;
  private _logoGlow = 0;
  private _driftSpeed: number = PARTICLE_CONFIG.driftSpeed;

  /** Nova animation state (mechanic 5). Driven entirely by the engine tick
   *  via getNovaGlow()/getNovaHalo() — no separate RAF, so no race with the
   *  engine's per-frame uniform writes. Active=true means a nova is in
   *  flight; getNovaGlow flips it back to false when the decay completes. */
  private _novaActive = false;
  private _novaStartMs = 0;
  private _novaPeak = 0;
  private _novaWorldX = 0;
  private _novaWorldY = 0;
  /** Nova decay duration in seconds. */
  private static readonly NOVA_DURATION = 1.0;

  private disposed = false;

  constructor(maxParticles?: number) {
    this.maxParticles = maxParticles ?? PARTICLE_CONFIG.maxParticles;
    this._activeCount = Math.min(
      PARTICLE_CONFIG.desktopBaseline,
      this.maxParticles,
    );

    // ---- Create GPU storage buffers ----
    this.posBuffer = new StorageInstancedBufferAttribute(
      this.maxParticles,
      3, // vec3
    );
    this.velBuffer = new StorageInstancedBufferAttribute(
      this.maxParticles,
      3,
    );

    // vec4: xyz = target position, w = weight (0 = no target, 1 = logo particle)
    this.targetBuffer = new StorageInstancedBufferAttribute(
      this.maxParticles,
      4, // vec4
    );

    // float: per-particle class id. Drives size/alpha/color branching in shader.
    this.typeBuffer = new StorageInstancedBufferAttribute(
      this.maxParticles,
      1, // single float
    );

    // ---- Initialize positions + types on CPU (works for both WebGPU & WebGL2) ----
    this.initPositions();
    this.initTypes();

    // ---- Build compute shader (creates storage nodes) ----
    const { computeUpdate } = createParticleComputeShader(
      this.posBuffer,
      this.velBuffer,
      this.targetBuffer,
    );
    this.computeUpdate = computeUpdate;

    // ---- Build material (creates storage nodes for pos + vel + type buffers) ----
    this.material = createParticleMaterial(this.posBuffer, this.velBuffer, this.typeBuffer);

    // ---- Build renderable sprite ----
    this.group = new Group();
    this.group.name = "ParticleSystem";

    this.sprite = new Sprite(this.material);
    this.sprite.count = this._activeCount;
    this.sprite.frustumCulled = false;
    this.group.add(this.sprite);

    // Set defaults
    uDriftSpeed.value = PARTICLE_CONFIG.driftSpeed;
    uMatParticleSize.value = PARTICLE_CONFIG.particleSize;
    uBoundaryRadius.value = 26;
  }

  /* ---------------------------------------------------------------- */
  /*  CPU position initialization (spherical distribution)            */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /*  Per-particle class assignment                                   */
  /* ---------------------------------------------------------------- */
  /**
   * Distribute particle types deterministically across the population.
   *  - 70% star      (sharp small bright)
   *  - 22% dust      (faint diffuse)
   *  - 7%  nebula    (large soft glow)
   *  - 1%  supernova (rare bright with halo)
   */
  private initTypes(): void {
    const types = this.typeBuffer.array as Float32Array;
    for (let i = 0; i < this.maxParticles; i++) {
      const r = Math.random();
      let t: number;
      if (r < 0.70)        t = 0.0; // star
      else if (r < 0.92)   t = 1.0; // dust
      else if (r < 0.99)   t = 2.0; // nebula
      else                 t = 3.0; // supernova
      types[i] = t;
    }
    this.typeBuffer.needsUpdate = true;
  }

  private initPositions(): void {
    const posArray = this.posBuffer.array as Float32Array;
    const velArray = this.velBuffer.array as Float32Array;
    const radius = 24;

    for (let i = 0; i < this.maxParticles; i++) {
      const i3 = i * 3;

      // Uniform volume sphere sampling
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * Math.cbrt(Math.random());

      posArray[i3] = r * Math.sin(phi) * Math.cos(theta);
      posArray[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      posArray[i3 + 2] = r * Math.cos(phi);

      // Small initial velocity so particles are already drifting
      velArray[i3] = (Math.random() - 0.5) * 0.3;
      velArray[i3 + 1] = (Math.random() - 0.5) * 0.3;
      velArray[i3 + 2] = (Math.random() - 0.5) * 0.3;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  CPU animation fallback (WebGL2 — no compute shaders)            */
  /* ---------------------------------------------------------------- */

  cpuAnimate(time: number, deltaTime: number): void {
    if (this.disposed) return;

    const pos = this.posBuffer.array as Float32Array;
    const vel = this.velBuffer.array as Float32Array;
    const count = this._activeCount;
    const driftSpeed = this._driftSpeed;
    const boundaryRadius = 26;
    const maxSpeed = 4.0;
    const t = time * 0.15;

    const mx = this._mouseX;
    const my = this._mouseY;
    const mInf = this._mouseInfluence;
    const scroll = this._scrollProgress;

    const seekStr = this._seekStrength;
    const targetArray = this.targetBuffer.array as Float32Array;
    const seekMag = 3.0;
    // Higher damping during convergence (lerp 0.992 → 0.94)
    const damping = seekStr > 0.01 ? 0.992 - seekStr * 0.052 : 0.992;
    const driftMul = 1.0 - seekStr * 0.85;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const px = pos[i3];
      const py = pos[i3 + 1];
      const pz = pos[i3 + 2];

      // ---- Curl-noise flow field (position-dependent) ----
      const sx = px * 0.08;
      const sy = py * 0.08;
      const sz = pz * 0.08;

      const a0 = fsin(sx + t * 0.7);
      const a1 = fcos(sy * 1.3 + t * 0.5);
      const a2 = fsin(sz * 0.9 + t * 0.6);

      const b0 = fcos(sx * 0.7 + t * 0.4);
      const b1 = fsin(sy * 1.1 + t * 0.8);
      const b2 = fcos(sz * 1.2 + t * 0.3);

      // Cross product → curl direction
      let fx = (a1 * b2 - a2 * b1) * driftSpeed;
      let fy = (a2 * b0 - a0 * b2) * driftSpeed;
      let fz = (a0 * b1 - a1 * b0) * driftSpeed;

      // Per-particle drift: targeted particles reduce drift (need to lock),
      // untargeted particles keep full drift and flow freely around text
      const i4 = i * 4;
      const tw = targetArray[i4 + 3];
      const particleDrift = tw > 0.001 ? driftMul : 1.2;
      fx *= particleDrift;
      fy *= particleDrift;
      fz *= particleDrift;

      // ---- Mouse influence ----
      if (mInf > 0) {
        const dx = mx - px;
        const dy = my - py;
        const dz = -pz;
        const md = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (md > 0.001) {
          const ms = Math.min(mInf * 8.0 / (md * md + 1.0), 2.0);
          fx += (dx / md) * ms;
          fy += (dy / md) * ms;
          fz += (dz / md) * ms;
        }
      }

      // ---- Soft boundary ----
      const dist = Math.sqrt(px * px + py * py + pz * pz);
      if (dist > 0.001) {
        // Boundary push
        if (dist > boundaryRadius) {
          const overflow = (dist - boundaryRadius) / 4.0;
          const bs = Math.min(overflow, 1.0) * 3.0;
          fx -= (px / dist) * bs;
          fy -= (py / dist) * bs;
          fz -= (pz / dist) * bs;
        }
        // Gentle center pull
        fx -= (px / dist) * 0.02;
        fy -= (py / dist) * 0.02;
        fz -= (pz / dist) * 0.02;
      }

      // ---- Scroll influence ----
      if (scroll > 0 && dist > 0.001) {
        fx += (px / dist) * scroll * 0.3;
        fy += (py / dist) * scroll * 0.15 + scroll * 0.15;
        fz += (pz / dist) * scroll * 0.3;
      }

      // ---- Seek target (logo convergence) ----
      if (seekStr > 0.01) {
        if (tw > 0.001) {
          const tx = targetArray[i4];
          const ty = targetArray[i4 + 1];
          const tz = targetArray[i4 + 2];
          fx += (tx - px) * seekStr * seekMag * tw;
          fy += (ty - py) * seekStr * seekMag * tw;
          fz += (tz - pz) * seekStr * seekMag * tw;
        }
      }

      // ---- Velocity integration ----
      vel[i3] = vel[i3] * damping + fx * deltaTime;
      vel[i3 + 1] = vel[i3 + 1] * damping + fy * deltaTime;
      vel[i3 + 2] = vel[i3 + 2] * damping + fz * deltaTime;

      // Clamp speed
      const vx = vel[i3];
      const vy = vel[i3 + 1];
      const vz = vel[i3 + 2];
      const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
      if (speed > maxSpeed) {
        const s = maxSpeed / speed;
        vel[i3] *= s;
        vel[i3 + 1] *= s;
        vel[i3 + 2] *= s;
      }

      // ---- Update position ----
      pos[i3] += vel[i3] * deltaTime;
      pos[i3 + 1] += vel[i3 + 1] * deltaTime;
      pos[i3 + 2] += vel[i3 + 2] * deltaTime;
    }

    // Tell Three.js to re-upload buffers to GPU
    this.posBuffer.needsUpdate = true;
    this.velBuffer.needsUpdate = true;
  }

  /* ---------------------------------------------------------------- */
  /*  Public API                                                       */
  /* ---------------------------------------------------------------- */

  setParticleCount(count: number): void {
    this._activeCount = Math.max(this._targetFloor || 1000, Math.min(count, this.maxParticles));
    if (this.sprite) {
      this.sprite.count = this._activeCount;
    }
  }

  /** Update tilt-driven flow bias (mechanic 4). Engine smooths and writes
   *  this each tick. Values are normalized -1..1; compute kernel scales. */
  setTiltFlow(x: number, y: number): void {
    uTiltX.value = x;
    uTiltY.value = y;
  }

  getParticleCount(): number {
    return this._activeCount;
  }

  getTargetFloor(): number {
    return this._targetFloor;
  }

  setMousePosition(x: number, y: number, influence: number): void {
    this._mouseX = x;
    this._mouseY = y;
    this._mouseInfluence = influence;
    uMouseX.value = x;
    uMouseY.value = y;
    uMouseInfluence.value = influence;
  }

  setScrollProgress(progress: number): void {
    this._scrollProgress = progress;
    uScrollProgress.value = progress;
    uMatScrollProgress.value = progress;
  }

  /**
   * Load logo point cloud as target positions for the first `count` particles.
   * Remaining particles get weight 0 (unaffected by seek).
   */
  setTargetPositions(logoPoints: Float32Array, logoPointCount: number): void {
    const targetArray = this.targetBuffer.array as Float32Array;

    // First logoPointCount particles: assign logo positions with weight 1
    for (let i = 0; i < logoPointCount && i < this.maxParticles; i++) {
      const i4 = i * 4;
      const i3 = i * 3;
      targetArray[i4] = logoPoints[i3];      // x
      targetArray[i4 + 1] = logoPoints[i3 + 1]; // y
      targetArray[i4 + 2] = logoPoints[i3 + 2]; // z
      targetArray[i4 + 3] = 1.0;                // weight = active
    }

    // Remaining particles: weight 0 (no seek target)
    for (let i = logoPointCount; i < this.maxParticles; i++) {
      const i4 = i * 4;
      targetArray[i4] = 0;
      targetArray[i4 + 1] = 0;
      targetArray[i4 + 2] = 0;
      targetArray[i4 + 3] = 0; // weight = inactive
    }

    this.targetBuffer.needsUpdate = true;
    this._targetFloor = logoPointCount;
  }

  setSeekStrength(strength: number): void {
    this._seekStrength = Math.max(0, Math.min(1, strength));
    uSeekStrength.value = this._seekStrength;
  }

  /**
   * External "logoGlow" intensity (e.g. from the HeroSection genesis GSAP
   * timeline, ambient pulses, or SiteSections). The engine tick reads this
   * via getExternalLogoGlow() each frame and composes it with the idle
   * (mechanic 3) and nova (mechanic 5) contributions before writing to the
   * GPU uniform — so external timelines and engine-driven effects don't
   * stomp each other.
   *
   * We also write the uniform here as a "best effort" fallback for cases
   * where the engine tick hasn't run yet (e.g. one-frame between init and
   * first tick). The next tick will recompose the composite value.
   */
  setLogoGlow(intensity: number): void {
    this._logoGlow = intensity;
    uMatLogoGlow.value = intensity;
  }

  /** Read the external logoGlow value (set by GSAP timelines, etc.). */
  getExternalLogoGlow(): number {
    return this._logoGlow;
  }

  /**
   * Engine-only: write a composed logoGlow value directly to the GPU uniform
   * WITHOUT updating `this._logoGlow`. The engine uses this every tick to
   * combine external (`_logoGlow`), idle, and nova contributions into a
   * single applied value, while preserving `_logoGlow` as the source-of-truth
   * for whatever external timeline last set it.
   */
  applyComposedLogoGlow(composed: number): void {
    uMatLogoGlow.value = composed;
  }

  setNoBloom(): void {
    uNoBloom.value = 1.0;
  }

  setDriftSpeed(speed: number): void {
    this._driftSpeed = speed;
    uDriftSpeed.value = speed;
  }

  /**
   * Set the projected pointer position in world space + an emphasis strength.
   * Used by the cursor lensing halo (mechanic 2). strength=0 fully disables
   * the halo, strength=1 is full emphasis. Pass any vec3 — z is generally 0
   * because we project onto the camera focal plane.
   */
  setPointerWorldPosition(x: number, y: number, strength: number): void {
    uPointerWorld.value.set(x, y, 0);
    uPointerStrength.value = Math.max(0, Math.min(1, strength));
  }

  /**
   * Set the three time-of-day perceptual weights (mechanic 6). Each is 0..1.
   * Caller is responsible for the time-of-day → weight mapping; this simply
   * pushes the values to the GPU uniforms.
   */
  setTimeOfDay(warm: number, cool: number, purple: number): void {
    uTimeWarm.value   = Math.max(0, Math.min(1, warm));
    uTimeCool.value   = Math.max(0, Math.min(1, cool));
    uTimePurple.value = Math.max(0, Math.min(1, purple));
  }

  /**
   * Trigger a tap/click "nova" pulse (mechanic 5).
   *  - Boosts logoGlow to `peak` (default 0.6, or 0.25 under reduced-motion).
   *  - Decays to 0 over NOVA_DURATION seconds with an ease-out cubic.
   *  - The CosmosEngine reads the active nova boost in its tick() loop
   *    via getNovaGlow()/getNovaHaloStrength() and folds it into the final
   *    logoGlow + pointerHalo uniforms each frame. This avoids race
   *    conditions where the engine's own per-tick uniform writes would
   *    overwrite a directly-driven nova animation.
   *
   * Subsequent calls reset the nova back to peak — tap-spam restarts the
   * animation rather than queueing.
   */
  triggerNova(worldX: number, worldY: number, reducedMotion = false): void {
    if (this.disposed) return;
    this._novaStartMs = performance.now();
    this._novaPeak = reducedMotion ? 0.25 : 0.6;
    this._novaWorldX = worldX;
    this._novaWorldY = worldY;
    this._novaActive = true;
  }

  /**
   * Returns the current nova logo-glow boost (0 if no active nova).
   * Called by the engine's tick() to fold the nova into the final glow value.
   */
  getNovaGlow(): number {
    if (!this._novaActive) return 0;
    const elapsedSec = (performance.now() - this._novaStartMs) / 1000;
    if (elapsedSec >= ParticleSystem.NOVA_DURATION) {
      this._novaActive = false;
      return 0;
    }
    const t = elapsedSec / ParticleSystem.NOVA_DURATION;
    // Ease-out cubic on the decay: peak at t=0, 0 at t=1.
    const decay = 1 - t;
    const eased = decay * decay * decay;
    return this._novaPeak * eased;
  }

  /**
   * Returns the current nova halo flare strength (0 if no active nova) and
   * the world-space center it should be anchored at. Engine uses this to
   * override the cursor halo briefly during a click.
   */
  getNovaHalo(): { strength: number; x: number; y: number } {
    if (!this._novaActive) return { strength: 0, x: 0, y: 0 };
    const elapsedSec = (performance.now() - this._novaStartMs) / 1000;
    if (elapsedSec >= ParticleSystem.NOVA_DURATION) {
      this._novaActive = false;
      return { strength: 0, x: 0, y: 0 };
    }
    const t = elapsedSec / ParticleSystem.NOVA_DURATION;
    const decay = 1 - t;
    const eased = decay * decay * decay;
    return { strength: eased, x: this._novaWorldX, y: this._novaWorldY };
  }

  teleportToTargets(): void {
    const pos = this.posBuffer.array as Float32Array;
    const vel = this.velBuffer.array as Float32Array;
    const target = this.targetBuffer.array as Float32Array;
    for (let i = 0; i < this.maxParticles; i++) {
      const i3 = i * 3;
      const i4 = i * 4;
      if (target[i4 + 3] > 0) {
        pos[i3] = target[i4];
        pos[i3 + 1] = target[i4 + 1];
        pos[i3 + 2] = target[i4 + 2];
      }
      vel[i3] = 0;
      vel[i3 + 1] = 0;
      vel[i3 + 2] = 0;
    }
    this.posBuffer.needsUpdate = true;
    this.velBuffer.needsUpdate = true;
  }

  update(time: number, deltaTime: number): void {
    if (this.disposed) return;
    uTime.value = time;
    uDeltaTime.value = deltaTime;
    uMatTime.value = time;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this._novaActive = false;
    this.material?.dispose();
    this.sprite?.geometry?.dispose();
    this.group.clear();
  }
}
