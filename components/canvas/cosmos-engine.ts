/**
 * CosmosEngine — orchestrates the Three.js WebGPU rendering pipeline.
 *
 * Creates scene, camera, renderer, post-processing with bloom,
 * particle system, performance monitor. Drives the animation loop.
 *
 * Supports two modes:
 * - WebGPU: GPU compute shaders drive particle physics
 * - WebGL2 fallback: CPU animation drives particle physics
 */
import {
  Scene,
  PerspectiveCamera,
  WebGPURenderer,
  RenderPipeline,
  Color,
  ACESFilmicToneMapping,
} from "three/webgpu";

import { pass } from "three/tsl";
import { bloom } from "three/addons/tsl/display/BloomNode.js";

import { COLORS, PARTICLE_CONFIG } from "@/lib/theme";
import { onScrollUpdate } from "@/lib/scroll-state";
import { detectGPUTier, type GPUTier } from "@/components/canvas/webgpu-utils";
import {
  PerformanceMonitor,
  type PerformanceMonitorConfig,
} from "@/components/canvas/performance-monitor";

import { ParticleSystem } from "./particle-system";
import { createStarSky } from "./background-layers";

/* ------------------------------------------------------------------ */
/*  Engine                                                            */
/* ------------------------------------------------------------------ */

export class CosmosEngine {
  private renderer!: WebGPURenderer;
  private scene!: Scene;
  private camera!: PerspectiveCamera;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private renderPipeline!: any;
  private particleSystem!: ParticleSystem;
  private performanceMonitor!: PerformanceMonitor;
  private gpuTier!: GPUTier;

  private canvas: HTMLCanvasElement;
  private width = 0;
  private height = 0;
  private animationId = 0;
  private running = false;
  private startTime = 0;
  private lastTime = 0;
  private disposed = false;

  /** Whether GPU compute is available (WebGPU) or we use CPU fallback */
  private useGPUCompute = false;
  private _hasBloom = false;

  /** Camera handheld drift state — gives the "I'm inside this" feel */
  private _cameraBaseZ = 30;
  private _reducedMotion = false;

  /** Tilt parallax offset (mechanic 4) — gyro feeds normalized -1..1, scaled
   *  into camera offset units in tick(). Separate from cursor influence so
   *  device tilt doesn't conflate with pointer position. */
  private _tiltOffsetX = 0;
  private _tiltOffsetY = 0;
  /** Multiplier for tilt → camera offset (world units). 1.5 picked so a 45°
   *  device tilt parallaxes the foreground by ±1.5 units while the static
   *  star sky at z=-50..-80 visibly shifts more. */
  private static readonly TILT_OFFSET_MAGNITUDE = 1.5;

  /** Stillness-reward state (mechanic 3) — track last interaction wallclock
   *  in ms. Idle ramp begins after IDLE_THRESHOLD seconds, fully ramps over
   *  IDLE_RAMP_SECONDS. */
  private _lastInteractionMs = 0;
  private _idleRamp = 0; // 0..1, smoothed every tick
  private static readonly IDLE_THRESHOLD_SEC = 5.0;
  private static readonly IDLE_RAMP_SEC = 2.0;
  /** Default drift speed snapshot — restored when user returns to interacting. */
  private _baseDriftSpeed: number = PARTICLE_CONFIG.driftSpeed;
  /** Idle peak: drift speed boost (50% above default), and soft logo glow. */
  private static readonly IDLE_DRIFT_PEAK = PARTICLE_CONFIG.driftSpeed * 1.5;
  private static readonly IDLE_GLOW_PEAK = 0.25;

  /** Latest cursor in client-space, kept so we can re-project to world coords
   *  on every tick (camera drifts, so the projection drifts with it). */
  private _lastClientX = -9999;
  private _lastClientY = -9999;
  private _hasPointerInput = false;

  private unsubscribeScroll: (() => void) | null = null;

  /** Public access for animation controllers (e.g. HeroSection GSAP timeline) */
  get particles(): ParticleSystem {
    return this.particleSystem;
  }

