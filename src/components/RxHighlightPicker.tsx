import { useEffect, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';
import { ndcDigits, normalizeNdcOcr } from '../lib/ndc';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type HighlightMode = 'rx' | 'ndc' | 'name' | 'amount' | 'frequency' | 'notes';

interface RxHighlightPickerProps {
  image: Blob;
  mode?: HighlightMode;
  onResult: (value: string, rawText: string) => void;
  onCancel: () => void;
}

const POINTER_Y_OFFSET = 54;

const LABELS: Record<HighlightMode, string> = {
  rx: 'Rx number',
  ndc: 'NDC number',
  name: 'Medication name',
  amount: 'Dose / amount',
  frequency: 'Directions / frequency',
  notes: 'Notes',
};

function normalizeOcrNumberText(text: string): string {
  return normalizeNdcOcr(text).replace(/[—–]/g, '-');
}

function cleanupText(text: string): string {
  return text
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractNdc(text: string): string | null {
  const normalized = normalizeOcrNumberText(text);
  const labeled = normalized.match(/\bN[D0O][C0O][:\s#-]*([\d\s-]{10,16})\b/i);
  const candidates = labeled ? [labeled[1]] : normalized.match(/[\d\s-]{10,16}/g) ?? [];
  const plausible = candidates
    .map((candidate) => candidate.trim())
    .filter((candidate) => {
      const digitLength = ndcDigits(candidate).length;
      return digitLength === 10 || digitLength === 11;
    })
    .sort((a, b) => ndcDigits(b).length - ndcDigits(a).length);
  return plausible[0] ?? null;
}

function extractRx(text: string): string | null {
  const normalized = normalizeOcrNumberText(text);
  const labeled = normalized.match(/\b(?:R\s?X|PRESCRIPTION)\s*(?:#|NO\.?|NUMBER|NUM)?\s*[:#-]?\s*([\d\s-]{4,16})\b/i);
  const candidates = labeled ? [labeled[1]] : normalized.match(/[\d\s-]{4,16}/g) ?? [];
  const plausible = candidates
    .map((candidate) => ndcDigits(candidate))
    .filter((candidate) => candidate.length >= 4)
    .sort((a, b) => b.length - a.length);
  return plausible[0] ?? null;
}

function extractAmount(text: string): string | null {
  const match = cleanupText(text).match(/\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?|tablet|tablets|tab|tabs|capsule|capsules|cap|caps)\b/i);
  return match?.[0]?.trim() ?? cleanupText(text);
}

function extractName(text: string): string | null {
  return cleanupText(text)
    .replace(/\b(tablets?|capsules?|take|by mouth|directions?|rx|ndc)\b/gi, ' ')
    .replace(/\b\d+(\.\d+)?\s?(mg|mcg|g|ml|iu|units?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractValue(text: string, mode: HighlightMode): string | null {
  switch (mode) {
    case 'ndc':
      return extractNdc(text);
    case 'rx':
      return extractRx(text);
    case 'amount':
      return extractAmount(text);
    case 'name':
      return extractName(text);
    case 'frequency':
    case 'notes':
      return cleanupText(text);
    default:
      return cleanupText(text);
  }
}

/**
 * Lets the person drag a box around one specific field on the photo. The
 * selection point is offset above the finger so the box is visible while
 * dragging, and the selected mode controls which form field gets updated.
 */
export default function RxHighlightPicker({ image, mode = 'rx', onResult, onCancel }: RxHighlightPickerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    setBox(null);
    setError(null);
    return () => URL.revokeObjectURL(url);
  }, [image, mode]);

  function pointFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top - POINTER_Y_OFFSET, 0), rect.height),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pointFromEvent(e);
    dragStart.current = p;
    setBox({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStart.current) return;
    e.preventDefault();
    const p = pointFromEvent(e);
    const start = dragStart.current;
    setBox({
      x: Math.min(start.x, p.x),
      y: Math.min(start.y, p.y),
      w: Math.abs(p.x - start.x),
      h: Math.abs(p.y - start.y),
    });
  }

  function handlePointerUp(e: React.PointerEvent) {
    dragStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  async function handleReadSelection() {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !box || box.w < 8 || box.h < 8) {
      setError(`Drag a box around the ${LABELS[mode]} first.`);
      return;
    }
    setError(null);
    setReading(true);
    try {
      const scaleX = img.naturalWidth / container.clientWidth;
      const scaleY = img.naturalHeight / container.clientHeight;
      const cropX = box.x * scaleX;
      const cropY = box.y * scaleY;
      const cropW = box.w * scaleX;
      const cropH = box.h * scaleY;

      const upscale = 4;
      const canvas = document.createElement('canvas');
      canvas.width = cropW * upscale;
      canvas.height = cropH * upscale;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no canvas context');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error('crop failed');

      const result = await recognize(blob, 'eng');
      const rawText = cleanupText(result.data.text);
      const value = extractValue(rawText, mode);
      if (!value) {
        setError(`Couldn't read the ${LABELS[mode]} in that area. Try selecting more tightly around the field text.`);
        return;
      }
      onResult(value, rawText);
    } catch {
      setError('Reading that selection failed. Try again.');
    } finally {
      setReading(false);
    }
  }

  const label = LABELS[mode];

  return (
    <div className="rx-picker">
      <p className="rx-picker-hint">
        Highlight the {label}. The selection appears about an inch above your finger so you can see it.
      </p>
      {imageUrl && (
        <div
          ref={containerRef}
          className="rx-picker-stage"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <img ref={imgRef} src={imageUrl} alt="Scanned label" draggable={false} />
          {box && <div className="rx-picker-box" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        </div>
      )}
      {error && <p className="login-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={reading}>
          Back to field choices
        </button>
        <button type="button" className="primary-button" onClick={() => void handleReadSelection()} disabled={reading}>
          {reading ? 'Reading…' : `Use as ${label}`}
        </button>
      </div>
    </div>
  );
}
