import sharp from "sharp";

const CARD_RATIO = 63 / 88;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

async function stampOnly(input: Buffer) {
  const resized = await sharp(input)
    .rotate()
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 95 })
    .toBuffer();
  const { width, height } = await sharp(resized).metadata();
  if (!width || !height) return resized;

  const ratio = width / Math.max(height, 1);
  const looksLikeCard = Math.abs(Math.log(ratio / CARD_RATIO)) < 0.18;
  if (!looksLikeCard && ratio > 1.8) return resized;

  return sharp(resized)
    .extract(extractBox(width, height, 0.0, 0.90, 0.50, 1))
    .jpeg({ quality: 95 })
    .toBuffer();
}

function scale(input: Buffer, height: number) {
  return sharp(input).resize({ height, withoutEnlargement: false });
}

export async function prepareStamp(input: Buffer) {
  const stamp = await stampOnly(input);

  const [contrast, inv, ink, digits] = await Promise.all([
    scale(stamp, 260).greyscale().normalize().linear(1.25, -12).sharpen({ sigma: 1.4 }).png().toBuffer(),
    scale(stamp, 260).greyscale().normalize().negate().threshold(150).png().toBuffer(),
    scale(stamp, 260).greyscale().normalize().negate().sharpen({ sigma: 1.6 }).png().toBuffer(),
    scale(stamp, 220).greyscale().normalize().negate().blur(1).threshold(146).png().toBuffer(),
  ]);

  return { contrast, ink, inv, digits };
}

export async function extractIllustration(input: Buffer) {
  const { width, height } = await sharp(input).metadata();
  if (!width || !height) return null;
  return sharp(input)
    .extract(extractBox(width, height, 0.07, 0.17, 0.93, 0.61))
    .jpeg({ quality: 90 })
    .toBuffer();
}
