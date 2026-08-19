import { join } from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { dataDir } from "../paths.js";
import type { OcrResult } from "../types.js";

const NAME_NOISE =
  /^(basic|stage|hp|weakness|resistance|retreat|illustrator|evolves?|ability|attack|trainer|energy|pokemon|item|tool|supporter|stadium|length|weight|power|put|this|card|into|play|during|your|turn|when|that|with|have|from|cost|spin|fire|known|spits|blast|strike|punch|beam|shot|wave|smash|charge|draw|damage|discard|nintendo|creatures|gamefreak|wizards|ancient|future|rule|box|used|once|more|each|time)$/i;

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.";
const NUMBER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ -";

let workerPromise: Promise<Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => undefined,
        cachePath: join(dataDir, "tesscache"),
      });
      return worker;
    })();
  }
  return workerPromise;
}

async function recognize(image: Buffer, psm: PSM, whitelist?: string) {
  const worker = await getWorker();
  await worker.setParameters({
    tessedit_pageseg_mode: psm,
    tessedit_char_whitelist: whitelist ?? "",
    user_defined_dpi: "300",
  });
  const { data } = await worker.recognize(image);
  return {
    text: data.text ?? "",
    confidence: data.confidence ?? 0,
  };
}

function tidy(text: string) {
  return text.replace(/[|]/g, "I").replace(/[`´’]/g, "'").replace(/\s+/g, " ").trim();
}

function extractCollector(text: string) {
  const cleaned = tidy(text).replace(/[O]/g, "0").replace(/[Il]/g, "1");

  const classic = cleaned.match(/\b(\d{1,3})\s*[\/\\|]\s*(\d{2,3})\b/);
  if (classic && Number(classic[2]) >= 20 && Number(classic[2]) <= 500) {
    return { number: String(Number(classic[1])), total: classic[2] };
  }

  const compact = cleaned.replace(/\s+/g, "").match(/(\d{1,3})1(\d{2,3})/);
  if (compact && Number(compact[2]) >= 40 && Number(compact[2]) <= 400) {
    return { number: String(Number(compact[1])), total: compact[2] };
  }

  const promo = tidy(text).match(
    /\b((?:SVP|SV|SWSH|SM|XY|BW|DP|TG|GG|PR)\s?-?\s?\d{1,4})\b/i,
  );
  if (promo) {
    return { number: promo[1].replace(/\s+/g, ""), total: null };
  }

  return { number: null, total: null };
}

function toSearchName(name: string) {
  const cleaned = name
    .replace(/[^A-Za-z0-9 '\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length < 3 || cleaned.length > 32) return null;
  if (NAME_NOISE.test(cleaned)) return null;
  if (/^\d+$/.test(cleaned)) return null;
  return cleaned;
}

function addName(target: string[], name: string) {
  const cleaned = toSearchName(name);
  if (!cleaned) return;
  const variants = [cleaned];
  if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
    variants.push(cleaned.toLowerCase().replace(/\b[a-z]/g, (char) => char.toUpperCase()));
  }
  for (const variant of variants) {
    if (!target.some((item) => item.toLowerCase() === variant.toLowerCase())) {
      target.push(variant);
    }
  }
}

function extractNames(topText: string, fullText: string) {
  const names: string[] = [];
  const top = tidy(topText);

  for (const match of top.matchAll(/([A-Za-z][A-Za-z '\-]{2,24})\s+\d{1,3}\s*HP/gi)) {
    addName(names, match[1]);
  }

  for (const match of top.matchAll(/\b[A-Z]{3,}(?:\s+[A-Z]{2,}){0,3}\b/g)) {
    addName(names, match[0]);
  }

  for (const match of top.matchAll(/\b[A-Z][a-z]+(?:[ '\-][A-Z][a-z]+){0,3}(?:\s+(?:ex|EX|V|VMAX|VSTAR|GX))?\b/g)) {
    addName(names, match[0]);
  }

  if (!names.length) {
    for (const match of tidy(fullText).matchAll(/([A-Za-z][A-Za-z '\-]{2,24})\s+\d{1,3}\s*HP/gi)) {
      addName(names, match[1]);
    }
  }

  return names.slice(0, 5);
}

export async function readCardText(regions: {
  full: Buffer;
  top: Buffer;
  bottom: Buffer;
  bottomInk?: Buffer;
}): Promise<OcrResult> {
  const [top, bottom, bottomInk, full] = await Promise.all([
    recognize(regions.top, PSM.SINGLE_LINE, NAME_CHARS),
    recognize(regions.bottom, PSM.SINGLE_LINE, NUMBER_CHARS),
    regions.bottomInk
      ? recognize(regions.bottomInk, PSM.SINGLE_LINE, NUMBER_CHARS)
      : Promise.resolve({ text: "", confidence: 0 }),
    recognize(regions.full, PSM.SPARSE_TEXT, NAME_CHARS),
  ]);

  const combined = `${top.text}\n${full.text}\n${bottom.text}\n${bottomInk.text}`;
  const collector = extractCollector(`${bottom.text}\n${bottomInk.text}\n${full.text}`);
  const names = extractNames(top.text, full.text);

  return {
    rawText: combined.replace(/\n{2,}/g, "\n").trim(),
    nameCandidates: names,
    collectorNumber: collector.number,
    setTotal: collector.total,
    confidence: Math.round((full.confidence + top.confidence) / 2),
  };
}
