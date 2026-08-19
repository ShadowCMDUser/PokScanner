import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CardCondition, CollectionEntry, TcgdexCard } from "./types.js";
import { dataDir } from "./paths.js";
import { cardImageUrl, trendPriceEur } from "./services/tcgdex.js";

type CollectionFile = {
  users: Record<string, CollectionEntry[]>;
};

const storePath = join(dataDir, "collection.json");

function emptyStore(): CollectionFile {
  return { users: {} };
}

function readStore(): CollectionFile {
  if (!existsSync(storePath)) {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as {
      users?: Record<string, CollectionEntry[]>;
      cards?: CollectionEntry[];
    };
    if (parsed.users && typeof parsed.users === "object") {
      return { users: parsed.users };
    }
    return emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store: CollectionFile) {
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(storePath, JSON.stringify(store, null, 2), "utf8");
}

function userCards(store: CollectionFile, userId: string) {
  return store.users[userId] ?? [];
}

export function listCollection(userId: string): CollectionEntry[] {
  return userCards(readStore(), userId).sort((a, b) => b.addedAt.localeCompare(a.addedAt));
}

export function addToCollection(
  userId: string,
  card: TcgdexCard,
  options: { quantity?: number; condition?: CardCondition } = {},
): CollectionEntry {
  const store = readStore();
  const cards = userCards(store, userId);
  const condition = options.condition ?? "nm";
  const quantity = Math.max(1, options.quantity ?? 1);

  const existing = cards.find(
    (entry) => entry.cardId === card.id && entry.condition === condition,
  );

  if (existing) {
    existing.quantity += quantity;
    existing.priceEur = trendPriceEur(card) ?? existing.priceEur;
    store.users[userId] = cards;
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

  store.users[userId] = [...cards, entry];
  writeStore(store);
  return entry;
}

export function updateCollectionEntry(
  userId: string,
  id: string,
  patch: Partial<Pick<CollectionEntry, "quantity" | "condition">>,
): CollectionEntry | null {
  const store = readStore();
  const cards = userCards(store, userId);
  const entry = cards.find((item) => item.id === id);
  if (!entry) return null;

  if (typeof patch.quantity === "number") {
    entry.quantity = Math.max(1, Math.floor(patch.quantity));
  }
  if (patch.condition) {
    entry.condition = patch.condition;
  }

  store.users[userId] = cards;
  writeStore(store);
  return entry;
}

export function removeCollectionEntry(userId: string, id: string): boolean {
  const store = readStore();
  const cards = userCards(store, userId);
  const next = cards.filter((item) => item.id !== id);
  if (next.length === cards.length) return false;
  store.users[userId] = next;
  writeStore(store);
  return true;
}
