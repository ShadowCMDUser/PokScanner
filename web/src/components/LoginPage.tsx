import { AuthPanel } from "./AuthPanel";
import { InstallHint } from "./InstallHint";

type Props = {
  onDone?: () => void;
};

export function LoginPage({ onDone }: Props) {
  return (
    <main className="login-screen">
      <div className="login-brand">
        <svg className="pokeball login-ball" viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="30" fill="#111118" stroke="#FFCB05" strokeWidth="4" />
          <path d="M4 32h56" stroke="#E3350D" strokeWidth="10" />
          <circle cx="32" cy="32" r="10" fill="#fff" stroke="#111118" strokeWidth="4" />
        </svg>
        <h1>PokScanner</h1>
        <p>Maak een account of log in om te scannen.</p>
      </div>
      <div className="login-card">
        <AuthPanel onDone={onDone} />
      </div>
      <InstallHint />
    </main>
  );
}
