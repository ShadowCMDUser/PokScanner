import type { OcrResult, ScoredMatch, TcgdexCard, TcgdexCardBrief } from "../types.js";
import {
  hydrateCards,
  normalizeLang,
  searchCards,
  type TcgLang,
} from "./tcgdex.js";

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

function similarity(a: string, b: string) {
  const left = a.toLowerCase().replace(/[^a-z0-9]/g, "");
  const right = b.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (right.includes(left) || left.includes(right)) return 0.86;
  const distance = levenshtein(left, right);
  return 1 - distance / Math.max(left.length, right.length);
}

function bestNameScore(cardName: string, candidates: string[]) {
  return candidates.reduce((best, candidate) => {
    return Math.max(best, similarity(candidate, cardName));
  }, 0);
}

function scoreCard(card: TcgdexCard, ocr: OcrResult): ScoredMatch {
  const reasons: string[] = [];
  let score = 0;

  const nameScore = bestNameScore(card.name, ocr.nameCandidates);
  if (nameScore >= 0.55) {
    score += nameScore * 70;
    reasons.push(`naam ${Math.round(nameScore * 100)}%`);
  }

  if (ocr.collectorNumber) {
    const local = card.localId.replace(/^0+/, "").toLowerCase();
    const found = ocr.collectorNumber.replace(/^0+/, "").toLowerCase();
    if (local === found) {
      score += 28;
      reasons.push("nummer match");
    }
  }

  if (ocr.setTotal && card.set?.cardCount) {
    const total = String(card.set.cardCount.official ?? "");
    const all = String(card.set.cardCount.total ?? "");
    if (ocr.setTotal === total || ocr.setTotal === all) {
      score += 12;
      reasons.push("setgrootte match");
    }
  }

  return { card, score: Math.round(score), reasons };
}

async function lookupCandidates(ocr: OcrResult, lang: TcgLang) {
  const queries: Promise<TcgdexCardBrief[]>[] = [];
  const primaryName = ocr.nameCandidates[0]
    ?.replace(/[^A-Za-z0-9 '\-]/g, "")
    .trim();

  if (primaryName && primaryName.length >= 3 && ocr.collectorNumber) {
    queries.push(
      searchCards(lang, {
        name: primaryName,
        localId: ocr.collectorNumber,
        itemsPerPage: 30,
      }),
    );
  }

  if (primaryName && primaryName.length >= 3) {
    queries.push(searchCards(lang, { name: primaryName, itemsPerPage: 40 }));
  }

  if (!queries.length) return [];

  const results = await Promise.allSettled(queries);
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

function briefScore(brief: TcgdexCardBrief, ocr: OcrResult) {
  let score = bestNameScore(brief.name, ocr.nameCandidates) * 70;
  if (ocr.collectorNumber) {
    const local = brief.localId.replace(/^0+/, "").toLowerCase();
    const found = ocr.collectorNumber.replace(/^0+/, "").toLowerCase();
    if (local === found) score += 28;
  }
  return score;
}

export async function matchCard(
  ocr: OcrResult,
  langInput?: string,
): Promise<ScoredMatch[]> {
  const lang = normalizeLang(langInput);
  const briefs = await lookupCandidates(ocr, lang);
  if (!briefs.length) return [];

  const ranked = [...new Map(briefs.map((card) => [card.id, card])).values()]
    .map((brief) => ({ brief, score: briefScore(brief, ocr) }))
    .filter((item) => item.score >= 50)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((item) => item.brief);

  const cards = await hydrateCards(ranked, lang, 8);
  return cards
    .map((card) => scoreCard(card, ocr))
    .filter((match) => match.score > 20)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}
