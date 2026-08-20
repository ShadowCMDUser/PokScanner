import { createAuthClient } from "better-auth/react";

function resolveAuthBaseUrl() {
  const fromEnv = import.meta.env.VITE_API_URL?.trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:5173";
}

export const authClient = createAuthClient({
  baseURL: resolveAuthBaseUrl(),
});
