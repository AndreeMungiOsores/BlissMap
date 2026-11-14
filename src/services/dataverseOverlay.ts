/**
 * dataverseOverlay.ts
 * Aplica Dataverse sobre lo que muestran el mapa y el panel: sedes (dirección y coordenadas) y afiliaciones médico–sede.
 *
 * Regla: Dataverse manda en todo MENOS en nombre y foto, que nunca se tocan aquí.
 *  - Dirección / coordenadas: solo se adoptan las de Dataverse cuando coinciden con la dirección de ENVÍO que el portal ya
 *    tiene (mismo lugar). Nunca se usan para llenar una ubicación vacía ni para reemplazar una dirección distinta: en
 *    Dataverse la tabla de direcciones no distingue fiscal de envío, y en el portal solo debe verse la dirección de envío.
 *  - Afiliaciones: si Dataverse tiene vínculos Doctor por Sede para un médico o una sede, esos reemplazan a los del portal.
 *
 * Los datos salen de las tablas públicas dv_public_* (las llena el espejo horario). Los documentos viajan como hash
 * ('d:' + sha256('bliss|' + documento).slice(0, 24)) y los CMP como 'c:' + 6 dígitos. Si algo falla, no se cambia nada.
 */
import { supabase } from '../supabaseClient';
import type { LocationItem } from './groupService';
import { nameSimilarity, removeAccents } from '../utils/stringUtils';

interface OverlayDir {
  id: string;
  claves: string[];
  direccion: string | null;
  latitud: number | null;
  longitud: number | null;
}
interface OverlayAfil {
  id: string;
  doctor_claves: string[];
  centro_claves: string[];
}
export interface DvOverlay {
  dirs: OverlayDir[];
  afil: OverlayAfil[];
}

const TTL_MS = 30 * 60 * 1000;
let cache: { at: number; data: DvOverlay } | null = null;

const hashMemo = new Map<string, string>();
const sha24 = async (text: string): Promise<string> => {
  const hit = hashMemo.get(text);
  if (hit) return hit;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const hex = Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 24);
  hashMemo.set(text, hex);
  return hex;
};

async function pageAll<T>(table: string, cols: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).order('id').range(from, from + 999);
    if (error || !data) throw error || new Error(`Sin datos: ${table}`);
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

export const loadDataverseOverlay = async (): Promise<DvOverlay | null> => {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;
  try {
    const [dirs, afil] = await Promise.all([
      pageAll<OverlayDir>('dv_public_direcciones', 'id,claves,direccion,latitud,longitud'),
      pageAll<OverlayAfil>('dv_public_afiliaciones', 'id,doctor_claves,centro_claves'),
    ]);
    if (dirs.length === 0 && afil.length === 0) return null;
    cache = { at: Date.now(), data: { dirs, afil } };
    return cache.data;
  } catch (err) {
    console.warn('[Dataverse] Superposición no disponible; se muestran los datos actuales:', err);
    return null;
  }
};

const digitsOnly = (v?: string | null): string => String(v ?? '').replace(/\D/g, '');

/** Claves de identidad exacta de una ficha (documentos y CMP), iguales a las que publica el espejo. */
const keysOf = async (loc: LocationItem): Promise<string[]> => {
  const keys = new Set<string>();
  const cf = loc.custom_fields || {};
  const docs = new Set<string>();
  for (const part of String(cf['Documento'] || '').split(/[|,;/]/)) {
    const d = digitsOnly(part);
    if (d.length === 8 || d.length === 11) docs.add(d);
  }
  for (const m of loc.id.matchAll(/(?<!\d)(\d{8}|\d{11})(?!\d)/g)) docs.add(m[1]);
  for (const d of docs) keys.add('d:' + (await sha24('bliss|' + d)));
  for (const k of ['CMP', 'Colegiatura']) {
    const c = digitsOnly(cf[k]);
    if (c) keys.add('c:' + c.padStart(6, '0'));
  }
  const m = loc.id.match(/^b2c-cmp-(\d+)/);
  if (m) keys.add('c:' + m[1].padStart(6, '0'));
  return [...keys];
};

const nums = (s: string): Set<string> => new Set(removeAccents(s).match(/\d{2,5}/g) || []);
const words = (s: string): Set<string> =>
  new Set(removeAccents(s).split(/[^a-z0-9]+/).filter(w => w.length > 3 && !/^\d+$/.test(w) && !['peru', 'lima', 'avenida', 'calle'].includes(w)));

/** Puntaje de parecido entre dos direcciones (0..1): mismo número municipal + una palabra de la calle cuenta como mismo lugar. */
const addressScore = (a: string, b: string): number => {
  let s = nameSimilarity(a, b);
  const na = nums(a), nb = nums(b), wa = words(a), wb = words(b);
  if ([...na].some(n => nb.has(n)) && [...wa].some(w => wb.has(w))) s = Math.max(s, 0.7);
  return s;
};
const SAME_PLACE = 0.6;

const isDoctor = (l: LocationItem): boolean => l.custom_fields?.['entity_type'] === 'doctor';

export interface OverlayStats {
  direcciones: number;
  coordenadas: number;
  afiliaciones: number;
}

/**
 * Aplica la superposición in situ sobre la lista ya fusionada (API + ediciones de Supabase).
 * Nunca modifica nombre ni foto (image_url).
 */
