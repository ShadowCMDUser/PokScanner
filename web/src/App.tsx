import { useCallback, useEffect, useState } from "react";
import { addCard } from "./api";
import { authClient } from "./auth-client";
import { Collection } from "./components/Collection";
import { LoginPage } from "./components/LoginPage";
import { Scanner } from "./components/Scanner";
import { Search } from "./components/Search";
import type { CardCondition, Lang, Page, TcgdexCard } from "./types";

const LANGS: { id: Lang; label: string }[] = [
  { id: "en", label: "EN" },
  { id: "fr", label: "FR" },
  { id: "de", label: "DE" },
  { id: "es", label: "ES" },
  { id: "it", label: "IT" },
];

function pageFromHash(): Page {
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "collection" || hash === "search") return hash;
  return "scan";
}

function setHash(page: Page) {
  const next = page === "scan" ? "#/" : `#/${page}`;
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

function PokeballIcon() {
  return (
    <svg className="pokeball" viewBox="0 0 64 64" aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#111118" stroke="#FFCB05" strokeWidth="4" />
      <path d="M4 32h56" stroke="#E3350D" strokeWidth="10" />
      <circle cx="32" cy="32" r="10" fill="#fff" stroke="#111118" strokeWidth="4" />
    </svg>
  );
}

export default function App() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const [page, setPage] = useState<Page>(pageFromHash);
  const [lang, setLang] = useState<Lang>("en");
  const [notice, setNotice] = useState<string | null>(null);

  const goTo = useCallback((next: Page) => {
    setPage(next);
    setHash(next);
  }, []);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  async function handleAdd(card: TcgdexCard, condition: CardCondition) {
    await addCard(card.id, lang, condition);
    setNotice(`${card.name} is toegevoegd aan je collectie.`);
    setTimeout(() => setNotice(null), 2500);
  }

  if (session.isPending) {
    return (
      <main className="login-screen">
        <div className="login-brand">
          <PokeballIcon />
          <p className="muted">Laden...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginPage onDone={() => goTo("scan")} />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <PokeballIcon />
          <div>
            <h1>PokScanner</h1>
            <p>Scan, herken en catalogiseer je Pokémon-kaarten.</p>
          </div>
        </div>
        <div className="top-actions">
          <nav className="nav">
            <button className={page === "scan" ? "active" : ""} onClick={() => goTo("scan")}>
              Scanner
            </button>
            <button
              className={page === "collection" ? "active" : ""}
              onClick={() => goTo("collection")}
            >
              Collectie
            </button>
            <button className={page === "search" ? "active" : ""} onClick={() => goTo("search")}>
              Zoeken
            </button>
          </nav>
          <select value={lang} onChange={(event) => setLang(event.target.value as Lang)}>
            {LANGS.map((item) => (
              <option key={item.id} value={item.id}>
                Taal {item.label}
              </option>
            ))}
          </select>
          <div className="user-chip">
            <span>{user.name || user.email}</span>
            <button
              className="btn ghost"
              onClick={() => {
                void authClient.signOut();
              }}
            >
              Uitloggen
            </button>
          </div>
        </div>
      </header>

      {notice && <div className="scan-status">{notice}</div>}

      {page === "scan" && <Scanner lang={lang} onAdd={handleAdd} />}
      {page === "collection" && <Collection />}
      {page === "search" && <Search lang={lang} onAdd={handleAdd} />}
    </div>
  );
}
