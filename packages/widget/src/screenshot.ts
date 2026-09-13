export interface ScreenshotPoint { x: number; y: number; }
export interface ScreenshotRegion { x: number; y: number; width: number; height: number; }
export type ScreenshotAnnotation =
  | ({ type: "pen"; points: readonly ScreenshotPoint[]; color?: string; lineWidth?: number })
  | ({ type: "rectangle"; color?: string; lineWidth?: number } & ScreenshotRegion)
  | ({ type: "arrow"; from: ScreenshotPoint; to: ScreenshotPoint; color?: string; lineWidth?: number })
  | ({ type: "text"; x: number; y: number; text: string; color?: string; fontSize?: number })
  | ({ type: "highlight"; color?: string } & ScreenshotRegion)
  | ({ type: "blur"; radius?: number } & ScreenshotRegion);
export interface ScreenshotEditOptions { annotations?: readonly ScreenshotAnnotation[]; masks?: readonly ScreenshotRegion[]; }

const MAX_DIMENSION = 16_384;
const MAX_PIXELS = 40_000_000;
const MAX_ANNOTATIONS = 100;
const MAX_PEN_POINTS = 5_000;

function finite(...values: number[]): boolean { return values.every(Number.isFinite); }
function bounded(value: number | undefined, fallback: number, min: number, max: number): number { return Math.min(Math.max(value ?? fallback, min), max); }
function regionIsValid(region: ScreenshotRegion): boolean { return finite(region.x, region.y, region.width, region.height) && region.width > 0 && region.height > 0; }
function clipRegion(region: ScreenshotRegion, width: number, height: number): ScreenshotRegion | undefined { const x = Math.max(0, Math.min(width, region.x)); const y = Math.max(0, Math.min(height, region.y)); const right = Math.max(0, Math.min(width, region.x + region.width)); const bottom = Math.max(0, Math.min(height, region.y + region.height)); return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined; }

/** Applies annotations in-browser and paints privacy masks last before returning a host-stored PNG. */
export async function editScreenshot(source: Blob, options: ScreenshotEditOptions = {}): Promise<Blob> {
  const annotations = options.annotations ?? []; const masks = options.masks ?? [];
  if (annotations.length > MAX_ANNOTATIONS) throw new Error(`Screenshot annotations are limited to ${MAX_ANNOTATIONS}.`);
  if (masks.some((mask) => !regionIsValid(mask))) throw new Error("Screenshot masks require finite, positive regions.");
  const bitmap = await createImageBitmap(source);
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width > MAX_DIMENSION || bitmap.height > MAX_DIMENSION || bitmap.width * bitmap.height > MAX_PIXELS) throw new Error("Screenshot dimensions exceed the safe editing limit.");
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height; const context = canvas.getContext("2d"); if (!context) throw new Error("Canvas editing is unavailable."); context.drawImage(bitmap, 0, 0);
    for (const annotation of annotations) {
      context.save();
      if (annotation.type === "pen") {
        if (annotation.points.length > MAX_PEN_POINTS) throw new Error(`Pen annotations are limited to ${MAX_PEN_POINTS} points.`);
        if (annotation.points.some((point) => !finite(point.x, point.y))) throw new Error("Pen points must be finite.");
        if (annotation.points.length) { context.beginPath(); context.moveTo(annotation.points[0].x, annotation.points[0].y); for (const point of annotation.points.slice(1)) context.lineTo(point.x, point.y); context.strokeStyle = annotation.color ?? "#ef4444"; context.lineWidth = bounded(annotation.lineWidth, 3, 1, 32); context.lineCap = "round"; context.lineJoin = "round"; context.stroke(); }
      } else if (annotation.type === "rectangle") {
        if (!regionIsValid(annotation)) throw new Error("Rectangle annotations require finite, positive regions."); context.strokeStyle = annotation.color ?? "#ef4444"; context.lineWidth = bounded(annotation.lineWidth, 3, 1, 32); context.strokeRect(annotation.x, annotation.y, annotation.width, annotation.height);
      } else if (annotation.type === "arrow") {
        if (!finite(annotation.from.x, annotation.from.y, annotation.to.x, annotation.to.y)) throw new Error("Arrow points must be finite."); const angle = Math.atan2(annotation.to.y - annotation.from.y, annotation.to.x - annotation.from.x); const head = 10; context.beginPath(); context.moveTo(annotation.from.x, annotation.from.y); context.lineTo(annotation.to.x, annotation.to.y); context.lineTo(annotation.to.x - head * Math.cos(angle - Math.PI / 6), annotation.to.y - head * Math.sin(angle - Math.PI / 6)); context.moveTo(annotation.to.x, annotation.to.y); context.lineTo(annotation.to.x - head * Math.cos(angle + Math.PI / 6), annotation.to.y - head * Math.sin(angle + Math.PI / 6)); context.strokeStyle = annotation.color ?? "#ef4444"; context.lineWidth = bounded(annotation.lineWidth, 3, 1, 32); context.stroke();
      } else if (annotation.type === "text") {
        if (!finite(annotation.x, annotation.y)) throw new Error("Text coordinates must be finite."); context.fillStyle = annotation.color ?? "#ef4444"; context.font = `${bounded(annotation.fontSize, 18, 8, 96)}px sans-serif`; context.fillText(annotation.text.slice(0, 500), annotation.x, annotation.y);
      } else if (annotation.type === "highlight") {
        if (!regionIsValid(annotation)) throw new Error("Highlights require finite, positive regions."); context.fillStyle = annotation.color ?? "rgba(250, 204, 21, 0.35)"; context.fillRect(annotation.x, annotation.y, annotation.width, annotation.height);
      } else {
        if (!regionIsValid(annotation)) throw new Error("Blur annotations require finite, positive regions."); const clipped = clipRegion(annotation, canvas.width, canvas.height); if (clipped) { const temporary = document.createElement("canvas"); temporary.width = Math.ceil(clipped.width); temporary.height = Math.ceil(clipped.height); const temporaryContext = temporary.getContext("2d"); if (!temporaryContext) throw new Error("Canvas editing is unavailable."); temporaryContext.drawImage(canvas, clipped.x, clipped.y, clipped.width, clipped.height, 0, 0, temporary.width, temporary.height); context.filter = `blur(${bounded(annotation.radius, 8, 1, 32)}px)`; context.drawImage(temporary, clipped.x, clipped.y, clipped.width, clipped.height); }
      }
      context.restore();
    }
    context.save(); context.fillStyle = "#111111"; for (const mask of masks) context.fillRect(mask.x, mask.y, mask.width, mask.height); context.restore();
    const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")); if (!output) throw new Error("Screenshot export failed."); return output;
  } finally { bitmap.close(); }
}
