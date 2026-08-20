export const CARD_CONDITIONS = ["mint", "nm", "lp", "mp", "hp", "dmg"] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];

export const SUPPORTED_LANGS = ["en", "fr", "de", "es", "it"] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];
export type TcgLang = Lang;

export type CardmarketPricing = {
  unit?: string;
  avg?: number;
  low?: number;
  trend?: number;
  avg1?: number;
  avg7?: number;
  avg30?: number;
  "avg-holo"?: number;
  "low-holo"?: number;
  "trend-holo"?: number;
};

export type TcgplayerVariantPricing = {
  marketPrice?: number | null;
  midPrice?: number | null;
};

export type TcgdexCard = {
  id: string;
  localId: string;
  name: string;
  image?: string;
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  description?: string;
  set?: {
    id: string;
    name: string;
    logo?: string;
    cardCount?: {
      official?: number;
      total?: number;
    };
  };
  pricing?: {
    cardmarket?: CardmarketPricing;
    tcgplayer?: {
      unit?: string;
      normal?: TcgplayerVariantPricing;
      holofoil?: TcgplayerVariantPricing;
      "reverse-holofoil"?: TcgplayerVariantPricing;
    };
  };
};

export type OcrResult = {
  rawText: string;
  nameCandidates: string[];
  evolvesFrom: string | null;
  hp: number | null;
  collectorNumber: string | null;
  setCode?: string | null;
  setTotal: string | null;
  illustrator?: string | null;
  stage?: string | null;
  regulationMark?: string | null;
  ability?: string | null;
  attacks?: { name: string; damage: number | null }[];
  confidence: number;
};

export type ScoredMatch = {
  card: TcgdexCard;
  score: number;
  reasons: string[];
};

export type ScanResponse = {
  matches: ScoredMatch[];
  bestMatch: ScoredMatch | null;
  foil?: boolean;
};

export type CollectionEntry = {
  id: string;
  cardId: string;
  name: string;
  setName: string;
  setId: string;
  localId: string;
  image?: string;
  rarity?: string;
  types?: string[];
  quantity: number;
  condition: CardCondition;
  priceEur: number | null;
  addedAt: string;
};

export type CollectionResponse = {
  cards: CollectionEntry[];
  stats: {
    unique: number;
    totalCards: number;
    totalValue: number;
  };
};

export type Page = "scan" | "collection" | "search";
