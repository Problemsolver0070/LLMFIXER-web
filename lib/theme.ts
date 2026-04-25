export const COLORS = {
  cosmosVoid: "#0A0E1A",
  cosmosDeep: "#111833",
  cosmosNebula: "#1A1F4D",
  celestialWhite: "#E8ECF5",
  celestialDim: "#8B95B0",
  etherealBlue: "#4A7BF7",
  etherealGlow: "#6BB8FF",
  goldWarm: "#D4A853",
  goldBright: "#F0C45A",
} as const;

export const PARTICLE_CONFIG = {
  maxParticles: 500_000,
  mobileBaseline: 80_000,
  desktopBaseline: 200_000,
  minFps: 55,
  targetFps: 60,
  adjustmentInterval: 30,
  particleSize: 0.045,
  driftSpeed: 1.2,
} as const;

export const SCROLL_CONFIG = {
  totalSections: 8,
  smoothness: 0.1,
  lerp: 0.1,
} as const;
