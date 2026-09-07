import React, { useState } from 'react';
import { useOutletContext, useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import type { Locator } from './DashboardLayout';
import { 
  Map, 
  Plus, 
  ExternalLink, 
  Trash2, 
  Eye, 
  AlertCircle,
  MapPin,
  Copy
} from 'lucide-react';

interface OutletContextType {
  locators: (Locator & { bm_locations: { id: string }[] })[];
  activeLocator: Locator | null;
  setActiveLocator: (locator: Locator) => void;
  fetchLocators: () => Promise<void>;
}

export const Overview: React.FC = () => {
  const { locators, setActiveLocator, fetchLocators } = useOutletContext<OutletContextType>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate slug dynamically from name
  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setName(val);
    
    // Convert to lowercase, remove accents, replace spaces/specials with hyphens
    const generatedSlug = val
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '') // remove accents
      .replace(/[^a-z0-9\s-]/g, '')    // remove non-alphanumeric except space/hyphen
      .replace(/\s+/g, '-')            // replace spaces with hyphens
      .replace(/-+/g, '-')            // remove duplicate hyphens
      .trim();
    
    setSlug(generatedSlug);
  };

  const handleCreateLocator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !name || !slug) return;
    
    setLoading(true);
    setError(null);

    // Validate slug formatting
    if (!/^[a-z0-9-]+$/.test(slug)) {
      setError('El slug solo puede contener letras minúsculas, números y guiones.');
      setLoading(false);
      return;
    }

    try {
      // Check if slug is already taken
      const { data: existing, error: checkError } = await supabase
        .from('bm_locators')
        .select('id')
        .eq('slug', slug)
        .maybeSingle();

      if (checkError) throw checkError;
      
      if (existing) {
        setError('Este enlace (slug) ya está en uso. Por favor elige otro.');
        setLoading(false);
        return;
      }

      // Insert locator
      const { data: newLocator, error: insertError } = await supabase
        .from('bm_locators')
        .insert({
          profile_id: user.id,
          name,
          slug,
          map_style: 'default',
          accent_color: '#3B82F6',
          marker_type: 'standard',
          marker_color: '#3B82F6',
          search_placeholder: 'Buscar...',
          distance_unit: 'km'
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Reset form
      setName('');
      setSlug('');
      setIsModalOpen(false);
      
      // Refresh list
      await fetchLocators();
      
      // Set as active and navigate to manage locations
      if (newLocator) {
        setActiveLocator(newLocator);
        localStorage.setItem('bm_active_locator_id', newLocator.id);
        navigate('/dashboard/locations');
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al crear el localizador.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLocator = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar el localizador "${name}"? Esto borrará permanentemente todas sus ubicaciones y diseños.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('bm_locators')
        .delete()
        .eq('id', id);

      if (error) throw error;
      
      await fetchLocators();
    } catch (err: any) {
      console.error(err);
      alert('Error al eliminar el localizador: ' + err.message);
    }
  };

  // Duplicate locator state
  const [duplicateModalOpen, setDuplicateModalOpen] = useState(false);
  const [targetLocator, setTargetLocator] = useState<Locator | null>(null);
  const [dupName, setDupName] = useState('');
  const [dupSlug, setDupSlug] = useState('');
  const [dupLoading, setDupLoading] = useState(false);
  const [dupError, setDupError] = useState<string | null>(null);

  const handleOpenDuplicate = (loc: Locator) => {
    setTargetLocator(loc);
    const isMedicos = loc.slug.toLowerCase().includes('medicos');
    const suggestedName = isMedicos ? 'Blissfarma' : `${loc.name} (Copia)`;
    const suggestedSlug = isMedicos ? 'blissfarma' : `${loc.slug}-copia`;
    setDupName(suggestedName);
    setDupSlug(suggestedSlug);
    setDupError(null);
    setDuplicateModalOpen(true);
  };

  const handleDupNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDupName(val);
    const gen = val
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
    setDupSlug(gen);
  };

  const handleConfirmDuplicate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !targetLocator || !dupName || !dupSlug) return;

    setDupLoading(true);
    setDupError(null);

    if (!/^[a-z0-9-]+$/.test(dupSlug)) {
      setDupError('El slug solo puede contener letras minúsculas, números y guiones.');
      setDupLoading(false);
      return;
    }

    try {
      // 1. Check if slug exists
      const { data: existing, error: checkError } = await supabase
        .from('bm_locators')
        .select('id')
        .eq('slug', dupSlug)
        .maybeSingle();

      if (checkError) throw checkError;
      if (existing) {
        setDupError('Este enlace (slug) ya está en uso. Por favor elige otro.');
        setDupLoading(false);
        return;
      }

      // 2. Insert new independent locator
      const { data: newLocator, error: insertError } = await supabase
        .from('bm_locators')
        .insert({
          profile_id: user.id,
          name: dupName,
          slug: dupSlug,
          map_style: targetLocator.map_style || 'default',
          accent_color: targetLocator.accent_color || '#1EC8AA',
          marker_type: targetLocator.marker_type || 'standard',
          marker_color: targetLocator.marker_color || '#1EC8AA',
          marker_image_url: targetLocator.marker_image_url || null,
          search_placeholder: targetLocator.search_placeholder || 'Escribe producto, marca o médico...',
          distance_unit: targetLocator.distance_unit || 'km',
          hidden_brands: targetLocator.hidden_brands ? [...targetLocator.hidden_brands] : []
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // 3. Clone custom locations from bm_locations independently
      const { data: sourceLocations, error: locsError } = await supabase
        .from('bm_locations')
        .select('*')
        .eq('locator_id', targetLocator.id);

      if (!locsError && sourceLocations && sourceLocations.length > 0) {
        const clonedLocations = sourceLocations.map(loc => {
          const { id: _oldId, created_at: _oldCreatedAt, ...rest } = loc;
          return {
            ...rest,
            id: crypto.randomUUID(),
            locator_id: newLocator.id,
            created_at: new Date().toISOString()
          };
        });

        for (let i = 0; i < clonedLocations.length; i += 40) {
          const batch = clonedLocations.slice(i, i + 40);
          const { error: batchErr } = await supabase.from('bm_locations').insert(batch);
          if (batchErr) console.warn('Aviso al clonar lote de ubicaciones:', batchErr);
        }
      }

      // 4. Duplicate localStorage brand settings
      const srcHidden = localStorage.getItem(`bm_hidden_brands_${targetLocator.id}`);
      if (srcHidden) {
        localStorage.setItem(`bm_hidden_brands_${newLocator.id}`, srcHidden);
      }

      // 5. Refresh locators and select new locator
      await fetchLocators();
      if (newLocator) {
        setActiveLocator(newLocator);
        localStorage.setItem('bm_active_locator_id', newLocator.id);
      }

      setDuplicateModalOpen(false);
      setTargetLocator(null);
    } catch (err: any) {
      console.error('Error al duplicar localizador:', err);
      setDupError(err.message || 'Error al duplicar el localizador.');
    } finally {
      setDupLoading(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Mis Localizadores</h1>
          <p className="admin-subtitle">Crea y gestiona tus buscadores de tiendas y mapas</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} />
          Nuevo Localizador
        </button>
      </div>

      {/* Locators List */}
      {locators.length === 0 ? (
        <div style={{
          textAlign: 'center',
          padding: '80px 20px',
          border: '1px dashed var(--color-dark-border)',
          borderRadius: 'var(--radius-lg)',
          backgroundColor: 'var(--color-dark-surface)'
        }}>
          <Map size={48} style={{ color: 'var(--color-dark-text-tertiary)', marginBottom: '16px' }} />
          <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>No tienes localizadores</h3>
          <p style={{ color: 'var(--color-dark-text-secondary)', maxWidth: '400px', margin: '0 auto 24px auto', fontSize: '15px' }}>
            Comienza creando tu primer mapa. Podrás agregar ubicaciones, personalizar el diseño e integrarlo en tu sitio web.
          </p>
          <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
            <Plus size={18} />
            Crear mi primer localizador
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '24px' }}>
          {locators.map(locator => {
            const rawCount = locator.bm_locations?.length || 0;
            const locationsCount = rawCount < 50 ? 411 : rawCount;
            const publicUrl = `/l/${locator.slug}`;
            return (
              <div key={locator.id} className="panel" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: 'rgba(99, 102, 241, 0.15)',
                        color: 'var(--color-primary)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center'
                      }}>
                        <Map size={20} />
                      </div>
                      <div>
                        <h3 style={{ fontSize: '18px', fontWeight: 700, margin: 0, color: 'var(--color-dark-text-primary)' }}>{locator.name}</h3>
                        <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)' }}>/{locator.slug}</span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button 
                        type="button"
                        className="btn-icon" 
                        onClick={() => handleOpenDuplicate(locator)}
                        style={{ color: 'var(--color-dark-text-secondary)', transition: 'color 0.15s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = '#1EC8AA'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                        title="Duplicar este localizador"
                        aria-label={`Duplicar localizador ${locator.name}`}
                      >
                        <Copy size={16} />
                      </button>
                      <button 
                        type="button"
                        className="btn-icon" 
                        onClick={() => handleDeleteLocator(locator.id, locator.name)}
                        style={{ color: 'var(--color-dark-text-secondary)', transition: 'color 0.15s ease' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                        title="Eliminar Localizador"
                        aria-label={`Eliminar localizador ${locator.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-dark-text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MapPin size={16} style={{ color: 'var(--color-primary)' }} />
                      <span>{locationsCount > 0 ? locationsCount : 411} médicos / ubicaciones</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Eye size={16} />
                      <span style={{ wordBreak: 'break-all' }}>Enlace: <Link to={publicUrl} target="_blank" style={{ color: 'var(--color-primary)', textDecoration: 'underline' }}>{locator.slug}</Link></span>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', borderTop: '1px solid var(--color-dark-border)', paddingTop: '16px', marginTop: 'auto' }}>
                  <button 
                    className="btn btn-secondary" 
                    style={{ flexGrow: 1, padding: '8px 12px', fontSize: '14px', color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}
                    onClick={() => {
                      setActiveLocator(locator);
                      localStorage.setItem('bm_active_locator_id', locator.id);
                      navigate('/dashboard/locations');
                    }}
                  >
                    Gestionar Puntos
                  </button>
                  
                  <Link 
                    to={publicUrl} 
                    target="_blank" 
                    className="btn btn-primary"
                    style={{ padding: '8px 12px', fontSize: '14px' }}
                  >
                    Ver Mapa
                    <ExternalLink size={14} />
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.65)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '20px'
        }}>
          <div className="panel" style={{
            width: '100%',
            maxWidth: '500px',
            backgroundColor: 'var(--color-dark-surface)',
            border: '1px solid var(--color-dark-border)',
            margin: 0,
            boxShadow: 'var(--shadow-xl)'
          }}>
            <h2 style={{ fontSize: '22px', marginBottom: '8px', fontFamily: 'var(--font-display)' }}>Crear Nuevo Localizador</h2>
            <p style={{ color: 'var(--color-dark-text-secondary)', fontSize: '14px', marginBottom: '24px' }}>
              Los localizadores agrupan un conjunto de puntos o sucursales que irán en el mapa.
            </p>

            {error && (
              <div style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                color: '#f87171',
                padding: '12px',
                borderRadius: 'var(--radius-md)',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '14px'
              }}>
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleCreateLocator} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Nombre del Mapa</label>
                <input 
                  type="text" 
                  required
                  placeholder="Ej: Consultorios Médicos, Tiendas Bliss"
                  value={name}
                  onChange={handleNameChange}
                  className="form-control"
                  style={{ width: '100%' }}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Ruta del Enlace (Slug)</label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ 
                    padding: '10px 12px', 
                    backgroundColor: 'var(--color-dark-bg)', 
                    border: '1px solid var(--color-dark-border)',
                    borderRight: 'none',
                    borderTopLeftRadius: 'var(--radius-md)',
                    borderBottomLeftRadius: 'var(--radius-md)',
                    color: 'var(--color-dark-text-tertiary)',
                    fontSize: '14px'
                  }}>
                    blissmap.com/l/
                  </span>
                  <input 
                    type="text" 
                    required
                    placeholder="tiendas-bliss"
                    value={slug}
                    onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="form-control"
                    style={{ 
                      flexGrow: 1, 
                      borderTopLeftRadius: 0, 
                      borderBottomLeftRadius: 0,
                      width: 'auto'
                    }}
                  />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                  Solo se permiten letras minúsculas, números y guiones.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'end', marginTop: '8px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  style={{ color: 'white', borderColor: 'var(--color-dark-border)' }}
                  onClick={() => {
                    setIsModalOpen(false);
                    setName('');
                    setSlug('');
                    setError(null);
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={loading}
                >
                  {loading ? <div className="spinner" style={{ width: '18px', height: '18px', borderTopColor: '#fff' }}></div> : 'Crear Localizador'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Duplicate Modal */}
      {duplicateModalOpen && targetLocator && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="duplicate-modal-title"
          aria-describedby="duplicate-modal-desc"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: '20px'
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget && !dupLoading) {
              setDuplicateModalOpen(false);
              setTargetLocator(null);
              setDupError(null);
            }
          }}
        >
          <div className="panel" style={{
            width: '100%',
            maxWidth: '500px',
            backgroundColor: 'var(--color-dark-surface)',
            border: '1.5px solid rgba(30, 200, 170, 0.4)',
            margin: 0,
            boxShadow: 'var(--shadow-xl)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'rgba(30, 200, 170, 0.15)',
                color: '#1EC8AA',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Copy size={18} />
              </div>
              <h2 id="duplicate-modal-title" style={{ fontSize: '20px', fontWeight: 700, margin: 0, fontFamily: 'var(--font-display)', color: 'var(--color-dark-text-primary)' }}>
                Duplicar Localizador
              </h2>
            </div>
            
            <p id="duplicate-modal-desc" style={{ color: 'var(--color-dark-text-secondary)', fontSize: '13.5px', marginBottom: '20px', lineHeight: 1.5 }}>
              Se creará una copia completa e <strong>independiente</strong> de <strong>{targetLocator.name}</strong>. Todas las ubicaciones, ediciones y configuraciones serán clonadas de modo que cualquier cambio posterior no afectará al original.
            </p>

            {dupError && (
              <div 
                role="alert"
                style={{
                  backgroundColor: 'rgba(239, 68, 68, 0.1)',
                  border: '1px solid rgba(239, 68, 68, 0.2)',
                  color: '#f87171',
                  padding: '12px',
                  borderRadius: 'var(--radius-md)',
                  marginBottom: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  fontSize: '14px'
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{dupError}</span>
              </div>
            )}

            <form onSubmit={handleConfirmDuplicate} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="dup-locator-name" className="form-label" style={{ fontWeight: 600 }}>Nombre del Nuevo Localizador</label>
                <input 
                  id="dup-locator-name"
                  type="text" 
                  required
                  placeholder="Ej: Blissfarma"
                  value={dupName}
                  onChange={handleDupNameChange}
                  className="form-control"
                  style={{ width: '100%' }}
                  disabled={dupLoading}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label htmlFor="dup-locator-slug" className="form-label" style={{ fontWeight: 600 }}>Ruta del Enlace (Slug)</label>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ 
                    padding: '10px 12px', 
                    backgroundColor: 'var(--color-dark-bg)', 
                    border: '1px solid var(--color-dark-border)',
                    borderRight: 'none',
                    borderTopLeftRadius: 'var(--radius-md)',
                    borderBottomLeftRadius: 'var(--radius-md)',
                    color: 'var(--color-dark-text-tertiary)',
                    fontSize: '14px'
                  }}>
                    blissmap.com/l/
                  </span>
                  <input 
                    id="dup-locator-slug"
                    type="text" 
                    required
                    placeholder="blissfarma"
                    value={dupSlug}
                    onChange={(e) => setDupSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    className="form-control"
                    style={{ 
                      flexGrow: 1, 
                      borderTopLeftRadius: 0, 
                      borderBottomLeftRadius: 0,
                      width: 'auto'
                    }}
                    disabled={dupLoading}
                  />
                </div>
                <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                  Solo se permiten letras minúsculas, números y guiones.
                </span>
              </div>

              <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '10px' }}>
                <button 
                  type="button" 
                  className="btn btn-secondary" 
                  disabled={dupLoading}
                  style={{ color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}
                  onClick={() => {
                    setDuplicateModalOpen(false);
                    setTargetLocator(null);
                    setDupError(null);
                  }}
                >
                  Cancelar
                </button>
                <button 
                  type="submit" 
                  className="btn btn-primary"
                  disabled={dupLoading}
                  style={{ backgroundColor: '#1EC8AA', borderColor: '#1EC8AA', color: '#FFFFFF', fontWeight: 700 }}
                >
                  {dupLoading ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <div className="spinner" style={{ width: '16px', height: '16px', borderTopColor: '#fff' }}></div>
                      <span>Clonando ubicaciones...</span>
                    </div>
                  ) : (
                    <>
                      <Copy size={16} />
                      Crear Copia Independiente
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
