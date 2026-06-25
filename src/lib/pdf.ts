export interface PdfScanInput {
  text: string;
  pageImages: Blob[];
}

export async function extractPdfScanInput(file: File, maxPages = 10): Promise<PdfScanInput> {
  const pdfjsLib = await import('pdfjs-dist');

  try {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  } catch {
    // Ignore worker setup failures and let pdf.js use its fallback behavior.
  }

  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts: string[] = [];
  const pageImages: Blob[] = [];
  const pageCount = Math.min(pdf.numPages, maxPages);

  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
    const page = await pdf.getPage(pageNumber);

    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) pageTexts.push(text);

    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) continue;

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;

    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
    if (image) pageImages.push(image);
  }

  return {
    text: pageTexts.join('\n'),
    pageImages,
  };
}

export async function extractPdfText(file: File): Promise<string> {
  const result = await extractPdfScanInput(file);
  return result.text;
}
