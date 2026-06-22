import { useEffect, useRef, useState } from 'react';
import { recognize } from 'tesseract.js';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface RxHighlightPickerProps {
  image: Blob;
  onResult: (digits: string) => void;
  onCancel: () => void;
}

/**
 * Lets the person drag a box around the Rx# on the photo themselves, since
 * automatic detection of the highlighted area isn't reliable enough across
 * different phones/lighting. We crop tightly to exactly what they marked,
 * upscale it, and run OCR on just that, which reads far more accurately
 * than scanning the whole label.
 */
export default function RxHighlightPicker({ image, onResult, onCancel }: RxHighlightPickerProps) {
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
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function pointFromEvent(e: React.PointerEvent): { x: number; y: number } {
    const rect = containerRef.current!.getBoundingClientRect();
    return {
      x: Math.min(Math.max(e.clientX - rect.left, 0), rect.width),
      y: Math.min(Math.max(e.clientY - rect.top, 0), rect.height),
    };
  }

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault();
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

  function handlePointerUp() {
    dragStart.current = null;
  }

  async function handleReadSelection() {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container || !box || box.w < 8 || box.h < 8) {
      setError('Drag a box around the Rx number first.');
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
      ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, canvas.width, canvas.height);

      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
      if (!blob) throw new Error('crop failed');

      const result = await recognize(blob, 'eng');
      const digitGroups = result.data.text.match(/\d{4,10}/g) ?? [];
      if (digitGroups.length === 0) {
        setError("Couldn't read a number in that area. Try selecting more tightly around just the digits.");
        return;
      }
      const [longest] = digitGroups.sort((a, b) => b.length - a.length);
      if (!longest) {
        setError("Couldn't read a number in that area. Try selecting more tightly around just the digits.");
        return;
      }
      onResult(longest);
    } catch {
      setError('Reading that selection failed. Try again.');
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="rx-picker">
      <p className="rx-picker-hint">Drag a box tightly around the Rx number, then tap "Read selection".</p>
      {imageUrl && (
        <div
          ref={containerRef}
          className="rx-picker-stage"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
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
          {reading ? 'Reading…' : 'Read selection'}
        </button>
      </div>
    </div>
  );
}
