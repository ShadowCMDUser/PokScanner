import "./env.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { betterAuth } from "better-auth";
import Database from "better-sqlite3";
import { dataDir } from "./paths.js";

export type SocialProvider = "google" | "facebook" | "discord";

function envPair(idKey: string, secretKey: string) {
  const clientId = process.env[idKey]?.trim();
  const clientSecret = process.env[secretKey]?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

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

const google = envPair("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
const facebook = envPair("FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET");
const discord = envPair("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET");

export const enabledSocialProviders: SocialProvider[] = [
  google ? "google" : null,
  facebook ? "facebook" : null,
  discord ? "discord" : null,
].filter((value): value is SocialProvider => value !== null);

const isProd = process.env.NODE_ENV === "production";
const baseURL =
  process.env.BETTER_AUTH_URL?.replace(/\/$/, "") ||
  process.env.APP_URL?.replace(/\/$/, "") ||
  (isProd ? "https://scanner.thisisours.duckdns.org" : "http://localhost:5173");

export const auth = betterAuth({
  appName: "PokScanner",
  baseURL,
  secret: resolveSecret(),
  database: new Database(join(dataDir, "auth.sqlite")),
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
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google", "facebook", "discord", "email-password"],
    },
  },
  socialProviders: {
    ...(google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
          },
        }
      : {}),
    ...(facebook
      ? {
          facebook: {
            clientId: facebook.clientId,
            clientSecret: facebook.clientSecret,
          },
        }
      : {}),
    ...(discord
      ? {
          discord: {
            clientId: discord.clientId,
            clientSecret: discord.clientSecret,
          },
        }
      : {}),
  },
});
