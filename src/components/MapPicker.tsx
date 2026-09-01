import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { MapPin } from 'lucide-react';

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
  address?: string;
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

export const MapPicker: React.FC<MapPickerProps> = ({ lat, lng, onChange }) => {
  const [center, setCenter] = useState(DEFAULT_CENTER);
  const [zoom, setZoom] = useState(13);

  // Sync center when coordinates are provided
  useEffect(() => {
    if (lat !== 0 && lng !== 0) {
      setCenter({ lat, lng });
      setZoom(16);
    }
  }, [lat, lng]);

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
