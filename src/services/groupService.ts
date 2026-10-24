/**
 * groupService.ts
 * Logic for detecting, unifiying, and managing economic groups of locations
 * across BlissMap locators (MedicosBliss and Blissfarma).
 */

import { supabase } from '../supabaseClient';
import { removeAccents, nameSimilarity, cleanRS } from '../utils/stringUtils';
import officialGruposData from '../data/official_grupos_economicos.json';
import { isCorporateCenter } from '../utils/entityUtils';
import {
  findDoctorByCmp,
  findDoctorByName,
  cleanCmp,
  officialDoctors
} from './doctorCatalogService';

export interface OfficialGeItem {
  id: string;
  idge: string;
  nombre: string;
  propietario: string;
  rol: string;
}

export const officialGruposEconomicos: OfficialGeItem[] = officialGruposData as OfficialGeItem[];

const STOP_WORDS = new Set([
  'dr', 'dra', 'doctor', 'doctora', 'consultorio', 'clinica', 'centro',
  'medico', 'medica', 'medic', 'medical', 'med', 'dermo', 'derma',
  'estetica', 'estetico', 'estetic', 'instituto', 'salud', 'peru',
  'corp', 'spa', 'group', 'grupo', 'sac', 'srl', 'eirl', 'de', 'del',
  'la', 'las', 'los', 'el', 'y', 'en', 'e',
  'botica', 'farmacia', 'piel', 'skin', 'laser', 'face', 'body', 'vida'
]);

/**
 * Words that are generic to the medical/pharma business sector in Peru.
 * A token overlap that ONLY involves these words cannot prove a brand match
 * — e.g., two companies named "Distribuidora de Productos Dermatológicos"
 * from different owners are NOT the same economic group.
 */
const GENERIC_BRAND_WORDS = new Set([
  'distribuidora', 'distribuidor', 'distribuciones', 'productos', 'producto',
  'farmaceuticos', 'farmaceutico', 'farmacia', 'farmaceutica',
  'dermatologicos', 'dermatologico', 'dermatologia',
  'cosmeticos', 'cosmetico', 'cosmetica',
  'comercializadora', 'comercializacion', 'comercial', 'comercio',
  'servicios', 'servicio', 'inversiones', 'inversion',
  'asociados', 'asociado', 'empresa', 'sociedad', 'negocios',
  'nacional', 'internacional', 'peruano', 'peruanos',
  'representaciones', 'representacion', 'importaciones', 'importacion',
  'exportaciones', 'exportacion', 'soluciones', 'solucion'
]);

const TITLE_WORDS = new Set(['dr', 'dra', 'doctor', 'doctora', 'de', 'del', 'la', 'las', 'los', 'el', 'y']);

function normalizeTokens(str?: string): string[] {
  if (!str) return [];
  const clean = removeAccents(str)
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.split(' ').filter(t => t.length >= 2 && !STOP_WORDS.has(t));
}

export function normalizePersonTokens(str?: string): string[] {
  if (!str) return [];
  const clean = removeAccents(str)
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.split(' ').filter(t => t.length >= 2 && !TITLE_WORDS.has(t));
}

interface GeWithTokens {
  ge: OfficialGeItem;
  cleanRS: string;
  nombreTokens: string[];
  propPersonTokens: string[];
}

const precomputedGeTokens: GeWithTokens[] = officialGruposEconomicos.map(ge => ({
  ge,
  cleanRS: cleanRS(ge.nombre),
  nombreTokens: normalizeTokens(ge.nombre),
  propPersonTokens: normalizePersonTokens(ge.propietario)
}));

export function getDoctorTokens(loc: LocationItem): string[] {
  const fromFields = loc.custom_fields?.['Médico'] ||
    loc.custom_fields?.['Medicos'] ||
    loc.custom_fields?.['Doctor'] ||
    loc.custom_fields?.['Contacto'];
  if (fromFields) {
    return normalizePersonTokens(fromFields);
  }
  if (loc.custom_fields?.['entity_type'] === 'doctor' || loc.tags?.includes('Médico') || loc.id.startsWith('b2c-cmp-')) {
    return normalizePersonTokens(loc.name);
  }
  return [];
}

/**
 * Consolidated person similarity & conflict evaluation.
 * In Peru, full names follow: [Primer Nombre] [Segundo Nombre] [Apellido Paterno] [Apellido Materno].
 * Sharing just 1 token (e.g. a single surname like "Obregon" or a given name like "Maria")
 * is NEVER enough to consider two records as the same individual.
 */
export function evaluatePersonMatch(tokensA: string[], tokensB: string[]): {
  isMatch: boolean;
  isConflict: boolean;
  commonCount: number;
  dice: number;
} {
  if (tokensA.length === 0 || tokensB.length === 0) {
    return { isMatch: false, isConflict: false, commonCount: 0, dice: 0 };
  }

  let common = 0;
  for (const t of tokensA) {
    if (tokensB.includes(t)) common++;
  }

  const minTokens = Math.min(tokensA.length, tokensB.length);
  const dice = (2 * common) / (tokensA.length + tokensB.length);

  // If both have at least 2 tokens (e.g. First name + Surname or 2 Surnames)
  if (tokensA.length >= 2 && tokensB.length >= 2) {
    // Fewer than 2 common tokens = definitely conflicting individuals!
    // (e.g. "Jannell Obregon Alzamora" vs "Katherine Noelia Obregon Candela" -> shared: ["obregon"], common = 1 -> CONFLICT)
    if (common < 2) {
      return { isMatch: false, isConflict: true, commonCount: common, dice };
    }

    // If both have 3+ tokens, common < minTokens and dice < 0.60 -> flag as conflict (different people with common surnames)
    if (common < minTokens && dice < 0.60) {
      return { isMatch: false, isConflict: true, commonCount: common, dice };
    }

    return { isMatch: dice >= 0.60 || common >= minTokens, isConflict: false, commonCount: common, dice };
  }

  // If one person has only 1 token (e.g., "Obregon"), it's underspecified:
  // Cannot be certified as a match without additional consolidated parameters.
  return { isMatch: false, isConflict: false, commonCount: common, dice };
}

