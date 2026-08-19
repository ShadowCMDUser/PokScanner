import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { CardCondition, CollectionEntry, CollectionStore, TcgdexCard } from "./types.js";
import { cardImageUrl, trendPriceEur } from "./services/tcgdex.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
const storePath = join(dataDir, "collection.json");

function emptyStore(): CollectionStore {
  return { cards: [] };
}

function readStore(): CollectionStore {
  if (!existsSync(storePath)) {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as CollectionStore;
    return { cards: Array.isArray(parsed.cards) ? parsed.cards : [] };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CollectionStore) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

export function listCollection(): CollectionEntry[] {
  return readStore().cards.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function addToCollection(
  card: TcgdexCard,
  options: { quantity?: number; condition?: CardCondition } = {},
): CollectionEntry {
  const store = readStore();
  const condition = options.condition ?? "nm";
  const quantity = Math.max(1, options.quantity ?? 1);

  const existing = store.cards.find(
    (entry) => entry.cardId === card.id && entry.condition === condition,
  );

  if (existing) {
    existing.quantity += quantity;
    existing.priceEur = trendPriceEur(card) ?? existing.priceEur;
    writeStore(store);
    return existing;
  }

  const entry: CollectionEntry = {
    id: randomUUID(),
    cardId: card.id,
    name: card.name,
    setName: card.set?.name ?? "Onbekende set",
    setId: card.set?.id ?? "",
    localId: card.localId,
    image: cardImageUrl(card.image),
    rarity: card.rarity,
    types: card.types,
    quantity,
    condition,
    priceEur: trendPriceEur(card),
    addedAt: new Date().toISOString(),
  };

  store.cards.push(entry);
  writeStore(store);
  return entry;
}

export function updateCollectionEntry(
  id: string,
  patch: Partial<Pick<CollectionEntry, "quantity" | "condition">>,
): CollectionEntry | null {
  const store = readStore();
  const entry = store.cards.find((item) => item.id === id);
  if (!entry) return null;

  if (typeof patch.quantity === "number") {
    entry.quantity = Math.max(1, Math.floor(patch.quantity));
  }
  if (patch.condition) {
    entry.condition = patch.condition;
  }

  writeStore(store);
  return entry;
}

export function removeCollectionEntry(id: string): boolean {
  const store = readStore();
  const next = store.cards.filter((item) => item.id !== id);
  if (next.length === store.cards.length) return false;
  writeStore({ cards: next });
  return true;
}
