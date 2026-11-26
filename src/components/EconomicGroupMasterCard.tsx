import React, { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin, Stethoscope, Database, AtSign, Image as ImageIcon } from 'lucide-react';
import type { LocationItem } from '../services/groupService';
import {
  loadGroupMasterRaw,
  buildGroupMaster,
  contactDisplayName,
  type MasterRaw,
} from '../services/groupMasterService';

interface Props {
  /** Código del grupo en Dataverse (GE-xxxx). */
  codigoGe: string;
  /** Fichas del portal de TODOS los localizadores (para logo, ventas y canales). */
  locations: LocationItem[];
}

const chip = (bg: string, color: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  fontSize: '11px',
  fontWeight: 700,
  padding: '3px 9px',
  borderRadius: '999px',
  backgroundColor: bg,
  color,
});
const label: React.CSSProperties = { fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginBottom: '2px' };
const value: React.CSSProperties = { fontSize: '14px', fontWeight: 600, color: 'var(--color-dark-text-primary)', overflowWrap: 'anywhere', wordBreak: 'break-word', minWidth: 0 };
const box: React.CSSProperties = { border: '1px solid var(--color-dark-border)', borderRadius: '10px', padding: '12px 14px', backgroundColor: 'var(--color-dark-surface)' };

/**
 * Ficha maestra de un grupo económico (vista global, no depende del localizador):
 * datos generales, perfiles económicos (razones sociales), sedes con sus médicos y perfiles, y canales de publicación.
 * Todo sale de las tablas maestras de Dataverse (espejo); las fichas del portal solo aportan logo, ventas y canales.
 */
