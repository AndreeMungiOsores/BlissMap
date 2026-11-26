import React from 'react';

/** Localizadores (slugs) donde está publicada una ficha: una misma ficha puede salir en varios localizadores. */
export const locatorSlugsOf = (cf?: Record<string, string>): string[] => {
  const raw = cf?.['_locator_slugs'] || cf?.['_locator_slug'] || '';
  return raw.split(',').map(x => x.trim()).filter(Boolean);
};

export const locatorNameOf = (slug: string): string => (slug === 'blissfarma' ? 'Blissfarma' : 'MedicosBliss');

const pill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '11px',
  fontWeight: 600,
  padding: '2px 8px',
  borderRadius: '999px',
  backgroundColor: 'transparent',
  border: '1px solid var(--color-dark-border)',
  color: 'var(--color-dark-text-secondary)',
  whiteSpace: 'nowrap',
};

/** Una píldora discreta (sin color ni íconos) por cada localizador donde está publicada la ficha. */
export const LocatorChips: React.FC<{ cf?: Record<string, string> }> = ({ cf }) => (
  <>
    {locatorSlugsOf(cf).map(slug => (
      <span key={slug} style={pill}>{locatorNameOf(slug)}</span>
    ))}
  </>
);

/** "Visible en Blissfarma · MedicosBliss" u "Oculto en …", en una sola píldora discreta. */
export const VisibilityPill: React.FC<{ cf?: Record<string, string>; visible: boolean; fallbackSlug?: string }> = ({ cf, visible, fallbackSlug = 'medicosbliss' }) => {
  const slugs = locatorSlugsOf(cf);
  const names = (slugs.length > 0 ? slugs : [fallbackSlug]).map(locatorNameOf).join(' · ');
  return (
    <span style={pill} title={visible ? `Publicado y visible en el mapa de ${names}` : `Oculto: no se ve en el mapa de ${names}`}>
      {visible ? 'Visible en' : 'Oculto en'} {names}
    </span>
  );
};
