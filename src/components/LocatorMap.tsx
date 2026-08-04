import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';

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
  lat: number;
  lng: number;
  tags: string[];
  custom_fields: Record<string, string>;
  description: string | null;
  products?: ProductItem[];
}

interface LocatorMapProps {
  locations: LocationItem[];
  selectedLocationId: string | null;
  onSelectLocation: (id: string | null) => void;
  mapStyle: string;
  markerType: string;
  markerColor: string;
  markerImageUrl: string | null;
}

// Custom Cluster Icon generator with gradient colors and size scaling
const createCustomClusterIcon = (cluster: any) => {
  const count = cluster.getChildCount();
  let sizeClass = 'cluster-small';
  if (count >= 50) {
    sizeClass = 'cluster-large';
  } else if (count >= 10) {
    sizeClass = 'cluster-medium';
  }

  return L.divIcon({
    html: `<div class="cluster-inner"><span>${count}</span></div>`,
    className: `custom-marker-cluster ${sizeClass}`,
    iconSize: L.point(44, 44),
    iconAnchor: L.point(22, 22)
  });
};

// Leaflet center updater and bounds adjuster helper
const FitMapBounds: React.FC<{ locations: LocationItem[]; selectedLocation: LocationItem | null }> = ({ locations, selectedLocation }) => {
  const map = useMap();

  useEffect(() => {
    if (selectedLocation) {
      map.setView([selectedLocation.lat, selectedLocation.lng], 18, { animate: true });

      // On mobile the map is full-screen (100vh) with a bottom sheet overlaid on top.
      // getSize().y always returns ~100vh so we can't rely on it.
      // Instead detect mobile via window width and shift the view up by the
      // approximate height of the bottom sheet so the pin lands in the
      // visible portion of the map above the sheet.
      map.once('moveend', () => {
        const isMobile = window.innerWidth <= 768;
        if (isMobile) {
          // sheet-expanded is 45vh; centre the pin halfway between top of
          // visible area and top of sheet → offset = 45vh / 2 ≈ 22.5vh
          const sheetH = window.innerHeight * 0.45;
          const offsetPx = Math.round(sheetH / 2);
          map.panBy([0, offsetPx], { animate: true, duration: 0.4 });
        }
      });
    } else if (locations.length > 0) {
      const bounds = L.latLngBounds(locations.map(loc => [loc.lat, loc.lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });
    }
  }, [locations, selectedLocation, map]);

  return null;
};

export const LocatorMap: React.FC<LocatorMapProps> = ({
  locations,
  selectedLocationId,
  onSelectLocation,
  mapStyle,
  markerType,
  markerColor,
  markerImageUrl
}) => {
  const selectedLocation = locations.find(loc => loc.id === selectedLocationId) || null;

  // Leaflet Dynamic Colored Pin SVG / Custom image loader
  const getLeafletIcon = (locId: string) => {
    const isActive = locId === selectedLocationId;
    const finalColor = markerColor;

    if (markerType === 'custom' && markerImageUrl) {
      return L.icon({
        iconUrl: markerImageUrl,
        iconSize: isActive ? [40, 40] : [32, 32],
        iconAnchor: isActive ? [20, 40] : [16, 32],
        popupAnchor: [0, -32]
      });
    }

    // Dynamic colored pin SVG
    const scale = isActive ? 1.6 : 1.0;
    const width = 34 * scale;
    const height = 34 * scale;
    const anchorX = 17 * scale;
    const anchorY = 34 * scale;

    const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${width}" height="${height}" class="custom-leaflet-marker" style="filter: ${isActive ? `drop-shadow(0 0 6px ${finalColor}) drop-shadow(0 3px 8px rgba(0,0,0,0.45))` : 'drop-shadow(0 2px 4px rgba(0,0,0,0.25))'}"><path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" fill="${finalColor}" stroke="#ffffff" stroke-width="${isActive ? 2.5 : 1.5}"/><circle cx="12" cy="10" r="3.5" fill="#FFFFFF"/></svg>`;

    // Active marker: wrap in a container that adds the pulsing ring
    const iconHtml = isActive
      ? `<div class="active-marker-wrapper"><div class="active-marker-pulse" style="--pulse-color: ${finalColor}"></div>${svgPin}</div>`
      : svgPin;

    return L.divIcon({
      html: iconHtml,
      className: isActive ? 'custom-pin-container active-pin-container' : 'custom-pin-container',
      iconSize: [width, height],
      iconAnchor: [anchorX, anchorY],
      popupAnchor: [0, -anchorY]
    });
  };

  const getTileUrl = () => {
    switch (mapStyle) {
      case 'light':
        return 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
      case 'dark':
        return 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
      case 'satellite':
        return 'https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
      default:
        return 'https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}';
    }
  };

  const getAttribution = () => {
    if (mapStyle === 'satellite' || mapStyle === 'default') {
      return '&copy; Google Maps';
    }
    return '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <MapContainer
        center={[-12.046374, -77.042793]} // default Lima, Peru
        zoom={12}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <FitMapBounds locations={locations} selectedLocation={selectedLocation} />
        
        <TileLayer
          attribution={getAttribution()}
          url={getTileUrl()}
        />

        {/* Marker Cluster Group with custom styling */}
        <MarkerClusterGroup
          chunkedLoading
          iconCreateFunction={createCustomClusterIcon}
          maxClusterRadius={45}
          spiderfyOnMaxZoom={true}
          showCoverageOnHover={false}
          zoomToBoundsOnClick={true}
          disableClusteringAtZoom={17}
        >
          {locations.map(loc => {
            return (
              <LeafletMarker
                key={loc.id}
                position={[loc.lat, loc.lng]}
                icon={getLeafletIcon(loc.id)}
                eventHandlers={{
                  click: () => onSelectLocation(loc.id),
                }}
              >
                <Popup>
                  <div style={{ color: '#00506E', width: '220px', fontFamily: 'var(--font-sans)', fontSize: '13px', padding: '2px' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '14px', margin: '0 0 4px 0', color: '#00506E', lineHeight: '1.3' }}>{loc.name}</h4>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 8px 0', lineHeight: '1.3' }}>{loc.address}</p>
                    
                    {loc.phone && <div style={{ fontSize: '11px', fontWeight: 600, color: '#475569', margin: '0 0 8px 0' }}>Tel: {loc.phone}</div>}

                    <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
                        target="_blank" 
                        rel="noreferrer" 
                        style={{
                          flexGrow: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '4px',
                          backgroundColor: '#1EC8AA',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: '11px',
                          padding: '7px 8px',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          boxShadow: '0 2px 4px rgba(30, 200, 170, 0.25)'
                        }}
                      >
                        📍 Cómo llegar
                      </a>

                      {(() => {
                        const cleanDigits = loc.phone ? loc.phone.replace(/\D/g, '') : '';
                        const cleanPhone = (cleanDigits.length === 9 && cleanDigits.startsWith('9')) 
                          ? cleanDigits 
                          : (cleanDigits.length === 11 && cleanDigits.startsWith('519')) 
                            ? cleanDigits.substring(2) 
                            : (cleanDigits.length >= 7 ? cleanDigits : null);
                        
                        if (!cleanPhone) return null;
                        return (
                          <a 
                            href={`https://wa.me/51${cleanPhone}`}
                            target="_blank" 
                            rel="noreferrer" 
                            style={{
                              flexGrow: 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              gap: '4px',
                              backgroundColor: '#25D366',
                              color: '#FFFFFF',
                              fontWeight: 700,
                              fontSize: '11px',
                              padding: '7px 8px',
                              borderRadius: '8px',
                              textDecoration: 'none',
                              boxShadow: '0 2px 4px rgba(37, 211, 102, 0.25)'
                            }}
                          >
                            💬 WhatsApp
                          </a>
                        );
                      })()}
                    </div>
                  </div>
                </Popup>
              </LeafletMarker>
            );
          })}
        </MarkerClusterGroup>
      </MapContainer>
    </div>
  );
};
