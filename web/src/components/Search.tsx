import { useState, type FormEvent } from "react";
import { cardArt, formatEur, searchCards, trendPrice } from "../api";
import type { CardCondition, Lang, TcgdexCard } from "../types";

type Props = {
  lang: Lang;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
};

export function Search({ lang, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<TcgdexCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCards(await searchCards(query, lang));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Zoeken mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="stack">
      <form className="search-bar" onSubmit={(event) => void runSearch(event)}>
        <input
          className="field"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Charizard, Pikachu..."
          enterKeyHint="search"
        />
        <button className="btn primary" disabled={busy || query.trim().length < 2}>
          {busy ? "..." : "Zoek"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      <div className="grid">
        {cards.map((card) => (
          <article className="card-tile" key={card.id}>
            {card.image && <img src={cardArt(card.image, "low")} alt="" />}
            <div className="tile-info">
              <h3>{card.name}</h3>
              <p className="muted">
                {card.set?.name} · #{card.localId}
              </p>
              <p className="price">{formatEur(trendPrice(card))}</p>
              <button
                className="btn primary btn-sm"
                onClick={() => {
                  void onAdd(card, "nm").then(() => setAdded(card.id));
                }}
              >
                {added === card.id ? "Toegevoegd" : "Voeg toe"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
