import { modelKey } from "./model-identity";

export type RankedModel = {
  id: string;
  model_code: string;
  archived_at: string | null;
};

export function rankProducts<T extends RankedModel>(term: string, products: T[]): T[] {
  const key = modelKey(term);
  return products.slice().sort((left, right) => {
    const score = rankScore(key, left) - rankScore(key, right);
    return score === 0 ? left.model_code.localeCompare(right.model_code) : score;
  });
}

function rankScore(key: string, product: RankedModel): number {
  const productKey = modelKey(product.model_code);
  const archived = product.archived_at ? 10 : 0;
  if (key && productKey === key) return archived;
  if (key && productKey.startsWith(key)) return 2 + archived;
  return 4 + archived;
}

export function exactProduct<T extends RankedModel>(term: string, products: T[]): T | null {
  const key = modelKey(term);
  if (!key) return null;
  return products.find((product) => modelKey(product.model_code) === key) ?? null;
}