export const applyDataverseOverlay = async (list: LocationItem[], preloaded?: DvOverlay | null): Promise<OverlayStats> => {
  const stats: OverlayStats = { direcciones: 0, coordenadas: 0, afiliaciones: 0 };
  const overlay = preloaded ?? (await loadDataverseOverlay());
  if (!overlay || list.length === 0) return stats;

  const keyed = await Promise.all(list.map(async l => ({ l, keys: await keysOf(l) })));
  const byId = new Map(list.map(l => [l.id, l]));
  const secToPrimary = new Map<string, string>();
  list.forEach(l => (l.grupo_economico_ids || []).forEach(sid => sid !== l.id && secToPrimary.set(sid, l.id)));
  const canon = (c: LocationItem): LocationItem => byId.get(secToPrimary.get(c.id) ?? c.id) ?? c;

  // ── Sedes: dirección y coordenadas ────────────────────────────────────────
  const dirsByKey = new Map<string, OverlayDir[]>();
  overlay.dirs.forEach(d => d.claves.forEach(k => dirsByKey.set(k, [...(dirsByKey.get(k) || []), d])));
  for (const { l, keys } of keyed) {
    const rows = [...new Map(keys.flatMap(k => dirsByKey.get(k) || []).map(r => [r.id, r])).values()];
    if (rows.length === 0) continue;
    let best = rows[0];
    let bestScore = -1;
    for (const r of rows) {
      const s = r.direccion ? addressScore(l.address || '', r.direccion) : 0;
      if (s > bestScore) { bestScore = s; best = r; }
    }
    if (bestScore < SAME_PLACE) continue; // distinta dirección: no se pisa (podría ser la fiscal); se corrige en Dataverse
    if (best.latitud !== null && best.longitud !== null) {
      if (l.lat !== best.latitud || l.lng !== best.longitud) stats.coordenadas++;
      l.lat = best.latitud;
      l.lng = best.longitud;
      l.tags = (l.tags || []).filter(t => t !== 'Sin ubicación exacta');
    }
    if (best.direccion && l.address !== best.direccion) {
      stats.direcciones++;
      l.address = best.direccion;
    }
  }

  // ── Afiliaciones médico–sede ───────────────────────────────────────────────
  const doctorsByKey = new Map<string, LocationItem[]>();
  const centersByKey = new Map<string, LocationItem[]>();
  for (const { l, keys } of keyed) {
    const target = isDoctor(l) ? doctorsByKey : centersByKey;
    keys.forEach(k => target.set(k, [...(target.get(k) || []), l]));
  }
  const afilByDoctorKey = new Map<string, OverlayAfil[]>();
  const afilByCentroKey = new Map<string, OverlayAfil[]>();
  overlay.afil.forEach(a => {
    a.doctor_claves.forEach(k => afilByDoctorKey.set(k, [...(afilByDoctorKey.get(k) || []), a]));
    a.centro_claves.forEach(k => afilByCentroKey.set(k, [...(afilByCentroKey.get(k) || []), a]));
  });
  const collect = (rows: OverlayAfil[], pick: (a: OverlayAfil) => string[], index: Map<string, LocationItem[]>, self: LocationItem): LocationItem[] => {
    const out = new Map<string, LocationItem>();
    for (const r of rows) for (const k of pick(r)) for (const c of index.get(k) || []) {
      const target = canon(c);
      if (target.id !== self.id) out.set(target.id, target);
    }
    return [...out.values()];
  };
  const confirmed = new Set<string>(); // pares 'medico|sede' confirmados por Dataverse
  for (const { l, keys } of keyed) {
    if (isDoctor(l)) {
      const rows = [...new Map(keys.flatMap(k => afilByDoctorKey.get(k) || []).map(r => [r.id, r])).values()];
      if (rows.length === 0) continue;
      l.linked_entities = collect(rows, r => r.centro_claves, centersByKey, l);
      l.linked_entities.forEach(c => confirmed.add(`${l.id}|${c.id}`));
      l.dv_afiliaciones = true;
      stats.afiliaciones++;
    } else {
      const rows = [...new Map(keys.flatMap(k => afilByCentroKey.get(k) || []).map(r => [r.id, r])).values()];
      if (rows.length === 0) continue;
      l.linked_entities = collect(rows, r => r.doctor_claves, doctorsByKey, l);
      l.linked_entities.forEach(d => confirmed.add(`${d.id}|${l.id}`));
      l.dv_afiliaciones = true;
      stats.afiliaciones++;
    }
  }
  // Coherencia entre ambos lados: si un lado ya sigue a Dataverse, el otro no conserva vinculos que Dataverse no confirma.
  for (const l of list) {
    if (!l.linked_entities || l.linked_entities.length === 0) continue;
    if (isDoctor(l)) {
      if (l.dv_afiliaciones) continue;
      l.linked_entities = l.linked_entities.filter(c => !(canon(c).dv_afiliaciones && !confirmed.has(`${l.id}|${canon(c).id}`)));
    } else {
      if (l.dv_afiliaciones) continue;
      l.linked_entities = l.linked_entities.filter(d => !(d.dv_afiliaciones && !confirmed.has(`${d.id}|${l.id}`)));
    }
  }
  return stats;
};
