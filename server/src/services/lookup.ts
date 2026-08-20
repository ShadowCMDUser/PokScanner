import type { TcgdexCard } from "../types.js";
import type { StampId } from "./ocr.js";
import {
  cardsByCollector,
  cardsBySetStamp,
  hydrateCards,
  type TcgLang,
} from "./tcgdex.js";

function sameCount(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left == null || right == null || left === "") return false;
  return Number(left) === Number(right);
}

function totalsAlign(card: TcgdexCard, setTotal: string | null) {
  if (!setTotal) return true;
  const counts = card.set?.cardCount;
  return sameCount(counts?.official, setTotal) || sameCount(counts?.total, setTotal);
}

export async function lookupStamp(stamp: StampId, lang: TcgLang): Promise<TcgdexCard[]> {
  if (stamp.setCode && stamp.collectorNumber) {
    const exact = await cardsBySetStamp(lang, stamp.setCode, stamp.collectorNumber, stamp.setTotal);
    const aligned = exact.filter((card) => totalsAlign(card, stamp.setTotal));
    if (aligned.length) return aligned;
  }

  const number = Number(stamp.collectorNumber);
  const total = Number(stamp.setTotal);
  const uniquePair =
    Number.isFinite(number) &&
    Number.isFinite(total) &&
    String(number).length >= 2 &&
    String(total).length >= 2 &&
    total >= 30 &&
    number >= 1 &&
    number <= total + 80;

  if (uniquePair && stamp.collectorNumber && stamp.setTotal) {
    const found = await hydrateCards(await cardsByCollector(lang, stamp.collectorNumber, stamp.setTotal), lang, 4);
    if (found.length === 1) return found;
  }

  return [];
}
