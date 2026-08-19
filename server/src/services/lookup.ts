import type { OcrResult, TcgdexCard } from "../types.js";
import { catalogIdCandidates } from "./clipScan.js";
import {
  cardsByCollector,
  cardsBySetStamp,
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

export async function lookupCard(ocr: OcrResult, lang: TcgLang): Promise<TcgdexCard[]> {
  const names = ocr.nameCandidates.map(tidyName).filter((name) => name.length >= 3).slice(0, 2);
  const cards: TcgdexCard[] = [];

  if (ocr.setCode && ocr.collectorNumber) {
    cards.push(...(await cardsBySetStamp(lang, ocr.setCode, ocr.collectorNumber, ocr.setTotal)));
  }

  if (ocr.collectorNumber && ocr.setTotal) {
    cards.push(...(await cardsByCollector(lang, ocr.collectorNumber, ocr.setTotal)));
  }

  for (const name of names) {
    const briefs = ocr.collectorNumber
      ? await searchAllCards(lang, { name, localId: ocr.collectorNumber }, 40)
      : await searchAllCards(lang, { name }, 30);
    cards.push(...(await hydrateCards(briefs, lang, 16)));
  }

  try {
    const poke = await pokeCards(ocr);
    for (const item of poke.slice(0, 8)) {
      const card = await tcgdexFromPoke(item, lang);
      if (card) cards.push(card);
    }
  } catch {
    /* gratis lookup, mag stil falen */
  }

  return [...new Map(cards.map((card) => [card.id, card])).values()];
}
