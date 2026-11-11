/** imgedit.js — offline photo editor: rotate ±90°, crop, brightness, contrast, reset, preview. Nothing leaves the device.
 *  ImageEditor.open({ blob, title, saveLabel, rotate, allowOriginal }) → Promise<{ blob, edited } | null>   (null = cancelled)
 *  The source blob is never modified; "Use original" returns it untouched. */
const ImageEditor = (() => {
  const MAXSIDE = 2400, QUALITY = 0.9;
  const el = (tag, attrs = {}, kids = []) => { const n = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) { if (k === 'class') n.className = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else if (v !== false && v != null) n.setAttribute(k, v); } for (const c of [].concat(kids)) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c)); return n; };
  const canvasOf = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

  /** Decode with EXIF orientation applied (Android camera photos arrive rotated via EXIF). */
  async function decode(blob) {
    try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch (e) { /* fall through */ }
    return await new Promise((res, rej) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { res(im); setTimeout(() => URL.revokeObjectURL(u), 1000); }; im.onerror = () => rej(new Error('decode')); im.src = u; });
  }
  const dims = (s) => ({ w: s.naturalWidth || s.width, h: s.naturalHeight || s.height });
  function baseCanvas(src) { const d = dims(src), f = ImageMath.fitSize(d.w, d.h, MAXSIDE), c = canvasOf(f.w, f.h), x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, f.w, f.h); x.drawImage(src, 0, 0, f.w, f.h); return c; }
  function rotateCanvas(c, dir) { const o = canvasOf(c.height, c.width), x = o.getContext('2d'); x.translate(o.width / 2, o.height / 2); x.rotate(dir * Math.PI / 2); x.drawImage(c, -c.width / 2, -c.height / 2); return o; }
  function cropCanvas(c, r) { const o = canvasOf(r.w, r.h); o.getContext('2d').drawImage(c, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h); return o; }
  function bake(c, bri, con) { if (!bri && !con) return c; const o = canvasOf(c.width, c.height), x = o.getContext('2d'); x.drawImage(c, 0, 0); const id = x.getImageData(0, 0, o.width, o.height), d = id.data, t = ImageMath.lut(bri, con); for (let i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; } x.putImageData(id, 0, 0); return o; }
  const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/jpeg', QUALITY));

  async function open(opt = {}) {
    const { blob, title = 'Edit photo', saveLabel = 'Save photo', allowOriginal = true } = opt;
    let source;
    try { source = await decode(blob); } catch (e) { return { blob, edited: false, undecodable: true }; }
    let work = baseCanvas(source), bri = 0, con = 0, edited = false, cropping = false, previewing = false, crop = null;
    for (let i = 0; i < Math.abs(opt.rotate || 0); i++) { work = rotateCanvas(work, Math.sign(opt.rotate)); edited = true; }

    return new Promise((resolve) => {
      const stage = el('div', { class: 'ie-stage' }), cv = el('canvas', { class: 'ie-cv' }), box = el('div', { class: 'ie-crop hidden' });
      const info = el('div', { class: 'ie-info' });
      const sBri = el('input', { type: 'range', min: -100, max: 100, value: 0, id: 'ieBri', 'aria-label': 'Brightness' }), sCon = el('input', { type: 'range', min: -100, max: 100, value: 0, id: 'ieCon', 'aria-label': 'Contrast' });
      const vBri = el('span', {}, '0'), vCon = el('span', {}, '0');
      stage.append(cv, box);
      const btn = (label, id, fn, cls = '') => el('button', { class: 'btn btn-sm ' + cls, id, type: 'button', onclick: fn }, label);
      const bSave = btn(saveLabel, 'ieSave', () => finish(true), 'btn-primary'), bPrev = btn('Preview', 'iePreview', () => togglePreview()), bCrop = btn('Crop', 'ieCrop', () => toggleCrop());
      const bApply = btn('Apply crop', 'ieApplyCrop', () => applyCrop(), 'btn-primary hidden'), bCancelCrop = btn('Cancel crop', 'ieCancelCrop', () => toggleCrop(false), 'hidden');
      const tools = el('div', { class: 'ie-tools' }, [btn('⟲ Left', 'ieRotL', () => rot(-1)), btn('⟳ Right', 'ieRotR', () => rot(1)), bCrop, bApply, bCancelCrop, btn('Reset', 'ieReset', () => reset()), bPrev]);
      const sliders = el('div', { class: 'ie-sliders' }, [el('label', {}, ['Brightness ', vBri, sBri]), el('label', {}, ['Contrast ', vCon, sCon])]);
      const foot = el('div', { class: 'ie-foot' }, [btn('Cancel', 'ieCancel', () => finish(false)), allowOriginal ? btn('Use original', 'ieOriginal', () => { done({ blob, edited: false }); }) : null, bSave]);
      const root = el('div', { class: 'ie', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [el('div', { class: 'ie-head' }, [el('b', {}, title), info]), stage, tools, sliders, foot]);
      document.body.appendChild(root);

      function done(r) { root.remove(); resolve(r); }
      function sizeInfo() { info.textContent = `${work.width}×${work.height}px${edited ? ' · edited' : ''}${previewing ? ' · preview' : ''}`; }
      function paint() {
        const maxW = Math.min(window.innerWidth - 24, 720), maxH = Math.max(180, window.innerHeight - 330), s = Math.min(maxW / work.width, maxH / work.height, 1);
        cv.width = work.width; cv.height = work.height; cv.style.width = Math.round(work.width * s) + 'px'; cv.style.height = Math.round(work.height * s) + 'px';
        cv.getContext('2d').drawImage(work, 0, 0); cv.style.filter = ImageMath.filterCSS(bri, con); stage.style.width = cv.style.width; stage.style.height = cv.style.height; sizeInfo();
        if (cropping) { crop = null; initCrop(); }
      }
      function rot(dir) { if (cropping) toggleCrop(false); work = rotateCanvas(work, dir); edited = true; paint(); }
      function reset() { if (cropping) toggleCrop(false); work = baseCanvas(source); bri = con = 0; sBri.value = sCon.value = 0; vBri.textContent = vCon.textContent = '0'; edited = false; previewing = false; root.classList.remove('previewing'); bPrev.textContent = 'Preview'; paint(); }
      sBri.addEventListener('input', () => { bri = +sBri.value; vBri.textContent = bri; edited = edited || !!(bri || con); cv.style.filter = ImageMath.filterCSS(bri, con); sizeInfo(); });
      sCon.addEventListener('input', () => { con = +sCon.value; vCon.textContent = con; edited = edited || !!(bri || con); cv.style.filter = ImageMath.filterCSS(bri, con); sizeInfo(); });

      // ---- crop: drag corners/edges/body of the rectangle, in displayed pixels
      let drag = null;
      const dw = () => cv.clientWidth, dh = () => cv.clientHeight;
      function drawBox() { box.style.left = crop.x + 'px'; box.style.top = crop.y + 'px'; box.style.width = crop.w + 'px'; box.style.height = crop.h + 'px'; }
      function initCrop() { const w = dw(), h = dh(); crop = { x: w * 0.08, y: h * 0.08, w: w * 0.84, h: h * 0.84 }; drawBox(); }
      function toggleCrop(on = !cropping) { cropping = on; box.classList.toggle('hidden', !on); bCrop.classList.toggle('hidden', on); bApply.classList.toggle('hidden', !on); bCancelCrop.classList.toggle('hidden', !on); if (on) { if (previewing) togglePreview(); initCrop(); } }
      function applyCrop() { const r = ImageMath.cropRect(crop, dw(), dh(), work.width, work.height); if (r.w < 8 || r.h < 8) return; work = cropCanvas(work, r); edited = true; toggleCrop(false); paint(); }
      ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'mv'].forEach((k) => box.appendChild(el('i', { class: 'ie-h ie-' + k, 'data-h': k })));
      box.addEventListener('pointerdown', (ev) => { const k = ev.target.dataset.h || 'mv'; drag = { k, x: ev.clientX, y: ev.clientY, r: { ...crop } }; box.setPointerCapture(ev.pointerId); ev.preventDefault(); });
      box.addEventListener('pointermove', (ev) => {
        if (!drag) return; const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y, r = drag.r, k = drag.k, W = dw(), H = dh(), MIN = 24; let { x, y, w, h } = r;
        if (k === 'mv') { x = ImageMath.clamp(r.x + dx, 0, W - r.w); y = ImageMath.clamp(r.y + dy, 0, H - r.h); }
        else { if (k.includes('w')) { const nx = ImageMath.clamp(r.x + dx, 0, r.x + r.w - MIN); w = r.x + r.w - nx; x = nx; } if (k.includes('e')) w = ImageMath.clamp(r.w + dx, MIN, W - r.x); if (k.includes('n')) { const ny = ImageMath.clamp(r.y + dy, 0, r.y + r.h - MIN); h = r.y + r.h - ny; y = ny; } if (k.includes('s')) h = ImageMath.clamp(r.h + dy, MIN, H - r.y); }
        crop = { x, y, w, h }; drawBox();
      });
      const end = () => { drag = null; }; box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);

      function togglePreview() { if (cropping) toggleCrop(false); previewing = !previewing; root.classList.toggle('previewing', previewing); bPrev.textContent = previewing ? 'Back to editing' : 'Preview'; sizeInfo(); }

      async function finish(save) {
        if (!save) return done(null);
        if (cropping) applyCrop();
        const out = await toBlob(bake(work, bri, con));
        if (!out) return done({ blob, edited: false });
        done({ blob: out, edited: edited || !!(bri || con) });
      }
      paint();
    });
  }
  return { open, decode, baseCanvas, rotateCanvas, cropCanvas, bake };
})();
if (typeof module !== 'undefined') module.exports = ImageEditor;
