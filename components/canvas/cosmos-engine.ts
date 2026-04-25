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

  private unsubscribeScroll: (() => void) | null = null;

  /** Public access for animation controllers (e.g. HeroSection GSAP timeline) */
  get particles(): ParticleSystem {
    return this.particleSystem;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }

  /* ---------------------------------------------------------------- */
  /*  Async initialisation                                            */
  /* ---------------------------------------------------------------- */

  async init(): Promise<void> {
    this.gpuTier = await detectGPUTier();

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

    await this.renderer.init();

    // ---- Particle System ----
    const maxParticles = this.gpuTier.maxParticles;
    this.particleSystem = new ParticleSystem(maxParticles);
    this.scene.add(this.particleSystem.group);

    // ---- Detect compute capability ----
    // Try a single compute dispatch. If it works, we use GPU compute.
    // If it throws (WebGL2 fallback), we use CPU animation.
    if (this.gpuTier.renderer === "webgpu") {
      try {
        this.renderer.compute(this.particleSystem.computeUpdate);
        this.useGPUCompute = true;
        console.log("[CosmosEngine] GPU compute available ✓");
      } catch (e) {
        this.useGPUCompute = false;
        console.log("[CosmosEngine] GPU compute failed, using CPU animation:", e);
      }
    } else {
      this.useGPUCompute = false;
      console.log("[CosmosEngine] WebGL2 mode — using CPU animation");
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

    console.log("[CosmosEngine] Initialized:", {
      gpuTier: this.gpuTier,
      initialParticles: initialCount,
      maxParticles,
      hasBloom: !!this.renderPipeline,
      useGPUCompute: this.useGPUCompute,
    });

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

  setMousePosition(clientX: number, clientY: number, influence = 1.0): void {
    if (!this.camera) return;

    const ndcX = (clientX / this.width) * 2 - 1;
    const ndcY = -(clientY / this.height) * 2 + 1;

    const fovRad = (this.camera.fov * Math.PI) / 180;
    const halfHeight = Math.tan(fovRad / 2) * this.camera.position.z;
    const halfWidth = halfHeight * this.camera.aspect;

    const worldX = ndcX * halfWidth;
    const worldY = ndcY * halfHeight;

    this.particleSystem.setMousePosition(worldX, worldY, influence);
  }

  clearMouseInfluence(): void {
    this.particleSystem.setMousePosition(0, 0, 0);
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
