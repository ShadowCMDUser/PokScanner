import type { OcrResult, ScoredMatch, TcgdexCard, TcgdexCardBrief } from "../types.js";
import {
  cardsByCollector,
  cardsByLocalId,
  cardsBySetStamp,
  hydrateCards,
  normalizeLang,
  searchAllCards,
  searchCards,
  type TcgLang,
} from "./tcgdex.js";
import { artworkScores, layoutScores, symbolScores } from "./vision.js";
import { orbScores } from "./orbMatch.js";
import { setIdForCode } from "./setCodes.js";

export type VisionHints = {
  artHash: bigint;
  cardHash?: bigint;
  symbolHash?: bigint;
  queryImage?: Buffer;
  foil: boolean;
};

function levenshtein(a: string, b: string) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[a.length][b.length];
}

function normalizeName(value: string) {
  const folded = value
    .toLowerCase()
    .replace(/v[\s.\-]*max/g, " vmax ")
    .replace(/v[\s.\-]*star/g, " vstar ")
    .replace(/lv[\s.]*x/g, " lvx ");
  const tokens = folded.split(/[^a-z0-9]+/).filter(Boolean);
  const suffixes = new Set(["ex", "gx", "v", "vmax", "vstar", "lvx"]);
  while (tokens.length > 1 && suffixes.has(tokens[tokens.length - 1] ?? "")) {
    tokens.pop();
  }
  return tokens.join("");
}

function similarity(a: string, b: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const ratio = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  return ratio >= 0.84 ? ratio : 0;
}

function bestNameScore(cardName: string, candidates: readonly string[]) {
  return candidates.reduce((best, candidate) => Math.max(best, similarity(candidate, cardName)), 0);
}

function sameLocalId(cardId: string, found: string) {
  return cardId.replace(/^0+/, "").toLowerCase() === found.replace(/^0+/, "").toLowerCase();
}

function isPreEvolution(cardName: string, evolvesFrom: string | null) {
  return Boolean(evolvesFrom && similarity(cardName, evolvesFrom) >= 0.86);
}

function sameCount(left: string | number | null | undefined, right: string | number | null | undefined) {
  if (left == null || right == null || left === "" || right === "") return false;
  return Number(left) === Number(right);
}

function scoreCard(
  card: TcgdexCard,
  ocr: OcrResult,
  artScore = 0,
  layoutScore = 0,
  symbolScore = 0,
  orbScore = 0,
  foil = false,
): ScoredMatch {
  const reasons: string[] = [];
  const nameScore = bestNameScore(card.name, ocr.nameCandidates);
  const named = nameScore >= 0.84;
  const numberMatch = Boolean(ocr.collectorNumber && sameLocalId(card.localId, ocr.collectorNumber));
  const setMatch = Boolean(
    ocr.setTotal &&
      card.set?.cardCount &&
      (sameCount(ocr.setTotal, card.set.cardCount.official) ||
        sameCount(ocr.setTotal, card.set.cardCount.total)),
  );
  const stampMatch = Boolean(ocr.setCode && numberMatch && setIdForCode(ocr.setCode) === card.set?.id);

  if (isPreEvolution(card.name, ocr.evolvesFrom)) {
    return { card, score: 0, reasons: ["voorevolutie"] };
  }

  const looksLike = orbScore >= 18 || artScore >= 36;
  const identity = named && numberMatch && setMatch;
  const catalogHit = stampMatch || (numberMatch && setMatch);
  if (!looksLike && !identity && !catalogHit) {
    return { card, score: 0, reasons: ["geen beeldmatch"] };
  }

  let score = 0;
  if (stampMatch) {
    score += 86;
    reasons.push("setcode+nummer");
  }
  if (orbScore >= 18) {
    score += Math.round(orbScore * 3);
    reasons.push("orb");
  }
  if (artScore >= 36) {
    score += artScore;
    reasons.push("artwork");
  }
  if (layoutScore >= 48) {
    score += Math.round(layoutScore * 0.35);
    reasons.push("layout");
  }
  if (named) {
    score += 8;
    reasons.push("naam");
  }
  if (numberMatch && setMatch) {
    score += 40;
    reasons.push("nummer+set");
  } else if (numberMatch) {
    score += 12;
    reasons.push("nummer");
  }
  if (symbolScore >= 42) {
    score += Math.round(symbolScore * 0.4);
    reasons.push("setsymbool");
  }
  if (foil && (card.variants?.holo || card.rarity?.toLowerCase().includes("holo"))) {
    score += 4;
    reasons.push("foil");
  }

  return { card, score: Math.round(score), reasons };
}

function zeros(count: number) {
  return Array.from({ length: count }, () => 0);
}

function visionScores(result: PromiseSettledResult<number[]>, count: number) {
  if (result.status !== "fulfilled" || !Array.isArray(result.value) || result.value.length === 0) {
    return zeros(count);
  }
  return Array.from({ length: count }, (_, index) => {
    const value = result.value[index];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  });
}

