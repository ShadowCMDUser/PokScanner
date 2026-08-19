import { AuthPanel } from "./AuthPanel";
import { InstallHint } from "./InstallHint";
import { PokeballIcon } from "./Pokeball";

type Props = {
  onDone?: () => void;
};

export function LoginPage({ onDone }: Props) {
  return (
    <main className="login-screen">
      <div className="login-brand">
        <PokeballIcon className="pokeball login-ball" />
        <h1>PokScanner</h1>
        <p>Scan je kaarten. Bewaar je collectie.</p>
      </div>
      <div className="login-card">
        <AuthPanel onDone={onDone} />
      </div>
      <InstallHint />
    </main>
  );
}
