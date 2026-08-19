import { Router } from "express";
import multer from "multer";
import { prepareForOcr } from "../services/image.js";
import { matchCard } from "../services/match.js";
import { emptyOcr, readCardText } from "../services/ocr.js";
import { differenceHash } from "../services/vision.js";
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
    const artHash = await differenceHash(regions.art);
    const matches = await matchCard(ocr, lang, { artHash, foil: false });

    res.json({
      ocr,
      matches,
      bestMatch: matches[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan mislukt";
    res.status(500).json({ error: message, ocr: emptyOcr(), matches: [], bestMatch: null });
  }
});
