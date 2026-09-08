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

// ─── Constants ───────────────────────────────────────────────────────────────

const B2C_API_BASE = '/api/b2c-erp';
const B2C_API_DIRECT = 'https://blisscorp.niuxpro.com/e/action/33_json/16_vtab2cmed/receive';
const API_KEY = 'TV1_TST0001_pqXvN0a1b2c3d4e5f7';
const CACHE_KEY_B2C = 'blissmap_b2c_api_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Default Lima coordinates for entities without a valid address. */
const DEFAULT_LAT = -12.046374;
const DEFAULT_LNG = -77.042793;

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

  let payload: B2CApiResponse | null = null;
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
    console.error('[B2C API] Fetch failed:', err);
    return { doctors: [], centers: [], source: 'empty' };
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

  // ── 4. Build doctors ──────────────────────────────────────────────────────
  // One LocationItem per unique CMP. A CMP may appear in multiple empresas;
  // we collapse them by taking the first occurrence's contact data and summing pacientes.
  const doctorsByCmp = new Map<string, LocationItem>();

  // First pass: resolve centros per CMP for address fallback
  const centrosByCmp = new Map<string, B2CCentro[]>();
  rawCentros.forEach(c => {
    const cmp = (c.cmp || '').trim();
    if (!cmp) return;
    const list = centrosByCmp.get(cmp) || [];
    list.push(c);
    centrosByCmp.set(cmp, list);
  });

  rawMedicos.forEach((med, idx) => {
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
    const hasExactLocation = rawAddress.length > 5;

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
      lat: DEFAULT_LAT + idx * 0.0005,
      lng: DEFAULT_LNG + idx * 0.0005,
      tags: [
        'Médico',
        'BlissFarma B2C',
        ...(hasExactLocation ? [] : ['Sin ubicación exacta']),
      ],
      custom_fields: {
        'CMP': cmp,
        'Documento': (med.nro_doc_med || '').trim(),
        'Pacientes BlissFarma': String(med.pacientes),
        'entity_type': 'doctor',
      },
      description: null,
      products,
    };

    doctorsByCmp.set(cmp, locationItem);
  });

  // ── 5. Build centers ──────────────────────────────────────────────────────
  // PASS A: Group all CMPs (and their raw centro records) by normalized centro name.
  // A centro that appears with N different CMPs has N associated doctors.
  interface CentroGroup {
    rawCentro: B2CCentro; // Use the first record for address/name
    cmps: string[];       // All CMPs associated to this centro
  }
  const centroGroupsByKey = new Map<string, CentroGroup>();

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

  // PASS B: Build one LocationItem per unique centro.
  // Merge products from all associated doctors and attach them as linked_entities.
  const centersByKey = new Map<string, LocationItem>();
  let centerIdx = 0;

  centroGroupsByKey.forEach((group, key) => {
    const { rawCentro, cmps } = group;
    const centroName = (rawCentro.centro || '').trim();

    const address = cleanSpanishText((rawCentro.direccion_centro || '').trim()) || 'Lima, Perú';
    const hasExactLocation = (rawCentro.direccion_centro || '').trim().length > 5;

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
      lat: DEFAULT_LAT + centerIdx * 0.0008,
      lng: DEFAULT_LNG + centerIdx * 0.0008,
      tags: [
        'Centro Médico',
        'BlissFarma B2C',
        ...(hasExactLocation ? [] : ['Sin ubicación exacta']),
      ],
      custom_fields: {
        'Médicos': doctorNamesDisplay,
        'Documento': '',
        'entity_type': 'center',
      },
      description: null,
      products: allProducts,
      linked_entities: linkedDoctors,
    };

    centersByKey.set(key, locationItem);
    centerIdx++;
  });

  const doctors = Array.from(doctorsByCmp.values());
  const centers = Array.from(centersByKey.values());

  console.log(`[B2C API] Built ${doctors.length} doctors, ${centers.length} centers.`);

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

