import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { CardCondition, CollectionEntry, CollectionStore, TcgdexCard } from "./types.js";
import { dataDir } from "./paths.js";
import { cardImageUrl, trendPriceEur } from "./services/tcgdex.js";

const storePath = join(dataDir, "collection.json");
const tmpPath = join(dataDir, "collection.tmp.json");

let cache: CollectionStore | null = null;
let queue: Promise<unknown> = Promise.resolve();

function emptyStore(): CollectionStore {
  return { users: {} };
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function parseStore(raw: string): CollectionStore {
  const parsed = JSON.parse(raw) as {
    users?: Record<string, CollectionEntry[]>;
    cards?: CollectionEntry[];
  };
  if (parsed.users && typeof parsed.users === "object") {
    return { users: parsed.users };
  }
  return emptyStore();
}

async function loadStore(): Promise<CollectionStore> {
  if (cache) return cache;
  try {
    cache = parseStore(await readFile(storePath, "utf8"));
  } catch {
    cache = emptyStore();
  }
  return cache;
}

async function persistStore(store: CollectionStore) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(tmpPath, JSON.stringify(store, null, 2), "utf8");
  await rename(tmpPath, storePath);
}

function userCards(store: CollectionStore, userId: string) {
  return store.users[userId] ?? [];
}

export function listCollection(userId: string): Promise<CollectionEntry[]> {
  return withLock(async () => {
    const store = await loadStore();
    return [...userCards(store, userId)].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  });
}

export function addToCollection(
  userId: string,
  card: TcgdexCard,
  options: { quantity?: number; condition?: CardCondition } = {},
): Promise<CollectionEntry> {
  return withLock(async () => {
    const store = await loadStore();
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
      await persistStore(store);
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
      types: card.types ? [...card.types] : undefined,
      quantity,
      condition,
      priceEur: trendPriceEur(card),
      addedAt: new Date().toISOString(),
    };

    store.users[userId] = [...cards, entry];
    await persistStore(store);
    return entry;
  });
}

export function updateCollectionEntry(
  userId: string,
  id: string,
  patch: Partial<Pick<CollectionEntry, "quantity" | "condition">>,
): Promise<CollectionEntry | null> {
  return withLock(async () => {
    const store = await loadStore();
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
    await persistStore(store);
    return entry;
  });
}

export function removeCollectionEntry(userId: string, id: string): Promise<boolean> {
  return withLock(async () => {
    const store = await loadStore();
    const cards = userCards(store, userId);
    const next = cards.filter((item) => item.id !== id);
    if (next.length === cards.length) return false;
    store.users[userId] = next;
    await persistStore(store);
    return true;
  });
}
