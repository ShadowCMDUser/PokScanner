import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { cardArt, searchCards } from "../api";
import type { CardCondition, Lang, TcgdexCard } from "../types";
import { PokeballIcon } from "./Pokeball";

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
  const [setFilter, setSetFilter] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
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

  async function runSearch(value: string) {
    const needle = value.trim();
    if (needle.length < 2) {
      abortRef.current?.abort();
      setCards([]);
      setHasSearched(false);
      setBusy(false);
      setError(null);
      setSetFilter(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);

    try {
      const results = await searchCards(needle, lang, controller.signal);
      if (!mounted.current || abortRef.current !== controller) return;
      setCards(results);
      setSetFilter(null);
      setHasSearched(true);
    } catch (err) {
      if (!mounted.current || abortRef.current !== controller || isAbortError(err)) return;
      setError(err instanceof Error ? err.message : "Zoeken mislukt");
      setHasSearched(true);
    } finally {
      if (mounted.current && abortRef.current === controller) setBusy(false);
    }
  }

  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      abortRef.current?.abort();
      setCards([]);
      setHasSearched(false);
      setBusy(false);
      setError(null);
      setSetFilter(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void runSearch(needle);
    }, 280);
    return () => window.clearTimeout(timer);
  }, [query, lang]);

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

  function submit(event: FormEvent) {
    event.preventDefault();
    void runSearch(query);
  }

  const sets = useMemo(() => {
    const counts = new Map<string, { id: string; name: string; count: number }>();
    for (const card of cards) {
      const id = card.set?.id;
      if (!id) continue;
      const current = counts.get(id);
      if (current) current.count += 1;
      else counts.set(id, { id, name: card.set?.name ?? id, count: 1 });
    }
    return [...counts.values()].sort((a, b) => b.count - a.count);
  }, [cards]);

  const visible = setFilter ? cards.filter((card) => card.set?.id === setFilter) : cards;
  const idle = !hasSearched && !busy && query.trim().length < 2;

  return (
    <section className="search-page">
      <form className="search-box" onSubmit={submit} role="search">
        <svg className="search-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 16l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
        <input
          className="search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Pikachu, Charizard, sv02-063..."
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Zoek kaarten"
        />
        {busy ? (
          <PokeballIcon className="search-spin" spin />
        ) : query ? (
          <button
            type="button"
            className="search-clear"
            aria-label="Wis zoekopdracht"
            onClick={() => setQuery("")}
          >
            ×
          </button>
        ) : null}
      </form>

      {error && <div className="error">{error}</div>}

      {sets.length > 1 && (
        <div className="set-chips" role="group" aria-label="Filter op set">
          <button
            type="button"
            className={`chip${setFilter ? "" : " active"}`}
            onClick={() => setSetFilter(null)}
          >
            Alle · {cards.length}
          </button>
          {sets.slice(0, 18).map((set) => (
            <button
              type="button"
              key={set.id}
              className={`chip${setFilter === set.id ? " active" : ""}`}
              onClick={() => setSetFilter(set.id)}
            >
              {set.name} · {set.count}
            </button>
          ))}
        </div>
      )}

      {hasSearched && !busy && visible.length > 0 && (
        <p className="search-count">
          {visible.length}
          {visible.length === 1 ? " kaart" : " kaarten"}
          {setFilter ? ` in ${sets.find((set) => set.id === setFilter)?.name ?? "deze set"}` : ""}
        </p>
      )}

      {idle && (
        <div className="search-idle">
          <PokeballIcon className="pokeball login-ball" />
          <h2>Zoek een kaart</h2>
          <p className="muted">Typ een naam. Nieuwste prints staan eerst, filter daarna op set.</p>
        </div>
      )}

      {busy && cards.length === 0 && (
        <div className="grid search-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <div className="card-tile search-skel" key={index} />
          ))}
        </div>
      )}

      {hasSearched && !busy && visible.length === 0 && (
        <div className="search-idle">
          <p className="muted">Geen kaarten voor “{query.trim()}”.</p>
        </div>
      )}

      {visible.length > 0 && (
        <div className="grid search-grid">
          {visible.map((card) => {
            const isAdding = adding.has(card.id);
            const isAdded = added.has(card.id);
            const art = card.image ? cardArt(card.image, "low") : undefined;
            return (
              <article className="card-tile search-tile" key={card.id}>
                {art ? (
                  <img src={art} alt={card.name} />
                ) : (
                  <div className="tile-fallback">{card.name}</div>
                )}
                <button
                  type="button"
                  className={`tile-add${isAdded ? " added" : ""}`}
                  disabled={isAdding}
                  aria-label={isAdded ? `${card.name} toegevoegd` : `${card.name} toevoegen`}
                  onClick={() => void handleAdd(card)}
                >
                  {isAdding ? "…" : isAdded ? "✓" : "+"}
                </button>
                <div className="tile-info">
                  <h3>{card.name}</h3>
                  <p className="muted">
                    {card.set?.name ?? "Onbekende set"} · #{card.localId}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
