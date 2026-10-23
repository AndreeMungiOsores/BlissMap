/**
 * b2cApiService.ts
 * Fetches doctor and medical center data from the BlissFarma B2C ERP API
 * (endpoint: /e/action/33_json/16_vtab2cmed/receive).
 *
 * Produces LocationItem[] compatible with the existing B2B shape so that
 * PublicLocator.tsx can consume both without branching in the render layer.
 *
 * Entity types:
 *   - 'doctor'  → comes from medicos[] in the API response.
 *   - 'center'  → comes from centros_trabajo[] in the API response.
 *
 * Filtering:
 *   Only entities associated with at least one product whose SKU starts with
 *   'BF' (BlissFarma catalogue) are included.
 *
 * Deduplication (cross-source):
 *   Use deduplicateWithB2B(b2cLocations, b2bLocations) to remove B2B entries
 *   that are substantially the same as a B2C entry (by name+address bigram similarity).
 */

import { toTitleCase, cleanSpanishText, getDynamicDateRange } from './b2bApiService';
import type { LocationItem, ProductItem } from './b2bApiService';
import { nameSimilarity } from '../utils/stringUtils';
import productImagesMap from '../data/product_images_map.json';
import apiGeocodedCoords from '../data/api_geocoded_coords.json';
import excelGeocodedOverrides from '../data/excel_geocoded_overrides.json';
import localDoctorsData from '../data/doctors_data.json';
import localB2CData from '../data/b2c_data.json';

// ─── Constants ───────────────────────────────────────────────────────────────

const B2C_API_BASE = '/api/b2c-erp';
const B2C_API_DIRECT = 'https://blisscorp.niuxpro.com/e/action/33_json/16_vtab2cmed/receive';
const API_KEY = 'TV1_TST0001_pqXvN0a1b2c3d4e5f7';
/** Default Lima coordinates for placeholder filtering. */
const DEFAULT_LAT = -12.046374;
const DEFAULT_LNG = -77.042793;
const CACHE_KEY_B2C = 'blissmap_b2c_api_v7';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Raw API response types ───────────────────────────────────────────────────

interface B2CMedico {
  empresa: string;
  cmp: string;
  medico: string;
  nro_doc_med: string;
  telefono: string;
  direccion: string;
  foto_url: string;
  pacientes: number;
}

interface B2CCentro {
  empresa: string;
  cmp: string;
  centro: string;
  direccion_centro: string;
}

interface B2CDetalle {
  empresa: string;
  cmp: string;
  sku: string;
  producto: string;
  marca?: string;
  cantidad: number;
  ultima_compra: string;
}