  /**
   * Public access for components that need to project screen-space rects
   * into world space (e.g. SiteSections coalescence projects each <h2>'s
   * bounding rect onto the z=0 plane). Read-only — do not mutate.
   */
  get cameraRef(): PerspectiveCamera {
    return this.camera;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /* ---------------------------------------------------------------- */
  /*  Async initialisation                                            */
  /* ---------------------------------------------------------------- */

  async init(): Promise<void> {
    this.gpuTier = await detectGPUTier();

    // Capture motion preference once — gates camera drift, pulse animations.
    this._reducedMotion = typeof window !== "undefined"
      && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

    // ---- Scene ----
    this.scene = new Scene();
    this.scene.background = new Color(COLORS.cosmosVoid);

    // ---- Camera ----
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.camera = new PerspectiveCamera(
      60,
      this.width / this.height,
      0.1,
      100,
    );
    this.camera.position.set(0, 0, 30);
    this.camera.lookAt(0, 0, 0);

    // ---- Renderer ----
    this.renderer = new WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      forceWebGL: this.gpuTier.renderer === "webgl2",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.width, this.height);

    // HDR + ACES filmic tone mapping. Bright cluster centers + supernovae
    // can now exceed nominal max-white and roll off cinematically through
    // the ACES curve instead of clipping flat. Exposure tuned slightly above
    // 1.0 for confident-bright cosmos without crushing highlights.
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    await this.renderer.init();

    // ---- Background star sky ----
    // Far-distance static stars give the active field depth parallax when
    // the camera drifts. The nebula billboards experiment was removed —
    // 5 fixed colored sprites read as "lamps in space," not as atmosphere.
    // Atmospheric depth is being deferred to a noise-based approach later.
    const skyDensity = this.gpuTier.tier === "high" ? 5000
                     : this.gpuTier.tier === "medium" ? 3000
                     : 1500;
    this.scene.add(createStarSky(skyDensity));

    // ---- Active particle system ----
    const maxParticles = this.gpuTier.maxParticles;
    this.particleSystem = new ParticleSystem(maxParticles);
    this.scene.add(this.particleSystem.group);

    // ---- Detect compute capability ----
    // Try a single compute dispatch on every backend. Three.js TSL transparently
    // emulates compute on WebGL2 via fragment-shader render-to-texture when the
    // backend is WebGL2. If it throws (truly ancient device), we fall back to
    // the CPU animate path as last resort.
    try {
      this.renderer.compute(this.particleSystem.computeUpdate);
      this.useGPUCompute = true;
      console.log(`[CosmosEngine] GPU compute available ✓  backend=${this.gpuTier.renderer}`);
    } catch (e) {
      this.useGPUCompute = false;
      console.warn(`[CosmosEngine] GPU compute unavailable on ${this.gpuTier.renderer}, falling back to CPU:`, e);
    }

    // ---- Set initial particle count ----
    // CPU fallback: cap at 30K — curl noise on main thread can't sustain more at 60fps.
    // GPU compute: use full tier-based budget.
    const CPU_FALLBACK_CAP = 30_000;
    const tierCount = this.gpuTier.tier === "high"
      ? PARTICLE_CONFIG.desktopBaseline
      : this.gpuTier.tier === "medium"
        ? Math.min(PARTICLE_CONFIG.desktopBaseline, this.gpuTier.maxParticles)
        : Math.min(PARTICLE_CONFIG.mobileBaseline, this.gpuTier.maxParticles);
    const initialCount = this.useGPUCompute ? tierCount : Math.min(CPU_FALLBACK_CAP, tierCount);
    this.particleSystem.setParticleCount(initialCount);

    // ---- Render Pipeline with Bloom ----
    this.setupRenderPipeline();

    this._hasBloom = !!this.renderPipeline;
    if (!this._hasBloom) {
      this.particleSystem.setNoBloom();
    }

    console.log(
      `[CosmosEngine] Init: tier=${this.gpuTier.tier} backend=${this.gpuTier.renderer} ` +
      `particles=${initialCount}/${maxParticles} bloom=${!!this.renderPipeline} ` +
      `compute=${this.useGPUCompute}`,
    );

    // ---- Performance Monitor ----
    const perfConfig: PerformanceMonitorConfig = this.useGPUCompute
      ? {
          targetFps: PARTICLE_CONFIG.targetFps,
          minFps: PARTICLE_CONFIG.minFps,
          adjustmentInterval: PARTICLE_CONFIG.adjustmentInterval,
          initialParticles: initialCount,
          minParticles: 10_000,
          maxParticles: maxParticles,
          stepSize: Math.floor(maxParticles * 0.05),
        }
      : {
          // CPU fallback: tight bounds around the 30K working set
          targetFps: PARTICLE_CONFIG.targetFps,
          minFps: PARTICLE_CONFIG.minFps,
          adjustmentInterval: PARTICLE_CONFIG.adjustmentInterval,
          initialParticles: initialCount,
          minParticles: CPU_FALLBACK_CAP,    // never drop below 30K — text needs 28.5K
          maxParticles: Math.min(50_000, maxParticles), // ceiling for CPU
          stepSize: 2_500,
        };
    this.performanceMonitor = new PerformanceMonitor(perfConfig);

    // ---- Scroll subscription ----
    this.unsubscribeScroll = onScrollUpdate((progress) => {
      this.particleSystem.setScrollProgress(progress);
    });

    // ---- Time-of-day palette shift (mechanic 6) ----
    // Read local hour ONCE at init — perceptual nudge, not a live clock.
    // Mapping (24h):
    //   06–10  dawn    → moderate warm (cream)
    //   10–17  midday  → near-zero (default palette)
    //   17–21  evening → strong warm (cream)
    //   21–06  night   → strong cool (saturated blue) + moderate purple
    const hour = new Date().getHours();
    let warm = 0, cool = 0, purple = 0;
    if (hour >= 6 && hour < 10)        { warm = 0.55; }            // dawn
    else if (hour >= 10 && hour < 17)  { warm = 0.0; cool = 0.0; } // midday — default
    else if (hour >= 17 && hour < 21)  { warm = 0.85; }            // evening
    else                               { cool = 0.85; purple = 0.45; } // night
    this.particleSystem.setTimeOfDay(warm, cool, purple);

    // ---- Initialize last-interaction wallclock so idle reward (mechanic 3)
    // starts counting from init, not from epoch 0. Snapshot baseline drift
    // for symmetric ease-back when the user returns from idle.
    this._lastInteractionMs = performance.now();
    this._baseDriftSpeed = PARTICLE_CONFIG.driftSpeed;
  }

