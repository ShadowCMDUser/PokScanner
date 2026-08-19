import sharp from "sharp";

export async function prepareForOcr(input: Buffer) {
  const rotated = sharp(input).rotate();
  const resized = await rotated
    .clone()
    .resize({
      width: 1400,
      height: 1400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .toBuffer();

  const { width, height } = await sharp(resized).metadata();
  if (!width || !height) {
    throw new Error("Kon de afbeelding niet lezen");
  }

  const topHeight = Math.max(48, Math.round(height * 0.18));
  const bottomHeight = Math.max(56, Math.round(height * 0.16));

  const enhance = (pipeline: sharp.Sharp) =>
    pipeline
      .greyscale()
      .normalize()
      .modulate({ brightness: 1.08 })
      .sharpen({ sigma: 1.1 })
      .png();

  const [full, top, bottom] = await Promise.all([
    enhance(sharp(resized)).toBuffer(),
    enhance(
      sharp(resized).extract({
        left: 0,
        top: 0,
        width,
        height: topHeight,
      }),
    ).toBuffer(),
    enhance(
      sharp(resized).extract({
        left: 0,
        top: height - bottomHeight,
        width,
        height: bottomHeight,
      }),
    ).toBuffer(),
  ]);

  return { full, top, bottom };
}
