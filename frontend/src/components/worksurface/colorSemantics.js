function normalizeHexColor(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(normalized) ? normalized : "";
}

function hashText(value) {
  return Array.from(String(value || "").trim()).reduce((acc, char) => ((acc * 31) + char.codePointAt(0)) >>> 0, 7);
}

function hslToHex(hue, saturation, lightness) {
  const h = ((Number(hue) % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, Number(saturation))) / 100;
  const l = Math.max(0, Math.min(100, Number(lightness))) / 100;
  const chroma = (1 - Math.abs((2 * l) - 1)) * s;
  const hp = h / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1] = [0, 0, 0];
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [chroma, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, chroma, 0];
  else if (hp < 3) [r1, g1, b1] = [0, chroma, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, chroma];
  else if (hp < 5) [r1, g1, b1] = [x, 0, chroma];
  else [r1, g1, b1] = [chroma, 0, x];
  const match = l - (chroma / 2);
  const toHex = (channel) => Math.round((channel + match) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase();
}

export function stableLedgerColor(seed, { saturation = 64, lightness = 56 } = {}) {
  const normalizedSeed = String(seed || "").trim();
  if (!normalizedSeed) {
    return "#C8D9F9";
  }
  const hue = hashText(normalizedSeed) % 360;
  return hslToHex(hue, saturation, lightness);
}

export function resolveSemanticColor(seed, explicitColor, options) {
  return normalizeHexColor(explicitColor) || stableLedgerColor(seed, options);
}

export function withAlpha(color, alpha = 0.14) {
  const normalized = normalizeHexColor(color);
  if (!normalized) {
    return `rgba(200, 217, 249, ${alpha})`;
  }
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function extractVisibleInitial(value, fallback = "") {
  const normalized = String(value || "").trim();
  if (normalized) {
    return Array.from(normalized)[0];
  }
  const normalizedFallback = String(fallback || "").trim();
  return normalizedFallback ? Array.from(normalizedFallback)[0] : "";
}