  /* ---------------------------------------------------------------- */
  /*  Render pipeline (bloom post-processing)                         */
  /* ---------------------------------------------------------------- */

  private setupRenderPipeline(): void {
    try {
      const scenePass = pass(this.scene, this.camera);
      const bloomPass = bloom(scenePass, 0.25, 0.3, 0.1);
      const outputNode = scenePass.add(bloomPass);

      this.renderPipeline = new RenderPipeline(this.renderer, outputNode);
    } catch (e) {
      console.warn(
        "[CosmosEngine] RenderPipeline/Bloom failed, using direct rendering:",
        e,
      );
      this.renderPipeline = null;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Animation loop                                                  */
  /* ---------------------------------------------------------------- */

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startTime = performance.now() / 1000;
    this.lastTime = this.startTime;
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = 0;
    }
  }

  private tick = (): void => {
    if (!this.running || this.disposed) return;

    const now = performance.now();
    const time = now / 1000 - this.startTime;
    const deltaTime = Math.min(time - (this.lastTime - this.startTime), 0.05);
    this.lastTime = now / 1000;

    // ---- Performance monitoring & adaptive quality ----
    this.performanceMonitor.recordFrame(now);
    const targetCount = this.performanceMonitor.getParticleCount();
    if (targetCount !== this.particleSystem.getParticleCount()) {
      this.particleSystem.setParticleCount(targetCount);
    }

    // ---- Update uniforms ----
    this.particleSystem.update(time, deltaTime);

    // ---- Stillness reward (mechanic 3) ----
    // Compute idle target (0 active, 1 fully idle), then ease toward it with
    // a smoothing factor derived from deltaTime. The 2-second ramp is achieved
    // by approximating exp(-dt/τ) where τ = IDLE_RAMP_SEC/3 (≈3τ ≈ 95% there).
    const idleSeconds = (now - this._lastInteractionMs) / 1000;
    const idleTarget = idleSeconds > CosmosEngine.IDLE_THRESHOLD_SEC ? 1 : 0;
    // Smoothing constant tuned so transitions complete in ~IDLE_RAMP_SEC
    const idleSmoothing = 1 - Math.exp(-deltaTime / (CosmosEngine.IDLE_RAMP_SEC / 3));
    this._idleRamp += (idleTarget - this._idleRamp) * idleSmoothing;

    // Apply ramped drift speed (skip under reduced-motion: spec says only the
    // soft glow should run when motion is reduced).
    if (!this._reducedMotion) {
      const driftSpeed =
        this._baseDriftSpeed
        + (CosmosEngine.IDLE_DRIFT_PEAK - this._baseDriftSpeed) * this._idleRamp;
      this.particleSystem.setDriftSpeed(driftSpeed);
    }

    // Compose the final logoGlow uniform from three sources:
    //   - external (GSAP timelines: HeroSection genesis pulse, ambient pulses,
    //     SiteSections coalescence) — read via getExternalLogoGlow()
    //   - idle (mechanic 3, soft "distant structures assemble" glow)
    //   - nova (mechanic 5, click/tap flare)
    // We take max() so the strongest source wins; this preserves the genesis
    // sequence's full ignition pulse (1.0) without idle/nova diluting it, and
    // also lets a nova override a quiescent baseline. We write the composed
    // value via applyComposedLogoGlow which doesn't touch the external field
    // — preserves whatever GSAP last set as source-of-truth.
    const externalGlow = this.particleSystem.getExternalLogoGlow();
    const idleGlow = CosmosEngine.IDLE_GLOW_PEAK * this._idleRamp;
    const novaGlow = this.particleSystem.getNovaGlow();
    this.particleSystem.applyComposedLogoGlow(
      Math.max(externalGlow, idleGlow, novaGlow),
    );

    // ---- Camera handheld drift + tilt parallax (mechanic 4) ----
    // Two layered low-frequency oscillators per axis create breathing,
    // non-repeating motion that sells "I'm inside this" without inducing
    // motion sickness. Skipped under prefers-reduced-motion.
    // Tilt offset (from gyro) is added on top so the camera parallaxes with
    // device orientation. The static star sky at z=-50..-80 visibly shifts
    // more than the active particles at z≈0 thanks to perspective projection.
    let driftX = 0, driftY = 0, driftZ = 0;
    if (!this._reducedMotion) {
      const t = time;
      const ampXY = 0.45;
      const ampZ = 0.30;
      driftX = (Math.sin(t * 0.13) * 0.7 + Math.sin(t * 0.31) * 0.3) * ampXY;
      driftY = (Math.cos(t * 0.11) * 0.7 + Math.sin(t * 0.27) * 0.3) * ampXY * 0.8;
      driftZ = (Math.cos(t * 0.09) * 0.6 + Math.sin(t * 0.21) * 0.4) * ampZ;
    }
    const tiltX = this._tiltOffsetX * CosmosEngine.TILT_OFFSET_MAGNITUDE;
    const tiltY = this._tiltOffsetY * CosmosEngine.TILT_OFFSET_MAGNITUDE;
    this.camera.position.set(
      driftX + tiltX,
      driftY + tiltY,
      this._cameraBaseZ + driftZ,
    );
    this.camera.lookAt(0, 0, 0);

    // ---- Pointer halo re-projection (mechanic 2) + nova flare (mechanic 5)
    // Project the last cursor position into world space every tick. We must
    // re-project because the camera drifts; the halo would slide off the
    // particles otherwise.
    //
    // While a nova flare is active (just after a click/tap), anchor the halo
    // at the click point — it fades back to the cursor's position once the
    // nova decays to 0 (≈1s). The cursor itself doesn't move during this
    // window in any meaningful way; the flare just visibly takes over.
    const nova = this.particleSystem.getNovaHalo();
    if (nova.strength > 0) {
      this.particleSystem.setPointerWorldPosition(nova.x, nova.y, nova.strength);
    } else if (this._hasPointerInput) {
      const projected = this.projectClientToWorld(this._lastClientX, this._lastClientY);
      this.particleSystem.setPointerWorldPosition(projected.x, projected.y, 1.0);
    } else {
      // No cursor, no nova — make sure halo is fully off.
      this.particleSystem.setPointerWorldPosition(0, 0, 0);
    }

    // ---- Animate particles (GPU compute or CPU fallback) ----
    if (this.useGPUCompute) {
      this.renderer.compute(this.particleSystem.computeUpdate);
    } else {
      this.particleSystem.cpuAnimate(time, deltaTime);
    }

    // ---- Render ----
    if (this.renderPipeline) {
      try {
        this.renderPipeline.render();
      } catch {
        this.renderPipeline = null;
        if (this._hasBloom) {
          this._hasBloom = false;
          this.particleSystem.setNoBloom();
        }
        this.renderer.render(this.scene, this.camera);
      }
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.animationId = requestAnimationFrame(this.tick);
  };

  /* ---------------------------------------------------------------- */
  /*  Mouse interaction                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Project a client-space (clientX, clientY) onto the z=0 world plane,
   * accounting for the current camera position. Used both for the curl-noise
   * mouse force and the pointer-halo position (mechanic 2).
   */
  private projectClientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const ndcX = (clientX / this.width) * 2 - 1;
    const ndcY = -(clientY / this.height) * 2 + 1;

    const fovRad = (this.camera.fov * Math.PI) / 180;
    // Distance from camera to z=0 plane (camera looks at origin, so this is
    // just the camera's z position; z drifts ±0.3 with handheld breathing).
    const halfHeight = Math.tan(fovRad / 2) * this.camera.position.z;
    const halfWidth = halfHeight * this.camera.aspect;

    return { x: ndcX * halfWidth, y: ndcY * halfHeight };
  }