export function areDoctorsConflicting(locA: LocationItem, locB: LocationItem): boolean {
  // 1. If both locations have official CRM economic group IDs (crb7e_idge) and they differ, they conflict
  const geA = locA.custom_fields?.['crb7e_idge'];
  const geB = locB.custom_fields?.['crb7e_idge'];
  if (geA && geB && geA !== geB) {
    return true;
  }

  // 2. Doctor token comparison
  const docA = getDoctorTokens(locA);
  const docB = getDoctorTokens(locB);
  if (docA.length >= 2 && docB.length >= 2) {
    const res = evaluatePersonMatch(docA, docB);
    if (res.isConflict || !res.isMatch) {
      return true;
    }
  }

  // 3. Different CMP colegiatura
  const cmpA = (locA.custom_fields?.['Colegiatura'] || locA.custom_fields?.['CMP'] || (locA.id.startsWith('b2c-cmp-') ? locA.id.replace('b2c-cmp-', '') : '')).replace(/\D/g, '').replace(/^0+/, '');
  const cmpB = (locB.custom_fields?.['Colegiatura'] || locB.custom_fields?.['CMP'] || (locB.id.startsWith('b2c-cmp-') ? locB.id.replace('b2c-cmp-', '') : '')).replace(/\D/g, '').replace(/^0+/, '');
  if (cmpA && cmpB && cmpA !== cmpB) {
    return true;
  }

  // 4. Distinct RUCs with disjoint doctor names
  const rucA = (locA.custom_fields?.['Documento'] || locA.custom_fields?.['RUC'] || '').replace(/\D/g, '');
  const rucB = (locB.custom_fields?.['Documento'] || locB.custom_fields?.['RUC'] || '').replace(/\D/g, '');
  if (rucA && rucB && rucA !== rucB && docA.length >= 1 && docB.length >= 1) {
    const res = evaluatePersonMatch(docA, docB);
    if (!res.isMatch) {
      return true;
    }
  }

  return false;
}

function scoreMatch(loc: LocationItem, item: GeWithTokens): number {
  // ──────────────────────────────────────────────────────────────────────────
  // TIER 1: Doctor / Propietario match
  // ──────────────────────────────────────────────────────────────────────────
  const locDocToks = getDoctorTokens(loc);
  const isDoctorEntity =
    loc.custom_fields?.['entity_type'] === 'doctor' ||
    loc.tags?.includes('Médico') ||
    loc.id.startsWith('b2c-cmp-');

  let personScore = 0;
  if (locDocToks.length > 0 && item.propPersonTokens.length > 0) {
    const res = evaluatePersonMatch(locDocToks, item.propPersonTokens);
    if (res.isMatch) {
      personScore = res.dice >= 0.8 ? 1.0 : res.dice;
    }

    // ── PERSON CONFLICT VETO (CONSOLIDATED) ────────────────────────────────
    // If the location has a known doctor with >= 2 tokens BUT that doctor
    // does NOT match this GE propietario (shares < 2 tokens or is in conflict),
    // HARD VETO: Commercial/Brand or address heuristics CANNOT override a conflicting doctor!
    if (locDocToks.length >= 2 && item.propPersonTokens.length >= 2 && !res.isMatch) {
      return 0;
    }
  }

  // Doctor entities (individual practitioners) are NOT corporate brands:
  // they must NEVER match via Tier 2 Commercial/Brand matching.
  // Matching an individual doctor's personal name against GE commercial names
  // causes severe false-positive mergers whenever two unrelated doctors share
  // common Peruvian surnames or first names (e.g., "Alvarez", "Rojas", "Patricia").
  if (isDoctorEntity) {
    return personScore;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TIER 2: Commercial / Brand Name match (Centers, Clinics, Pharmacies, Labs)
  // ──────────────────────────────────────────────────────────────────────────
  let brandScore = 0;
  const locNames = [
    loc.name,
    loc.custom_fields?.['Razón Social'],
    loc.custom_fields?.['Razon Social'],
    loc.custom_fields?.['Nombre Comercial']
  ].filter(Boolean);

  for (const rawName of locNames) {
    // 2a. Clean RS exact comparison
    const cleaned = cleanRS(rawName);
    if (cleaned.length >= 4 && item.cleanRS.length >= 4) {
      if (cleaned === item.cleanRS) {
        brandScore = Math.max(brandScore, 1.0);
        continue;
      }
    }

    // 2b. Bigram similarity on names
    const sim = nameSimilarity(rawName, item.ge.nombre);
    if (sim >= 0.80) {
      brandScore = Math.max(brandScore, sim);
    }

    // 2c. Distinctive token overlap
    // ── GENERIC-ONLY BRAND VETO ───────────────────────────────────────────
    // Token overlap is only valid if at least ONE shared token is a distinctive
    // brand word (not a generic sector/legal word).
    const locToks = normalizeTokens(rawName);
    if (locToks.length > 0 && item.nombreTokens.length > 0) {
      let common = 0;
      let distinctiveCommon = 0;
      for (const t of locToks) {
        if (item.nombreTokens.includes(t)) {
          common++;
          if (!GENERIC_BRAND_WORDS.has(t)) distinctiveCommon++;
        }
      }
      // Require at least 2 common tokens AND at least 1 distinctive brand word
      if (common >= 2 && distinctiveCommon >= 1) {
        const dice = (2 * common) / (locToks.length + item.nombreTokens.length);
        if (dice >= 0.5) {
          brandScore = Math.max(brandScore, Math.max(dice, 0.85));
        }
      }
    }
  }

  return Math.max(personScore, brandScore);
}

// Memory cache for findOfficialGeMatch to eliminate redundant token computations
const geMatchCache = new Map<string, OfficialGeItem | null>();

export const clearGeMatchCache = (): void => {
  geMatchCache.clear();
};

/**
 * Find matching official CRM economic group for a given location.
 */
export const findOfficialGeMatch = (loc: LocationItem): OfficialGeItem | undefined => {
  if (geMatchCache.has(loc.id)) {
    const cached = geMatchCache.get(loc.id);
    return cached === null ? undefined : cached;
  }

  const result = (() => {
    // 1. Direct match by crb7e_idge or Grupo Económico in custom_fields
    const storedIdge = loc.custom_fields?.['crb7e_idge'] || loc.custom_fields?.['Grupo Económico'];
    if (storedIdge) {
      const direct = officialGruposEconomicos.find(
        g => g.idge.toUpperCase() === storedIdge.trim().toUpperCase()
      );
      if (direct) {
        // Validate against registered doctor to prevent accepting contaminated legacy tags
        const locDocToks = getDoctorTokens(loc);
        const propToks = normalizePersonTokens(direct.propietario);
        if (locDocToks.length >= 2 && propToks.length >= 2) {
          const res = evaluatePersonMatch(locDocToks, propToks);
          if (res.isConflict || !res.isMatch) {
            // Person Conflict: The doctor registered in this location is NOT the owner of this official GE!
            // Reject contaminated direct match and fall through to scoring.
          } else {
            return direct;
          }
        } else {
          return direct;
        }
      }
    }

    // 2. Two-tier matching engine (Doctor/Person + distinctive Brand Name)
    let bestGE: OfficialGeItem | undefined;
    let bestScore = 0;

    for (const item of precomputedGeTokens) {
      const score = scoreMatch(loc, item);
      if (score > bestScore && score >= 0.70) {
        bestScore = score;
        bestGE = item.ge;
      }
    }

    return bestGE;
  })();

  geMatchCache.set(loc.id, result || null);
  return result;
};

export interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
}

