/**
 * doctorCatalogService.ts
 * Master catalog service for official medical doctors from CRM Dataverse (crb7e_doctoreses).
 * Uses CMP (Colegiatura Médica del Perú) as the immutable primary key.
 */

import officialDoctorsData from '../data/official_doctors.json';
import { removeAccents, nameSimilarity } from '../utils/stringUtils';

export interface OfficialDoctorItem {
  cmp: string;
  name: string;
  crm_id: string;
}

export const officialDoctors: OfficialDoctorItem[] = officialDoctorsData as OfficialDoctorItem[];

// Fast lookup map by 6-digit padded CMP
const doctorsByCmp = new Map<string, OfficialDoctorItem>();
officialDoctors.forEach(doc => {
  doctorsByCmp.set(doc.cmp, doc);
});

/**
 * Normalizes any CMP string to a standard 6-digit numeric string without dots or spaces.
 * E.g. "50.850" -> "050850", "CMP-050850" -> "050850", "39704" -> "039704"
 */
export const cleanCmp = (raw?: string): string => {
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.padStart(6, '0');
};

/**
 * Find an official doctor by CMP.
 */
export const findDoctorByCmp = (cmp?: string): OfficialDoctorItem | undefined => {
  const cleaned = cleanCmp(cmp);
  if (!cleaned) return undefined;
  return doctorsByCmp.get(cleaned);
};

const STOP_WORDS = new Set([
  'dra', 'dr', 'doctor', 'doctora', 'de', 'del', 'la', 'las', 'los', 'el', 'y', 'e', 'consultorio', 'centro', 'clinica'
]);

const COMMON_FIRST_NAMES = new Set([
  'jose', 'luis', 'juan', 'carlos', 'maria', 'ana', 'jorge', 'rosa', 'pedro',
  'victor', 'manuel', 'jesus', 'miguel', 'angel', 'carmen', 'francisco', 'javier',
  'antonio', 'cesar', 'eduardo', 'fernando', 'david', 'alberto', 'mario', 'diego',
  'roberto', 'ricardo', 'julio', 'marcos', 'marco', 'sergio'
]);

const extractDoctorTokens = (str: string): string[] => {
  return removeAccents(str)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t));
};

/**
 * Find an official doctor by name using token overlap and fuzzy similarity.
 * Handles both "First Last" and "Last, First" formats seamlessly.
 */
export const findDoctorByName = (name?: string): OfficialDoctorItem | undefined => {
  if (!name) return undefined;
  const cleanTarget = removeAccents(name).toLowerCase().trim();
  if (cleanTarget.length < 3) return undefined;

  // 1. Direct exact match
  for (const doc of officialDoctors) {
    const cleanDocName = removeAccents(doc.name).toLowerCase().trim();
    if (cleanDocName === cleanTarget) {
      return doc;
    }
  }

  // 2. Token overlap match (e.g. "Calizaya Quea De Contreras, Jaqueline Ymira" vs "Jaqueline Ymira Calizaya Quea De Contreras")
  const targetToks = extractDoctorTokens(name);
  // Disallow matching when all tokens are common first names without any surname (e.g. "Jose Luis", "Juan Carlos")
  if (targetToks.every(t => COMMON_FIRST_NAMES.has(t))) {
    return undefined;
  }

  if (targetToks.length >= 2) {
    let bestDoc: OfficialDoctorItem | undefined;
    let bestScore = 0;

    for (const doc of officialDoctors) {
      const docToks = extractDoctorTokens(doc.name);
      const common = targetToks.filter(t => docToks.includes(t));
      const targetCoverage = common.length / targetToks.length;

      if (common.length >= 2 && targetCoverage >= 0.8) {
        const overallScore = common.length / Math.max(targetToks.length, docToks.length);
        if (overallScore > bestScore) {
          bestScore = overallScore;
          bestDoc = doc;
        }
      }
    }

    if (bestDoc) return bestDoc;
  }

  // 3. Fallback to bigram dice similarity
  let bestMatch: OfficialDoctorItem | undefined;
  let bestSim = 0;

  for (const doc of officialDoctors) {
    const cleanDocName = removeAccents(doc.name).toLowerCase().trim();
    const sim = nameSimilarity(cleanTarget, cleanDocName);
    if (sim > bestSim && sim >= 0.85) {
      bestSim = sim;
      bestMatch = doc;
    }
  }

  return bestMatch;
};

/**
 * Search doctors by query (matches CMP or Name).
 */
export const searchDoctors = (query: string, limit = 20): OfficialDoctorItem[] => {
  if (!query || query.trim().length === 0) {
    return officialDoctors.slice(0, limit);
  }

  const cleanQ = removeAccents(query).toLowerCase().trim();
  const digitsQ = query.replace(/\D/g, '');

  const results: OfficialDoctorItem[] = [];

  for (const doc of officialDoctors) {
    const docCleanName = removeAccents(doc.name).toLowerCase();
    const docDigits = doc.cmp.replace(/^0+/, ''); // strip leading zeros for flexible search

    const matchName = docCleanName.includes(cleanQ);
    const matchCmp = digitsQ.length >= 2 && (doc.cmp.includes(digitsQ) || docDigits.includes(digitsQ));

    if (matchName || matchCmp) {
      results.push(doc);
      if (results.length >= limit) break;
    }
  }

  return results;
};

/**
 * Returns all official doctors in the master catalog.
 */
export const getAllOfficialDoctors = (): OfficialDoctorItem[] => {
  return officialDoctors;
};
