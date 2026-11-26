import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import type { Locator } from '../pages/dashboard/DashboardLayout';

interface LocatorContext {
  locators?: Locator[];
  activeLocator: Locator | null;
  setActiveLocator?: (l: Locator) => void;
}

/**
 * Selector de localizador para los módulos del panel donde SÍ se filtra por localizador
 * (Ubicaciones, Afiliaciones, Diseño y Marcadores, Integrar). Los grupos económicos son globales y no lo usan.
 * La elección se recuerda entre módulos (bm_active_locator_id).
 */
export const LocatorSelector: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
  const { locators = [], activeLocator, setActiveLocator } = useOutletContext<LocatorContext>();
  if (locators.length === 0) return null;

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = locators.find(l => l.id === e.target.value);
    if (selected && setActiveLocator) {
      setActiveLocator(selected);
      localStorage.setItem('bm_active_locator_id', selected.id);
    }
  };

  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px', fontWeight: 700, color: 'var(--color-dark-text-secondary)', ...style }}>
      <MapIcon size={14} />
      <span style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Localizador</span>
      <select
        value={activeLocator?.id || ''}
        onChange={onChange}
        aria-label="Localizador activo"
        style={{
          padding: '7px 10px',
          borderRadius: 'var(--radius-md)',
          border: '1px solid #E5DFD5',
          backgroundColor: '#FAF8F5',
          color: 'var(--color-dark-text-primary)',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {locators.map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
    </label>
  );
};
