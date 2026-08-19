import { createWorker, PSM, type Worker } from "tesseract.js";
import type { OcrResult } from "../types.js";

const NAME_NOISE =
  /^(basic|stage|hp|weakness|resistance|retreat|illustrator|evolves?|ability|attack|trainer|energy|pokemon|item|tool|supporter|stadium|length|weight|power|flame|discard|nintendo|creatures|gamefreak|wizards|put|this|card|into|play|during|your|turn|when|that|with|have|from|cost|spin|fire|known|spits)$/i;

let workerPromise: Promise<Worker> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        logger: () => undefined,
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
  });
  const { data } = await worker.recognize(image);
  return {
    text: data.text ?? "",
    confidence: data.confidence ?? 0,
  };
}

function extractCollector(text: string) {
  const classic = text.match(/(\d{1,3})\s*[\/\\|Il]\s*(\d{2,3})\b/);
  if (classic && Number(classic[2]) >= 20) {
    return { number: classic[1], total: classic[2] };
  }

  const compact = text.replace(/\s+/g, " ").match(/(\d{4,6})\s*%?\s*[^\d]*$/);
  if (compact) {
    const raw = compact[1];
    for (let nLen = 1; nLen <= 3; nLen += 1) {
      if (raw[nLen] !== "1") continue;
      const number = raw.slice(0, nLen);
      const total = raw.slice(nLen + 1);
      if (total.length >= 2 && Number(total) >= 40 && Number(total) <= 400) {
        return { number, total };
      }
    }
  }

  const promo = text.match(
    /\b((?:SV|SWSH|SM|XY|BW|DP|TG|GG|SVP|PR)\s?-?\s?\d{1,4})\b/i,
  );
  if (promo) {
    return { number: promo[1].replace(/\s+/g, ""), total: null };
  }

  return { number: null, total: null };
}

function addName(target: string[], name: string) {
  const cleaned = name.replace(/[^A-Za-z0-9 '\-]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length < 3 || cleaned.length > 28) return;
  if (NAME_NOISE.test(cleaned)) return;
  if (!target.some((item) => item.toLowerCase() === cleaned.toLowerCase())) {
    target.push(cleaned);
  }
}

function extractNames(text: string) {
  const names: string[] = [];

  for (const match of text.matchAll(
    /([A-Z][a-z]+(?:[ '\-][A-Z][a-z]+){0,3})\s+\d{1,3}\s*HP/g,
  )) {
    addName(names, match[1]);
  }

  for (const match of text.matchAll(
    /Put\s+([A-Z][a-z]+(?:[ '\-][A-Z][a-z]+){0,3})\s+on/g,
  )) {
    addName(names, match[1]);
  }

  for (const match of text.matchAll(/[A-Z][a-z]{3,15}/g)) {
    addName(names, match[0]);
  }

  return names.slice(0, 6);
}

export async function readCardText(regions: {
  full: Buffer;
  top: Buffer;
  bottom: Buffer;
}): Promise<OcrResult> {
  const top = await recognize(regions.top, PSM.SINGLE_LINE);
  const bottom = await recognize(
    regions.bottom,
    PSM.SINGLE_LINE,
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ/ -",
  );
  const full = await recognize(regions.full, PSM.SINGLE_BLOCK);

  const combined = `${top.text}\n${full.text}\n${bottom.text}`;
  const collector = extractCollector(`${bottom.text}\n${full.text}`);
  const names = extractNames(`${top.text}\n${full.text}`);

  return {
    rawText: combined.replace(/\n{2,}/g, "\n").trim(),
    nameCandidates: names,
    collectorNumber: collector.number,
    setTotal: collector.total,
    confidence: Math.round((full.confidence + top.confidence) / 2),
  };
}
