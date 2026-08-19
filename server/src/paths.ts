import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveDataDir() {
  const preferred = process.env.DATA_DIR ?? join(projectRoot, "data");
  try {
    mkdirSync(preferred, { recursive: true });
    return preferred;
  } catch {
    const fallback = join("/tmp", "pokscanner");
    mkdirSync(fallback, { recursive: true });
    return fallback;
  }
}

export const dataDir = resolveDataDir();
export const webDistDir = join(projectRoot, "web", "dist");

export function hasWebBuild() {
  return existsSync(join(webDistDir, "index.html"));
}
