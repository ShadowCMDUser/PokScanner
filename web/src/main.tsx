import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

type BoundaryState = { error: Error | null };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("React-fout:", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="login-screen">
        <div className="error">Er ging iets mis. Probeer de pagina opnieuw te laden.</div>
        <button className="btn primary" type="button" onClick={() => window.location.reload()}>
          Opnieuw laden
        </button>
      </main>
    );
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
