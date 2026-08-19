import sharp from "sharp";

const CARD_RATIO = 63 / 88;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function snapToCardAspect(
  left: number,
  top: number,
  boxW: number,
  boxH: number,
  width: number,
  height: number,
) {
  const cx = left + boxW / 2;
  const cy = top + boxH / 2;
  let w = boxW;
  let h = boxH;
  if (w / Math.max(h, 1) > CARD_RATIO) h = w / CARD_RATIO;
  else w = h * CARD_RATIO;

  const scale = Math.min(1, (width - 2) / w, (height - 2) / h);
  w = Math.max(24, Math.round(w * scale));
  h = Math.max(32, Math.round(h * scale));
  const snappedLeft = clamp(Math.round(cx - w / 2), 0, width - w);
  const snappedTop = clamp(Math.round(cy - h / 2), 0, height - h);
  return { left: snappedLeft, top: snappedTop, width: w, height: h };
}

function mapProbeBox(
  left: number,
  top: number,
  right: number,
  bottom: number,
  probeW: number,
  probeH: number,
  width: number,
  height: number,
  pad = 0.03,
) {
  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  const padX = Math.round(boxW * pad);
  const padY = Math.round(boxH * pad);
  const mappedLeft = ((left - padX) / probeW) * width;
  const mappedTop = ((top - padY) / probeH) * height;
  const mappedW = ((right + padX + 1) / probeW) * width - mappedLeft;
  const mappedH = ((bottom + padY + 1) / probeH) * height - mappedTop;
  return snapToCardAspect(mappedLeft, mappedTop, mappedW, mappedH, width, height);
}

function aspectScore(width: number, height: number) {
  const ratio = width / Math.max(height, 1);
  return Math.abs(Math.log(ratio / CARD_RATIO));
}

async function detectCardBox(image: Buffer, width: number, height: number) {
  const probeW = 180;
  const probeH = Math.max(90, Math.round((probeW * height) / width));
  const { data, info } = await sharp(image)
    .greyscale()
    .resize(probeW, probeH, { fit: "fill" })
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;
  const candidates: { left: number; top: number; width: number; height: number }[] = [];

  let sum = 0;
  for (let i = 0; i < data.length; i += 1) sum += data[i];
  const mean = sum / data.length;
  const brightThresh = Math.min(210, mean + 24);

  let bMinX = w;
  let bMinY = h;
  let bMaxX = 0;
  let bMaxY = 0;
  let brightHits = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      if (data[y * w + x] < brightThresh) continue;
      brightHits += 1;
      if (x < bMinX) bMinX = x;
      if (y < bMinY) bMinY = y;
      if (x > bMaxX) bMaxX = x;
      if (y > bMaxY) bMaxY = y;
    }
  }

  if (brightHits > data.length * 0.08 && bMaxX - bMinX > w * 0.28 && bMaxY - bMinY > h * 0.28) {
    candidates.push(mapProbeBox(bMinX, bMinY, bMaxX, bMaxY, w, h, width, height, 0.02));
  }

  const rowEnergy = new Array<number>(h).fill(0);
  const colEnergy = new Array<number>(w).fill(0);
  for (let y = 0; y < h; y += 1) {
    for (let x = 1; x < w; x += 1) {
      const diff = Math.abs(data[y * w + x] - data[y * w + x - 1]);
      rowEnergy[y] += diff;
      colEnergy[x] += diff;
    }
  }

  const rowThresh = [...rowEnergy].sort((a, b) => a - b)[Math.floor(h * 0.4)] ?? 0;
  const colThresh = [...colEnergy].sort((a, b) => a - b)[Math.floor(w * 0.4)] ?? 0;
  let top = 0;
  let bottom = h - 1;
  let left = 0;
  let right = w - 1;
  while (top < h * 0.35 && rowEnergy[top] < rowThresh) top += 1;
  while (bottom > h * 0.65 && rowEnergy[bottom] < rowThresh) bottom -= 1;
  while (left < w * 0.35 && colEnergy[left] < colThresh) left += 1;
  while (right > w * 0.65 && colEnergy[right] < colThresh) right -= 1;

  if (right - left + 1 > w * 0.32 && bottom - top + 1 > h * 0.32) {
    candidates.push(mapProbeBox(left, top, right, bottom, w, h, width, height));
  }

  if (!candidates.length) {
    return snapToCardAspect(0, 0, width, height, width, height);
  }

  return candidates.sort((a, b) => aspectScore(a.width, a.height) - aspectScore(b.width, b.height))[0];
}

function extractBox(
  width: number,
  height: number,
  leftPct: number,
  topPct: number,
  rightPct: number,
  bottomPct: number,
) {
  const left = clamp(Math.round(width * leftPct), 0, width - 4);
  const top = clamp(Math.round(height * topPct), 0, height - 4);
  const right = clamp(Math.round(width * rightPct), left + 4, width);
  const bottom = clamp(Math.round(height * bottomPct), top + 4, height);
  return { left, top, width: right - left, height: bottom - top };
}

const enhanceNumbers = (pipeline: sharp.Sharp) =>
  pipeline
    .greyscale()
    .normalize()
    .linear(1.35, -20)
    .sharpen({ sigma: 1.6 })
    .png();

export async function prepareStamp(input: Buffer) {
  const resized = await sharp(input)
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 92 })
    .toBuffer();

  const { width, height } = await sharp(resized).metadata();
  if (!width || !height) {
    throw new Error("Kon de afbeelding niet lezen");
  }

  const alreadyCard = Math.abs(Math.log(width / Math.max(height, 1) / CARD_RATIO)) < 0.08;
  const cardBox = alreadyCard
    ? { left: 0, top: 0, width, height }
    : await detectCardBox(resized, width, height);
  const card = await sharp(resized).extract(cardBox).toBuffer();
  const cardMeta = await sharp(card).metadata();
  const cw = cardMeta.width ?? cardBox.width;
  const ch = cardMeta.height ?? cardBox.height;

  const line = extractBox(cw, ch, 0.0, 0.888, 0.64, 0.968);

  const [contrast, ink, inv] = await Promise.all([
    enhanceNumbers(sharp(card).extract(line).resize({ height: 200, withoutEnlargement: false })).toBuffer(),
    sharp(card)
      .extract(line)
      .resize({ height: 200, withoutEnlargement: false })
      .greyscale()
      .normalize()
      .linear(1.5, -32)
      .threshold(152)
      .png()
      .toBuffer(),
    sharp(card)
      .extract(line)
      .resize({ height: 200, withoutEnlargement: false })
      .greyscale()
      .normalize()
      .negate()
      .threshold(170)
      .png()
      .toBuffer(),
  ]);

  return { contrast, ink, inv };
}

export async function extractIllustration(input: Buffer) {
  const { width, height } = await sharp(input).metadata();
  if (!width || !height) return null;
  return sharp(input)
    .extract(extractBox(width, height, 0.07, 0.17, 0.93, 0.61))
    .jpeg({ quality: 90 })
    .toBuffer();
}
