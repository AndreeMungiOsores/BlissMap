import apiGeocodedCoords from '../data/api_geocoded_coords.json';
import excelGeocodedOverrides from '../data/excel_geocoded_overrides.json';
import productImagesMap from '../data/product_images_map.json';

export interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
  sku?: string;
  image_url?: string;
  empresa?: string;
}

export interface LocationItem {
  id: string;
  name: string;
  image_url: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  facebook?: string | null;
  instagram?: string | null;
  lat: number;
  lng: number;
  tags: string[];
  custom_fields: Record<string, string>;
  description: string | null;
  products?: ProductItem[];
  distance?: number;
  empresa?: string;
}

export interface B2BCliente {
  empresa?: string;
  nro_doc: string;
  razon_social: string;
  nombre_comercial: string;
  direccion_fiscal: string;
  telefono: string;
  website: string;
  facebook: string;
  instagram: string;
  twitter: string;
}

export interface B2BDireccionEnvio {
  empresa?: string;
  nro_doc: string;
  direccion_envio: string;
}

export interface B2BMedico {
  empresa?: string;
  nro_doc: string;
  medico: string;
  nro_doc_med: string;
  colegiatura: string;
}

export interface B2BVentaDetalle {
  empresa?: string;
  nro_doc: string;
  sku: string;
  producto: string;
  marca?: string;
  cantidad: number;
  ultima_compra: string;
}

export interface B2BApiResponse {
  status: string;
  clientes?: B2BCliente[];
  direcciones_envio?: B2BDireccionEnvio[];
  medicos?: B2BMedico[];
  detalle?: B2BVentaDetalle[];
}

const API_BASE_URL = '/api/b2b-erp';
const API_DIRECT_URL = 'https://blisscorp.niuxpro.com/e/action/33_json/14_vtab2bprd/receive';
const API_KEY = 'TV1_TST0001_pqXvN0a1b2c3d4e5f7';
const CACHE_KEY = 'blissmap_b2b_api_v2_v22';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de vigencia en caché

export interface SocialUrls {
  website: string | null;
  facebook: string | null;
  instagram: string | null;
}

/**
 * Bulletproof URL normalizer:
 * Fixes malformed ERP API protocols (e.g. UPPERCASE 'HTTPS://', missing colons 'https//', duplicate 'https://https//')
 * and produces a clean, valid URL starting with 'https://'
 */
export const cleanUrl = (raw?: string | null): string | null => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Strips duplicate, malformed, or uppercase http/https prefixes (e.g. HTTPS://, https//, https://https//)
  let clean = trimmed.replace(/^(https?:\/\/?)+/gi, '').replace(/^(https?)+/gi, '');
  clean = clean.replace(/^[/:=]+/, '');

  if (!clean) return null;
  return `https://${clean}`;
};

/**
 * Bulletproof multi-field URL parser:
 * Inspects all raw URL fields (website, facebook, instagram) returned by the ERP API,
 * standardizes http/https protocols via cleanUrl, and categorizes links by domain (Instagram, Facebook, or Website).
 */
export const parseSocialUrls = (
  rawWebsite?: string | null,
  rawFacebook?: string | null,
  rawInstagram?: string | null
): SocialUrls => {
  const rawList = [rawWebsite, rawFacebook, rawInstagram]
    .map(u => cleanUrl(u))
    .filter((u): u is string => u !== null);

  let website: string | null = null;
  let instagram: string | null = null;
  let facebook: string | null = null;

  for (const formatted of rawList) {
    const lower = formatted.toLowerCase();

    if (lower.includes('instagram.com')) {
      if (!instagram) instagram = formatted;
    } else if (lower.includes('facebook.com') || lower.includes('fb.com')) {
      if (!facebook) facebook = formatted;
    } else {
      if (!website) website = formatted;
    }
  }

  return { website, facebook, instagram };
};

/**
 * Clean and fix broken Spanish encoding characters (\uFFFD / ?) in Peru doctor addresses & product names
 */
