import { useEffect, useRef, useState, type FormEvent } from "react";
import { authClient } from "../auth-client";

type Props = {
  onDone?: () => void;
};

type AuthMode = "login" | "register";

export function AuthPanel({ onDone }: Props) {
  const [mode, setMode] = useState<AuthMode>("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  function switchMode(next: AuthMode) {
    if (busy || next === mode) return;
    setMode(next);
    setError(null);
    setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === "register") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: name.trim() || email.split("@")[0],
        });
        if (result.error) throw new Error(result.error.message || "Registreren mislukt");
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) throw new Error(result.error.message || "Inloggen mislukt");
      }
      onDone?.();
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Inloggen mislukt");
      }
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      <div className="seg">
        <button
          type="button"
          className={mode === "register" ? "active" : ""}
          disabled={busy}
          onClick={() => switchMode("register")}
        >
          Account
        </button>
        <button
          type="button"
          className={mode === "login" ? "active" : ""}
          disabled={busy}
          onClick={() => switchMode("login")}
        >
          Inloggen
        </button>
      </div>
      <form className="auth-form" onSubmit={(event) => void submit(event)}>
        {mode === "register" && (
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Naam"
            autoComplete="name"
            enterKeyHint="next"
            disabled={busy}
          />
        )}
        <input
          className="field"
          type="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="E-mail"
          autoComplete="email"
          required
          disabled={busy}
        />
        <input
          className="field"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Wachtwoord (min. 8)"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={8}
          required
          disabled={busy}
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Even geduld..." : mode === "login" ? "Log in" : "Maak account"}
        </button>
      </form>
    </div>
  );
}
