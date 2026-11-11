const test = global.__test, assert = global.__assert;
const M = require('../js/imgmath.js');
test('image maths: identity, brightness, contrast', () => {
  for (const v of [0, 17, 128, 255]) assert.strictEqual(M.lutValue(v, 0, 0), v);
  assert.strictEqual(M.lutValue(100, 50, 0), 150); assert.strictEqual(M.lutValue(200, 100, 0), 255); assert.strictEqual(M.lutValue(100, -100, 0), 0);
  assert(M.lutValue(60, 0, 50) < 60); assert(M.lutValue(200, 0, 50) > 200); assert.strictEqual(M.lutValue(128, 0, 50), 128 + (M.lutValue(128, 0, 50) - 128));
  const t = M.lut(20, -10); assert.strictEqual(t.length, 256); for (let i = 1; i < 256; i++) assert(t[i] >= t[i - 1]); assert.strictEqual(M.filterCSS(0, 0), 'brightness(1.00) contrast(1.00)'); assert.strictEqual(M.filterCSS(999, -999), 'brightness(2.00) contrast(0.00)');
});
test('image maths: fit, rotate dimensions, crop mapping', () => {
  assert.deepStrictEqual(M.fitSize(4000, 3000, 2000), { w: 2000, h: 1500, scale: 0.5 }); assert.deepStrictEqual(M.fitSize(800, 600, 2000), { w: 800, h: 600, scale: 1 });
  assert.deepStrictEqual(M.rotatedSize(400, 200, 1), { w: 200, h: 400 }); assert.deepStrictEqual(M.rotatedSize(400, 200, 2), { w: 400, h: 200 }); assert.deepStrictEqual(M.rotatedSize(400, 200, -1), { w: 200, h: 400 });
  assert.deepStrictEqual(M.cropRect({ x: 50, y: 25, w: 100, h: 50 }, 200, 100, 2000, 1000), { x: 500, y: 250, w: 1000, h: 500 });
  const c = M.cropRect({ x: -20, y: -5, w: 500, h: 500 }, 200, 100, 400, 200); assert.deepStrictEqual(c, { x: 0, y: 0, w: 400, h: 200 });
  const d = M.cropRect({ x: 199, y: 99, w: 50, h: 50 }, 200, 100, 400, 200); assert(d.x + d.w <= 400 && d.y + d.h <= 200 && d.w >= 1 && d.h >= 1);
});
