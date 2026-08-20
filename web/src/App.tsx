import { useCallback, useEffect, useState } from "react";
import { addCard } from "./api";
import { authClient } from "./auth-client";
import { Collection } from "./components/Collection";
import { LoginPage } from "./components/LoginPage";
import { PokeballIcon } from "./components/Pokeball";
import { Scanner } from "./components/Scanner";
import { Search } from "./components/Search";
import { ScanActionProvider, useScanAction } from "./ScanAction";
import { SUPPORTED_LANGS, type CardCondition, type Lang, type Page, type TcgdexCard } from "./types";

const LANG_LABELS: Record<Lang, string> = {
  en: "EN",
  fr: "FR",
  de: "DE",
  es: "ES",
  it: "IT",
  ja: "JP",
};

const LANGS = SUPPORTED_LANGS.map((id) => ({ id, label: LANG_LABELS[id] }));

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
    try {
      await addCard(card.id, lang, condition);
      setNotice(`${card.name} toegevoegd`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Toevoegen mislukt");
    }
    window.setTimeout(() => setNotice(null), 2200);
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
        <ScanTabButton page={page} goTo={goTo} />
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

function ScanTabButton({ page, goTo }: { page: Page; goTo: (page: Page) => void }) {
  const { handle } = useScanAction();
  const scanning = Boolean(handle?.scanning);
  const blocked = !handle || handle.busy;

  return (
    <button
      className={`tab-scan${page === "scan" ? " active" : ""}`}
      disabled={page === "scan" && blocked}
      onClick={() => {
        if (page !== "scan") {
          goTo("scan");
          return;
        }
        if (!handle || handle.busy) return;
        handle.capture();
      }}
      aria-label="Scan"
    >
      <PokeballIcon spin={scanning} />
    </button>
  );
}
