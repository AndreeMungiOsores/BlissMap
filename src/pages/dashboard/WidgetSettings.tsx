import React, { useEffect, useState, useMemo } from 'react';
import { useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import type { Locator } from './DashboardLayout';
import { LocatorMap } from '../../components/LocatorMap';
import { 
  Save, 
  Upload, 
  Map, 
  Palette, 
  MapPin, 
  Eye, 
  AlertCircle,
  RefreshCw,
  Search
} from 'lucide-react';

interface OutletContextType {
  activeLocator: Locator | null;
  fetchLocators: () => Promise<void>;
}

export const WidgetSettings: React.FC = () => {
  const { activeLocator, fetchLocators } = useOutletContext<OutletContextType>();
  const { user } = useAuth();

  // Settings states
  const [mapStyle, setMapStyle] = useState('default');
  const [accentColor, setAccentColor] = useState('#3B82F6');
  const [searchPlaceholder, setSearchPlaceholder] = useState('Buscar...');
  const [distanceUnit, setDistanceUnit] = useState('km');
  const [markerType, setMarkerType] = useState('standard');
  const [markerColor, setMarkerColor] = useState('#3B82F6');
  const [markerImageUrl, setMarkerImageUrl] = useState<string | null>(null);
  const [markerScale, setMarkerScale] = useState<number>(1.0);
  
  // Custom marker file upload state
  const [markerFile, setMarkerFile] = useState<File | null>(null);
  const [markerPreview, setMarkerPreview] = useState<string | null>(null);
  const [uploadingMarker, setUploadingMarker] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [previewKey, setPreviewKey] = useState(0); // Used to force refresh the preview map

  // Sync state with active locator
  useEffect(() => {
    if (activeLocator) {
      setMapStyle(activeLocator.map_style);
      setAccentColor(activeLocator.accent_color);
      setSearchPlaceholder(activeLocator.search_placeholder);
      setDistanceUnit(activeLocator.distance_unit);
      setMarkerType(activeLocator.marker_type);
      setMarkerColor(activeLocator.marker_color);
      setMarkerImageUrl(activeLocator.marker_image_url);
      setMarkerPreview(activeLocator.marker_image_url);

      const savedScale = Number(localStorage.getItem(`bm_marker_scale_${activeLocator.id}`))
        || Number(localStorage.getItem(`bm_marker_scale_${activeLocator.slug}`))
        || (typeof activeLocator.marker_scale === 'number' ? activeLocator.marker_scale : 1.0);
      setMarkerScale(savedScale);

      setError(null);
      setSuccess(false);
    }
  }, [activeLocator]);

  // Upload Marker Icon to Storage
  const uploadMarker = async (file: File): Promise<string> => {
    if (!user) throw new Error('Usuario no autenticado.');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `marker_${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `${user.id}/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from('bm-locator-assets')
      .upload(filePath, file);

    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage
      .from('bm-locator-assets')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  const handleMarkerFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMarkerFile(file);
      setMarkerPreview(URL.createObjectURL(file));
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLocator) return;

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      let finalMarkerUrl = markerImageUrl;
      if (markerType === 'custom' && markerFile) {
        setUploadingMarker(true);
        finalMarkerUrl = await uploadMarker(markerFile);
        setMarkerImageUrl(finalMarkerUrl);
        setUploadingMarker(false);
      }

      // Persist marker_scale in localStorage immediately
      localStorage.setItem(`bm_marker_scale_${activeLocator.id}`, String(markerScale));
      localStorage.setItem(`bm_marker_scale_${activeLocator.slug}`, String(markerScale));

      const baseUpdate = {
        map_style: mapStyle,
        accent_color: accentColor,
        search_placeholder: searchPlaceholder,
        distance_unit: distanceUnit,
        marker_type: markerType,
        marker_color: markerColor,
        marker_image_url: markerType === 'custom' ? finalMarkerUrl : null
      };

      const { error: updateErr } = await supabase
        .from('bm_locators')
        .update({
          ...baseUpdate,
          marker_scale: markerScale
        })
        .eq('id', activeLocator.id);

      if (updateErr) {
        // Fallback update without marker_scale if column not yet present in Supabase table
        const { error: fallbackErr } = await supabase
          .from('bm_locators')
          .update(baseUpdate)
          .eq('id', activeLocator.id);

        if (fallbackErr) throw fallbackErr;
      }

      setSuccess(true);
      await fetchLocators();
      
      // Refresh preview map
      setPreviewKey(prev => prev + 1);
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al guardar los ajustes del mapa.');
    } finally {
      setLoading(false);
    }
  };

  const previewLocationItem = useMemo(() => [{
    id: 'preview-sample-pin',
    name: activeLocator?.name || 'Ubicación de Muestra',
    image_url: null,
    address: 'Av. José Pardo 991, Miraflores, Lima',
    phone: '+51 987 654 321',
    email: null,
    website: null,
    lat: -12.1215,
    lng: -77.0298,
    tags: ['Muestra'],
    custom_fields: {},
    description: null
  }], [activeLocator?.name]);

  if (!activeLocator) {
    return (
      <div style={{ color: 'white', textAlign: 'center', padding: '40px' }}>
        No hay ningún localizador seleccionado.
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Diseño y Personalización</h1>
          <p className="admin-subtitle">Ajusta los colores, el estilo de mapa y el marcador de: <strong>{activeLocator.name}</strong></p>
        </div>
      </div>

      {error && (
        <div style={{
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.2)',
          color: '#f87171',
          padding: '12px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '24px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '14px'
        }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div style={{
          backgroundColor: 'rgba(16, 185, 129, 0.1)',
          border: '1px solid rgba(16, 185, 129, 0.2)',
          color: '#34d399',
          padding: '12px',
          borderRadius: 'var(--radius-md)',
          marginBottom: '24px',
          fontSize: '14px'
        }}>
          Ajustes de mapa guardados y aplicados correctamente.
        </div>
      )}

      {/* Main Settings Customizer Grid */}
      <div className="customizer-layout">
        
        {/* Left Side: Settings Form */}
        <form onSubmit={handleSaveSettings} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Section 1: Map Style */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Map size={16} /> Estilo del Mapa
            </h3>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Apariencia del Mapa</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
                
                <label style={{
                  border: `2px solid ${mapStyle === 'default' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: mapStyle === 'default' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="map_style" 
                    value="default" 
                    checked={mapStyle === 'default'}
                    onChange={(e) => setMapStyle(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Color Predeterminado</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Mapa clásico de Google Maps/Leaflet</span>
                </label>

                <label style={{
                  border: `2px solid ${mapStyle === 'light' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: mapStyle === 'light' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="map_style" 
                    value="light" 
                    checked={mapStyle === 'light'}
                    onChange={(e) => setMapStyle(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Gris Claro</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Estilo minimalista limpio y claro</span>
                </label>

                <label style={{
                  border: `2px solid ${mapStyle === 'dark' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: mapStyle === 'dark' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="map_style" 
                    value="dark" 
                    checked={mapStyle === 'dark'}
                    onChange={(e) => setMapStyle(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Escala de Grises Oscura</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Moderno tema oscuro para mapas</span>
                </label>

                <label style={{
                  border: `2px solid ${mapStyle === 'satellite' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: mapStyle === 'satellite' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="map_style" 
                    value="satellite" 
                    checked={mapStyle === 'satellite'}
                    onChange={(e) => setMapStyle(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Satélite</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Fotografías reales satelitales</span>
                </label>

              </div>
            </div>
          </div>

          {/* Section 2: Colors and Text */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Palette size={16} /> Interfaz y Colores
            </h3>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Color de Acento Widget</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input 
                    type="color" 
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    style={{
                      border: '1px solid var(--color-dark-border)',
                      borderRadius: 'var(--radius-sm)',
                      width: '44px',
                      height: '44px',
                      padding: 0,
                      backgroundColor: 'transparent',
                      cursor: 'pointer'
                    }}
                  />
                  <input 
                    type="text" 
                    value={accentColor}
                    onChange={(e) => setAccentColor(e.target.value)}
                    className="form-control"
                    style={{ flexGrow: 1 }}
                  />
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Unidad de Distancia</label>
                <select 
                  value={distanceUnit} 
                  onChange={(e) => setDistanceUnit(e.target.value)}
                  className="form-control"
                >
                  <option value="km">Kilómetros (km)</option>
                  <option value="mi">Millas (mi)</option>
                </select>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Marcador de Búsqueda (Placeholder)</label>
              <input 
                type="text" 
                placeholder="Ej: Buscar médico, Buscar sucursal..."
                value={searchPlaceholder}
                onChange={(e) => setSearchPlaceholder(e.target.value)}
                className="form-control"
              />
            </div>
          </div>

          {/* Section 3: Marker Icon Style */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <MapPin size={16} /> Icono del Marcador
            </h3>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tipo de Icono</label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <label style={{
                  border: `2px solid ${markerType === 'standard' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: markerType === 'standard' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="marker_type" 
                    value="standard" 
                    checked={markerType === 'standard'}
                    onChange={(e) => setMarkerType(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Pin Estándar</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Pin clásico con color personalizable</span>
                </label>

                <label style={{
                  border: `2px solid ${markerType === 'custom' ? 'var(--color-primary)' : 'var(--color-dark-border)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '14px',
                  cursor: 'pointer',
                  backgroundColor: markerType === 'custom' ? 'rgba(99, 102, 241, 0.05)' : 'var(--color-dark-surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}>
                  <input 
                    type="radio" 
                    name="marker_type" 
                    value="custom" 
                    checked={markerType === 'custom'}
                    onChange={(e) => setMarkerType(e.target.value)}
                    style={{ display: 'none' }}
                  />
                  <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Subir Icono Propio</span>
                  <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>Usa una imagen PNG personalizada</span>
                </label>
              </div>
            </div>

            {/* Standard Marker Color Picker */}
            {markerType === 'standard' && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Color del Pin Marcador</label>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <input 
                    type="color" 
                    value={markerColor}
                    onChange={(e) => setMarkerColor(e.target.value)}
                    style={{
                      border: '1px solid var(--color-dark-border)',
                      borderRadius: 'var(--radius-sm)',
                      width: '44px',
                      height: '44px',
                      padding: 0,
                      backgroundColor: 'transparent',
                      cursor: 'pointer'
                    }}
                  />
                  <input 
                    type="text" 
                    value={markerColor}
                    onChange={(e) => setMarkerColor(e.target.value)}
                    className="form-control"
                    style={{ flexGrow: 1 }}
                  />
                </div>
              </div>
            )}

            {/* Custom Marker Upload */}
            {markerType === 'custom' && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Subir Imagen del Marcador (PNG/SVG recomendado)</label>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  {markerPreview ? (
                    <div style={{ position: 'relative' }}>
                      <img 
                        src={markerPreview} 
                        alt="Marcador personalizado" 
                        style={{ width: '48px', height: '48px', objectFit: 'contain', padding: '4px', backgroundColor: 'var(--color-dark-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)' }}
                      />
                      <button 
                        type="button" 
                        onClick={() => {
                          setMarkerFile(null);
                          setMarkerPreview(null);
                          setMarkerImageUrl(null);
                        }}
                        style={{
                          position: 'absolute',
                          top: '-6px',
                          right: '-6px',
                          backgroundColor: 'var(--color-danger)',
                          border: 'none',
                          borderRadius: '50%',
                          width: '18px',
                          height: '18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: 'white',
                          cursor: 'pointer',
                          fontSize: '10px'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <label className="upload-area" style={{ width: '100%', padding: '16px', gap: '4px', margin: 0 }}>
                      <Upload size={18} style={{ color: 'var(--color-dark-text-tertiary)' }} />
                      <span style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>Cargar marcador personalizado</span>
                      <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>PNG con fondo transparente (Max: 48x48px, 500KB)</span>
                      <input 
                        type="file" 
                        accept="image/png, image/svg+xml"
                        onChange={handleMarkerFileChange}
                        style={{ display: 'none' }}
                      />
                    </label>
                  )}
                </div>
              </div>
            )}
            {/* Marker Scale Slider Control */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label htmlFor="marker-scale-slider" className="form-label" style={{ marginBottom: 0 }}>
                  Tamaño del Marcador
                </label>
                <span 
                  style={{ 
                    fontSize: '12px', 
                    fontWeight: 700, 
                    color: '#00506E',
                    backgroundColor: 'rgba(30, 200, 170, 0.12)',
                    padding: '3px 10px',
                    borderRadius: '12px',
                    border: '1px solid rgba(30, 200, 170, 0.3)'
                  }}
                  aria-live="polite"
                >
                  {markerScale.toFixed(1)}x {markerScale === 1.0 ? '(Original)' : markerScale === 3.0 ? '(Máx x3)' : ''}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', fontWeight: 600 }}>1.0x</span>
                <input 
                  id="marker-scale-slider"
                  type="range"
                  min="1.0"
                  max="3.0"
                  step="0.1"
                  value={markerScale}
                  onChange={(e) => setMarkerScale(parseFloat(e.target.value))}
                  style={{
                    flexGrow: 1,
                    accentColor: '#1EC8AA',
                    cursor: 'pointer',
                    height: '6px'
                  }}
                  aria-label="Tamaño del marcador en el mapa"
                  aria-valuemin={1.0}
                  aria-valuemax={3.0}
                  aria-valuenow={markerScale}
                  aria-valuetext={`${markerScale.toFixed(1)} veces el tamaño original`}
                />
                <span style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', fontWeight: 600 }}>3.0x</span>
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px', display: 'block' }}>
                Ajusta el tamaño del icono desde 1x (original) hasta 3x.
              </span>
            </div>
          </div>

          <button 
            type="submit" 
            className="btn btn-primary"
            disabled={loading || uploadingMarker}
            style={{ padding: '12px' }}
          >
            {loading ? <div className="spinner" style={{ width: '18px', height: '18px', borderTopColor: '#fff' }}></div> : (
              <>
                <Save size={18} />
                Guardar Cambios y Actualizar
              </>
            )}
          </button>
        </form>

        {/* Right Side: Interactive Preview */}
        <div className="customizer-preview-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '16px', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--color-dark-text-primary)' }}>
              <Eye size={16} /> Vista Previa del Widget
            </h3>
            <button 
              onClick={() => setPreviewKey(prev => prev + 1)}
              className="btn-icon" 
              style={{ color: 'var(--color-dark-text-secondary)' }}
              title="Recargar vista previa"
              aria-label="Recargar mapa de vista previa"
            >
              <RefreshCw size={14} />
            </button>
          </div>
          
          <div className="customizer-preview-frame" style={{ position: 'relative', width: '100%', height: '600px' }}>
            {/* Search Header Overlay to accurately mirror public widget */}
            <div style={{
              position: 'absolute',
              top: '16px',
              left: '16px',
              right: '16px',
              zIndex: 1000,
              pointerEvents: 'none'
            }}>
              <div style={{
                backgroundColor: '#ffffff',
                borderRadius: '14px',
                padding: '12px 18px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                border: '1.5px solid #E2E8F0'
              }}>
                <Search size={18} style={{ color: '#00506E' }} />
                <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>
                  {searchPlaceholder || 'Escribe producto, marca o médico...'}
                </span>
              </div>
            </div>

            {/* Interactive Leaflet Map faithfully rendering 1 sample pin with zoom responsiveness */}
            <LocatorMap 
              key={`preview-map-${mapStyle}-${previewKey}`}
              locations={previewLocationItem}
              selectedLocationId="preview-sample-pin"
              onSelectLocation={() => {}}
              mapStyle={mapStyle}
              markerType={markerType}
              markerColor={markerColor}
              markerImageUrl={markerType === 'custom' ? (markerPreview || markerImageUrl) : null}
              markerScale={markerScale}
              zoomControl={true}
            />
          </div>
        </div>

      </div>
    </div>
  );
};
