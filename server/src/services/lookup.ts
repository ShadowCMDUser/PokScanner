import type { OcrResult, ScoredMatch, TcgdexCard } from "../types.js";
import { catalogIdCandidates } from "./clipScan.js";
import {
  cardsByCollector,
  getCardOrNull,
  hydrateCards,
  localIdVariants,
  searchAllCards,
  type TcgLang,
} from "./tcgdex.js";

type PokeCard = {
  id: string;
  name: string;
  number: string;
  set?: { id: string; name: string; printedTotal?: number; total?: number };
};

function tidyName(value: string) {
  return value.replace(/[^A-Za-z0-9 '\-]/g, " ").replace(/\s+/g, " ").trim();
}

function sameDigits(left: string, right: string) {
  return left.replace(/^0+/, "").toLowerCase() === right.replace(/^0+/, "").toLowerCase();
}

function sameCount(left?: string | number | null, right?: string | number | null) {
  if (left == null || right == null || left === "") return false;
  return Number(left) === Number(right);
}

function namesClose(left: string, right: string) {
  const a = left.toLowerCase().replace(/[^a-z0-9]/g, "");
  const b = right.toLowerCase().replace(/[^a-z0-9]/g, "");
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

async function searchPoke(query: string): Promise<PokeCard[]> {
  const response = await fetch(
    `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=20`,
    {
      headers: {
        Accept: "application/json",
        ...(process.env.POKEMONTCG_API_KEY ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY } : {}),
      },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) return [];
  const body = (await response.json()) as { data?: PokeCard[] };
  return body.data ?? [];
}

async function pokeCards(ocr: OcrResult): Promise<PokeCard[]> {
  const names = ocr.nameCandidates.map(tidyName).filter((name) => name.length >= 3).slice(0, 2);
  const numbers = ocr.collectorNumber ? localIdVariants(ocr.collectorNumber) : [];
  const queries: string[] = [];

  for (const name of names) {
    const token = name.includes(" ") ? `"${name}"` : name;
    if (numbers.length) {
      for (const number of numbers) queries.push(`name:${token} number:${number}`);
    } else {
      queries.push(`name:${token}`);
    }
  }

  if (!names.length && numbers.length && ocr.setTotal) {
    for (const number of numbers) {
      queries.push(`number:${number} set.printedTotal:${Number(ocr.setTotal)}`);
    }
  }

  const found = await Promise.allSettled(queries.slice(0, 4).map((query) => searchPoke(query)));
  const cards = found.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  return [...new Map(cards.map((card) => [card.id, card])).values()];
}

async function tcgdexFromPoke(card: PokeCard, lang: TcgLang) {
  const ids = catalogIdCandidates(card.id);
  const loaded = await Promise.all(ids.map((id) => getCardOrNull(id, lang)));
  const named = loaded.find((item) => item && namesClose(item.name, card.name));
  if (named) return named;
  return loaded.find((item) => Boolean(item)) ?? null;
}

function asMatch(card: TcgdexCard, score: number, reason: string): ScoredMatch {
  return { card, score, reasons: [reason] };
}

export async function lookupCard(ocr: OcrResult, lang: TcgLang): Promise<ScoredMatch[]> {
  const names = ocr.nameCandidates.map(tidyName).filter((name) => name.length >= 3).slice(0, 2);
  const matches: ScoredMatch[] = [];

  if (ocr.collectorNumber && ocr.setTotal) {
    const stamped = await cardsByCollector(lang, ocr.collectorNumber, ocr.setTotal);
    for (const card of stamped) {
      const named = names.length ? names.some((name) => namesClose(name, card.name)) : true;
      matches.push(asMatch(card, named ? 240 : 160, "catalogus nummer/set"));
    }
  }

  for (const name of names) {
    const briefs = ocr.collectorNumber
      ? await searchAllCards(lang, { name, localId: ocr.collectorNumber }, 40)
      : await searchAllCards(lang, { name }, 40);
    const cards = await hydrateCards(briefs, lang, 20);
    for (const card of cards) {
      const numberOk = !ocr.collectorNumber || sameDigits(card.localId, ocr.collectorNumber);
      const setOk =
        !ocr.setTotal ||
        sameCount(ocr.setTotal, card.set?.cardCount?.official) ||
        sameCount(ocr.setTotal, card.set?.cardCount?.total);
      matches.push(asMatch(card, numberOk && setOk ? 220 : numberOk ? 150 : 110, "catalogus naam"));
    }
  }

  try {
    const poke = await pokeCards(ocr);
    for (const item of poke.slice(0, 8)) {
      const card = await tcgdexFromPoke(item, lang);
      if (!card) continue;
      const numberOk = !ocr.collectorNumber || sameDigits(card.localId, ocr.collectorNumber);
      const setOk =
        !ocr.setTotal ||
        sameCount(ocr.setTotal, item.set?.printedTotal) ||
        sameCount(ocr.setTotal, item.set?.total) ||
        sameCount(ocr.setTotal, card.set?.cardCount?.official);
      matches.push(asMatch(card, numberOk && setOk ? 230 : 140, "catalogus lookup"));
    }
  } catch {
    /* gratis lookup, mag stil falen */
  }

  const best = new Map<string, ScoredMatch>();
  for (const match of matches) {
    const prev = best.get(match.card.id);
    if (!prev || match.score > prev.score) best.set(match.card.id, match);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

export function mergeMatches(lookup: ScoredMatch[], local: ScoredMatch[]) {
  const best = new Map<string, ScoredMatch>();
  for (const match of [...lookup, ...local]) {
    const prev = best.get(match.card.id);
    if (!prev || match.score > prev.score) best.set(match.card.id, match);
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, 16);
}
