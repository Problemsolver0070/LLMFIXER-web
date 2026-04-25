/**
 * Background scene layers — what the active particle field lives inside.
 *
 *  - Far-distance static star sky: thousands of dim points placed on a
 *    far sphere shell (radius 50-80). Doesn't animate; provides depth
 *    parallax against the foreground active particles when the camera
 *    drifts.
 *  - Nebula billboards: a small set of large radial-gradient sprites at
 *    fixed mid-distance positions, providing atmospheric glow regions
 *    that read as "the cosmos has weather."
 *
 * Both layers use additive blending and live behind the active particle
 * field (no depth write, lower z, no compute updates).
 */
import {
  BufferGeometry,
  BufferAttribute,
  Points,
  PointsNodeMaterial,
  Sprite,
  SpriteNodeMaterial,
  CanvasTexture,
  AdditiveBlending,
  Group,
} from "three/webgpu";

import {
  uniform, float, vec2, vec4,
  attribute, sub, length, smoothstep, mul,
  texture as textureNode, uv,
} from "three/tsl";

/* ---------------------------------------------------------------- */
/*  Star sky                                                        */
/* ---------------------------------------------------------------- */

/**
 * Generates N dim stars on a far spherical shell. Mostly cool blue-white,
 * rare warm. Static — never updates — so this costs ~zero per frame.
 */
export function createStarSky(count: number = 4000): Points {
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Far spherical shell, radius 50-80
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 50 + Math.random() * 30;

    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);

    // Color — mostly cool blue-white, rare warm cream
    const roll = Math.random();
    if (roll < 0.04) {
      // Warm cream stars
      colors[i * 3]     = 1.00;
      colors[i * 3 + 1] = 0.92;
      colors[i * 3 + 2] = 0.78;
    } else if (roll < 0.10) {
      // Slight cyan tint
      colors[i * 3]     = 0.70;
      colors[i * 3 + 1] = 0.88;
      colors[i * 3 + 2] = 0.95;
    } else {
      // Cool blue-white (slight variation)
      const v = 0.78 + Math.random() * 0.20;
      colors[i * 3]     = v * 0.86;
      colors[i * 3 + 1] = v * 0.92;
      colors[i * 3 + 2] = v;
    }

    // Size — long-tail distribution: most tiny, few brighter
    const sizeRoll = Math.random();
    if (sizeRoll < 0.85)      sizes[i] = 0.02 + Math.random() * 0.04;
    else if (sizeRoll < 0.97) sizes[i] = 0.06 + Math.random() * 0.06;
    else                       sizes[i] = 0.12 + Math.random() * 0.08;
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setAttribute("size", new BufferAttribute(sizes, 1));

  const material = new PointsNodeMaterial();
  material.transparent = true;
  material.blending = AdditiveBlending;
  material.depthWrite = false;
  // Per-vertex color + size, with a uniform tint multiplier for global control.
  const skyTint = uniform(float(0.85));
  const colorAttr = attribute("color", "vec3");
  const sizeAttr = attribute("size", "float");
  // Radial alpha falloff (sprite quad → round soft point)
  const uvFromCenter = sub(uv(), vec2(0.5, 0.5));
  const radialDist = length(uvFromCenter);
  const radialFalloff = smoothstep(float(0.5), float(0.0), radialDist);
  material.colorNode = vec4(colorAttr, mul(skyTint, radialFalloff));
  material.sizeNode = sizeAttr;

  const sky = new Points(geometry, material);
  sky.frustumCulled = false;
  sky.renderOrder = -2; // behind everything else
  return sky;
}

/* ---------------------------------------------------------------- */
/*  Nebula billboards                                               */
/* ---------------------------------------------------------------- */

/** Generates a radial-gradient alpha texture in the given hue. */
function makeNebulaTexture(r: number, g: number, b: number, size = 256): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");

  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, size / 2);
  grad.addColorStop(0,    `rgba(${r},${g},${b},0.55)`);
  grad.addColorStop(0.30, `rgba(${r},${g},${b},0.22)`);
  grad.addColorStop(0.65, `rgba(${r},${g},${b},0.06)`);
  grad.addColorStop(1,    `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = "srgb";
  return tex;
}

interface NebulaConfig {
  position: [number, number, number];
  color: [number, number, number]; // 0-255 RGB
  scale: number;
}

/**
 * Creates a small set of mid-distance nebula billboards at fixed positions.
 * Each is a Sprite with a radial-gradient alpha texture; they read as soft
 * atmospheric glow zones behind the active particle field.
 */
export function createNebulaBillboards(): Group {
  const group = new Group();
  group.name = "NebulaBillboards";

  const configs: NebulaConfig[] = [
    // hAlpha-ish red region — upper left
    { position: [-18,   8, -18], color: [200,  75,  95], scale: 26 },
    // Teal region — right
    { position: [ 22,  -3, -22], color: [ 79, 207, 192], scale: 22 },
    // Warm cream region — lower left, deeper
    { position: [-12, -14, -28], color: [200, 165, 120], scale: 30 },
    // Soft blue region — upper right
    { position: [ 14,  16, -25], color: [110, 154, 216], scale: 24 },
    // Deep magenta-purple — far back center
    { position: [  0,   0, -38], color: [125,  85, 165], scale: 36 },
  ];

  for (const c of configs) {
    const tex = makeNebulaTexture(...c.color);
    const material = new SpriteNodeMaterial();
    // TSL: set color via texture node, not the legacy `.map` API.
    material.colorNode = textureNode(tex);
    material.transparent = true;
    material.blending = AdditiveBlending;
    material.depthWrite = false;

    const sprite = new Sprite(material);
    sprite.position.set(...c.position);
    sprite.scale.set(c.scale, c.scale, 1);
    sprite.frustumCulled = false;
    sprite.renderOrder = -1; // between sky and active particles
    group.add(sprite);
  }

  return group;
}
