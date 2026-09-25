import { clear, text, FA } from "../../rendering/Screen";

export type ConsoleMode = "off" | "standby" | "boot" | "idle" | "signal" | "decode" | "exterior" | "corrupt" | "calm" | "identity";

export interface ConsoleView {
  mode: ConsoleMode;
  /** Seconds since the mode started. */
  since: number;
  /** Decoded letters so far (investigate branch). */
  decoded: string;
  /** Current Morse gate for waveform drawing. */
  gate: number;
  /** History of gate samples for the scope. */
  scope: number[];
  bearing: number;
  distanceKm: number;
  rain: number;
  wind: number;
  choice: string | null;
  name: string;
  bootLines: string[];
}

const C = {
  bg: "#04070a",
  dim: "#3d4b57",
  ink: "#c8d6e0",
  mid: "#7f92a1",
  ok: "#86c7b9",
  warn: "#d9a441",
  bad: "#d0584a",
  sig: "#bfe9ff",
};

function frame(ctx: CanvasRenderingContext2D, w: number, h: number, title: string, right = ""): void {
  clear(ctx, w, h, C.bg);
  ctx.strokeStyle = "rgba(200,214,224,0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(10.5, 10.5, w - 21, h - 21);
  text(ctx, title, 22, 30, 13, C.mid, { spacing: 2 });
  if (right) text(ctx, right, w - 22, 30, 13, C.dim, { align: "right", spacing: 2 });
  ctx.fillStyle = "rgba(200,214,224,0.08)";
  ctx.fillRect(22, 44, w - 44, 1);
}

function grid(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, step = 24): void {
  ctx.strokeStyle = "rgba(200,214,224,0.05)";
  ctx.beginPath();
  for (let gx = x; gx <= x + w; gx += step) {
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
  }
  for (let gy = y; gy <= y + h; gy += step) {
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
  }
  ctx.stroke();
}

function glitchRows(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number): void {
  const n = Math.floor(amount * 14);
  for (let i = 0; i < n; i++) {
    const y = Math.random() * h;
    const hh = 2 + Math.random() * 18;
    const dx = (Math.random() - 0.5) * 80 * amount;
    try {
      const img = ctx.getImageData(0, y, w, hh);
      ctx.putImageData(img, dx, y);
    } catch {
      /* ignore */
    }
  }
}

