/**
 * stringUtils.ts
 * Shared string utilities: normalization, bigram similarity, title-case helpers.
 */

/** Strip accents and lowercase. */
export const removeAccents = (str: string | null | undefined): string => {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
};

/** Build a set of character bigrams from a string. */
const toBigrams = (str: string): Set<string> => {
  const s = removeAccents(str).replace(/\s+/g, ' ').trim();
  const result = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) {
    result.add(s.slice(i, i + 2));
  }
  return result;
};

/**
 * Dice coefficient (bigram) similarity between two strings.
 * Returns a number in [0, 1] — 1 is identical.
 */
export const nameSimilarity = (a: string, b: string): number => {
  if (!a || !b) return 0;
  const cleanA = removeAccents(a);
  const cleanB = removeAccents(b);
  if (cleanA === cleanB) return 1;

  const bigramA = toBigrams(a);
  const bigramB = toBigrams(b);
  if (bigramA.size === 0 && bigramB.size === 0) return 1;
  if (bigramA.size === 0 || bigramB.size === 0) return 0;

  let intersection = 0;
  bigramA.forEach(bg => {
    if (bigramB.has(bg)) intersection++;
  });

  return (2 * intersection) / (bigramA.size + bigramB.size);
};
