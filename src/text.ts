export function normalizeWhitespace(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function quoteAppearsInSource(source: string, quote: string): boolean {
  const normalizedQuote = normalizeWhitespace(quote);
  if (!normalizedQuote) return false;

  return normalizeWhitespace(source).includes(normalizedQuote);
}

export function claimsMatch(left: string, right: string): boolean {
  return normalizeWhitespace(left) === normalizeWhitespace(right);
}
