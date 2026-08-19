import sharp from "sharp";

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

function stampPipeline(input: Buffer, height = 240) {
  return sharp(input).rotate().resize({ height, withoutEnlargement: false });
}

export async function prepareStamp(input: Buffer) {
  const [contrast, inv, ink, digits] = await Promise.all([
    stampPipeline(input)
      .greyscale()
      .normalize()
      .linear(1.3, -16)
      .sharpen({ sigma: 1.5 })
      .png()
      .toBuffer(),
    stampPipeline(input)
      .greyscale()
      .normalize()
      .negate()
      .threshold(155)
      .png()
      .toBuffer(),
    stampPipeline(input)
      .greyscale()
      .normalize()
      .negate()
      .sharpen({ sigma: 1.6 })
      .png()
      .toBuffer(),
    stampPipeline(input, 220)
      .greyscale()
      .normalize()
      .negate()
      .blur(0.9)
      .threshold(148)
      .png()
      .toBuffer(),
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
