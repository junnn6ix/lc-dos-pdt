export const GLOBAL_TABLES = [
  "menus",
  "categories",
  "menu_prices_master",
  "promotions",
  "branches",
] as const;

export const LOCAL_TABLES = [
  "tables",
  "orders",
  "order_items",
  "payments",
  "users",
  "menu_price_overrides",
] as const;

export const REPLICATION_LAG_ALERT_SECONDS = {
  tasikmalaya: 3,
  surabaya: 5,
  malang: 5,
} as const;

export type BranchSlug = "tasikmalaya" | "surabaya" | "malang";
export type NodeRole = "central" | "branch";

export function resolveEffectiveMenuPrice(
  basePrice: number,
  overridePrice: number | null | undefined,
): number {
  return overridePrice ?? basePrice;
}

export function isGlobalTable(
  tableName: string,
): tableName is (typeof GLOBAL_TABLES)[number] {
  return (GLOBAL_TABLES as readonly string[]).includes(tableName);
}