export function paintCenter(v: ConsoleView) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    switch (v.mode) {
      case "off":
        clear(ctx, w, h, "#000");
        return;
      case "standby": {
        clear(ctx, w, h, "#000");
        text(ctx, "NO POWER", w / 2, h / 2 - 8, 22, C.bad, { align: "center", spacing: 6, alpha: 0.5 + 0.5 * Math.sin(t * 3) });
        text(ctx, "MAIN BUS 07 — OFFLINE", w / 2, h / 2 + 24, 12, C.dim, { align: "center", spacing: 3 });
        return;
      }
      case "boot": {
        clear(ctx, w, h, C.bg);
        const lines = v.bootLines;
        const shown = Math.min(lines.length, Math.floor(v.since * 9));
        for (let i = 0; i < shown; i++) {
          const l = lines[i];
          const col = l.endsWith("OK") ? C.ok : l.includes("FAIL") || l.includes("ERR") ? C.warn : C.mid;
          text(ctx, l, 24, 28 + i * 20 - Math.max(0, shown - 16) * 20, 13, col);
        }
        return;
      }
      case "idle":
      case "calm":
      case "identity": {
        frame(ctx, w, h, "OBS-07 / CORE", new Date(Date.now()).toISOString().slice(11, 19));
        const rows: [string, string, string][] = [
          ["POWER", "RESTORED", C.ok],
          ["SIGNAL", v.mode === "idle" ? "—" : "LOCKED", v.mode === "idle" ? C.dim : C.ok],
          ["MEMORY", v.mode === "idle" ? "NOT CHECKED" : "RESTORED", v.mode === "idle" ? C.dim : C.ok],
          ["USER", v.name ? v.name.toUpperCase() : "UNKNOWN", v.name ? C.warn : C.bad],
        ];
        rows.forEach(([k, val, col], i) => {
          text(ctx, k, 34, 84 + i * 42, 16, C.mid, { spacing: 3 });
          text(ctx, val, w - 34, 84 + i * 42, 16, col, { align: "right", spacing: 3 });
          ctx.fillStyle = "rgba(200,214,224,0.06)";
          ctx.fillRect(34, 104 + i * 42, w - 68, 1);
        });
        const pulse = (Math.sin(t * 2) * 0.5 + 0.5) * 0.6 + 0.4;
        text(ctx, "▌", 34, h - 36, 14, C.ink, { alpha: pulse });
        return;
      }
      case "signal": {
        frame(ctx, w, h, "EXTERNAL SIGNAL", "BRG " + v.bearing.toFixed(0).padStart(3, "0") + "°");
        // Polar plot with a blip.
        const cx = w / 2;
        const cy = h / 2 + 18;
        const R = Math.min(w, h) * 0.36;
        ctx.strokeStyle = "rgba(200,214,224,0.12)";
        for (let r = 1; r <= 3; r++) {
          ctx.beginPath();
          ctx.arc(cx, cy, (R * r) / 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(cx - R, cy);
        ctx.lineTo(cx + R, cy);
        ctx.moveTo(cx, cy - R);
        ctx.lineTo(cx, cy + R);
        ctx.stroke();
        const sweep = t * 1.3;
        const g = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
        if (g) {
          g.addColorStop(0, "rgba(191,233,255,0.22)");
          g.addColorStop(0.12, "rgba(191,233,255,0)");
          g.addColorStop(1, "rgba(191,233,255,0)");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, R, 0, Math.PI * 2);
          ctx.fill();
        }
        const a = ((v.bearing - 90) * Math.PI) / 180;
        const br = R * 0.78;
        const bx = cx + Math.cos(a) * br;
        const by = cy + Math.sin(a) * br;
        ctx.fillStyle = C.sig;
        ctx.globalAlpha = 0.35 + v.gate * 0.65;
        ctx.beginPath();
        ctx.arc(bx, by, 4 + v.gate * 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        text(ctx, `${v.distanceKm.toFixed(2)} KM`, 34, h - 34, 13, C.mid, { spacing: 2 });
        text(ctx, "PATTERN: UNKNOWN", w - 34, h - 34, 13, C.warn, { align: "right", spacing: 2 });
        return;
      }
      case "decode": {
        frame(ctx, w, h, "SIGNAL RECONSTRUCTION", "PASS " + (1 + Math.floor(v.since / 3)));
        // Scope trace
        const sx = 30;
        const sy = 70;
        const sw = w - 60;
        const sh = 90;
        grid(ctx, sx, sy, sw, sh, 18);
        ctx.strokeStyle = C.sig;
        ctx.lineWidth = 2;
        ctx.beginPath();
        v.scope.forEach((g, i) => {
          const x = sx + (i / (v.scope.length - 1)) * sw;
          const y = sy + sh - 14 - g * (sh - 28);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.stroke();
        ctx.lineWidth = 1;
        text(ctx, "PATTERN", 30, 188, 12, C.dim, { spacing: 3 });
        text(ctx, v.since > 2 ? "NON-RANDOM · REPEATING · 5 GROUPS" : "ANALYSING…", 150, 188, 12, v.since > 2 ? C.ok : C.mid, { spacing: 2 });
        text(ctx, "ENCODING", 30, 212, 12, C.dim, { spacing: 3 });
        text(ctx, v.since > 4 ? "ON/OFF KEYED — MORSE" : "—", 150, 212, 12, v.since > 4 ? C.ok : C.mid, { spacing: 2 });
        // Decoded letters
        const letters = ["_", "_", "_", "_", "_"];
        for (let i = 0; i < v.decoded.length; i++) letters[i] = v.decoded[i];
        const cw = 64;
        const x0 = w / 2 - (cw * 5) / 2 + cw / 2;
        letters.forEach((l, i) => {
          const known = l !== "_";
          ctx.strokeStyle = known ? "rgba(191,233,255,0.5)" : "rgba(200,214,224,0.12)";
          ctx.strokeRect(x0 + i * cw - 24.5, 244.5, 49, 58);
          text(ctx, l, x0 + i * cw, 274, 34, known ? C.sig : C.dim, { align: "center", weight: 600 });
        });
        text(ctx, "SOURCE 1.14 KM · BRG " + v.bearing.toFixed(0) + "°", w / 2, h - 32, 12, C.mid, { align: "center", spacing: 2 });
        return;
      }
      case "exterior": {
        frame(ctx, w, h, "EXTERIOR / WEATHER", "SENSOR 3");
        const items: [string, string][] = [
          ["PRECIPITATION", `${(12 + v.rain * 26).toFixed(1)} MM/H`],
          ["WIND", `${(24 + v.wind * 60).toFixed(0)} KM/H  NW`],
          ["LIGHTNING", "4.2 KM · APPROACHING"],
          ["GLASS LOAD", "WITHIN LIMITS"],
        ];
        items.forEach(([k, val], i) => {
          text(ctx, k, 34, 84 + i * 42, 15, C.mid, { spacing: 3 });
          text(ctx, val, w - 34, 84 + i * 42, 15, i === 2 ? C.warn : C.ink, { align: "right", spacing: 2 });
        });
        return;
      }
      case "corrupt": {
        clear(ctx, w, h, C.bg);
        const k = Math.min(1, v.since / 2);
        text(ctx, "MEMORY MODULE", w / 2, h / 2 - 22, 22, C.bad, { align: "center", spacing: 6 });
        text(ctx, "CORRUPTED", w / 2, h / 2 + 14, 22, C.bad, { align: "center", spacing: 8, alpha: 0.5 + 0.5 * Math.sin(t * 20) });
        for (let i = 0; i < 20 * k; i++) {
          text(ctx, Math.random().toString(16).slice(2, 10).toUpperCase(), Math.random() * w, Math.random() * h, 11, C.dim, { alpha: 0.4 });
        }
        glitchRows(ctx, w, h, k);
        return;
      }
    }
  };
}

export function paintLeft(v: ConsoleView) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    if (v.mode === "off" || v.mode === "standby") return clear(ctx, w, h, "#000");
    if (v.mode === "corrupt") {
      clear(ctx, w, h, C.bg);
      glitchRows(ctx, w, h, 1);
      text(ctx, "ERR 0x3F: SECTOR UNREADABLE", 20, h / 2, 12, C.bad, { spacing: 1 });
      return;
    }
    frame(ctx, w, h, "GRID / DISTRICT 7");
    // Blocks lighting up from centre as power propagates.
    const cols = 16;
    const rows = 8;
    const cw = (w - 44) / cols;
    const ch = (h - 80) / rows;
    const wave = v.mode === "boot" ? v.since * 3 : 99;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const d = Math.hypot(x - cols / 2, (y - rows) * 1.2);
        const on = d < wave;
        const r = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
        const fr = r - Math.floor(r);
        ctx.fillStyle = on ? (fr > 0.85 ? "rgba(217,164,65,0.55)" : `rgba(134,199,185,${0.12 + fr * 0.3})`) : "rgba(200,214,224,0.04)";
        ctx.fillRect(22 + x * cw + 2, 58 + y * ch + 2, cw - 4, ch - 4);
      }
    }
    text(ctx, v.mode === "boot" ? "RESTORING…" : "LOAD 64%", 22, h - 20, 11, C.mid, { spacing: 2 });
    void t;
  };
}

