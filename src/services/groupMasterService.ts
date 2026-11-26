/**
 * groupMasterService.ts
 * Ficha maestra de un grupo económico, armada con las TABLAS MAESTRAS de Dataverse (espejo en Supabase):
 *
 *   Grupo económico (1) ── (N) Perfiles económicos   = contactos del grupo con RUC (razones sociales)
 *                      └── (N) Sedes                  = Direcciones Maestra de esos contactos (+ sedes compartidas)
 *   Sede (N) ── (M) Perfiles económicos               = Contacto por Sede
 *   Sede (N) ── (M) Médicos                           = Doctor por Sede
 *   Perfil económico (1) ── (N) Ventas                = productos de las fichas del portal vinculadas a ese contacto
 *
 * El grupo es GLOBAL: no depende del localizador elegido. Los canales de publicación salen de en qué localizadores
 * existen fichas del grupo. Nada de esto escribe en ninguna parte: solo lectura.
 */
import { supabase } from '../supabaseClient';
import type { LocationItem } from './groupService';

export interface MasterGrupo {
  id: string;
  codigo: string;
  nombre: string | null;
  propietario: string | null;
  propietario_contacto_id: string | null;
  rol: string | null;
  estado: number | null;
}
export interface MasterContacto {
  id: string;
  codigo: string | null;
  nombre: string | null;
  nombre_comercial: string | null;
  documento: string | null;
  ruc: string | null;
  ruc10: string | null;
  cmp: string | null;
  ge_id: string | null;
  estado: number | null;
  instagram: string | null;
  especialidad: string | null;
  tiene_logo: boolean | null;
}
export interface MasterDireccion {
  id: string;
  codigo: string | null;
  contacto_id: string | null;
  sede: string | null;
  direccion: string | null;
  latitud: string | null;
  longitud: string | null;
  estado: number | null;
}
interface RelSede {
  id: string;
  codigo: string | null;
  sede_id: string;
  inicio: string | null;
  fin: string | null;
  estado: number | null;
}
export interface MasterContactoSede extends RelSede { contacto_id: string }
export interface MasterDoctorSede extends RelSede { doctor_id: string }

export interface MasterRaw {
  grupo: MasterGrupo;
  miembros: MasterContacto[];
  direcciones: MasterDireccion[];
  contactoSede: MasterContactoSede[];
  doctorSede: MasterDoctorSede[];
  /** Contactos citados por las relaciones (médicos y perfiles de otros grupos). */
  otros: MasterContacto[];
}

const CONTACT_COLS = 'id,codigo,nombre,nombre_comercial,documento,ruc,ruc10,cmp,ge_id,estado,instagram,especialidad,tiene_logo';
const DIR_COLS = 'id,codigo,contacto_id,sede,direccion,latitud,longitud,estado';

const chunk = <T,>(list: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

async function selectIn<T>(table: string, cols: string, column: string, ids: string[]): Promise<T[]> {
  const unique = [...new Set(ids.filter(Boolean))];
  const out: T[] = [];
  for (const part of chunk(unique, 60)) {
    const { data, error } = await supabase.from(table).select(cols).in(column, part);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as T[]));
  }
  return out;
}