  setMousePosition(clientX: number, clientY: number, influence = 1.0): void {
    if (!this.camera) return;

    // Track latest client coords for tick-time re-projection (camera drifts).
    this._lastClientX = clientX;
    this._lastClientY = clientY;
    this._hasPointerInput = true;

    const projected = this.projectClientToWorld(clientX, clientY);
    this.particleSystem.setMousePosition(projected.x, projected.y, influence);
    // Mechanic 2 (pointer halo) is updated by the engine tick — it handles
    // camera-drift re-projection plus nova-flare composition. We only flag
    // _hasPointerInput here so the tick knows there's an active cursor.
  }

  clearMouseInfluence(): void {
    this._hasPointerInput = false;
    this.particleSystem.setMousePosition(0, 0, 0);
    // Halo is faded by the tick loop on the next frame (no nova → no
    // pointer → set strength to 0).
  }

  /**
   * Tilt parallax (mechanic 4). xNorm/yNorm are -1..1, typically derived from
   * device orientation gamma/beta. Stored and applied in tick() on top of the
   * existing handheld camera drift.
   */
  setTiltOffset(xNorm: number, yNorm: number): void {
    this._tiltOffsetX = Math.max(-1, Math.min(1, xNorm));
    this._tiltOffsetY = Math.max(-1, Math.min(1, yNorm));
  }

