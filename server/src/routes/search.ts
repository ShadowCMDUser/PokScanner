import { Router } from "express";
import {
  getCard,
  hydrateCards,
  normalizeLang,
  searchCards,
} from "../services/tcgdex.js";

export const searchRouter = Router();

searchRouter.get("/", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }

    const lang = normalizeLang(String(req.query.lang ?? "en"));
    const briefs = await searchCards(lang, { name: q, itemsPerPage: 24 });
    const cards = await hydrateCards(briefs, lang, 12);
    res.json(cards);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoeken mislukt";
    res.status(500).json({ error: message });
  }
});

searchRouter.get("/:id", async (req, res) => {
  try {
    const lang = normalizeLang(String(req.query.lang ?? "en"));
    const card = await getCard(req.params.id, lang);
    res.json(card);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kaart niet gevonden";
    res.status(404).json({ error: message });
  }
});
