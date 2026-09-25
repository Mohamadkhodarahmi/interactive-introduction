/**
 * Adaptive device-pixel-ratio controller.
 * Samples frame time over 1 s windows. Two slow windows in a row step the DPR down;
 * five comfortable windows step it back up (hysteresis prevents oscillation).
 */
export class AdaptiveDpr {
  private frames = 0;
  private acc = 0;
  private slow = 0;
  private fast = 0;
  current: number;
  fps = 60;
  enabled = true;
  /** Skip sampling for a while after scene switches / shader compiles. */
  private graceUntil = 0;

  constructor(
    private min: number,
    private max: number,
    private apply: (dpr: number) => void,
    private targetFps = 50,
  ) {
    this.current = Math.min(max, window.devicePixelRatio || 1);
  }

  setRange(min: number, max: number): void {
    this.min = min;
    this.max = max;
    this.current = Math.min(max, window.devicePixelRatio || 1);
    this.apply(this.current);
    this.grace(1500);
  }

  grace(ms: number): void {
    this.graceUntil = performance.now() + ms;
    this.frames = 0;
    this.acc = 0;
  }

  tick(dtSeconds: number): void {
    if (performance.now() < this.graceUntil) return;
    // Ignore hitches from tab switches.
    if (dtSeconds > 0.25) return;
    this.frames++;
    this.acc += dtSeconds;
    if (this.acc < 1) return;
    this.fps = this.frames / this.acc;
    this.frames = 0;
    this.acc = 0;
    if (!this.enabled) return;

    const ceiling = Math.min(this.max, window.devicePixelRatio || 1);
    if (this.fps < this.targetFps) {
      this.slow++;
      this.fast = 0;
      if (this.slow >= 2 && this.current > this.min + 0.01) {
        this.current = Math.max(this.min, this.current - 0.15);
        this.slow = 0;
        this.apply(this.current);
      }
    } else if (this.fps > 58) {
      this.fast++;
      this.slow = 0;
      if (this.fast >= 5 && this.current < ceiling - 0.01) {
        this.current = Math.min(ceiling, this.current + 0.1);
        this.fast = 0;
        this.apply(this.current);
      }
    } else {
      this.slow = 0;
      this.fast = 0;
    }
  }
}
