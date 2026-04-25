export interface PerformanceMonitorConfig {
  targetFps: number;
  minFps: number;
  adjustmentInterval: number;
  initialParticles: number;
  minParticles: number;
  maxParticles: number;
  stepSize: number;
}

export class PerformanceMonitor {
  private config: PerformanceMonitorConfig;
  private particleCount: number;
  private frameTimes: number[] = [];
  private frameCount = 0;
  private consecutiveGoodIntervals = 0;

  constructor(config: PerformanceMonitorConfig) {
    this.config = config;
    this.particleCount = config.initialParticles;
  }

  recordFrame(timestamp: number): void {
    this.frameTimes.push(timestamp);
    this.frameCount++;

    if (this.frameCount >= this.config.adjustmentInterval) {
      this.evaluate();
      this.frameCount = 0;
    }
  }

  private evaluate(): void {
    const fps = this.calculateFps();
    if (fps <= 0) return;

    if (fps < this.config.minFps) {
      this.particleCount = Math.max(
        this.config.minParticles,
        this.particleCount - this.config.stepSize
      );
      this.consecutiveGoodIntervals = 0;
    } else if (fps >= this.config.targetFps) {
      this.consecutiveGoodIntervals++;
      if (this.consecutiveGoodIntervals >= 3) {
        this.particleCount = Math.min(
          this.config.maxParticles,
          this.particleCount + this.config.stepSize
        );
        this.consecutiveGoodIntervals = 0;
      }
    } else {
      this.consecutiveGoodIntervals = 0;
    }
  }

  private calculateFps(): number {
    if (this.frameTimes.length < 2) return 0;

    const recent = this.frameTimes.slice(-this.config.adjustmentInterval);
    if (recent.length < 2) return 0;

    const totalTime = recent[recent.length - 1] - recent[0];
    if (totalTime <= 0) return 0;

    const fps = ((recent.length - 1) / totalTime) * 1000;

    if (this.frameTimes.length > this.config.adjustmentInterval * 2) {
      this.frameTimes = this.frameTimes.slice(-this.config.adjustmentInterval);
    }

    return fps;
  }

  getCurrentFps(): number {
    return this.calculateFps();
  }

  getParticleCount(): number {
    return this.particleCount;
  }

  reset(particleCount?: number): void {
    this.particleCount = particleCount ?? this.config.initialParticles;
    this.frameTimes = [];
    this.frameCount = 0;
    this.consecutiveGoodIntervals = 0;
  }
}
