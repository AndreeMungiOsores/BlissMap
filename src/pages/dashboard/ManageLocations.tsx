import React, { useEffect, useState, useMemo } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import type { Locator } from './DashboardLayout';
import localDoctorsData from '../../data/doctors_data.json';
import { 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Image as ImageIcon,
  MapPin,
  AlertCircle,
  Package
} from 'lucide-react';

import { fetchB2BSalesLocations } from '../../services/b2bApiService';

interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
}

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
  products?: ProductItem[];
  created_at?: string;
  is_manual_override?: boolean;
}

interface OutletContextType {
  activeLocator: Locator | null;
}

export const ManageLocations: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();
  
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'manual'>('all');
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);

  const TEST_NAMES = ['daysi timana', 'winston maldonado', 'marjorie villate', 'giuliana peching'];

  const fetchLocations = async () => {
    if (!activeLocator) return;
    setLoading(true);
    try {
      // 1. Fetch live/cached B2B API locations
      const { locations: apiLocations } = await fetchB2BSalesLocations(localDoctorsData as any);

      // 2. Fetch Supabase manual overrides
      let dbData: any[] = [];
      try {
        const { data } = await supabase
          .from('bm_locations')
          .select('*')
          .eq('locator_id', activeLocator.id);
        if (data) dbData = data;
      } catch (dbErr) {
        console.warn('Supabase locations fetch notice:', dbErr);
      }

      const dbMap = new Map<string, any>();
      dbData.forEach(item => {
        dbMap.set(item.id, item);
      });

      // 3. Merge: Apply DB manual overrides over API base locations with smart RUC + Name fallback
      const mergedList: LocationItem[] = apiLocations.map((apiLoc: any) => {
        let override = dbMap.get(apiLoc.id);

        // Fallback: Match by Document (RUC/DNI) extracted from custom_fields OR from the DB record's own id field.
        // This ensures records saved with legacy id formats (empresa-prefix, array-index, or empresa-agnostic)
        // are still matched to the correct API entry.
        if (!override) {
          const apiDocNum = (apiLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');

          if (apiDocNum) {
            for (const [dbId, dbItem] of dbMap.entries()) {
              // Try custom_fields.Documento first, then extract digits from the record's own id
              const dbDocFromFields = (dbItem.custom_fields?.['Documento'] || '').replace(/\D/g, '');
              // Extract any 8-11 digit sequence embedded in the id string (RUC = 11 digits, DNI = 8 digits)
              const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
              const dbDocNum = dbDocFromFields || dbDocFromId;

              const apiNameClean = (apiLoc.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const dbNameClean = (dbItem.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

              if (dbDocNum && dbDocNum === apiDocNum) {
                // Accept the match if names overlap OR if either name is missing/very short
                const nameMatch = !apiNameClean || !dbNameClean ||
                  apiNameClean.includes(dbNameClean) || dbNameClean.includes(apiNameClean) ||
                  apiNameClean.length < 4 || dbNameClean.length < 4;
                if (nameMatch) {
                  override = dbItem;
                  dbMap.delete(dbId);
                  break;
                }
              }
            }
          }
        } else {
          dbMap.delete(apiLoc.id);
        }

        if (override) {
          return {
            ...apiLoc,
            ...override,
            products: (override.products && Array.isArray(override.products) && override.products.length > 0) 
              ? override.products 
              : apiLoc.products,
            is_manual_override: true,
            custom_fields: { ...(apiLoc.custom_fields || {}), ...(override.custom_fields || {}) },
            published: override.published !== undefined ? override.published : true
          };
        }

        return {
          ...apiLoc,
          is_manual_override: false,
          published: true
        } as LocationItem;
      });

      // Build a set of RUCs already represented in mergedList to avoid unshifting DB orphans
      // that are duplicates of the same clinic saved under a different empresa ID.
      const mergedRucSet = new Set<string>();
      mergedList.forEach(loc => {
        const ruc = (loc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
        if (ruc) mergedRucSet.add(ruc);
      });

      // Add any truly new custom locations from DB that were not in API and not already covered
      dbMap.forEach((customDbLoc, dbId) => {
        const dbDocFromFields = (customDbLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
        const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
        const dbDocNum = dbDocFromFields || dbDocFromId;

        // Skip if this RUC is already in the merged list — it's a stale duplicate from a legacy empresa ID
        if (dbDocNum && mergedRucSet.has(dbDocNum)) return;

        mergedList.unshift({
          ...customDbLoc,
          is_manual_override: true,
          published: customDbLoc.published !== undefined ? customDbLoc.published : true
        } as LocationItem);
      });

      const filtered = mergedList.filter(
        loc => !TEST_NAMES.some(tn => loc.name.toLowerCase().includes(tn))
      );

      setLocations(filtered);
    } catch (err: any) {
      console.error(err);
      setLocations(localDoctorsData as any);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocations();
  }, [activeLocator]);

  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    try {
      if (!id.startsWith('doc-')) {
        await supabase
          .from('bm_locations')
          .update({ published: !currentStatus })
          .eq('id', id);
      }
      
      // Update local state
      setLocations(prev => 
        prev.map(loc => loc.id === id ? { ...loc, published: !currentStatus } : loc)
      );
    } catch (err: any) {
      console.error(err);
      setLocations(prev => 
        prev.map(loc => loc.id === id ? { ...loc, published: !currentStatus } : loc)
      );
    }
  };

  const handleDeleteLocation = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la ubicación "${name}"?`)) {
      return;
    }

    try {
      if (!id.startsWith('doc-')) {
        await supabase
          .from('bm_locations')
          .delete()
          .eq('id', id);
      }
      
      // Update local state
      setLocations(prev => prev.filter(loc => loc.id !== id));
    } catch (err: any) {
      console.error(err);
      setLocations(prev => prev.filter(loc => loc.id !== id));
    }
  };

  const removeAccents = (str: string | null | undefined): string => {
    if (!str) return '';
    return str
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  };

  // Count total manual overrides saved in Supabase
  const manualCount = useMemo(() => {
    return locations.filter(loc => loc.is_manual_override).length;
  }, [locations]);

  // Filter locations by mode (All vs Editados Manualmente) AND search query
  const filteredLocations = locations.filter(loc => {
    if (filterMode === 'manual' && !loc.is_manual_override) {
      return false;
    }

    const searchClean = removeAccents(search.trim());
    if (!searchClean) return true;
    
    const matchesName = removeAccents(loc.name).includes(searchClean);
    const matchesAddress = removeAccents(loc.address).includes(searchClean);
    const matchesTags = loc.tags?.some(t => removeAccents(t).includes(searchClean));
    const matchesProducts = loc.products?.some(p => removeAccents(p.name).includes(searchClean));
    const matchesCustom = loc.custom_fields && Object.values(loc.custom_fields).some(v => removeAccents(String(v)).includes(searchClean));
    
    return matchesName || matchesAddress || matchesTags || matchesProducts || matchesCustom;
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
          <h1 className="admin-title">Ubicaciones y Productos</h1>
          <p className="admin-subtitle">Gestiona los médicos y sus catálogos de productos del mapa: <strong>{activeLocator.name}</strong></p>
        </div>
        <Link to="/dashboard/locations/new" className="btn btn-primary">
          <Plus size={18} />
          Agregar Ubicación
        </Link>
      </div>

      {/* Controls */}
      <div className="panel" style={{ padding: '14px 24px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexGrow: 1, minWidth: '280px', display: 'flex', alignItems: 'center' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', color: 'var(--color-dark-text-tertiary)' }} />
          <input 
            type="text" 
            placeholder="Buscar por médico, dirección, etiqueta o producto (ej: Sebiaclear, Topialyse)..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-control"
            style={{ width: '100%', paddingLeft: '40px' }}
          />
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: filterMode === 'all' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
              backgroundColor: filterMode === 'all' ? '#00506E' : 'transparent',
              color: filterMode === 'all' ? '#FFFFFF' : 'var(--color-dark-text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            Todos ({locations.length})
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('manual')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: filterMode === 'manual' ? '1.5px solid #1EC8AA' : '1px solid rgba(30, 200, 170, 0.4)',
              backgroundColor: filterMode === 'manual' ? '#1EC8AA' : 'rgba(30, 200, 170, 0.1)',
              color: filterMode === 'manual' ? '#FFFFFF' : '#00506E',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
            title="Filtrar comercios con ediciones manuales guardadas en Supabase"
          >
            <Edit3 size={13} />
            Editados Manualmente ({manualCount})
          </button>
        </div>
        
        <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {filteredLocations.length} de {locations.length} médicos
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
            <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-dark-text-primary)', marginBottom: '6px' }}>No se encontraron ubicaciones</h4>
            <p style={{ fontSize: '14px' }}>
              {search ? 'Intenta cambiar los términos de búsqueda.' : 'Crea tu primera ubicación haciendo clic en "Agregar Ubicación".'}
            </p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Foto</th>
                  <th>Médico / Razón Social</th>
                  <th>Dirección</th>
                  <th>Productos Registrados</th>
                  <th>Estado</th>
                  <th style={{ width: '100px', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocations.slice(0, 100).map(loc => {
                  const productCount = loc.products?.length || 0;

                  return (
                    <tr key={loc.id}>
                      <td>
                        {loc.image_url ? (
                          <img 
                            src={loc.image_url} 
                            alt={loc.name} 
                            style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)' }}
                          />
                        ) : (
                          <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--color-dark-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-dark-text-tertiary)' }}>
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)' }}>{loc.name}</span>
                          {loc.is_manual_override && (
                            <span style={{
                              fontSize: '10px',
                              fontWeight: 700,
                              color: '#00506E',
                              backgroundColor: 'rgba(30, 200, 170, 0.15)',
                              border: '1px solid rgba(30, 200, 170, 0.35)',
                              padding: '2px 7px',
                              borderRadius: 'var(--radius-full)',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px'
                            }}>
                              <Edit3 size={10} style={{ color: '#1EC8AA' }} />
                              Edición Manual
                            </span>
                          )}
                        </div>
                        {loc.custom_fields?.["Razón Social"] && (
                          <div style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', marginTop: '2px' }}>
                            RS: {loc.custom_fields["Razón Social"]}
                          </div>
                        )}
                        {loc.custom_fields?.["Documento"] && (
                          <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                            {loc.custom_fields["Documento"]}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', maxWidth: '240px' }}>
                        {loc.address}
                      </td>
                      <td>
                        {productCount > 0 ? (
                          <div>
                            <span className="badge" style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', gap: '4px' }}>
                              <Package size={12} />
                              {productCount} {productCount === 1 ? 'producto' : 'productos'}
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px', maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {loc.products?.slice(0, 2).map(p => p.name).join(', ')}
                              {productCount > 2 && '...'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)' }}>Sin productos</span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
