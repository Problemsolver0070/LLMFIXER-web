/**
 * Cosmos palette — tuned for emergent-light realism.
 *
 * Principles:
 *  - The void is deep, slightly purple-leaning, never pure black.
 *  - Stellar warmth is *cream*, not saturated gold (real starlight is closer to
 *    #FFEDC2 / #F0E0BC than to yellow-gold).
 *  - Blue is softened toward cyan to read as "ionized hydrogen" rather than
 *    designer ethereal blue.
 *  - Celestial whites carry a slight warm tint so they feel like stellar
 *    light, not screen white.
 */
export const COLORS = {
  // Background void
  cosmosVoid:      "#0A0E1A",
  cosmosDeep:      "#111833",
  cosmosNebula:    "#1A1F4D",

  // Stellar light
  celestialWhite:  "#FFF5E1",   // warm white starlight (was #E8ECF5 neutral)
  celestialDim:   "#9CA3B8",    // slight cream-gray dim

  // Cool emission (ionized hydrogen, scattered blue)
  etherealBlue:    "#6E9AD8",   // softer than the prior #4A7BF7 — less designer-blue, more ionized
  etherealGlow:    "#9FCBF5",   // cyan-leaning glow (was #6BB8FF)

  // Warm emission (de-saturated stellar warmth — cream, not gold)
  goldWarm:        "#C8B89A",   // soft tan (was #D4A853 saturated gold)
  goldBright:      "#F0E0BC",   // cream-gold (was #F0C45A saturated gold)

  // JWST-flavored emission accents — used by per-particle variation in #23
  hAlpha:          "#C84B5F",   // H-alpha emission (deep magenta-red)
  oxygenTeal:      "#4FCFC0",   // [OIII] emission (teal-cyan)
} as const;

export const PARTICLE_CONFIG = {
  maxParticles: 500_000,
  // Counts further reduced because each particle is now ~2.2× larger on
  // screen (particleSize bumped 0.045 → 0.10) so the per-atom procedural
  // glow + halo + spikes have room to render properly. Larger atoms +
  // fewer of them = ASMR feel; smaller + more of them = dirt feel.
  mobileBaseline: 24_000,
  desktopBaseline: 60_000,
  minFps: 55,
  targetFps: 60,
  adjustmentInterval: 30,
  // Base particle size in world units. At z=30 camera distance + 60° FOV,
  // 0.10 world units ≈ 5 screen pixels at typical 800-1000px viewport.
  // That's the floor where a soft-edged halo + bright core + diffraction
  // spikes are actually distinguishable per-particle.
  particleSize: 0.10,
  driftSpeed: 1.2,
} as const;

export const SCROLL_CONFIG = {
  totalSections: 8,
  smoothness: 0.1,
  lerp: 0.1,
} as const;
