export type QualityLevel = "low" | "medium" | "high";

export interface QualityProfile {
  level: QualityLevel;
  maxDpr: number;
  minDpr: number;
  rainCount: number;
  buildingCount: number;
  trafficCount: number;
  shadows: boolean;
  shadowMapSize: number;
  glassRefraction: boolean;
  bloom: boolean;
  bloomResolution: number;
  smaa: boolean;
  cloudOctaves: number;
  memoryParticles: number;
  grain: boolean;
}

export const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: {
    level: "low",
    maxDpr: 1.0,
    minDpr: 0.6,
    rainCount: 1600,
    buildingCount: 900,
    trafficCount: 360,
    shadows: false,
    shadowMapSize: 512,
    glassRefraction: false,
    bloom: true,
    bloomResolution: 0.25,
    smaa: false,
    cloudOctaves: 2,
    memoryParticles: 500,
    grain: true,
  },
  medium: {
    level: "medium",
    maxDpr: 1.35,
    minDpr: 0.75,
    rainCount: 3600,
    buildingCount: 1500,
    trafficCount: 700,
    shadows: true,
    shadowMapSize: 1024,
    glassRefraction: true,
    bloom: true,
    bloomResolution: 0.35,
    smaa: false,
    cloudOctaves: 3,
    memoryParticles: 1100,
    grain: true,
  },
  high: {
    level: "high",
    maxDpr: 1.75,
    minDpr: 1.0,
    rainCount: 7000,
    buildingCount: 2300,
    trafficCount: 1300,
    shadows: true,
    shadowMapSize: 2048,
    glassRefraction: true,
    bloom: true,
    bloomResolution: 0.5,
    smaa: true,
    cloudOctaves: 4,
    memoryParticles: 2000,
    grain: true,
  },
};

const KEY = "unknown-system:quality";

export function isMobileDevice(): boolean {
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (touch && /Macintosh/.test(ua));
}

/** Pick an initial level from device class + backend. Manual overrides win. */
export function detectQuality(isWebGPU: boolean): QualityLevel {
  const url = new URLSearchParams(location.search).get("quality");
  if (url === "low" || url === "medium" || url === "high") return url;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === "low" || stored === "medium" || stored === "high") return stored;
  } catch {
    /* ignore */
  }
  const cores = navigator.hardwareConcurrency || 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  if (isMobileDevice()) {
    if (isWebGPU && cores >= 6 && memory >= 4) return "medium";
    return "low";
  }
  if (!isWebGPU && (cores <= 4 || memory <= 4)) return "medium";
  return cores >= 8 ? "high" : "medium";
}

export function storeQuality(level: QualityLevel | null): void {
  try {
    if (level) localStorage.setItem(KEY, level);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
