const isProd = process.env.NODE_ENV === "production";

export function publicError(error: unknown, fallback: string) {
  if (!isProd && error instanceof Error && error.message) return error.message;
  return fallback;
}

export function logError(scope: string, error: unknown) {
  console.error(scope, error);
}
