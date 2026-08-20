import sharp from "sharp";
import cvModule from "@techstark/opencv-js";

const CARD_W = 750;
const CARD_H = 1050;
const CARD_RATIO = 63 / 88;

type Point = { x: number; y: number };
type OpenCv = Awaited<typeof cvModule>;

let cvPromise: Promise<OpenCv> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function convexHull(points: Point[]) {
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  if (pts.length <= 3) return pts;

  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const point of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const point = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function toQuad(hull: Point[]) {
  if (hull.length < 4) return null;
  const pts = hull.map((point) => ({ ...point }));
  while (pts.length > 4) {
    let drop = 0;
    let smallest = Infinity;
    for (let i = 0; i < pts.length; i += 1) {
      const prev = pts[(i + pts.length - 1) % pts.length];
      const next = pts[(i + 1) % pts.length];
      const area = Math.abs(
        (pts[i].x - prev.x) * (next.y - prev.y) - (pts[i].y - prev.y) * (next.x - prev.x),
      );
      if (area < smallest) {
        smallest = area;
        drop = i;
      }
    }
    pts.splice(drop, 1);
  }
  return reorder(pts);
}

function reorder(corners: Point[]) {
  const sorted = [...corners].sort((a, b) => a.y - b.y);
  const top = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
  const bottom = sorted.slice(2).sort((a, b) => a.x - b.x);
  return [top[0], top[1], bottom[0], bottom[1]];
}

function scoreQuad(corners: Point[], width: number, height: number) {
  const [tl, tr, bl, br] = reorder(corners);
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  const short = Math.min(top, bottom, left, right);
  const long = Math.max(top, bottom, left, right);
  if (short < 16 || long < 24) return 0;
  const ratio = short / long;
  if (ratio < 0.48 || ratio > 0.9) return 0;
  const area =
    Math.abs(tl.x * tr.y + tr.x * br.y + br.x * bl.y + bl.x * tl.y) -
    Math.abs(tl.y * tr.x + tr.y * br.x + br.y * bl.x + bl.y * tl.x);
  const fill = Math.abs(area) / 2 / (width * height);
  if (fill < 0.07 || fill > 0.94) return 0;
  const parallel = 1 - Math.abs(top - bottom) / long - Math.abs(left - right) / long;
  return parallel * 45 + fill * 25 + (1 - Math.abs(ratio - CARD_RATIO)) * 30;
}

function largestBlob(mask: Uint8Array, w: number, h: number) {
  const seen = new Uint8Array(w * h);
  let best: number[] = [];

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const start = y * w + x;
      if (!mask[start] || seen[start]) continue;
      const stack = [start];
      const cells: number[] = [];
      seen[start] = 1;
      while (stack.length) {
        const i = stack.pop()!;
        cells.push(i);
        const cx = i % w;
        const cy = Math.floor(i / w);
        const next = [
          [cx - 1, cy],
          [cx + 1, cy],
          [cx, cy - 1],
          [cx, cy + 1],
        ];
        for (const [nx, ny] of next) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = ny * w + nx;
          if (seen[n] || !mask[n]) continue;
          seen[n] = 1;
          stack.push(n);
        }
      }
      if (cells.length > best.length) best = cells;
    }
  }

  return best;
}

function blobCorners(cells: number[], w: number) {
  const points: Point[] = [];
  const set = new Set(cells);
  for (const i of cells) {
    const x = i % w;
    const y = Math.floor(i / w);
    const edge = !set.has(i - 1) || !set.has(i + 1) || !set.has(i - w) || !set.has(i + w);
    if (edge) points.push({ x, y });
  }
  return points;
}

