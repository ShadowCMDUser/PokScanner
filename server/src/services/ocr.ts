import { join } from "node:path";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { dataDir } from "../paths.js";
import type { OcrResult } from "../types.js";
import { codeVariants, knownCodesByLength, setIdForCode } from "./setCodes.js";

const NAME_NOISE =
  /^(basic|stage|hp|weakness|resistance|retreat|illustrator|illus|evolves?|ability|attack|trainer|energy|pokemon|item|tool|supporter|stadium|length|weight|power|put|this|card|into|play|during|your|turn|when|that|with|have|from|cost|rule|box|used|once|more|each|time|heal|damage|knocked|prize|cards|mega-evolved|form)$/i;

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz '-.";
const NUMBER_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ -";
const STAMP_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/ ";
const PRINT_LANG = /^(EN|FR|DE|ES|IT|PT|NL|JP)$/;
const CODE_NOISE = new Set([
  "HP",
  "EX",
  "GX",
  "EN",
  "FR",
  "DE",
  "ES",
  "IT",
  "PT",
  "NL",
  "JP",
  "THE",
  "AND",
  "INC",
  "ILL",
  "ILLUS",
  "BASIC",
  "STAGE",
]);

const EVOLVES_FROM =
  /(?:evolves?\s+from|evolue\s+de|évolue\s+de|entwickelt\s+sich\s+aus)\s+([A-Za-z][A-Za-z '\-]{2,24})/i;

const OCR_TIMEOUT_MS = 7_000;
const EMPTY_OCR = { text: "", confidence: 0 };

async function createOcrWorker() {
  return createWorker("eng", 1, {
    logger: () => undefined,
    cachePath: join(dataDir, "tesscache"),
  });
}

async function terminateWorker(worker: Worker | null) {
  if (!worker) return;
  try {
    await worker.terminate();
  } catch {
    // Worker may already be dead after a hang or WASM crash.
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("OCR_TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function recognize(worker: Worker, image: Buffer, psm: PSM, whitelist?: string) {
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: psm,
      tessedit_char_whitelist: whitelist ?? "",
      user_defined_dpi: "300",
    });
    const { data } = await withTimeout(worker.recognize(image), OCR_TIMEOUT_MS);
    return {
      text: data.text ?? "",
      confidence: data.confidence ?? 0,
      killed: false,
    };
  } catch {
    await terminateWorker(worker);
    return { ...EMPTY_OCR, killed: true };
  }
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

function digits(value: string) {
  return value.replace(/[OQD]/gi, "0").replace(/[Il]/g, "1");
}

function extractCollector(text: string) {
  const cleaned = tidy(text).toUpperCase();
  const pairs: { number: string; total: string; score: number }[] = [];

  function add(number: string, total: string, extra = 0) {
    const n = Number(digits(number));
    const t = Number(digits(total));
    if (!Number.isFinite(n) || !Number.isFinite(t)) return;
    if (n < 1 || n > 500 || t < 8 || t > 500) return;
    if (t >= 20 && t <= 29 && n <= 9) return;
    let score = 8 + extra;
    if (n <= t + 80) score += 6;
    if (String(n).length >= 2) score += 2;
    if (String(t).length >= 2) score += 2;
    pairs.push({ number: String(n), total: String(t), score });
  }

  for (const match of cleaned.matchAll(/(\d{1,3}|[OQDIL]{1,3})\s*[\/\\:\-]\s*(\d{2,3})\b/g)) {
    add(match[1], match[2], 10);
  }
  for (const match of cleaned.replace(/\s+/g, "").matchAll(/(\d{1,3})[\/\\:\-](\d{2,3})/g)) {
    add(match[1], match[2], 8);
  }
  if (!pairs.length) {
    for (const match of cleaned.matchAll(/(\d{2,3})7+\s+(\d{2,3})\b/g)) {
      add(match[1], match[2], 6);
    }
    for (const match of cleaned.matchAll(/(\d{1,3})\s+[I1|]\s+(\d{2,3})\b/g)) {
      add(match[1], match[2], 2);
    }
    for (const match of cleaned.replace(/\s+/g, "").matchAll(/(\d{2,3})7(\d{2,3})/g)) {
      add(match[1], match[2], 5);
    }
    for (const match of cleaned.replace(/[^0-9]/g, "").matchAll(/^(\d{3})(\d{3})$/g)) {
      add(match[1], match[2], 3);
    }
    for (const match of cleaned.replace(/[^0-9]/g, "").matchAll(/^(\d{2})(\d{3})$/g)) {
      add(match[1], match[2], 1);
    }
  }

  pairs.sort((a, b) => b.score - a.score || Number(b.total) - Number(a.total));
  return pairs[0] ? { number: pairs[0].number, total: pairs[0].total } : { number: null, total: null };
}

function resolvePrintedCode(raw: string) {
  for (const variant of codeVariants(raw)) {
    if (PRINT_LANG.test(variant) || CODE_NOISE.has(variant)) continue;
    if (setIdForCode(variant)) return variant;
  }
  return null;
}

export function extractSetCode(text: string) {
  const upper = tidy(text).toUpperCase();
  const compact = upper.replace(/[^A-Z0-9\/]/g, "");
  const lang = "(?:EN|IN|FN|EH|EJ|EL|FR|DE|ES|IT|PT|NL|JP)";

  for (const code of knownCodesByLength()) {
    if (CODE_NOISE.has(code) || PRINT_LANG.test(code) || code.length < 2) continue;
    const besideNumber = new RegExp(`${code}${lang}?\\d{1,3}[\\/7]\\d{2,4}`);
    if (besideNumber.test(compact)) return code;
  }

  for (const code of knownCodesByLength()) {
    if (CODE_NOISE.has(code) || PRINT_LANG.test(code) || code.length < 2) continue;
    const withLang = new RegExp(`(?<![A-Z0-9])${code}\\s*${lang}\\b`);
    if (withLang.test(upper)) return code;
  }

  for (const code of knownCodesByLength()) {
    if (CODE_NOISE.has(code) || PRINT_LANG.test(code) || code.length < 2) continue;
    const at = compact.indexOf(code);
    if (at < 0) continue;
    const after = compact.slice(at + code.length, at + code.length + 10);
    if (new RegExp(`^${lang}?\\d{2,4}`).test(after)) return code;
  }

  return null;
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

function extractNames(plateText: string, topText: string, _fullText: string, evolvesFrom: string | null) {
  const names: string[] = [];
  const sources = [stripEvolvesFrom(plateText), stripEvolvesFrom(topText)];

  for (const source of sources) {
    for (const match of source.matchAll(/\b([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3})\s+\d{1,3}\s*HP\b/g)) {
      addName(names, match[1], evolvesFrom);
    }
    for (const match of source.matchAll(/\bHP\s*\d{2,3}\b[\s\S]{0,8}?\b((?:Mega\s+)?[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3}(?:\s+EX)?)\b/gi)) {
      addName(names, match[1], evolvesFrom);
    }
  }

  for (const source of sources) {
    for (const match of source.matchAll(
      /\b((?:Mega\s+)?[A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3}(?:\s+(?:ex|EX|GX|V|VMAX|VSTAR))?)\b/g,
    )) {
      addName(names, match[1], evolvesFrom);
    }
  }

  return names.slice(0, 4);
}

export function emptyOcr(): OcrResult {
  return {
    rawText: "",
    nameCandidates: [],
    evolvesFrom: null,
    hp: null,
    collectorNumber: null,
    setCode: null,
    setTotal: null,
    illustrator: null,
    stage: null,
    regulationMark: null,
    ability: null,
    attacks: [],
    confidence: 0,
  };
}

export type StampId = {
  setCode: string | null;
  collectorNumber: string | null;
  setTotal: string | null;
  rawText: string;
  confidence: number;
};

export function extractStampId(text: string): Omit<StampId, "rawText" | "confidence"> {
  const cleaned = tidy(text).toUpperCase().replace(/\b0*20[2-9]\d\b/g, " ");
  const collector = extractCollector(cleaned);
  let setCode = extractSetCode(cleaned);
  let number = collector.number;
  const compact = cleaned.replace(/[^A-Z0-9\/]/g, "");

  if (!setCode) {
    const promo = cleaned.match(/\b(SVP|BWP|XYP|SMP|MEP)\s*(?:EN|FR|DE|ES|IT|PT)?\s*(\d{1,3})\b/);
    if (promo) {
      setCode = promo[1];
      number = String(Number(digits(promo[2])) || promo[2]);
    }
  }

  if (setCode && !number) {
    const promoSets = new Set(["SVP", "BWP", "XYP", "SMP", "MEP"]);
    if (promoSets.has(setCode)) {
      const after = compact.match(new RegExp(`${setCode}(?:EN|FR|DE|ES|IT|PT)?(\\d{1,3})`));
      if (after?.[1]) number = String(Number(digits(after[1])) || after[1]);
    } else {
      const after = compact.match(
        new RegExp(`${setCode}(?:EN|FR|DE|ES|IT|PT|NL|JP)?(\\d{1,3})[\\/7](\\d{2,4})`),
      );
      if (after?.[1]) {
        number = String(Number(digits(after[1])) || after[1]);
      }
    }
  }

  return {
    setCode,
    collectorNumber: number,
    setTotal: collector.total,
  };
}

function emptyStamp(): StampId {
  return {
    setCode: null,
    collectorNumber: null,
    setTotal: null,
    rawText: "",
    confidence: 0,
  };
}

function stampRank(stamp: StampId) {
  return (
    (stamp.setCode ? 8 : 0) +
    (stamp.collectorNumber ? 6 : 0) +
    (stamp.setTotal ? 3 : 0) +
    (stamp.setCode && stamp.collectorNumber ? 6 : 0)
  );
}

function mergeCompatible(into: StampId, parsed: Omit<StampId, "rawText" | "confidence">) {
  if (parsed.setCode && parsed.collectorNumber) {
    into.setCode = parsed.setCode;
    into.collectorNumber = parsed.collectorNumber;
    if (parsed.setTotal) into.setTotal = parsed.setTotal;
    return;
  }
  if (!into.setCode && parsed.setCode) into.setCode = parsed.setCode;
  if (!into.collectorNumber && parsed.collectorNumber) into.collectorNumber = parsed.collectorNumber;
  if (!into.setTotal && parsed.setTotal) into.setTotal = parsed.setTotal;
}

export async function readStamp(images: Buffer[]): Promise<StampId> {
  const merged = emptyStamp();
  const complete: StampId[] = [];
  let worker: Worker | null = null;

  try {
    worker = await createOcrWorker();

    for (const [index, image] of images.entries()) {
      const passes = index < 2
        ? ([PSM.SPARSE_TEXT, PSM.SINGLE_LINE, PSM.SINGLE_BLOCK] as const)
        : ([PSM.SPARSE_TEXT] as const);
      for (const psm of passes) {
        const result = await recognize(worker, image, psm, STAMP_CHARS);
        if (result.killed) {
          worker = await createOcrWorker();
        }
        const parsed = extractStampId(result.text);
        const candidate: StampId = {
          ...parsed,
          rawText: result.text,
          confidence: result.confidence,
        };
        if (candidate.setCode && candidate.collectorNumber) complete.push(candidate);
        mergeCompatible(merged, parsed);
        if (result.text.trim()) merged.rawText = [merged.rawText, result.text].filter(Boolean).join("\n");
        merged.confidence = Math.max(merged.confidence, result.confidence);
        if (candidate.setCode && candidate.collectorNumber && candidate.setTotal) break;
      }
      if (merged.setCode && merged.collectorNumber && merged.setTotal) break;
    }
  } catch {
    return complete.length
      ? complete.sort((a, b) => stampRank(b) - stampRank(a) || b.confidence - a.confidence)[0]
      : merged;
  } finally {
    await terminateWorker(worker);
  }

  if (complete.length) {
    complete.sort((a, b) => stampRank(b) - stampRank(a) || b.confidence - a.confidence);
    return complete[0];
  }

  return merged;
}
