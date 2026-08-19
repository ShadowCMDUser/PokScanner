import sharp from "sharp";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

async function detectCardBox(image: Buffer, width: number, height: number) {
  const probeW = 160;
  const probeH = Math.max(80, Math.round((probeW * height) / width));
  const { data, info } = await sharp(image)
    .greyscale()
    .resize(probeW, probeH, { fit: "fill" })
    .normalize()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const w = info.width;
  const h = info.height;

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

  const boxW = right - left + 1;
  const boxH = bottom - top + 1;
  if (boxW < w * 0.35 || boxH < h * 0.35) {
    return { left: 0, top: 0, width, height };
  }

  const padX = Math.round(boxW * 0.04);
  const padY = Math.round(boxH * 0.03);
  const mappedLeft = clamp(Math.round(((left - padX) / w) * width), 0, width - 8);
  const mappedTop = clamp(Math.round(((top - padY) / h) * height), 0, height - 8);
  const mappedRight = clamp(Math.round(((right + padX + 1) / w) * width), mappedLeft + 8, width);
  const mappedBottom = clamp(Math.round(((bottom + padY + 1) / h) * height), mappedTop + 8, height);

  return {
    left: mappedLeft,
    top: mappedTop,
    width: mappedRight - mappedLeft,
    height: mappedBottom - mappedTop,
  };
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

const enhanceText = (pipeline: sharp.Sharp) =>
  pipeline
    .greyscale()
    .normalize()
    .modulate({ brightness: 1.12 })
    .sharpen({ sigma: 1.4 })
    .png();

const enhanceNumbers = (pipeline: sharp.Sharp) =>
  pipeline
    .greyscale()
    .normalize()
    .linear(1.35, -20)
    .sharpen({ sigma: 1.6 })
    .png();

export async function prepareForOcr(input: Buffer) {
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

  const cardBox = await detectCardBox(resized, width, height);
  const card = await sharp(resized).extract(cardBox).toBuffer();
  const cardMeta = await sharp(card).metadata();
  const cw = cardMeta.width ?? cardBox.width;
  const ch = cardMeta.height ?? cardBox.height;

  const nameBox = extractBox(cw, ch, 0.03, 0.03, 0.72, 0.18);
  const numberBox = extractBox(cw, ch, 0.0, 0.82, 1, 0.99);

  const [full, top, bottom, bottomInk] = await Promise.all([
    enhanceText(sharp(card).resize({ width: 1100, withoutEnlargement: true })).toBuffer(),
    enhanceText(sharp(card).extract(nameBox).resize({ width: 900, withoutEnlargement: false })).toBuffer(),
    enhanceNumbers(sharp(card).extract(numberBox).resize({ width: 1000, withoutEnlargement: false })).toBuffer(),
    sharp(card)
      .extract(numberBox)
      .resize({ width: 1000, withoutEnlargement: false })
      .greyscale()
      .normalize()
      .threshold(148)
      .png()
      .toBuffer(),
  ]);

  return { full, top, bottom, bottomInk };
}