export interface LocationItem {
  id: string;
  locator_id?: string;
  name: string;
  image_url: string | null;
  address: string;
  lat?: number;
  lng?: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  facebook?: string | null;
  instagram?: string | null;
  tags: string[];
  custom_fields: Record<string, string>;
  published?: boolean;
  products?: ProductItem[];
  created_at?: string;
  is_manual_override?: boolean;
  grupo_economico_ids?: string[] | null;
  linked_entities?: LocationItem[];
}

export interface SuggestedGroup {
  ids: string[];
  name: string;
  address: string;
  totalProducts: number;
  rucs: string[];
  members: LocationItem[];
  primaryId: string;
  officialGe?: OfficialGeItem;
}

export interface BillingVehicle {
  documentNumber: string;
  businessName: string;
  documentType: 'RUC 20' | 'RUC 10' | 'DNI' | 'OTRO';
  totalPurchasedQty: number;
  productsCount: number;
  products: ProductItem[];
  originNames: string[];
}

export interface PhysicalSede {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  isPrimary: boolean;
  phone: string | null;
  locatorSlug?: string;
  brandingInherited: boolean;
  staffCount: number;
}

export interface AffiliatedDoctorStaff {
  id: string;
  name: string;
  cmp?: string;
  rne?: string;
  specialty?: string;
  photoUrl?: string | null;
  assignedSedes: string[];
  otherCenters: string[];
}

export interface ActiveGroup {
  primary: LocationItem;
  members: LocationItem[];
  secondaryMembers: LocationItem[];
  totalProducts: number;
  combinedProducts: ProductItem[];
  rucs: string[];
  officialGe?: OfficialGeItem;
  billingVehicles: BillingVehicle[];
  physicalSedes: PhysicalSede[];
  medicalStaff: AffiliatedDoctorStaff[];
}

