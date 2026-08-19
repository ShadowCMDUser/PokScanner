import type {
  CardmarketPricing,
  TcgdexCard,
  TcgdexCardBrief,
} from "../types.js";

const BASE = "https://api.tcgdex.net/v2";
const SUPPORTED_LANGS = ["en", "fr", "de", "es", "it"] as const;

export type TcgLang = (typeof SUPPORTED_LANGS)[number];

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
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded ? `?${encoded}` : "";
}

async function tcgFetch<T>(path: string): Promise<T> {
  const response = await fetch(path, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`TCGdex gaf ${response.status} terug voor ${path}`);
  }

  return (await response.json()) as T;
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
  const found = await mapPool(matched, 8, async (set) => {
    for (const local of variants) {
      const card = await getCardOrNull(`${set.id}-${local}`, lang);
      if (card) return card;
    }
    return null;
  });
  return found.filter((card): card is NonNullable<typeof card> => Boolean(card));
}

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const out = new Array<R>(items.length);
  let next = 0;

  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      out[index] = await mapper(items[index], index);
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

  return mapPool(slice, 10, async (brief) => {
    try {
      return await getCard(brief.id, lang);
    } catch {
      return {
        ...brief,
        pricing: { cardmarket: {} as CardmarketPricing },
      } satisfies TcgdexCard;
    }
  });
}
