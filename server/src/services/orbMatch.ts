import sharp from "sharp";
import cvModule from "@techstark/opencv-js";
import { cardImageUrl } from "./tcgdex.js";

type OpenCv = Awaited<typeof cvModule>;

const MAX_EXTRACT_DIM = 640;
const QUERY_FEATURES = 1000;
const DB_FEATURES = 500;
const LOWE_RATIO = 0.8;
const MIN_RATIO_MATCHES = 10;
const MIN_INLIERS = 8;
const RANSAC_REPROJ = 5.0;

type OrbPack = {
  width: number;
  height: number;
  points: number[];
  descriptors: Uint8Array;
  rows: number;
};

let cvPromise: Promise<OpenCv> | null = null;
const catalogCache = new Map<string, OrbPack | null>();

async function getCv() {
  if (!cvPromise) {
    cvPromise = Promise.resolve(cvModule).then((mod) => mod as OpenCv);
  }
  return cvPromise;
}

async function toGray(buffer: Buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .greyscale()
    .resize({
      width: MAX_EXTRACT_DIM,
      height: MAX_EXTRACT_DIM,
      fit: "inside",
      withoutEnlargement: true,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function extractPack(cv: OpenCv, gray: InstanceType<OpenCv["Mat"]>, features: number): OrbPack | null {
  const orb = new cv.ORB(features);
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  const mask = new cv.Mat();
  try {
    orb.detectAndCompute(gray, mask, keypoints, descriptors);
    if (descriptors.empty() || keypoints.size() < MIN_RATIO_MATCHES) return null;
    const points: number[] = [];
    for (let i = 0; i < keypoints.size(); i += 1) {
      const pt = keypoints.get(i).pt;
      points.push(pt.x, pt.y);
    }
    return {
      width: gray.cols,
      height: gray.rows,
      points,
      descriptors: new Uint8Array(descriptors.data),
      rows: descriptors.rows,
    };
  } finally {
    orb.delete();
    keypoints.delete();
    descriptors.delete();
    mask.delete();
  }
}

function packToMats(cv: OpenCv, pack: OrbPack) {
  const desc = cv.matFromArray(pack.rows, 32, cv.CV_8UC1, pack.descriptors);
  const pts = cv.matFromArray(pack.points.length / 2, 1, cv.CV_32FC2, pack.points);
  return { desc, pts };
}

function inliersFor(cv: OpenCv, catalog: OrbPack, query: OrbPack) {
  const db = packToMats(cv, catalog);
  const q = packToMats(cv, query);
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING, false);
  const knn = new cv.DMatchVectorVector();
  const srcPts: number[] = [];
  const dstPts: number[] = [];
  try {
    matcher.knnMatch(db.desc, q.desc, knn, 2);
    for (let i = 0; i < knn.size(); i += 1) {
      const pair = knn.get(i);
      if (pair.size() < 2) continue;
      const best = pair.get(0);
      const next = pair.get(1);
      if (best.distance >= LOWE_RATIO * next.distance) continue;
      const qi = best.queryIdx * 2;
      const ti = best.trainIdx * 2;
      srcPts.push(catalog.points[qi], catalog.points[qi + 1]);
      dstPts.push(query.points[ti], query.points[ti + 1]);
    }
    if (srcPts.length / 2 < MIN_RATIO_MATCHES) return 0;

    const src = cv.matFromArray(srcPts.length / 2, 1, cv.CV_32FC2, srcPts);
    const dst = cv.matFromArray(dstPts.length / 2, 1, cv.CV_32FC2, dstPts);
    const mask = new cv.Mat();
    try {
      const method = Number((cv as unknown as Record<string, unknown>).USAC_MAGSAC ?? cv.RANSAC);
      const homography = cv.findHomography(src, dst, method, RANSAC_REPROJ, mask);
      if (homography.empty()) return 0;
      homography.delete();
      let inliers = 0;
      for (let i = 0; i < mask.rows; i += 1) {
        if (mask.ucharAt(i, 0)) inliers += 1;
      }
      return inliers >= MIN_INLIERS ? inliers : 0;
    } finally {
      src.delete();
      dst.delete();
      mask.delete();
    }
  } finally {
    matcher.delete();
    knn.delete();
    db.desc.delete();
    db.pts.delete();
    q.desc.delete();
    q.pts.delete();
  }
}

async function packFromBuffer(cv: OpenCv, buffer: Buffer, features: number) {
  const gray = await toGray(buffer);
  const mat = cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, gray.data);
  try {
    return extractPack(cv, mat, features);
  } finally {
    mat.delete();
  }
}

async function packFromUrl(cv: OpenCv, url: string) {
  const cached = catalogCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch(url, {
      headers: { Accept: "image/*" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) {
      catalogCache.set(url, null);
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const pack = await packFromBuffer(cv, buffer, DB_FEATURES);
    catalogCache.set(url, pack);
    return pack;
  } catch {
    catalogCache.set(url, null);
    return null;
  }
}

function scoreInliers(inliers: number) {
  if (inliers < MIN_INLIERS) return 0;
  return Math.min(100, Math.round((inliers / 70) * 100));
}

export async function orbScores(queryImage: Buffer, imageBases: (string | undefined)[]) {
  try {
    const cv = await getCv();
    const query = await packFromBuffer(cv, queryImage, QUERY_FEATURES);
    if (!query) return imageBases.map(() => 0);

    const scores = new Array<number>(imageBases.length).fill(0);
    for (let i = 0; i < imageBases.length; i += 1) {
      const url = cardImageUrl(imageBases[i], "low");
      if (!url) continue;
      const catalog = await packFromUrl(cv, url);
      if (!catalog) continue;
      scores[i] = scoreInliers(inliersFor(cv, catalog, query));
    }
    return scores;
  } catch {
    return imageBases.map(() => 0);
  }
}
