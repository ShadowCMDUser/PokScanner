import {
  SUPPORTED_LANGS,
  type CardmarketPricing,
  type TcgdexCard,
  type TcgdexCardBrief,
  type TcgLang,
} from "../types.js";
import { rememberSetCode, setIdForCode } from "./setCodes.js";

export type { TcgLang };

const BASE = "https://api.tcgdex.net/v2";
const MAX_FETCH_RETRIES = 3;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const FETCH_TIMEOUT_MS = 12_000;
const ABBREV_PROBE_CONCURRENCY = 2;
const ABBREV_FALLBACK_LIMIT = 12;

export function normalizeLang(value?: string): TcgLang {
  const lang = (value ?? "en").toLowerCase();
  return (SUPPORTED_LANGS as readonly string[]).includes(lang)
    ? (lang as TcgLang)
    : "en";
}

export function cardImageUrl(
  image?: string,
  quality: "low" | "high" = "high",
): string | undefined {
  if (!image) return undefined;
  return `${image}/${quality}.webp`;
}

export function setSymbolUrl(symbol?: string) {
  if (!symbol) return undefined;
  if (/\.(webp|png|jpg)$/i.test(symbol)) return symbol;
  return `${symbol}.webp`;
}

export function trendPriceEur(card: TcgdexCard): number | null {
  const market = card.pricing?.cardmarket;
  if (!market) return null;
  const holoTrend = market["trend-holo"];
  const value = market.trend ?? holoTrend ?? market.avg ?? market.low;
  return typeof value === "number" ? value : null;
}

function queryString(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    const text: string = typeof value === "number" ? String(value) : value;
    search.set(key, text);
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

function wait(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function retryDelay(attempt: number, retryAfterHeader: string | null) {
  const retryAfter = Number(retryAfterHeader);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 8_000);
  }
  return Math.min(300 * 2 ** attempt, 4_000);
}

function isRetryableFailure(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || error instanceof TypeError;
}

async function tcgFetch<T>(path: string): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt += 1) {
    try {
      const response = await fetch(path, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const retryable = RETRY_STATUSES.has(response.status);
      lastError = new Error(`TCGdex gaf ${response.status} terug voor ${path}`);
      if (!retryable || attempt === MAX_FETCH_RETRIES) {
        throw lastError;
      }
      await wait(retryDelay(attempt, response.headers.get("retry-after")));
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TCGdex gaf")) {
        throw error;
      }
      lastError = error instanceof Error ? error : new Error(`TCGdex request mislukt voor ${path}`);
      if (!isRetryableFailure(lastError) || attempt === MAX_FETCH_RETRIES) {
        throw lastError;
      }
      await wait(retryDelay(attempt, null));
    }
  }

  throw lastError ?? new Error(`TCGdex request mislukt voor ${path}`);
}

export async function getCard(id: string, lang: TcgLang): Promise<TcgdexCard> {
  return tcgFetch<TcgdexCard>(`${BASE}/${lang}/cards/${encodeURIComponent(id)}`);
}

export async function getCardOrNull(id: string, lang: TcgLang) {
  try {
    return await getCard(id, lang);
  } catch {
    return null;
  }
}

export type CardSearchFilters = {
  name?: string;
  localId?: string;
  evolveFrom?: string;
  hp?: number;
  illustrator?: string;
  page?: number;
  itemsPerPage?: number;
  sortOrder?: "ASC" | "DESC";
};

function uniqueBriefs(briefs: TcgdexCardBrief[]) {
  return [...new Map(briefs.map((card) => [card.id, card])).values()];
}

export async function searchCards(
  lang: TcgLang,
  filters: CardSearchFilters,
): Promise<TcgdexCardBrief[]> {
  const path =
    `${BASE}/${lang}/cards` +
    queryString({
      name: filters.name,
      localId: filters.localId,
      evolveFrom: filters.evolveFrom,
      hp: filters.hp,
      illustrator: filters.illustrator,
      "pagination:page": filters.page ?? 1,
      "pagination:itemsPerPage": filters.itemsPerPage ?? 40,
      "sort:field": "releaseDate",
      "sort:order": filters.sortOrder ?? "DESC",
    });

  const result = await tcgFetch<TcgdexCardBrief[] | TcgdexCardBrief>(path);
  return Array.isArray(result) ? result : [result];
}

export async function searchAllCards(
  lang: TcgLang,
  filters: Omit<CardSearchFilters, "page" | "itemsPerPage">,
  max = 300,
): Promise<TcgdexCardBrief[]> {
  const path =
    `${BASE}/${lang}/cards` +
    queryString({
      name: filters.name,
      localId: filters.localId,
      evolveFrom: filters.evolveFrom,
      hp: filters.hp,
      illustrator: filters.illustrator,
    });

  const result = await tcgFetch<TcgdexCardBrief[] | TcgdexCardBrief>(path);
  const briefs = uniqueBriefs(Array.isArray(result) ? result : [result]);
  return briefs.slice(0, max);
}

