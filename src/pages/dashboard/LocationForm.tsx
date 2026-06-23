import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import type { Locator } from './DashboardLayout';
import { MapPicker } from '../../components/MapPicker';
import { 
  ArrowLeft, 
  Save, 
  Upload, 
  Plus, 
  Trash2, 
  Tag, 
  Info, 
  ToggleLeft, 
  ToggleRight, 
  AlertCircle 
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
  const [description, setDescription] = useState('');
  const [published, setPublished] = useState(true);
  
  // Image Upload State
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Tags State
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Custom Fields State (List of {key, value})
  const [customFields, setCustomFields] = useState<CustomField[]>([]);

  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(isEdit);
  const [error, setError] = useState<string | null>(null);

  // Fetch location details if editing
  useEffect(() => {
    const fetchLocationDetails = async () => {
      if (!isEdit || !id) return;
      try {
        const { data, error: fetchErr } = await supabase
          .from('bm_locations')
          .select('*')
          .eq('id', id)
          .single();

        if (fetchErr) throw fetchErr;

        if (data) {
          setName(data.name);
          setAddress(data.address);
          setLat(data.lat);
          setLng(data.lng);
          setPhone(data.phone || '');
          setEmail(data.email || '');
          setWebsite(data.website || '');
          setDescription(data.description || '');
          setPublished(data.published);
          setTags(data.tags || []);
          setImageUrl(data.image_url);
          setImagePreview(data.image_url);

          // Convert custom_fields JSONB back to key-value array
          if (data.custom_fields) {
            const fieldsArray = Object.entries(data.custom_fields).map(([key, value]) => ({
              key,
              value: String(value)
            }));
            setCustomFields(fieldsArray);
          }
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
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
    }
  };

  // Upload Image to Storage
  const uploadImage = async (file: File): Promise<string> => {
    if (!user) throw new Error('Usuario no autenticado.');
    
    const fileExt = file.name.split('.').pop();
    const fileName = `${Math.random().toString(36).substring(2)}.${fileExt}`;
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

  // Add tag
  const handleAddTag = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const cleaned = tagInput.trim().toLowerCase().replace(/,/g, '');
      if (cleaned && !tags.includes(cleaned)) {
        setTags([...tags, cleaned]);
      }
      setTagInput('');
    }
  };

  const removeTag = (indexToRemove: number) => {
    setTags(tags.filter((_, i) => i !== indexToRemove));
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

      // 3. Upsert Location in Database
      const locationPayload = {
        locator_id: activeLocator.id,
        name,
        address,
        lat,
        lng,
        phone: phone || null,
        email: email || null,
        website: website || null,
        description: description || null,
        tags,
        custom_fields: customFieldsObj,
        published,
        image_url: finalImageUrl
      };

      if (isEdit && id) {
        const { error: updateErr } = await supabase
          .from('bm_locations')
          .update(locationPayload)
          .eq('id', id);

        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase
          .from('bm_locations')
          .insert(locationPayload);

        if (insertErr) throw insertErr;
      }

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
      <div style={{ color: 'white', textAlign: 'center', padding: '40px' }}>
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
    <div style={{ maxWidth: '900px', margin: '0 auto' }}>
      {/* Back Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <button 
          onClick={() => navigate('/dashboard/locations')}
          className="btn btn-secondary" 
          style={{ padding: '8px 12px', color: 'white', borderColor: 'var(--color-dark-border)' }}
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="admin-title" style={{ fontSize: '24px' }}>
            {isEdit ? 'Editar Ubicación' : 'Nueva Ubicación'}
          </h1>
          <p className="admin-subtitle" style={{ fontSize: '13px' }}>
            {isEdit ? 'Edita los datos del punto de tu mapa' : 'Agrega un nuevo punto a tu localizador'}
          </p>
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
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Form */}
      <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '32px', alignItems: 'start' }}>
        
        {/* Left Side: General Info */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 1: Basic details */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'white' }}>
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
                        color: 'white',
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
              <textarea 
                required
                rows={2}
                placeholder="Ej: Los Corales 379, Trujillo 13001, Perú"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="form-control"
                style={{ resize: 'none' }}
              />
            </div>
          </div>

          {/* Card 2: Contact Info */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'white' }}>
              Contacto y Enlaces
            </h3>

            <div className="form-row">
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Teléfono</label>
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
                placeholder="Ej: https://google.com"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                className="form-control"
              />
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
              <h3 style={{ fontSize: '16px', color: 'white' }}>Campos Personalizados</h3>
              <button 
                type="button" 
                onClick={handleAddCustomField}
                className="btn btn-secondary" 
                style={{ padding: '4px 8px', fontSize: '12px', color: 'white', borderColor: 'var(--color-dark-border)' }}
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', position: 'sticky', top: '24px' }}>
          
          {/* Geolocation Card */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'white' }}>
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
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'white' }}>
              Configuración de Publicación
            </h3>

            <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, color: 'white', fontSize: '14px' }}>Estado de publicación</div>
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

            {/* Tags Pills */}
            <div className="form-group" style={{ marginBottom: 0, marginTop: '8px' }}>
              <label className="form-label">Etiquetas / Categorías</label>
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: '6px', 
                padding: '8px 12px', 
                border: '1px solid var(--color-dark-border)', 
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--color-dark-surface)'
              }}>
                {tags.map((tag, i) => (
                  <span key={i} className="tag" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', margin: 0 }}>
                    <Tag size={10} />
                    {tag}
                    <button 
                      type="button" 
                      onClick={() => removeTag(i)}
                      style={{ border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: 0, fontWeight: 'bold' }}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <input 
                  type="text" 
                  placeholder={tags.length === 0 ? "Ej: doctor, trujillo (presiona Enter)" : "+ etiqueta..."}
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleAddTag}
                  style={{ 
                    border: 'none', 
                    background: 'none', 
                    flexGrow: 1, 
                    color: 'white', 
                    fontSize: '13px',
                    padding: 0
                  }}
                  className="tag-input-field"
                />
              </div>
              <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                Escribe una etiqueta y presiona Enter o una coma para agregarla.
              </span>
            </div>
          </div>

          {/* Form Actions */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <button 
              type="button"
              onClick={() => navigate('/dashboard/locations')}
              className="btn btn-secondary"
              style={{ flexGrow: 1, color: 'white', borderColor: 'var(--color-dark-border)' }}
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
