import type { OcrResult, ScoredMatch, TcgdexCard } from "../types.js";
import {
  getCardOrNull,
  hydrateCards,
  normalizeLang,
  searchCards,
  type TcgLang,
} from "./tcgdex.js";

const SCANNER_API =
  process.env.SCANNER_API_URL ?? "https://shreyshingala-pokemon-scanner-api.hf.space";

type ClipMatch = {
  rank?: number;
  card_name: string;
  card_path?: string;
  similarity: number;
};

type ClipScanResponse = {
  success?: boolean;
  error?: string;
  card_info?: {
    name?: string;
    hp?: string | number;
    card_number?: string;
  };
  best_match?: ClipMatch & {
    card_id?: string;
    set_name?: string;
    card_number?: string;
  };
  top_matches?: ClipMatch[];
};

export type ClipLookup = {
  ocr: OcrResult;
  matches: ScoredMatch[];
};

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function expandSetId(set: string) {
  const ids = [set];
  const pt = set.match(/^([a-z]+)(\d+)pt(\d+)$/i);
  if (pt) {
    ids.push(`${pt[1]}${pt[2]}.${pt[3]}`);
    ids.push(`${pt[1]}${pt[2].padStart(2, "0")}.${pt[3]}`);
  }
  const simple = set.match(/^([a-z]+)(\d+)$/i);
  if (simple && simple[2].length === 1) {
    ids.push(`${simple[1]}${simple[2].padStart(2, "0")}`);
  }
  return unique(ids);
}

function idCandidates(set: string, number: string) {
  const stripped = number.replace(/^0+/, "") || "0";
  const padded = stripped.padStart(3, "0");
  const ids: string[] = [];
  for (const setId of expandSetId(set)) {
    ids.push(`${setId}-${number}`, `${setId}-${stripped}`, `${setId}-${padded}`);
  }
  return unique(ids);
}

export function parseClipFilename(filename: string) {
  const clean = filename.replace(/\.(jpe?g|png|webp)$/i, "");
  const parts = clean.split("_").filter(Boolean);
  if (parts.length < 3) return null;
  const number = parts[parts.length - 1];
  const set = parts[parts.length - 2];
  const name = parts.slice(0, -2).join(" ").replace(/\s+/g, " ").trim();
  return {
    name,
    set,
    number,
    pokeId: `${set}-${number}`,
  };
}

async function resolveTcgdexCard(
  parsed: NonNullable<ReturnType<typeof parseClipFilename>>,
  lang: TcgLang,
): Promise<TcgdexCard | null> {
  const found = await Promise.all(
    idCandidates(parsed.set, parsed.number).map(async (id) => ({
      id,
      card: await getCardOrNull(id, lang),
    })),
  );
  const exact = found.find((item) => item.card)?.card;
  if (exact) return exact;

  const localId = parsed.number.replace(/^0+/, "") || parsed.number;
  const nameQuery = parsed.name.replace(/[_-]+/g, " ").trim();
  if (nameQuery.length < 2) return null;

  const briefs = await searchCards(lang, {
    name: nameQuery.split(" ")[0],
    localId,
    itemsPerPage: 30,
    sortOrder: "DESC",
  });
  const match =
    briefs.find((card) => card.id.toLowerCase().includes(parsed.set.toLowerCase())) ??
    briefs.find((card) => card.name.toLowerCase().includes(nameQuery.toLowerCase().split(" ")[0])) ??
    briefs[0];
  if (!match) return null;
  return (await getCardOrNull(match.id, lang)) ?? {
    ...match,
    pricing: { cardmarket: {} },
  };
}

export async function wakeupScanner() {
  try {
    await fetch(`${SCANNER_API}/`, { signal: AbortSignal.timeout(15000) });
  } catch {
    // Space may be cold; the first scan will wake it.
  }
}

export async function scanWithClip(image: Buffer, langInput?: string): Promise<ClipLookup> {
  const lang = normalizeLang(langInput);
  const form = new FormData();
  form.append("file", new File([new Uint8Array(image)], "card.jpg", { type: "image/jpeg" }));

  const response = await fetch(`${SCANNER_API}/scan_card/`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(120000),
  });

  const payload = (await response.json().catch(() => ({}))) as ClipScanResponse;
  if (!response.ok) {
    const message = payload.error || `Scanner gaf ${response.status} terug`;
    throw new Error(message);
  }

  const rawMatches = [
    payload.best_match,
    ...(payload.top_matches ?? []),
  ].filter((match): match is ClipMatch => Boolean(match?.card_name));

  const seen = new Set<string>();
  const parsed = rawMatches.flatMap((match) => {
    const info = parseClipFilename(match.card_name);
    if (!info || seen.has(info.pokeId)) return [];
    seen.add(info.pokeId);
    return [{ info, similarity: match.similarity ?? 0 }];
  });

  const resolved = await Promise.all(
    parsed.slice(0, 8).map(async ({ info, similarity }) => {
      const card = await resolveTcgdexCard(info, lang);
      if (!card) return null;
      const score = Math.round(Math.max(0, Math.min(1, similarity)) * 100);
      return {
        card,
        score,
        reasons: [`clip ${score}%`, info.set, `#${info.number}`],
      } satisfies ScoredMatch;
    }),
  );

  let matches = resolved.filter((match): match is ScoredMatch => Boolean(match));
  if (!matches.length && parsed[0]) {
    const briefs = await searchCards(lang, {
      name: parsed[0].info.name.split(" ")[0],
      itemsPerPage: 8,
      sortOrder: "DESC",
    });
    const cards = await hydrateCards(briefs, lang, 6);
    matches = cards.map((card, index) => ({
      card,
      score: Math.max(40, Math.round((parsed[0]?.similarity ?? 0.5) * 100) - index * 4),
      reasons: ["clip fallback"],
    }));
  }

  const name = payload.card_info?.name ?? parsed[0]?.info.name ?? "";
  const hpValue = Number(payload.card_info?.hp);
  const ocr: OcrResult = {
    rawText: name,
    nameCandidates: name ? [name] : parsed[0]?.info.name ? [parsed[0].info.name] : [],
    evolvesFrom: null,
    hp: Number.isFinite(hpValue) ? hpValue : null,
    collectorNumber: payload.card_info?.card_number ?? parsed[0]?.info.number ?? null,
    setTotal: null,
    confidence: matches[0]?.score ?? 0,
  };

  return { ocr, matches };
}
