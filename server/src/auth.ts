import "./env.js";
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
  (isProd ? undefined : "http://localhost:5173");

if (isProd && !process.env.BETTER_AUTH_SECRET) {
  throw new Error("BETTER_AUTH_SECRET ontbreekt. Zet die in Dokploy.");
}

if (isProd && !baseURL) {
  throw new Error("BETTER_AUTH_URL ontbreekt. Zet je publieke https-URL in Dokploy.");
}

export const auth = betterAuth({
  appName: "PokScanner",
  baseURL,
  secret: process.env.BETTER_AUTH_SECRET || "dev-only-change-me-in-production-ok",
  database: new Database(join(dataDir, "auth.sqlite")),
  trustedOrigins: [
    baseURL,
    "http://localhost:5173",
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
