import { Router } from "express";
import {
  getCard,
  hydrateCards,
  normalizeLang,
  searchAllCards,
} from "../services/tcgdex.js";

export const searchRouter = Router();

const SEARCH_HYDRATE_LIMIT = 24;

function firstQueryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return "";
}

searchRouter.get("/", async (req, res) => {
  try {
    const q = firstQueryValue(req.query.q).trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }

    const lang = normalizeLang(firstQueryValue(req.query.lang) || "en");
    const briefs = (await searchAllCards(lang, { name: q }, SEARCH_HYDRATE_LIMIT)).slice(
      0,
      SEARCH_HYDRATE_LIMIT,
    );
    const cards = await hydrateCards(briefs, lang, SEARCH_HYDRATE_LIMIT);
    res.json(cards);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Zoeken mislukt";
    res.status(500).json({ error: message });
  }
});

searchRouter.get("/:id", async (req, res) => {
  try {
    const lang = normalizeLang(firstQueryValue(req.query.lang) || "en");
    const card = await getCard(req.params.id, lang);
    res.json(card);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Kaart niet gevonden";
    res.status(404).json({ error: message });
  }
});
