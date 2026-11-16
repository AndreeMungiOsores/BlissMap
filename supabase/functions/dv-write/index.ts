// Edge Function `dv-write`: escribe en Dataverse las ediciones MANUALES hechas en el panel de PlazaDerma.
//
// Reglas (no negociables):
//  - Solo cuentas de la lista dv_write_allowlist. El token de Dataverse nunca sale de aquí.
//  - Una sola ficha por llamada, solo los campos editados; nunca masivo ni automático.
//  - `confirmed: true` solo lo envía el panel después de la doble confirmación del usuario.
//  - Control de concurrencia: se escribe con If-Match (etag leído en `read`). Si Dataverse cambió entretanto -> 409, no se pisa.
//  - Solo se escriben campos de una lista cerrada; el nombre nunca se escribe.
//  - Todo intento (bueno o malo) queda en dv_write_log con el antes y el después.

const DV_ORG = (Deno.env.get('DV_ORG') ?? '').replace(/\/$/, '');
const DV_TENANT = Deno.env.get('DV_TENANT_ID') ?? '';
const DV_CLIENT = Deno.env.get('DV_CLIENT_ID') ?? '';
const DV_SECRET = Deno.env.get('DV_CLIENT_SECRET') ?? '';
const SB_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SB_ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SB_SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const ASSET_PREFIX = `${SB_URL}/storage/v1/object/public/bm-locator-assets/`;
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

// ── Dataverse ────────────────────────────────────────────────────────────────
let tokenCache: { value: string; exp: number } | null = null;
async function dvToken(): Promise<string> {
  if (tokenCache && tokenCache.exp > Date.now() + 60_000) return tokenCache.value;
  const r = await fetch(`https://login.microsoftonline.com/${DV_TENANT}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: DV_CLIENT, client_secret: DV_SECRET, scope: `${DV_ORG}/.default` }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('No se pudo autenticar con Microsoft');
  tokenCache = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3000) * 1000 };
  return tokenCache.value;
}
interface DvInit { method?: string; json?: unknown; ifMatch?: string }
async function dv(path: string, init: DvInit = {}) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${await dvToken()}`,
    Accept: 'application/json',
    'OData-Version': '4.0',
    'OData-MaxVersion': '4.0',
    Prefer: 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
  };
  let body: string | undefined;
  if (init.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(init.json); }
  if (init.ifMatch) headers['If-Match'] = init.ifMatch;
  const res = await fetch(`${DV_ORG}/api/data/v9.2/${path}`, { method: init.method ?? 'GET', headers, body });
  const text = await res.text();
  // deno-lint-ignore no-explicit-any
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { status: res.status, ok: res.ok, data };
}
// deno-lint-ignore no-explicit-any
const dvMessage = (r: { status: number; data: any }) => String(r.data?.error?.message ?? r.data?.raw ?? `HTTP ${r.status}`).slice(0, 400);

