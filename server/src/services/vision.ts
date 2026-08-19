import sharp from "sharp";
import { extractIllustration } from "./image.js";
import { cardImageUrl } from "./tcgdex.js";

const hashCache = new Map<string, bigint>();
const HASH_CACHE_MAX = 1500;

function remember(url: string, hash: bigint) {
  if (hashCache.size >= HASH_CACHE_MAX) {
    const first = hashCache.keys().next().value;
    if (first) hashCache.delete(first);
  }
  hashCache.set(url, hash);
}

export async function differenceHash(input: Buffer) {
  const { data } = await sharp(input)
    .greyscale()
    .normalize()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let y = 0; y < 8; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      if (data[y * 9 + x] > data[y * 9 + x + 1]) {
        hash |= 1n << BigInt(y * 8 + x);
      }
    }
  }
  return hash;
}

export function hamming(a: bigint, b: bigint) {
  let xor = a ^ b;
  let count = 0;
  while (xor) {
    xor &= xor - 1n;
    count += 1;
  }
  return count;
}

export async function readFoilHint(art: Buffer) {
  const { data, info } = await sharp(art)
    .resize(80, 80, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hot = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += 3) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    if (max > 235 && max - min < 28) hot += 1;
  }
  return hot / total > 0.08;
}

async function hashFromUrl(url: string) {
  const cached = hashCache.get(url);
  if (cached !== undefined) return cached;

  const response = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return null;
  const buffer = Buffer.from(await response.arrayBuffer());
  const art = (await extractIllustration(buffer)) ?? buffer;
  const hash = await differenceHash(art);
  remember(url, hash);
  return hash;
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function artworkScores(scanHash: bigint, imageBases: (string | undefined)[]) {
  return mapPool(imageBases, 8, async (image) => {
    const url = cardImageUrl(image, "low");
    if (!url) return 0;
    try {
      const catalogHash = await hashFromUrl(url);
      if (catalogHash == null) return 0;
      const distance = hamming(scanHash, catalogHash);
      if (distance > 22) return 0;
      return Math.round(((64 - distance) / 64) * 100);
    } catch {
      return 0;
    }
  });
}
