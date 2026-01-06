export type Weights = {
  price: number;
  popularity: number;
  size: number;
};

export type ScoreBreakdown = {
  priceNorm: number;
  popularityNorm: number;
  sizeNorm: number;
  weights: Weights;
};

export type RecommendationItem = {
  product: any;
  stats?: {
    sold_30d: number;
    views_30d: number;
  };
  score: number;
  scoreBreakdown: ScoreBreakdown;
  primaryReason: "Price" | "Popularity" | "Size";
  badge?: string;
};

export type RecommendationsResponse = {
  data: RecommendationItem[];
  limit: number;
  period: number;
  weights: Weights;
};
