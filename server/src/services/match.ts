import type { OcrResult, ScoredMatch, TcgdexCard, TcgdexCardBrief } from "../types.js";
import {
  hydrateCards,
  normalizeLang,
  searchCards,
  type TcgLang,
} from "./tcgdex.js";
import { artworkScores } from "./vision.js";

export type VisionHints = {
  artHash: bigint;
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

function scoreCard(card: TcgdexCard, ocr: OcrResult, artScore = 0, foil = false): ScoredMatch {
  const reasons: string[] = [];
  let score = 0;

  if (isPreEvolution(card.name, ocr.evolvesFrom)) {
    return { card, score: 0, reasons: ["voorevolutie"] };
  }

  const nameScore = bestNameScore(card.name, ocr.nameCandidates);
  if (nameScore >= 0.84) {
    score += nameScore * 70;
    reasons.push(`naam ${Math.round(nameScore * 100)}%`);
  }

  if (ocr.evolvesFrom && similarity(card.evolveFrom ?? "", ocr.evolvesFrom) >= 0.84) {
    score += 50;
    reasons.push("evolueert van");
  }

  if (ocr.collectorNumber && sameLocalId(card.localId, ocr.collectorNumber)) {
    score += 36;
    reasons.push("nummer");
  }

  if (ocr.hp && card.hp && Math.abs(card.hp - ocr.hp) <= 10) {
    score += 10;
    reasons.push("hp");
  }

  if (ocr.setTotal && card.set?.cardCount) {
    const total = String(card.set.cardCount.official ?? "");
    const all = String(card.set.cardCount.total ?? "");
    if (ocr.setTotal === total || ocr.setTotal === all) {
      score += 18;
      reasons.push("setgrootte");
    }
  }

  if (artScore >= 62) {
    score += Math.round(artScore * 0.9);
    reasons.push(`artwork ${artScore}%`);
  } else if (artScore >= 45) {
    score += Math.round(artScore * 0.45);
    reasons.push(`artwork ${artScore}%`);
  }

  if (foil && (card.variants?.holo || card.rarity?.toLowerCase().includes("holo"))) {
    score += 8;
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
    .slice(0, 3);

  if (ocr.collectorNumber) {
    queries.push(searchCards(lang, { localId: ocr.collectorNumber, itemsPerPage: 80 }));
  }

  if (ocr.evolvesFrom) {
    queries.push(
      searchCards(lang, {
        evolveFrom: ocr.evolvesFrom,
        itemsPerPage: 50,
      }),
    );
    if (ocr.collectorNumber) {
      queries.push(
        searchCards(lang, {
          evolveFrom: ocr.evolvesFrom,
          localId: ocr.collectorNumber,
          itemsPerPage: 30,
        }),
      );
    }
    if (ocr.hp) {
      queries.push(
        searchCards(lang, {
          evolveFrom: ocr.evolvesFrom,
          hp: ocr.hp,
          itemsPerPage: 30,
        }),
      );
    }
  }

  for (const name of names) {
    queries.push(searchCards(lang, { name, itemsPerPage: 40 }));
    if (ocr.collectorNumber) {
      queries.push(
        searchCards(lang, {
          name,
          localId: ocr.collectorNumber,
          itemsPerPage: 30,
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
  if (ocr.evolvesFrom) score += 35;
  if (ocr.collectorNumber && sameLocalId(brief.localId, ocr.collectorNumber)) {
    score += 36;
  }
  return score;
}

export async function matchCard(
  ocr: OcrResult,
  langInput?: string,
  vision?: VisionHints,
): Promise<ScoredMatch[]> {
  const lang = normalizeLang(langInput);
  const briefs = await lookupCandidates(ocr, lang);
  if (!briefs.length) return [];

  const unique = [...new Map(briefs.map((card) => [card.id, card])).values()];
  const numbered = ocr.collectorNumber
    ? unique.filter((card) => sameLocalId(card.localId, ocr.collectorNumber!))
    : [];
  const byText = unique
    .map((brief) => ({ brief, score: briefScore(brief, ocr) }))
    .filter((item) => item.score >= 30)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.brief);

  const ranked = [...new Map([...numbered, ...byText].map((card) => [card.id, card])).values()].slice(
    0,
    18,
  );

  const cards = await hydrateCards(ranked, lang, 18);
  const visuals = vision ? await artworkScores(vision.artHash, cards.map((card) => card.image)) : cards.map(() => 0);

  return cards
    .map((card, index) => scoreCard(card, ocr, visuals[index] ?? 0, vision?.foil ?? false))
    .filter((match) => match.score >= 40)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
