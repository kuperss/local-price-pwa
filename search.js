// Search scope is independent of the cost-unlock mode. Costs never enter these indexes.
export function normalizeSearchMode(value) {
  return value === "identity" ? "identity" : "all";
}

export function buildSearchTokens(text) {
  return [...new Set(
    String(text || "")
      .split(/[\s：:;,.，。/\\|｜()[\]{}_\-"'`]+/g)
      .map(normalizeForCompare)
      .filter(Boolean),
  )];
}

export function normalizeForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[：:;,.，。/\\|｜()[\]{}_-]/g, "");
}

export function entryMatchesSearch(entry, normalized, tokens = [], mode = "all") {
  if (!normalized) return true;
  const identityOnly = normalizeSearchMode(mode) === "identity";
  const aliases = [entry.sku, entry.productName, ...(identityOnly ? [] : entry.searchAliases || [])]
    .map(normalizeForCompare).filter(Boolean);
  const searchText = identityOnly
    ? normalizeForCompare([entry.sku, entry.productName].filter(Boolean).join(" "))
    : entry.searchText || "";
  const matches = token => !token ||
    (token.length <= 3 && aliases.some(alias => alias === token || alias.startsWith(token))) ||
    searchText.includes(token);
  return matches(normalized) || (tokens.length > 1 && tokens.every(matches));
}
