/**
 * Converts an SVG file's stroke paths into a Float32Array of 3D points
 * suitable for use as particle target positions.
 *
 * Uses the browser's native SVG geometry APIs (getPointAtLength).
 * Must run client-side.
 */

export interface PointCloudResult {
  /** vec3 positions as flat Float32Array [x,y,z, x,y,z, ...] */
  positions: Float32Array;
  /** Number of points actually sampled */
  count: number;
}

/**
 * Load an SVG from a URL, sample points along its stroke paths,
 * and return centered+scaled 3D positions.
 *
 * @param svgUrl - URL to the SVG file (e.g. "/logo/thefixer-mark.svg")
 * @param targetCount - Desired number of sample points
 * @param worldScale - Max extent in world units (default 15)
 */
export async function svgToPointCloud(
  svgUrl: string,
  targetCount: number,
  worldScale = 15,
): Promise<PointCloudResult> {
  // Fetch and parse SVG
  const response = await fetch(svgUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch SVG from ${svgUrl}: ${response.status}`);
  }
  const svgText = await response.text();

  // Insert into a hidden container so browser computes geometry
  const container = document.createElement("div");
  container.style.cssText = "position:absolute;left:-9999px;visibility:hidden;width:0;height:0;overflow:hidden";
  container.innerHTML = svgText;
  document.body.appendChild(container);

  const svg = container.querySelector("svg");
  if (!svg) {
    document.body.removeChild(container);
    throw new Error(`No <svg> element found in ${svgUrl}`);
  }

  // Get viewBox for coordinate mapping
  const vb = svg.viewBox.baseVal;
  const vbWidth = vb.width || 200;
  const vbHeight = vb.height || 200;
  const vbCenterX = vb.x + vbWidth / 2;
  const vbCenterY = vb.y + vbHeight / 2;

  // Collect all geometry elements and their path lengths
  const geometryEls = svg.querySelectorAll("path, line, circle, ellipse, rect, polygon, polyline");
  const pathData: { el: SVGGeometryElement; len: number }[] = [];
  let totalLength = 0;

  for (const el of geometryEls) {
    const geom = el as SVGGeometryElement;
    try {
      const len = geom.getTotalLength();
      if (len > 0) {
        pathData.push({ el: geom, len });
        totalLength += len;
      }
    } catch {
      // Skip elements that don't support getTotalLength
    }
  }

  if (totalLength === 0) {
    document.body.removeChild(container);
    throw new Error(`No valid geometry paths found in ${svgUrl}`);
  }

  // Scale factor: map SVG coords to world coords, centered at origin
  const maxDim = Math.max(vbWidth, vbHeight);
  const scale = worldScale / maxDim;

  // Sample points proportionally across all paths
  const positions = new Float32Array(targetCount * 3);
  let pointIdx = 0;

  for (const { el, len } of pathData) {
    const pathPointCount = Math.max(1, Math.round((len / totalLength) * targetCount));

    for (let i = 0; i < pathPointCount && pointIdx < targetCount; i++) {
      const t = pathPointCount === 1 ? 0 : (i / (pathPointCount - 1)) * len;
      const pt = el.getPointAtLength(t);

      // Center and scale to world coordinates
      // Negate Y because SVG Y-down, Three.js Y-up
      const i3 = pointIdx * 3;
      positions[i3] = (pt.x - vbCenterX) * scale;
      positions[i3 + 1] = -(pt.y - vbCenterY) * scale;
      positions[i3 + 2] = (Math.random() - 0.5) * 0.6; // ±0.3 z-jitter for depth

      pointIdx++;
    }
  }

  document.body.removeChild(container);

  return { positions, count: pointIdx };
}
