import type { TcgdexCard } from "../types.js";
import type { StampId } from "./ocr.js";
import {
  cardsByCollector,
  cardsBySetStamp,
  hydrateCards,
  type TcgLang,
} from "./tcgdex.js";

const FALLBACK_LIMIT = 5;

function sameCount(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left == null || right == null || left === "") return false;
  const a = Number(left);
  const b = Number(right);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a === b;
}

function totalsAlign(card: TcgdexCard, setTotal: string | null) {
  if (!setTotal) return true;
  const counts = card.set?.cardCount;
  return sameCount(counts?.official, setTotal) || sameCount(counts?.total, setTotal);
}

/**
 * Collector numbers printed as n/t (e.g. 063/193 or secret rare 092/084).
 * Rejects NaN from OCR letters and tiny year-like totals (©2026 → 2/26).
 */
function isValidCollectorPair(number: number, total: number) {
  if (!Number.isFinite(number) || !Number.isFinite(total)) return false;
  if (!Number.isInteger(number) || !Number.isInteger(total)) return false;
  if (number < 1 || total < 1) return false;
  if (String(number).length < 2 || String(total).length < 2) return false;

  const secretRare = number > total && total >= 50 && number <= total + 80;
  const regular = number <= total && total >= 70;
  return secretRare || regular;
}

export async function lookupStamp(stamp: StampId, lang: TcgLang): Promise<TcgdexCard[]> {
  if (stamp.setCode && stamp.collectorNumber) {
    const exact = await cardsBySetStamp(lang, stamp.setCode, stamp.collectorNumber, stamp.setTotal);
    const aligned = exact.filter((card) => totalsAlign(card, stamp.setTotal));
    if (aligned.length) return aligned;
  }

  const number = Number(stamp.collectorNumber);
  const total = Number(stamp.setTotal);
  if (!stamp.collectorNumber || !stamp.setTotal || !isValidCollectorPair(number, total)) {
    return [];
  }

  const found = await hydrateCards(
    await cardsByCollector(lang, stamp.collectorNumber, stamp.setTotal),
    lang,
    FALLBACK_LIMIT,
  );
  return found.slice(0, FALLBACK_LIMIT);
}
