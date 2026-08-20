import sharp, { type Sharp } from "sharp";

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

function scaleGray(input: Sharp, height: number) {
  return input.resize({ height, withoutEnlargement: false, kernel: "lanczos3" }).greyscale().normalize();
}

/** Morphological close on white glyphs: dilate then erode, all in libvips. */
async function fillOutlined(gray: Sharp) {
  const boosted = gray.linear(1.45, -18);
  const { channels } = await boosted.clone().stats();
  const darkBg = (channels[0]?.mean ?? 128) < 118;
  const textWhite = darkBg ? boosted : boosted.negate();

  return textWhite
    .blur(1.2)
    .threshold(100)
    .negate()
    .blur(0.75)
    .threshold(100)
    .negate()
    .png()
    .toBuffer();
}

async function variantsFor(crop: Buffer): Promise<Buffer[]> {
  const prepared = scaleGray(sharp(crop), 300);
  const { channels } = await prepared.clone().stats();
  const dark = (channels[0]?.mean ?? 128) < 80;

  const [ink, contrast, inv, filled, digits] = await Promise.all([
    prepared.clone().negate().sharpen({ sigma: 1.3 }).png().toBuffer(),
    prepared.clone().linear(1.3, -14).sharpen({ sigma: 1.1 }).png().toBuffer(),
    prepared.clone().resize({ height: 280, withoutEnlargement: false }).negate().threshold(148).png().toBuffer(),
    fillOutlined(prepared.clone().resize({ height: 280, withoutEnlargement: false })),
    prepared
      .clone()
      .resize({ height: 260, withoutEnlargement: false })
      .negate()
      .blur(0.9)
      .threshold(150)
      .png()
      .toBuffer(),
  ]);

  return dark ? [filled, ink, contrast, inv, digits] : [ink, contrast, inv, filled, digits];
}

async function cardCrops(source: Sharp, width: number, height: number) {
  const boxes = [
    extractBox(width, height, 0.0, 0.86, 0.66, 1.0),
    extractBox(width, height, 0.0, 0.92, 0.58, 1.0),
    extractBox(width, height, 0.0, 0.88, 0.4, 0.99),
  ];
  return Promise.all(boxes.map((box) => source.clone().extract(box).jpeg({ quality: 95 }).toBuffer()));
}

export async function extractIllustration(input: Buffer) {
  try {
    const image = sharp(input);
    const { width, height } = await image.clone().metadata();
    if (!width || !height) return null;
    return image
      .extract(extractBox(width, height, 0.07, 0.17, 0.93, 0.61))
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function prepareStamp(input: Buffer): Promise<Buffer[]> {
  try {
    const rotated = sharp(input).rotate();
    const { width, height } = await rotated.clone().metadata();
    if (!width || !height) return variantsFor(input);

    const ratio = width / height;
    const stampStrip = ratio >= 1.8 && height <= 520;
    const crops = stampStrip
      ? [await rotated.clone().jpeg({ quality: 95 }).toBuffer()]
      : await cardCrops(rotated, width, height);

    const [primary, ...extra] = crops;
    const passes = await variantsFor(primary);
    if (!extra.length) return passes;

    const extras = await Promise.all(
      extra.map(async (crop) => {
        const gray = scaleGray(sharp(crop), 280);
        const [ink, contrast] = await Promise.all([
          gray.clone().negate().sharpen({ sigma: 1.3 }).png().toBuffer(),
          gray.clone().linear(1.35, -16).png().toBuffer(),
        ]);
        return [ink, contrast];
      }),
    );
    return [...passes, ...extras.flat()].slice(0, 7);
  } catch {
    return [];
  }
}
