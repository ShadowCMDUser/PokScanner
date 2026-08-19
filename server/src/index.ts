import cors from "cors";
import express from "express";
import { collectionRouter } from "./routes/collection.js";
import { scanRouter } from "./routes/scan.js";
import { searchRouter } from "./routes/search.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);

app.use(cors());
app.use(express.json({ limit: "20mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, name: "PokScanner" });
});

app.use("/api/scan", scanRouter);
app.use("/api/collection", collectionRouter);
app.use("/api/cards", searchRouter);

app.use((error: Error, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) {
    next(error);
    return;
  }
  res.status(500).json({ error: error.message || "Onbekende serverfout" });
});

app.listen(port, () => {
  console.log(`PokScanner API op http://localhost:${port}`);
});
