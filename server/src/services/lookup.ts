import type { TcgdexCard } from "../types.js";
import type { StampId } from "./ocr.js";
import {
  cardsByCollector,
  cardsBySetStamp,
  hydrateCards,
  type TcgLang,
} from "./tcgdex.js";

export async function lookupStamp(stamp: StampId, lang: TcgLang): Promise<TcgdexCard[]> {
  if (stamp.setCode && stamp.collectorNumber) {
    const exact = await cardsBySetStamp(lang, stamp.setCode, stamp.collectorNumber, stamp.setTotal);
    if (exact.length) return exact;
  }

  if (stamp.collectorNumber && stamp.setTotal) {
    return hydrateCards(await cardsByCollector(lang, stamp.collectorNumber, stamp.setTotal), lang, 16);
  }

  return [];
}
