export function parseBooleanQueryParam(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;

  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;

  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }

  return fallback;
}

export function filterAvailableRowsByAllowedIds<Row extends { id: number }>(
  rows: Row[],
  allowedIds: Set<number>,
  excludeAllowed: boolean,
): Row[] {
  if (!excludeAllowed || allowedIds.size === 0) return rows;
  return rows.filter((row) => !allowedIds.has(row.id));
}