export function localIdVariants(localId: string) {
  const raw = localId.replace(/^0+/, "") || "0";
  const padded = raw.padStart(3, "0");
  return [...new Set([localId, raw, padded])];
}

function sameCount(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left == null || right == null || left === "") return false;
  return Number(left) === Number(right);
}

type SetBrief = {
  id: string;
  name: string;
  symbol?: string;
  cardCount?: { official?: number; total?: number };
};

let setsCache: { lang: TcgLang; at: number; sets: SetBrief[] } | null = null;

export async function listSets(lang: TcgLang) {
  if (setsCache && setsCache.lang === lang && Date.now() - setsCache.at < 6 * 60 * 60 * 1000) {
    return setsCache.sets;
  }
  const result = await tcgFetch<SetBrief[] | SetBrief>(`${BASE}/${lang}/sets`);
  const sets = Array.isArray(result) ? result : [result];
  setsCache = { lang, at: Date.now(), sets };
  return sets;
}

type SetDetail = SetBrief & {
  abbreviation?: { official?: string };
  abbreviations?: { official?: string };
};

async function lookupSetIdByAbbreviation(lang: TcgLang, code: string, setTotal?: string | null) {
  const known = setIdForCode(code);
  if (known) return known;

  const sets = await listSets(lang);
  const matching = setTotal
    ? sets.filter(
        (set) => sameCount(set.cardCount?.official, setTotal) || sameCount(set.cardCount?.total, setTotal),
      )
    : [];
  const newestFirst = [...sets].reverse();
  const ranked = [
    ...matching,
    ...newestFirst.filter((set) => !matching.some((hit) => hit.id === set.id)),
  ];
  const unique = [...new Map(ranked.map((set) => [set.id, set])).values()].slice(
    0,
    Math.max(matching.length, ABBREV_FALLBACK_LIMIT),
  );

  let found: string | null = null;
  await mapPool(unique, ABBREV_PROBE_CONCURRENCY, async (set) => {
    if (found || setIdForCode(code)) return null;
    const detail = await tcgFetch<SetDetail>(`${BASE}/${lang}/sets/${encodeURIComponent(set.id)}`);
    const official = (detail.abbreviation?.official ?? detail.abbreviations?.official ?? "").toUpperCase();
    if (official) rememberSetCode(official, set.id);
    if (official === code) found = set.id;
    return found;
  });
  return found ?? setIdForCode(code) ?? null;
}

export async function resolveSetId(lang: TcgLang, setCode: string, setTotal?: string | null) {
  const code = setCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const seeded = setIdForCode(code);
  if (seeded) return seeded;
  return lookupSetIdByAbbreviation(lang, code, setTotal);
}

export async function cardsBySetStamp(
  lang: TcgLang,
  setCode: string,
  localId: string,
  setTotal?: string | null,
): Promise<TcgdexCard[]> {
  const setId = await resolveSetId(lang, setCode, setTotal);
  if (!setId) return [];
  const found: TcgdexCard[] = [];
  for (const local of localIdVariants(localId)) {
    const card = await getCardOrNull(`${setId}-${local}`, lang);
    if (card) found.push(card);
  }
  return found;
}

export async function cardsByLocalId(lang: TcgLang, localId: string): Promise<TcgdexCardBrief[]> {
  const found = await mapPool(localIdVariants(localId), 3, (local) =>
    searchCards(lang, { localId: local, itemsPerPage: 40 }),
  );
  return uniqueBriefs(found.flatMap((item) => item ?? [])).slice(0, 40);
}

export async function cardsByCollector(
  lang: TcgLang,
  localId: string,
  setTotal: string,
): Promise<TcgdexCardBrief[]> {
  const sets = await listSets(lang);
  const matched = sets
    .filter((set) => {
      return sameCount(set.cardCount?.official, setTotal) || sameCount(set.cardCount?.total, setTotal);
    })
    .slice(0, 24);
  const variants = localIdVariants(localId);
  const found = await mapPool(matched, 4, async (set) => {
    for (const local of variants) {
      const card = await getCardOrNull(`${set.id}-${local}`, lang);
      if (card) return card;
    }
    return null;
  });
  return found.filter((card): card is NonNullable<typeof card> => Boolean(card));
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<(R | null)[]> {
  const out = new Array<R | null>(items.length).fill(null);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        out[index] = await mapper(items[index], index);
      } catch {
        out[index] = null;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

export async function hydrateCards(
  briefs: TcgdexCardBrief[],
  lang: TcgLang,
  limit = 8,
): Promise<TcgdexCard[]> {
  const slice = uniqueBriefs(briefs).slice(0, limit);

  return mapPool(slice, 4, async (brief) => {
    try {
      return await getCard(brief.id, lang);
    } catch {
      return {
        ...brief,
        pricing: { cardmarket: {} as CardmarketPricing },
      } satisfies TcgdexCard;
    }
  }).then((cards) => cards.filter((card): card is TcgdexCard => Boolean(card)));
}