export const EconomicGroupMasterCard: React.FC<Props> = ({ codigoGe, locations }) => {
  const [raw, setRaw] = useState<MasterRaw | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadGroupMasterRaw(codigoGe)
      .then(r => {
        if (cancelled) return;
        setRaw(r);
        setLoading(false);
      })
      .catch(err => {
        if (cancelled) return;
        console.warn('[Grupo] No se pudo cargar la ficha maestra:', err);
        setError('No se pudo cargar la ficha maestra desde Dataverse.');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [codigoGe]);

  const master = useMemo(() => (raw ? buildGroupMaster(raw, locations) : null), [raw, locations]);

  if (loading) return <div style={{ ...box, fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>Cargando ficha maestra del grupo…</div>;
  if (error) return <div style={{ ...box, fontSize: '13px', color: '#b91c1c' }}>{error}</div>;
  if (!master) {
    return (
      <div style={{ ...box, fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
        El grupo {codigoGe} aún no está en el espejo de Dataverse. Se verá en la próxima sincronización (cada hora).
      </div>
    );
  }

  const { grupo } = master;
  const faltante = (v: string | null | undefined) => (v && v.trim() ? v : <span style={{ color: 'var(--color-dark-text-tertiary)', fontWeight: 500 }}>Por completar</span>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginBottom: '22px' }}>
      <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-dark-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        Ficha maestra del cliente (datos de Dataverse · {grupo.codigo})
      </div>

      {/* Cabecera */}
      <div style={{ ...box, display: 'flex', gap: '14px', alignItems: 'center' }}>
        <div style={{ width: '64px', height: '64px', borderRadius: '12px', backgroundColor: 'rgba(0,80,110,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 }}>
          {master.logo ? <img src={master.logo} alt={master.nombreComercial} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <Building2 size={26} style={{ color: '#00506E' }} />}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '19px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>{master.nombreComercial}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
            <span style={chip('rgba(34,197,94,0.14)', '#15803d')}>Cliente único</span>
            <span style={chip('rgba(100,116,139,0.14)', 'var(--color-dark-text-secondary)')}>
              {master.perfiles.length} {master.perfiles.length === 1 ? 'perfil económico' : 'perfiles económicos'}
            </span>
            <span style={chip('rgba(100,116,139,0.14)', 'var(--color-dark-text-secondary)')}>
              {master.sedes.length} {master.sedes.length === 1 ? 'sede' : 'sedes'}
            </span>
            {grupo.rol && <span style={chip('rgba(124,58,237,0.12)', '#7c3aed')}>{grupo.rol}</span>}
          </div>
        </div>
      </div>

      {/* Información general */}
      <div style={box}>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px' }}>Información general</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(240px, 100%), 1fr))', gap: '12px 24px' }}>
          <div><div style={label}>Nombre comercial</div><div style={value}>{master.nombreComercial}</div></div>
          <div>
            <div style={label}>Propietario</div>
            <div style={value}>{faltante(master.propietarios.join(' · '))}</div>
          </div>
          <div>
            <div style={label}>Instagram</div>
            <div style={{ ...value, display: 'flex', alignItems: 'flex-start', gap: '5px' }}>
              {master.instagram ? (
                <>
                  <AtSign size={14} style={{ flexShrink: 0, marginTop: '3px' }} />
                  <a
                    href={/^https?:\/\//i.test(master.instagram) ? master.instagram : `https://${master.instagram}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'inherit', minWidth: 0, overflowWrap: 'anywhere' }}
                    title={master.instagram}
                  >
                    {master.instagram.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '').toLowerCase()}
                  </a>
                </>
              ) : faltante(null)}
            </div>
          </div>
          <div>
            <div style={label}>Identidad visual</div>
            <div style={{ ...value, display: 'flex', alignItems: 'center', gap: '5px' }}>
              <ImageIcon size={14} />
              {master.logo ? `Logo y ${master.fotos.length} ${master.fotos.length === 1 ? 'fotografía' : 'fotografías'}` : faltante(null)}
            </div>
          </div>
        </div>
        {master.personas.length > 0 && (
          <div style={{ marginTop: '12px', fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
            Personas del grupo: {master.personas.map(p => `${contactDisplayName(p)}${p.especialidad ? ` (${p.especialidad})` : ''}`).join(' · ')}
          </div>
        )}
      </div>

      {/* Perfiles económicos */}
      <div style={box}>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Building2 size={15} /> Perfiles económicos <span style={chip('rgba(100,116,139,0.14)', 'var(--color-dark-text-secondary)')}>{master.perfiles.length}</span>
        </div>
        {master.perfiles.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-dark-text-tertiary)' }}>Este grupo no tiene perfiles económicos en Dataverse.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {master.perfiles.map(p => (
            <div key={p.contacto.id} style={{ border: '1px solid var(--color-dark-border)', borderRadius: '8px', padding: '10px 12px' }}>
              <div style={{ fontSize: '14px', fontWeight: 700 }}>{p.contacto.nombre || contactDisplayName(p.contacto)}</div>
              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                {p.etiquetaDocumento} · {p.contacto.codigo}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <Database size={12} />
                {p.fichas.length === 0
                  ? 'Sin ficha de ventas vinculada en el portal'
                  : `Ventas y productos vía ERP: ${p.totalProductos} ${p.totalProductos === 1 ? 'producto' : 'productos'} · ${p.fichas.length} ${p.fichas.length === 1 ? 'ficha' : 'fichas'}`}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Sedes */}
      <div style={box}>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <MapPin size={15} /> Sedes <span style={chip('rgba(100,116,139,0.14)', 'var(--color-dark-text-secondary)')}>{master.sedes.length}</span>
        </div>
        {master.sedes.length === 0 && <div style={{ fontSize: '13px', color: 'var(--color-dark-text-tertiary)' }}>Este grupo no tiene sedes (direcciones de envío) en Dataverse.</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {master.sedes.map(s => (
            <div key={s.id} style={{ border: '1px solid var(--color-dark-border)', borderRadius: '8px', padding: '12px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px', fontWeight: 700 }}>
                <MapPin size={14} style={{ color: '#0d9488' }} /> {s.nombre}
                {s.codigo && <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-dark-text-tertiary)' }}>{s.codigo}</span>}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', margin: '2px 0 8px 20px' }}>{s.direccion || 'Sin dirección registrada'}</div>
              <div style={{ borderTop: '1px solid var(--color-dark-border)', paddingTop: '8px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '8px 20px' }}>
                <div>
                  <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '4px' }}><Stethoscope size={12} /> Médicos vinculados ({s.medicos.length})</div>
                  <div style={{ fontSize: '13px' }}>
                    {s.medicos.length === 0
                      ? <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Ninguno registrado en Dataverse</span>
                      : s.medicos.map(m => <div key={m.id}>{contactDisplayName(m)}{m.cmp ? <span style={{ color: 'var(--color-dark-text-tertiary)' }}> · CMP {m.cmp}</span> : null}</div>)}
                  </div>
                </div>
                <div>
                  <div style={{ ...label, display: 'flex', alignItems: 'center', gap: '4px' }}><Building2 size={12} /> Perfiles económicos asociados ({s.perfiles.length})</div>
                  <div style={{ fontSize: '13px' }}>
                    {s.perfiles.length === 0
                      ? <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Ninguno</span>
                      : s.perfiles.map(p => (
                          <div key={p.contacto.id}>
                            {p.contacto.nombre || contactDisplayName(p.contacto)}
                            {!p.delGrupo && <span style={{ color: '#b45309' }}> · de otro grupo</span>}
                          </div>
                        ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Canales de publicación */}
      <div style={box}>
        <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '8px' }}>Canales de publicación</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
          {master.canales.map(c => (
            <span key={c.slug} style={{ ...chip('transparent', c.fichas > 0 ? 'var(--color-dark-text-secondary)' : 'var(--color-dark-text-tertiary)'), fontWeight: 600, border: '1px solid var(--color-dark-border)' }}>
              {c.nombre} · {c.fichas > 0 ? `${c.fichas} ${c.fichas === 1 ? 'ficha' : 'fichas'}` : 'sin ficha'}
            </span>
          ))}
        </div>
        <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '8px' }}>
          El grupo es único; las fichas de cada localizador son solo canales de publicación del mismo cliente.
        </div>
      </div>
    </div>
  );
};
