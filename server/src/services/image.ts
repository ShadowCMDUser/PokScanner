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

function morph(src: Buffer, width: number, height: number, dilate: boolean, radius: number) {
  const out = Buffer.alloc(src.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let value = dilate ? 0 : 255;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const pixel = src[ny * width + nx];
          value = dilate ? Math.max(value, pixel) : Math.min(value, pixel);
        }
      }
      out[y * width + x] = value;
    }
  }
  return out;
}

async function fillOutlined(input: Buffer, height: number) {
  const { data, info } = await sharp(input)
    .resize({ height, withoutEnlargement: false, kernel: "lanczos3" })
    .greyscale()
    .normalize()
    .linear(1.45, -18)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let sum = 0;
  for (const pixel of data) sum += pixel;
  const mean = sum / Math.max(data.length, 1);
  const darkBg = mean < 118;
  const bin = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    const isText = darkBg ? data[i] > mean + 10 : data[i] < mean - 10;
    bin[i] = isText ? 255 : 0;
  }

  const closed = morph(morph(bin, info.width, info.height, true, 2), info.width, info.height, false, 1);
  return sharp(closed, { raw: { width: info.width, height: info.height, channels: 1 } })
    .png()
    .toBuffer();
}

function scaleGray(input: Buffer, height: number) {
  return sharp(input).resize({ height, withoutEnlargement: false, kernel: "lanczos3" }).greyscale().normalize();
}

async function variantsFor(crop: Buffer): Promise<Buffer[]> {
  const stats = await sharp(crop).greyscale().stats();
  const dark = stats.channels[0].mean < 80;
  const [ink, contrast, inv, filled, digits] = await Promise.all([
    scaleGray(crop, 300).negate().sharpen({ sigma: 1.3 }).png().toBuffer(),
    scaleGray(crop, 300).linear(1.3, -14).sharpen({ sigma: 1.1 }).png().toBuffer(),
    scaleGray(crop, 280).negate().threshold(148).png().toBuffer(),
    fillOutlined(crop, 280),
    scaleGray(crop, 260).negate().blur(0.9).threshold(150).png().toBuffer(),
  ]);
  return dark ? [filled, ink, contrast, inv, digits] : [ink, contrast, inv, filled, digits];
}

async function cardCrops(input: Buffer, width: number, height: number) {
  const boxes = [
    extractBox(width, height, 0.0, 0.86, 0.66, 1.0),
    extractBox(width, height, 0.0, 0.92, 0.58, 1.0),
    extractBox(width, height, 0.0, 0.88, 0.4, 0.99),
  ];
  return Promise.all(
    boxes.map((box) => sharp(input).rotate().extract(box).jpeg({ quality: 95 }).toBuffer()),
  );
}

export async function extractIllustration(input: Buffer) {
  const { width, height } = await sharp(input).metadata();
  if (!width || !height) return null;
  return sharp(input)
    .extract(extractBox(width, height, 0.07, 0.17, 0.93, 0.61))
    .jpeg({ quality: 90 })
    .toBuffer();
}

export async function prepareStamp(input: Buffer): Promise<Buffer[]> {
  const rotated = sharp(input).rotate();
  const { width, height } = await rotated.metadata();
  if (!width || !height) return variantsFor(input);

  const ratio = width / height;
  const stampStrip = ratio >= 1.8 && height <= 520;
  const crops = stampStrip
    ? [await rotated.jpeg({ quality: 95 }).toBuffer()]
    : await cardCrops(input, width, height);

  const [primary, ...extra] = crops;
  const passes = await variantsFor(primary);
  if (!extra.length) return passes;

  const extras = await Promise.all(
    extra.map(async (crop) => {
      const [ink, contrast] = await Promise.all([
        scaleGray(crop, 280).negate().sharpen({ sigma: 1.3 }).png().toBuffer(),
        scaleGray(crop, 280).linear(1.35, -16).png().toBuffer(),
      ]);
      return [ink, contrast];
    }),
  );
  return [...passes, ...extras.flat()].slice(0, 7);
}
