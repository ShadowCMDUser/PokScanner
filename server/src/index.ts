import cors from "cors";
import express from "express";
import { join } from "node:path";
import { hasWebBuild, webDistDir } from "./paths.js";
import { collectionRouter } from "./routes/collection.js";
import { scanRouter } from "./routes/scan.js";
import { searchRouter } from "./routes/search.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "PokScanner" });
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

app.listen(port, host, () => {
  console.log(`PokScanner luistert op http://${host}:${port}`);
});