function solveHomography(src: Point[], dst: Point[]) {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = src[i];
    const u = dst[i].x;
    const v = dst[i].y;
    a.push([u, v, 1, 0, 0, 0, -x * u, -x * v]);
    b.push(x);
    a.push([0, 0, 0, u, v, 1, -y * u, -y * v]);
    b.push(y);
  }

  const n = 8;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    if (Math.abs(div) < 1e-8) return null;
    for (let j = col; j <= n; j += 1) m[col][j] /= div;
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = m[row][col];
      for (let j = col; j <= n; j += 1) m[row][j] -= factor * m[col][j];
    }
  }
  return m.map((row) => row[n]);
}

function sample(data: Buffer, w: number, h: number, x: number, y: number) {
  const x0 = clamp(Math.floor(x), 0, w - 2);
  const y0 = clamp(Math.floor(y), 0, h - 2);
  const dx = clamp(x - x0, 0, 1);
  const dy = clamp(y - y0, 0, 1);
  const idx = (px: number, py: number) => (py * w + px) * 3;
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c += 1) {
    const p00 = data[idx(x0, y0) + c];
    const p10 = data[idx(x0 + 1, y0) + c];
    const p01 = data[idx(x0, y0 + 1) + c];
    const p11 = data[idx(x0 + 1, y0 + 1) + c];
    out[c] = mix(mix(p00, p10, dx), mix(p01, p11, dx), dy);
  }
  return out;
}

async function getCv() {
  if (!cvPromise) {
    cvPromise = Promise.resolve(cvModule).then((mod) => {
      const cv = mod as OpenCv & { Mat?: unknown; onRuntimeInitialized?: () => void };
      if (cv.Mat) return cv;
      return new Promise<OpenCv>((resolve) => {
        cv.onRuntimeInitialized = () => resolve(cv);
      });
    });
  }
  return cvPromise;
}

function readQuad(mat: { rows: number; data32S: Int32Array }): Point[] | null {
  if (mat.rows !== 4) return null;
  const pts: Point[] = [];
  for (let i = 0; i < 4; i += 1) {
    pts.push({ x: mat.data32S[i * 2], y: mat.data32S[i * 2 + 1] });
  }
  return pts;
}

function collectQuads(cv: OpenCv, binary: InstanceType<OpenCv["Mat"]>, width: number, height: number) {
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const found: { corners: Point[]; score: number }[] = [];
  try {
    cv.findContours(binary, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const ranked: { index: number; area: number }[] = [];
    for (let i = 0; i < contours.size(); i += 1) {
      ranked.push({ index: i, area: cv.contourArea(contours.get(i)) });
    }
    ranked.sort((a, b) => b.area - a.area);
    for (const item of ranked.slice(0, 36)) {
      const contour = contours.get(item.index);
      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.03 * peri, true);
      const corners = readQuad(approx);
      approx.delete();
      if (!corners) continue;
      const score = scoreQuad(corners, width, height);
      if (score > 0) found.push({ corners: reorder(corners), score });
    }
  } finally {
    contours.delete();
    hierarchy.delete();
  }
  found.sort((a, b) => b.score - a.score);
  return found[0]?.corners ?? null;
}

async function findQuadOpenCv(gray: Buffer, width: number, height: number) {
  try {
    const cv = await getCv();
    const src = cv.matFromArray(height, width, cv.CV_8UC1, gray);
    const blur = new cv.Mat();
    const edges = new cv.Mat();
    const bin = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    try {
      cv.GaussianBlur(src, blur, new cv.Size(5, 5), 0);
      for (const [low, high] of [
        [40, 120],
        [20, 70],
        [70, 180],
      ]) {
        cv.Canny(blur, edges, low, high);
        cv.dilate(edges, edges, kernel);
        const quad = collectQuads(cv, edges, width, height);
        if (quad) return quad;
      }
      cv.threshold(blur, bin, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      return collectQuads(cv, bin, width, height);
    } finally {
      src.delete();
      blur.delete();
      edges.delete();
      bin.delete();
      kernel.delete();
    }
  } catch {
    return null;
  }
}

function findQuadBlob(gray: Buffer, w: number, h: number) {
  const mag = new Float32Array(w * h);
  let maxMag = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const gx = gray[y * w + x + 1] - gray[y * w + x - 1];
      const gy = gray[(y + 1) * w + x] - gray[(y - 1) * w + x];
      const value = Math.abs(gx) + Math.abs(gy);
      mag[y * w + x] = value;
      if (value > maxMag) maxMag = value;
    }
  }
  if (maxMag < 20) return null;

  const thresh = maxMag * 0.18;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mag.length; i += 1) {
    if (mag[i] >= thresh) mask[i] = 1;
  }

  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (mask[y * w + x]) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) n += mask[(y + dy) * w + x + dx];
      }
      if (n >= 5) mask[y * w + x] = 1;
    }
  }

  const blob = largestBlob(mask, w, h);
  if (blob.length < w * h * 0.08) return null;
  const hull = convexHull(blobCorners(blob, w));
  const quad = toQuad(hull);
  if (!quad || scoreQuad(quad, w, h) <= 0) return null;
  return quad;
}