// ── Supabase ─────────────────────────────────────────────────────────────────
const sbHeaders = { apikey: SB_SERVICE, Authorization: `Bearer ${SB_SERVICE}`, 'Content-Type': 'application/json' };
async function allowedUser(jwt: string): Promise<string | null> {
  const u = await fetch(`${SB_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: SB_ANON } });
  if (!u.ok) return null;
  const email = String((await u.json())?.email ?? '').toLowerCase();
  if (!email) return null;
  const r = await fetch(`${SB_URL}/rest/v1/dv_write_allowlist?email=eq.${encodeURIComponent(email)}&select=email`, { headers: sbHeaders });
  const rows = r.ok ? await r.json() : [];
  return rows.length > 0 ? email : null;
}
interface LogEntry { user: string; op: string; entidad: string; id?: string; codigo?: string; antes?: unknown; despues?: unknown; ok: boolean; error?: string }
async function logWrite(e: LogEntry) {
  await fetch(`${SB_URL}/rest/v1/dv_write_log`, {
    method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
    body: JSON.stringify({ user_email: e.user, op: e.op, entidad: e.entidad, registro_id: e.id ?? null, registro_codigo: e.codigo ?? null, antes: e.antes ?? null, despues: e.despues ?? null, ok: e.ok, error: e.error ?? null }),
  }).catch(() => undefined);
}

// ── Validaciones ─────────────────────────────────────────────────────────────
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isGuid = (v: unknown): v is string => typeof v === 'string' && GUID.test(v);
const CONTACT_FIELDS: Record<string, { col: string; max: number }> = {
  celular: { col: 'crb7e_celularprincipal', max: 40 },
  correo: { col: 'crb7e_correoprincipal', max: 120 },
  instagram: { col: 'crb7e_instagram', max: 200 },
  especialidad: { col: 'crb7e_especialidad', max: 100 },
};
const peruCoord = (la: number, lo: number) => la < 0 && la > -19 && lo < -68 && lo > -82;
const today = () => new Date().toISOString().slice(0, 10);
const vigente = (fin: unknown) => { const f = String(fin ?? '').slice(0, 10); return !(f && f <= today()); };

class Fail extends Error {
  constructor(public status: number, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); }
}

const CONTACT_SELECT = 'crb7e_contactosmaestroid,crb7e_idcontacto,crb7e_nombre,crb7e_nombrecomercial,crb7e_celularprincipal,crb7e_correoprincipal,crb7e_instagram,crb7e_especialidad,_crb7e_ge_value,statecode,crb7e_logo_url';
const ADDR_SELECT = 'crb7e_direccionesmaestraid,crb7e_iddireccion,_crb7e_contacto_value,crb7e_direccion,crb7e_latitud,crb7e_longitud,statecode';

async function getContact(id: string) {
  const r = await dv(`crb7e_contactosmaestros(${id})?$select=${CONTACT_SELECT}`);
  if (r.status === 404) throw new Fail(404, 'no_existe', 'El contacto no existe en Dataverse');
  if (!r.ok) throw new Fail(502, 'dataverse', dvMessage(r));
  if (r.data.statecode !== 0) throw new Fail(409, 'inactivo', 'El contacto está inactivo en Dataverse');
  return { row: r.data, etag: r.data['@odata.etag'] as string };
}
// deno-lint-ignore no-explicit-any
const contactView = (c: any) => ({
  id: c.crb7e_contactosmaestroid, codigo: c.crb7e_idcontacto, nombre: c.crb7e_nombre, nombreComercial: c.crb7e_nombrecomercial,
  celular: c.crb7e_celularprincipal ?? null, correo: c.crb7e_correoprincipal ?? null, instagram: c.crb7e_instagram ?? null, especialidad: c.crb7e_especialidad ?? null,
  geId: c._crb7e_ge_value ?? null, geCodigo: c['_crb7e_ge_value@OData.Community.Display.V1.FormattedValue'] ?? null, tieneLogo: Boolean(c.crb7e_logo_url),
});

interface AddrView { id: string; codigo: string; direccion: string | null; latitud: string | null; longitud: string | null; etag: string; compartidaCon: number; deOtroContacto: boolean }

async function listAddresses(contactId: string): Promise<AddrView[]> {
  const own = await dv(`crb7e_direccionesmaestras?$filter=_crb7e_contacto_value eq ${contactId} and statecode eq 0&$select=${ADDR_SELECT}`);
  if (!own.ok) throw new Fail(502, 'dataverse', dvMessage(own));
  // deno-lint-ignore no-explicit-any
  const rows: Array<{ a: any; deOtro: boolean }> = (own.data.value as any[]).map(a => ({ a, deOtro: false }));
  // Sedes compartidas mediante Contacto por Sede (la dirección puede pertenecer a otro contacto).
  const links = await dv(`crb7e_contactoporsedes?$filter=_crb7e_contacto_value eq ${contactId} and statecode eq 0&$select=_crb7e_sede_value,crb7e_fechadefin`);
  const have = new Set(rows.map(r => r.a.crb7e_direccionesmaestraid));
  if (links.ok) {
    // deno-lint-ignore no-explicit-any
    for (const l of links.data.value as any[]) {
      if (!vigente(l.crb7e_fechadefin) || have.has(l._crb7e_sede_value)) continue;
      const a = await dv(`crb7e_direccionesmaestras(${l._crb7e_sede_value})?$select=${ADDR_SELECT}`);
      if (a.ok && a.data.statecode === 0) { rows.push({ a: a.data, deOtro: true }); have.add(a.data.crb7e_direccionesmaestraid); }
    }
  }
  const out: AddrView[] = [];
  for (const { a, deOtro } of rows) {
    const sh = await dv(`crb7e_contactoporsedes?$filter=_crb7e_sede_value eq ${a.crb7e_direccionesmaestraid} and statecode eq 0&$select=_crb7e_contacto_value,crb7e_fechadefin`);
    const set = new Set<string>();
    // deno-lint-ignore no-explicit-any
    if (sh.ok) for (const l of sh.data.value as any[]) if (vigente(l.crb7e_fechadefin)) set.add(l._crb7e_contacto_value);
    if (a._crb7e_contacto_value) set.add(a._crb7e_contacto_value);
    set.delete(contactId);
    out.push({
      id: a.crb7e_direccionesmaestraid, codigo: a.crb7e_iddireccion, direccion: a.crb7e_direccion ?? null,
      latitud: a.crb7e_latitud ?? null, longitud: a.crb7e_longitud ?? null, etag: a['@odata.etag'], compartidaCon: set.size, deOtroContacto: deOtro,
    });
  }
  return out;
}

// deno-lint-ignore no-explicit-any
async function opRead(body: any) {
  if (!isGuid(body.contactId)) throw new Fail(400, 'datos', 'contactId inválido');
  const { row, etag } = await getContact(body.contactId);
  const addresses = await listAddresses(body.contactId);
  const af = await dv(`crb7e_doctorporsedes?$filter=_crb7e_doctor_value eq ${body.contactId} and statecode eq 0&$select=crb7e_doctorporsedeid,crb7e_iddoctorsede,_crb7e_sede_value,crb7e_fechadefin`);
  // deno-lint-ignore no-explicit-any
  const afiliaciones = af.ok ? (af.data.value as any[]).filter(x => vigente(x.crb7e_fechadefin)).map(x => ({
    id: x.crb7e_doctorporsedeid, codigo: x.crb7e_iddoctorsede, sedeId: x._crb7e_sede_value, sedeCodigo: x['_crb7e_sede_value@OData.Community.Display.V1.FormattedValue'] ?? null,
  })) : [];
  return { contact: { ...contactView(row), etag }, addresses, afiliaciones };
}

// deno-lint-ignore no-explicit-any
async function opWrite(body: any, user: string) {
  if (body.confirmed !== true) throw new Fail(400, 'sin_confirmacion', 'Falta la confirmación del usuario');
  if (!isGuid(body.contactId)) throw new Fail(400, 'datos', 'contactId inválido');
  const results: Array<Record<string, unknown>> = [];
  const { row: cur, etag } = await getContact(body.contactId);
  const codigo = cur.crb7e_idcontacto as string;
  if (body.contactEtag && body.contactEtag !== etag) throw new Fail(409, 'conflicto', 'Dataverse cambió este contacto después de que abriste la ficha. Vuelve a abrirla para ver el dato actual.', { campo: 'contacto' });

  // 1) Contacto: campos de texto + grupo económico (en una sola escritura)
  const patch: Record<string, unknown> = {};
  const antes: Record<string, unknown> = {}, despues: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body.contact ?? {})) {
    const def = CONTACT_FIELDS[k];
    if (!def) throw new Fail(400, 'campo_no_permitido', `Campo no permitido: ${k}`);
    const val = v === null || v === '' ? null : String(v).trim();
    if (val !== null && val.length > def.max) throw new Fail(400, 'datos', `${k} excede ${def.max} caracteres`);
    if (k === 'correo' && val && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) throw new Fail(400, 'datos', 'Correo inválido');
    if ((cur[def.col] ?? null) === val) continue; // sin cambio real
    antes[k] = cur[def.col] ?? null; despues[k] = val; patch[def.col] = val;
  }
  let clearGe = false;
  if (body.ge !== undefined) {
    const nuevo = body.ge?.id ?? null;
    if (nuevo !== null && !isGuid(nuevo)) throw new Fail(400, 'datos', 'Grupo económico inválido');
    if ((body.ge?.expectedId ?? null) !== (cur._crb7e_ge_value ?? null)) throw new Fail(409, 'conflicto', 'El grupo económico de este contacto cambió en Dataverse. Vuelve a abrir la ficha.', { campo: 'grupo' });
    if (nuevo !== (cur._crb7e_ge_value ?? null)) {
      if (nuevo) {
        const g = await dv(`crb7e_gruposeconomicoses(${nuevo})?$select=crb7e_idge,statecode`);
        if (!g.ok || g.data.statecode !== 0) throw new Fail(409, 'grupo_invalido', 'El grupo económico no existe o está inactivo en Dataverse');
        patch['crb7e_GE@odata.bind'] = `/crb7e_gruposeconomicoses(${nuevo})`;
        despues.ge = g.data.crb7e_idge;
      } else { clearGe = true; despues.ge = null; }
      antes.ge = cur['_crb7e_ge_value@OData.Community.Display.V1.FormattedValue'] ?? cur._crb7e_ge_value ?? null;
    }
  }
  if (Object.keys(patch).length > 0) {
    const r = await dv(`crb7e_contactosmaestros(${body.contactId})`, { method: 'PATCH', json: patch, ifMatch: etag });
    await logWrite({ user, op: 'write', entidad: patch['crb7e_GE@odata.bind'] ? 'grupo' : 'contacto', id: body.contactId, codigo, antes, despues, ok: r.ok, error: r.ok ? undefined : dvMessage(r) });
    if (r.status === 412) throw new Fail(409, 'conflicto', 'Dataverse cambió este contacto mientras guardabas. No se escribió nada; vuelve a intentarlo.', { campo: 'contacto' });
    if (!r.ok) throw new Fail(422, 'rechazado', `Dataverse rechazó el cambio: ${dvMessage(r)}`);
    results.push({ parte: 'contacto', ok: true, antes, despues });
  }
  if (clearGe) {
    const r = await dv(`crb7e_contactosmaestros(${body.contactId})/crb7e_GE/$ref`, { method: 'DELETE' });
    await logWrite({ user, op: 'write', entidad: 'grupo', id: body.contactId, codigo, antes: { ge: antes.ge }, despues: { ge: null }, ok: r.ok, error: r.ok ? undefined : dvMessage(r) });
    if (!r.ok) throw new Fail(422, 'rechazado', `Dataverse rechazó quitar el grupo: ${dvMessage(r)}`);
    results.push({ parte: 'grupo', ok: true, antes: { ge: antes.ge }, despues: { ge: null } });
  }

  // 2) Dirección de envío y coordenadas
  if (body.address) {
    const a = body.address;
    if (!isGuid(a.id)) throw new Fail(400, 'datos', 'Dirección inválida');
    const addrs = await listAddresses(body.contactId);
    const mine = addrs.find(x => x.id === a.id);
    if (!mine) throw new Fail(403, 'no_pertenece', 'Esa dirección no pertenece a este contacto');
    if ((mine.deOtroContacto || mine.compartidaCon > 0) && a.confirmShared !== true) {
      throw new Fail(409, 'sede_compartida', `Esta sede es compartida con ${mine.compartidaCon} contacto(s) más; el cambio los afecta a todos. Confirma para continuar.`, { campo: 'direccion', compartidaCon: mine.compartidaCon });
    }
    if (a.etag && a.etag !== mine.etag) throw new Fail(409, 'conflicto', 'Dataverse cambió esta dirección después de que abriste la ficha. Vuelve a abrirla.', { campo: 'direccion' });
    const ap: Record<string, unknown> = {}; const aAntes: Record<string, unknown> = {}, aDesp: Record<string, unknown> = {};
    if (a.direccion !== undefined) {
      const val = String(a.direccion ?? '').trim();
      if (!val || val.length > 300) throw new Fail(400, 'datos', 'Dirección vacía o demasiado larga');
      if (val !== (mine.direccion ?? '')) { ap.crb7e_direccion = val; aAntes.direccion = mine.direccion; aDesp.direccion = val; }
    }
    if (a.latitud !== undefined || a.longitud !== undefined) {
      const la = Number(a.latitud), lo = Number(a.longitud);
      if (!Number.isFinite(la) || !Number.isFinite(lo) || !peruCoord(la, lo)) throw new Fail(400, 'datos', 'Coordenadas fuera de rango (Perú)');
      const sla = String(la), slo = String(lo);
      if (sla !== String(mine.latitud ?? '') || slo !== String(mine.longitud ?? '')) {
        ap.crb7e_latitud = sla; ap.crb7e_longitud = slo; aAntes.coordenadas = `${mine.latitud}, ${mine.longitud}`; aDesp.coordenadas = `${sla}, ${slo}`;
      }
    }
    if (Object.keys(ap).length > 0) {
      const r = await dv(`crb7e_direccionesmaestras(${a.id})`, { method: 'PATCH', json: ap, ifMatch: mine.etag });
      await logWrite({ user, op: 'write', entidad: 'direccion', id: a.id, codigo: mine.codigo, antes: aAntes, despues: aDesp, ok: r.ok, error: r.ok ? undefined : dvMessage(r) });
      if (r.status === 412) throw new Fail(409, 'conflicto', 'Dataverse cambió esta dirección mientras guardabas. No se escribió; vuelve a intentarlo.', { campo: 'direccion' });
      if (!r.ok) throw new Fail(422, 'rechazado', `Dataverse rechazó la dirección: ${dvMessage(r)}`);
      results.push({ parte: 'direccion', ok: true, antes: aAntes, despues: aDesp });
    }
  }

  // 3) Foto -> Logo
  if (body.logo) {
    const url = String(body.logo.url ?? '');
    if (!url.startsWith(ASSET_PREFIX)) throw new Fail(400, 'datos', 'La imagen debe estar en el almacenamiento de PlazaDerma');
    if (cur.crb7e_logo_url && body.logo.overwrite !== true) throw new Fail(409, 'logo_existente', 'Dataverse ya tiene un logo para este contacto. Confirma para reemplazarlo.', { campo: 'logo' });
    const img = await fetch(url);
    const buf = new Uint8Array(await img.arrayBuffer());
    if (!img.ok || buf.length === 0 || buf.length > MAX_LOGO_BYTES) throw new Fail(400, 'datos', 'Imagen no disponible o mayor a 10 MB');
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    const r = await dv(`crb7e_contactosmaestros(${body.contactId})`, { method: 'PATCH', json: { crb7e_logo: btoa(bin) }, ifMatch: '*' });
    let ok = r.ok; let msg = r.ok ? undefined : dvMessage(r);
    if (ok) { // verificación por tamaño
      const dl = await fetch(`${DV_ORG}/api/data/v9.2/crb7e_contactosmaestros(${body.contactId})/crb7e_logo/$value?size=full`, { headers: { Authorization: `Bearer ${await dvToken()}` } });
      const got = new Uint8Array(await dl.arrayBuffer());
      if (got.length !== buf.length) { ok = false; msg = `Verificación fallida (${got.length} != ${buf.length} bytes)`; }
    }
    await logWrite({ user, op: 'write', entidad: 'logo', id: body.contactId, codigo, antes: { tenia_logo: Boolean(cur.crb7e_logo_url) }, despues: { bytes: buf.length, origen: url }, ok, error: msg });
    if (!ok) throw new Fail(422, 'rechazado', `No se pudo guardar el logo: ${msg}`);
    results.push({ parte: 'logo', ok: true, despues: { bytes: buf.length } });
  }

  return { ok: true, results, sinCambios: results.length === 0 };
}

// deno-lint-ignore no-explicit-any
async function opAffiliationAdd(body: any, user: string) {
  if (body.confirmed !== true) throw new Fail(400, 'sin_confirmacion', 'Falta la confirmación del usuario');
  if (!isGuid(body.doctorId) || !isGuid(body.sedeId)) throw new Fail(400, 'datos', 'Médico o sede inválidos');
  const { row: doc } = await getContact(body.doctorId);
  const sede = await dv(`crb7e_direccionesmaestras(${body.sedeId})?$select=crb7e_iddireccion,statecode,_crb7e_contacto_value`);
  if (!sede.ok || sede.data.statecode !== 0) throw new Fail(404, 'no_existe', 'La sede no existe o está inactiva en Dataverse');
  const dup = await dv(`crb7e_doctorporsedes?$filter=_crb7e_doctor_value eq ${body.doctorId} and _crb7e_sede_value eq ${body.sedeId} and statecode eq 0&$select=crb7e_doctorporsedeid,crb7e_fechadefin`);
  // deno-lint-ignore no-explicit-any
  if (dup.ok && (dup.data.value as any[]).some(x => vigente(x.crb7e_fechadefin))) throw new Fail(409, 'ya_existe', 'Esa afiliación ya existe y está vigente en Dataverse');
  const r = await dv('crb7e_doctorporsedes', {
    method: 'POST',
    json: { 'crb7e_Doctor@odata.bind': `/crb7e_contactosmaestros(${body.doctorId})`, 'crb7e_Sede@odata.bind': `/crb7e_direccionesmaestras(${body.sedeId})`, crb7e_fechadeinicio: today() },
  });
  const despues = { doctor: doc.crb7e_idcontacto, sede: sede.data.crb7e_iddireccion, desde: today() };
  await logWrite({ user, op: 'affiliation_add', entidad: 'afiliacion', id: body.doctorId, codigo: doc.crb7e_idcontacto, antes: null, despues, ok: r.ok, error: r.ok ? undefined : dvMessage(r) });
  if (!r.ok) throw new Fail(422, 'rechazado', `Dataverse rechazó la afiliación: ${dvMessage(r)}`);
  return { ok: true, results: [{ parte: 'afiliacion', ok: true, despues }] };
}

// deno-lint-ignore no-explicit-any
async function opAffiliationEnd(body: any, user: string) {
  if (body.confirmed !== true) throw new Fail(400, 'sin_confirmacion', 'Falta la confirmación del usuario');
  if (!isGuid(body.id)) throw new Fail(400, 'datos', 'Afiliación inválida');
  const cur = await dv(`crb7e_doctorporsedes(${body.id})?$select=crb7e_iddoctorsede,crb7e_fechadefin,statecode`);
  if (!cur.ok) throw new Fail(404, 'no_existe', 'La afiliación no existe en Dataverse');
  if (cur.data.statecode !== 0 || !vigente(cur.data.crb7e_fechadefin)) throw new Fail(409, 'ya_cerrada', 'Esa afiliación ya está cerrada en Dataverse');
  // No se borra: se cierra con fecha de fin (queda el histórico).
  const r = await dv(`crb7e_doctorporsedes(${body.id})`, { method: 'PATCH', json: { crb7e_fechadefin: today() }, ifMatch: cur.data['@odata.etag'] });
  await logWrite({ user, op: 'affiliation_end', entidad: 'afiliacion', id: body.id, codigo: cur.data.crb7e_iddoctorsede, antes: { fin: cur.data.crb7e_fechadefin ?? null }, despues: { fin: today() }, ok: r.ok, error: r.ok ? undefined : dvMessage(r) });
  if (!r.ok) throw new Fail(422, 'rechazado', `Dataverse rechazó cerrar la afiliación: ${dvMessage(r)}`);
  return { ok: true, results: [{ parte: 'afiliacion', ok: true, despues: { fin: today() } }] };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { ok: false, code: 'metodo', message: 'Método no permitido' });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const user = jwt ? await allowedUser(jwt) : null;
    if (!user) return json(403, { ok: false, code: 'sin_permiso', message: 'Tu cuenta no está autorizada para escribir en Dataverse.' });
    const body = await req.json();
    switch (body?.op) {
      case 'read': return json(200, { ok: true, ...(await opRead(body)) });
      case 'write': return json(200, await opWrite(body, user));
      case 'affiliation_add': return json(200, await opAffiliationAdd(body, user));
      case 'affiliation_end': return json(200, await opAffiliationEnd(body, user));
      default: return json(400, { ok: false, code: 'op', message: 'Operación desconocida' });
    }
  } catch (e) {
    if (e instanceof Fail) return json(e.status, { ok: false, code: e.code, message: e.message, ...e.extra });
    return json(500, { ok: false, code: 'interno', message: 'Error interno al hablar con Dataverse' });
  }
});
