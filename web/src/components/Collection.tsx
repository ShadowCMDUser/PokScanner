import { useEffect, useRef, useState } from "react";
import { fetchCollection, formatEur, removeCard, updateCard } from "../api";
import { PokeballIcon } from "./Pokeball";
import type { CollectionEntry, CollectionResponse } from "../types";

function withStats(cards: CollectionEntry[]): CollectionResponse {
  const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
  const totalValue = cards.reduce((sum, card) => sum + (card.priceEur ?? 0) * card.quantity, 0);
  return {
    cards,
    stats: {
      unique: cards.length,
      totalCards,
      totalValue: Number(totalValue.toFixed(2)),
    },
  };
}

export function Collection() {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const inflight = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    let isMounted = true;

    async function load() {
      try {
        const collection = await fetchCollection();
        if (!isMounted) return;
        setError(null);
        setData(collection);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : "Collectie laden mislukt");
      }
    }

    void load();
    return () => {
      isMounted = false;
      mounted.current = false;
    };
  }, []);

  function markPending(id: string, value: boolean) {
    if (value) inflight.current.add(id);
    else inflight.current.delete(id);
    setPendingIds([...inflight.current]);
  }

  async function runMutation(
    card: CollectionEntry,
    nextCards: CollectionEntry[],
    request: Promise<unknown>,
    fallbackMessage: string,
  ) {
    if (!data || inflight.current.has(card.id)) return;
    const snapshot = data;
    markPending(card.id, true);
    setError(null);
    setData(withStats(nextCards));
    try {
      await request;
    } catch (err) {
      if (!mounted.current) return;
      setData((current) => {
        const original = snapshot.cards.find((item) => item.id === card.id);
        if (!current || !original) return snapshot;
        const others = current.cards.filter((item) => item.id !== card.id);
        const index = snapshot.cards.findIndex((item) => item.id === card.id);
        const cards = [...others];
        cards.splice(Math.min(Math.max(index, 0), cards.length), 0, original);
        return withStats(cards);
      });
      setError(err instanceof Error ? err.message : fallbackMessage);
    } finally {
      if (mounted.current) markPending(card.id, false);
    }
  }

  function changeQuantity(card: CollectionEntry, quantity: number) {
    if (quantity < 1) return;
    void runMutation(
      card,
      data!.cards.map((item) => (item.id === card.id ? { ...item, quantity } : item)),
      updateCard(card.id, { quantity }),
      "Bijwerken mislukt",
    );
  }

  function deleteCard(card: CollectionEntry) {
    void runMutation(
      card,
      data!.cards.filter((item) => item.id !== card.id),
      removeCard(card.id),
      "Verwijderen mislukt",
    );
  }

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) {
    return (
      <div className="scan-status">
        <PokeballIcon className="pokeball" spin />
        Collectie laden...
      </div>
    );
  }

  return (
    <section className="stack">
      {error && <div className="error">{error}</div>}
      <div className="stats">
        <div className="stat">
          <span className="muted">Uniek</span>
          <strong>{data.stats.unique}</strong>
        </div>
        <div className="stat">
          <span className="muted">Stuks</span>
          <strong>{data.stats.totalCards}</strong>
        </div>
        <div className="stat">
          <span className="muted">Waarde</span>
          <strong>{formatEur(data.stats.totalValue)}</strong>
        </div>
      </div>

      {data.cards.length === 0 ? (
        <div className="empty">
          <PokeballIcon className="pokeball login-ball" />
          <p className="muted">Nog geen kaarten. Ga scannen.</p>
        </div>
      ) : (
        <div className="grid">
          {data.cards.map((card) => {
            const busy = pendingIds.includes(card.id);
            return (
              <article className="card-tile" key={card.id}>
                <button
                  className="tile-x"
                  aria-label="Verwijder"
                  disabled={busy}
                  onClick={() => deleteCard(card)}
                >
                  ×
                </button>
                {card.image && <img src={card.image} alt={card.name} />}
                <div className="tile-info">
                  <h3>{card.name}</h3>
                  <p className="muted">
                    {card.setName} · #{card.localId}
                  </p>
                  <p className="price">{formatEur(card.priceEur)}</p>
                  <div className="qty">
                    <button
                      onClick={() => changeQuantity(card, card.quantity - 1)}
                      disabled={busy || card.quantity <= 1}
                    >
                      −
                    </button>
                    <span>
                      {card.quantity}× {card.condition.toUpperCase()}
                    </span>
                    <button
                      onClick={() => changeQuantity(card, card.quantity + 1)}
                      disabled={busy}
                    >
                      +
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
