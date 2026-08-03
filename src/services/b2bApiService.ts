import apiGeocodedCoords from '../data/api_geocoded_coords.json';
import productImagesMap from '../data/product_images_map.json';

export interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
  sku?: string;
  image_url?: string;
}

export interface LocationItem {
  id: string;
  name: string;
  image_url: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  lat: number;
  lng: number;
  tags: string[];
  custom_fields: Record<string, string>;
  description: string | null;
  products?: ProductItem[];
  distance?: number;
}

export interface B2BCliente {
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
  nro_doc: string;
  direccion_envio: string;
}

export interface B2BMedico {
  nro_doc: string;
  medico: string;
  nro_doc_med: string;
  colegiatura: string;
}

export interface B2BVentaDetalle {
  nro_doc: string;
  sku: string;
  producto: string;
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
const CACHE_KEY = 'blissmap_b2b_api_images_v9';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hora de vigencia en caché

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
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('blissmap_b2b_api_') && key !== CACHE_KEY) {
        localStorage.removeItem(key);
      }
    }
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

    // Lookup maps from live ERP API response
    const clientesDocMap = new Map<string, B2BCliente>();
    const clientesTokenList: { tokens: Set<string>; cliente: B2BCliente }[] = [];

    const STOP_WORDS = new Set(['sac', 'eirl', 'srl', 'del', 'los', 'las', 'san', 'santa', 'medico', 'clinica', 'doctor', 'doctora', 'dr', 'dra']);

    (payload.clientes || []).forEach(c => {
      const digits = c.nro_doc.replace(/\D/g, '');
      if (digits) clientesDocMap.set(digits, c);

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

    const direccionesMap = new Map<string, string>();
    (payload.direcciones_envio || []).forEach(d => direccionesMap.set(d.nro_doc, d.direccion_envio));

    const bySkuMap = (productImagesMap as any).by_sku || {};
    const byNameMap = (productImagesMap as any).by_name || {};

    const detalleMap = new Map<string, ProductItem[]>();
    (payload.detalle || []).forEach(item => {
      const existing = detalleMap.get(item.nro_doc) || [];
      const cleanProductName = cleanSpanishText(item.producto);
      const skuStr = (item.sku || '').trim();
      const cleanNameKey = cleanProductName.toLowerCase().replace(/\s+/g, '').replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e').replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o').replace(/[úùüû]/g, 'u');
      const imgUrl = bySkuMap[skuStr] || byNameMap[cleanNameKey] || undefined;

      existing.push({
        name: cleanProductName,
        qty: Number(item.cantidad) || 1,
        last_date: item.ultima_compra,
        sku: item.sku,
        brand: detectBrand(cleanProductName),
        image_url: imgUrl
      });
      detalleMap.set(item.nro_doc, existing);
    });

    const geocodeLookup = apiGeocodedCoords as Record<string, { lat: number; lng: number }>;
    const DEFAULT_LAT = -12.046374;
    const DEFAULT_LNG = -77.042793;

    const apiDoctorsList: LocationItem[] = [];

    // Map each doctor entry directly from ERP API payload with expanded phone matching
    const medicos = payload.medicos || [];
    if (medicos.length > 0) {
      medicos.forEach((med, idx) => {
        const cleanCompanyDoc = med.nro_doc.replace(/\D/g, '');
        const cleanMedDoc = (med.nro_doc_med || '').replace(/\D/g, '');

        let cliente = clientesDocMap.get(cleanCompanyDoc) || (cleanMedDoc ? clientesDocMap.get(cleanMedDoc) : undefined);

        // Token match for doctor name if no direct phone in primary company doc
        if (!cliente || !cliente.telefono || !cliente.telefono.trim()) {
          const locRawTokens = med.medico.toLowerCase().match(/[a-z0-9]+/g) || [];
          const locTokens = locRawTokens.filter(t => t.length > 2 && !STOP_WORDS.has(t));
          
          let maxCommon = 0;
          let bestMatch: B2BCliente | undefined = undefined;

          for (const item of clientesTokenList) {
            let commonCount = 0;
            for (const token of locTokens) {
              if (item.tokens.has(token)) commonCount++;
            }
            if (commonCount >= 2 && commonCount > maxCommon) {
              maxCommon = commonCount;
              bestMatch = item.cliente;
            }
          }
          if (bestMatch) cliente = bestMatch;
        }

        const rawAddress = direccionesMap.get(med.nro_doc) || cliente?.direccion_fiscal || 'Lima, Perú';
        const products = detalleMap.get(med.nro_doc) || [];

        // Geocoded coordinates lookup
        const coords = geocodeLookup[med.nro_doc] || {
          lat: DEFAULT_LAT + (idx * 0.002),
          lng: DEFAULT_LNG + (idx * 0.002)
        };

        const cleanDoctorName = cleanSpanishText(med.medico || cliente?.nombre_comercial || cliente?.razon_social || 'Médico Dermatólogo');
        const cleanDoctorAddress = cleanSpanishText(rawAddress);
        const cleanRazonSocial = cleanSpanishText(cliente?.razon_social || cliente?.nombre_comercial || '');

        apiDoctorsList.push({
          id: `erp-doc-${med.nro_doc_med || med.nro_doc}-${idx}`,
          name: cleanDoctorName,
          image_url: null,
          address: cleanDoctorAddress,
          phone: cliente?.telefono || null,
          email: null,
          website: cliente?.website || null,
          lat: coords.lat,
          lng: coords.lng,
          tags: ['ERP B2B', 'Verificado'],
          custom_fields: {
            'Razón Social': cleanRazonSocial,
            'Documento': cliente?.nro_doc || med.nro_doc,
            'Colegiatura': med.colegiatura ? `CMP ${med.colegiatura}` : ''
          },
          description: null,
          products: products
        });
      });
    }

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
