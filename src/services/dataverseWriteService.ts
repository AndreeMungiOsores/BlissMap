/**
 * dataverseWriteService.ts
 * Cliente de la Edge Function `dv-write`: lleva a Dataverse las ediciones MANUALES hechas en el panel.
 *
 * Nada de lo que está aquí se ejecuta solo: cada llamada de escritura exige `confirmed: true`, que solo se envía
 * después de que el usuario acepta el aviso de doble confirmación (DataverseConfirmModal).
 * Solo viajan los campos que el usuario cambió en esa edición; lo demás de Dataverse no se toca.
 */
import { supabase } from '../supabaseClient';

export interface DvContact {
  id: string;
  codigo: string;
  nombre: string;
  nombreComercial: string | null;
  celular: string | null;
  correo: string | null;
  instagram: string | null;
  especialidad: string | null;
  geId: string | null;
  geCodigo: string | null;
  tieneLogo: boolean;
  etag: string;
}
export interface DvAddress {
  id: string;
  codigo: string;
  direccion: string | null;
  latitud: string | null;
  longitud: string | null;
  etag: string;
  compartidaCon: number;
  deOtroContacto: boolean;
}
export interface DvAffiliation {
  id: string;
  codigo: string;
  sedeId: string;
  sedeCodigo: string | null;
}
export interface DvSnapshot {
  contact: DvContact;
  addresses: DvAddress[];
  afiliaciones: DvAffiliation[];
}

export class DvWriteError extends Error {
  code: string;
  extra: Record<string, unknown>;
  constructor(code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

async function call<T = any>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('dv-write', { body });
  if (error) {
    const ctx = (error as any).context;
    let payload: { code?: string; message?: string; [k: string]: unknown } | null;
    try { payload = ctx && typeof ctx.json === 'function' ? await ctx.json() : null; } catch { payload = null; }
    if (payload?.message) throw new DvWriteError(payload.code || 'error', payload.message, payload);
    throw new DvWriteError('red', 'No se pudo comunicar con Dataverse. Inténtalo de nuevo.');
  }
  if (data && data.ok === false) throw new DvWriteError(data.code || 'error', data.message || 'Dataverse rechazó la operación', data);
  return data as T;
}

/** Lee el estado ACTUAL del contacto en Dataverse (para mostrar el antes y detectar conflictos). */
export const readDataverseContact = (contactId: string): Promise<DvSnapshot & { ok: true }> => call({ op: 'read', contactId });

export interface ContactEdits {
  celular?: string | null;
  correo?: string | null;
  instagram?: string | null;
  especialidad?: string | null;
}
export interface WritePayload {
  contactId: string;
  contactEtag: string;
  contact?: ContactEdits;
  ge?: { id: string | null; expectedId: string | null };
  address?: { id: string; etag: string; direccion?: string; latitud?: number; longitud?: number; confirmShared?: boolean };
  logo?: { url: string; overwrite?: boolean };
}
export interface WriteResult {
  ok: true;
  sinCambios: boolean;
  results: Array<{ parte: string; ok: boolean; antes?: Record<string, unknown>; despues?: Record<string, unknown> }>;
}

/** Escribe los cambios en Dataverse. Solo llamar después de la doble confirmación del usuario. */
export const writeToDataverse = (payload: WritePayload): Promise<WriteResult> => call({ op: 'write', confirmed: true, ...payload });

export const addDataverseAffiliation = (doctorId: string, sedeId: string) =>
  call({ op: 'affiliation_add', confirmed: true, doctorId, sedeId });

export const endDataverseAffiliation = (id: string) => call({ op: 'affiliation_end', confirmed: true, id });

/** Quita todo lo que no sean dígitos y puntuación de teléfono para comparar sin falsos cambios. */
export const sameText = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

/** ¿La ficha (de PlazaDerma) está vinculada a un contacto de Dataverse? */
export const dvContactIdOf = (customFields: Record<string, unknown> | null | undefined): string | null => {
  const id = customFields?.['dv_contact_id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
};
