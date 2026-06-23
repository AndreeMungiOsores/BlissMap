import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Search, MapPin, AlertCircle } from 'lucide-react';

// Setup Leaflet default marker icons (Leaflet has issues importing icons in Vite)
import iconUrl from 'leaflet/dist/images/marker-icon.png';
import iconRetinaUrl from 'leaflet/dist/images/marker-icon-2x.png';
import shadowUrl from 'leaflet/dist/images/marker-shadow.png';

const DefaultIcon = L.icon({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

interface MapPickerProps {
  address: string;
  lat: number;
  lng: number;
  onChange: (coords: { lat: number; lng: number; address?: string }) => void;
}

const DEFAULT_CENTER = { lat: -12.046374, lng: -77.042793 }; // Lima, Peru

// Leaflet center updater helper
const ChangeView: React.FC<{ center: [number, number]; zoom: number }> = ({ center, zoom }) => {
  const map = useMap();
  useEffect(() => {
    map.setView(center, zoom);
  }, [center, zoom, map]);
  return null;
};

// Fetch helper with timeout
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeout = 5000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

export const MapPicker: React.FC<MapPickerProps> = ({ address, lat, lng, onChange }) => {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(13);
  const [geocoding, setGeocoding] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);

  // Sync center when coordinates are provided
  useEffect(() => {
    if (lat !== 0 && lng !== 0) {
      setCenter({ lat, lng });
      setZoom(16);
    }
  }, [lat, lng]);

  // Geocode address using a resilient dual-service chain (Esri -> Nominatim)
  const handleGeocode = async () => {
    if (!address.trim()) return;
    setGeocoding(true);
    setMapError(null);

    // 1. Try Esri World Geocoder first (very reliable, no localhost blocks, fast)
    try {
      const esriUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(address)}&maxLocations=1`;
      const response = await fetchWithTimeout(esriUrl, {}, 5000);
      const data = await response.json();
      


      if (data && data.candidates && data.candidates.length > 0) {
        const candidate = data.candidates[0];
        const newCoords = { 
          lat: candidate.location.y, 
          lng: candidate.location.x 
        };
        setCenter(newCoords);
        setZoom(16);
        onChange({ 
          ...newCoords, 
          address: candidate.address 
        });
        setGeocoding(false);
        return;
      }
    } catch (err) {
      console.warn('Esri geocoding timed out or failed. Trying Nominatim fallback...', err);
    }

    // 2. Fallback to Nominatim if Esri fails
    try {
      const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
      const response = await fetchWithTimeout(nominatimUrl, {}, 5000);
      const data = await response.json();
      


      if (data && data.length > 0) {
        const item = data[0];
        const newCoords = { 
          lat: parseFloat(item.lat), 
          lng: parseFloat(item.lon) 
        };
        setCenter(newCoords);
        setZoom(16);
        onChange({ 
          ...newCoords, 
          address: item.display_name 
        });
      } else {
        setMapError('No se pudo encontrar la dirección. Intenta agregar más detalles (Ciudad, País).');
      }
    } catch (err) {
      console.error('Nominatim geocoding error:', err);
      setMapError('No se pudo establecer conexión para buscar la dirección. Escribe las coordenadas manualmente o ajusta el marcador.');
    } finally {
      setGeocoding(false);
    }
  };

  // Drag handler for Leaflet marker
  const handleLeafletMarkerDragEnd = (e: any) => {
    const marker = e.target;
    if (marker != null) {
      const position = marker.getLatLng();
      const newCoords = { lat: position.lat, lng: position.lng };
      onChange(newCoords);
    }
  };

  // Render Leaflet Map loading Google Maps styled tiles
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* Geocode Search Row */}
      <div style={{ display: 'flex', gap: '8px' }}>
        <input 
          type="text"
          placeholder="Escribe la dirección y presiona 'Buscar en mapa'..."
          value={address}
          disabled={true}
          className="form-control"
          style={{ flexGrow: 1, backgroundColor: 'var(--color-dark-bg)', cursor: 'not-allowed' }}
        />
        <button
          type="button"
          onClick={handleGeocode}
          disabled={geocoding || !address}
          className="btn btn-secondary"
          style={{ color: 'white', borderColor: 'var(--color-dark-border)', display: 'flex', alignItems: 'center', gap: '6px' }}
        >
          {geocoding ? <div className="spinner" style={{ width: '14px', height: '14px', borderTopColor: '#fff' }}></div> : <Search size={14} />}
          Buscar en Mapa
        </button>
      </div>

      {mapError && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#f87171', fontSize: '13px' }}>
          <AlertCircle size={14} />
          <span>{mapError}</span>
        </div>
      )}

      {/* Map Container Box */}
      <div style={{ 
        height: '320px', 
        width: '100%', 
        borderRadius: 'var(--radius-md)', 
        overflow: 'hidden', 
        border: '1px solid var(--color-dark-border)',
        position: 'relative',
        backgroundColor: '#f1f5f9'
      }}>
        <MapContainer 
          center={[center.lat, center.lng]} 
          zoom={zoom} 
          style={{ width: '100%', height: '100%' }}
          zoomControl={true}
        >
          <ChangeView center={[center.lat, center.lng]} zoom={zoom} />
          {/* Loads Google Maps Roadmap tiles directly inside Leaflet */}
          <TileLayer
            attribution='&copy; Google Maps'
            url="https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"
          />
          <LeafletMarker
            position={[center.lat, center.lng]}
            draggable={true}
            icon={DefaultIcon}
            eventHandlers={{
              dragend: handleLeafletMarkerDragEnd,
            }}
          />
        </MapContainer>
      </div>

      <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
        <MapPin size={12} />
        Puedes arrastrar el marcador en el mapa para ajustar la posición exacta (Lat: {center.lat.toFixed(6)}, Lng: {center.lng.toFixed(6)})
      </span>
    </div>
  );
};
