import type {
  CardCondition,
  CollectionEntry,
  CollectionResponse,
  Lang,
  ScanResponse,
  TcgdexCard,
} from "./types";

async function parseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request mislukt (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const credentials: RequestInit = { credentials: "include" };

export function cardArt(image?: string, quality: "low" | "high" = "high") {
  if (!image) return undefined;
  if (image.endsWith(".webp") || image.endsWith(".png")) return image;
  return `${image}/${quality}.webp`;
}

export function formatEur(value: number | null | undefined) {
  if (value == null) return "—";
  return new Intl.NumberFormat("nl-BE", {
    style: "currency",
    currency: "EUR",
  }).format(value);
}

export function trendPrice(card: TcgdexCard, foil = false) {
  const market = card.pricing?.cardmarket;
  if (!market) return null;
  if (foil) {
    return market["trend-holo"] ?? market.trend ?? market.avg ?? market.low ?? null;
  }
  return market.trend ?? market["trend-holo"] ?? market.avg ?? market.low ?? null;
}

export async function scanCard(file: Blob, lang: Lang, signal?: AbortSignal) {
  const form = new FormData();
  form.append("image", file, "scan.jpg");
  form.append("lang", lang);
  const response = await fetch("/api/scan", { method: "POST", body: form, ...credentials, signal });
  return parseJson<ScanResponse>(response);
}

export async function searchCards(query: string, lang: Lang, signal?: AbortSignal) {
  const params = new URLSearchParams({ q: query, lang });
  const response = await fetch(`/api/cards?${params}`, { ...credentials, signal });
  return parseJson<TcgdexCard[]>(response);
}

export async function fetchCollection() {
  const response = await fetch("/api/collection", credentials);
  return parseJson<CollectionResponse>(response);
}

export async function addCard(
  cardId: string,
  lang: Lang,
  condition: CardCondition = "nm",
) {
  const response = await fetch("/api/collection", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cardId, lang, condition }),
    ...credentials,
  });
  return parseJson<CollectionEntry>(response);
}

export async function updateCard(
  id: string,
  patch: { quantity?: number; condition?: CardCondition },
) {
  const response = await fetch(`/api/collection/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
    ...credentials,
  });
  return parseJson<CollectionEntry>(response);
}

export async function removeCard(id: string) {
  const response = await fetch(`/api/collection/${id}`, {
    method: "DELETE",
    ...credentials,
  });
  return parseJson<void>(response);
}