export const cleanSpanishText = (str: string | null | undefined): string => {
  if (!str) return '';
  
  return str
    .replace(/MANUEL\s+MAR[\uFFFD\?]+A/gi, 'MANUEL MARÍA')
    .replace(/URBANIZACI[\uFFFD\?]+N/gi, 'URBANIZACIÓN')
    .replace(/SUDAM[\uFFFD\?]+RICA/gi, 'SUDAMÉRICA')
    .replace(/PARI[\uFFFD\?]+AS/gi, 'PARIÑAS')
    .replace(/JIR[\uFFFD\?]+N/gi, 'JIRÓN')
    .replace(/JIR[\uFFFD\?]+/gi, 'JIRÓN')
    .replace(/MAR[\uFFFD\?]+A/gi, 'MARÍA')
    .replace(/BOL[\uFFFD\?]+VAR/gi, 'BOLÍVAR')
    .replace(/M[\uFFFD\?]+DICA/gi, 'MÉDICA')
    .replace(/M[\uFFFD\?]+DICO/gi, 'MÉDICO')
    .replace(/CABA[\uFFFD\?]+A/gi, 'CABAÑA')
    .replace(/HU[\uFFFD\?]+SCAR/gi, 'HUÁSCAR')
    .replace(/D[\uFFFD\?]+O/gi, 'DÚO')
    .replace(/C[\uFFFD\?]+PSULAS/gi, 'CÁPSULAS')
    .replace(/C[\uFFFD\?]+PSULA/gi, 'CÁPSULA')
    .replace(/QUI[\uFFFD\?]+ONES/gi, 'QUIÑONES')
    .replace(/PE[\uFFFD\?]+A/gi, 'PEÑA')
    .replace(/NI[\uFFFD\?]+O/gi, 'NIÑO')
    .replace(/N[\uFFFD\?]+RO/gi, 'NRO.')
    .replace(/N[\uFFFD\?]+/gi, 'N° ')
    .replace(/[\uFFFD\?]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Convert ALL CAPS commerce and doctor names into clean Title Case
 * e.g. "CLÍNICA DEL PILAR | AYACUCHO" -> "Clínica Del Pilar | Ayacucho"
 * Preserves legal & medical acronyms like S.A.C., E.I.R.L., S.R.L., S.A., CDC, DDC, CMP, RUC, DNI
 */
export const toTitleCase = (str: string | null | undefined): string => {
  if (!str) return '';
  const cleaned = cleanSpanishText(str);

  const acronyms = new Set([
    'SAC', 'S.A.C.', 'S.A.C', 'EIRL', 'E.I.R.L.', 'E.I.R.L', 'SRL', 'S.R.L.', 'S.R.L',
    'SA', 'S.A.', 'S.A', 'SCRL', 'S.C.R.L.', 'S.C.R.L', 'CMP', 'C.M.P.', 'RUC', 'DNI',
    'CDC', 'DDC', 'PLG', 'CAP', 'E.I.R.L..', 'S.A.C..'
  ]);

  return cleaned
    .split(' ')
    .map(part => {
      if (!part) return '';
      
      if (part.includes('|')) {
        return part.split('|').map(sub => toTitleCase(sub)).join(' | ');
      }
      if (part.includes('/')) {
        return part.split('/').map(sub => toTitleCase(sub)).join('/');
      }

      const stripped = part.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ.]/g, '');
      if (acronyms.has(part.toUpperCase()) || acronyms.has(stripped)) {
        return part.toUpperCase();
      }

      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
};

// Map product brands based on 6 core brands
export const detectBrand = (productName: string): string | undefined => {
  const upper = productName.toUpperCase();
  if (upper.includes('SVR') || upper.includes('SEBIACLEAR') || upper.includes('TOPIALYSE') || upper.includes('CLAIRIAL') || upper.includes('AMPULA') || upper.includes('SUN SECURE') || upper.includes('PALPEBRAL')) return 'SVR';
  if (upper.includes('TIZO')) return 'TIZO';
  if (upper.includes('COLORESCIENCE') || upper.includes('SUNFORGETTABLE') || upper.includes('FLEX') || upper.includes('TOTAL EYE')) return 'COLORESCIENCE';
  if (upper.includes('CEBELIA') || upper.includes('LCE') || upper.includes('BAUME')) return 'CEBELIA';
  if (upper.includes('ELTA') || upper.includes('ELEMENTS')) return 'ELTA MD';
  if (upper.includes('GLISODIN') || upper.includes('V-SOD') || upper.includes('SOD')) return 'GLISODIN';
  return undefined;
};

// Calculate 6-month dynamic date range (fecha_desde = today - 6 months, fecha_hasta = today)
export const getDynamicDateRange = () => {
  const today = new Date();
  const fechaHasta = today.toISOString().split('T')[0];

  const fechaDesdeObj = new Date(today);
  fechaDesdeObj.setMonth(fechaDesdeObj.getMonth() - 6);
  const fechaDesde = fechaDesdeObj.toISOString().split('T')[0];

  return { fechaDesde, fechaHasta };
};

// Clear stale cache keys from localStorage
const clearStaleCaches = () => {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('blissmap_b2b_api_') && key !== CACHE_KEY) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(k => localStorage.removeItem(k));
  } catch (e) {
    // Ignore cache clear error
  }
};

