import type { OcrResult, ScoredMatch, TcgdexCard, TcgdexCardBrief } from "../types.js";
import {
  cardsByCollector,
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
  return value
    .toLowerCase()
    .replace(/\s+(ex|gx|v|vmax|vstar|lv\.?x)$/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function similarity(a: string, b: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const ratio = 1 - levenshtein(left, right) / Math.max(left.length, right.length);
  return ratio >= 0.84 ? ratio : 0;
}

function bestNameScore(cardName: string, candidates: string[]) {
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
  const stampMatch = Boolean(
    ocr.setCode &&
      numberMatch &&
      setIdForCode(ocr.setCode) === card.set?.id &&
      (!ocr.setTotal || setMatch),
  );

  if (isPreEvolution(card.name, ocr.evolvesFrom)) {
    return { card, score: 0, reasons: ["voorevolutie"] };
  }

  const looksLike = orbScore >= 18 || artScore >= 36;
  const identity = named && numberMatch && setMatch;
  if (!looksLike && !identity && !stampMatch) {
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
    score += 22;
    reasons.push("nummer+set");
  } else if (numberMatch) {
    score += 4;
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

  const cards = await hydrateCards(ranked, lang, 28);
  const images = cards.map((card) => card.image);
  const visuals = vision ? await artworkScores(vision.artHash, images) : cards.map(() => 0);
  const layouts =
    vision?.cardHash != null ? await layoutScores(vision.cardHash, images) : cards.map(() => 0);
  const symbols =
    vision?.symbolHash != null
      ? await symbolScores(
          vision.symbolHash,
          cards.map((card) => card.set?.symbol),
        )
      : cards.map(() => 0);
  const orbs = vision?.queryImage ? await orbScores(vision.queryImage, images) : cards.map(() => 0);

  return cards
    .map((card, index) =>
      scoreCard(
        card,
        ocr,
        visuals[index] ?? 0,
        layouts[index] ?? 0,
        symbols[index] ?? 0,
        orbs[index] ?? 0,
        vision?.foil ?? false,
      ),
    )
    .filter((match) => match.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 12);
}