export function paintRight(v: ConsoleView) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    if (v.mode === "off" || v.mode === "standby") return clear(ctx, w, h, "#000");
    if (v.mode === "corrupt") {
      clear(ctx, w, h, C.bg);
      glitchRows(ctx, w, h, 1);
      text(ctx, "MEM ▒▒▒▒▒ 0 / 3", 20, h / 2, 14, C.bad, { spacing: 2 });
      return;
    }
    frame(ctx, w, h, v.mode === "decode" || v.mode === "signal" ? "SPECTRUM" : "EXTERIOR");
    const x0 = 22;
    const y0 = 60;
    const gw = w - 44;
    const gh = h - 100;
    grid(ctx, x0, y0, gw, gh, 22);
    ctx.strokeStyle = v.mode === "decode" || v.mode === "signal" ? C.sig : C.ok;
    ctx.beginPath();
    for (let i = 0; i <= 80; i++) {
      const x = x0 + (i / 80) * gw;
      let y: number;
      if (v.mode === "decode" || v.mode === "signal") {
        const peak = Math.exp(-Math.pow((i - 52) / 2.2, 2)) * (0.3 + v.gate * 0.7);
        y = y0 + gh - (0.08 + Math.random() * 0.06 + peak * 0.85) * gh;
      } else {
        y = y0 + gh * 0.55 + Math.sin(i * 0.3 + t * 2) * gh * 0.12 * (0.5 + v.rain) + (Math.random() - 0.5) * 6;
      }
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    text(ctx, v.mode === "decode" || v.mode === "signal" ? "1.42 GHZ · NARROW" : `RAIN ${(12 + v.rain * 26).toFixed(0)} MM/H`, x0, h - 20, 11, C.mid, { spacing: 2 });
  };
}

