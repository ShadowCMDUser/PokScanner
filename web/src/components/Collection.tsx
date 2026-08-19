import { useEffect, useState } from "react";
import { fetchCollection, formatEur, removeCard, updateCard } from "../api";
import { PokeballIcon } from "./Pokeball";
import type { CollectionResponse } from "../types";

export function Collection() {
  const [data, setData] = useState<CollectionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setError(null);
      setData(await fetchCollection());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Collectie laden mislukt");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  if (error) return <div className="error">{error}</div>;
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
          {data.cards.map((card) => (
            <article className="card-tile" key={card.id}>
              <button
                className="tile-x"
                aria-label="Verwijder"
                onClick={() => {
                  void removeCard(card.id).then(load);
                }}
              >
                ×
              </button>
              {card.image && <img src={card.image} alt="" />}
              <div className="tile-info">
                <h3>{card.name}</h3>
                <p className="muted">
                  {card.setName} · #{card.localId}
                </p>
                <p className="price">{formatEur(card.priceEur)}</p>
                <div className="qty">
                  <button
                    onClick={() => {
                      void updateCard(card.id, { quantity: card.quantity - 1 }).then(load);
                    }}
                    disabled={card.quantity <= 1}
                  >
                    −
                  </button>
                  <span>
                    {card.quantity}× {card.condition.toUpperCase()}
                  </span>
                  <button
                    onClick={() => {
                      void updateCard(card.id, { quantity: card.quantity + 1 }).then(load);
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