interface B2CApiResponse {
  status: string;
  medicos?: B2CMedico[];
  centros_trabajo?: B2CCentro[];
  detalle?: B2CDetalle[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns true if the SKU belongs to the BlissFarma catalogue (BF prefix). */
const isBlissfarmaProduct = (sku: string, marca?: string): boolean => {
  if ((sku || '').trim().toUpperCase().startsWith('BF')) return true;
  if ((marca || '').trim().toUpperCase() === 'BLISSFARMA') return true;
  return false;
};

/** Slug-safe string for building stable IDs. */
const toSlug = (str: string): string =>
  str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

/** Build a ProductItem from a B2C detalle record. */
const buildProduct = (
  d: B2CDetalle,
  bySkuMap: Record<string, string>,
  byNameMap: Record<string, string>
): ProductItem => {
  const cleanName = cleanSpanishText(d.producto);
  const cleanNameKey = cleanName
    .toLowerCase()
    .replace(/\s+/g, '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const imgUrl = bySkuMap[d.sku] || byNameMap[cleanNameKey] || undefined;

  return {
    name: cleanName,
    qty: Number(d.cantidad) || 1,
    last_date: d.ultima_compra,
    sku: d.sku,
    brand: d.marca || 'BlissFarma',
    image_url: imgUrl,
    empresa: d.empresa,
  };
};

// ─── Geocoded reference indexing & resolution ─────────────────────────────────

interface GeocodedReference {
  name: string;
  address: string;
  lat: number;
  lng: number;
  doc: string;
}

/**
 * Builds a unified lookup list of known coordinates from B2B datasets:
 * - doctors_data.json
 * - excel_geocoded_overrides.json
 * - api_geocoded_coords.json
 */
const buildKnownGeocodedIndex = (): GeocodedReference[] => {
  const index: GeocodedReference[] = [];

  // 1. Doctors data base
  if (Array.isArray(localDoctorsData)) {
    for (const d of localDoctorsData as LocationItem[]) {
      if (d.lat && d.lng && (d.lat !== DEFAULT_LAT || d.lng !== DEFAULT_LNG)) {
        index.push({
          name: d.name || '',
          address: d.address || '',
          lat: d.lat,
          lng: d.lng,
          doc: (d.custom_fields?.['Documento'] || '').replace(/\D/g, '')
        });
      }
    }
  }

  // 2. Excel geocoded overrides
  const excelMap = excelGeocodedOverrides as Record<string, { address?: string; lat?: number; lng?: number }>;
  for (const [doc, val] of Object.entries(excelMap)) {
    if (val && val.lat && val.lng) {
      index.push({
        name: '',
        address: val.address || '',
        lat: val.lat,
        lng: val.lng,
        doc: doc.replace(/\D/g, '')
      });
    }
  }

  // 3. API geocoded coords
  const apiMap = apiGeocodedCoords as Record<string, { lat: number; lng: number }>;
  for (const [doc, coords] of Object.entries(apiMap)) {
    if (coords && coords.lat && coords.lng) {
      index.push({
        name: '',
        address: '',
        lat: coords.lat,
        lng: coords.lng,
        doc: doc.replace(/\D/g, '')
      });
    }
  }

  return index;
};

/**
 * Matches street name and building/street number even if administrative tokens differ.
 * e.g., 'CAL. TARATA NRO. 294 INT. 4 URB. LEURO' matches 'Calle Tarata 294, Miraflores, Perú'
 */
const matchStreetAndNumber = (addr1: string, addr2: string): boolean => {
  if (!addr1 || !addr2) return false;
  const norm = (s: string) => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(calle|cal|cl|av|avenida|jr|jiron|pasaje|psje|nro|numero|int|interior|dpto|departamento|urb|urbanizacion|lote|mza|mz|piso|of|oficina)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const tokens1 = norm(addr1).split(' ').filter(Boolean);
  const tokens2 = norm(addr2).split(' ').filter(Boolean);
  const nums1 = tokens1.filter(t => /^\d+$/.test(t) && t.length >= 2);
  const words1 = tokens1.filter(t => !/^\d+$/.test(t) && t.length >= 4);
  const nums2 = new Set(tokens2.filter(t => /^\d+$/.test(t)));
  const words2 = new Set(tokens2.filter(t => !/^\d+$/.test(t)));
  return nums1.some(n => nums2.has(n)) && words1.some(w => words2.has(w));
};

/**
 * Strips legal entity tokens and generic health business keywords to isolate the unique distinctive name.
 */
const cleanCorporateName = (str: string): string => {
  return (str || '')
    .toUpperCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(S\.?A\.?C\.?|S\.?A\.?|E\.?I\.?R\.?L\.?|S\.?R\.?L\.?|SOCIEDAD ANONIMA CERRADA|SOCIEDAD ANONIMA|CORPORACION MEDICA|CENTRO MEDICO|POLICLINICO|CLINICA|CONSULTORIO|ASOCIACION|GRUPO)\b/g, '')
    .replace(/[^A-Z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Fallback to match street name and urbanización/city when house numbers differ or are missing.
 */
const matchStreetNameFallback = (addr1: string, addr2: string): boolean => {
  if (!addr1 || !addr2) return false;
  const norm = (s: string) => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(calle|cal|cl|av|avenida|jr|jiron|pasaje|psje|nro|numero|int|interior|dpto|departamento|urb|urbanizacion|lote|mza|mz|piso|of|oficina)\b\.?/g, ' ')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const words1 = norm(addr1).split(' ').filter(t => !/^\d+$/.test(t) && t.length >= 4);
  const words2 = new Set(norm(addr2).split(' ').filter(t => !/^\d+$/.test(t)));
  const matched = words1.filter(w => words2.has(w));
  return matched.length >= 2;
};

/**
 * Resolves coordinates for a B2C medical center by comparing against known B2B coordinates
 * using exact street & number, distinctive corporate name, high address similarity, or street-name fallback.
 */
const resolveCenterCoordinates = (
  centroName: string,
  direccionCentro: string,
  knownIndex: GeocodedReference[]
): { lat: number; lng: number } | null => {
  // 1. Street and Number match (highest precision)
  if (direccionCentro) {
    for (const item of knownIndex) {
      if (item.address && matchStreetAndNumber(direccionCentro, item.address)) {
        return { lat: item.lat, lng: item.lng };
      }
    }
  }

  // 2. High distinctive name similarity (after stripping generic corporate stop-words)
  const cleanName = cleanCorporateName(centroName);
  if (cleanName.length >= 4) {
    let bestNameMatch: GeocodedReference | null = null;
    let bestNameScore = 0;
    for (const item of knownIndex) {
      if (!item.name) continue;
      const itemClean = cleanCorporateName(item.name);
      if (itemClean.length < 4) continue;
      const sim = nameSimilarity(cleanName, itemClean);
      if (sim > bestNameScore) {
        bestNameScore = sim;
        bestNameMatch = item;
      }
    }
    // High threshold of 0.82 prevents generic corporate cross-matches across different cities
    if (bestNameScore >= 0.82 && bestNameMatch) {
      return { lat: bestNameMatch.lat, lng: bestNameMatch.lng };
    }
  }

  // 3. High address similarity (>= 0.82)
  if (direccionCentro) {
    let bestAddrMatch: GeocodedReference | null = null;
    let bestAddrScore = 0;
    for (const item of knownIndex) {
      if (!item.address) continue;
      const simAddr = nameSimilarity(direccionCentro, item.address);
      if (simAddr > bestAddrScore) {
        bestAddrScore = simAddr;
        bestAddrMatch = item;
      }
    }
    if (bestAddrScore >= 0.82 && bestAddrMatch) {
      return { lat: bestAddrMatch.lat, lng: bestAddrMatch.lng };
    }
  }

  // 4. Street name + Urbanización match on same street
  if (direccionCentro) {
    for (const item of knownIndex) {
      if (item.address && matchStreetNameFallback(direccionCentro, item.address)) {
        return { lat: item.lat, lng: item.lng };
      }
    }
  }

  return null;
};

/**
 * Resolves coordinates for a B2C doctor:
 * 1. If center coordinates exist, doctor inherits them (workplace location).
 * 2. If doctor document (DNI/RUC) matches an exact document in knownIndex.
 * 3. If doctor name matches a known doctor with high similarity (>= 0.75).
 */
const resolveDoctorCoordinates = (
  medicoName: string,
  nroDocMed: string,
  centroCoords: { lat: number; lng: number } | null,
  knownIndex: GeocodedReference[]
): { lat: number; lng: number } | null => {
  // 1. Inherit from center of work if available
  if (centroCoords) {
    return centroCoords;
  }

  const cleanDoc = (nroDocMed || '').replace(/\D/g, '');
  // 2. Exact match by document number (DNI / RUC)
  if (cleanDoc.length >= 8) {
    for (const item of knownIndex) {
      if (item.doc && item.doc === cleanDoc) {
        return { lat: item.lat, lng: item.lng };
      }
    }
  }

  // 3. Match by doctor name similarity
  if (medicoName) {
    let bestMatch: GeocodedReference | null = null;
    let bestScore = 0;

    for (const item of knownIndex) {
      if (item.name) {
        const sim = nameSimilarity(medicoName, item.name);
        if (sim > bestScore) {
          bestScore = sim;
          bestMatch = item;
        }
      }
    }

    if (bestScore >= 0.75 && bestMatch) {
      return { lat: bestMatch.lat, lng: bestMatch.lng };
    }
  }

  return null;
};

// ─── Main fetch function ──────────────────────────────────────────────────────

export interface B2CLocationsResult {
  doctors: LocationItem[];
  centers: LocationItem[];
  source: 'live_api' | 'cache' | 'empty';
}

/**
 * Fetches BlissFarma B2C data and returns two arrays:
 *   - doctors: one LocationItem per unique CMP (médico individual).
 *   - centers: one LocationItem per unique centro associated with a CMP that has BF products.
 *
 * Both arrays only include entities with at least one BlissFarma product.
 * Both arrays have entity_type set in custom_fields ('doctor' | 'center').
 */
export const fetchB2CLocations = async (): Promise<B2CLocationsResult> => {
  // ── 1. Serve from cache if fresh ──────────────────────────────────────────
  try {
    const cachedStr = localStorage.getItem(CACHE_KEY_B2C);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      const isFresh = (Date.now() - cached.timestamp) < CACHE_TTL_MS;
      if (
        isFresh &&
        Array.isArray(cached.doctors) &&
        Array.isArray(cached.centers) &&
        (cached.doctors.length > 0 || cached.centers.length > 0)
      ) {
        console.log(`[B2C API] Cache hit — ${cached.doctors.length} doctors, ${cached.centers.length} centers.`);
        return { doctors: cached.doctors, centers: cached.centers, source: 'cache' };
      }
    }
  } catch {
    // ignore cache read errors
  }

  // ── 2. Fetch live ─────────────────────────────────────────────────────────
  const { fechaDesde, fechaHasta } = getDynamicDateRange();
  const queryStr = `?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`;

  let payload: B2CApiResponse;
  try {
    let response: Response;
    try {
      response = await fetch(`${B2C_API_BASE}${queryStr}`, {
        method: 'GET',
        headers: { 'X-Api-Key': API_KEY, Accept: 'application/json' },
      });
    } catch {
      response = await fetch(`${B2C_API_DIRECT}${queryStr}`, {
        method: 'GET',
        headers: { 'X-Api-Key': API_KEY, Accept: 'application/json' },
      });
    }

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('iso-8859-1');
    payload = JSON.parse(decoder.decode(buffer)) as B2CApiResponse;

    if (payload.status !== 'OK') throw new Error(`API status: ${payload.status}`);
  } catch (err) {
    console.warn('[B2C API] Fetch failed, falling back to bundled data:', err);
    payload = localB2CData as unknown as B2CApiResponse;
  }

  const rawMedicos = payload.medicos || [];
  const rawCentros = payload.centros_trabajo || [];
  const rawDetalle = payload.detalle || [];

  const bySkuMap = (productImagesMap as Record<string, Record<string, string>>).by_sku || {};
  const byNameMap = (productImagesMap as Record<string, Record<string, string>>).by_name || {};

  // ── 3. Build product map keyed by CMP ────────────────────────────────────
  // Key: cmp → ProductItem[] (only BlissFarma products)
  const productsByCmp = new Map<string, ProductItem[]>();

  rawDetalle.forEach(d => {
    const cmp = (d.cmp || '').trim();
    if (!cmp) return;
    if (!isBlissfarmaProduct(d.sku, d.marca)) return;

    const prod = buildProduct(d, bySkuMap, byNameMap);
    const existing = productsByCmp.get(cmp) || [];
    // Deduplicate by name within the same CMP
    if (!existing.some(p => p.name === prod.name)) {
      existing.push(prod);
    }
    productsByCmp.set(cmp, existing);
  });

  // ── 4. Build known geocoded index and pre-resolve centers ─────────────────
  const knownIndex = buildKnownGeocodedIndex();

  // PASS A: Group all CMPs by normalized centro name to resolve center coordinates first
  interface CentroGroup {
    rawCentro: B2CCentro;
    cmps: string[];
  }
  const centroGroupsByKey = new Map<string, CentroGroup>();
  const centerCoordsByKey = new Map<string, { lat: number; lng: number }>();

  rawCentros.forEach(c => {
    const cmp = (c.cmp || '').trim();
    const centroName = (c.centro || '').trim();
    if (!cmp || !centroName) return;

    // Only include centers whose associated doctor has BlissFarma products
    const products = productsByCmp.get(cmp);
    if (!products || products.length === 0) return;

    const key = toSlug(centroName);
    const existing = centroGroupsByKey.get(key);
    if (existing) {
      if (!existing.cmps.includes(cmp)) {
        existing.cmps.push(cmp);
      }
    } else {
      centroGroupsByKey.set(key, { rawCentro: c, cmps: [cmp] });
    }
  });

  // Resolve coordinates for each unique center
  centroGroupsByKey.forEach((group, key) => {
    const name = (group.rawCentro.centro || '').trim();
    const dir = (group.rawCentro.direccion_centro || '').trim();
    let resolved = resolveCenterCoordinates(name, dir, knownIndex);

    // Fallback: Check if any doctor practicing in this center has known geocoded coordinates
    if (!resolved && group.cmps.length > 0) {
      for (const cmp of group.cmps) {
        const med = rawMedicos.find(m => (m.cmp || '').trim() === cmp);
        if (med) {
          const docResolved = resolveDoctorCoordinates(med.medico || '', med.nro_doc_med || '', null, knownIndex);
          if (docResolved) {
            resolved = docResolved;
            break;
          }
        }
      }
    }

    if (resolved) {
      centerCoordsByKey.set(key, resolved);
    }
  });

  // ── 5. Build doctors ──────────────────────────────────────────────────────
  // One LocationItem per unique CMP. Doctors inherit coordinates from their center
  // or match against known B2B doctors by document / name similarity.
  const doctorsByCmp = new Map<string, LocationItem>();

  // Map centros per CMP for address fallback and coordinate inheritance
  const centrosByCmp = new Map<string, B2CCentro[]>();
  rawCentros.forEach(c => {
    const cmp = (c.cmp || '').trim();
    if (!cmp) return;
    const list = centrosByCmp.get(cmp) || [];
    list.push(c);
    centrosByCmp.set(cmp, list);
  });

  rawMedicos.forEach((med) => {
    const cmp = (med.cmp || '').trim();
    if (!cmp) return;

    // Only include doctors linked to BlissFarma products
    const products = productsByCmp.get(cmp);
    if (!products || products.length === 0) return;

    const existing = doctorsByCmp.get(cmp);
    if (existing) {
      // Accumulate pacientes across empresas
      const prev = Number(existing.custom_fields?.['Pacientes BlissFarma'] || 0);
      existing.custom_fields = {
        ...existing.custom_fields,
        'Pacientes BlissFarma': String(prev + med.pacientes),
      };
      return;
    }

    // Resolve best address: use doctor's own direccion, fallback to first centro address
    const centros = centrosByCmp.get(cmp) || [];
    const centroAddress = centros.find(c => c.direccion_centro?.trim())?.direccion_centro || '';
    const rawAddress = (med.direccion || '').trim() || centroAddress;
    const address = cleanSpanishText(rawAddress) || 'Lima, Perú';

    // Resolve coordinates: check all associated centers, then doctor document/name
    let centroCoords: { lat: number; lng: number } | null = null;
    for (const c of centros) {
      const k = toSlug((c.centro || '').trim());
      const coords = centerCoordsByKey.get(k);
      if (coords) {
        centroCoords = coords;
        break;
      }
    }
    const resolvedDoctorCoords = resolveDoctorCoordinates(
      med.medico || '',
      med.nro_doc_med || '',
      centroCoords,
      knownIndex
    );

    const hasExactCoords = resolvedDoctorCoords !== null;
    const lat = hasExactCoords ? resolvedDoctorCoords.lat : 0;
    const lng = hasExactCoords ? resolvedDoctorCoords.lng : 0;

    const cleanName = toTitleCase(med.medico || `Médico CMP ${cmp}`);
    const fotoUrl = (med.foto_url || '').trim() || null;

    const locationItem: LocationItem = {
      id: `b2c-cmp-${cmp}`,
      name: cleanName,
      image_url: fotoUrl,
      address,
      phone: (med.telefono || '').trim() || null,
      email: null,
      website: null,
      facebook: null,
      instagram: null,
      lat,
      lng,
      tags: [
        'Médico',
        'BlissFarma B2C',
        ...(hasExactCoords ? [] : ['Sin ubicación exacta']),
      ],
      custom_fields: {
        'CMP': cmp,
        'RNE': (med as any).rne || (med as any).RNE || '',
        'Graduado en': (med as any).graduado_en || (med as any).universidad || '',
        'Interés en': (med as any).interes_en || (med as any).especialidad || '',
        'Documento': (med.nro_doc_med || '').trim(),
        'Pacientes BlissFarma': String(med.pacientes),
        'entity_type': 'doctor',
      },
      description: null,
      products,
    };

    doctorsByCmp.set(cmp, locationItem);
  });

  // ── 6. Build centers ──────────────────────────────────────────────────────
  // PASS B: Build one LocationItem per unique centro with resolved coordinates.
  // Merge products from all associated doctors and attach them as linked_entities.
  const centersByKey = new Map<string, LocationItem>();

  centroGroupsByKey.forEach((group, key) => {
    const { rawCentro, cmps } = group;
    const centroName = (rawCentro.centro || '').trim();

    const address = cleanSpanishText((rawCentro.direccion_centro || '').trim()) || 'Lima, Perú';

    // Coordinates: use resolved coordinates if found, else 0 (unmapped)
    const resolvedCenterCoords = centerCoordsByKey.get(key) || null;
    const hasExactCoords = resolvedCenterCoords !== null;
    const lat = hasExactCoords ? resolvedCenterCoords.lat : 0;
    const lng = hasExactCoords ? resolvedCenterCoords.lng : 0;

    // Collect all linked doctor LocationItems (only those already built)
    const linkedDoctors: LocationItem[] = cmps
      .map(cmp => doctorsByCmp.get(cmp))
      .filter((d): d is LocationItem => d !== undefined);

    // Merge and deduplicate products from all linked doctors
    const allProducts: ProductItem[] = [];
    const seenProductNames = new Set<string>();
    linkedDoctors.forEach(doc => {
      (doc.products || []).forEach(p => {
        if (!seenProductNames.has(p.name)) {
          seenProductNames.add(p.name);
          allProducts.push(p);
        }
      });
    });

    // Doctor names joined for display (up to 3, then "y N más")
    const doctorNames = linkedDoctors.map(d => d.name);
    const doctorNamesDisplay = doctorNames.length <= 3
      ? doctorNames.join(', ')
      : `${doctorNames.slice(0, 3).join(', ')} y ${doctorNames.length - 3} más`;

    const locationItem: LocationItem = {
      id: `b2c-center-${key}`,
      name: toTitleCase(centroName),
      image_url: null,
      address,
      phone: null,
      email: null,
      website: null,
      facebook: null,
      instagram: null,
      lat,
      lng,
      tags: [
        'Centro Médico',
        'BlissFarma B2C',
        ...(hasExactCoords ? [] : ['Sin ubicación exacta']),
      ],
      custom_fields: {
        'Médicos': doctorNamesDisplay,
        'Documento': '',
        'entity_type': 'center',
        'Razón Social': centroName,
        'Razon Social': centroName,
      },
      description: null,
      products: allProducts,
      linked_entities: linkedDoctors,
    };

    centersByKey.set(key, locationItem);
  });

  // ── 7. Link centers back to each doctor (Encuéntralo en: Sedes) ───────────
  doctorsByCmp.forEach((doctor, cmp) => {
    const doctorCentros = centrosByCmp.get(cmp) || [];
    const linkedCenters: LocationItem[] = [];
    const seenCenterKeys = new Set<string>();

    doctorCentros.forEach(c => {
      const centroName = (c.centro || '').trim();
      if (!centroName) return;
      const key = toSlug(centroName);
      if (seenCenterKeys.has(key)) return;
      seenCenterKeys.add(key);

      const centerLoc = centersByKey.get(key);
      if (centerLoc) {
        linkedCenters.push(centerLoc);
      }
    });

    doctor.linked_entities = linkedCenters;
  });

  const doctors = Array.from(doctorsByCmp.values());
  const centers = Array.from(centersByKey.values());

  console.log(`[B2C API] Built ${doctors.length} doctors with linked centers, ${centers.length} centers.`);

  // ── 6. Persist to cache ───────────────────────────────────────────────────
  try {
    localStorage.setItem(
      CACHE_KEY_B2C,
      JSON.stringify({ timestamp: Date.now(), doctors, centers })
    );
  } catch {
    // ignore storage quota errors
  }

  return { doctors, centers, source: 'live_api' };
};

// ─── Cross-source deduplication ──────────────────────────────────────────────

/**
 * Given a list of B2C locations and a list of B2B locations, removes any B2B
 * entry that is substantially the same as a B2C entry (name similarity >= 0.75
 * AND address similarity >= 0.5).
 *
 * The B2C entry is preferred because it carries richer data (CMP, pacientes, foto).
 *
 * @returns The B2B list with duplicates removed.
 */
export const deduplicateB2BAgainstB2C = (
  b2cLocations: LocationItem[],
  b2bLocations: LocationItem[]
): LocationItem[] => {
  return b2bLocations.filter(b2bLoc => {
    const b2bName = b2bLoc.name || '';
    const b2bAddress = b2bLoc.address || '';

    const isDuplicate = b2cLocations.some(b2cLoc => {
      const nameSim = nameSimilarity(b2bName, b2cLoc.name || '');
      if (nameSim < 0.75) return false;
      const addrSim = nameSimilarity(b2bAddress, b2cLoc.address || '');
      return addrSim >= 0.4;
    });

    return !isDuplicate;
  });
};

// ─── B2B filter helper ────────────────────────────────────────────────────────

/**
 * Filters a list of B2B LocationItem[] keeping only those that have at least
 * one product with brand === 'BlissFarma' (case-insensitive) or SKU starting with 'BF'.
 */
export const filterBlissfarmaOnly = (locations: LocationItem[]): LocationItem[] => {
  const result: LocationItem[] = [];
  for (const loc of locations) {
    if (!loc.products || loc.products.length === 0) continue;
    const bfProds = loc.products.filter(
      p =>
        (p.sku || '').toUpperCase().startsWith('BF') ||
        (p.brand || '').toUpperCase() === 'BLISSFARMA'
    );
    if (bfProds.length === 0) continue;
    result.push({
      ...loc,
      products: bfProds,
      custom_fields: {
        ...(loc.custom_fields || {}),
        entity_type: 'center',
      },
      tags: [...(loc.tags || []).filter(t => t !== 'ERP B2B'), 'BlissFarma B2B'],
    });
  }
  return result;
};

