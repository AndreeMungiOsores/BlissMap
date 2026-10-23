/**
 * entityUtils.ts
 * Deterministic classification and extraction of Centers (sedes) vs Doctors across BlissMap.
 */

export interface EntityLike {
  id?: string;
  name?: string;
  tags?: string[];
  custom_fields?: Record<string, string | undefined>;
}

/**
 * Checks if an entity is a legal business entity / medical center (Sede / Centro Médico).
 */
export const isCorporateCenter = (loc: EntityLike): boolean => {
  // 1. Explicit ID prefixes
  if (loc.id) {
    if (loc.id.startsWith('b2c-center') || loc.id.startsWith('custom-center-')) return true;
    if (loc.id.startsWith('b2c-doctor') || loc.id.startsWith('b2c-cmp')) return false;
  }

  // 2. Explicit manual override in custom_fields
  const explicitType = loc.custom_fields?.['entity_type'];
  if (explicitType === 'center') return true;
  if (explicitType === 'doctor') return false;

  // 3. Document check: RUC starting with 20 is ALWAYS a corporate legal entity in Peru (persona jurídica = Sede / Centro)
  const doc = (
    loc.custom_fields?.['Documento'] ||
    loc.custom_fields?.['RUC'] ||
    loc.custom_fields?.['doc'] ||
    ''
  ).replace(/\D/g, '');
  if (doc.length === 11 && doc.startsWith('20')) return true;

  // 4. Corporate suffixes in Name or Razón Social
  const name = loc.name || '';
  const rs = loc.custom_fields?.['Razón Social'] || loc.custom_fields?.['Razon Social'] || '';
  const combined = `${name} ${rs}`.toLowerCase();

  const corpSuffixes = /\b(e\.?i\.?r\.?l\.?|s\.?a\.?c\.?|s\.?a\.?|s\.?r\.?l\.?|s\.?c\.?r\.?l\.?|sociedad\s+an[oó]nima)\b/i;
  if (corpSuffixes.test(combined)) return true;

  // 5. Physical clinic / medical center / healthcare facility keywords in name
  const clinicKeywords = /\b(cl[ií]nica|centro\s+m[eé]dico|centro\s+dermatol[oó]gico|centro\s+est[eé]tico|policl[ií]nico|hospital|botica|farmacia|medical\s+center|dermacenter|dermol[aá]ser|consultorio|spa|instituto)\b/i;
  if (clinicKeywords.test(name)) return true;

  // 6. Explicit tags
  const tags = loc.tags || [];
  if (tags.some(t => /centro\s+m[eé]dico|sede/i.test(t))) return true;

  return false;
};

/**
 * Deterministically returns 'doctor' or 'center'.
 */
export const determineEntityType = (loc: EntityLike): 'doctor' | 'center' => {
  // If it matches corporate center / physical venue criteria, it is a center
  if (isCorporateCenter(loc)) return 'center';

  // Explicit doctor indicators
  if (loc.id?.startsWith('b2c-doctor') || loc.id?.startsWith('b2c-cmp')) return 'doctor';
  if (loc.custom_fields?.['CMP'] || loc.custom_fields?.['Colegiatura']) return 'doctor';
  if (/^dr(a)?\.?\s+/i.test(loc.name || '')) return 'doctor';

  // Fallback to center
  return 'center';
};
