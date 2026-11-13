/**
 * sync-simulation.mjs — Etapa 1 de la sincronización PlazaDerma <-> Dataverse (SOLO SIMULACIÓN).
 *
 * Lee Supabase (bm_locations) y Dataverse (crb7e_*) y calcula, sin escribir nada en ninguno de los
 * dos lados, qué vínculos y qué cambios PROPONDRÍA la sincronización. El resultado queda en
 * backups/sync_sim_<fecha>/ (carpeta excluida de git).
 *
 * Regla aprobada (resumen):
 *  - Dataverse manda en identidad (GUID, GE, propietario, sedes); PlazaDerma manda en nombre y foto.
 *  - Una ficha con foto conserva siempre su nombre y su foto.
 *  - Vínculo automático solo por documento exacto o CMP; nunca por nombre.
 *  - Todo lo ambiguo (documento duplicado, sin coincidencia, GE distinto) va a revisión manual.
 *
 * Uso:
 *   node scripts/dataverse/sync-simulation.mjs
 *
 * Variables (opcionales):
 *   DV_ORG       Host de la API de Dataverse (def.: https://orge0b27328.api.crm2.dynamics.com)
 *   DV_ENV_FILE  .env con MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET
 *                (def.: el .env del proyecto Rindegastos, que usa la misma aplicación)
 *
 * No existe modo --apply: aplicar cambios será otra etapa, con aprobación explícita.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DV_ORG = process.env.DV_ORG || 'https://orge0b27328.api.crm2.dynamics.com';
const DV_ENV_FILE =
  process.env.DV_ENV_FILE ||
  'C:/Users/Andree/Desktop/Bliss Project/PROYECTOS SOFTWARE/Rindegastos/.env';
const TEST_FOLDER = '268fc376-5272-4411-9ae8-361460772ddc'; // fotos de los médicos de prueba antiguos

// ───────────────────────────── utilidades ─────────────────────────────
const readEnv = file => {
  const env = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return env;
};
const digits = s => String(s ?? '').replace(/\D/g, '');
const cmp6 = s => {
  const d = digits(s);
  return d ? d.padStart(6, '0') : '';
};
const stripAccents = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normName = s =>
  stripAccents(s)
    .toLowerCase()
    .replace(/\b(s\.?a\.?c\.?|e\.?i\.?r\.?l\.?|s\.?r\.?l\.?|s\.?a\.?|dra?s?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// Similitud por bigramas (Dice), suficiente para marcar nombres muy distintos.
const sim = (a, b) => {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bg = s => {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  };
  const A = bg(x);
  const B = bg(y);
  let inter = 0;
  A.forEach(g => B.has(g) && inter++);
  return A.size + B.size ? (2 * inter) / (A.size + B.size) : 0;
};
const csvCell = v => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// ───────────────────────────── Dataverse (GET únicamente) ─────────────────────────────
async function dvToken() {
  const env = readEnv(DV_ENV_FILE);
  const res = await fetch(`https://login.microsoftonline.com/${env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.MICROSOFT_CLIENT_ID,
      client_secret: env.MICROSOFT_CLIENT_SECRET,
      scope: `${DV_ORG}/.default`,
    }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`Token Dataverse: ${j.error_description || j.error || res.status}`);
  return j.access_token;
}

async function dvAll(token, set, select) {
  let url = `${DV_ORG}/api/data/v9.2/${set}?$select=${select}`;
  const rows = [];
  while (url) {
    const res = await fetch(url, { // siempre GET: la simulación nunca escribe
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-Version': '4.0' },
    });
    const j = await res.json();
    if (!res.ok) throw new Error(`${set}: ${res.status} ${j.error?.message || ''}`);
    rows.push(...j.value);
    url = j['@odata.nextLink'] || null;
  }
  return rows;
}

// ───────────────────────────── Supabase (GET únicamente) ─────────────────────────────
async function loadLocations() {
  const env = readEnv(path.join(ROOT, '.env'));
  const url = env.VITE_SUPABASE_URL || 'https://yqgnssxyimiigoewiidr.supabase.co';
  const key = env.VITE_SUPABASE_ANON_KEY;
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/bm_locations?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Range: `${from}-${from + 999}` },
    });
    const part = await res.json();
    if (!res.ok) throw new Error(`Supabase: ${res.status} ${JSON.stringify(part).slice(0, 200)}`);
    rows.push(...part);
    if (part.length < 1000) break;
  }
  return rows;
}

// ───────────────────────────── simulación ─────────────────────────────
const token = await dvToken();
const [contacts, groups, addresses, locations] = await Promise.all([
  dvAll(
    token,
    'crb7e_contactosmaestros',
    'crb7e_contactosmaestroid,crb7e_idcontacto,crb7e_nombre,crb7e_nombrecomercial,crb7e_numerodedocumento,crb7e_ruc,crb7e_ruc10,crb7e_cmp,crb7e_celularprincipal,crb7e_instagram,_crb7e_ge_value,statecode',
  ),
  dvAll(token, 'crb7e_gruposeconomicoses', 'crb7e_gruposeconomicosid,crb7e_idge,crb7e_nombrege,statecode'),
  dvAll(token, 'crb7e_direccionesmaestras', 'crb7e_direccionesmaestraid,_crb7e_contacto_value,crb7e_sede,crb7e_direccion,crb7e_latitud,crb7e_longitud,statecode'),
  loadLocations(),
]);

const byDoc = new Map();
const byCmp = new Map();
const push = (map, k, v) => {
  if (!k) return;
  const l = map.get(k) || [];
  if (!l.includes(v)) l.push(v);
  map.set(k, l);
};
for (const c of contacts) {
  for (const f of ['crb7e_numerodedocumento', 'crb7e_ruc', 'crb7e_ruc10']) {
    const d = digits(c[f]);
    if (d.length === 8 || d.length === 11) push(byDoc, d, c);
  }
  push(byCmp, cmp6(c.crb7e_cmp), c);
}
const geByCode = new Map(groups.map(g => [g.crb7e_idge, g]));
const geByGuid = new Map(groups.map(g => [g.crb7e_gruposeconomicosid, g]));
const addrByContact = new Map();
for (const a of addresses) if (a.statecode === 0) push(addrByContact, a._crb7e_contacto_value, a);

const validCoord = (lat, lng) => Number.isFinite(lat) && Number.isFinite(lng) && !(lat === 0 && lng === 0);

const plan = locations.map(r => {
  const cf = r.custom_fields || {};
  const isDoctor = r.id.startsWith('b2c-cmp-');
  const isTest = (r.image_url || '').includes(TEST_FOLDER);
  const hasPhoto = Boolean(r.image_url) && !isTest;

  // llaves de identidad de la ficha
  const docs = new Set();
  for (const part of String(cf.Documento || '').split(/[|,;/]/)) {
    const d = digits(part);
    if (d.length === 8 || d.length === 11) docs.add(d);
  }
  for (const m of r.id.matchAll(/(?<!\d)(\d{8}|\d{11})(?!\d)/g)) docs.add(m[1]);
  const cmps = new Set();
  for (const k of ['CMP', 'Colegiatura']) if (cmp6(cf[k])) cmps.add(cmp6(cf[k]));
  const mc = r.id.match(/^b2c-cmp-(\d+)/);
  if (mc) cmps.add(cmp6(mc[1]));

  const out = {
    id: r.id,
    locator: String(r.locator_id).slice(0, 8),
    name: r.name,
    has_photo: hasPhoto,
    status: '',
    reason: '',
    dv_contact: '',
    dv_guid: '',
    dv_related: '',
    dv_name: '',
    name_sim: '',
    name_action: hasPhoto ? 'PROTEGIDO (foto)' : '',
    ge_action: '',
    fill_fields: '',
  };

  if (isTest) return { ...out, status: 'excluida', reason: 'ficha de prueba antigua' };

  // 1) candidatos por llave
  let linked = []; // contactos a vincular
  if (isDoctor) {
    const hits = [...cmps].flatMap(k => byCmp.get(k) || []);
    const uniq = [...new Map(hits.map(c => [c.crb7e_contactosmaestroid, c])).values()];
    if (!cmps.size) return { ...out, status: 'revision', reason: 'sin CMP ni documento' };
    if (uniq.length === 0) return { ...out, status: 'revision', reason: 'CMP sin coincidencia en Dataverse' };
    if (uniq.length > 1) return { ...out, status: 'revision', reason: `CMP repetido en ${uniq.length} contactos` };
    linked = uniq;
  } else {
    if (!docs.size && !cmps.size) return { ...out, status: 'revision', reason: 'sin documento ni CMP' };
    const per = [...docs].map(d => ({ d, list: byDoc.get(d) || [] }));
    const dup = per.find(p => p.list.length > 1);
    if (dup) return { ...out, status: 'revision', reason: `documento ${dup.d} repetido en ${dup.list.length} contactos` };
    linked = per.filter(p => p.list.length === 1).map(p => p.list[0]);
    linked = [...new Map(linked.map(c => [c.crb7e_contactosmaestroid, c])).values()];
    if (!linked.length) return { ...out, status: 'revision', reason: 'documento sin coincidencia en Dataverse' };
  }

  // 2) contacto principal: el que coincide con el documento principal de la ficha
  const primaryDoc = (r.id.match(/(?<!\d)(\d{8}|\d{11})(?!\d)/) || [])[1] || [...docs][0];
  const primary = linked.find(c => [c.crb7e_numerodedocumento, c.crb7e_ruc, c.crb7e_ruc10].some(f => digits(f) === primaryDoc)) || linked[0];
  const related = linked.filter(c => c !== primary);
  out.status = 'vinculo_automatico';
  out.reason = related.length ? `${linked.length} documentos del mismo grupo` : 'coincidencia única';
  out.dv_contact = primary.crb7e_idcontacto;
  out.dv_guid = primary.crb7e_contactosmaestroid;
  out.dv_related = related.map(c => c.crb7e_idcontacto).join(' ');
  out.dv_name = primary.crb7e_nombrecomercial || primary.crb7e_nombre || '';
  out.name_sim = sim(r.name, out.dv_name).toFixed(2);

  // 3) nombre: nunca se cambia solo. Sin foto solo se SUGIERE el nombre comercial de Dataverse.
  if (!hasPhoto) {
    out.name_action = out.dv_name && sim(r.name, out.dv_name) < 0.85 ? `SUGERIR "${out.dv_name}"` : 'sin cambio';
  }

  // 4) grupo económico
  const dvGe = primary._crb7e_ge_value ? geByGuid.get(primary._crb7e_ge_value) : null;
  const bmGeCode = cf.crb7e_idge || '';
  if (bmGeCode && dvGe) {
    out.ge_action = bmGeCode === dvGe.crb7e_idge ? 'coincide' : `REVISAR: PlazaDerma ${bmGeCode} vs Dataverse ${dvGe.crb7e_idge}`;
    if (bmGeCode !== dvGe.crb7e_idge) { out.status = 'revision'; out.reason = 'grupo económico distinto'; }
  } else if (!bmGeCode && dvGe) out.ge_action = `PROPONER ${dvGe.crb7e_idge} ${dvGe.crb7e_nombrege || ''}`.trim();
  else if (bmGeCode && !dvGe) out.ge_action = geByCode.has(bmGeCode) ? 'contacto de Dataverse sin GE' : 'GE inexistente en Dataverse';

  // 5) campos vacíos que Dataverse podría completar (nunca sobrescribe valores existentes)
  const fill = [];
  if (!r.phone && primary.crb7e_celularprincipal) fill.push('teléfono');
  if (!r.instagram && primary.crb7e_instagram) fill.push('instagram');
  const dir = (addrByContact.get(primary.crb7e_contactosmaestroid) || [])[0];
  if (dir) {
    if (!validCoord(r.lat, r.lng) && validCoord(parseFloat(dir.crb7e_latitud), parseFloat(dir.crb7e_longitud))) fill.push('coordenadas');
    if ((!r.address || r.address.trim().length < 6) && dir.crb7e_direccion) fill.push('dirección');
  }
  out.fill_fields = fill.join(', ');
  return out;
});

// ───────────────────────────── salida ─────────────────────────────
const stamp = new Date().toISOString().slice(0, 10);
const dir = path.join(ROOT, 'backups', `sync_sim_${stamp}`);
fs.mkdirSync(dir, { recursive: true });

const cols = Object.keys(plan[0]);
fs.writeFileSync(
  path.join(dir, 'plan.csv'),
  '\uFEFF' + [cols.join(','), ...plan.map(p => cols.map(c => csvCell(p[c])).join(','))].join('\n'),
);
fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify(plan, null, 1));

const count = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
const photo = plan.filter(p => p.has_photo);
const lines = [];
lines.push(`# Simulación de sincronización PlazaDerma <-> Dataverse (${stamp})`);
lines.push('', '**Solo simulación: no se escribió nada en Supabase ni en Dataverse.**', '');
lines.push(`Fichas: ${plan.length} · con foto: ${photo.length} · contactos Dataverse: ${contacts.length} · grupos: ${groups.length}`, '');
lines.push('## Estado de vínculo (todas / con foto)');
for (const [k, v] of Object.entries(count(plan, p => p.status))) lines.push(`- ${k}: ${v} / ${photo.filter(p => p.status === k).length}`);
lines.push('', '## Motivos de revisión (todas)');
for (const [k, v] of Object.entries(count(plan.filter(p => p.status === 'revision'), p => p.reason.replace(/\d{8,11}/, 'N').replace(/ \d+ contactos/, ' N contactos')))) lines.push(`- ${k}: ${v}`);
lines.push('', '## Protección de fichas con foto');
lines.push(`- Nombre y foto protegidos: ${photo.length} (ningún cambio de nombre ni foto se propone para ellas)`);
lines.push(`- Con foto y nombre distinto al de Dataverse (se conserva el de PlazaDerma): ${photo.filter(p => p.dv_guid && Number(p.name_sim) < 0.6).length}`);
lines.push('', '## Cambios que se PROPONDRÍAN (sin foto)');
lines.push(`- Nombres a sugerir: ${plan.filter(p => p.name_action.startsWith('SUGERIR')).length}`);
lines.push('', '## Grupo económico');
for (const [k, v] of Object.entries(count(plan.filter(p => p.ge_action), p => (p.ge_action.startsWith('contacto') ? 'contacto de Dataverse sin GE' : p.ge_action.split(' ')[0].replace(':', ''))))) lines.push(`- ${k}: ${v}`);
lines.push('', '## Campos vacíos que Dataverse completaría');
const fills = {};
for (const p of plan) for (const f of p.fill_fields.split(', ').filter(Boolean)) fills[f] = (fills[f] || 0) + 1;
for (const [k, v] of Object.entries(fills)) lines.push(`- ${k}: ${v}`);
if (!Object.keys(fills).length) lines.push('- ninguno');
fs.writeFileSync(path.join(dir, 'resumen.md'), lines.join('\n') + '\n');

console.log(lines.join('\n'));
console.log(`\nArchivos en: ${dir}`);
