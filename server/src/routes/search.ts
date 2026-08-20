import { logError, publicError } from "../publicError.js";
import { Router } from "express";
import {
  cardsFromBriefs,
  getCard,
  getCardOrNull,
  normalizeLang,
  searchAllCards,
} from "../services/tcgdex.js";

export const searchRouter = Router();

const SEARCH_LIMIT = 400;

function firstQueryValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstQueryValue(value[0]);
  return "";
}

function isCardId(query: string) {
  return /^[a-z0-9]+(?:\.[a-z0-9]+)?-\S+$/i.test(query) && !query.includes(" ");
}

searchRouter.get("/", async (req, res) => {
  try {
    const q = firstQueryValue(req.query.q).trim();
    if (q.length < 2) {
      res.json([]);
      return;
    }

    const lang = normalizeLang(firstQueryValue(req.query.lang) || "en");

    if (isCardId(q)) {
      const card = await getCardOrNull(q, lang);
      res.json(card ? [card] : []);
      return;
    }

    const collector = q.match(/^#?(\d{1,3})\s*\/\s*(\d{2,4})$/);
    const briefs = await searchAllCards(
      lang,
      collector
        ? { localId: String(Number(collector[1])), sortOrder: "DESC" }
        : { name: q, sortOrder: "DESC" },
      SEARCH_LIMIT,
    );
    const cards = await cardsFromBriefs(lang, briefs, collector ? undefined : q);
    res.json(cards);
  } catch (error) {
    logError("Zoeken mislukt:", error);
    res.status(500).json({ error: publicError(error, "Zoeken mislukt") });
  }
});

searchRouter.get("/:id", async (req, res) => {
  try {
    const lang = normalizeLang(firstQueryValue(req.query.lang) || "en");
    const card = await getCard(req.params.id, lang);
    res.json(card);
  } catch (error) {
    logError("Kaart ophalen mislukt:", error);
    res.status(404).json({ error: publicError(error, "Kaart niet gevonden") });
  }
});
