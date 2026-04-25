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
  Vector3,
} from "three/webgpu";

import {
  uniform,
  float,
  vec2,
  vec3,
  vec4,
  color,
  sin,
  mul,
  add,
  sub,
  mix,
  clamp,
  smoothstep,
  step,
  length,
  hash,
  abs as tslAbs,
  instanceIndex,
  storage,
  uv,
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

/* ---- Cursor / touch lensing (mechanic 2) ----
 * uPointerWorld is the projected pointer position in world space (vec3).
 * uPointerStrength is a 0..1 multiplier — 0 fully disables the halo even
 * when uPointerWorld is set. Mutate via the Vector3 `value` property.
 */
export const uPointerWorld = /* @__PURE__ */ uniform(new Vector3(0, 0, 0));
export const uPointerStrength = /* @__PURE__ */ uniform(float(0));

/* ---- Time-of-day palette shift (mechanic 6) ----
 * Three independent perceptual weights, each 0..1. The shader nudges the
 * per-particle color toward warm-cream / saturated-blue / magenta-purple
 * depending on the local hour. Maximum mix factor is small (~0.2) so the
 * effect is only noticeable across visits, never within one.
 */
export const uTimeWarm = /* @__PURE__ */ uniform(float(0));
export const uTimeCool = /* @__PURE__ */ uniform(float(0));
export const uTimePurple = /* @__PURE__ */ uniform(float(0));

/* ------------------------------------------------------------------ */
/*  Colors                                                            */
/* ------------------------------------------------------------------ */

const etherealBlue = new Color(COLORS.etherealBlue);
const etherealGlow = new Color(COLORS.etherealGlow);
const goldWarm = new Color(COLORS.goldWarm);
const goldBright = new Color(COLORS.goldBright);
const hAlpha = new Color(COLORS.hAlpha);
const oxygenTeal = new Color(COLORS.oxygenTeal);

/* ------------------------------------------------------------------ */
/*  Create material                                                   */
/* ------------------------------------------------------------------ */

export function createParticleMaterial(
  posBuffer: StorageInstancedBufferAttribute,
  velBuffer: StorageInstancedBufferAttribute,
  typeBuffer: StorageInstancedBufferAttribute,
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

  // Per-particle class id (0=star, 1=dust, 2=nebula, 3=supernova).
  // step()-chained gates let the highest matching type's modifier win.
  const typeStorage = storage(typeBuffer, "float", typeBuffer.count);
  const ptype = typeStorage.element(instanceIndex);
  const isAtLeastDust      = step(float(0.5), ptype);
  const isAtLeastNebula    = step(float(1.5), ptype);
  const isAtLeastSupernova = step(float(2.5), ptype);

  // Per-particle deterministic randomness
  const particleHash = hash(instanceIndex);
  const particleHash2 = hash(add(instanceIndex, float(7919)));

  // ---- Per-particle color variation (JWST-flavored emission spectrum) ----
  // Population (by particleHash2):
  //   [0.00, 0.70)  cool — varied blue↔cyan blend (the dominant majority)
  //   [0.70, 0.85)  cream — slight stellar warmth
  //   [0.85, 0.95)  H-alpha — rare ionized-hydrogen red accents
  //   [0.95, 1.00)  oxygen teal — rarest cyan-green accents
  // step(threshold, h) returns 1 when h >= threshold, 0 otherwise — chained
  // mix() calls let the highest matching threshold's color win.
  const coolBlend = mix(color(etherealBlue), color(etherealGlow), particleHash);
  let speciesColor = coolBlend;
  speciesColor = mix(speciesColor, color(goldBright),  step(float(0.70), particleHash2));
  speciesColor = mix(speciesColor, color(hAlpha),       step(float(0.85), particleHash2));
  speciesColor = mix(speciesColor, color(oxygenTeal),   step(float(0.95), particleHash2));

  // ---- Scroll shifts cool particles toward warm; accent particles stay vivid ----
  const scrollShiftedColor = mix(
    speciesColor,
    color(goldWarm),
    clamp(uMatScrollProgress.mul(0.6), float(0), float(0.5)),
  );

  // ---- Logo glow pulse (gold shift during convergence) ----
  const logoColor = mix(
    scrollShiftedColor,
    color(goldBright),
    clamp(uMatLogoGlow, float(0), float(1)),
  );

  // ---- Supernovae always read as hot white regardless of species ----
  const supernovaColor = vec3(1.0, 0.96, 0.88);
  const classedColorRaw = mix(logoColor, supernovaColor, isAtLeastSupernova);

  // ---- Time-of-day palette shift (mechanic 6) ----
  // Subtle bias toward dawn-warm (cream), evening-warm (cream),
  // night-cool (saturated blue), or late-night (magenta-purple).
  // Each shift caps at ~0.20 mix factor so it's a perceptual nudge, not
  // a recolor — visitors should only notice "the cosmos felt different
  // last time" on return, not within a session.
  const warmTarget   = vec3(1.00, 0.92, 0.78); // cream
  const coolTarget   = vec3(0.55, 0.78, 1.00); // saturated cool blue
  const purpleTarget = vec3(0.78, 0.55, 1.00); // magenta-purple
  const todMaxShift = float(0.20);
  let classedColor = mix(classedColorRaw, warmTarget,   mul(uTimeWarm,   todMaxShift));
  classedColor     = mix(classedColor,    coolTarget,   mul(uTimeCool,   todMaxShift));
  classedColor     = mix(classedColor,    purpleTarget, mul(uTimePurple, todMaxShift));

  // ---- Breathing / pulsing brightness ----
  const breathPhase = add(uMatTime.mul(0.5), particleHash.mul(6.2831));
  const breathFactor = add(float(0.8), mul(sin(breathPhase), float(0.2)));

  // ---- Per-particle twinkle ----
  // Faster than breath, sharper amplitude, wildly varied per particle so the
  // field reads as alive at the atomic scale instead of synchronized.
  const twinklePhase = add(uMatTime.mul(2.4), particleHash2.mul(6.2831));
  const twinkleAmp = mul(particleHash2, float(0.18));
  const twinkleFactor = add(float(1.0), mul(sin(twinklePhase), twinkleAmp));

  // ---- Distance-based opacity fade ----
  const pos = posStorage.element(instanceIndex);
  const dist = length(pos);
  const distanceFade = smoothstep(float(30), float(18), dist);
  const centerBoost = smoothstep(float(0), float(6), dist);

  // ---- Cursor / touch lensing halo (mechanic 2) ----
  // Particles within ~3 world units of the projected pointer position get
  // an alpha emphasis; smoothly falls off to 0 at distance 3+. This is a
  // visual "energized atoms" halo around where the viewer is looking,
  // separate from the curl-noise force in the compute shader.
  const pointerDist = length(sub(pos, uPointerWorld));
  // Inner peak at distance 0.5 (fully energized), outer fade by 3.0.
  // smoothstep(3.0, 0.5, d) returns 1 at center, 0 beyond 3 units.
  const pointerProximity = smoothstep(float(3.0), float(0.5), pointerDist);
  // Multiplied by external strength so brief flares (e.g. tap nova) can
  // pulse the halo without re-projecting world coords every frame.
  const pointerEmphasis = mul(pointerProximity, uPointerStrength);

  // ---- Class-based alpha modifier ----
  // dust = much fainter (large blurry), nebula = even fainter (atmospheric),
  // supernova = brighter punch.
  const classAlpha = mix(
    mix(
      mix(float(1.0), float(0.40), isAtLeastDust),
      float(0.18),
      isAtLeastNebula,
    ),
    float(1.6),
    isAtLeastSupernova,
  );

  // ---- Final opacity (low per-particle — additive blending accumulates) ----
  const baseAlpha = mul(
    float(0.12),
    breathFactor,
    twinkleFactor,
    distanceFade,
    mix(float(0.4), float(1.0), centerBoost),
    classAlpha,
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

  // ---- Class-based size scaling (star=1×, dust=1.6×, nebula=4×, supernova=8×) ----
  // Nested mix gates ensure highest matching type's modifier wins.
  const classScale = mix(
    mix(
      mix(float(1.0), float(1.6), isAtLeastDust),
      float(4.0),
      isAtLeastNebula,
    ),
    float(8.0),
    isAtLeastSupernova,
  );

  const particleScale = mul(uMatParticleSize, scaleBreath, velocityScale, classScale);

  // Velocity-based alpha boost — fast particles glow brighter (trail luminance)
  const velocityAlpha = mul(speed.div(float(4.0)), float(0.05));

  // Boost alpha during logo glow for brighter convergence.
  // Pointer halo (mechanic 2) adds up to ~0.18 alpha at the cursor center,
  // creating the visible "atoms light up where you look" emphasis.
  const maxGlowAlpha = mix(float(0.35), float(0.7), uNoBloom);
  const glowAlpha = clamp(
    add(
      finalAlpha,
      uMatLogoGlow.mul(float(0.15)),
      velocityAlpha,
      mul(pointerEmphasis, float(0.18)),
    ),
    float(0.008),
    maxGlowAlpha,
  );

  // ---- Procedural particle sprite ----
  // Each sprite is a square quad. The fragment shader paints an "atom" with
  // resolution-independent features so the particle stays sharp at any zoom
  // level (no texture to blur):
  //   - Halo               soft atmosphere falloff
  //   - Core + nucleus     sharp inner glow + pixel-tight bright dot
  //   - 6-point spikes     three rotated thin lines through center (JWST look)
  //   - Outer ring         faint atomic-shell ring on bright particles only
  //
  // Class modulation: nested mix() chains, supernova-strongest wins.
  const uvFromCenter = sub(uv(), vec2(0.5, 0.5));
  const radialDist = length(uvFromCenter);

  // Outer halo — soft atmosphere
  const halo = smoothstep(float(0.5), float(0.0), radialDist);

  // Bright inner core — narrow nucleus, resolution-independent
  const core = smoothstep(float(0.08), float(0.0), radialDist);
  // Pixel-precise ultra-bright nucleus
  const nucleus = smoothstep(float(0.025), float(0.0), radialDist);

  // 6-point diffraction spikes — three thin lines at 0°, 60°, 120° through
  // center. Each line is the set of points where one of these distances is
  // near zero. Geometry: for a line at angle θ, the perpendicular distance
  // from a UV point is |x·-sin θ + y·cos θ|.
  const SIN60 = 0.8660254;
  const COS60 = 0.5;
  // Line 1: angle 0°  → distance is just |y|
  const d1 = tslAbs(uvFromCenter.y);
  // Line 2: angle 60° → distance is |x·-sin60 + y·cos60|
  const d2 = tslAbs(sub(mul(uvFromCenter.y, float(COS60)), mul(uvFromCenter.x, float(SIN60))));
  // Line 3: angle 120° → distance is |x·sin60 + y·cos60|
  const d3 = tslAbs(add(mul(uvFromCenter.x, float(SIN60)), mul(uvFromCenter.y, float(COS60))));
  const spikeFalloff = smoothstep(float(0.5), float(0.0), radialDist);
  const spike1 = smoothstep(float(0.010), float(0.0), d1);
  const spike2 = smoothstep(float(0.010), float(0.0), d2);
  const spike3 = smoothstep(float(0.010), float(0.0), d3);
  const allSpikes = mul(add(spike1, spike2, spike3), spikeFalloff);

  // Outer atomic-shell ring — faint glow at radial distance ~0.34, only
  // perceptible on the brightest (supernova) class. Adds visible structure
  // at zoom: viewer sees core → empty space → faint ring → fade.
  const outerRing = mul(
    smoothstep(float(0.28), float(0.34), radialDist),
    smoothstep(float(0.42), float(0.34), radialDist),
  );

  // Class-driven feature intensities
  const haloWeight = mix(
    mix(
      mix(float(1.0), float(1.4), isAtLeastDust),
      float(1.6),
      isAtLeastNebula,
    ),
    float(1.3),
    isAtLeastSupernova,
  );
  const coreWeight = mix(
    mix(
      mix(float(0.9), float(0.0), isAtLeastDust),
      float(0.0),
      isAtLeastNebula,
    ),
    float(2.6),
    isAtLeastSupernova,
  );
  const spikeWeight = mix(
    mix(
      mix(float(0.18), float(0.0), isAtLeastDust),
      float(0.0),
      isAtLeastNebula,
    ),
    float(1.6),
    isAtLeastSupernova,
  );
  const ringWeight = mix(float(0.0), float(0.45), isAtLeastSupernova);

  // Compose the procedural particle alpha
  const procShape = add(
    mul(halo, haloWeight),
    mul(core, coreWeight),
    mul(nucleus, float(0.9)),
    mul(allSpikes, spikeWeight),
    mul(outerRing, ringWeight),
  );

  // Final alpha — multiply intrinsic glow brightness by procedural shape.
  // clamp so additive blending doesn't blow stupid-far above 1.
  const shapedAlpha = clamp(mul(glowAlpha, procShape), float(0.0), float(2.5));

  // Assign to material — classedColor folds in the supernova-white override
  material.colorNode = vec4(classedColor, shapedAlpha);
  material.scaleNode = vec3(particleScale, particleScale, particleScale);

  return material;
}
