import { logError, publicError } from "../publicError.js";
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
import { CARD_CONDITIONS, type CardCondition } from "../types.js";

export const collectionRouter = Router();
collectionRouter.use(requireUser);

function parsePositiveInt(value: unknown): number | null {
  const qty = Number(value);
  if (!Number.isInteger(qty) || qty <= 0) return null;
  return qty;
}

function entryId(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim();
}

collectionRouter.get("/", async (_req, res) => {
  try {
    const cards = await listCollection(getUserId(res));
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
  } catch (error) {
    logError("Collectie laden mislukt:", error);
    res.status(500).json({ error: publicError(error, "Collectie laden mislukt") });
  }
});

collectionRouter.post("/", async (req, res) => {
  try {
    const cardId = String(req.body?.cardId ?? "").trim();
    if (!cardId) {
      res.status(400).json({ error: "cardId ontbreekt" });
      return;
    }

    const lang = normalizeLang(req.body?.lang);
    const condition = CARD_CONDITIONS.includes(req.body?.condition)
      ? (req.body.condition as CardCondition)
      : "nm";

    const rawQty = req.body?.quantity;
    const quantity =
      rawQty === undefined || rawQty === null ? 1 : parsePositiveInt(rawQty);
    if (quantity === null) {
      res.status(400).json({ error: "quantity moet een positief geheel getal zijn" });
      return;
    }

    let card = null;
    for (const id of catalogIdCandidates(cardId)) {
      card = await getCardOrNull(id, lang);
      if (card) break;
    }
    if (!card) {
      res.status(404).json({ error: "Kaart niet gevonden in de catalogus" });
      return;
    }
    const entry = await addToCollection(getUserId(res), card, { condition, quantity });
    res.status(201).json(entry);
  } catch (error) {
    logError("Toevoegen mislukt:", error);
    res.status(500).json({ error: publicError(error, "Toevoegen mislukt") });
  }
});

collectionRouter.patch("/:id", async (req, res) => {
  try {
    const id = entryId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "id ontbreekt" });
      return;
    }

    const patch: { quantity?: number; condition?: CardCondition } = {};
    const rawQty = req.body?.quantity;
    if (rawQty !== undefined && rawQty !== null) {
      const quantity = parsePositiveInt(rawQty);
      if (quantity === null) {
        res.status(400).json({ error: "quantity moet een positief geheel getal zijn" });
        return;
      }
      patch.quantity = quantity;
    }
    if (req.body?.condition !== undefined && req.body?.condition !== null) {
      if (!CARD_CONDITIONS.includes(req.body.condition)) {
        res.status(400).json({ error: "ongeldige condition" });
        return;
      }
      patch.condition = req.body.condition;
    }

    if (patch.quantity === undefined && patch.condition === undefined) {
      res.status(400).json({ error: "Geen geldige velden om bij te werken" });
      return;
    }

    const entry = await updateCollectionEntry(getUserId(res), id, patch);
    if (!entry) {
      res.status(404).json({ error: "Kaart niet gevonden in collectie" });
      return;
    }
    res.json(entry);
  } catch (error) {
    logError("Bijwerken mislukt:", error);
    res.status(500).json({ error: publicError(error, "Bijwerken mislukt") });
  }
});

collectionRouter.delete("/:id", async (req, res) => {
  try {
    const id = entryId(req.params.id);
    if (!id) {
      res.status(400).json({ error: "id ontbreekt" });
      return;
    }

    const removed = await removeCollectionEntry(getUserId(res), id);
    if (!removed) {
      res.status(404).json({ error: "Kaart niet gevonden in collectie" });
      return;
    }
    res.status(204).end();
  } catch (error) {
    logError("Verwijderen mislukt:", error);
    res.status(500).json({ error: publicError(error, "Verwijderen mislukt") });
  }
});
