/** ocr.js — Tesseract.js wrapper (runs on the device). */
const OCR = (() => {
  let wp = null, cb = null;
  async function recognize(file, onProgress) {
    cb = onProgress;
    if (!wp) wp = Tesseract.createWorker('eng', 1, { logger: (m) => { if (cb && m.status === 'recognizing text') cb(m.progress); } });
    const w = await wp;
    const { data } = await w.recognize(file);
    return { text: data.text };
  }
  return { recognize };
})();
if (typeof window !== 'undefined') window.OCR = OCR;
