import { Router } from "express";
import multer from "multer";
import { prepareStamp } from "../services/image.js";
import { lookupStamp } from "../services/lookup.js";
import { readStamp } from "../services/ocr.js";

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
    const regions = await prepareStamp(fileBuffer);
    const stamp = await readStamp(regions);
    const cards = await lookupStamp(stamp, lang);
    const matches = cards.slice(0, 8).map((card, index) => ({
      card,
      score: stamp.setCode ? 100 : Math.max(20, 80 - index),
      reasons: stamp.setCode ? ["nummerblok"] : ["nummer"],
    }));

    console.log("scan", {
      setCode: stamp.setCode,
      number: stamp.collectorNumber,
      total: stamp.setTotal,
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
