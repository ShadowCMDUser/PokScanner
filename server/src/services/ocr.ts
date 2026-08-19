import { join } from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { dataDir } from "../paths.js";
import type { OcrResult } from "../types.js";

const NAME_NOISE =
  /^(basic|stage|hp|weakness|resistance|retreat|illustrator|evolves?|ability|attack|trainer|energy|pokemon|item|tool|supporter|stadium|length|weight|power|put|this|card|into|play|during|your|turn|when|that|with|have|from|cost|spin|fire|known|spits|blast|strike|punch|beam|shot|wave|smash|charge|draw|damage|discard|nintendo|creatures|gamefreak|wizards|ancient|future|rule|box|used|once|more|each|time)$/i;

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.";
const NUMBER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ -";

const EVOLVES_FROM =
  /(?:evolves?\s+from|evolue\s+de|évolue\s+de|entwickelt\s+sich\s+aus)\s+([A-Za-z][A-Za-z '\-]{2,24})/i;

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

function extractEvolvesFrom(text: string) {
  const match = tidy(text).match(EVOLVES_FROM);
  return match?.[1] ? tidy(match[1]) : null;
}

function extractHp(text: string) {
  const match = tidy(text).match(/\b(\d{2,3})\s*HP\b/i);
  if (!match) return null;
  const hp = Number(match[1]);
  return hp >= 30 && hp <= 400 ? hp : null;
}

function stripEvolvesFrom(text: string) {
  return tidy(text).replace(EVOLVES_FROM, " ").replace(/\s+/g, " ").trim();
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

function sameName(a: string, b: string) {
  return a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");
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

function addName(target: string[], name: string, blocked?: string | null) {
  const cleaned = toSearchName(name);
  if (!cleaned) return;
  if (blocked && sameName(cleaned, blocked)) return;
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

function extractNames(plateText: string, topText: string, fullText: string, evolvesFrom: string | null) {
  const names: string[] = [];
  const plate = stripEvolvesFrom(plateText);
  const top = stripEvolvesFrom(topText);

  for (const match of plate.matchAll(/\b[A-Z]{3,}(?:\s+[A-Z]{2,}){0,2}\b/g)) {
    addName(names, match[0], evolvesFrom);
  }
  for (const match of plate.matchAll(/\b[A-Z][a-z]+(?:[ '\-][A-Z][a-z]+){0,2}(?:\s+(?:ex|EX|V|VMAX|VSTAR|GX))?\b/g)) {
    addName(names, match[0], evolvesFrom);
  }

  for (const match of top.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2})\s+\d{1,3}\s*HP\b/g)) {
    addName(names, match[1], evolvesFrom);
  }

  if (!names.length) {
    for (const match of stripEvolvesFrom(fullText).matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,2})\s+\d{1,3}\s*HP\b/g)) {
      addName(names, match[1], evolvesFrom);
    }
  }

  return names.slice(0, 4);
}

export async function readCardText(regions: {
  full: Buffer;
  plate?: Buffer;
  top: Buffer;
  bottom: Buffer;
  bottomInk?: Buffer;
}): Promise<OcrResult> {
  const [plate, top, bottom, bottomInk, full] = await Promise.all([
    regions.plate
      ? recognize(regions.plate, PSM.SINGLE_LINE, NAME_CHARS)
      : Promise.resolve({ text: "", confidence: 0 }),
    recognize(regions.top, PSM.SINGLE_BLOCK, NAME_CHARS),
    recognize(regions.bottom, PSM.SINGLE_LINE, NUMBER_CHARS),
    regions.bottomInk
      ? recognize(regions.bottomInk, PSM.SINGLE_LINE, NUMBER_CHARS)
      : Promise.resolve({ text: "", confidence: 0 }),
    recognize(regions.full, PSM.SPARSE_TEXT, NAME_CHARS),
  ]);

  const combined = `${plate.text}\n${top.text}\n${full.text}\n${bottom.text}\n${bottomInk.text}`;
  const evolvesFrom = extractEvolvesFrom(combined);
  const collector = extractCollector(`${bottom.text}\n${bottomInk.text}\n${full.text}`);
  const names = extractNames(plate.text, top.text, full.text, evolvesFrom);

  return {
    rawText: combined.replace(/\n{2,}/g, "\n").trim(),
    nameCandidates: names,
    evolvesFrom,
    hp: extractHp(`${plate.text}\n${top.text}\n${full.text}`),
    collectorNumber: collector.number,
    setTotal: collector.total,
    confidence: Math.round((full.confidence + top.confidence + plate.confidence) / 3),
  };
}
