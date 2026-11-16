export const BAY = 4.4;
export const TQ = { finish: 1, win: 1, sign: 0.5, mark: 0.3 };
let MASK = null, wantMask = false;
function canvasTexture(width, height, scale, draw, repeat = true) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const c = canvas.getContext("2d", { willReadFrequently: true });
  c.scale(scale, scale);
  if (wantMask) {
    const m = document.createElement("canvas");
    m.width = canvas.width;
    m.height = canvas.height;
    MASK = m.getContext("2d", { willReadFrequently: true });
    MASK.scale(scale, scale);
    MASK.fillStyle = "#fff";
    canvas.glassMask = m;
  }
  draw(c);
  MASK = null;
  return canvas;
}
const rng = (seed2) => {
  let r = seed2 >>> 0;
  return () => (r = Math.imul(r, 1664525) + 1013904223 >>> 0) / 4294967296;
};
function grain(c, w, h, seed2, count, alpha = 0.05) {
  const rand = rng(seed2);
  for (let i = 0; i < count; i++) {
    const v = Math.floor(120 + rand() * 120);
    c.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    c.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}
function streaks(c, x0, y0, w, h, seed2, n, alpha = 0.08) {
  const rand = rng(seed2);
  for (let i = 0; i < n; i++) {
    const x = x0 + rand() * w, y = y0 + rand() * h * 0.5, ww = 4 + rand() * 24, hh = 30 + rand() * h * 0.6, g = c.createLinearGradient(0, y, 0, y + hh);
    g.addColorStop(0, `rgba(70,66,58,${alpha})`);
    g.addColorStop(1, "rgba(70,66,58,0)");
    c.fillStyle = g;
    c.fillRect(x, y, ww, hh);
  }
}
const FINISHES = ["mosaic", "brick", "stucco", "stone", "redbrick", "weathered", "wood"];
function finishTexture(kind, seed2) {
  return canvasTexture(256, 256, TQ.finish, (c) => {
    const rand = rng(seed2);
    c.fillStyle = "#f3f1ec";
    c.fillRect(0, 0, 256, 256);
    if (kind === "mosaic") {
      grain(c, 256, 256, seed2, 2e3, 0.035);
      c.fillStyle = "rgba(0,0,0,.022)";
      for (let x = 0; x < 256; x += 4) c.fillRect(x, 0, 1, 256);
      for (let y = 0; y < 256; y += 4) c.fillRect(0, y, 256, 1);
    }
    if (kind === "brick") {
      for (let y = 0, row = 0; y < 256; y += 4, row++) for (let x = -(row % 2) * 8; x < 256; x += 16) {
        const t = rand() * 0.08 - 0.04;
        c.fillStyle = t > 0 ? `rgba(255,255,255,${t})` : `rgba(60,50,40,${-t})`;
        c.fillRect(x, y, 15, 3);
      }
      c.fillStyle = "rgba(60,50,40,.08)";
      for (let y = 3; y < 256; y += 4) c.fillRect(0, y, 256, 1);
    }
    if (kind === "stucco") {
      grain(c, 256, 256, seed2, 4e3, 0.05);
      for (let i = 0; i < 8; i++) {
        const x = rand() * 256, y = rand() * 256, r = 30 + rand() * 80, g = c.createRadialGradient(x, y, 0, x, y, r), dark = rand() < 0.5;
        g.addColorStop(0, `rgba(${dark ? "60,56,50" : "255,255,255"},${0.03 + rand() * 0.02})`);
        g.addColorStop(1, `rgba(${dark ? "60,56,50" : "255,255,255"},0)`);
        c.fillStyle = g;
        c.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
    }
    if (kind === "stone") {
      for (let y = 0; y < 256; y += 64) for (let x = 0; x < 256; x += 64) {
        const t = rand() * 0.1 - 0.05;
        c.fillStyle = t > 0 ? `rgba(255,255,255,${t})` : `rgba(40,38,34,${-t})`;
        c.fillRect(x, y, 64, 64);
      }
      grain(c, 256, 256, seed2, 1500, 0.04);
      c.fillStyle = "rgba(40,38,34,.16)";
      for (let k = 0; k < 256; k += 64) {
        c.fillRect(k, 0, 2, 256);
        c.fillRect(0, k, 256, 2);
      }
    }
    if (kind === "redbrick") {
      c.fillStyle = "#cdc6b9";
      c.fillRect(0, 0, 256, 256);
      const tones = ["#a4523a", "#ad5a40", "#9a4a34", "#b56448", "#8f4630", "#a85e46"];
      for (let y = 0, row = 0; y < 256; y += 4, row++) for (let x = -(row % 2) * 7; x < 256; x += 14) {
        c.fillStyle = tones[Math.floor(rand() * tones.length)];
        c.fillRect(x + 1, y + 1, 13, 3);
      }
      grain(c, 256, 256, seed2, 1500, 0.05);
    }
    if (kind === "weathered") {
      grain(c, 256, 256, seed2, 5e3, 0.06);
      for (let i = 0; i < 14; i++) {
        const x = rand() * 256, y = rand() * 256, r = 20 + rand() * 70, g2 = c.createRadialGradient(x, y, 0, x, y, r), moss = rand() < 0.45;
        g2.addColorStop(0, moss ? "rgba(76,94,56,.2)" : "rgba(58,54,48,.14)");
        g2.addColorStop(1, "rgba(58,54,48,0)");
        c.fillStyle = g2;
        c.fillRect(x - r, y - r, 2 * r, 2 * r);
      }
      streaks(c, 0, 0, 256, 256, seed2 + 5, 18, 0.24);
      const g = c.createLinearGradient(0, 0, 0, 40);
      g.addColorStop(0, "rgba(50,46,40,.22)");
      g.addColorStop(1, "rgba(50,46,40,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 256, 40);
    }
    if (kind === "wood") {
      c.fillStyle = "#5a4535";
      c.fillRect(0, 0, 256, 256);
      for (let k = 0; k < 24; k++) {
        const y = k * 256 / 24, t = rand() * 0.12 - 0.06;
        c.fillStyle = t > 0 ? `rgba(255,235,210,${t})` : `rgba(20,12,6,${-t})`;
        c.fillRect(0, y, 256, 256 / 24);
        c.fillStyle = "rgba(20,12,6,.45)";
        c.fillRect(0, y + 256 / 24 - 2, 256, 2);
        c.fillStyle = "rgba(255,240,220,.08)";
        c.fillRect(0, y, 256, 1);
      }
      for (let i = 0; i < 300; i++) {
        c.fillStyle = `rgba(30,20,10,${0.04 + rand() * 0.05})`;
        c.fillRect(rand() * 256, rand() * 256, 10 + rand() * 40, 1);
      }
      c.fillStyle = "#3e2f24";
      c.fillRect(0, 0, 6, 256);
      c.fillRect(128, 0, 6, 256);
    }
    if (kind !== "redbrick" && kind !== "wood") streaks(c, 0, 0, 256, 256, seed2 + 3, kind === "stone" ? 2 : 5, kind === "stucco" ? 0.1 : 0.06);
  });
}
function metalTexture() {
  return canvasTexture(256, 256, TQ.finish, (c) => {
    c.fillStyle = "#f4f5f3";
    c.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 8) {
      c.fillStyle = "rgba(0,0,0,.07)";
      c.fillRect(x, 0, 2, 256);
      c.fillStyle = "rgba(255,255,255,.3)";
      c.fillRect(x + 3, 0, 2, 256);
    }
  });
}
const PX = 256 / BAY, PY = 256 / 3.2;
function windowTexture() {
  const t = canvasTexture(256, 10240, TQ.win, (c) => {
    let ox = 0, oy = 0;
    const R = (x, y, w, h) => [ox + x * PX, oy + 256 - (y + h) * PY, w * PX, h * PY], fill = (col, ...r) => {
      c.fillStyle = col;
      c.fillRect(...R(...r));
    };
    const glass = (x, y, w, h, dark = 0) => {
      const [X, Y, W, H] = R(x, y, w, h);
      if (MASK) MASK.fillRect(X, Y, W, H);
      const g = c.createLinearGradient(X, Y, X + W * 0.4, Y + H);
      g.addColorStop(0, dark ? "#56646b" : "#8ea2a8");
      g.addColorStop(0.5, dark ? "#3b474d" : "#61757b");
      g.addColorStop(1, dark ? "#323c41" : "#4f6065");
      c.fillStyle = g;
      c.fillRect(X, Y, W, H);
      c.fillStyle = "rgba(255,255,255,.13)";
      c.beginPath();
      c.moveTo(X + W * 0.15, Y + H);
      c.lineTo(X + W * 0.35, Y + H);
      c.lineTo(X + W * 0.6, Y);
      c.lineTo(X + W * 0.4, Y);
      c.fill();
    };
    const frame = "#f6f6f3";
    const slider = (cx, y, w, h, panes = 2, dark = 0) => {
      fill(frame, cx - w / 2 - 0.06, y - 0.06, w + 0.12, h + 0.12);
      glass(cx - w / 2, y, w, h, dark);
      for (let k = 1; k < panes; k++) fill(frame, cx - w / 2 + k * w / panes - 0.025, y, 0.05, h);
      fill("#d9d6ce", cx - w / 2 - 0.12, y - 0.12, w + 0.24, 0.07);
    };
    const grill = (cx, y, w, h, col = "rgba(246,246,243,.95)") => {
      c.fillStyle = col;
      for (let x = cx - w / 2; x <= cx + w / 2 + 0.01; x += 0.12) c.fillRect(...R(x - 0.012, y, 0.024, h));
      for (const yy of [y, y + h / 2, y + h - 0.03]) c.fillRect(...R(cx - w / 2, yy, w, 0.03));
    };
    const ac = (x, y) => {
      fill("rgba(0,0,0,.18)", x + 0.04, y - 0.04, 0.8, 0.5);
      fill("#eeeeea", x, y, 0.8, 0.5);
      c.fillStyle = "#c4c7c4";
      c.beginPath();
      const [X, Y, W, H] = R(x + 0.12, y + 0.08, 0.34, 0.34);
      c.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
      c.fill();
    };
    const rail = (y, h, col = frame) => {
      fill(col, 0, y + h - 0.05, BAY, 0.05);
      fill(col, 0, y, BAY, 0.04);
      c.fillStyle = col;
      for (let x = 0.06; x < BAY; x += 0.11) c.fillRect(...R(x, y, 0.022, h));
    };
    const shutter = (x, w, h) => {
      fill("#cfd3d4", x, 0, w, h);
      c.fillStyle = "rgba(0,0,0,.09)";
      for (let y = 0.06; y < h; y += 0.11) c.fillRect(...R(x, y, w, 0.025));
      fill("#a9aeb0", x - 0.1, h - 0.03, w + 0.2, 0.3);
    };
    const up = [
      () => slider(2.2, 0.9, 2.2, 1.4),
      () => {
        slider(2.2, 0.9, 2.2, 1.4);
        grill(2.2, 0.84, 2.4, 1.52);
      },
      () => slider(2.2, 0.9, 3.4, 1.4, 4),
      () => {
        fill("#ebe9e3", 0.05, 0, 4.3, 1);
        fill("#d7d4cc", 0.05, 0.96, 4.3, 0.05);
        slider(2.2, 1.02, 4.1, 1.55, 4);
        fill("#d7d4cc", 0.05, 2.65, 4.3, 0.12);
      },
      () => {
        fill(frame, 0.5, 0.08, 1.7, 2.38);
        glass(0.58, 0.12, 1.54, 2.28);
        fill(frame, 1.33, 0.12, 0.05, 2.28);
        slider(3.3, 1.05, 1.3, 1.2);
        rail(0.05, 1.05, "#f1f1ee");
      },
      () => {
        slider(1.25, 1, 0.9, 1.1);
        slider(3.15, 1, 0.9, 1.1);
        grill(1.25, 0.95, 1.05, 1.2);
        grill(3.15, 0.95, 1.05, 1.2);
      },
      () => {
        fill("#3f4649", 0.25, 0.65, 3.9, 1.95);
        glass(0.32, 0.72, 3.76, 1.81, 1);
        fill("#3f4649", 2.18, 0.72, 0.04, 1.81);
      },
      () => {
        slider(2.2, 0.9, 2.4, 1.3);
        fill("#e2dfd7", 0.85, 2.32, 2.7, 0.2);
        fill("rgba(0,0,0,.18)", 0.85, 2.22, 2.7, 0.1);
      },
      () => {
        fill("#e9e6dd", 0.65, 0.85, 3.1, 1.5);
        for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) glass(0.72 + i * 1, 0.9 + j * 0.72, 0.92, 0.66);
        streaks(c, ...R(0.9, 0, 2.6, 0.85), 7, 3, 0.18);
      },
      () => {
        for (const x of [0.9, 2.6]) {
          fill(frame, x - 0.05, 0.45, 1, 2.15);
          glass(x, 0.5, 0.9, 2.05);
          fill(frame, x + 0.43, 0.5, 0.04, 2.05);
        }
      },
      () => {
        glass(0, 0, BAY, 3.2, 1);
        fill("#c9ccca", 0, 0, BAY, 0.75);
        for (let x = 0; x <= BAY; x += 1.1) fill("#9ea4a4", x - 0.03, 0, 0.06, 3.2);
        fill("#9ea4a4", 0, 0.72, BAY, 0.05);
      },
      () => {
        fill("#dad8d1", 0, 0.82, BAY, 0.06);
        glass(0, 0.9, BAY, 1.25);
        for (let x = 0; x < BAY; x += 1.467) fill("#e6e6e2", x, 0.9, 0.06, 1.25);
        fill("#dad8d1", 0, 2.15, BAY, 0.06);
      },
      () => {
        fill(frame, 0.55, 1.35, 0.7, 0.7);
        fill("#d9dcdb", 0.6, 1.4, 0.6, 0.6);
        slider(2.6, 1, 1.6, 1.2);
        ac(3.55, 0.55);
      },
      () => {
        slider(2.2, 0.9, 2.2, 1.4);
        grill(2.2, 0.84, 2.4, 1.52);
        fill("#7c6a58", 1, 0.72, 2.4, 0.16);
        c.fillStyle = "#6f9a5f";
        for (let k = 0; k < 9; k++) {
          const [X, Y] = R(1.05 + k * 0.27, 0.86, 0, 0);
          c.beginPath();
          c.arc(X, Y, 7, 0, Math.PI * 2);
          c.fill();
        }
      },
      () => {
        slider(2.2, 1, 2.4, 1.4);
        rail(0.08, 0.92);
      },
      () => {
        for (let k = 0; k < 5; k++) fill("#d8d6cf", 3, 1.1 + k * 0.16, 0.9, 0.08);
        slider(1.6, 1.1, 1.4, 1);
      }
    ];
    const down = [
      () => shutter(0.2, 4, 2.85),
      () => {
        shutter(0.15, 2.9, 2.8);
        fill(frame, 3.3, 0, 1, 2.35);
        glass(3.38, 0.05, 0.84, 2.25);
      },
      () => {
        fill("#dfe1df", 0.1, 0, 4.2, 2.95);
        glass(0.2, 0.05, 4, 2.8);
        fill("rgba(255,244,214,.35)", 0.4, 0.1, 1.5, 1.6);
        fill("rgba(255,244,214,.3)", 2.5, 0.1, 1.4, 1.4);
        fill("#dfe1df", 2.15, 0.05, 0.06, 2.8);
        fill("#dfe1df", 0.2, 2.1, 4, 0.06);
      },
      () => {
        fill("#4a4643", 0.1, 0, 4.2, 2.95);
        fill("#6a645d", 0.1, 0, 4.2, 0.35);
        const rand = rng(9), tones = ["#b9a68a", "#a7b4ad", "#c9b9a2", "#9fa9b5", "#c7a9a0", "#d8d1c0"];
        for (const y of [0.45, 1.05, 1.65]) for (let x = 0.35; x < 3.9; ) {
          const w = 0.25 + rand() * 0.45;
          c.fillStyle = tones[Math.floor(rand() * tones.length)];
          c.fillRect(...R(x, y, w, 0.45));
          x += w + 0.04;
        }
        c.fillStyle = "rgba(30,28,26,.55)";
        for (const y of [0.43, 1.03, 1.63]) c.fillRect(...R(0.3, y, 3.7, 0.04));
        fill("rgba(255,250,232,.85)", 0.5, 2.6, 3.2, 0.06);
        fill("rgba(255,248,225,.18)", 0.1, 1.9, 4.2, 1);
      },
      () => {
        fill("#8c6e55", 0.5, 0, 1.2, 2.35);
        fill("#7a5f49", 0.56, 0.05, 1.08, 2.25);
        fill("#c9a46a", 1.45, 1, 0.06, 0.12);
        slider(3, 0.95, 1.6, 1.25);
        grill(3, 0.9, 1.75, 1.35);
      },
      () => {
        fill("#2f3332", 0.4, 0, 3.4, 2.4);
        shutter(0.4, 3.4, 0.8);
        fill("#cfd3d4", 0.4, 1.6, 3.4, 0.8);
      },
      () => {
        fill("#e9ecea", 0.1, 0, 4.2, 2.95);
        glass(0.2, 0.05, 4, 2.8);
        fill("rgba(255,255,255,.55)", 0.25, 0.1, 3.9, 2.6);
        c.fillStyle = "rgba(120,140,150,.5)";
        for (let y = 0.4; y < 2.4; y += 0.5) c.fillRect(...R(0.5, y, 3.4, 0.06));
      },
      () => {
        fill("#c6c9c8", 0.2, 0, 4, 2.8);
        for (let x = 0.2; x < 4.2; x += 0.5) {
          glass(x + 0.05, 0.9, 0.4, 1.7);
          fill("#a7abaa", x, 0, 0.04, 2.8);
        }
      }
    ];
    const misc = [
      () => {
        c.fillStyle = "rgba(246,246,243,1)";
        c.fillRect(ox, oy, 256, 10);
        c.fillRect(ox, oy + 246, 256, 10);
        c.fillRect(ox, oy, 10, 256);
        c.fillRect(ox + 246, oy, 10, 256);
        for (let x = ox + 20; x < ox + 246; x += 17) c.fillRect(x, oy, 4, 256);
        c.fillRect(ox, oy + 124, 256, 5);
      },
      () => {
        c.fillStyle = "rgba(246,246,243,1)";
        c.fillRect(ox, oy, 256, 14);
        c.fillRect(ox, oy + 244, 256, 12);
        for (let x = ox + 6; x < ox + 256; x += 18) c.fillRect(x, oy, 5, 256);
      },
      () => {
        fill(frame, 1.9, 1.55, 0.66, 0.66);
        fill("#d6dbdb", 1.95, 1.6, 0.56, 0.56);
      },
      () => {
        fill(frame, 1.85, 0.3, 0.7, 2.5);
        glass(1.9, 0.35, 0.6, 2.4);
        for (let y = 0.9; y < 2.7; y += 0.6) fill(frame, 1.9, y, 0.6, 0.04);
      },
      () => {
        slider(1.8, 1.1, 1.4, 1);
        grill(1.8, 1.05, 1.55, 1.1);
        fill("#c2c5c2", 3.6, 0, 0.1, 3.2);
      },
      () => {
        fill("#cfd1ce", 1.4, 1.8, 0.5, 0.35);
        fill("#c2c5c2", 2.6, 0, 0.09, 3.2);
        fill("#c2c5c2", 2.9, 0, 0.06, 3.2);
      },
      () => {
        slider(1.6, 1, 1.4, 1.1);
        ac(2.7, 0.5);
      },
      () => {
        fill(frame, 0.9, 1.5, 2.6, 0.6);
        fill("#d4d9da", 0.95, 1.55, 2.5, 0.5);
        fill(frame, 2.18, 1.55, 0.04, 0.5);
      }
    ];
    const civic = [
      // 校舍走廊：女兒牆（透明，露出牆面）上方是暗的走廊與教室門窗，兩側是柱
      () => {
        fill("#59605f", 0.35, 1.1, 3.7, 1.75);
        fill("#6d7472", 0.35, 2.55, 3.7, 0.3);
        for (const x of [0.7, 2.5]) fill("#b8c3c2", x, 1.35, 1.2, 0.95);
        fill("#8a6c52", 3.55, 1.15, 0.45, 1.55);
        fill("#f4f2ec", 0.35, 1.05, 3.7, 0.07);
      },
      // 消防車庫門
      () => {
        shutter(0.35, 3.7, 3.05);
        fill("#ffffff", 0.25, 3, 3.9, 0.12);
      },
      // 廟門：石柱、紅柱、兩扇門、兩側格窗
      () => {
        fill("#cfcac0", 0.15, 0, 0.4, 3.2);
        fill("#cfcac0", 3.85, 0, 0.4, 3.2);
        fill("#8f2a1d", 0.55, 0, 0.18, 3);
        fill("#8f2a1d", 3.67, 0, 0.18, 3);
        fill("#5e1f16", 1.35, 0, 1.7, 2.65);
        fill("#7a2a1e", 1.42, 0.05, 0.75, 2.55);
        fill("#7a2a1e", 2.23, 0.05, 0.75, 2.55);
        for (const y of [0.6, 1.3, 2]) fill("#c9a23a", 1.42, y, 1.56, 0.05);
        for (const x of [0.85, 3]) {
          fill("#4b2a20", x, 1, 0.45, 1.1);
          c.fillStyle = "#c9a23a";
          for (let k = 1; k < 4; k++) {
            c.fillRect(...R(x + k * 0.11, 1, 0.02, 1.1));
            c.fillRect(...R(x, 1 + k * 0.27, 0.45, 0.02));
          }
        }
        fill("#c9a23a", 1.2, 2.75, 2, 0.32);
      },
      // 廟側：圓形格窗
      () => {
        const [X, Y, W, H] = R(1.6, 0.9, 1.2, 1.2);
        c.fillStyle = "#4b2a20";
        c.beginPath();
        c.ellipse(X + W / 2, Y + H / 2, W / 2, H / 2, 0, 0, Math.PI * 2);
        c.fill();
        c.strokeStyle = "#c9a23a";
        c.lineWidth = 4;
        c.stroke();
        c.fillStyle = "#c9a23a";
        for (let k = 1; k < 5; k++) {
          c.fillRect(X + k * W / 5, Y + 6, 2, H - 12);
          c.fillRect(X + 6, Y + k * H / 5, W - 12, 2);
        }
      },
      // 機關入口：玻璃雙門、雨庇陰影、門旁石材
      () => {
        fill("#dcdad3", 0.6, 0, 3.2, 2.9);
        glass(1.2, 0, 2, 2.5);
        fill("#dcdad3", 2.18, 0, 0.05, 2.5);
        fill("rgba(0,0,0,.22)", 0.6, 2.5, 3.2, 0.25);
        fill("#c9c6bd", 0.4, 2.75, 3.6, 0.18);
      },
      // 日式木窗：白框細格玻璃，上下兩段
      () => {
        fill("#e9e4d8", 0.7, 0.75, 3, 1.6);
        for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) glass(0.76 + i * 0.73, 0.8 + j * 0.77, 0.67, 0.72);
        fill("#4a3a2c", 0.6, 0.68, 3.2, 0.09);
        fill("#4a3a2c", 0.6, 2.35, 3.2, 0.08);
      },
      // 木造住家一樓：腰板加格子玻璃拉門
      () => {
        fill("#4a3a2c", 0.4, 0, 3.6, 2.5);
        for (let i = 0; i < 4; i++) {
          fill("#6b5442", 0.48 + i * 0.87, 0.05, 0.8, 0.75);
          for (let j = 0; j < 3; j++) glass(0.52 + i * 0.87, 0.88 + j * 0.52, 0.72, 0.46, 1);
        }
        fill("#e9e4d8", 0.4, 2.5, 3.6, 0.1);
      }
    ];
    [up.slice(0, 8), up.slice(8), down, misc, civic].forEach((row, r) => row.forEach((draw, i) => {
      ox = 0;
      oy = (r * 8 + i) * 256;
      draw();
    }));
  }, false);
  return t;
}
const SHOPS = [
  "早餐店",
  "五金百貨",
  "機車行",
  "自助餐",
  "手搖飲料",
  "洗衣店",
  "牛肉麵",
  "雜貨店",
  "藥局",
  "眼鏡行",
  "水電行",
  "美髮沙龍",
  "牙醫診所",
  "補習班",
  "電器行",
  "文具書局",
  "水果行",
  "中藥行",
  "麵包店",
  "火鍋",
  "燒臘便當",
  "小吃部",
  "汽車修理",
  "腳踏車行",
  "照相館",
  "服飾店",
  "鞋店",
  "銀樓",
  "手機通訊",
  "電腦維修",
  "冷氣空調",
  "金紙香舖"
];
const SIGN_COLORS = [["#c8322b", "#fff6e0"], ["#f3d23a", "#b3261e"], ["#1f5fa8", "#ffffff"], ["#ffffff", "#c8322b"], ["#2f7d4f", "#fffbe8"], ["#e9782f", "#ffffff"], ["#f7f1e3", "#1f4f86"], ["#5b3a8c", "#ffffff"], ["#e8e8e8", "#2f7d4f"], ["#0f6b73", "#ffe9a8"], ["#b3261e", "#ffe27a"], ["#ffffff", "#1f5fa8"], ["#2b2b2b", "#ffd24a"], ["#d64a7a", "#ffffff"], ["#3f8fd0", "#ffffff"], ["#f4e7c7", "#8a3a1c"]];
const FONT = '"PingFang TC","Noto Sans CJK TC",sans-serif';
function signTexture() {
  return canvasTexture(2048, 1024, TQ.sign, (c) => {
    SHOPS.forEach((name, i) => {
      const x = i % 4 * 512, y = Math.floor(i / 4) * 128, [bg, fg] = SIGN_COLORS[i * 7 % 16];
      c.fillStyle = bg;
      c.fillRect(x, y, 512, 128);
      c.strokeStyle = fg;
      c.globalAlpha = 0.55;
      c.lineWidth = 5;
      c.strokeRect(x + 8, y + 8, 496, 112);
      c.globalAlpha = 1;
      c.fillStyle = fg;
      c.font = `bold 64px ${FONT}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(name, x + 256, y + 60, 440);
      c.font = `22px ${FONT}`;
      c.globalAlpha = 0.8;
      c.fillText(i % 3 === 0 ? "營業時間 06:00–21:00" : i % 3 === 1 ? "歡迎光臨" : "專業・服務", x + 256, y + 106, 420);
      c.globalAlpha = 1;
    });
  }, false);
}
function verticalSignTexture() {
  return canvasTexture(1024, 512, TQ.sign, (c) => {
    SHOPS.slice(0, 16).forEach((name, i) => {
      const x = i * 64, [bg, fg] = SIGN_COLORS[(i * 5 + 3) % 16];
      c.fillStyle = bg;
      c.fillRect(x, 0, 64, 512);
      c.fillStyle = fg;
      c.fillRect(x + 4, 4, 56, 4);
      c.fillRect(x + 4, 504, 56, 4);
      c.font = `bold 44px ${FONT}`;
      c.textAlign = "center";
      c.textBaseline = "middle";
      const step = Math.min(110, 470 / name.length);
      [...name].forEach((ch, k) => c.fillText(ch, x + 32, 22 + step * (k + 0.5)));
    });
  }, false);
}
const seed = (s) => [...s].reduce((n, c) => Math.imul(n, 31) + c.charCodeAt(0) >>> 0, 7);
const rnd = (a, b) => {
  let h = Math.imul((a ^ Math.imul(b, 2654435761)) >>> 0, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};
const FRAMES = ["#ffffff", "#ffffff", "#ffffff", "#d2d6d4", "#a38c72", "#6f8f78", "#5a5e60"];
const CAGES = ["#f2f2ee", "#f2f2ee", "#e1e3df", "#6d8f7a", "#8a5e4a", "#5a6f86", "#3f4446"];
const AWNINGS = ["#3f7a5a", "#e7e5de", "#4f6d91", "#a65a4c", "#d8a23a", "#7d8b8f", "#c8473b"];
const SHUTTERS = ["#ffffff", "#ffffff", "#e2e7ea", "#cfe0d6", "#d6dbe8", "#efe2cf"];
const DECKS = ["#a7a9a4", "#b0b1ab", "#8f9a94", "#6f8a78", "#9c9f9b", "#b8b4aa", "#7f9488"];
const ADDON_ROOFS = ["#4f79a6", "#5f8f6f", "#b5583c", "#b9bcbb", "#86a9c4", "#dcdcd6", "#6f8592"];
const TANKS = ["#cfd3d6", "#c2c7cb", "#5d86b0", "#e9ebe8", "#cfd3d6"];
const TEMPLE_ROOFS = ["#d98a2b", "#c9a23a", "#3f8f5f", "#d17a2a"];
const CAGE = { 0: [2.2, 1.4, 0.9], 2: [3.4, 1.4, 0.9], 5: [2.4, 1.2, 1], 7: [2.4, 1.3, 0.9], 8: [3, 1.4, 0.9], 12: [1.6, 1.2, 1], 14: [2.4, 1.4, 1] };
const CIVIC = {
  post: { win: 2, finish: 0, ground: [[18, 2], [36, 1]], band: "#1f7a4d" },
  police: { win: 0, finish: 3, ground: [[36, 2], [18, 1]], band: "#2f5d9e" },
  fire: { win: 2, finish: 0, ground: [[33, 3], [36, 1]], band: "#c0392b" },
  government: { win: 6, finish: 3, ground: [[36, 1], [18, 1]] },
  library: { win: 11, finish: 3, ground: [[18, 1], [36, 1]] },
  hospital: { win: 11, finish: 0, ground: [[36, 1], [18, 1]] },
  church: { win: 9, finish: 2, ground: [[36, 1]] }
};
export const FINISH_NAMES = FINISHES;
export function drawFinishes() {
  return [...FINISHES.map((k, i) => finishTexture(k, 101 + i * 17)), metalTexture()];
}
export function drawWindows() {
  wantMask = true;
  try {
    return windowTexture();
  } finally {
    wantMask = false;
  }
}
export function drawSigns() {
  return { horizontal: signTexture(), vertical: verticalSignTexture() };
}
export { SHOPS, SIGN_COLORS, seed, rnd, FRAMES, CAGES, AWNINGS, SHUTTERS, DECKS, ADDON_ROOFS, TANKS, TEMPLE_ROOFS, CAGE, CIVIC };
