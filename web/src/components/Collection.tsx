import { useEffect, useState } from "react";
import { fetchCollection, formatEur, removeCard, updateCard } from "../api";
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
  if (!data) return <div className="scan-status">Collectie laden...</div>;

  return (
    <section>
      <div className="stats">
        <div className="stat">
          <span className="muted">Unieke kaarten</span>
          <strong>{data.stats.unique}</strong>
        </div>
        <div className="stat">
          <span className="muted">Totaal stuks</span>
          <strong>{data.stats.totalCards}</strong>
        </div>
        <div className="stat">
          <span className="muted">Geschatte waarde</span>
          <strong>{formatEur(data.stats.totalValue)}</strong>
        </div>
      </div>

      {data.cards.length === 0 ? (
        <p className="muted">Nog geen kaarten. Scan je eerste kaart om te beginnen.</p>
      ) : (
        <div className="grid">
          {data.cards.map((card) => (
            <article className="card-tile" key={card.id}>
              {card.image && <img src={card.image} alt={card.name} />}
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
                  -
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
              <button
                className="btn ghost"
                onClick={() => {
                  void removeCard(card.id).then(load);
                }}
              >
                Verwijder
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
