import { Router } from "express";
import multer from "multer";
import { scanWithClip } from "../services/clipScan.js";

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
    const { ocr, matches } = await scanWithClip(fileBuffer, lang);

    res.json({
      ocr,
      matches,
      bestMatch: matches[0] ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scan mislukt";
    const notFound = /no card detected/i.test(message);
    res.status(notFound ? 200 : 500).json(
      notFound
        ? {
            ocr: {
              rawText: "",
              nameCandidates: [],
              evolvesFrom: null,
              hp: null,
              collectorNumber: null,
              setTotal: null,
              confidence: 0,
            },
            matches: [],
            bestMatch: null,
          }
        : { error: message },
    );
  }
});