export const normalizeAddress = (addr: string): string => {
  if (!addr) return '';
  let s = removeAccents(addr).toLowerCase();

  // 1. Remove interior / suite / office / floor / mz / lt (e.g. "INT. 803", "Of. 201", "Piso 4")
  s = s.replace(/\b(int|interior|of|oficina|dpto|departamento|piso|mz|mza|lote|lt)\b[\s.:]*[-a-z0-9]+/gi, ' ');

  // 2. Remove standard postal / administrative suffix after comma (e.g. ", Santiago de Surco, Lima, Perú")
  s = s.replace(/,\s*(santiago de surco|surco|miraflores|san isidro|san borja|la molina|jesus maria|lince|magdalena|pueblo libre|san miguel|barranco|chorrillos|los olivos|san juan de miraflores|san juan de lurigancho|lima|callao|piura|arequipa|trujillo|chiclayo|cusco|ica|huancayo|peru)[\s,a-z0-9]*/gi, '');

  // 3. Normalize common street prefixes and typography
  return s
    .replace(/\bav\b\.?/g, 'av')
    .replace(/\bjr\b\.?/g, 'jr')
    .replace(/\bcalle\b/g, 'cl')
    .replace(/\bnro\b\.?/g, '')
    .replace(/\bnumero\b/g, '')
    .replace(/\burb\b\.?/g, 'urb')
    .replace(/\burbanizacion\b/g, 'urb')
    .replace(/[-.,#°]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Check if an address is just a generic department/city without a specific street/number.
 * Prevents clustering different people just because they share "Lima, Perú" or "Arequipa, Perú".
 */
export const isGenericCityAddress = (addr?: string): boolean => {
  if (!addr) return true;
  const clean = removeAccents(addr).toLowerCase().trim();
  const genericList = [
    'lima, peru', 'lima peru', 'lima', 'peru',
    'arequipa, peru', 'arequipa peru', 'arequipa',
    'trujillo, peru', 'trujillo peru', 'trujillo',
    'chiclayo, peru', 'chiclayo peru', 'chiclayo',
    'cusco, peru', 'cusco peru', 'cusco',
    'piura, peru', 'piura peru', 'piura',
    'ica, peru', 'ica peru', 'ica',
    'huancayo, peru', 'huancayo peru', 'huancayo'
  ];
  if (genericList.includes(clean)) return true;
  const hasStreetIndicator = /\b(av|avenida|calle|cl|jr|jiron|psje|pasaje|carretera|nro|numero|mza|mz|lote|lt|urb|urbanizacion)\b/i.test(clean);
  const hasDigits = /\d/.test(clean);
  return !hasStreetIndicator && !hasDigits;
};

export const getDistanceMeters = (lat1?: number, lon1?: number, lat2?: number, lon2?: number): number => {
  if (!lat1 || !lon1 || !lat2 || !lon2) return 999999;
  const R = 6371e3;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const isSamePhysicalVenue = (
  a1?: string,
  a2?: string,
  lat1?: number,
  lng1?: number,
  lat2?: number,
  lng2?: number
): boolean => {
  if (!a1 || !a2) return false;

  // 1. Proximidad geográfica GPS menor a 200 metros (mismo establecimiento, edificio o complejo)
  if (lat1 && lng1 && lat2 && lng2) {
    const dist = getDistanceMeters(lat1, lng1, lat2, lng2);
    if (dist <= 200) return true;
  }

  // 2. Coincidencia por dirección normalizada
  const n1 = normalizeAddress(a1);
  const n2 = normalizeAddress(a2);
  if (n1 === n2) return true;

  // 3. Coincidencia por número municipal y nombre de vía
  const num1 = (a1.match(/\b\d{1,5}\b/) || [])[0];
  const num2 = (a2.match(/\b\d{1,5}\b/) || [])[0];
  if (num1 && num2 && num1 === num2) {
    const t1 = n1.split(' ').filter(x => x.length > 2 && x !== num1);
    const t2 = n2.split(' ').filter(x => x.length > 2 && x !== num2);
    const common = t1.filter(t => t2.includes(t));
    if (common.length >= 1) return true;
  }

  return false;
};

/**
 * Detect possible economic groups based on:
 * 1. Official CRM multi-member catalog match (crb7e_gruposeconomicos) — name of owner must agree.
 * 2. REMOVED: address-based heuristic grouping (false positives in shared medical buildings).
 *
 * RULE — Person Conflict Veto:
 *   If a location has a Médico/Doctor custom_field that shares zero token overlap with the
 *   GE propietario AND shares at least one surname token with a *different* GE propietario,
 *   that location must NOT be bucketed under the first GE.
 *
 * RULE — Generic-Only Brand Veto:
 *   Token overlap only counts when at least one matching token is a distinctive brand word
 *   (i.e., NOT in GENERIC_BRAND_WORDS). Pure generic-only matches → brandScore = 0.
 */
export const detectPossibleGroups = (list: LocationItem[]): SuggestedGroup[] => {
  const groups: SuggestedGroup[] = [];
  const used = new Set<string>();

  // Set of IDs already in an active unified group
  const activeUnifiedIds = new Set<string>();
  list.forEach(l => {
    if (l.grupo_economico_ids && l.grupo_economico_ids.length > 0) {
      activeUnifiedIds.add(l.id);
      l.grupo_economico_ids.forEach(id => activeUnifiedIds.add(id));
    }
  });

  // STEP 1: Detect multi-member groups based on Official CRM Catalog
  const geBuckets = new Map<string, { ge: OfficialGeItem; locs: LocationItem[] }>();

  list.forEach(loc => {
    if (activeUnifiedIds.has(loc.id)) return;
    const match = findOfficialGeMatch(loc);
    if (match) {
      const bucket = geBuckets.get(match.idge) || { ge: match, locs: [] };
      bucket.locs.push(loc);
      geBuckets.set(match.idge, bucket);
    }
  });

  // Add official CRM groups with 2 or more locations
  geBuckets.forEach(({ ge, locs }) => {
    // Conflict Veto Filter: Ensure no conflicting doctors are grouped under this GE
    const propToks = normalizePersonTokens(ge.propietario);
    const validLocs = locs.filter(loc => {
      const docToks = getDoctorTokens(loc);
      if (docToks.length >= 2 && propToks.length >= 2) {
        const res = evaluatePersonMatch(docToks, propToks);
        if (res.isConflict || !res.isMatch) {
          return false;
        }
      }
      return true;
    });

    // Also ensure no mutual doctor conflicts between remaining members
    const conflictFreeLocs: LocationItem[] = [];
    for (const loc of validLocs) {
      const hasConflict = conflictFreeLocs.some(existing => areDoctorsConflicting(existing, loc));
      if (!hasConflict) {
        conflictFreeLocs.push(loc);
      }
    }

    if (conflictFreeLocs.length >= 2) {
      conflictFreeLocs.forEach(l => used.add(l.id));

      const allProducts = conflictFreeLocs.flatMap(p => p.products || []);
      const uniqueProducts = new Map<string, ProductItem>();
      allProducts.forEach(p => {
        const existing = uniqueProducts.get(p.name);
        if (existing) {
          uniqueProducts.set(p.name, {
            ...existing,
            qty: (existing.qty || 0) + (p.qty || 0),
            last_date: (!existing.last_date || (p.last_date && p.last_date > existing.last_date)) ? p.last_date : existing.last_date
          });
        } else {
          uniqueProducts.set(p.name, { ...p });
        }
      });

      // Best primary: priority to valid coordinates, then image, then product count
      const defaultPrimary = conflictFreeLocs.reduce((best, cur) => {
        const curScore =
          (cur.lat && cur.lng && (cur.lat !== 0 || cur.lng !== 0) ? 50 : 0) +
          (cur.image_url ? 20 : 0) +
          (cur.products?.length || 0) * 5;
        const bestScore =
          (best.lat && best.lng && (best.lat !== 0 || best.lng !== 0) ? 50 : 0) +
          (best.image_url ? 20 : 0) +
          (best.products?.length || 0) * 5;
        return curScore >= bestScore ? cur : best;
      }, conflictFreeLocs[0]);

      groups.push({
        ids: conflictFreeLocs.map(p => p.id),
        name: defaultPrimary.name,
        address: defaultPrimary.address,
        totalProducts: uniqueProducts.size,
        rucs: conflictFreeLocs.map(p => p.custom_fields?.['Documento'] || '').filter(Boolean),
        members: conflictFreeLocs,
        primaryId: defaultPrimary.id,
        officialGe: ge,
      });
    }
  });

  // STEP 2 — Intentionally removed.
  // Address-based heuristic grouping was removed because it produces systematic
  // false positives in the medical sector: different doctors and independent clinics
  // routinely share the same building address (e.g. medical towers, shopping malls).
  // A physical address alone CANNOT prove a common economic group.
  // Groups are now only suggested via official CRM catalog (STEP 1).

  // Sort groups: official CRM groups first, then by name
  return groups.sort((a, b) => {
    if (a.officialGe && !b.officialGe) return -1;
    if (!a.officialGe && b.officialGe) return 1;
    return a.name.localeCompare(b.name);
  });
};

/**
 * Get active unified groups from a list of locations, enriched with official CRM group metadata.
 */
export const getActiveGroups = (list: LocationItem[]): ActiveGroup[] => {
  const primaryLocs = list.filter(
    loc => loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0
  );

  const handledLocIds = new Set<string>();
  const activeGroups: ActiveGroup[] = [];

  for (const primary of primaryLocs) {
    if (handledLocIds.has(primary.id)) continue;

    const allMemberIds = new Set<string>(primary.grupo_economico_ids || []);
    allMemberIds.add(primary.id);

    // Merge only primaries that ACTUALLY share members in database (never merge by synthetic isSameGe)
    primaryLocs.forEach(other => {
      if (other.id === primary.id) return;
      const sharesMembers = other.grupo_economico_ids?.some(id => allMemberIds.has(id));
      if (sharesMembers) {
        allMemberIds.add(other.id);
        other.grupo_economico_ids?.forEach(id => allMemberIds.add(id));
      }
    });

    allMemberIds.forEach(id => handledLocIds.add(id));

    const memberIdsList = Array.from(allMemberIds);
    let members = list.filter(l => memberIdsList.includes(l.id));
    if (!members.some(m => m.id === primary.id)) {
      members = [primary, ...members];
    }

    // SANITIZATION: Exclude any member whose registered doctor conflicts with primary's doctor
    members = members.filter(m => m.id === primary.id || !areDoctorsConflicting(primary, m));

    // Default primary: prioritize valid coordinates, image, and product count
    const effectivePrimary = members.reduce((best, cur) => {
      const curScore =
        (cur.lat && cur.lng && (cur.lat !== 0 || cur.lng !== 0) ? 50 : 0) +
        (cur.image_url ? 20 : 0) +
        (cur.products?.length || 0) * 5;
      const bestScore =
        (best.lat && best.lng && (best.lat !== 0 || best.lng !== 0) ? 50 : 0) +
        (best.image_url ? 20 : 0) +
        (best.products?.length || 0) * 5;
      return curScore >= bestScore ? cur : best;
    }, primary);

    const secondaryMembers = members.filter(m => m.id !== effectivePrimary.id);

    const allProducts = members.flatMap(m => m.products || []);
    const uniqueProducts = new Map<string, ProductItem>();
    allProducts.forEach(p => {
      if (!uniqueProducts.has(p.name)) uniqueProducts.set(p.name, p);
    });

    const rucs = Array.from(
      new Set(
        members
          .map(m => m.custom_fields?.['Documento'])
          .filter((d): d is string => Boolean(d))
      )
    );

    // Find official GE match specifically for effectivePrimary without conflicts
    const effectiveOfficialGe = findOfficialGeMatch(effectivePrimary);

    // If official GE is valid, keep metadata. If there was a conflicting stored propietario, purge it.
    if (effectiveOfficialGe) {
      effectivePrimary.custom_fields = {
        ...(effectivePrimary.custom_fields || {}),
        crb7e_idge: effectiveOfficialGe.idge,
        crb7e_nombrege: effectiveOfficialGe.nombre,
        crb7e_propietarioge: effectiveOfficialGe.propietario,
        crb7e_rol: effectiveOfficialGe.rol,
      };
    } else if (effectivePrimary.custom_fields) {
      const storedProp = effectivePrimary.custom_fields['crb7e_propietarioge'];
      if (storedProp) {
        const docToks = getDoctorTokens(effectivePrimary);
        const propToks = normalizePersonTokens(storedProp);
        if (docToks.length >= 2 && propToks.length >= 2) {
          const res = evaluatePersonMatch(docToks, propToks);
          if (res.isConflict || !res.isMatch) {
            // Purge contaminated fields in-memory so UI displays true owner
            delete effectivePrimary.custom_fields['crb7e_idge'];
            delete effectivePrimary.custom_fields['crb7e_nombrege'];
            delete effectivePrimary.custom_fields['crb7e_propietarioge'];
            delete effectivePrimary.custom_fields['crb7e_rol'];
          }
        }
      }
    }

    // ── NIVEL 2: Vehículos de Compra (Razones Sociales / RUCs / DNIs) ───────────
    const billingMap = new Map<string, BillingVehicle>();

    // Pre-calculate known valid RUCs/DNIs by normalized legal name across group members
    const knownDocByRs = new Map<string, string>();
    members.forEach(m => {
      const doc = (
        m.custom_fields?.['Documento'] ||
        m.custom_fields?.['RUC'] ||
        m.custom_fields?.['doc'] ||
        ''
      ).replace(/\D/g, '');
      const rs = m.custom_fields?.['Razón Social'] || m.custom_fields?.['Razon Social'] || m.name;
      if (doc && (doc.length === 11 || doc.length === 8)) {
        knownDocByRs.set(normalizeAddress(rs), doc);
      }
    });

    members.forEach(m => {
      let rawDoc = (
        m.custom_fields?.['Documento'] ||
        m.custom_fields?.['RUC'] ||
        m.custom_fields?.['doc'] ||
        ''
      ).replace(/\D/g, '');

      let bName = m.custom_fields?.['Razón Social'] || m.custom_fields?.['Razon Social'] || m.name;

      // Handle known synthetic divergence if an EIRL/SAC has a distinct legal name/RUC
      if (m.id === 'b2c-center-dermabeauty-center-e-i-r-l') {
        rawDoc = '20612515884';
        bName = 'DERMABEAUTY CENTER E.I.R.L.';
      }

      // If rawDoc is missing, infer from another member in the group with the same Razón Social
      if (!rawDoc) {
        const inferred = knownDocByRs.get(normalizeAddress(bName));
        if (inferred) {
          rawDoc = inferred;
        }
      }

      const docNum = rawDoc || (m.custom_fields?.['CMP'] ? `CMP-${cleanCmp(m.custom_fields['CMP'])}` : `ID-${m.id}`);

      let docType: 'RUC 20' | 'RUC 10' | 'DNI' | 'OTRO' = 'OTRO';
      if (rawDoc.length === 11 && rawDoc.startsWith('20')) docType = 'RUC 20';
      else if (rawDoc.length === 11 && rawDoc.startsWith('10')) docType = 'RUC 10';
      else if (rawDoc.length === 8) docType = 'DNI';

      const existing = billingMap.get(docNum);
      const mProds = m.products || [];
      const mQty = mProds.reduce((sum, p) => sum + (p.qty || 0), 0);

      if (existing) {
        existing.totalPurchasedQty += mQty;
        if (!existing.originNames.includes(m.name)) existing.originNames.push(m.name);
        const prodMap = new Map<string, ProductItem>();
        existing.products.forEach(p => prodMap.set(p.name, { ...p }));
        mProds.forEach(p => {
          const ep = prodMap.get(p.name);
          if (ep) {
            ep.qty = (ep.qty || 0) + (p.qty || 0);
            if (p.last_date && (!ep.last_date || p.last_date > ep.last_date)) ep.last_date = p.last_date;
          } else {
            prodMap.set(p.name, { ...p });
          }
        });
        existing.products = Array.from(prodMap.values());
        existing.productsCount = existing.products.length;
      } else {
        billingMap.set(docNum, {
          documentNumber: rawDoc || docNum,
          businessName: bName,
          documentType: docType,
          totalPurchasedQty: mQty,
          productsCount: mProds.length,
          products: [...mProds],
          originNames: [m.name],
        });
      }
    });
    const billingVehicles = Array.from(billingMap.values()).sort((a, b) => b.totalPurchasedQty - a.totalPurchasedQty);

    // ── NIVEL 3: Sedes Físicas (Locales en Plaza Derma) ───────────────────────────
    // Un local físico = una dirección física geográfica real.
    // Varias fichas digitales (B2B, B2C, MedicosBliss, Blissfarma) con la misma
    // dirección o coordenadas corresponden a la MISMA sede física y se consolidan en 1 sola pastilla.
    const physicalSedes: PhysicalSede[] = [];

    const primarySede: PhysicalSede = {
      id: effectivePrimary.id,
      name: effectivePrimary.name,
      address: effectivePrimary.address || 'Dirección no registrada',
      lat: effectivePrimary.lat || 0,
      lng: effectivePrimary.lng || 0,
      isPrimary: true,
      phone: effectivePrimary.phone || null,
      locatorSlug: effectivePrimary.custom_fields?.['_locator_slug'],
      brandingInherited: false,
      staffCount: 0,
    };
    physicalSedes.push(primarySede);

    secondaryMembers.forEach(sm => {
      // 1. Si es una dirección genérica de ciudad (ej. "Lima, Perú" o sin calle ni número),
      // no constituye un establecimiento físico presencial independiente.
      if (isGenericCityAddress(sm.address)) {
        return;
      }

      // 2. Comprobar si corresponde a alguna sede física ya registrada (Sede Principal u otra sede)
      const existingSede = physicalSedes.find(ps =>
        isSamePhysicalVenue(ps.address, sm.address, ps.lat, ps.lng, sm.lat, sm.lng)
      );

      if (existingSede) {
        if (!existingSede.phone && sm.phone) existingSede.phone = sm.phone;
        if ((!existingSede.lat || !existingSede.lng) && sm.lat && sm.lng) {
          existingSede.lat = sm.lat;
          existingSede.lng = sm.lng;
        }
        return;
      }

      // 3. Es una dirección física real distinta (otra sucursal / local en otra calle):
      physicalSedes.push({
        id: sm.id,
        name: sm.name,
        address: sm.address || 'Dirección no registrada',
        lat: sm.lat || 0,
        lng: sm.lng || 0,
        isPrimary: false,
        phone: sm.phone || null,
        locatorSlug: sm.custom_fields?.['_locator_slug'],
        brandingInherited: !sm.image_url || sm.image_url === effectivePrimary.image_url,
        staffCount: 0,
      });
    });

    // ── NIVEL 4: Staff Médico Afiliado (N:M) ──────────────────────────────────────
    const staffMap = new Map<string, AffiliatedDoctorStaff>();
    const addDoctor = (doc: Partial<LocationItem> & { id: string; name: string }, assignedSedeName: string) => {
      let docCmp = cleanCmp(doc.custom_fields?.['CMP'] || doc.custom_fields?.['Colegiatura']);
      let docName = doc.name;

      // If CMP is missing, try resolving from official master catalog by name
      if (!docCmp) {
        const official = findDoctorByName(docName);
        if (official) {
          docCmp = official.cmp;
          docName = official.name;
        }
      } else {
        const official = findDoctorByCmp(docCmp);
        if (official && (!docName || docName === 'Médico' || docName.toLowerCase().startsWith('consultorio'))) {
          docName = official.name;
        }
      }

      const key = docCmp ? `CMP-${docCmp}` : doc.id;
      const existing = staffMap.get(key);
      if (existing) {
        if (assignedSedeName && !existing.assignedSedes.includes(assignedSedeName)) {
          existing.assignedSedes.push(assignedSedeName);
        }
      } else {
        const others = (doc.linked_entities || [])
          .filter(le => !physicalSedes.some(s => s.id === le.id || isSamePhysicalVenue(s.address, le.address, s.lat, s.lng, le.lat, le.lng)))
          .map(le => le.name);

        staffMap.set(key, {
          id: doc.id,
          name: docName,
          cmp: docCmp ? `CMP ${docCmp}` : undefined,
          rne: doc.custom_fields?.['RNE'] || undefined,
          specialty: doc.custom_fields?.['Interés en'] || doc.custom_fields?.['Especialidad'] || undefined,
          photoUrl: doc.image_url || null,
          assignedSedes: assignedSedeName ? [assignedSedeName] : [],
          otherCenters: others,
        });
      }
    };

    const parseIdListHelper = (val: any): string[] => {
      if (!val) return [];
      if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
          } catch {
            // fallback
          }
        }
        return trimmed.split(/[,;\n]+/).map(v => v.trim()).filter(Boolean);
      }
      return [];
    };

    members.forEach(m => {
      const matchedSede = physicalSedes.find(s => isSamePhysicalVenue(s.address, m.address, s.lat, s.lng, m.lat, m.lng)) || physicalSedes[0];
      const targetSedeName = matchedSede ? matchedSede.name : effectivePrimary.name;

      // 1. Doctor as standalone member
      if (!isCorporateCenter(m)) {
        addDoctor(m, targetSedeName);
      }

      // 2. Doctors in linked_entities
      (m.linked_entities || []).forEach(le => {
        if (!isCorporateCenter(le)) {
          addDoctor(le, targetSedeName);
        }
      });

      // 3. Doctors explicitly assigned via medicos_afiliados_ids in custom_fields
      const affiliatedIds = parseIdListHelper(m.custom_fields?.['medicos_afiliados_ids']);
      affiliatedIds.forEach(affId => {
        const foundInList = list.find(
          l => l.id === affId || cleanCmp(l.custom_fields?.['CMP']) === cleanCmp(affId)
        );
        if (foundInList && !isCorporateCenter(foundInList)) {
          addDoctor(foundInList, targetSedeName);
          return;
        }

        const official = findDoctorByCmp(affId) || officialDoctors.find(od => od.crm_id === affId);
        if (official) {
          addDoctor({
            id: `b2c-cmp-${official.cmp}`,
            name: official.name,
            address: m.address,
            tags: ['Médico Oficial'],
            custom_fields: {
              CMP: official.cmp,
              entity_type: 'doctor',
              'Nombre Comercial': official.name,
            }
          }, targetSedeName);
        }
      });

      // 4. Primary registered doctor on the location if present
      const docNameRaw = m.custom_fields?.['Médico'] || m.custom_fields?.['Doctor'] || m.custom_fields?.['Médicos'];
      const docCmpRaw = m.custom_fields?.['CMP'] || m.custom_fields?.['Colegiatura'];
      if (docNameRaw || docCmpRaw) {
        // Do NOT split on commas! In Peru, doctor names format is "Apellidos, Nombres" (e.g. "Veliz Barandiaran, Jose Luis").
        // Comma splits last names from given names. Only split on semicolon or newline if multiple doctors are explicitly listed.
        const docNames = docNameRaw && docNameRaw.includes(';')
          ? docNameRaw.split(/[;\n]+/).map(n => n.trim()).filter(n => n.length > 2)
          : [docNameRaw].filter(Boolean);

        docNames.forEach(dName => {
          const official = docCmpRaw ? findDoctorByCmp(docCmpRaw) : (dName ? findDoctorByName(dName) : undefined);
          const resolvedName = official ? official.name : (dName || 'Médico');
          const resolvedCmp = official ? official.cmp : (docCmpRaw ? cleanCmp(docCmpRaw) : undefined);
          addDoctor({
            id: resolvedCmp ? `b2c-cmp-${resolvedCmp}` : `doc-${m.id}`,
            name: resolvedName,
            address: m.address,
            tags: ['Médico'],
            custom_fields: {
              CMP: resolvedCmp || '',
              entity_type: 'doctor',
              'Nombre Comercial': resolvedName,
            }
          }, targetSedeName);
        });
      }
    });

    const medicalStaff = Array.from(staffMap.values());
    physicalSedes.forEach(sede => {
      sede.staffCount = medicalStaff.filter(doc => doc.assignedSedes.includes(sede.name)).length;
    });

    activeGroups.push({
      primary: effectivePrimary,
      members,
      secondaryMembers,
      totalProducts: uniqueProducts.size,
      combinedProducts: Array.from(uniqueProducts.values()),
      rucs,
      officialGe: effectiveOfficialGe,
      billingVehicles,
      physicalSedes,
      medicalStaff,
    });
  }

  return activeGroups;
};

/**
 * Unify an economic group by setting grupo_economico_ids on the chosen primary location
 * and persisting official CRM metadata in custom_fields.
 */
export const unifyEconomicGroup = async (
  activeLocatorId: string,
  group: SuggestedGroup,
  chosenPrimaryId?: string
): Promise<void> => {
  let effectivePrimaryId = chosenPrimaryId || group.primaryId;
  const allTargetIds = new Set<string>(group.ids);

  // If this group corresponds to an official CRM GE, merge with any existing active primary for that GE
  if (group.officialGe) {
    try {
      const { data: existingRows } = await supabase
        .from('bm_locations')
        .select('id, grupo_economico_ids, custom_fields')
        .not('grupo_economico_ids', 'is', null);

      const matchedExisting = existingRows?.find(
        r => r.custom_fields?.['crb7e_idge'] === group.officialGe!.idge &&
             r.grupo_economico_ids &&
             r.grupo_economico_ids.length > 0
      );

      if (matchedExisting) {
        matchedExisting.grupo_economico_ids.forEach((id: string) => allTargetIds.add(id));
        allTargetIds.add(matchedExisting.id);
        if (!chosenPrimaryId) {
          effectivePrimaryId = matchedExisting.id;
        }
      }
    } catch (checkErr) {
      console.warn('Notice checking existing GE rows in DB:', checkErr);
    }
  }

  const primary = group.members.find(m => m.id === effectivePrimaryId) || group.members[0];

  const customFields: Record<string, string> = { ...(primary.custom_fields || {}) };
  if (group.officialGe) {
    customFields['crb7e_idge'] = group.officialGe.idge;
    customFields['crb7e_nombrege'] = group.officialGe.nombre;
    customFields['crb7e_propietarioge'] = group.officialGe.propietario;
    customFields['crb7e_rol'] = group.officialGe.rol;
  }

  const primaryLocatorId = primary.locator_id || activeLocatorId;
  const finalIdsList = Array.from(allTargetIds);

  const payload: any = {
    id: primary.id,
    locator_id: primaryLocatorId,
    name: primary.name,
    address: primary.address,
    lat: primary.lat ?? 0,
    lng: primary.lng ?? 0,
    image_url: primary.image_url || null,
    custom_fields: customFields,
    published: primary.published !== false,
    grupo_economico_ids: finalIdsList,
  };

  const { error } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;

  // Propagate official GE metadata to all secondary members preserving their locator_id
  if (group.officialGe) {
    const secondaries = group.members.filter(m => m.id !== primary.id);
    for (const sec of secondaries) {
      const secFields: Record<string, string> = { ...(sec.custom_fields || {}) };
      secFields['crb7e_idge'] = group.officialGe.idge;
      secFields['crb7e_nombrege'] = group.officialGe.nombre;
      secFields['crb7e_propietarioge'] = group.officialGe.propietario;
      secFields['crb7e_rol'] = group.officialGe.rol;

      const secLocatorId = sec.locator_id || activeLocatorId;

      await supabase
        .from('bm_locations')
        .upsert({
          id: sec.id,
          locator_id: secLocatorId,
          name: sec.name,
          address: sec.address,
          lat: sec.lat ?? 0,
          lng: sec.lng ?? 0,
          image_url: sec.image_url || null,
          custom_fields: secFields,
          published: sec.published !== false,
          grupo_economico_ids: null,
        }, { onConflict: 'id' });
    }
  }
};

/**
 * Batch unify an array of official CRM suggested groups sequentially.
 */
export const batchUnifyOfficialGroups = async (
  activeLocatorId: string,
  groups: SuggestedGroup[],
  onProgress?: (completed: number, total: number, currentName: string) => void
): Promise<{ successCount: number; errors: Array<{ name: string; error: string }> }> => {
  let successCount = 0;
  const errors: Array<{ name: string; error: string }> = [];

  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    if (onProgress) {
      onProgress(i, groups.length, group.name);
    }
    try {
      await unifyEconomicGroup(activeLocatorId, group);
      successCount++;
    } catch (err: any) {
      errors.push({ name: group.name, error: err.message || 'Error desconocido' });
    }
  }

  if (onProgress) {
    onProgress(groups.length, groups.length, 'Completado');
  }

  return { successCount, errors };
};