/**
 * Fetch live B2B sales data directly from ERP API with expanded phone matching
 */
export const fetchB2BSalesLocations = async (fallbackLocations: LocationItem[]): Promise<{ locations: LocationItem[]; source: 'live_api' | 'cache' | 'fallback' }> => {
  clearStaleCaches();
  const { fechaDesde, fechaHasta } = getDynamicDateRange();
  
  // 1. Check LocalStorage Cache (v8)
  try {
    const cachedStr = localStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      const isFresh = (Date.now() - cached.timestamp) < CACHE_TTL_MS;
      if (isFresh && cached.data && Array.isArray(cached.data) && cached.data.length > 0) {
        console.log(`[B2B API Pure] Serving ${cached.data.length} doctors directly from ERP API cache (v8).`);
        return { locations: cached.data, source: 'cache' };
      }
    }
  } catch (e) {
    console.warn('[B2B API Pure] Cache read error:', e);
  }

  // 2. Fetch Live ERP API Data via Proxy (/api/b2b-erp) or Direct URL
  const queryStr = `?fecha_desde=${fechaDesde}&fecha_hasta=${fechaHasta}`;
  console.log(`[B2B API Pure] Fetching live ERP data: ${API_BASE_URL}${queryStr}`);

  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE_URL}${queryStr}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': API_KEY,
          'Accept': 'application/json'
        }
      });
    } catch (proxyErr) {
      console.warn('[B2B API Pure] Proxy fetch failed, attempting direct endpoint fetch:', proxyErr);
      response = await fetch(`${API_DIRECT_URL}${queryStr}`, {
        method: 'GET',
        headers: {
          'X-Api-Key': API_KEY,
          'Accept': 'application/json'
        }
      });
    }

    if (!response.ok) {
      throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
    }

    // Read arrayBuffer to decode ISO-8859-1 correctly
    const buffer = await response.arrayBuffer();
    const decoder = new TextDecoder('iso-8859-1');
    const rawText = decoder.decode(buffer);
    const payload: B2BApiResponse = JSON.parse(rawText);

    if (payload.status !== 'OK') {
      throw new Error(`API returned non-OK status: ${payload.status}`);
    }

    // Lookup maps from live ERP API response v2.0
    // Composite key: `${empresa}_${cleanDoc}` with fallback to `${cleanDoc}`
    const clientesCompMap = new Map<string, B2BCliente>();
    const clientesDocMap = new Map<string, B2BCliente>();
    const clientesTokenList: { tokens: Set<string>; cliente: B2BCliente }[] = [];

    const STOP_WORDS = new Set(['sac', 'eirl', 'srl', 'del', 'los', 'las', 'san', 'santa', 'medico', 'clinica', 'doctor', 'doctora', 'dr', 'dra']);

    (payload.clientes || []).forEach(c => {
      const emp = (c.empresa || 'BLISSFARMA').toUpperCase();
      const digits = c.nro_doc.replace(/\D/g, '');
      if (digits) {
        clientesCompMap.set(`${emp}_${digits}`, c);
        if (!clientesDocMap.has(digits)) clientesDocMap.set(digits, c);
      }

      const tel = (c.telefono || '').trim();
      if (tel && tel.replace(/\D/g, '').length >= 7) {
        const fullName = `${c.nombre_comercial || ''} ${c.razon_social || ''}`.toLowerCase();
        const rawTokens = fullName.match(/[a-z0-9]+/g) || [];
        const tokens = new Set(rawTokens.filter(t => t.length > 2 && !STOP_WORDS.has(t)));
        if (tokens.size > 0) {
          clientesTokenList.push({ tokens, cliente: c });
        }
      }
    });

    const direccionesCompMap = new Map<string, string>();
    const direccionesDocMap = new Map<string, string>();
    (payload.direcciones_envio || []).forEach(d => {
      const emp = (d.empresa || 'BLISSFARMA').toUpperCase();
      direccionesCompMap.set(`${emp}_${d.nro_doc}`, d.direccion_envio);
      if (!direccionesDocMap.has(d.nro_doc)) direccionesDocMap.set(d.nro_doc, d.direccion_envio);
    });

    const bySkuMap = (productImagesMap as any).by_sku || {};
    const byNameMap = (productImagesMap as any).by_name || {};

    const detalleCompMap = new Map<string, ProductItem[]>();
    const detalleDocMap = new Map<string, ProductItem[]>();
    (payload.detalle || []).forEach(item => {
      const emp = (item.empresa || 'BLISSFARMA').toUpperCase();
      const compKey = `${emp}_${item.nro_doc}`;

      const cleanProductName = cleanSpanishText(item.producto);
      const skuStr = (item.sku || '').trim();
      const cleanNameKey = cleanProductName.toLowerCase().replace(/\s+/g, '').replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u');
      const imgUrl = bySkuMap[skuStr] || byNameMap[cleanNameKey] || undefined;

      const apiMarca = (item.marca || '').trim();
      const productObj: ProductItem = {
        name: cleanProductName,
        qty: Number(item.cantidad) || 1,
        last_date: item.ultima_compra,
        sku: item.sku,
        brand: apiMarca || detectBrand(cleanProductName),
        image_url: imgUrl,
        empresa: emp
      };

      const existingComp = detalleCompMap.get(compKey) || [];
      existingComp.push(productObj);
      detalleCompMap.set(compKey, existingComp);

      const existingDoc = detalleDocMap.get(item.nro_doc) || [];
      existingDoc.push(productObj);
      detalleDocMap.set(item.nro_doc, existingDoc);
    });

    const geocodeLookup = apiGeocodedCoords as Record<string, { lat: number; lng: number }>;
    const excelOverridesLookup = excelGeocodedOverrides as Record<string, { address?: string; lat?: number; lng?: number }>;
    const DEFAULT_LAT = -12.046374;
    const DEFAULT_LNG = -77.042793;

    const apiDoctorsList: LocationItem[] = [];
    const medicos = payload.medicos || [];

    // ── PASS 1: Build one entry per unique RUC accumulating products from all empresas ──────────────────
    // A clinic that buys from both BLISSFARMA and SKINBLISS appears twice in payload.medicos[].
    // We collapse those into ONE location with all products combined.

    // Keyed by cleanCompanyDoc (RUC digits).
    const locationByDoc = new Map<string, LocationItem>();

    medicos.forEach((med, idx) => {
      const emp = (med.empresa || 'BLISSFARMA').toUpperCase();
      const cleanCompanyDoc = med.nro_doc.replace(/\D/g, '');
      const cleanMedDoc = (med.nro_doc_med || '').replace(/\D/g, '');

      const compKeyCompany = `${emp}_${cleanCompanyDoc}`;
      const compKeyMed = `${emp}_${cleanMedDoc}`;

      // Primary cliente for this empresa-doc combo
      const primaryCliente = clientesCompMap.get(compKeyCompany) ||
        (cleanMedDoc ? clientesCompMap.get(compKeyMed) : undefined) ||
        clientesDocMap.get(cleanCompanyDoc) ||
        (cleanMedDoc ? clientesDocMap.get(cleanMedDoc) : undefined);

      // Excel overrides
      const excelOverride = excelOverridesLookup[cleanCompanyDoc] ||
        (cleanMedDoc ? excelOverridesLookup[cleanMedDoc] : undefined) ||
        excelOverridesLookup[med.nro_doc];

      // Products for this specific empresa-doc pair (then fallback to doc-only)
      const empProducts: ProductItem[] =
        detalleCompMap.get(`${emp}_${med.nro_doc}`) ||
        detalleDocMap.get(med.nro_doc) ||
        [];

      // If entry already exists for this RUC, just append new products and stop
      const existing = locationByDoc.get(cleanCompanyDoc);
      if (existing) {
        // Merge products: add only products not already present by name
        const existingNames = new Set(existing.products?.map(p => p.name) || []);
        const newProds = empProducts.filter(p => !existingNames.has(p.name));
        if (newProds.length > 0) {
          existing.products = [...(existing.products || []), ...newProds];
        }
        return; // Skip creating a second entry for this RUC
      }

      // ── First time we see this RUC: build the full location entry ──────────────────────────────
      let phoneNumber = (primaryCliente?.telefono || '').trim() || null;
      if (!phoneNumber) {
        const locRawTokens = med.medico.toLowerCase().match(/[a-z0-9]+/g) || [];
        const locTokens = locRawTokens.filter(t => t.length > 2 && !STOP_WORDS.has(t));
        let maxCommon = 0;
        let bestPhoneMatch: B2BCliente | undefined = undefined;
        for (const item of clientesTokenList) {
          let commonCount = 0;
          for (const token of locTokens) {
            if (item.tokens.has(token)) commonCount++;
          }
          if (commonCount >= 2 && commonCount > maxCommon) {
            maxCommon = commonCount;
            bestPhoneMatch = item.cliente;
          }
        }
        if (bestPhoneMatch) phoneNumber = (bestPhoneMatch.telefono || '').trim() || null;
      }

      const rawAddress = excelOverride?.address ||
        direccionesCompMap.get(`${emp}_${med.nro_doc}`) ||
        direccionesDocMap.get(med.nro_doc) ||
        primaryCliente?.direccion_fiscal ||
        'Lima, Perú';

      const coords = (excelOverride?.lat && excelOverride?.lng)
        ? { lat: excelOverride.lat, lng: excelOverride.lng }
        : (
          geocodeLookup[`${emp}_${med.nro_doc}`] ||
          geocodeLookup[med.nro_doc] ||
          geocodeLookup[cleanCompanyDoc] || {
            lat: DEFAULT_LAT + (idx * 0.002),
            lng: DEFAULT_LNG + (idx * 0.002)
          }
        );

      const cleanNombreComercial = toTitleCase(
        primaryCliente?.nombre_comercial || primaryCliente?.razon_social || med.medico || 'Centro Dermatológico'
      );
      const cleanDoctorName = toTitleCase(
        med.medico || primaryCliente?.nombre_comercial || primaryCliente?.razon_social || 'Médico Dermatólogo'
      );
      const cleanDoctorAddress = cleanSpanishText(rawAddress);
      const cleanRazonSocial = cleanSpanishText(
        primaryCliente?.razon_social || primaryCliente?.nombre_comercial || ''
      );

      // Stable ID: empresa-agnostic on multi-empresa clinics but prefixed with canonical first empresa
      // to preserve backward-compatibility with Supabase records saved under erp-doc-blissfarma-... format.
      const canonicalEmp = emp.toLowerCase(); // Will be 'blissfarma' for most primaries
      const docNumDigits = (cleanCompanyDoc || cleanMedDoc || primaryCliente?.nro_doc || '').replace(/\D/g, '');
      const nameSlug = cleanNombreComercial
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
      const stableId = `erp-doc-${canonicalEmp}-${docNumDigits}${nameSlug ? '-' + nameSlug : ''}`;

      const { website: parsedWebsite, facebook: parsedFacebook, instagram: parsedInstagram } = parseSocialUrls(
        primaryCliente?.website,
        primaryCliente?.facebook,
        primaryCliente?.instagram
      );

      const newEntry: LocationItem = {
        id: stableId,
        name: cleanNombreComercial,
        image_url: null,
        address: cleanDoctorAddress,
        phone: phoneNumber,
        email: null,
        website: parsedWebsite,
        facebook: parsedFacebook,
        instagram: parsedInstagram,
        lat: coords.lat,
        lng: coords.lng,
        tags: ['ERP B2B', 'Verificado', cleanDoctorName],
        custom_fields: {
          'Nombre Comercial': cleanNombreComercial,
          'Médico': cleanDoctorName,
          'Razón Social': cleanRazonSocial,
          'Documento': primaryCliente?.nro_doc || med.nro_doc,
          'Colegiatura': med.colegiatura ? `CMP ${med.colegiatura}` : '',
        },
        description: null,
        products: empProducts,
        empresa: emp
      };

      locationByDoc.set(cleanCompanyDoc, newEntry);
    });

    // ── PASS 2: Flatten the map into the final list ─────────────────────────────────────────────
    apiDoctorsList.push(...Array.from(locationByDoc.values()));

    if (apiDoctorsList.length > 0) {
      console.log(`[B2B API Pure] Built ${apiDoctorsList.length} doctors directly from ERP API with expanded phone matching.`);
      
      // Cache pure API result in localStorage
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          data: apiDoctorsList
        }));
      } catch (e) {
        console.warn('[B2B API Pure] Failed to write cache to localStorage:', e);
      }

      return { locations: apiDoctorsList, source: 'live_api' };
    }
  } catch (err) {
    console.error('[B2B API Pure] Fetch failed, activating fallback resilience:', err);
  }

  // 3. Fallback to cached version if API fails
  try {
    const cachedStr = localStorage.getItem(CACHE_KEY);
    if (cachedStr) {
      const cached = JSON.parse(cachedStr);
      if (cached.data && cached.data.length > 0) {
        console.log('[B2B API Pure] Fallback: serving cached doctors dataset.');
        return { locations: cached.data, source: 'cache' };
      }
    }
  } catch (e) {
    console.warn('[B2B API Pure] Fallback cache read error:', e);
  }

  // 4. Final Fallback to local dataset
  console.log('[B2B API Pure] Fallback: serving local doctors dataset.');
  return { locations: fallbackLocations, source: 'fallback' };
};
