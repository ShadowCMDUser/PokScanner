import { useEffect, type HTMLAttributes } from "react";
import { AuthPanel } from "./AuthPanel";
import { InstallHint } from "./InstallHint";
import { PokeballIcon } from "./Pokeball";

type Props = HTMLAttributes<HTMLElement> & {
  onDone?: () => void;
};

export function LoginPage({ onDone, className, ...rest }: Props) {
  useEffect(() => {
    document.title = "Inloggen | PokScanner";
  }, []);

  return (
    <main
      {...rest}
      className={["login-screen", className].filter(Boolean).join(" ")}
      aria-labelledby="login-title"
    >
      <div className="login-brand">
        <PokeballIcon className="pokeball login-ball" />
        <h1 id="login-title">PokScanner</h1>
        <p>Scan je kaarten. Bewaar je collectie.</p>
      </div>
      <div className="login-card">
        <AuthPanel onDone={onDone} />
      </div>
      <InstallHint />
    </main>
  );
}
