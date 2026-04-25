/**
 * world-projection — maps a screen-space DOMRect + a normalized point cloud
 * (output of `textToPoints`) into 3D world-space points lying on the z=0
 * plane (the same plane the cosmos particles drift through).
 *
 * The transform aligns the particles' projected screen position with the
 * heading's bounding rect: when the engine drives particles toward these
 * world points, they visually overlap the live <h2> for a frame, then the
 * <h2> fades in and replaces them.
 *
 * Camera assumptions (matching cosmos-engine.ts):
 *   - Perspective camera at (0, 0, 30) looking at the origin
 *   - z=0 is the target plane (heading lives here in world space)
 *   - vertical FOV in degrees, aspect = viewport width / viewport height
 *
 * Camera handheld drift (~±0.45 world units xy) is small relative to the
 * z=30 distance; we ignore it here. The resulting visual jitter is well
 * within the seek-radius tolerance.
 */

import type { PerspectiveCamera } from "three/webgpu";

/**
 * Project a screen-space rect into world-space points.
 *
 * @param rect              DOMRect of the heading element
 * @param normalizedPoints  Flat Float32Array of (x,y,z) triples in
 *                          normalized space (`textToPoints` output)
 * @param camera            The active perspective camera
 * @param scaleY            Multiplier on the y-axis world width — typically 1.0;
 *                          set <1 to compress the formed text vertically.
 *
 * @returns A new Float32Array of (x,y,z) world coords, same length as input.
 */
export function screenRectToWorldPoints(
  rect: DOMRect,
  normalizedPoints: Float32Array,
  camera: PerspectiveCamera,
  scaleY: number = 1.0,
): Float32Array {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // ---- World units per pixel at z=0 ----
  // For a perspective camera the visible plane size at depth d (distance
  // from camera) is:
  //   halfHeight = tan(fov/2) * d
  //   halfWidth  = halfHeight * aspect
  // Distance from camera (z=30) to target plane (z=0) is 30.
  const distance = Math.abs(camera.position.z); // = 30 in our setup
  const fovRad = (camera.fov * Math.PI) / 180;
  const halfHeightWorld = Math.tan(fovRad / 2) * distance;
  const halfWidthWorld = halfHeightWorld * camera.aspect;

  const worldUnitsPerPxX = (halfWidthWorld * 2) / vw;
  const worldUnitsPerPxY = (halfHeightWorld * 2) / vh;

  // ---- Heading screen center → world center on z=0 plane ----
  const screenCenterX = rect.left + rect.width / 2;
  const screenCenterY = rect.top + rect.height / 2;

  // CSS coords: (0,0) is top-left, +y is down.
  // World coords: (0,0) is screen center on z=0 plane, +y is up.
  const worldCenterX = (screenCenterX - vw / 2) * worldUnitsPerPxX;
  const worldCenterY = -(screenCenterY - vh / 2) * worldUnitsPerPxY;

  // ---- Per-section x-half-width in world units ----
  // The normalized x-range of the text is [-1, 1]; multiplying by
  // halfRectWidthWorld lands the points on the heading's actual width.
  const halfRectWidthWorld = (rect.width / 2) * worldUnitsPerPxX;
  // Y-axis: same world-units-per-pixel scale on x and y (aspect-correct).
  // The normalized y-range is [-aspectY, aspectY] where aspectY = h/w in the
  // bitmap, so multiplying by halfRectWidthWorld preserves the rendered
  // aspect ratio of the text.
  const yScale = halfRectWidthWorld * scaleY;

  const out = new Float32Array(normalizedPoints.length);
  const count = normalizedPoints.length / 3;

  for (let i = 0; i < count; i++) {
    const i3 = i * 3;
    const nx = normalizedPoints[i3];
    const ny = normalizedPoints[i3 + 1];
    const nz = normalizedPoints[i3 + 2];

    out[i3]     = worldCenterX + nx * halfRectWidthWorld;
    out[i3 + 1] = worldCenterY + ny * yScale;
    // z stays small — keeps particles near the z=0 plane so they project
    // close to the rect; nz already in [-~0.6, 0.6].
    out[i3 + 2] = nz;
  }

  return out;
}
