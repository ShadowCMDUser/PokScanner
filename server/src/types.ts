export const CARD_CONDITIONS = ["mint", "nm", "lp", "mp", "hp", "dmg"] as const;
export type CardCondition = (typeof CARD_CONDITIONS)[number];

export const SUPPORTED_LANGS = ["en", "fr", "de", "es", "it"] as const;
export type TcgLang = (typeof SUPPORTED_LANGS)[number];
export type Lang = TcgLang;

export type CardmarketPricing = {
  readonly unit?: string;
  readonly avg?: number;
  readonly low?: number;
  readonly trend?: number;
  readonly avg1?: number;
  readonly avg7?: number;
  readonly avg30?: number;
  readonly "avg-holo"?: number;
  readonly "low-holo"?: number;
  readonly "trend-holo"?: number;
};

export type TcgplayerVariantPricing = {
  readonly lowPrice?: number | null;
  readonly midPrice?: number | null;
  readonly highPrice?: number | null;
  readonly marketPrice?: number | null;
};

export type TcgplayerPricing = {
  readonly unit?: string;
  readonly normal?: TcgplayerVariantPricing;
  readonly holofoil?: TcgplayerVariantPricing;
  readonly reverse?: TcgplayerVariantPricing;
  readonly "reverse-holofoil"?: TcgplayerVariantPricing;
};

export type TcgdexSet = {
  readonly id: string;
  readonly name: string;
  readonly logo?: string;
  readonly symbol?: string;
  readonly cardCount?: {
    readonly official?: number;
    readonly total?: number;
  };
};

export type TcgdexCardBrief = {
  readonly id: string;
  readonly localId: string;
  readonly name: string;
  readonly image?: string;
};

export type TcgdexCard = TcgdexCardBrief & {
  readonly category?: string;
  readonly illustrator?: string;
  readonly rarity?: string;
  readonly hp?: number;
  readonly types?: readonly string[];
  readonly stage?: string;
  readonly evolveFrom?: string;
  readonly description?: string;
  readonly regulationMark?: string;
  readonly retreat?: number;
  readonly attacks?: readonly {
    readonly name: string;
    readonly damage?: string | number;
    readonly effect?: string;
    readonly cost?: readonly string[];
  }[];
  readonly abilities?: readonly {
    readonly name: string;
    readonly type?: string;
    readonly effect?: string;
  }[];
  readonly weaknesses?: readonly { readonly type?: string; readonly value?: string }[];
  readonly set?: TcgdexSet;
  readonly variants?: {
    readonly holo?: boolean;
    readonly normal?: boolean;
    readonly reverse?: boolean;
    readonly firstEdition?: boolean;
  };
  readonly pricing?: {
    readonly cardmarket?: CardmarketPricing;
    readonly tcgplayer?: TcgplayerPricing;
  };
};

export type OcrResult = {
  readonly rawText: string;
  readonly nameCandidates: readonly string[];
  readonly evolvesFrom: string | null;
  readonly hp: number | null;
  readonly collectorNumber: string | null;
  readonly setCode: string | null;
  readonly setTotal: string | null;
  readonly illustrator: string | null;
  readonly stage: string | null;
  readonly regulationMark: string | null;
  readonly ability: string | null;
  readonly attacks: readonly { readonly name: string; readonly damage: number | null }[];
  readonly confidence: number;
};

export type ScoredMatch = {
  readonly card: TcgdexCard;
  readonly score: number;
  readonly reasons: readonly string[];
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

export type CollectionStore = {
  users: Record<string, CollectionEntry[]>;
};
