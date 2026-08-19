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
  lowPrice?: number | null;
  midPrice?: number | null;
  highPrice?: number | null;
  marketPrice?: number | null;
};

export type TcgplayerPricing = {
  unit?: string;
  normal?: TcgplayerVariantPricing;
  holofoil?: TcgplayerVariantPricing;
  reverse?: TcgplayerVariantPricing;
  "reverse-holofoil"?: TcgplayerVariantPricing;
};

export type TcgdexSet = {
  id: string;
  name: string;
  logo?: string;
  symbol?: string;
  cardCount?: {
    official?: number;
    total?: number;
  };
};

export type TcgdexCardBrief = {
  id: string;
  localId: string;
  name: string;
  image?: string;
};

export type TcgdexCard = TcgdexCardBrief & {
  category?: string;
  illustrator?: string;
  rarity?: string;
  hp?: number;
  types?: string[];
  stage?: string;
  evolveFrom?: string;
  description?: string;
  regulationMark?: string;
  retreat?: number;
  attacks?: {
    name: string;
    damage?: string | number;
    effect?: string;
    cost?: string[];
  }[];
  abilities?: {
    name: string;
    type?: string;
    effect?: string;
  }[];
  weaknesses?: { type?: string; value?: string }[];
  set?: TcgdexSet;
  variants?: {
    holo?: boolean;
    normal?: boolean;
    reverse?: boolean;
    firstEdition?: boolean;
  };
  pricing?: {
    cardmarket?: CardmarketPricing;
    tcgplayer?: TcgplayerPricing;
  };
};

export type OcrResult = {
  rawText: string;
  nameCandidates: string[];
  evolvesFrom: string | null;
  hp: number | null;
  collectorNumber: string | null;
  setTotal: string | null;
  illustrator: string | null;
  stage: string | null;
  regulationMark: string | null;
  ability: string | null;
  attacks: { name: string; damage: number | null }[];
  confidence: number;
};

export type ScoredMatch = {
  card: TcgdexCard;
  score: number;
  reasons: string[];
};

export type CardCondition = "mint" | "nm" | "lp" | "mp" | "hp" | "dmg";

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

export type CollectionStore = {
  cards: CollectionEntry[];
};
