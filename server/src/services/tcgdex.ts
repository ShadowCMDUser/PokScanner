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
