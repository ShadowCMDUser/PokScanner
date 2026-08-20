import "./env.js";
import cors from "cors";
import express from "express";
import { join } from "node:path";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth, closeAuthDb, migrateAuth } from "./auth.js";
import { hasWebBuild, webDistDir } from "./paths.js";
import { logError, publicError } from "./publicError.js";
import { collectionRouter } from "./routes/collection.js";
import { scanRouter } from "./routes/scan.js";
import { searchRouter } from "./routes/search.js";
import { wakeupScanner } from "./services/clipScan.js";

const app = express();
const isProd = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? (isProd ? 3000 : 3001));
const host = process.env.HOST ?? "0.0.0.0";

app.disable("x-powered-by");
app.set("trust proxy", 1);

const corsOrigins = [
  process.env.BETTER_AUTH_URL?.replace(/\/$/, ""),
  process.env.APP_URL?.replace(/\/$/, ""),
  "https://scanner.thisisours.duckdns.org",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://localhost:3001",
].filter((value): value is string => Boolean(value));

app.use(
  cors({
    origin: isProd ? corsOrigins : true,
    credentials: true,
  }),
);

const handleAuth = toNodeHandler(auth);
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/auth")) {
    next();
    return;
  }

  void handleAuth(req, res).catch((error: unknown) => {
    logError("Auth-fout:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: publicError(error, "Inloggen mislukt") });
    }
  });
});

app.use(express.json({ limit: "16mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "PokScanner" });
});

app.get("/api/me", async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    res.json(session);
  } catch (error) {
    logError("Sessie ophalen mislukt:", error);
    res.status(500).json({ error: publicError(error, "Sessie ophalen mislukt") });
  }
});

app.use("/api/scan", scanRouter);
app.use("/api/collection", collectionRouter);
app.use("/api/cards", searchRouter);

if (hasWebBuild()) {
  app.use(express.static(webDistDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) {
      next();
      return;
    }
    res.sendFile(join(webDistDir, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  logError("Serverfout:", error);
  res.status(500).json({ error: publicError(error, "Onbekende serverfout") });
});

await migrateAuth();

if (isProd && !process.env.BETTER_AUTH_SECRET?.trim()) {
  console.warn("BETTER_AUTH_SECRET ontbreekt in productie; sessies vervallen bij elke nieuwe secret.");
}

const server = app.listen(port, host, () => {
  console.log(`PokScanner luistert op http://${host}:${port}`);
  void wakeupScanner();
});

function shutdown(signal: string) {
  console.log(`${signal}: server wordt afgesloten`);
  const force = setTimeout(() => {
    logError("Afsluiten:", new Error("timeout"));
    try {
      closeAuthDb();
    } catch (error) {
      logError("Auth-database sluiten mislukt:", error);
    }
    process.exit(1);
  }, 10_000);
  force.unref();

  server.close(() => {
    clearTimeout(force);
    try {
      closeAuthDb();
    } catch (error) {
      logError("Auth-database sluiten mislukt:", error);
    }
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
