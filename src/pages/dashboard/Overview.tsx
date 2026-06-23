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
  MapPin
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
            const locationsCount = locator.bm_locations?.length || 0;
            const publicUrl = `/l/${locator.slug}`;
            
            return (
              <div key={locator.id} className="panel" style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                justifyContent: 'between',
                height: '100%',
                margin: 0
              }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'start', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: 700 }}>{locator.name}</h3>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button 
                        className="btn-icon" 
                        onClick={() => handleDeleteLocator(locator.id, locator.name)}
                        style={{ color: 'var(--color-dark-text-tertiary)' }}
                        onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                        onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-tertiary)'}
                        title="Eliminar Localizador"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', color: 'var(--color-dark-text-secondary)', fontSize: '14px', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <MapPin size={16} style={{ color: 'var(--color-primary)' }} />
                      <span>{locationsCount} {locationsCount === 1 ? 'ubicación' : 'ubicaciones'}</span>
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
                    style={{ flexGrow: 1, padding: '8px 12px', fontSize: '14px', color: 'white', borderColor: 'var(--color-dark-border)' }}
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
    </div>
  );
};
