/**
 * sync-mirror.mjs — lectura periódica de Dataverse hacia Supabase (espejo de solo lectura).
 *
 * Qué hace (cada ejecución):
 *  1. Lee de Dataverse (solo GET) contactos, grupos económicos y direcciones.
 *  2. Los copia a las tablas espejo de Supabase: dv_mirror_contactos / _grupos / _direcciones.
 *  3. Calcula diferencias ("drift") entre las fichas vinculadas de bm_locations y Dataverse y las guarda en dv_sync_log.
 *
 * Qué NO hace: no escribe en Dataverse y no modifica bm_locations (ni nombre, ni foto, ni grupos).
 * Aplicar cambios a las fichas sigue siendo una decisión humana.
 *
 * Variables de entorno (en GitHub Actions son secrets; en local se leen de .env.local / .env del proyecto):
 *   MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET   credenciales de la aplicación de Azure
 *   DV_ORG                  host de la API de Dataverse (def.: https://orge0b27328.api.crm2.dynamics.com)
 *   SUPABASE_URL            (def.: VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso:  node scripts/dataverse/sync-mirror.mjs [--dry-run]
 * Importante: este script corre en un servidor (GitHub Actions); sus logs son visibles en el repositorio público,
 * por eso solo imprime conteos, nunca nombres ni documentos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DRY = process.argv.includes('--dry-run');

// ── configuración ─────────────────────────────────────────────────────────────
const readEnvFile = file => {
  const out = {};
  if (!file || !fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
};
const local = {
  ...readEnvFile(process.env.DV_ENV_FILE), // .env con las credenciales de Microsoft (solo uso local)
  ...readEnvFile(path.join(ROOT, '.env')),
  ...readEnvFile(path.join(ROOT, '.env.local')),
};
const cfg = k => process.env[k] || local[k];
const DV_ORG = cfg('DV_ORG') || 'https://orge0b27328.api.crm2.dynamics.com';
const SB_URL = cfg('SUPABASE_URL') || cfg('VITE_SUPABASE_URL');
const SB_KEY = cfg('SUPABASE_SERVICE_ROLE_KEY');
for (const k of ['MICROSOFT_TENANT_ID', 'MICROSOFT_CLIENT_ID', 'MICROSOFT_CLIENT_SECRET']) {
  if (!cfg(k)) throw new Error(`Falta ${k}`);
}
if (!SB_URL || !SB_KEY) throw new Error('Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY');

// ── Dataverse (solo GET) ───────────────────────────────────────────────────────
async function dvToken() {
  const res = await fetch(`https://login.microsoftonline.com/${cfg('MICROSOFT_TENANT_ID')}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: cfg('MICROSOFT_CLIENT_ID'),
      client_secret: cfg('MICROSOFT_CLIENT_SECRET'),
      scope: `${DV_ORG}/.default`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Token Dataverse: ${j.error || res.status}`);
  return j.access_token;
}
async function dvAll(token, set, select, annotations = false) {
  let url = `${DV_ORG}/api/data/v9.2/${set}?$select=${select}`;
  const rows = [];
  while (url) {
    const res = await fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0', ...(annotations ? { Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"' } : {}) } });
    const j = await res.json();
    if (!res.ok) throw new Error(`${set}: HTTP ${res.status}`);
    rows.push(...j.value);
    url = j['@odata.nextLink'] || null;
  }
  return rows;
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const SB = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
async function sbGetAll(pathAndQuery) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SB_URL}/rest/v1/${pathAndQuery}`, { headers: { ...SB, Range: `${from}-${from + 999}` } });
    const part = await res.json();
    if (!res.ok) throw new Error(`Supabase GET ${pathAndQuery.split('?')[0]}: HTTP ${res.status}`);
    rows.push(...part);
    if (part.length < 1000) break;
  }
  return rows;
}
async function sbUpsert(table, rows) {
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${SB_URL}/rest/v1/${table}?on_conflict=id`, {
      method: 'POST',
      headers: { ...SB, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
}
async function sbCount(table) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?select=id`, { headers: { ...SB, Prefer: 'count=exact', Range: '0-0' } });
  if (!res.ok) return null;
  return Number((res.headers.get('content-range') || '').split('/')[1]) || 0;
}
async function sbDeleteStale(table, runStartIso) {
  const res = await fetch(`${SB_URL}/rest/v1/${table}?synced_at=lt.${encodeURIComponent(runStartIso)}`, {
    method: 'DELETE', headers: { ...SB, Prefer: 'return=minimal' },
  });
  if (!res.ok) throw new Error(`Supabase delete ${table}: HTTP ${res.status}`);
}

// ── proceso ───────────────────────────────────────────────────────────────────
const runStart = new Date().toISOString();
const token = await dvToken();
const [contacts, groups, addresses] = await Promise.all([
  dvAll(token, 'crb7e_contactosmaestros',
    'crb7e_contactosmaestroid,crb7e_idcontacto,crb7e_nombre,crb7e_nombrecomercial,crb7e_numerodedocumento,crb7e_ruc,crb7e_ruc10,crb7e_cmp,_crb7e_ge_value,statecode,crb7e_logo_url,modifiedon'),
  dvAll(token, 'crb7e_gruposeconomicoses',
    'crb7e_gruposeconomicosid,crb7e_idge,crb7e_nombrege,crb7e_propietarioge,_crb7e_propietariocontacto_value,crb7e_rol,statecode,modifiedon'),
  dvAll(token, 'crb7e_direccionesmaestras',
    'crb7e_direccionesmaestraid,crb7e_iddireccion,_crb7e_contacto_value,crb7e_sede,crb7e_direccion,crb7e_latitud,crb7e_longitud,statecode,modifiedon'),
]);
console.log(`Dataverse: ${contacts.length} contactos, ${groups.length} grupos, ${addresses.length} direcciones`);

const mContactos = contacts.map(c => ({
  id: c.crb7e_contactosmaestroid, codigo: c.crb7e_idcontacto, nombre: c.crb7e_nombre, nombre_comercial: c.crb7e_nombrecomercial,
  documento: c.crb7e_numerodedocumento, ruc: c.crb7e_ruc, ruc10: c.crb7e_ruc10, cmp: c.crb7e_cmp,
  ge_id: c._crb7e_ge_value, estado: c.statecode, tiene_logo: Boolean(c.crb7e_logo_url), modificado: c.modifiedon, synced_at: runStart,
}));
const mGrupos = groups.map(g => ({
  id: g.crb7e_gruposeconomicosid, codigo: g.crb7e_idge, nombre: g.crb7e_nombrege, propietario: g.crb7e_propietarioge,
  propietario_contacto_id: g._crb7e_propietariocontacto_value, rol: typeof g.crb7e_rol === 'string' ? g.crb7e_rol : null, estado: g.statecode, modificado: g.modifiedon, synced_at: runStart,
}));
const mDirecciones = addresses.map(a => ({
  id: a.crb7e_direccionesmaestraid, codigo: a.crb7e_iddireccion, contacto_id: a._crb7e_contacto_value, sede: a.crb7e_sede,
  direccion: a.crb7e_direccion, latitud: a.crb7e_latitud, longitud: a.crb7e_longitud, estado: a.statecode, modificado: a.modifiedon, synced_at: runStart,
}));

// ── diferencias entre las fichas vinculadas y Dataverse (solo lectura) ──────────
const fichas = await sbGetAll('bm_locations?select=id,custom_fields&custom_fields-%3E%3Edv_contact_id=not.is.null&order=id');
const cById = new Map(contacts.map(c => [c.crb7e_contactosmaestroid, c]));
const gById = new Map(groups.map(g => [g.crb7e_gruposeconomicosid, g]));
const drift = { contacto_inexistente: [], contacto_inactivo: [], ge_distinto: [], ge_nuevo: [], ge_quitado: [] };
for (const f of fichas) {
  const cf = f.custom_fields || {};
  const c = cById.get(cf.dv_contact_id);
  if (!c) { drift.contacto_inexistente.push(f.id); continue; }
  if (c.statecode !== 0) drift.contacto_inactivo.push(f.id);
  const dvGe = c._crb7e_ge_value ? gById.get(c._crb7e_ge_value)?.crb7e_idge : '';
  const mine = (cf.crb7e_idge || '').toUpperCase();
  if (cf.dv_ge_code) {
    if (dvGe && dvGe.toUpperCase() !== cf.dv_ge_code.toUpperCase()) drift.ge_distinto.push(f.id);
    if (!dvGe) drift.ge_quitado.push(f.id);
  } else if (!mine && dvGe) drift.ge_nuevo.push(f.id);
}
const counts = Object.fromEntries(Object.entries(drift).map(([k, v]) => [k, v.length]));
console.log(`Fichas vinculadas: ${fichas.length} | diferencias:`, JSON.stringify(counts));

// ── vínculo automático de fichas aún sin vínculo (solo agrega claves dv_*; nunca pisa un vínculo existente) ──
// Regla aprobada: solo por documento exacto o CMP, solo si el contacto es único y está activo. Lo ambiguo no se toca.
const digits = v => String(v ?? '').replace(/\D/g, '');
const cmp6 = v => (digits(v) ? digits(v).padStart(6, '0') : '');
const byDoc = new Map();
const byCmp = new Map();
const addTo = (m, k, c) => { if (!k) return; const l = m.get(k) || []; if (!l.includes(c)) l.push(c); m.set(k, l); };
for (const c of contacts) {
  for (const f of ['crb7e_numerodedocumento', 'crb7e_ruc', 'crb7e_ruc10']) { const d = digits(c[f]); if (d.length === 8 || d.length === 11) addTo(byDoc, d, c); }
  addTo(byCmp, cmp6(c.crb7e_cmp), c);
}
const gCode = id => (id ? gById.get(id)?.crb7e_idge || '' : '');
const sinVinculo = (await sbGetAll('bm_locations?select=id,custom_fields&custom_fields-%3E%3Edv_contact_id=is.null&order=id'))
  .filter(f => !String(f.custom_fields?.dv_link_status || '').startsWith('rechazado'));
const nuevos = [];
const revision = [];
for (const f of sinVinculo) {
  const cf = f.custom_fields || {};
  const isDoctor = f.id.startsWith('b2c-cmp-');
  const docs = new Set();
  for (const part of String(cf.Documento || '').split(/[|,;/]/)) { const d = digits(part); if (d.length === 8 || d.length === 11) docs.add(d); }
  for (const m of f.id.matchAll(/(?<!\d)(\d{8}|\d{11})(?!\d)/g)) docs.add(m[1]);
  const cmps = new Set([cmp6(cf.CMP), cmp6(cf.Colegiatura), cmp6((f.id.match(/^b2c-cmp-(\d+)/) || [])[1])].filter(Boolean));
  let picked = null;
  if (isDoctor) {
    const hits = [...new Map([...cmps].flatMap(k => byCmp.get(k) || []).map(c => [c.crb7e_contactosmaestroid, c])).values()];
    if (hits.length === 1 && hits[0].statecode === 0) picked = hits[0];
  } else if (docs.size) {
    const per = [...docs].map(d => byDoc.get(d) || []);
    if (per.every(l => l.length === 1 && l[0].statecode === 0)) {
      const cs = [...new Map(per.map(l => [l[0].crb7e_contactosmaestroid, l[0]])).values()];
      const ges = new Set(cs.map(c => gCode(c._crb7e_ge_value)));
      if (ges.size === 1) { // todos los documentos de la ficha pertenecen al mismo grupo (o a ninguno)
        const idDoc = (f.id.match(/(?<!\d)(\d{8}|\d{11})(?!\d)/) || [])[1];
        picked = cs.find(c => [c.crb7e_numerodedocumento, c.crb7e_ruc, c.crb7e_ruc10].some(x => digits(x) === idDoc)) || cs[0];
      }
    }
  }
  if (picked) nuevos.push({ id: f.id, cf, c: picked }); else if (docs.size || cmps.size) revision.push(f.id);
}
const MAX_AUTO = 50;
console.log(`Fichas sin vínculo: ${sinVinculo.length} | vinculables automáticamente: ${nuevos.length} | a revisión: ${revision.length}`);
if (nuevos.length > MAX_AUTO) console.log(`AVISO: más de ${MAX_AUTO} vínculos nuevos en una corrida; se aplicarán solo los primeros ${MAX_AUTO}.`);
if (DRY) { nuevos.forEach(n => console.log('  [simulación] vincularía', n.id, '->', n.c.crb7e_idcontacto, n.c.crb7e_nombrecomercial || n.c.crb7e_nombre)); revision.forEach(id => console.log('  [simulación] revisión', id)); }
drift.vinculos_nuevos = nuevos.slice(0, MAX_AUTO).map(n => n.id);
drift.revision_sin_vinculo = revision;

if (DRY) { console.log('SIMULACIÓN: no se escribió nada en Supabase.'); process.exit(0); }

// Protección: si Dataverse devuelve muy pocas filas respecto al espejo anterior, no se borra nada.
const prev = await sbCount('dv_mirror_contactos');
if (prev === null) throw new Error('No existen las tablas espejo: ejecuta supabase/dv_mirror.sql en el SQL Editor de Supabase.');
const safeToDelete = contacts.length > 0 && (prev === 0 || contacts.length >= prev * 0.5);

await sbUpsert('dv_mirror_contactos', mContactos);
await sbUpsert('dv_mirror_grupos', mGrupos);
await sbUpsert('dv_mirror_direcciones', mDirecciones);
if (safeToDelete) {
  await sbDeleteStale('dv_mirror_contactos', runStart);
  await sbDeleteStale('dv_mirror_grupos', runStart);
  await sbDeleteStale('dv_mirror_direcciones', runStart);
} else console.log('AVISO: el conteo cayó a menos de la mitad; no se eliminaron filas obsoletas.');

for (const n of nuevos.slice(0, MAX_AUTO)) {
  const cf = { ...n.cf, dv_contact_id: n.c.crb7e_contactosmaestroid, dv_contact_code: n.c.crb7e_idcontacto, dv_link_status: 'auto', dv_linked_at: new Date().toISOString().slice(0, 10) };
  const r = await fetch(`${SB_URL}/rest/v1/bm_locations?id=eq.${encodeURIComponent(n.id)}`, {
    method: 'PATCH', headers: { ...SB, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ custom_fields: cf }),
  });
  if (!r.ok) throw new Error(`Supabase vínculo: HTTP ${r.status}`);
}

const log = await fetch(`${SB_URL}/rest/v1/dv_sync_log`, {
  method: 'POST', headers: { ...SB, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
  body: JSON.stringify({ contactos: contacts.length, grupos: groups.length, direcciones: addresses.length, fichas_vinculadas: fichas.length, drift }),
});
if (!log.ok) throw new Error(`Supabase log: HTTP ${log.status}`);
console.log('Espejo actualizado.');
