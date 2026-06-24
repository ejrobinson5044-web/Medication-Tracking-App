import { useEffect, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';
import { ndcDigits, normalizeNdcOcr } from '../lib/ndc';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type HighlightMode = 'rx' | 'ndc';

interface RxHighlightPickerProps {
  image: Blob;
  mode?: HighlightMode;
  onResult: (value: string) => void;
  onCancel: () => void;
}

const POINTER_Y_OFFSET = 54;

function normalizeOcrNumberText(text: string): string {
  return normalizeNdcOcr(text).replace(/[—–]/g, '-');
}

function extractNumber(text: string, mode: HighlightMode): string | null {
  const normalized = normalizeOcrNumberText(text);

  if (mode === 'ndc') {
    const candidates = normalized.match(/[\d\s-]{10,16}/g) ?? [];
    const plausible = candidates
      .map((candidate) => candidate.trim())
      .filter((candidate) => {
        const digitLength = ndcDigits(candidate).length;
        return digitLength === 10 || digitLength === 11;
      })
      .sort((a, b) => ndcDigits(b).length - ndcDigits(a).length);
    return plausible[0] ?? null;
  }

  const candidates = normalized.match(/[\d\s-]{4,16}/g) ?? [];
  const plausible = candidates
    .map((candidate) => ndcDigits(candidate))
    .filter((candidate) => candidate.length >= 4)
    .sort((a, b) => b.length - a.length);
  return plausible[0] ?? null;
}

/**
 * Lets the person drag a box around a number on the photo themselves, since
 * automatic detection of the highlighted area isn't reliable enough across
 * different phones/lighting. The selection point is offset above the finger
 * so the user can see what they're marking while dragging.
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
      setError(`Drag a box around the ${mode === 'ndc' ? 'NDC' : 'Rx number'} first.`);
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
      const number = extractNumber(result.data.text, mode);
      if (!number) {
        setError(`Couldn't read a ${mode === 'ndc' ? 'valid NDC' : 'number'} in that area. Try selecting more tightly around just the digits.`);
        return;
      }
      onResult(number);
    } catch {
      setError('Reading that selection failed. Try again.');
    } finally {
      setReading(false);
    }
  }

  const label = mode === 'ndc' ? 'NDC' : 'Rx number';

  return (
    <div className="rx-picker">
      <p className="rx-picker-hint">
        Drag the box around the {label}. The selection appears about an inch above your finger so you can see it.
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
          {box && (
            <div
              className="rx-picker-box"
              style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
            />
          )}
        </div>
      )}
      {error && <p className="login-error">{error}</p>}
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel} disabled={reading}>
          Cancel
        </button>
        <button type="button" className="primary-button" onClick={() => void handleReadSelection()} disabled={reading}>
          {reading ? 'Reading…' : `Read ${label}`}
        </button>
      </div>
    </div>
  );
}