export interface DoorView {
  state: "locked" | "denied" | "unknown" | "scanning" | "welcome" | "open";
  name: string;
  since: number;
}

export function paintDoor(v: DoorView) {
  return (ctx: CanvasRenderingContext2D, w: number, h: number, t: number): void => {
    clear(ctx, w, h, C.bg);
    const blink = Math.sin(t * 4) > 0 ? 1 : 0.4;
    switch (v.state) {
      case "locked":
        text(ctx, "LOCKED", w / 2, h / 2 - 12, 26, C.bad, { align: "center", spacing: 5, weight: 600 });
        text(ctx, "ID REQUIRED", w / 2, h / 2 + 22, 12, C.dim, { align: "center", spacing: 3 });
        break;
      case "denied":
        text(ctx, "ACCESS", w / 2, h / 2 - 14, 22, C.bad, { align: "center", spacing: 5, alpha: blink });
        text(ctx, "DENIED", w / 2, h / 2 + 16, 22, C.bad, { align: "center", spacing: 5, alpha: blink });
        break;
      case "unknown":
        text(ctx, "UNKNOWN", w / 2, h / 2 - 14, 22, C.warn, { align: "center", spacing: 4 });
        text(ctx, "USER", w / 2, h / 2 + 16, 22, C.warn, { align: "center", spacing: 4, alpha: blink });
        break;
      case "scanning": {
        text(ctx, "VERIFYING", w / 2, h / 2 - 16, 16, C.mid, { align: "center", spacing: 4 });
        const p = Math.min(1, v.since / 1.6);
        ctx.fillStyle = "rgba(200,214,224,0.1)";
        ctx.fillRect(40, h / 2 + 12, w - 80, 4);
        ctx.fillStyle = C.warn;
        ctx.fillRect(40, h / 2 + 12, (w - 80) * p, 4);
        break;
      }
      case "welcome":
      case "open":
        text(ctx, v.state === "open" ? "OPEN" : "WELCOME", w / 2, h / 2 - 20, 16, C.ok, { align: "center", spacing: 5 });
        text(ctx, v.name, w / 2, h / 2 + 18, 30, "#f0d2a8", { align: "center", font: FA, weight: 500 });
        break;
    }
  };
}
