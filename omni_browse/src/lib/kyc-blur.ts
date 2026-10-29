// Browser-independent blur for the privacy shield.
//
// The shield sends only heavily blurred copies of a document to the locator models, so the blur has
// to behave the same in every browser. Canvas drawImage with a large downscale does not: Chrome
// averages the pixels, Firefox takes a few samples, which leaves a sharp, aliased picture (a face
// stays recognisable, printed text turns into black blocks). So the average is computed here, by
// hand, with a summed-area table, and only the final enlargement is left to the browser.

/** Average the pixels of a canvas down to width x height (a box filter). */
export function areaDownscale(src: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement {
  const sw = src.width;
  const sh = src.height;
  const data = src.getContext('2d')!.getImageData(0, 0, sw, sh).data;
  // Summed-area table, one plane per channel, (sw + 1) x (sh + 1).
  const stride = sw + 1;
  const planes = [0, 1, 2].map(() => new Float64Array(stride * (sh + 1)));
  for (let y = 0; y < sh; y++) {
    const row = [0, 0, 0];
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4;
      for (let c = 0; c < 3; c++) {
        row[c] += data[i + c];
        planes[c][(y + 1) * stride + (x + 1)] = planes[c][y * stride + (x + 1)] + row[c];
      }
    }
  }
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const octx = out.getContext('2d')!;
  const img = octx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor((y * sh) / height);
    const y1 = Math.max(y0 + 1, Math.ceil(((y + 1) * sh) / height));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor((x * sw) / width);
      const x1 = Math.max(x0 + 1, Math.ceil(((x + 1) * sw) / width));
      const area = (x1 - x0) * (y1 - y0);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const p = planes[c];
        const sum = p[y1 * stride + x1] - p[y0 * stride + x1] - p[y1 * stride + x0] + p[y0 * stride + x0];
        img.data[o + c] = Math.round(sum / area);
      }
      img.data[o + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

/** A copy of the image averaged down to `width` px wide and enlarged back to its own size. */
export function blurCopy(img: HTMLImageElement, width: number): string {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const full = document.createElement('canvas');
  full.width = w;
  full.height = h;
  const fctx = full.getContext('2d')!;
  fctx.fillStyle = '#ffffff';
  fctx.fillRect(0, 0, w, h);
  fctx.drawImage(img, 0, 0);
  const small = areaDownscale(full, width, Math.max(1, Math.round((width * h) / w)));
  const big = document.createElement('canvas');
  big.width = w;
  big.height = h;
  const bctx = big.getContext('2d')!;
  bctx.imageSmoothingEnabled = true;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  return big.toDataURL('image/png');
}
