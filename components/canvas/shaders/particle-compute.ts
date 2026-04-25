/**
 * GPU Compute Shader for particle physics using Three.js TSL.
 *
 * Uses StorageInstancedBufferAttribute + storage() for WebGL2 compatibility.
 * The storage nodes wrap the same buffer used by the material.
 *
 * Movement: curl-noise-inspired flow field sampled at particle position,
 * producing organic flowing paths (not oscillation).
 *
 * NOTE: GPU compute only works with WebGPU. For WebGL2 fallback,
 * the engine uses ParticleSystem.cpuAnimate() instead.
 */
import {
  Fn,
  instanceIndex,
  storage,
  uniform,
  float,
  vec3,
  sin,
  cos,
  mul,
  add,
  sub,
  length,
  normalize,
  max,
  clamp,
  hash,
  If,
  mix,
} from "three/tsl";

import type { StorageInstancedBufferAttribute } from "three/webgpu";

/* ------------------------------------------------------------------ */
/*  Uniform declarations                                              */
/* ------------------------------------------------------------------ */

export const uTime = /* @__PURE__ */ uniform(float(0));
export const uDeltaTime = /* @__PURE__ */ uniform(float(0.016));
export const uMouseX = /* @__PURE__ */ uniform(float(0));
export const uMouseY = /* @__PURE__ */ uniform(float(0));
export const uMouseInfluence = /* @__PURE__ */ uniform(float(0));
export const uScrollProgress = /* @__PURE__ */ uniform(float(0));
export const uDriftSpeed = /* @__PURE__ */ uniform(float(1.0));
export const uBoundaryRadius = /* @__PURE__ */ uniform(float(26));
export const uSeekStrength = /* @__PURE__ */ uniform(float(0));

/* ------------------------------------------------------------------ */
/*  Build compute kernel                                              */
/* ------------------------------------------------------------------ */

export function createParticleComputeShader(
  posBuffer: StorageInstancedBufferAttribute,
  velBuffer: StorageInstancedBufferAttribute,
  targetBuffer: StorageInstancedBufferAttribute,
) {
  const posStorage = storage(posBuffer, "vec3", posBuffer.count);
  const velStorage = storage(velBuffer, "vec3", velBuffer.count);
  const targetStorage = storage(targetBuffer, "vec4", targetBuffer.count);

  const computeUpdate = Fn(() => {
    const pos = posStorage.element(instanceIndex);
    const vel = velStorage.element(instanceIndex);

    // Per-particle deterministic phase offsets
    const h0 = hash(instanceIndex);
    const h1 = hash(instanceIndex.add(3571));

    // ================================================================
    // CURL-NOISE FLOW FIELD
    // ================================================================
    // Sampled at particle's CURRENT POSITION — as it moves, force
    // direction changes, producing organic flowing paths (not oscillation).
    const px = pos.x.mul(0.08);
    const py = pos.y.mul(0.08);
    const pz = pos.z.mul(0.08);
    const t = uTime.mul(0.15);

    // Two scalar fields
    const a0 = sin(add(px, t.mul(0.7)).add(h0.mul(1.5)));
    const a1 = cos(add(py.mul(1.3), t.mul(0.5)));
    const a2 = sin(add(pz.mul(0.9), t.mul(0.6)).add(h1));

    const b0 = cos(add(px.mul(0.7), t.mul(0.4)));
    const b1 = sin(add(py.mul(1.1), t.mul(0.8)));
    const b2 = cos(add(pz.mul(1.2), t.mul(0.3)));

    // Cross product → divergence-free flow direction
    const curlX = a1.mul(b2).sub(a2.mul(b1));
    const curlY = a2.mul(b0).sub(a0.mul(b2));
    const curlZ = a0.mul(b1).sub(a1.mul(b0));

    // Per-particle speed variation (0.5x to 1.5x)
    const speedMul = h0.add(0.5);

    // Reduce drift during convergence so it doesn't fight the seek
    const driftScale = sub(float(1.0), uSeekStrength.mul(0.85));
    const driftForce = vec3(
      curlX.mul(uDriftSpeed).mul(speedMul).mul(driftScale),
      curlY.mul(uDriftSpeed).mul(speedMul).mul(driftScale),
      curlZ.mul(uDriftSpeed).mul(speedMul).mul(driftScale),
    );

    // ================================================================
    // MOUSE INFLUENCE
    // ================================================================
    const mousePos = vec3(uMouseX, uMouseY, float(0));
    const toMouse = sub(mousePos, pos);
    const mouseDist = max(length(toMouse), float(0.001));
    const mouseStrength = clamp(
      uMouseInfluence
        .mul(float(8.0))
        .div(add(mouseDist.mul(mouseDist), float(1.0))),
      float(0),
      float(2.0),
    );
    const mouseForce = mul(normalize(toMouse), mouseStrength);

    // ================================================================
    // SOFT BOUNDARY
    // ================================================================
    const distFromCenter = max(length(pos), float(0.001));
    const overflow = sub(distFromCenter, uBoundaryRadius).div(float(4.0));
    const boundaryStrength = clamp(overflow, float(0), float(1)).mul(3.0);
    const boundaryForce = mul(normalize(pos).negate(), boundaryStrength);

    // Gentle center pull to prevent drift-away
    const centerPull = mul(normalize(pos).negate(), float(0.02));

    // ================================================================
    // SCROLL INFLUENCE
    // ================================================================
    const scrollPush = mul(normalize(pos), uScrollProgress.mul(0.3));
    const scrollLift = vec3(float(0), uScrollProgress.mul(0.15), float(0));

    // ================================================================
    // SEEK TARGET (logo convergence)
    // ================================================================
    const target = targetStorage.element(instanceIndex);
    const targetWeight = target.w;
    const targetPos = vec3(target.x, target.y, target.z);
    const toTarget = sub(targetPos, pos);
    const seekMagnitude = float(3.0);
    const seekForce = mul(toTarget, uSeekStrength.mul(seekMagnitude).mul(targetWeight));

    // ================================================================
    // VELOCITY INTEGRATION (semi-implicit Euler)
    // ================================================================
    // Higher damping during convergence prevents overshoot
    const damping = mix(float(0.992), float(0.94), uSeekStrength);
    const totalForce = add(
      add(add(add(add(driftForce, mouseForce), boundaryForce), centerPull), seekForce),
      add(scrollPush, scrollLift),
    );
    vel.assign(add(mul(vel, damping), totalForce.mul(uDeltaTime)));

    // Clamp velocity
    const speed = max(length(vel), float(0.0001));
    const maxSpeed = float(4.0);
    If(speed.greaterThan(maxSpeed), () => {
      vel.assign(mul(normalize(vel), maxSpeed));
    });

    // Update position
    pos.addAssign(vel.mul(uDeltaTime));
  })()
    .compute(posBuffer.count)
    .setName("Update Particles");

  return { posStorage, computeUpdate };
}
