import { logError, publicError } from "../publicError.js";
import { Router, type Request } from "express";
import multer from "multer";
import { prepareStamp } from "../services/image.js";
import { lookupStamp } from "../services/lookup.js";
import { readStamp } from "../services/ocr.js";
import { normalizeLang } from "../services/tcgdex.js";
import { flattenCard } from "../services/warp.js";

// memoryStorage keeps the whole upload in RAM. 15MB × concurrent scans can exhaust the process;
// move to disk/object storage if this route gets heavy traffic.
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const MAX_BASE64_CHARS = Math.ceil((MAX_UPLOAD_BYTES * 4) / 3);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

export const scanRouter = Router();

const SCAN_COOLDOWN_MS = 1_500;
const lastScanAt = new Map<string, number>();

function scanClientId(req: ScanRequest) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

interface ScanBody {
  image?: string;
  lang?: string;
}

type ScanRequest = Request<Record<string, never>, unknown, ScanBody | undefined>;

function bufferFromBody(body: ScanBody | undefined) {
  const image = body?.image;
  if (!image || image.length > MAX_BASE64_CHARS + 64) return null;
  const match = image.match(/^data:image\/[a-zA-Z+]+;base64,(.+)$/);
  if (!match?.[1] || match[1].length > MAX_BASE64_CHARS) return null;
  try {
    const buffer = Buffer.from(match[1], "base64");
    if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES) return null;
    return buffer;
  } catch {
    return null;
  }
}

scanRouter.post("/", upload.single("image"), async (req: ScanRequest, res) => {
  try {
    const body = req.body ?? {};
    const fileBuffer = req.file?.buffer ?? bufferFromBody(body);
    if (!fileBuffer) {
      res.status(400).json({ error: "Geen afbeelding ontvangen" });
      return;
    }

    const clientId = scanClientId(req);
    const previous = lastScanAt.get(clientId) ?? 0;
    if (Date.now() - previous < SCAN_COOLDOWN_MS) {
      res.status(429).json({ error: "Even wachten voor de volgende scan" });
      return;
    }
    lastScanAt.set(clientId, Date.now());
    if (lastScanAt.size > 2_000) {
      const cutoff = Date.now() - 60_000;
      for (const [key, at] of lastScanAt) {
        if (at < cutoff) lastScanAt.delete(key);
      }
    }

    const lang = normalizeLang(typeof body.lang === "string" ? body.lang : undefined);
    let image = fileBuffer;
    try {
      image = await flattenCard(fileBuffer);
    } catch (error) {
      console.warn("flattenCard failed, using original upload", error);
      image = fileBuffer;
    }
    const regions = await prepareStamp(image);
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
    logError("Scan mislukt:", error);
    res.status(500).json({ error: publicError(error, "Scan mislukt"), matches: [], bestMatch: null });
  }
});