function scoreAt(scores: number[], index: number) {
  const value = scores[index];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

async function visualScores(cards: TcgdexCard[], vision?: VisionHints) {
  const count = cards.length;
  const empty = zeros(count);
  if (!vision || count === 0) {
    return { art: empty, layout: empty, symbol: empty, orb: empty };
  }

  const images = cards.map((card) => card.image);
  const settled = await Promise.allSettled([
    artworkScores(vision.artHash, images),
    vision.cardHash != null ? layoutScores(vision.cardHash, images) : Promise.resolve(empty),
    vision.symbolHash != null
      ? symbolScores(
          vision.symbolHash,
          cards.map((card) => card.set?.symbol),
        )
      : Promise.resolve(empty),
    vision.queryImage ? orbScores(vision.queryImage, images) : Promise.resolve(empty),
  ]);

  return {
    art: visionScores(settled[0], count),
    layout: visionScores(settled[1], count),
    symbol: visionScores(settled[2], count),
    orb: visionScores(settled[3], count),
  };
}

async function lookupCandidates(ocr: OcrResult, lang: TcgLang) {
  const queries: Promise<TcgdexCardBrief[]>[] = [];
  const names = ocr.nameCandidates
    .map((name) => name.replace(/[^A-Za-z0-9 '\-]/g, "").trim())
    .filter((name) => name.length >= 3)
    .filter((name) => !isPreEvolution(name, ocr.evolvesFrom))
    .slice(0, 2);

  if (ocr.setCode && ocr.collectorNumber) {
    queries.push(cardsBySetStamp(lang, ocr.setCode, ocr.collectorNumber, ocr.setTotal));
  }

  if (ocr.collectorNumber && ocr.setTotal) {
    queries.push(cardsByCollector(lang, ocr.collectorNumber, ocr.setTotal));
  } else if (ocr.collectorNumber) {
    queries.push(cardsByLocalId(lang, ocr.collectorNumber));
  }

  if (ocr.evolvesFrom && ocr.collectorNumber) {
    queries.push(
      searchCards(lang, {
        evolveFrom: ocr.evolvesFrom,
        localId: ocr.collectorNumber,
        itemsPerPage: 30,
      }),
    );
  }

  for (const name of names) {
    queries.push(searchAllCards(lang, { name }, 80));
    if (ocr.collectorNumber) {
      queries.push(
        searchCards(lang, {
          name,
          localId: ocr.collectorNumber,
          itemsPerPage: 40,
        }),
      );
    }
  }

  if (!queries.length) return [];

  const results = await Promise.allSettled(queries);
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

function briefScore(brief: TcgdexCardBrief, ocr: OcrResult) {
  if (isPreEvolution(brief.name, ocr.evolvesFrom)) return 0;
  let score = bestNameScore(brief.name, ocr.nameCandidates) * 70;
  if (ocr.collectorNumber && sameLocalId(brief.localId, ocr.collectorNumber)) {
    score += 50;
  }
  const setId = setIdForCode(ocr.setCode);
  if (setId && brief.id.toLowerCase().startsWith(`${setId.toLowerCase()}-`)) {
    score += 80;
  }
  return score;
}

export async function matchCard(
  ocr: OcrResult,
  langInput?: string,
  vision?: VisionHints,
  extraCards: TcgdexCard[] = [],
): Promise<ScoredMatch[]> {
  const lang = normalizeLang(langInput);
  const briefs = await lookupCandidates(ocr, lang);
  const unique = [
    ...new Map(
      [...extraCards, ...briefs].map((card) => [card.id, card] as const),
    ).values(),
  ];
  if (!unique.length) return [];

  const stamped =
    ocr.setCode && ocr.collectorNumber
      ? unique.filter((card) => {
          const setId = setIdForCode(ocr.setCode);
          return Boolean(setId && card.id.toLowerCase().startsWith(`${setId.toLowerCase()}-`) && sameLocalId(card.localId, ocr.collectorNumber!));
        })
      : ocr.collectorNumber && ocr.setTotal
        ? unique.filter((card) => sameLocalId(card.localId, ocr.collectorNumber!))
        : [];
  const byText = unique
    .map((brief) => ({ brief, score: briefScore(brief, ocr) }))
    .filter((item) => item.score >= 30)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.brief);

  const ranked = [...new Map([...stamped, ...byText, ...unique].map((card) => [card.id, card])).values()].slice(
    0,
    40,
  );

  // hydrateCards slices to 28 and fetches with mapPool concurrency 4 + per-card catch (safe for TCGdex).
  const cards = await hydrateCards(ranked, lang, 28);
  const { art, layout, symbol, orb } = await visualScores(cards, vision);

  const scored = cards
    .map((card, index) =>
      scoreCard(
        card,
        ocr,
        scoreAt(art, index),
        scoreAt(layout, index),
        scoreAt(symbol, index),
        scoreAt(orb, index),
        vision?.foil ?? false,
      ),
    )
    .filter((match) => match.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);

  if (scored.length) return scored;

  if (ocr.collectorNumber) {
    const numbered = cards.filter((card) => sameLocalId(card.localId, ocr.collectorNumber!));
    if (numbered.length) {
      return numbered.slice(0, 8).map((card) => ({
        card,
        score: 20,
        reasons: ["nummer"],
      }));
    }
  }

  return [];
}