  /**
   * Stillness-reward bookkeeping (mechanic 3). The CosmosCanvas DOM event
   * handlers should call this on mouse move / touch / gyro events; the tick
   * loop reads the timestamp to determine idle duration.
   */
  notifyInteraction(): void {
    this._lastInteractionMs = performance.now();
  }

  /**
   * Trigger a tap/click "nova" pulse (mechanic 5). Forwards to
   * particleSystem.triggerNova with the engine's reduced-motion preference.
   * The (clientX, clientY) is projected to world coordinates so the halo
   * flare lands at the click point, not the world origin.
   */
  triggerNova(clientX: number, clientY: number): void {
    if (!this.camera || !this.particleSystem) return;
    const projected = this.projectClientToWorld(clientX, clientY);
    this.particleSystem.triggerNova(projected.x, projected.y, this._reducedMotion);
  }

  /* ---------------------------------------------------------------- */
  /*  Resize                                                          */
  /* ---------------------------------------------------------------- */

  handleResize(): void {
    if (this.disposed) return;

    this.width = window.innerWidth;
    this.height = window.innerHeight;

    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(this.width, this.height);

    if (this.renderPipeline) {
      this.renderPipeline.needsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Stats                                                           */
  /* ---------------------------------------------------------------- */

  getStats(): {
    fps: number;
    particleCount: number;
    gpuTier: string;
    renderer: string;
  } {
    return {
      fps: Math.round(this.performanceMonitor?.getCurrentFps() ?? 0),
      particleCount: this.particleSystem?.getParticleCount() ?? 0,
      gpuTier: this.gpuTier?.tier ?? "unknown",
      renderer: this.gpuTier?.renderer ?? "unknown",
    };
  }

  /* ---------------------------------------------------------------- */
  /*  Cleanup                                                         */
  /* ---------------------------------------------------------------- */

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.stop();
    this.unsubscribeScroll?.();

    this.particleSystem?.dispose();
    this.renderPipeline?.dispose?.();
    this.renderer?.dispose();
  }
}
