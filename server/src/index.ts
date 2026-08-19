import "./env.js";
import cors from "cors";
import express from "express";
import { join } from "node:path";
import { toNodeHandler, fromNodeHeaders } from "better-auth/node";
import { auth, migrateAuth } from "./auth.js";
import { hasWebBuild, webDistDir } from "./paths.js";
import { collectionRouter } from "./routes/collection.js";
import { scanRouter } from "./routes/scan.js";
import { searchRouter } from "./routes/search.js";

const app = express();
const port = Number(process.env.PORT ?? (process.env.NODE_ENV === "production" ? 3000 : 3001));
const host = process.env.HOST ?? "0.0.0.0";

app.set("trust proxy", 1);
app.use(
  cors({
    origin: true,
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
    console.error("Auth-fout:", error);
    if (!res.headersSent) {
      res.status(500).json({
        error: error instanceof Error ? error.message : "Inloggen mislukt",
      });
    }
  });
});

app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "PokScanner" });
});

app.get("/api/me", async (req, res) => {
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers),
  });
  res.json(session);
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
  res.status(500).json({ error: error.message || "Onbekende serverfout" });
});

await migrateAuth();

app.listen(port, host, () => {
  console.log(`PokScanner luistert op http://${host}:${port}`);
});
