import { useEffect, useRef, useState, type FormEvent } from "react";
import { cardArt, formatEur, searchCards, trendPrice } from "../api";
import type { CardCondition, Lang, TcgdexCard } from "../types";

type Props = {
  lang: Lang;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
};

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

export function Search({ lang, onAdd }: Props) {
  const [query, setQuery] = useState("");
  const [cards, setCards] = useState<TcgdexCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(() => new Set());
  const [adding, setAdding] = useState<Set<string>>(() => new Set());
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  const addingRef = useRef(new Set<string>());

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setBusy(true);
    setError(null);
    try {
      const results = await searchCards(query, lang, controller.signal);
      if (!mounted.current || abortRef.current !== controller) return;
      setCards(results);
    } catch (err) {
      if (!mounted.current || abortRef.current !== controller || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Zoeken mislukt");
    } finally {
      if (mounted.current && abortRef.current === controller) setBusy(false);
    }
  }

  async function handleAdd(card: TcgdexCard) {
    if (addingRef.current.has(card.id)) return;
    addingRef.current.add(card.id);
    setAdding(new Set(addingRef.current));
    try {
      await onAdd(card, "nm");
      if (!mounted.current) return;
      setAdded((prev) => new Set(prev).add(card.id));
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Toevoegen mislukt");
    } finally {
      addingRef.current.delete(card.id);
      if (mounted.current) setAdding(new Set(addingRef.current));
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

      {!busy && cards.length > 0 && (
        <p className="muted search-count">{cards.length} kaarten</p>
      )}

      <div className="grid">
        {cards.map((card) => {
          const isAdding = adding.has(card.id);
          return (
            <article className="card-tile" key={card.id}>
              {card.image && <img src={cardArt(card.image, "low")} alt={card.name} />}
              <div className="tile-info">
                <h3>{card.name}</h3>
                <p className="muted">
                  {card.set?.name} · #{card.localId}
                </p>
                <p className="price">{formatEur(trendPrice(card))}</p>
                <button
                  className="btn primary btn-sm"
                  disabled={isAdding}
                  onClick={() => void handleAdd(card)}
                >
                  {added.has(card.id) ? "Toegevoegd" : "Voeg toe"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
