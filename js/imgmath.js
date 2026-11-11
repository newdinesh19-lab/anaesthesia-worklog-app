/** imgmath.js — pure maths for the photo editor (no DOM). Brightness/contrast use the same formula as the CSS preview filter. */
const ImageMath = (() => {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /** Sliders are -100..100 → multipliers 0..2 (0 = unchanged). */
  const factors = (bri, con) => ({ b: 1 + clamp(+bri || 0, -100, 100) / 100, c: 1 + clamp(+con || 0, -100, 100) / 100 });
  /** One channel value 0..255 after brightness (multiply) then contrast (around mid-grey), clamped after each step like the CSS filter chain. */
  const lutValue = (v, bri, con) => { const { b, c } = factors(bri, con); const v1 = clamp((v / 255) * b, 0, 1); return clamp(Math.round(((v1 - 0.5) * c + 0.5) * 255), 0, 255); };
  const lut = (bri, con) => { const t = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) t[i] = lutValue(i, bri, con); return t; };
  const filterCSS = (bri, con) => { const { b, c } = factors(bri, con); return `brightness(${b.toFixed(2)}) contrast(${c.toFixed(2)})`; };
  /** Scale (w,h) down so the long side is at most max (never up). */
  const fitSize = (w, h, max) => { const s = Math.min(1, max / Math.max(w, h)); return { w: Math.max(1, Math.round(w * s)), h: Math.max(1, Math.round(h * s)), scale: s }; };
  /** Crop rectangle in displayed pixels (dw×dh) → base-image pixels (bw×bh), clamped inside the image. */
  const cropRect = (r, dw, dh, bw, bh) => {
    const x = clamp(r.x, 0, dw), y = clamp(r.y, 0, dh), x2 = clamp(r.x + r.w, 0, dw), y2 = clamp(r.y + r.h, 0, dh), sx = bw / dw, sy = bh / dh;
    const bx = Math.min(bw - 1, Math.round(x * sx)), by = Math.min(bh - 1, Math.round(y * sy));
    return { x: bx, y: by, w: clamp(Math.round((x2 - x) * sx), 1, bw - bx), h: clamp(Math.round((y2 - y) * sy), 1, bh - by) };
  };
  const rotatedSize = (w, h, quarterTurns) => (((quarterTurns % 2) + 2) % 2 ? { w: h, h: w } : { w, h });
  return { clamp, factors, lutValue, lut, filterCSS, fitSize, cropRect, rotatedSize };
})();
if (typeof module !== 'undefined') module.exports = ImageMath;
