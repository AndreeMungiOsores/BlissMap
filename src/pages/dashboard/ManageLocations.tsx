import React, { useEffect, useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import type { Locator } from './DashboardLayout';
import { 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Image as ImageIcon,
  MapPin,
  ExternalLink,
  Tag,
  AlertCircle
} from 'lucide-react';

interface LocationItem {
  id: string;
  name: string;
  image_url: string | null;
  address: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
  custom_fields: Record<string, string>;
  published: boolean;
  created_at: string;
}

interface OutletContextType {
  activeLocator: Locator | null;
}

export const ManageLocations: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();
  
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLocations = async () => {
    if (!activeLocator) return;
    setLoading(true);
    try {
      const { data, error: fetchErr } = await supabase
        .from('bm_locations')
        .select('*')
        .eq('locator_id', activeLocator.id)
        .order('created_at', { ascending: false });

      if (fetchErr) throw fetchErr;
      setLocations(data || []);
    } catch (err: any) {
      console.error(err);
      setError('Error al cargar las ubicaciones.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, [activeLocator]);

  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    try {
      const { error: updateErr } = await supabase
        .from('bm_locations')
        .update({ published: !currentStatus })
        .eq('id', id);

      if (updateErr) throw updateErr;
      
      // Update local state
      setLocations(prev => 
        prev.map(loc => loc.id === id ? { ...loc, published: !currentStatus } : loc)
      );
    } catch (err: any) {
      console.error(err);
      alert('Error al actualizar el estado de publicación.');
    }
  };

  const handleDeleteLocation = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la ubicación "${name}"?`)) {
      return;
    }

    try {
      const { error: deleteErr } = await supabase
        .from('bm_locations')
        .delete()
        .eq('id', id);

      if (deleteErr) throw deleteErr;
      
      // Update local state
      setLocations(prev => prev.filter(loc => loc.id !== id));
    } catch (err: any) {
      console.error(err);
      alert('Error al eliminar la ubicación.');
    }
  };

  // Filter locations
  const filteredLocations = locations.filter(loc => {
    const searchLower = search.toLowerCase();
    const matchesName = loc.name.toLowerCase().includes(searchLower);
    const matchesAddress = loc.address.toLowerCase().includes(searchLower);
    const matchesTags = loc.tags.some(t => t.toLowerCase().includes(searchLower));
    
    return matchesName || matchesAddress || matchesTags;
  });

  if (!activeLocator) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '80px 20px',
        border: '1px dashed var(--color-dark-border)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--color-dark-surface)'
      }}>
        <MapPin size={48} style={{ color: 'var(--color-dark-text-tertiary)', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Ningún localizador seleccionado</h3>
        <p style={{ color: 'var(--color-dark-text-secondary)', maxWidth: '400px', margin: '0 auto 24px auto', fontSize: '15px' }}>
          Por favor selecciona o crea un localizador en el panel lateral para poder gestionar sus ubicaciones.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Ubicaciones</h1>
          <p className="admin-subtitle">Gestiona las tiendas, oficinas o puntos de tu mapa: <strong>{activeLocator.name}</strong></p>
        </div>
        <Link to="/dashboard/locations/new" className="btn btn-primary">
          <Plus size={18} />
          Agregar Ubicación
        </Link>
      </div>

      {/* Controls */}
      <div className="panel" style={{ padding: '16px 24px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        <div style={{ position: 'relative', flexGrow: 1, display: 'flex', alignItems: 'center' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', color: 'var(--color-dark-text-tertiary)' }} />
          <input 
            type="text" 
            placeholder="Buscar por nombre, dirección o etiqueta..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-control"
            style={{ width: '100%', paddingLeft: '40px' }}
          />
        </div>
        
        <div style={{ fontSize: '14px', color: 'var(--color-dark-text-secondary)', fontWeight: 500, whiteSpace: 'nowrap' }}>
          {filteredLocations.length} de {locations.length} ubicaciones
        </div>
      </div>

      {/* Locations Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', padding: '60px' }}>
            <div className="spinner"></div>
          </div>
        ) : error ? (
          <div style={{ padding: '40px', display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : filteredLocations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-dark-text-secondary)' }}>
            <MapPin size={40} style={{ color: 'var(--color-dark-text-tertiary)', marginBottom: '12px' }} />
            <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'white', marginBottom: '6px' }}>No se encontraron ubicaciones</h4>
            <p style={{ fontSize: '14px' }}>
              {search ? 'Intenta cambiar los términos de búsqueda.' : 'Crea tu primera ubicación haciendo clic en "Agregar Ubicación".'}
            </p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>Foto</th>
                  <th>Ubicación / Datos</th>
                  <th>Dirección</th>
                  <th>Etiquetas</th>
                  <th>Estado</th>
                  <th style={{ width: '120px', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocations.map(loc => (
                  <tr key={loc.id}>
                    <td>
                      {loc.image_url ? (
                        <img 
                          src={loc.image_url} 
                          alt={loc.name} 
                          style={{ width: '56px', height: '56px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)' }}
                        />
                      ) : (
                        <div style={{ width: '56px', height: '56px', backgroundColor: 'var(--color-dark-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-dark-text-tertiary)' }}>
                          <ImageIcon size={18} />
                        </div>
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'white' }}>{loc.name}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                        {loc.phone && <span>Tel: {loc.phone}</span>}
                        {loc.website && (
                          <a href={loc.website} target="_blank" rel="noreferrer" style={{ color: 'var(--color-primary)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                            Sitio Web <ExternalLink size={10} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td style={{ fontSize: '14px', color: 'var(--color-dark-text-secondary)', maxWidth: '250px' }}>
                      {loc.address}
                    </td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '200px' }}>
                        {loc.tags && loc.tags.length > 0 ? (
                          loc.tags.map(tag => (
                            <span key={tag} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', margin: 0 }}>
                              <Tag size={10} />
                              {tag}
                            </span>
                          ))
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)' }}>-</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <button 
                        onClick={() => handleTogglePublish(loc.id, loc.published)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                        title={loc.published ? 'Cambiar a borrador' : 'Publicar'}
                      >
                        {loc.published ? (
                          <span className="badge badge-success" style={{ gap: '4px', cursor: 'pointer' }}>
                            <ToggleRight size={18} style={{ color: 'var(--color-success)' }} />
                            Publicado
                          </span>
                        ) : (
                          <span className="badge badge-draft" style={{ gap: '4px', cursor: 'pointer' }}>
                            <ToggleLeft size={18} style={{ color: 'var(--color-dark-text-secondary)' }} />
                            Borrador
                          </span>
                        )}
                      </button>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'end' }}>
                        <Link 
                          to={`/dashboard/locations/${loc.id}/edit`} 
                          className="btn-icon" 
                          style={{ color: 'var(--color-dark-text-secondary)' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                          title="Editar Ubicación"
                        >
                          <Edit3 size={16} />
                        </Link>
                        <button 
                          className="btn-icon" 
                          onClick={() => handleDeleteLocation(loc.id, loc.name)}
                          style={{ color: 'var(--color-dark-text-secondary)' }}
                          onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                          onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                          title="Eliminar Ubicación"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
