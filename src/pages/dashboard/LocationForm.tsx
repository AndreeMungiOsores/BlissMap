import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useOutletContext } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import { useAuth } from '../../context/AuthContext';
import type { Locator } from './DashboardLayout';
import { MapPicker } from '../../components/MapPicker';
import { fetchB2BSalesLocations, toTitleCase, cleanUrl } from '../../services/b2bApiService';
import { fetchB2CLocations, filterBlissfarmaOnly, deduplicateB2BAgainstB2C } from '../../services/b2cApiService';
import localDoctorsData from '../../data/doctors_data.json';
import { DataverseConfirmModal, type DvChange } from '../../components/DataverseConfirmModal';
import {
  readDataverseContact, writeToDataverse, dvContactIdOf, sameText, DvWriteError,
  type DvSnapshot, type WritePayload,
} from '../../services/dataverseWriteService';
import { addressScore, SAME_PLACE } from '../../services/dataverseOverlay';
import { 
  ArrowLeft, 
  Save, 
  Upload, 
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

  // Valores con los que se abrió la ficha: solo lo que el usuario cambie viaja a Dataverse.
  const initialRef = useRef<{ address: string; lat: number; lng: number; phone: string; email: string; instagram: string; especialidad: string } | null>(null);
  // Aviso de doble confirmación antes de escribir en Dataverse
  const [dvPending, setDvPending] = useState<null | { subject: string; changes: DvChange[]; warnings: string[]; payload: Omit<WritePayload, 'logo'>; photoOverwrite: boolean; wantsPhoto: boolean }>(null);
  const [dvBusy, setDvBusy] = useState(false);
  const [dvError, setDvError] = useState<string | null>(null);

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

        // 1. Fetch live/cached API locations (B2C + B2B for Blissfarma or B2C ids, B2B for others)
        let apiLocations: any[] = [];
        if (activeLocator?.slug === 'blissfarma' || decodedId.startsWith('b2c-')) {
          const [b2cResult, b2bResult] = await Promise.all([
            fetchB2CLocations(),
            fetchB2BSalesLocations(localDoctorsData as any)
          ]);
          const b2bFiltered = filterBlissfarmaOnly(b2bResult.locations);
          const b2bDeduped = deduplicateB2BAgainstB2C(
            [...b2cResult.doctors, ...b2cResult.centers],
            b2bFiltered
          );
          apiLocations = [...b2cResult.doctors, ...b2cResult.centers, ...b2bDeduped];
        } else {
          const b2bRes = await fetchB2BSalesLocations(localDoctorsData as any);
          apiLocations = b2bRes.locations;
        }

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
          setFacebook(mergedData.facebook || mergedData.custom_fields?.Facebook || '');
          setInstagram(mergedData.instagram || mergedData.custom_fields?.Instagram || '');
          setDescription(mergedData.description || '');
          setPublished(mergedData.published !== false);
          setTags(mergedData.tags || []);
          setImageUrl(mergedData.image_url || null);
          setImagePreview(mergedData.image_url || null);
          setHasManualOverride(!!supabaseLoc);
          initialRef.current = {
            address: mergedData.address || '',
            lat: mergedData.lat || 0,
            lng: mergedData.lng || 0,
            phone: mergedData.phone || '',
            email: mergedData.email || '',
            instagram: cleanUrl(mergedData.instagram || mergedData.custom_fields?.Instagram || '') || '',
            especialidad: String(mergedData.custom_fields?.Especialidad ?? ''),
          };

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

  // Convierte la lista de campos personalizados en objeto
  const buildCustomFieldsObj = () => {
    const obj: Record<string, string> = {};
    customFields.forEach(field => {
      const trimmedKey = field.key.trim();
      if (trimmedKey) obj[trimmedKey] = field.value;
    });
    return obj;
  };

  // Form Submit: si la ficha está vinculada a Dataverse y se editó algo que viaja a Dataverse, primero se pide la doble confirmación.
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

    const cf = buildCustomFieldsObj();
    const dvId = isEdit ? dvContactIdOf(cf) : null;
    const init = initialRef.current;
    if (!dvId || !init) {
      await performSave(null);
      return;
    }

    const igNow = cleanUrl(instagram) || '';
    const edits = {
      celular: phone !== init.phone ? phone.trim() || null : undefined,
      correo: email !== init.email ? email.trim() || null : undefined,
      instagram: igNow !== init.instagram ? igNow || null : undefined,
      especialidad: (cf['Especialidad'] ?? '') !== init.especialidad ? (cf['Especialidad'] ?? '').trim() || null : undefined,
    };
    const addressChanged = address.trim() !== init.address.trim() || lat !== init.lat || lng !== init.lng;
    const hasContactEdits = Object.values(edits).some(v => v !== undefined);
    if (!hasContactEdits && !addressChanged && !imageFile) {
      await performSave(null);
      return;
    }

    try {
      const snap: DvSnapshot = await readDataverseContact(dvId);
      const c = snap.contact;
      const changes: DvChange[] = [];
      const warnings: string[] = [];
      const payload: Omit<WritePayload, 'logo'> = { contactId: c.id, contactEtag: c.etag };
      const contactEdits: NonNullable<WritePayload['contact']> = {};
      const push = (key: 'celular' | 'correo' | 'instagram' | 'especialidad', label: string, now: string | null) => {
        const val = edits[key];
        if (val === undefined || sameText(val, now)) return;
        contactEdits[key] = val;
        changes.push({ label, before: now ?? '', after: val ?? '' });
      };
      push('celular', 'Teléfono / celular', c.celular);
      push('correo', 'Correo', c.correo);
      push('instagram', 'Instagram', c.instagram);
      push('especialidad', 'Especialidad', c.especialidad);
      if (Object.keys(contactEdits).length > 0) payload.contact = contactEdits;

      if (addressChanged) {
        const best = snap.addresses
          .map(a => ({ a, score: a.direccion ? addressScore(init.address, a.direccion) : 0 }))
          .sort((x, y) => y.score - x.score)[0];
        const target = snap.addresses.length === 1 ? snap.addresses[0] : best && best.score >= SAME_PLACE ? best.a : null;
        if (!target) {
          warnings.push('No se pudo identificar con certeza cuál dirección de Dataverse corresponde a esta ficha, así que la dirección NO se enviará. Corrígela directamente en Dataverse (Direcciones Maestra).');
        } else {
          const ap: NonNullable<WritePayload['address']> = { id: target.id, etag: target.etag };
          if (address.trim() !== init.address.trim() && !sameText(address, target.direccion)) {
            ap.direccion = address.trim();
            changes.push({ label: `Dirección de envío (${target.codigo})`, before: target.direccion ?? '', after: address.trim() });
          }
          const sameCoords = Number(target.latitud) === lat && Number(target.longitud) === lng;
          if ((lat !== init.lat || lng !== init.lng) && !sameCoords) {
            ap.latitud = lat;
            ap.longitud = lng;
            changes.push({ label: `Coordenadas (${target.codigo})`, before: `${target.latitud ?? ''}, ${target.longitud ?? ''}`, after: `${lat}, ${lng}` });
          }
          if (ap.direccion !== undefined || ap.latitud !== undefined) {
            if (target.compartidaCon > 0 || target.deOtroContacto) {
              warnings.push(`Esta dirección es una sede compartida con ${target.compartidaCon} contacto(s) más en Dataverse: el cambio los afecta a todos.`);
              ap.confirmShared = true;
            }
            payload.address = ap;
          }
        }
      }

      const wantsPhoto = Boolean(imageFile);
      if (wantsPhoto) {
        changes.push({ label: 'Foto (Logo del contacto)', before: c.tieneLogo ? 'Ya tiene un logo' : '(sin logo)', after: 'Nueva foto de la ficha' });
        if (c.tieneLogo) warnings.push('Dataverse ya tiene un logo para este contacto; se reemplazará por la foto nueva.');
      }

      if (changes.length === 0) {
        await performSave(null); // lo editado ya coincide con Dataverse
        return;
      }
      setDvError(null);
      setDvPending({ subject: `${c.nombreComercial || c.nombre} (${c.codigo})`, changes, warnings, payload, photoOverwrite: c.tieneLogo, wantsPhoto });
      setLoading(false);
    } catch (err) {
      setLoading(false);
      if (err instanceof DvWriteError && err.code === 'sin_permiso') {
        // Esta cuenta no puede escribir en Dataverse: se avisa antes de guardar solo en PlazaDerma (quedaría distinto a Dataverse).
        if (window.confirm('Tu cuenta no está autorizada para escribir en Dataverse.\n\nSi continúas, estos cambios se guardan solo en PlazaDerma y quedarán distintos a Dataverse. ¿Continuar?')) {
          await performSave(null);
        }
        return;
      }
      setError(err instanceof DvWriteError ? err.message : 'No se pudo consultar Dataverse, por eso no se guardó nada. Inténtalo de nuevo.');
    }
  };

  const confirmDataverse = async () => {
    if (!dvPending) return;
    setDvBusy(true);
    setDvError(null);
    await performSave(dvPending);
    setDvBusy(false);
  };

  // Guarda en PlazaDerma (y antes en Dataverse si hay cambios confirmados). Si Dataverse falla, NO se guarda nada en PlazaDerma.
  const performSave = async (dv: typeof dvPending) => {
    if (!activeLocator) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Upload image if selected
      let finalImageUrl = imageUrl;
      if (imageFile) {
        setUploadingImage(true);
        finalImageUrl = await uploadImage(imageFile);
        setUploadingImage(false);
      }

      // 1b. Dataverse primero: si lo rechaza, PlazaDerma no cambia y los datos siguen siendo los mismos.
      if (dv) {
        try {
          await writeToDataverse({
            ...dv.payload,
            ...(dv.wantsPhoto && finalImageUrl ? { logo: { url: finalImageUrl, overwrite: dv.photoOverwrite } } : {}),
          });
        } catch (dvErr) {
          setDvError(dvErr instanceof DvWriteError ? dvErr.message : 'No se pudo guardar en Dataverse. No se guardó nada en PlazaDerma.');
          setLoading(false);
          return;
        }
        setDvPending(null);
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
      const locationPayload: any = {
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

      let { error: upsertErr } = await supabase
        .from('bm_locations')
        .upsert(locationPayload, { onConflict: 'id' });

      // Resilience Fallback: If Supabase table `bm_locations` lacks 'facebook' or 'instagram' columns,
      // store social URLs inside custom_fields and retry upsert without invalid root column keys.
      if (upsertErr && (upsertErr.message.includes('facebook') || upsertErr.message.includes('instagram'))) {
        console.warn('[LocationForm] Supabase table bm_locations is missing social columns. Retrying with custom_fields fallback...', upsertErr);

        const fallbackCustomFields = { ...customFieldsObj };
        const cleanFb = cleanUrl(facebook);
        const cleanIg = cleanUrl(instagram);
        if (cleanFb) fallbackCustomFields['Facebook'] = cleanFb;
        if (cleanIg) fallbackCustomFields['Instagram'] = cleanIg;

        const fallbackPayload: any = {
          id: decodedId,
          locator_id: activeLocator.id,
          name,
          address,
          lat,
          lng,
          phone: phone || null,
          email: email || null,
          website: cleanUrl(website),
          description: description || null,
          tags,
          custom_fields: fallbackCustomFields,
          published,
          image_url: finalImageUrl
        };

        const { error: retryErr } = await supabase
          .from('bm_locations')
          .upsert(fallbackPayload, { onConflict: 'id' });

        upsertErr = retryErr;
      }

      if (upsertErr) throw upsertErr;

      // Go back to locations list
      navigate('/dashboard/locations');
    } catch (err: any) {
      console.error(err);
      if (err.message && err.message.includes('uuid')) {
        setError('La columna "id" de la tabla bm_locations en Supabase está configurada como UUID. Para permitir guardar comercios de la API ERP, ejecuta esta consulta en el SQL Editor de Supabase: ALTER TABLE bm_locations ALTER COLUMN id TYPE text;');
      } else {
        setError(err.message || 'Error al guardar la ubicación.');
      }
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
      {dvPending && (
        <DataverseConfirmModal
          subject={dvPending.subject}
          changes={dvPending.changes}
          warnings={dvPending.warnings}
          busy={dvBusy}
          error={dvError}
          onConfirm={confirmDataverse}
          onCancel={() => { setDvPending(null); setDvError(null); }}
        />
      )}
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
            style={{ 
              backgroundColor: '#00506E', 
              color: '#FFFFFF', 
              padding: '8px 16px', 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              cursor: 'pointer', 
              fontWeight: 600, 
              fontSize: '13px',
              border: 'none', 
              borderRadius: 'var(--radius-md)', 
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
            }}
            title="Restablecer a valores de la API ERP en vivo"
          >
            <RotateCcw size={15} style={{ color: '#FFFFFF' }} />
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
            <h3 style={{ fontSize: '16px', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px', color: 'var(--color-dark-text-primary)' }}>
              Campos Personalizados
            </h3>

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
