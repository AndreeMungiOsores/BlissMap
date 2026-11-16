import React, { useState } from 'react';
import { Database, AlertTriangle } from 'lucide-react';

export interface DvChange {
  label: string;
  before: string;
  after: string;
}

interface Props {
  title?: string;
  subject: string; // ficha / contacto afectado, p. ej. "Dermedic (CTO-001716)"
  changes: DvChange[];
  warnings?: string[];
  busy?: boolean;
  error?: string | null;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Aviso de doble confirmación antes de escribir en Dataverse:
 *  1) se muestra exactamente qué campos cambian (antes → después);
 *  2) el usuario debe marcar que entiende que se guardará en Dataverse y luego pulsar el botón.
 */
export const DataverseConfirmModal: React.FC<Props> = ({
  title = 'Esto se guardará también en Dataverse',
  subject,
  changes,
  warnings = [],
  busy = false,
  error = null,
  confirmLabel = 'Guardar en PlazaDerma y Dataverse',
  onConfirm,
  onCancel,
}) => {
  const [understood, setUnderstood] = useState(false);
  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, padding: '16px' }}
    >
      <div
        style={{ width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto', background: 'var(--color-dark-surface)', border: '1px solid var(--color-dark-border)', borderRadius: '12px', padding: '22px', color: 'var(--color-dark-text-primary)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <Database size={20} />
          <h3 style={{ margin: 0, fontSize: '17px' }}>{title}</h3>
        </div>
        <p style={{ margin: '0 0 14px', fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
          Contacto en Dataverse: <strong style={{ color: 'var(--color-dark-text-primary)' }}>{subject}</strong>. Solo se escribirán estos campos; el resto de Dataverse no se toca.
        </p>

        <div style={{ border: '1px solid var(--color-dark-border)', borderRadius: '8px', overflow: 'hidden', marginBottom: '14px' }}>
          {changes.map((c, i) => (
            <div key={i} style={{ padding: '10px 12px', borderTop: i ? '1px solid var(--color-dark-border)' : 'none', fontSize: '13px' }}>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>{c.label}</div>
              <div style={{ color: 'var(--color-dark-text-secondary)' }}>Ahora en Dataverse: <span style={{ textDecoration: 'line-through' }}>{c.before || '(vacío)'}</span></div>
              <div>Quedará: <strong>{c.after || '(vacío)'}</strong></div>
            </div>
          ))}
        </div>

        {warnings.map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.4)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '10px' }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: '2px' }} />
            <span>{w}</span>
          </div>
        ))}

        <label style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '13px', margin: '14px 0', cursor: 'pointer' }}>
          <input type="checkbox" checked={understood} onChange={e => setUnderstood(e.target.checked)} style={{ marginTop: '3px' }} />
          <span>Entiendo que este cambio modifica la base de datos de Dataverse (Entorno de Sistemas) y que quedará registrado a mi nombre.</span>
        </label>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '10px 12px', fontSize: '13px', marginBottom: '12px' }}>{error}</div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy} style={{ color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}>
            Cancelar (no se guarda nada)
          </button>
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={!understood || busy}>
            {busy ? 'Guardando…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
