import { useEffect, useState } from "react";

export function InstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));
    if (standalone) return;

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      setIosHint(true);
      return;
    }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (hidden || (!deferred && !iosHint)) return null;

  return (
    <div className="install-hint">
      {deferred ? (
        <button
          className="btn primary"
          onClick={() => {
            void deferred.prompt();
            setDeferred(null);
          }}
        >
          Installeer als app
        </button>
      ) : (
        <p>Op iPhone: Deel → Zet op beginscherm</p>
      )}
      <button className="btn ghost" type="button" onClick={() => setHidden(true)}>
        Later
      </button>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
