// How the answers of several locator calls are combined into one box (used by /api/locate-ids).

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function iou(a: Box, b: Box): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  const total = (a.right - a.left) * (a.bottom - a.top) + (b.right - b.left) * (b.bottom - b.top) - inter;
  return inter / total;
}

export function union(boxes: Box[]): Box {
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom)),
  };
}

/**
 * Keep the boxes that overlap at least one other answer's box, and merge them. Fewer than two agreeing answers means the
 * position is unconfirmed (null).
 *
 * With `neighbours`, an answer that sits in the same column just above or below the agreed box (within one box height) is
 * merged in as well. Used for salary slips, where the model's answers often land one row apart and every row it could
 * mean holds an identifier anyway, so covering both costs nothing. Not used for identity cards: there a neighbouring line
 * is the name or the date of birth, which the form needs.
 */
export function agreed(boxes: Box[], opts: { neighbours?: boolean } = {}): Box | null {
  const keep = boxes.filter((b, i) => boxes.some((o, j) => j !== i && iou(b, o) >= 0.3));
  if (keep.length < 2) return null;
  const core = union(keep);
  if (!opts.neighbours) return core;
  const h = Math.max(...keep.map((b) => b.bottom - b.top));
  const near = boxes.filter((b) => {
    if (keep.includes(b)) return false;
    const sameColumn = Math.min(b.right, core.right) - Math.max(b.left, core.left) > 0;
    const gap = Math.max(b.top - core.bottom, core.top - b.bottom);
    return sameColumn && gap <= h;
  });
  return union([core, ...near]);
}
