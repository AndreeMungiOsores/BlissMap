import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LocatorMap } from '../components/LocatorMap';
import { 
  Search, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  Navigation,
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
  lat: number;
  lng: number;
  tags: string[];
  custom_fields: Record<string, string>;
  description: string | null;
  distance?: number; // calculated locally
}

interface LocatorData {
  id: string;
  name: string;
  slug: string;
  map_style: string;
  accent_color: string;
  marker_type: string;
  marker_color: string;
  marker_image_url: string | null;
  search_placeholder: string;
  distance_unit: string;
}

// Haversine formula to calculate distance in km/mi
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number, unit: 'km' | 'mi') => {
  const R = unit === 'km' ? 6371 : 3959; // Earth radius
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const hexToRgb = (hex: string): string => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : '99, 102, 241';
};

export const PublicLocator: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const isPreview = searchParams.get('preview') === 'true';

  const [locator, setLocator] = useState<LocatorData | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [radius, setRadius] = useState<number | 'all'>('all');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocating, setGeolocating] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const fetchLocatorData = async () => {
      setLoading(true);
      setError(null);
      try {
        // 1. Fetch locator info
        const { data: locatorData, error: locatorErr } = await supabase
          .from('bm_locators')
          .select('*')
          .eq('slug', slug)
          .single();

        if (locatorErr || !locatorData) {
          setError('El mapa que buscas no existe o fue eliminado.');
          setLoading(false);
          return;
        }

        setLocator(locatorData);

        // 2. Fetch locations
        const { data: locationsData, error: locationsErr } = await supabase
          .from('bm_locations')
          .select('*')
          .eq('locator_id', locatorData.id)
          .eq('published', true);

        if (locationsErr) throw locationsErr;
        setLocations(locationsData || []);
      } catch (err: any) {
        console.error(err);
        setError('Error al conectar con la base de datos.');
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      fetchLocatorData();
    }
  }, [slug]);

  // Request browser geolocation
  const handleGeolocate = () => {
    if (!navigator.geolocation) {
      alert('La geolocalización no es soportada por tu navegador.');
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserCoords({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setGeolocating(false);
      },
      (err) => {
        console.error('Geolocation error:', err);
        alert('No se pudo obtener tu ubicación actual.');
        setGeolocating(false);
      },
      { timeout: 8000 }
    );
  };

  // Scroll active card into view
  useEffect(() => {
    if (selectedLocationId && cardRefs.current[selectedLocationId]) {
      cardRefs.current[selectedLocationId]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest'
      });
    }
  }, [selectedLocationId]);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#f8fafc' }}>
        <div className="spinner"></div>
      </div>
    );
  }

  if (error || !locator) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f8fafc',
        color: '#0f172a',
        padding: '20px',
        textAlign: 'center',
        fontFamily: 'var(--font-sans)'
      }}>
        <AlertCircle size={48} style={{ color: '#ef4444', marginBottom: '16px' }} />
        <h2 style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Localizador no encontrado</h2>
        <p style={{ color: '#475569', marginTop: '8px', maxWidth: '400px' }}>{error}</p>
      </div>
    );
  }

  // Inject dynamic styles
  const dynamicStyles = {
    '--accent-color': locator.accent_color,
    '--accent-color-rgb': hexToRgb(locator.accent_color)
  } as React.CSSProperties;

  // Process and sort locations list
  const processedLocations = locations
    .map(loc => {
      if (userCoords) {
        const dist = calculateDistance(userCoords.lat, userCoords.lng, loc.lat, loc.lng, locator.distance_unit as 'km' | 'mi');
        return { ...loc, distance: dist };
      }
      return loc;
    })
    .filter(loc => {
      // 1. Text Search Filter (name, address, tags, custom field values)
      const query = searchQuery.toLowerCase().trim();
      if (query) {
        const inName = loc.name.toLowerCase().includes(query);
        const inAddress = loc.address.toLowerCase().includes(query);
        const inTags = loc.tags.some(t => t.toLowerCase().includes(query));
        const inCustom = Object.values(loc.custom_fields).some(v => v.toLowerCase().includes(query));
        
        if (!inName && !inAddress && !inTags && !inCustom) {
          return false;
        }
      }

      // 2. Distance Radius Filter
      if (radius !== 'all' && userCoords && loc.distance !== undefined) {
        if (loc.distance > radius) {
          return false;
        }
      }

      return true;
    });

  // Sort by distance if userCoords are available, otherwise alphabetically by name
  if (userCoords) {
    processedLocations.sort((a, b) => (a.distance || 0) - (b.distance || 0));
  } else {
    processedLocations.sort((a, b) => a.name.localeCompare(b.name));
  }

  return (
    <div className="locator-layout" style={dynamicStyles}>
      
      {/* Sidebar Panel */}
      <div className="locator-sidebar">
        
        {/* Sidebar Header & Search Box */}
        <div className="locator-search-container">
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '20px', fontWeight: 800, fontFamily: 'var(--font-display)', color: 'var(--color-text-primary)' }}>
              {locator.name}
            </h2>
            {isPreview && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', backgroundColor: 'rgba(99, 102, 241, 0.1)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                Vista Previa
              </span>
            )}
          </div>

          <div className="locator-search-input-wrapper">
            <Search size={18} className="locator-search-icon" />
            <input 
              type="text" 
              placeholder={locator.search_placeholder}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="locator-search-input"
            />
          </div>

          {/* Filters (Distance + Current Geolocation) */}
          <div className="locator-filters-row">
            <select 
              value={radius} 
              onChange={(e) => setRadius(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              disabled={!userCoords}
              className="locator-select"
              style={{ flexGrow: 1 }}
            >
              <option value="all">Todas las distancias</option>
              <option value="10">Dentro de 10 {locator.distance_unit}</option>
              <option value="25">Dentro de 25 {locator.distance_unit}</option>
              <option value="50">Dentro de 50 {locator.distance_unit}</option>
              <option value="100">Dentro de 100 {locator.distance_unit}</option>
            </select>

            <button 
              onClick={handleGeolocate}
              disabled={geolocating}
              className="btn btn-secondary"
              style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px' }}
              title="Buscar cerca de mí"
            >
              {geolocating ? (
                <div className="spinner" style={{ width: '14px', height: '14px', borderTopColor: 'var(--accent-color)' }}></div>
              ) : (
                <>
                  <MapPin size={14} style={{ color: 'var(--accent-color)' }} />
                  <span>Cerca de mí</span>
                </>
              )}
            </button>
          </div>

          {/* Result Info */}
          <div className="locator-results-info">
            {processedLocations.length === 0 ? 'No se encontraron resultados' : (
              `${processedLocations.length} ${processedLocations.length === 1 ? 'ubicación encontrada' : 'ubicaciones encontradas'}`
            )}
          </div>
        </div>

        {/* Results Card List */}
        <div className="locator-list" ref={cardsContainerRef}>
          {processedLocations.map(loc => {
            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
            const isActiveCard = selectedLocationId === loc.id;
            
            return (
              <div 
                key={loc.id} 
                className={`locator-card ${isActiveCard ? 'active' : ''}`}
                ref={el => { cardRefs.current[loc.id] = el; }}
                onClick={() => setSelectedLocationId(loc.id)}
              >
                {/* Photo */}
                {loc.image_url ? (
                  <img src={loc.image_url} alt={loc.name} className="locator-card-img" />
                ) : (
                  <div className="locator-card-placeholder-img">
                    <MapPin size={24} />
                  </div>
                )}

                {/* Card Data */}
                <div className="locator-card-content">
                  <div>
                    <h4 className="locator-card-name">{loc.name}</h4>
                    <p className="locator-card-address">{loc.address}</p>
                    
                    {loc.distance !== undefined && (
                      <span className="locator-card-distance">
                        A {loc.distance.toFixed(1)} {locator.distance_unit} de ti
                      </span>
                    )}

                    {/* Metadata Items */}
                    {(loc.phone || loc.email || loc.website) && (
                      <div className="locator-card-meta">
                        {loc.phone && (
                          <div className="locator-meta-item">
                            <Phone size={12} />
                            <span>{loc.phone}</span>
                          </div>
                        )}
                        {loc.email && (
                          <div className="locator-meta-item">
                            <Mail size={12} />
                            <span>{loc.email}</span>
                          </div>
                        )}
                        {loc.website && (
                          <div className="locator-meta-item">
                            <Globe size={12} />
                            <a href={loc.website} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', color: 'var(--accent-color)' }}>
                              Visitar sitio
                            </a>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Custom Fields (like CMP) */}
                    {loc.custom_fields && Object.keys(loc.custom_fields).length > 0 && (
                      <div className="locator-custom-fields">
                        {Object.entries(loc.custom_fields).map(([key, val]) => (
                          <div key={key} className="locator-field-item">
                            <span className="locator-field-label">{key}:</span>
                            <span>{val}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Tags */}
                    {loc.tags && loc.tags.length > 0 && (
                      <div className="locator-tags">
                        {loc.tags.map(t => (
                          <span key={t} className="locator-tag">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Get Directions Button */}
                  <a href={googleMapsUrl} target="_blank" rel="noreferrer" className="locator-directions-btn" onClick={(e) => e.stopPropagation()}>
                    <Navigation size={12} />
                    Cómo llegar
                  </a>

                </div>
              </div>
            );
          })}
        </div>

      </div>

      {/* Map Panel */}
      <div className="locator-map-container">
        <LocatorMap 
          locations={processedLocations}
          selectedLocationId={selectedLocationId}
          onSelectLocation={setSelectedLocationId}
          mapStyle={locator.map_style}
          markerType={locator.marker_type}
          markerColor={locator.marker_color}
          markerImageUrl={locator.marker_image_url}
        />
      </div>

    </div>
  );
};
