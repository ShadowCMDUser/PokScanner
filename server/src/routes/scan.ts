import { Router } from "express";
import multer from "multer";
import { prepareForOcr } from "../services/image.js";
import { lookupCard } from "../services/lookup.js";
import { matchCard } from "../services/match.js";
import { readCardText } from "../services/ocr.js";
import { setIdForCode } from "../services/setCodes.js";
import { differenceHash, symbolHash } from "../services/vision.js";
import { flattenCard } from "../services/warp.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

export const scanRouter = Router();

function bufferFromBody(body: { image?: string }) {
  if (!body.image) return null;
  const match = body.image.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], "base64");
}

scanRouter.post("/", upload.single("image"), async (req, res) => {
  try {
    const fileBuffer = req.file?.buffer ?? bufferFromBody(req.body);
    if (!fileBuffer) {
      res.status(400).json({ error: "Geen afbeelding ontvangen" });
      return;
    }

    const lang = typeof req.body?.lang === "string" ? req.body.lang : "en";
    const flattened = await flattenCard(fileBuffer);
    const regions = await prepareForOcr(flattened);
    const ocr = await readCardText(regions);
    const [artHash, cardHash, markHash] = await Promise.all([
      differenceHash(regions.art),
      differenceHash(regions.card),
      symbolHash(regions.symbol),
    ]);
    const extra = await lookupCard(ocr, lang);
    const stampHits = extra.filter((card) => {
      if (!ocr.setCode || !ocr.collectorNumber) return false;
      const setId = setIdForCode(ocr.setCode);
      const sameNumber =
        card.localId.replace(/^0+/, "").toLowerCase() ===
        ocr.collectorNumber.replace(/^0+/, "").toLowerCase();
      return Boolean(setId && card.set?.id === setId && sameNumber);
    });

    let matches = stampHits.length
      ? stampHits.slice(0, 8).map((card) => ({
          card,
          score: 90,
          reasons: ["setcode+nummer"],
        }))
      : await matchCard(
          ocr,
          lang,
          {
            artHash,
            cardHash,
            symbolHash: markHash,
            queryImage: regions.card,
            foil: false,
          },
          extra,
        );

    if (!matches.length && extra.length) {
      matches = extra.slice(0, 8).map((card) => ({
        card,
        score: 20,
        reasons: ["catalogus"],
      }));
    }

    console.log("scan", {
      setCode: ocr.setCode,
      number: ocr.collectorNumber,
      total: ocr.setTotal,
      names: ocr.nameCandidates.slice(0, 3),
      extra: extra.map((card) => card.id).slice(0, 8),
      matches: matches.map((match) => match.card.id).slice(0, 5),
    });

    res.json({
      matches,
      bestMatch: matches[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan mislukt";
    res.status(500).json({ error: message, matches: [], bestMatch: null });
  }
});
