import React from 'react';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { ActiveGroup, LocationItem } from '../services/groupService';
import { EconomicGroupMasterCard } from './EconomicGroupMasterCard';
import { LocatorChips, VisibilityPill } from './LocatorPills';

interface Props {
  group: ActiveGroup | null;
  loading: boolean;
  locations: LocationItem[];
  onBack: () => void;
  onEdit: (group: ActiveGroup) => void;
}

const box: React.CSSProperties = { border: '1px solid var(--color-dark-border)', borderRadius: '10px', padding: '14px 16px', backgroundColor: 'var(--color-dark-surface)' };

/**
 * Vista (página, no ventana emergente) con la ficha completa de un grupo económico.
 * La ficha maestra sale de Dataverse; lo único editable hoy es la composición de fichas de PlazaDerma
 * (cuál es la principal, quitar o separar), y por eso el botón Editar vive solo en esa sección.
 */
export const EconomicGroupFichaView: React.FC<Props> = ({ group, loading, locations, onBack, onEdit }) => {
  const back = (
    <button
      type="button"
      onClick={onBack}
      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-dark-text-secondary)', fontSize: '13px', padding: 0 }}
    >
      <ArrowLeft size={14} /> Grupos Económicos
    </button>
  );

  if (!group) {
    return (
      <div>
        <div style={{ marginBottom: '16px' }}>{back}</div>
        <div style={{ ...box, fontSize: '14px', color: 'var(--color-dark-text-secondary)' }}>
          {loading ? 'Cargando ficha del grupo…' : 'Este grupo ya no existe o fue separado. Vuelve a la lista para ver los grupos vigentes.'}
        </div>
      </div>
    );
  }

  const ge = group.officialGe;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        {back}
        <span style={{ color: 'var(--color-dark-border)' }}>/</span>
        <span style={{ fontSize: '13px', color: 'var(--color-dark-text-tertiary)' }}>{ge?.nombre || group.primary.name}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-dark-text-primary)', margin: 0 }}>{group.primary.name}</h1>
        <VisibilityPill cf={group.primary.custom_fields} visible={group.primary.published !== false} />
      </div>

      {ge?.idge ? (
        <EconomicGroupMasterCard codigoGe={ge.idge} locations={locations} />
      ) : (
        <div style={{ ...box, fontSize: '13px', color: 'var(--color-dark-text-secondary)', marginBottom: '20px' }}>
          Este grupo todavía no tiene un grupo económico asignado en Dataverse, por eso no hay ficha maestra. Se arma solo con las fichas de abajo.
        </div>
      )}

      <div style={box}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--color-dark-text-primary)' }}>Fichas de PlazaDerma de este grupo</div>
            <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
              Son las fichas que se muestran en los mapas. La principal es la que se ve; las demás quedan unidas a ella.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onEdit(group)}
            className="btn btn-secondary"
            style={{ fontSize: '12px', padding: '7px 14px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', border: '1px solid var(--color-dark-border)', backgroundColor: 'white', color: 'var(--color-dark-text-primary)', cursor: 'pointer' }}
          >
            <Pencil size={13} /> Editar fichas
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {group.members.map(m => (
            <div key={m.id} style={{ border: '1px solid var(--color-dark-border)', borderRadius: '8px', padding: '10px 12px', display: 'flex', gap: '12px', alignItems: 'center' }}>
              {m.image_url ? (
                <img src={m.image_url} alt={m.name} style={{ width: '40px', height: '40px', borderRadius: '8px', objectFit: 'contain', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '40px', height: '40px', borderRadius: '8px', backgroundColor: 'rgba(0,80,110,0.07)', flexShrink: 0 }} />
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '14px', fontWeight: 700 }}>{m.name}</span>
                  {m.id === group.primary.id && (
                    <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-dark-text-secondary)' }}>· Ficha principal</span>
                  )}
                  <LocatorChips cf={m.custom_fields} />
                </div>
                <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', overflowWrap: 'anywhere' }}>
                  {(m.custom_fields?.['Razón Social'] || m.custom_fields?.['Razon Social'] || '') && <>RS: {m.custom_fields['Razón Social'] || m.custom_fields['Razon Social']} · </>}
                  {m.custom_fields?.['Documento'] ? <>Doc: {m.custom_fields['Documento']} · </> : null}
                  {m.address || 'Sin dirección registrada'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
