/**
 * Particle material using SpriteNodeMaterial with TSL.
 *
 * Reads positions from a storage() node wrapping the same
 * StorageInstancedBufferAttribute that the compute shader writes to.
 * This works in both WebGPU and WebGL2 modes.
 *
 * Features:
 * - Additive blending for ethereal glow
 * - Per-particle color variation (ethereal blue to cyan range)
 * - Scroll-driven color temperature shift (toward gold)
 * - Breathing/pulsing brightness animation
 * - Distance-based opacity fade
 */
import {
  SpriteNodeMaterial,
  AdditiveBlending,
  Color,
} from "three/webgpu";

import {
  uniform,
  float,
  vec3,
  vec4,
  color,
  sin,
  mul,
  add,
  mix,
  clamp,
  smoothstep,
  length,
  hash,
  instanceIndex,
  storage,
} from "three/tsl";

import { COLORS } from "@/lib/theme";

import type { StorageInstancedBufferAttribute } from "three/webgpu";

/* ------------------------------------------------------------------ */
/*  Shared uniforms                                                   */
/* ------------------------------------------------------------------ */

export const uMatTime = /* @__PURE__ */ uniform(float(0));
export const uMatScrollProgress = /* @__PURE__ */ uniform(float(0));
export const uMatParticleSize = /* @__PURE__ */ uniform(float(0.04));
export const uMatLogoGlow = /* @__PURE__ */ uniform(float(0));
export const uNoBloom = /* @__PURE__ */ uniform(float(0));

/* ------------------------------------------------------------------ */
/*  Colors                                                            */
/* ------------------------------------------------------------------ */

const etherealBlue = new Color(COLORS.etherealBlue);
const etherealGlow = new Color(COLORS.etherealGlow);
const goldWarm = new Color(COLORS.goldWarm);
const goldBright = new Color(COLORS.goldBright);

/* ------------------------------------------------------------------ */
/*  Create material                                                   */
/* ------------------------------------------------------------------ */

export function createParticleMaterial(
  posBuffer: StorageInstancedBufferAttribute,
  velBuffer: StorageInstancedBufferAttribute,
) {
  const material = new SpriteNodeMaterial();
  material.transparent = true;
  material.depthWrite = false;
  material.blending = AdditiveBlending;

  // Create storage nodes wrapping the same buffers the compute/CPU writes to.
  // .toAttribute() makes them readable as vertex attributes in WebGL2.
  const posStorage = storage(posBuffer, "vec3", posBuffer.count);
  material.positionNode = posStorage.toAttribute();

  const velStorage = storage(velBuffer, "vec3", velBuffer.count);
  const vel = velStorage.element(instanceIndex);
  const speed = clamp(length(vel), float(0), float(4.0));

  // Per-particle deterministic randomness
  const particleHash = hash(instanceIndex);
  const particleHash2 = hash(add(instanceIndex, float(7919)));

  // ---- Color: blend ethereal blue → cyan, shift toward gold on scroll ----
  const baseColor = mix(
    color(etherealBlue),
    color(etherealGlow),
    particleHash,
  );
  const scrollShiftedColor = mix(
    baseColor,
    color(goldWarm),
    clamp(uMatScrollProgress.mul(0.6), float(0), float(0.5)),
  );

  // ---- Logo glow pulse (gold shift during convergence) ----
  const logoColor = mix(
    scrollShiftedColor,
    color(goldBright),
    clamp(uMatLogoGlow, float(0), float(1)),
  );

  // ---- Breathing / pulsing brightness ----
  const breathPhase = add(uMatTime.mul(0.5), particleHash.mul(6.2831));
  const breathFactor = add(float(0.8), mul(sin(breathPhase), float(0.2)));

  // ---- Distance-based opacity fade ----
  const pos = posStorage.element(instanceIndex);
  const dist = length(pos);
  const distanceFade = smoothstep(float(30), float(18), dist);
  const centerBoost = smoothstep(float(0), float(6), dist);

  // ---- Final opacity (low per-particle — additive blending accumulates) ----
  const baseAlpha = mul(
    float(0.12),
    breathFactor,
    distanceFade,
    mix(float(0.4), float(1.0), centerBoost),
  );
  // Boost brightness when bloom is absent (bloom normally amplifies additive glow)
  const bloomCompensation = mix(float(1.0), float(2.5), uNoBloom);
  const compensatedAlpha = mul(baseAlpha, bloomCompensation);
  const alphaVariation = mix(float(0.3), float(1.0), particleHash2);
  const maxAlpha = mix(float(0.2), float(0.5), uNoBloom);
  const finalAlpha = clamp(
    mul(compensatedAlpha, alphaVariation),
    float(0.008),
    maxAlpha,
  );

  // ---- Pulsing scale ----
  const scaleBreath = add(
    float(1.0),
    mul(sin(add(uMatTime.mul(1.2), particleHash.mul(3.14))), float(0.15)),
  );
  // Velocity-based size boost — fast particles stretch larger (trail effect)
  const velocityScale = add(float(1.0), mul(speed.div(float(4.0)), float(0.5)));
  const particleScale = mul(uMatParticleSize, scaleBreath, velocityScale);

  // Velocity-based alpha boost — fast particles glow brighter (trail luminance)
  const velocityAlpha = mul(speed.div(float(4.0)), float(0.05));

  // Boost alpha during logo glow for brighter convergence
  const maxGlowAlpha = mix(float(0.35), float(0.7), uNoBloom);
  const glowAlpha = clamp(
    add(finalAlpha, uMatLogoGlow.mul(float(0.15)), velocityAlpha),
    float(0.008),
    maxGlowAlpha,
  );

  // Assign to material
  material.colorNode = vec4(logoColor, glowAlpha);
  material.scaleNode = vec3(particleScale, particleScale, particleScale);

  return material;
}
