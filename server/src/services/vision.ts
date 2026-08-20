import sharp from "sharp";
import { extractIllustration } from "./image.js";
import { cardImageUrl, setSymbolUrl } from "./tcgdex.js";

const hashCache = new Map<string, Promise<bigint | null>>();
const HASH_CACHE_MAX = 1500;
const MAX_HASH_BYTES = 5 * 1024 * 1024;

function touchCache(key: string, value: Promise<bigint | null>) {
  hashCache.delete(key);
  hashCache.set(key, value);
  while (hashCache.size > HASH_CACHE_MAX) {
    const oldest = hashCache.keys().next().value;
    if (oldest === undefined) break;
    hashCache.delete(oldest);
  }
}

export async function differenceHash(input: Buffer) {
  const { data } = await sharp(input)
    .greyscale()
    .normalize()
    .resize(17, 16, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = 0n;
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      if (data[y * 17 + x] > data[y * 17 + x + 1]) {
        hash |= 1n << BigInt(y * 16 + x);
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

export async function symbolHash(input: Buffer) {
  try {
    const trimmed = await sharp(input).trim({ threshold: 28 }).png().toBuffer();
    return differenceHash(trimmed);
  } catch {
    return differenceHash(input);
  }
}

async function loadHash(url: string, cropArt: boolean, trim: boolean): Promise<bigint | null> {
  const response = await fetch(url, {
    headers: { Accept: "image/*" },
    signal: AbortSignal.timeout(4000),
  });
  if (!response.ok) return null;

  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_HASH_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_HASH_BYTES) return null;

  const source = cropArt ? ((await extractIllustration(buffer)) ?? buffer) : buffer;
  return trim ? await symbolHash(source) : await differenceHash(source);
}

async function hashFromUrl(url: string, cropArt: boolean, trim = false) {
  const cacheKey = `${cropArt ? "art" : trim ? "symbol" : "full"}:${url}`;
  const cached = hashCache.get(cacheKey);
  if (cached) {
    touchCache(cacheKey, cached);
    return cached;
  }

  const pending = loadHash(url, cropArt, trim).catch(() => null);
  touchCache(cacheKey, pending);
  return pending;
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        out[index] = await mapper(items[index], index);
      } catch {
        out[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function hashScore(scanHash: bigint, catalogHash: bigint) {
  const distance = hamming(scanHash, catalogHash);
  if (distance > 96) return 0;
  return Math.round(((256 - distance) / 256) * 100);
}

async function compareImages(scanHash: bigint, imageBases: (string | undefined)[], cropArt: boolean) {
  const scores = await mapPool(imageBases, 8, async (image) => {
    const url = cardImageUrl(image, "low");
    if (!url) return 0;
    try {
      const catalogHash = await hashFromUrl(url, cropArt);
      if (catalogHash == null) return 0;
      return hashScore(scanHash, catalogHash);
    } catch {
      return 0;
    }
  });
  return scores.map((score) => score ?? 0);
}

export async function artworkScores(scanHash: bigint, imageBases: (string | undefined)[]) {
  return compareImages(scanHash, imageBases, true);
}

export async function layoutScores(scanHash: bigint, imageBases: (string | undefined)[]) {
  return compareImages(scanHash, imageBases, false);
}

export async function symbolScores(scanHash: bigint, symbolBases: (string | undefined)[]) {
  const scores = await mapPool(symbolBases, 8, async (symbol) => {
    const url = setSymbolUrl(symbol);
    if (!url) return 0;
    try {
      const catalogHash = await hashFromUrl(url, false, true);
      if (catalogHash == null) return 0;
      const distance = hamming(scanHash, catalogHash);
      if (distance > 110) return 0;
      return Math.round(((256 - distance) / 256) * 100);
    } catch {
      return 0;
    }
  });
  return scores.map((score) => score ?? 0);
}
