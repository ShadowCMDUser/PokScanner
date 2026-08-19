import { useState, type FormEvent } from "react";
import { authClient } from "../auth-client";

type Props = {
  onDone?: () => void;
};

export function AuthPanel({ onDone }: Props) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof Error ? err.message : "Inloggen mislukt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      <div className="seg">
        <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>
          Account
        </button>
        <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>
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
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Even geduld..." : mode === "login" ? "Log in" : "Maak account"}
        </button>
      </form>
    </div>
  );
}
