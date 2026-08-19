import { Router } from "express";
import {
  addToCollection,
  listCollection,
  removeCollectionEntry,
  updateCollectionEntry,
} from "../db.js";
import { getUserId, requireUser } from "../middleware/requireUser.js";
import { getCardOrNull, normalizeLang } from "../services/tcgdex.js";
import { catalogIdCandidates } from "../services/clipScan.js";
import type { CardCondition } from "../types.js";

const CONDITIONS: CardCondition[] = ["mint", "nm", "lp", "mp", "hp", "dmg"];

export const collectionRouter = Router();
collectionRouter.use(requireUser);

collectionRouter.get("/", (_req, res) => {
  const cards = listCollection(getUserId(res));
  const totalCards = cards.reduce((sum, card) => sum + card.quantity, 0);
  const totalValue = cards.reduce(
    (sum, card) => sum + (card.priceEur ?? 0) * card.quantity,
    0,
  );

  res.json({
    cards,
    stats: {
      unique: cards.length,
      totalCards,
      totalValue: Number(totalValue.toFixed(2)),
    },
  });
});

collectionRouter.post("/", async (req, res) => {
  try {
    const cardId = String(req.body?.cardId ?? "");
    if (!cardId) {
      res.status(400).json({ error: "cardId ontbreekt" });
      return;
    }

    const lang = normalizeLang(req.body?.lang);
    const condition = CONDITIONS.includes(req.body?.condition)
      ? (req.body.condition as CardCondition)
      : "nm";
    const quantity = Number(req.body?.quantity ?? 1);
    let card = null;
    for (const id of catalogIdCandidates(cardId)) {
      card = await getCardOrNull(id, lang);
      if (card) break;
    }
    if (!card) {
      res.status(404).json({ error: "Kaart niet gevonden in de catalogus" });
      return;
    }
    const entry = addToCollection(getUserId(res), card, { condition, quantity });
    res.status(201).json(entry);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Toevoegen mislukt";
    res.status(500).json({ error: message });
  }
});

collectionRouter.patch("/:id", (req, res) => {
  const patch: { quantity?: number; condition?: CardCondition } = {};
  if (typeof req.body?.quantity === "number") patch.quantity = req.body.quantity;
  if (CONDITIONS.includes(req.body?.condition)) {
    patch.condition = req.body.condition;
  }

  const entry = updateCollectionEntry(getUserId(res), req.params.id, patch);
  if (!entry) {
    res.status(404).json({ error: "Kaart niet gevonden in collectie" });
    return;
  }
  res.json(entry);
});

collectionRouter.delete("/:id", (req, res) => {
  const removed = removeCollectionEntry(getUserId(res), req.params.id);
  if (!removed) {
    res.status(404).json({ error: "Kaart niet gevonden in collectie" });
    return;
  }
  res.status(204).end();
});
