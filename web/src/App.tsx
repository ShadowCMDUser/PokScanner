import { useCallback, useEffect, useState } from "react";
import { addCard } from "./api";
import { authClient } from "./auth-client";
import { Collection } from "./components/Collection";
import { LoginPage } from "./components/LoginPage";
import { PokeballIcon } from "./components/Pokeball";
import { Scanner } from "./components/Scanner";
import { Search } from "./components/Search";
import { ScanActionProvider, useScanAction } from "./ScanAction";
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
    setNotice(`${card.name} toegevoegd`);
    setTimeout(() => setNotice(null), 2200);
  }

  if (session.isPending) {
    return (
      <main className="login-screen">
        <div className="login-brand">
          <PokeballIcon className="pokeball login-ball" spin />
          <p className="muted">Laden...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return <LoginPage onDone={() => goTo("scan")} />;
  }

  return (
    <ScanActionProvider>
      <AppShell page={page} lang={lang} notice={notice} goTo={goTo} setLang={setLang} onAdd={handleAdd} />
    </ScanActionProvider>
  );
}

function AppShell({
  page,
  lang,
  notice,
  goTo,
  setLang,
  onAdd,
}: {
  page: Page;
  lang: Lang;
  notice: string | null;
  goTo: (page: Page) => void;
  setLang: (lang: Lang) => void;
  onAdd: (card: TcgdexCard, condition: CardCondition) => Promise<void>;
}) {
  const { handle } = useScanAction();

  return (
    <div className={`app${page === "scan" ? " app-scan" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <PokeballIcon className="pokeball" />
          {page !== "scan" && <h1>PokScanner</h1>}
        </div>
        <div className="top-actions">
          <select
            className="lang-select"
            value={lang}
            onChange={(event) => setLang(event.target.value as Lang)}
            aria-label="Taal"
          >
            {LANGS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            className="icon-btn"
            aria-label="Uitloggen"
            onClick={() => {
              void authClient.signOut();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M10 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h3M15 8l4 4-4 4M9 12h10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </header>

      {notice && <div className="toast">{notice}</div>}

      <main className={page === "scan" ? "page page-scan" : "page"}>
        {page === "scan" && <Scanner lang={lang} onAdd={onAdd} />}
        {page === "collection" && <Collection />}
        {page === "search" && <Search lang={lang} onAdd={onAdd} />}
      </main>

      <nav className="tabbar">
        <button className={page === "collection" ? "active" : ""} onClick={() => goTo("collection")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="6" width="11" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <rect x="8" y="4" width="11" height="14" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
          Collectie
        </button>
        <button
          className={`tab-scan${page === "scan" ? " active" : ""}`}
          onClick={() => {
            if (page !== "scan") {
              goTo("scan");
              return;
            }
            handle?.capture();
          }}
          aria-label="Scan"
        >
          <PokeballIcon spin={Boolean(handle?.scanning)} />
        </button>
        <button className={page === "search" ? "active" : ""} onClick={() => goTo("search")}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M16 16l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          Zoek
        </button>
      </nav>
    </div>
  );
}
