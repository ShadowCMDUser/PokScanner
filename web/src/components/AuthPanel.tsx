import { useState, type FormEvent } from "react";
import { authClient, type SocialProvider } from "../auth-client";

const SOCIAL: { id: SocialProvider; label: string; className: string }[] = [
  { id: "google", label: "Doorgaan met Google", className: "google" },
  { id: "facebook", label: "Doorgaan met Facebook", className: "facebook" },
  { id: "discord", label: "Doorgaan met Discord", className: "discord" },
];

type Props = {
  providers: SocialProvider[];
  onDone?: () => void;
};

export function AuthPanel({ providers, onDone }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
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

  async function social(provider: SocialProvider) {
    if (!providers.includes(provider)) {
      setError("Deze login is nog niet ingesteld. Gebruik e-mail of voeg de keys toe in Dokploy.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: "/",
    });
    if (result.error) {
      setError(result.error.message || "Social login mislukt");
      setBusy(false);
    }
  }

  return (
    <div className="auth-panel">
      <div className="social-grid">
        {SOCIAL.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn social ${item.className}`}
            disabled={busy}
            onClick={() => void social(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="auth-split">of met e-mail</div>

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
          placeholder="Wachtwoord (min. 8 tekens)"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={8}
          required
        />
        {error && <div className="error">{error}</div>}
        <button className="btn primary" disabled={busy}>
          {busy ? "Even geduld..." : mode === "login" ? "Log in" : "Maak account"}
        </button>
      </form>

      <button
        className="btn ghost"
        type="button"
        onClick={() => setMode(mode === "login" ? "register" : "login")}
      >
        {mode === "login" ? "Nog geen account? Registreer" : "Al een account? Log in"}
      </button>
    </div>
  );
}