/**
 * Batch enrich active groups that have matched official CRM metadata
 * but haven't saved crb7e_idge in their primary location's custom_fields yet.
 */
export const batchEnrichActiveGroups = async (
  activeLocatorId: string,
  activeGroups: ActiveGroup[],
  onProgress?: (completed: number, total: number, currentName: string) => void
): Promise<{ successCount: number; errors: Array<{ name: string; error: string }> }> => {
  let successCount = 0;
  const errors: Array<{ name: string; error: string }> = [];

  const toEnrich = activeGroups.filter(
    g => g.officialGe && !g.primary.custom_fields?.['crb7e_idge']
  );

  for (let i = 0; i < toEnrich.length; i++) {
    const group = toEnrich[i];
    if (onProgress) {
      onProgress(i, toEnrich.length, group.primary.name);
    }
    try {
      const primary = group.primary;
      const officialGe = group.officialGe!;

      const geFields = {
        crb7e_idge: officialGe.idge,
        crb7e_nombrege: officialGe.nombre,
        crb7e_propietarioge: officialGe.propietario,
        crb7e_rol: officialGe.rol,
      };

      // Collect all candidate database IDs
      const candidateIds = new Set<string>();
      if (primary.custom_fields?.['db_id']) candidateIds.add(primary.custom_fields['db_id']);
      candidateIds.add(primary.id);
      group.members.forEach(m => {
        if (m.custom_fields?.['db_id']) candidateIds.add(m.custom_fields['db_id']);
        candidateIds.add(m.id);
      });

      // Update all matching rows in Supabase bm_locations
      const idList = Array.from(candidateIds);
      const { data: dbRows, error: fetchErr } = await supabase
        .from('bm_locations')
        .select('*')
        .in('id', idList);

      if (fetchErr) throw fetchErr;

      if (dbRows && dbRows.length > 0) {
        for (const row of dbRows) {
          const updatedCustomFields = {
            ...(row.custom_fields || {}),
            ...geFields,
          };
          const { error: updateErr } = await supabase
            .from('bm_locations')
            .update({ custom_fields: updatedCustomFields })
            .eq('id', row.id);

          if (updateErr) throw updateErr;
        }
      } else {
        // Fallback: upsert primary
        const targetDbId = primary.custom_fields?.['db_id'] || primary.id;
        const targetLocatorId = primary.locator_id || activeLocatorId;
        const customFields = {
          ...(primary.custom_fields || {}),
          ...geFields,
        };

        const payload: Record<string, unknown> = {
          id: targetDbId,
          locator_id: targetLocatorId,
          name: primary.name,
          address: primary.address,
          lat: primary.lat ?? 0,
          lng: primary.lng ?? 0,
          image_url: primary.image_url || null,
          custom_fields: customFields,
          published: primary.published !== false,
          grupo_economico_ids: primary.grupo_economico_ids || group.members.map(m => m.id),
        };

        const { error: upsertErr } = await supabase
          .from('bm_locations')
          .upsert(payload, { onConflict: 'id' });

        if (upsertErr) throw upsertErr;
      }

      // Update in-memory primary custom_fields
      primary.custom_fields = {
        ...(primary.custom_fields || {}),
        ...geFields,
      };

      successCount++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      errors.push({ name: group.primary.name, error: msg });
    }
  }

  if (onProgress) {
    onProgress(toEnrich.length, toEnrich.length, 'Completado');
  }

  return { successCount, errors };
};

