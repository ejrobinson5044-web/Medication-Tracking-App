type DetectedBarcode = {
  rawValue?: string;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => {
  detect: (source: ImageBitmapSource) => Promise<DetectedBarcode[]>;
};

const BARCODE_FORMATS = [
  'qr_code',
  'data_matrix',
  'pdf417',
  'code_128',
  'code_39',
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
];

/**
 * Reads QR/barcode text from the photo when the browser supports the native
 * BarcodeDetector API. Unsupported browsers simply return no codes so the
 * normal OCR/manual-selection path can continue.
 */
export async function readBarcodeTexts(image: Blob): Promise<string[]> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  if (!Detector || typeof createImageBitmap !== 'function') return [];

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(image);
    const detector = new Detector({ formats: BARCODE_FORMATS });
    const results = await detector.detect(bitmap);
    return results
      .map((result) => result.rawValue?.trim() ?? '')
      .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  } catch {
    return [];
  } finally {
    bitmap?.close();
  }
}