async function warpToSize(input: Buffer, corners: Point[]) {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const h = solveHomography(corners, [
    { x: 0, y: 0 },
    { x: CARD_W, y: 0 },
    { x: 0, y: CARD_H },
    { x: CARD_W, y: CARD_H },
  ]);
  if (!h) return null;

  const out = Buffer.alloc(CARD_W * CARD_H * 3);
  for (let v = 0; v < CARD_H; v += 1) {
    for (let u = 0; u < CARD_W; u += 1) {
      const den = h[6] * u + h[7] * v + 1;
      const x = (h[0] * u + h[1] * v + h[2]) / den;
      const y = (h[3] * u + h[4] * v + h[5]) / den;
      const [r, g, b] = sample(data, info.width, info.height, x, y);
      const o = (v * CARD_W + u) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }

  return sharp(out, { raw: { width: CARD_W, height: CARD_H, channels: 3 } })
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function centerCardCrop(input: Buffer, width: number, height: number) {
  const ratio = width / height;
  if (ratio > 0.62 && ratio < 0.82) return input;
  const pad = 0.05;
  const maxW = width * (1 - pad * 2);
  const maxH = height * (1 - pad * 2);
  let cropH = maxH;
  let cropW = cropH * CARD_RATIO;
  if (cropW > maxW) {
    cropW = maxW;
    cropH = cropW / CARD_RATIO;
  }
  return sharp(input)
    .extract({
      left: Math.round((width - cropW) / 2),
      top: Math.round((height - cropH) / 2),
      width: Math.max(8, Math.round(cropW)),
      height: Math.max(8, Math.round(cropH)),
    })
    .jpeg({ quality: 95 })
    .toBuffer();
}

export async function flattenCard(input: Buffer) {
  const source = await sharp(input)
    .rotate()
    .resize({ width: 1800, height: 1800, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 92 })
    .toBuffer();

  const meta = await sharp(source).metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) return source;

  const probeW = 480;
  const probeH = Math.max(180, Math.round((probeW * height) / width));
  const { data } = await sharp(source)
    .greyscale()
    .normalize()
    .blur(0.8)
    .resize(probeW, probeH, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const quad = (await findQuadOpenCv(data, probeW, probeH)) ?? findQuadBlob(data, probeW, probeH);
  if (quad) {
    const mapped = quad.map((point) => ({
      x: (point.x / probeW) * width,
      y: (point.y / probeH) * height,
    }));
    const cx = mapped.reduce((sum, point) => sum + point.x, 0) / 4;
    const cy = mapped.reduce((sum, point) => sum + point.y, 0) / 4;
    const corners = mapped.map((point) => ({
      x: clamp(point.x + (point.x - cx) * 0.04, 0, width - 1),
      y: clamp(point.y + (point.y - cy) * 0.07, 0, height - 1),
    }));
    const card = await warpToSize(source, corners);
    if (card) return card;
  }

  return centerCardCrop(source, width, height);
}
