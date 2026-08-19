import "./env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import Database from "better-sqlite3";
import { dataDir } from "./paths.js";

function resolveSecret() {
  if (process.env.BETTER_AUTH_SECRET?.trim()) {
    return process.env.BETTER_AUTH_SECRET.trim();
  }

  const secretPath = join(dataDir, "auth-secret");
  if (existsSync(secretPath)) {
    return readFileSync(secretPath, "utf8").trim();
  }

  const generated = randomBytes(32).toString("hex");
  writeFileSync(secretPath, generated, "utf8");
  console.warn("BETTER_AUTH_SECRET ontbrak; er is een secret weggeschreven in data/auth-secret");
  return generated;
}

const isProd = process.env.NODE_ENV === "production";
const baseURL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ||
  process.env.APP_URL?.replace(/\/$/, "") ||
  (isProd ? "https://scanner.thisisours.duckdns.org" : "http://localhost:5173");

const sqlite = new Database(join(dataDir, "auth.sqlite"));
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const auth = betterAuth({
  appName: "PokScanner",
  baseURL,
  secret: resolveSecret(),
  database: sqlite,
  trustedOrigins: [
    baseURL,
    "https://scanner.thisisours.duckdns.org",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://localhost:3001",
    process.env.APP_URL,
  ].filter((value): value is string => Boolean(value)),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: false,
  },
});

export async function migrateAuth() {
  const { runMigrations, toBeCreated } = await getMigrations(auth.options);
  await runMigrations();
  if (toBeCreated.length) {
    console.log(
      "Auth-tabellen aangemaakt:",
      toBeCreated.map((table) => table.table).join(", "),
    );
  }
}
