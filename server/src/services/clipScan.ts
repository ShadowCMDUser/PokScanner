import type { OcrResult, ScoredMatch, TcgdexCard } from "../types.js";
import {
  getCardOrNull,
  normalizeLang,
  searchCards,
  type TcgLang,
} from "./tcgdex.js";

const SCANNER_API =
  process.env.SCANNER_API_URL ?? "https://shreyshingala-pokemon-scanner-api.hf.space";
const MIN_SIMILARITY = 0.5;

type ClipMatch = {
  rank?: number;
  card_name: string;
  card_path?: string;
  similarity: number;
  card_id?: string;
  set_name?: string;
  card_number?: string;
};

type ClipScanResponse = {
  success?: boolean;
  error?: string;
  card_info?: {
    name?: string;
    hp?: string | number;
    card_number?: string;
  };
  best_match?: ClipMatch;
  top_matches?: ClipMatch[];
};

type PokeTcgCard = {
  id: string;
  name: string;
  number: string;
  hp?: string;
  rarity?: string;
  types?: string[];
  images?: { small?: string; large?: string };
  set?: { id: string; name: string; printedTotal?: number; total?: number };
};

export type ClipLookup = {
  ocr: OcrResult;
  matches: ScoredMatch[];
};

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "");
}

function namesAlign(left: string, right: string) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
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

export function catalogIdCandidates(id: string) {
  const idx = id.lastIndexOf("-");
  if (idx < 1) return [id];
  return unique([id, ...idCandidates(id.slice(0, idx), id.slice(idx + 1))]);
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

function toCardFromPoke(data: PokeTcgCard): TcgdexCard {
  return {
    id: data.id,
    localId: data.number,
    name: data.name,
    image: data.images?.large ?? data.images?.small,
    rarity: data.rarity,
    hp: data.hp ? Number(data.hp) : undefined,
    types: data.types,
    set: data.set
      ? {
          id: data.set.id,
          name: data.set.name,
          cardCount: {
            official: data.set.printedTotal,
            total: data.set.total,
          },
        }
      : undefined,
  };
}

async function fetchPokeTcg(id: string) {
  const response = await fetch(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(id)}`, {
    headers: process.env.POKEMONTCG_API_KEY
      ? { "X-Api-Key": process.env.POKEMONTCG_API_KEY }
      : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { data?: PokeTcgCard };
  return body.data ?? null;
}

async function resolveTcgdexCard(
  parsed: NonNullable<ReturnType<typeof parseClipFilename>>,
  lang: TcgLang,
) {
  const found = await Promise.all(
    idCandidates(parsed.set, parsed.number).map(async (id) => getCardOrNull(id, lang)),
  );
  const named = found.find((card) => card && namesAlign(card.name, parsed.name));
  if (named) return named;
  const any = found.find((card) => Boolean(card));
  if (any) return any;

  const localId = parsed.number.replace(/^0+/, "") || parsed.number;
  const briefs = await searchCards(lang, {
    name: parsed.name,
    localId,
    itemsPerPage: 30,
    sortOrder: "DESC",
  });
  const match = briefs.find((card) => namesAlign(card.name, parsed.name));
  if (!match) return null;
  const hydrated = await getCardOrNull(match.id, lang);
  return hydrated && namesAlign(hydrated.name, parsed.name) ? hydrated : null;
}

async function resolveMatch(
  parsed: NonNullable<ReturnType<typeof parseClipFilename>>,
  lang: TcgLang,
) {
  const poke = await fetchPokeTcg(parsed.pokeId);
  const tcgdex = await resolveTcgdexCard(parsed, lang);

  if (poke && tcgdex) {
    return {
      ...tcgdex,
      name: poke.name,
      localId: poke.number,
      image: poke.images?.large ?? poke.images?.small ?? tcgdex.image,
      rarity: poke.rarity ?? tcgdex.rarity,
    } satisfies TcgdexCard;
  }
  if (poke) return toCardFromPoke(poke);
  return tcgdex;
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
    throw new Error(payload.error || `Scanner gaf ${response.status} terug`);
  }

  const bestName = payload.best_match?.card_name;
  const rawMatches = [payload.best_match, ...(payload.top_matches ?? [])].filter(
    (match): match is ClipMatch => {
      if (!match?.card_name) return false;
      return match.card_name === bestName || (match.similarity ?? 0) >= MIN_SIMILARITY;
    },
  );

  const seen = new Set<string>();
  const parsed = rawMatches.flatMap((match, index) => {
    if (index > 0 && (match.similarity ?? 0) < MIN_SIMILARITY) return [];
    const info = parseClipFilename(match.card_name);
    if (!info || seen.has(info.pokeId)) return [];
    seen.add(info.pokeId);
    return [{ info, similarity: match.similarity ?? 0 }];
  });

  const ocrName = payload.card_info?.name ?? parsed[0]?.info.name ?? "";
  const resolved = await Promise.all(
    parsed.slice(0, 5).map(async ({ info, similarity }) => {
      const card = await resolveMatch(info, lang);
      if (!card) return null;
      const score = Math.round(similarity * 100);
      return {
        card,
        score,
        reasons: [`clip ${score}%`, info.set, `#${info.number}`],
      } satisfies ScoredMatch;
    }),
  );

  const matches = resolved.filter((match): match is ScoredMatch => Boolean(match));

  const hpValue = Number(payload.card_info?.hp);
  const ocr: OcrResult = {
    rawText: ocrName,
    nameCandidates: ocrName ? [ocrName] : [],
    evolvesFrom: null,
    hp: Number.isFinite(hpValue) ? hpValue : null,
    collectorNumber: payload.card_info?.card_number ?? parsed[0]?.info.number ?? null,
    setTotal: null,
    illustrator: null,
    stage: null,
    regulationMark: null,
    ability: null,
    attacks: [],
    confidence: matches[0]?.score ?? 0,
  };

  return { ocr, matches };
}