/** Descarga del espejo todo lo que necesita la ficha maestra de un grupo (por código GE-xxxx). */
export async function loadGroupMasterRaw(codigoGe: string): Promise<MasterRaw | null> {
  const g = await supabase.from('dv_mirror_grupos').select('id,codigo,nombre,propietario,propietario_contacto_id,rol,estado').eq('codigo', codigoGe).maybeSingle();
  if (g.error) throw g.error;
  if (!g.data) return null;
  const grupo = g.data as MasterGrupo;

  const m = await supabase.from('dv_mirror_contactos').select(CONTACT_COLS).eq('ge_id', grupo.id).eq('estado', 0);
  if (m.error) throw m.error;
  const miembros = (m.data ?? []) as MasterContacto[];
  const memberIds = miembros.map(c => c.id);

  const ownDirs = await selectIn<MasterDireccion>('dv_mirror_direcciones', DIR_COLS, 'contacto_id', memberIds);
  const linksByContact = await selectIn<MasterContactoSede>('dv_mirror_contacto_sede', 'id,codigo,contacto_id,sede_id,inicio,fin,estado', 'contacto_id', memberIds);
  const haveDirs = new Set(ownDirs.map(d => d.id));
  const extraDirs = await selectIn<MasterDireccion>('dv_mirror_direcciones', DIR_COLS, 'id', linksByContact.map(l => l.sede_id).filter(id => !haveDirs.has(id)));
  const direcciones = [...ownDirs, ...extraDirs].filter(d => d.estado === 0);
  const sedeIds = direcciones.map(d => d.id);

  const contactoSede = await selectIn<MasterContactoSede>('dv_mirror_contacto_sede', 'id,codigo,contacto_id,sede_id,inicio,fin,estado', 'sede_id', sedeIds);
  const doctorSede = await selectIn<MasterDoctorSede>('dv_mirror_doctor_sede', 'id,codigo,doctor_id,sede_id,inicio,fin,estado', 'sede_id', sedeIds);

  const known = new Set(memberIds);
  const needed = [
    ...contactoSede.map(l => l.contacto_id),
    ...doctorSede.map(d => d.doctor_id),
    ...direcciones.map(d => d.contacto_id ?? ''),
    grupo.propietario_contacto_id ?? '',
  ].filter(id => id && !known.has(id));
  const otros = await selectIn<MasterContacto>('dv_mirror_contactos', CONTACT_COLS, 'id', needed);
  return { grupo, miembros, direcciones, contactoSede, doctorSede, otros };
}

// ── Modelo de la ficha ─────────────────────────────────────────────────────────

export interface PerfilEconomico {
  contacto: MasterContacto;
  etiquetaDocumento: string; // "RUC 20454250029" / "DNI 12345678"
  fichas: LocationItem[]; // fichas del portal vinculadas a este contacto
  totalProductos: number;
}
export interface SedeMaster {
  id: string;
  codigo: string | null;
  nombre: string;
  direccion: string;
  latitud: string | null;
  longitud: string | null;
  duenio: MasterContacto | null;
  perfiles: Array<{ contacto: MasterContacto; delGrupo: boolean }>;
  medicos: MasterContacto[];
}
export interface CanalPublicacion {
  slug: string;
  nombre: string;
  fichas: number;
}
export interface GroupMaster {
  grupo: MasterGrupo;
  propietarios: string[];
  perfiles: PerfilEconomico[];
  personas: MasterContacto[]; // contactos del grupo sin RUC (propietarios, médicos…)
  sedes: SedeMaster[];
  fichas: LocationItem[];
  logo: string | null;
  fotos: string[];
  instagram: string | null;
  nombreComercial: string;
  canales: CanalPublicacion[];
}

const digits = (v?: string | null): string => String(v ?? '').replace(/\D/g, '');
export const rucOf = (c: MasterContacto): string => {
  for (const f of [c.ruc, c.ruc10, c.documento]) {
    const d = digits(f);
    if (d.length === 11) return d;
  }
  return '';
};
const dniOf = (c: MasterContacto): string => {
  const d = digits(c.documento);
  return d.length === 8 ? d : '';
};
const vigente = (r: { estado: number | null; fin: string | null }): boolean => {
  if (r.estado !== 0) return false;
  const today = new Date().toISOString().slice(0, 10);
  return !(r.fin && r.fin <= today);
};
const displayName = (c: MasterContacto): string => c.nombre_comercial || c.nombre || c.codigo || '(sin nombre)';

const CHANNELS: Array<{ slug: string; nombre: string }> = [
  { slug: 'medicosbliss', nombre: 'MedicosBliss' },
  { slug: 'blissfarma', nombre: 'Blissfarma' },
];