/**
 * Update the primary entity of an active economic group.
 * Removes grupo_economico_ids from the previous primary and assigns it to the new primary.
 */
export const updateGroupPrimary = async (
  activeLocatorId: string,
  oldPrimary: LocationItem,
  newPrimary: LocationItem,
  allMemberIds: string[]
): Promise<void> => {
  if (oldPrimary.id === newPrimary.id) {
    return;
  }

  const memberIdsSet = new Set(allMemberIds);
  memberIdsSet.add(oldPrimary.id);
  memberIdsSet.add(newPrimary.id);
  const updatedIds = Array.from(memberIdsSet);

  // 1. Remove grupo_economico_ids from old primary
  const { error: removeErr } = await supabase
    .from('bm_locations')
    .update({ grupo_economico_ids: null })
    .eq('id', oldPrimary.id);

  if (removeErr) throw removeErr;

  // 2. Assign grupo_economico_ids to the new primary, preserving any official CRM GE fields
  const newCustomFields: Record<string, string> = { ...(newPrimary.custom_fields || {}) };
  if (oldPrimary.custom_fields?.['crb7e_idge']) {
    newCustomFields['crb7e_idge'] = oldPrimary.custom_fields['crb7e_idge'];
    if (oldPrimary.custom_fields['crb7e_nombrege']) newCustomFields['crb7e_nombrege'] = oldPrimary.custom_fields['crb7e_nombrege'];
    if (oldPrimary.custom_fields['crb7e_propietarioge']) newCustomFields['crb7e_propietarioge'] = oldPrimary.custom_fields['crb7e_propietarioge'];
    if (oldPrimary.custom_fields['crb7e_rol']) newCustomFields['crb7e_rol'] = oldPrimary.custom_fields['crb7e_rol'];
  }

  const payload: any = {
    id: newPrimary.id,
    locator_id: newPrimary.locator_id || activeLocatorId,
    name: newPrimary.name,
    address: newPrimary.address || oldPrimary.address,
    lat: (newPrimary.lat && newPrimary.lat !== 0) ? newPrimary.lat : (oldPrimary.lat ?? 0),
    lng: (newPrimary.lng && newPrimary.lng !== 0) ? newPrimary.lng : (oldPrimary.lng ?? 0),
    image_url: newPrimary.image_url || null,
    custom_fields: newCustomFields,
    published: newPrimary.published !== false,
    grupo_economico_ids: updatedIds,
  };

  const { error: upsertErr } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (upsertErr) throw upsertErr;
};

/**
 * Dissolve an existing economic group by removing grupo_economico_ids.
 */
export const dissolveEconomicGroup = async (primaryId: string): Promise<void> => {
  const { error } = await supabase
    .from('bm_locations')
    .update({ grupo_economico_ids: null })
    .eq('id', primaryId);

  if (error) throw error;
};

/**
 * Manually create a new economic group with a specified primary and member list.
 */
export const createManualGroup = async (
  activeLocatorId: string,
  primary: LocationItem,
  memberIds: string[]
): Promise<void> => {
  const memberIdsSet = new Set(memberIds);
  memberIdsSet.add(primary.id);
  const finalIds = Array.from(memberIdsSet);

  const payload: any = {
    id: primary.id,
    locator_id: primary.locator_id || activeLocatorId,
    name: primary.name,
    address: primary.address,
    lat: primary.lat ?? 0,
    lng: primary.lng ?? 0,
    image_url: primary.image_url || null,
    custom_fields: primary.custom_fields || {},
    published: primary.published !== false,
    grupo_economico_ids: finalIds,
  };

  const { error } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
};
