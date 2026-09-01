import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import type { Locator } from './DashboardLayout';
import { MapPicker } from '../../components/MapPicker';
import { fetchB2BSalesLocations, toTitleCase, cleanUrl } from '../../services/b2bApiService';
import localDoctorsData from '../../data/doctors_data.json';
import { 
  ArrowLeft, 
  Save, 
  Upload, 
  Plus, 
  Trash2, 
  Info, 
  ToggleLeft, 
  ToggleRight, 
  AlertCircle,
  RotateCcw,
  Search
} from 'lucide-react';

interface CustomField {
  key: string;
  value: string;
}

interface OutletContextType {
  activeLocator: Locator | null;
}

export const LocationForm: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;

  // Form State
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState(0);
  const [lng, setLng] = useState(0);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [facebook, setFacebook] = useState('');
  const [instagram, setInstagram] = useState('');
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(true);
  
  // Image Upload State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Tags State
  const [tags, setTags] = useState<string[]>([]);

  // Custom Fields State (List of {key, value})
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  // Override & API Base State
  const [hasManualOverride, setHasManualOverride] = useState(false);
  const [apiBaseLocation, setApiBaseLocation] = useState<any | null>(null);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [geocoding, setGeocoding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Geocode address from "Buscar en Mapa" button next to Dirección Completa
  const handleGeocodeAddress = async () => {
    if (!address.trim()) return;
    setGeocoding(true);
    setError(null);

    const fetchWithTimeout = async (url: string, timeout = 5000) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        return response;
      } catch (err) {
        clearTimeout(timer);
        throw err;
      }
    };

    try {
      // 1. Esri World Geocoder
      const esriUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(address.trim())}&maxLocations=1`;
      const resp = await fetchWithTimeout(esriUrl, 5000);
      const data = await resp.json();

      if (data && data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        setLat(candidate.location.y);
        setLng(candidate.location.x);
        if (candidate.address) {
          setAddress(candidate.address);
        }
        setGeocoding(false);
        return;
      }
    } catch (err) {
      console.warn('Esri geocoding timed out. Trying Nominatim fallback...', err);
    }

    try {
      // 2. Nominatim Fallback
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address.trim())}&limit=1`;
      const resp = await fetchWithTimeout(nominatimUrl, 5000);
      const data = await resp.json();

      if (data && data.length > 0) {
        const item = data[0];
        setLat(parseFloat(item.lat));
        setLng(parseFloat(item.lon));
        if (item.display_name) {
          setAddress(item.display_name);
        }
      } else {
        setError('No se pudo encontrar la ubicación en el mapa. Intenta agregar más detalles (Ciudad, País).');
      }
    } catch (err) {
      console.error('Geocoding error:', err);
      setError('Error al conectar con el servicio de geolocalización. Ingresa las coordenadas manualmente o ajusta el marcador.');
    } finally {
      setGeocoding(false);
    }
  };

  // Fetch location details if editing
  useEffect(() => {
    const fetchLocationDetails = async () => {
      if (!isEdit || !id) return;
      setFetching(true);
      setError(null);
      try {
        const decodedId = decodeURIComponent(id);

        // 1. Fetch live/cached B2B API locations
        const { locations: apiLocations } = await fetchB2BSalesLocations(localDoctorsData as any);
        const baseLoc = apiLocations.find(loc => loc.id === decodedId || loc.id === id);

        if (baseLoc) {
          setApiBaseLocation(baseLoc);
        }

        // 2. Fetch Supabase manual override if saved previously
        let supabaseLoc: any = null;
        try {
          const { data } = await supabase
            .from('bm_locations')
            .select('*')
            .eq('id', decodedId)
            .maybeSingle();

          if (data) supabaseLoc = data;
        } catch (dbErr) {
          console.warn('Supabase fetch notice:', dbErr);
        }

        // 3. Merge: Supabase manual override takes TOP priority over API base location
        const mergedData = supabaseLoc ? {
          ...(baseLoc || {}),
          ...supabaseLoc,
          custom_fields: { ...(baseLoc?.custom_fields || {}), ...(supabaseLoc.custom_fields || {}) }
        } : baseLoc;

        if (mergedData) {
          setName(toTitleCase(mergedData.name || ''));
          setAddress(mergedData.address || '');
          setLat(mergedData.lat || 0);
          setLng(mergedData.lng || 0);
          setPhone(mergedData.phone || '');
          setEmail(mergedData.email || '');
          setWebsite(mergedData.website || '');
          setFacebook(mergedData.facebook || '');
          setInstagram(mergedData.instagram || '');
          setDescription(mergedData.description || '');
          setPublished(mergedData.published !== false);
          setTags(mergedData.tags || []);
          setImageUrl(mergedData.image_url || null);
          setImagePreview(mergedData.image_url || null);
          setHasManualOverride(!!supabaseLoc);

          if (mergedData.custom_fields) {
            const fieldsArray = Object.entries(mergedData.custom_fields).map(([key, value]) => ({
              key,
              value: String(value)
            }));
            setCustomFields(fieldsArray);
          }
        } else {
          setError('No se encontró la ubicación solicitada.');
        }
      } catch (err: any) {
        console.error(err);
        setError('Error al cargar los detalles de la ubicación.');
      } finally {
        setFetching(false);
      }
    };

    fetchLocationDetails();
  }, [id, isEdit]);

  // Handle Image Selection
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        setError('La imagen no debe superar los 2MB');
        return;
      }
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // Upload Image to Storage
  const uploadImage = async (file: File): Promise<string> => {
    if (!user) throw new Error('Usuario no autenticado.');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(2)}.${fileExt}`;
    const filePath = `locations/${fileName}`;

    const { error: uploadErr } = await supabase.storage
      .from('bm-locator-assets')
      .upload(filePath, file);

    if (uploadErr) throw uploadErr;

    const { data } = supabase.storage
      .from('bm-locator-assets')
      .getPublicUrl(filePath);

    return data.publicUrl;
  };

  // Custom Fields Operations
  const handleAddCustomField = () => {
    setCustomFields([...customFields, { key: '', value: '' }]);
  };

  const handleCustomFieldChange = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...customFields];
    updated[index][field] = value;
    setCustomFields(updated);
  };

  const handleRemoveCustomField = (index: number) => {
    setCustomFields(customFields.filter((_, i) => i !== index));
  };

  // Reset to original live API ERP values
  const handleResetToApi = async () => {
    if (!id || !apiBaseLocation) return;
    if (!window.confirm('¿Deseas eliminar las ediciones manuales y restablecer los datos originales de la API ERP?')) return;
    
    setLoading(true);
    try {
      const decodedId = decodeURIComponent(id);
      await supabase.from('bm_locations').delete().eq('id', decodedId);

      setName(toTitleCase(apiBaseLocation.name || ''));
      setAddress(apiBaseLocation.address || '');
      setLat(apiBaseLocation.lat || 0);
      setLng(apiBaseLocation.lng || 0);
      setPhone(apiBaseLocation.phone || '');
      setEmail(apiBaseLocation.email || '');
      setWebsite(apiBaseLocation.website || '');
      setFacebook(apiBaseLocation.facebook || '');
      setInstagram(apiBaseLocation.instagram || '');
      setDescription(apiBaseLocation.description || '');
      setPublished(true);
      setTags(apiBaseLocation.tags || []);
      setImageUrl(apiBaseLocation.image_url || null);
      setImagePreview(apiBaseLocation.image_url || null);
      setHasManualOverride(false);

      if (apiBaseLocation.custom_fields) {
        const fieldsArray = Object.entries(apiBaseLocation.custom_fields).map(([key, value]) => ({
          key,
          value: String(value)
        }));
        setCustomFields(fieldsArray);
      }
    } catch (err: any) {
      console.error(err);
      setError('Error al restablecer los datos de la API.');
    } finally {
      setLoading(false);
    }
  };

  // Form Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLocator) return;
    
    setLoading(true);
    setError(null);

    if (lat === 0 || lng === 0) {
      setError('Por favor geolocaliza la dirección en el mapa para obtener las coordenadas.');
      setLoading(false);
      return;
    }

    try {
      // 1. Upload image if selected
      let finalImageUrl = imageUrl;
      if (imageFile) {
        setUploadingImage(true);
        finalImageUrl = await uploadImage(imageFile);
        setUploadingImage(false);
      }

      // 2. Convert custom fields array to object
      const customFieldsObj: Record<string, string> = {};
      customFields.forEach(field => {
        const trimmedKey = field.key.trim();
        if (trimmedKey) {
          customFieldsObj[trimmedKey] = field.value;
        }
      });

      // 3. Upsert Location in Database with preserved ID (e.g. doc-1 or erp-doc-...)
      const decodedId = id ? decodeURIComponent(id) : `custom-${Date.now()}`;
      const locationPayload = {
        id: decodedId,
        locator_id: activeLocator.id,
        name,
        address,
        lat,
        lng,
        phone: phone || null,
        email: email || null,
        website: cleanUrl(website),
        facebook: cleanUrl(facebook),
        instagram: cleanUrl(instagram),
        description: description || null,
        tags,
        custom_fields: customFieldsObj,
        published,
        image_url: finalImageUrl
      };

      const { error: upsertErr } = await supabase
        .from('bm_locations')
        .upsert(locationPayload, { onConflict: 'id' });

      if (upsertErr) throw upsertErr;

      // Go back to locations list
      navigate('/dashboard/locations');
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error al guardar la ubicación.');
    } finally {
      setLoading(false);
    }
  };

  if (!activeLocator) {
    return (
      <div style={{ color: 'var(--color-dark-text-primary)', textAlign: 'center', padding: '40px' }}>
        No hay ningún localizador seleccionado.
      </div>
    );
  }

  if (fetching) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div style={{ width: '100%', maxWidth: '1280px' }}>
      {/* Back Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button 
            type="button"
            onClick={() => navigate('/dashboard/locations')}
            className="btn btn-secondary" 
            style={{ padding: '8px 12px', color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 className="admin-title" style={{ fontSize: '24px', margin: 0 }}>
                {isEdit ? 'Editar Ubicación' : 'Nueva Ubicación'}
              </h1>
              {hasManualOverride && (
                <span className="badge badge-success" style={{ fontSize: '11px', padding: '3px 8px' }}>
                  Edición Manual (Prevalece sobre API ERP)
                </span>
              )}
            </div>
            <p className="admin-subtitle" style={{ fontSize: '13px', margin: 0 }}>
              {isEdit ? 'Edita los datos del punto de tu mapa' : 'Agrega un nuevo punto a tu localizador'}
            </p>
          </div>
        </div>

        {hasManualOverride && apiBaseLocation && (
          <button
            type="button"
            onClick={handleResetToApi}
            className="btn btn-secondary"
            style={{ fontSize: '13px', gap: '6px', color: '#e2e8f0', borderColor: '#475569' }}
            title="Restablecer a valores de la API ERP en vivo"
          >
            <RotateCcw size={15} />
            Restablecer a datos de la API
          </button>
        )}
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
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)', gap: '24px', alignItems: 'start', width: '100%' }}>
        
        {/* Left Side: General Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', minWidth: 0 }}>
          
          {/* Card 1: Basic details */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)' }}>
              Información Básica
            </h3>

            {/* Photo Upload */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Imagen de la Ubicación</label>
              <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                {imagePreview ? (
                  <div style={{ position: 'relative' }}>
                    <img 
                      src={imagePreview} 
                      alt="Vista previa" 
                      style={{ width: '80px', height: '80px', objectFit: 'cover', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-dark-border)' }}
                    />
                    <button 
                      type="button" 
                      onClick={() => {
                        setImageFile(null);
                        setImagePreview(null);
                        setImageUrl(null);
                      }}
                      style={{
                        position: 'absolute',
                        top: '-6px',
                        right: '-6px',
                        backgroundColor: 'var(--color-danger)',
                        border: 'none',
                        borderRadius: '50%',
                        width: '20px',
                        height: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--color-dark-text-primary)',
                        cursor: 'pointer',
                        fontSize: '11px'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label className="upload-area" style={{ width: '100%', padding: '16px', gap: '4px', margin: 0 }}>
                    <Upload size={18} style={{ color: 'var(--color-dark-text-tertiary)' }} />
                    <span style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>Haz clic para subir una foto</span>
                    <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>Formatos: PNG, JPG, WEBP (Max 2MB)</span>
                    <input 
                      type="file" 
                      accept="image/*"
                      onChange={handleImageChange}
                      style={{ display: 'none' }}
                    />
                  </label>
                )}
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Nombre del Punto</label>
              <input 
                type="text" 
                required
                placeholder="Ej: Daysi Timana, Tienda Miraflores"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Dirección Completa</label>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
                <input 
                  type="text" 
                  required
                  placeholder="Ej: León Velarde 406, Yanahuara, Perú"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleGeocodeAddress();
                    }
                  }}
                  className="form-control"
                  style={{ flexGrow: 1 }}
                />
                <button
                  type="button"
                  onClick={handleGeocodeAddress}
                  disabled={geocoding || !address.trim()}
                  style={{ 
                    backgroundColor: '#00506E', 
                    color: '#FFFFFF', 
                    padding: '8px 16px', 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '6px', 
                    cursor: geocoding || !address.trim() ? 'not-allowed' : 'pointer', 
                    fontWeight: 600, 
                    fontSize: '13px',
                    border: 'none', 
                    borderRadius: 'var(--radius-md)', 
                    whiteSpace: 'nowrap',
                    opacity: geocoding || !address.trim() ? 0.6 : 1,
                    flexShrink: 0
                  }}
                  title="Buscar esta dirección en el mapa para actualizar las coordenadas"
                >
                  {geocoding ? <div className="spinner" style={{ width: '14px', height: '14px', borderTopColor: '#fff' }}></div> : <Search size={14} />}
                  Buscar en Mapa
                </button>
              </div>
            </div>
          </div>

          {/* Card 2: Contact Info & Social Networks */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)' }}>
              Contacto y Redes Sociales
            </h3>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Teléfono / WhatsApp</label>
                <input 
                  type="text" 
                  placeholder="Ej: 943856722"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="form-control"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Correo electrónico</label>
                <input 
                  type="email" 
                  placeholder="contacto@doctor.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Sitio Web</label>
              <input 
                type="url" 
                placeholder="Ej: https://midominio.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="form-control"
              />
            </div>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Instagram URL</label>
                <input 
                  type="url" 
                  placeholder="Ej: https://www.instagram.com/micuenta"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  className="form-control"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Facebook URL</label>
                <input 
                  type="url" 
                  placeholder="Ej: https://www.facebook.com/mipagina"
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                  className="form-control"
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Descripción</label>
              <textarea 
                rows={3}
                placeholder="Horarios, especialidad, indicaciones específicas, etc..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="form-control"
                style={{ resize: 'vertical' }}
              />
            </div>
          </div>

          {/* Card 3: Custom fields */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px' }}>
              <h3 style={{ fontSize: '16px', color: 'var(--color-dark-text-primary)' }}>Campos Personalizados</h3>
              <button 
                type="button" 
                onClick={handleAddCustomField}
                className="btn btn-secondary" 
                style={{ padding: '4px 8px', fontSize: '12px', color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}
              >
                <Plus size={12} /> Agregar Campo
              </button>
            </div>

            {customFields.length === 0 ? (
              <p style={{ color: 'var(--color-dark-text-tertiary)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Info size={14} />
                No has agregado campos personalizados. Ej: CMP, Consultorio, Redes.
              </p>
            ) : (
              <div className="custom-fields-editor">
                {customFields.map((field, idx) => (
                  <div key={idx} className="custom-field-row">
                    <input 
                      type="text" 
                      placeholder="Etiqueta (Ej: CMP)"
                      value={field.key}
                      onChange={(e) => handleCustomFieldChange(idx, 'key', e.target.value)}
                      className="form-control"
                    />
                    <input 
                      type="text" 
                      placeholder="Valor (Ej: 053200)"
                      value={field.value}
                      onChange={(e) => handleCustomFieldChange(idx, 'value', e.target.value)}
                      className="form-control"
                    />
                    <button 
                      type="button" 
                      onClick={() => handleRemoveCustomField(idx)}
                      className="btn-icon" 
                      style={{ color: 'var(--color-dark-text-secondary)', padding: '10px' }}
                      onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                      onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Side: Mapping & Meta */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'sticky', top: '24px', minWidth: 0 }}>
          
          {/* Geolocation Card */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)' }}>
              Ubicación en el Mapa
            </h3>
            
            <MapPicker 
              address={address}
              lat={lat}
              lng={lng}
              onChange={({ lat, lng, address: formattedAddress }) => {
                setLat(lat);
                setLng(lng);
                if (formattedAddress) {
                  setAddress(formattedAddress);
                }
              }}
            />

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Latitud</label>
                <input 
                  type="number" 
                  step="any"
                  required
                  value={lat === 0 ? '' : lat}
                  onChange={(e) => setLat(parseFloat(e.target.value) || 0)}
                  className="form-control"
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Longitud</label>
                <input 
                  type="number" 
                  step="any"
                  required
                  value={lng === 0 ? '' : lng}
                  onChange={(e) => setLng(parseFloat(e.target.value) || 0)}
                  className="form-control"
                />
              </div>
            </div>
          </div>

          {/* Settings / Publishing */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)' }}>
              Configuración de Publicación
            </h3>

            <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)', fontSize: '14px' }}>Estado de publicación</div>
                <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                  Las ubicaciones en borrador no se mostrarán en el buscador público.
                </div>
              </div>
              <button 
                type="button"
                onClick={() => setPublished(!published)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              >
                {published ? (
                  <ToggleRight size={40} style={{ color: 'var(--color-primary)' }} />
                ) : (
                  <ToggleLeft size={40} style={{ color: 'var(--color-dark-text-tertiary)' }} />
                )}
              </button>
            </div>

          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <button 
              type="button"
              onClick={() => navigate('/dashboard/locations')}
              className="btn btn-secondary"
              style={{ flexGrow: 1, color: 'var(--color-dark-text-primary)', borderColor: 'var(--color-dark-border)' }}
            >
              Cancelar
            </button>
            <button 
              type="submit"
              disabled={loading || uploadingImage}
              className="btn btn-primary"
              style={{ flexGrow: 2 }}
            >
              {loading ? (
                <div className="spinner" style={{ width: '18px', height: '18px', borderTopColor: '#fff' }}></div>
              ) : (
                <>
                  <Save size={18} />
                  Guardar Ubicación
                </>
              )}
            </button>
          </div>

        </div>

      </form>
    </div>
  );
};