/** Combina el espejo de Dataverse con las fichas del portal (de TODOS los localizadores) para armar la ficha maestra. */
export function buildGroupMaster(raw: MasterRaw, fichasPortal: LocationItem[]): GroupMaster {
  const { grupo, miembros } = raw;
  const byId = new Map<string, MasterContacto>([...miembros, ...raw.otros].map(c => [c.id, c]));
  const memberIds = new Set(miembros.map(c => c.id));

  // Fichas del portal vinculadas a contactos del grupo (por el vínculo exacto guardado en la ficha)
  const fichasByContact = new Map<string, LocationItem[]>();
  const fichas: LocationItem[] = [];
  for (const f of fichasPortal) {
    const cid = f.custom_fields?.['dv_contact_id'];
    if (cid && memberIds.has(cid)) {
      fichas.push(f);
      fichasByContact.set(cid, [...(fichasByContact.get(cid) || []), f]);
    }
  }

  const conRuc = miembros.filter(c => rucOf(c));
  // Si el grupo no tiene ningún RUC (grupo personal de un médico), la persona misma es el perfil económico.
  const perfilesBase = conRuc.length > 0 ? conRuc : miembros.filter(c => dniOf(c));
  const perfiles: PerfilEconomico[] = perfilesBase.map(c => {
    const ruc = rucOf(c);
    const fs = fichasByContact.get(c.id) || [];
    const prod = new Set<string>();
    fs.forEach(f => (f.products || []).forEach(p => prod.add(p.name)));
    return {
      contacto: c,
      etiquetaDocumento: ruc ? `RUC ${ruc}` : `DNI ${dniOf(c)}`,
      fichas: fs,
      totalProductos: prod.size,
    };
  });
  const perfilIds = new Set(perfiles.map(p => p.contacto.id));
  const personas = miembros.filter(c => !perfilIds.has(c.id));

  // Sedes
  const linksBySede = new Map<string, MasterContactoSede[]>();
  raw.contactoSede.filter(vigente).forEach(l => linksBySede.set(l.sede_id, [...(linksBySede.get(l.sede_id) || []), l]));
  const docsBySede = new Map<string, MasterDoctorSede[]>();
  raw.doctorSede.filter(vigente).forEach(d => docsBySede.set(d.sede_id, [...(docsBySede.get(d.sede_id) || []), d]));

  const sedes: SedeMaster[] = raw.direcciones
    .map(d => {
      const duenio = d.contacto_id ? byId.get(d.contacto_id) ?? null : null;
      const perfilMap = new Map<string, { contacto: MasterContacto; delGrupo: boolean }>();
      if (duenio) perfilMap.set(duenio.id, { contacto: duenio, delGrupo: memberIds.has(duenio.id) });
      for (const l of linksBySede.get(d.id) || []) {
        const c = byId.get(l.contacto_id);
        if (c && !perfilMap.has(c.id)) perfilMap.set(c.id, { contacto: c, delGrupo: memberIds.has(c.id) });
      }
      const medicos = [...new Map((docsBySede.get(d.id) || []).map(x => [x.doctor_id, byId.get(x.doctor_id)] as const).filter((e): e is [string, MasterContacto] => Boolean(e[1]))).values()];
      const address = d.direccion || '';
      return {
        id: d.id,
        codigo: d.codigo,
        nombre: d.sede || address.split(',')[0] || d.codigo || 'Sede',
        direccion: address,
        latitud: d.latitud,
        longitud: d.longitud,
        duenio,
        perfiles: [...perfilMap.values()],
        medicos,
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Identidad visual y datos generales
  const withPhoto = fichas.filter(f => f.image_url);
  const logo = withPhoto[0]?.image_url ?? null;
  const fotos = [...new Set(withPhoto.map(f => f.image_url as string))];
  const instagram = miembros.map(c => c.instagram).find(Boolean) || fichas.map(f => f.instagram).find(Boolean) || null;
  const propietarios = [
    ...(grupo.propietario_contacto_id && byId.get(grupo.propietario_contacto_id) ? [displayName(byId.get(grupo.propietario_contacto_id) as MasterContacto)] : []),
    ...(grupo.propietario ? [grupo.propietario] : []),
  ];
  const nombreComercial = grupo.nombre || perfiles[0]?.contacto.nombre_comercial || perfiles[0]?.contacto.nombre || grupo.codigo;

  const canales: CanalPublicacion[] = CHANNELS.map(ch => ({
    slug: ch.slug,
    nombre: ch.nombre,
    fichas: fichas.filter(f => (f.custom_fields?.['_locator_slug'] || '') === ch.slug).length,
  }));

  return {
    grupo,
    propietarios: [...new Set(propietarios)],
    perfiles,
    personas,
    sedes,
    fichas,
    logo,
    fotos,
    instagram,
    nombreComercial,
    canales,
  };
}

export { displayName as contactDisplayName };
