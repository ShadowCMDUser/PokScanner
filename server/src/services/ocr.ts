import { join } from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { dataDir } from "../paths.js";
import type { OcrResult } from "../types.js";

const NAME_NOISE =
  /^(basic|stage|hp|weakness|resistance|retreat|illustrator|illus|evolves?|ability|attack|trainer|energy|pokemon|item|tool|supporter|stadium|length|weight|power|put|this|card|into|play|during|your|turn|when|that|with|have|from|cost|rule|box|used|once|more|each|time|heal|damage|knocked|prize|cards|mega-evolved|form)$/i;

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.";
const NUMBER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ -";

const EVOLVES_FROM =
  /(?:evolves?\s+from|evolue\s+de|évolue\s+de|entwickelt\s+sich\s+aus)\s+([A-Za-z][A-Za-z '\-]{2,24})/i;

let workerPromise: Promise<Worker> | null = null;
let queue: Promise<unknown> = Promise.resolve();

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
  const run = async () => {
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
  };
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function tidy(text: string) {
  return text.replace(/[|]/g, "I").replace(/[`´’]/g, "'").replace(/\s+/g, " ").trim();
}

function extractEvolvesFrom(text: string) {
  const match = tidy(text).match(EVOLVES_FROM);
  return match?.[1] ? tidy(match[1]).replace(/\s+HP.*$/i, "") : null;
}

function extractHp(text: string) {
  const cleaned = tidy(text);
  const match = cleaned.match(/\bHP\s*(\d{2,3})\b|\b(\d{2,3})\s*HP\b/i);
  if (!match) return null;
  const hp = Number(match[1] || match[2]);
  return hp >= 30 && hp <= 500 ? hp : null;
}

function extractStage(text: string) {
  const cleaned = tidy(text);
  if (/\bbasic\b/i.test(cleaned)) return "Basic";
  const stage = cleaned.match(/\bstage\s*([12])\b/i);
  if (stage) return `Stage ${stage[1]}`;
  if (/\bmega[- ]evolved\b/i.test(cleaned) || /\bmega\b/i.test(cleaned)) return "Mega";
  return null;
}

function extractIllustrator(text: string) {
  const match = tidy(text).match(/\billus\.?\s*([A-Za-z0-9][A-Za-z0-9 .'-]{2,40})/i);
  if (!match) return null;
  return match[1].replace(/\s+\d{2,3}\s*\/.*$/, "").trim();
}

function extractRegulation(text: string) {
  const match = tidy(text).match(/\b([A-I]{1,2})\b(?=\s*(?:EN|FR|DE|ES|IT|JP)?\b)/);
  return match?.[1] ?? null;
}

function extractAbility(text: string) {
  const match = tidy(text).match(/\bability\s+([A-Z][A-Za-z][A-Za-z '-]{2,32})/i);
  return match?.[1] ? tidy(match[1]) : null;
}

function extractAttacks(text: string) {
  const attacks: { name: string; damage: number | null }[] = [];
  const cleaned = tidy(text);
  for (const match of cleaned.matchAll(
    /\b([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+(\d{2,3})\b/g,
  )) {
    const name = match[1];
    const damage = Number(match[2]);
    if (NAME_NOISE.test(name) || damage < 10 || damage > 400) continue;
    if (attacks.some((item) => item.name.toLowerCase() === name.toLowerCase())) continue;
    attacks.push({ name, damage });
  }
  return attacks.slice(0, 4);
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

  const compact = cleaned.replace(/\s+/g, "").match(/(\d{1,3})[\/1](\d{2,3})/);
  if (compact && Number(compact[2]) >= 40 && Number(compact[2]) <= 400) {
    return { number: String(Number(compact[1])), total: compact[2] };
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
  if (cleaned.length < 3 || cleaned.length > 40) return null;
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
  const sources = [plate, top, stripEvolvesFrom(fullText)];

  for (const source of sources) {
    for (const match of source.matchAll(
      /\b((?:Mega\s+)?[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3}(?:\s+(?:ex|EX|GX|V|VMAX|VSTAR))?)\b/g,
    )) {
      addName(names, match[1], evolvesFrom);
    }
    for (const match of source.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3})\s+\d{1,3}\s*HP\b/g)) {
      addName(names, match[1], evolvesFrom);
    }
    for (const match of source.matchAll(/\bHP\s*\d{2,3}\b[\s\S]{0,8}?\b((?:Mega\s+)?[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3}(?:\s+EX)?)\b/gi)) {
      addName(names, match[1], evolvesFrom);
    }
  }

  return names.slice(0, 6);
}

export function emptyOcr(): OcrResult {
  return {
    rawText: "",
    nameCandidates: [],
    evolvesFrom: null,
    hp: null,
    collectorNumber: null,
    setTotal: null,
    illustrator: null,
    stage: null,
    regulationMark: null,
    ability: null,
    attacks: [],
    confidence: 0,
  };
}

export async function readCardText(regions: {
  full: Buffer;
  plate?: Buffer;
  top: Buffer;
  body?: Buffer;
  bottom: Buffer;
  bottomInk?: Buffer;
}): Promise<OcrResult> {
  const plate = regions.plate
    ? await recognize(regions.plate, PSM.SINGLE_LINE, NAME_CHARS)
    : { text: "", confidence: 0 };
  const top = await recognize(regions.top, PSM.SINGLE_BLOCK, `${NAME_CHARS}0123456789`);
  const body = regions.body
    ? await recognize(regions.body, PSM.SPARSE_TEXT)
    : { text: "", confidence: 0 };
  const bottom = await recognize(regions.bottom, PSM.SINGLE_LINE, NUMBER_CHARS);
  const bottomInk = regions.bottomInk
    ? await recognize(regions.bottomInk, PSM.SINGLE_LINE, NUMBER_CHARS)
    : { text: "", confidence: 0 };
  const full = await recognize(regions.full, PSM.SPARSE_TEXT);

  const combined = [plate.text, top.text, body.text, full.text, bottom.text, bottomInk.text]
    .filter(Boolean)
    .join("\n");
  const evolvesFrom = extractEvolvesFrom(combined);
  const footer = `${bottom.text}\n${bottomInk.text}\n${full.text}`;
  const collector = extractCollector(footer);
  const names = extractNames(`${plate.text}\n${top.text}`, top.text, combined, evolvesFrom);

  return {
    rawText: combined.replace(/\n{2,}/g, "\n").trim(),
    nameCandidates: names,
    evolvesFrom,
    hp: extractHp(`${plate.text}\n${top.text}\n${combined}`),
    collectorNumber: collector.number,
    setTotal: collector.total,
    illustrator: extractIllustrator(combined),
    stage: extractStage(combined),
    regulationMark: extractRegulation(footer),
    ability: extractAbility(body.text || combined),
    attacks: extractAttacks(body.text || combined),
    confidence: Math.round((full.confidence + top.confidence + plate.confidence) / 3),
  };
}
