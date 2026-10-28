/**
 * ocr.js — thin wrapper around Tesseract.js so the rest of the app only
 * deals with "give me text from this image file".
 */

const OCR = (() => {
  let workerPromise = null;

  async function getWorker(onProgress) {
    if (workerPromise) return workerPromise;
    workerPromise = Tesseract.createWorker('eng', 1, {
      logger: (m) => {
        if (onProgress && m.status === 'recognizing text') onProgress(m.progress);
      },
    });
    return workerPromise;
  }

  /**
   * @param {Blob|File} imageFile
   * @param {(progress:number)=>void} [onProgress] 0..1
   * @returns {Promise<{text:string}>}
   */
  async function recognize(imageFile, onProgress) {
    const worker = await getWorker(onProgress);
    const { data } = await worker.recognize(imageFile);
    return { text: data.text };
  }

  return { recognize };
})();

if (typeof window !== 'undefined') window.OCR = OCR;
