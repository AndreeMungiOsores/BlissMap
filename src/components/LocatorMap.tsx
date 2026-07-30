import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker as LeafletMarker, Popup, useMap } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import L from 'leaflet';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { getProbabilityInfo } from '../pages/PublicLocator';

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
      map.setView([selectedLocation.lat, selectedLocation.lng], 15, { animate: true });
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
    const scale = isActive ? 1.25 : 1.0;
    const width = 34 * scale;
    const height = 34 * scale;
    const anchorX = 17 * scale;
    const anchorY = 34 * scale;

    const svgPin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${width}" height="${height}" class="custom-leaflet-marker"><path d="M12 2C7.58 2 4 5.58 4 10c0 5.25 8 12 8 12s8-6.75 8-12c0-4.42-3.58-8-8-8z" fill="${finalColor}" stroke="#ffffff" stroke-width="1.5"/><circle cx="12" cy="10" r="3.5" fill="#FFFFFF"/></svg>`;
    
    return L.divIcon({
      html: svgPin,
      className: 'custom-pin-container',
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
        zoomControl={true}
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
            const productCount = loc.products?.length || 0;

            // Sort products by score descending (Alta -> Media -> Baja)
            const sortedProducts = loc.products ? [...loc.products].sort((a, b) => {
              return getProbabilityInfo(b.last_date).score - getProbabilityInfo(a.last_date).score;
            }) : [];

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
                  <div style={{ color: '#0f172a', width: '230px', fontFamily: 'var(--font-sans)', fontSize: '13px' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '14px', margin: '0 0 4px 0', color: '#1e293b' }}>{loc.name}</h4>
                    <p style={{ fontSize: '11px', color: '#475569', margin: '0 0 6px 0', lineHeight: 1.3 }}>{loc.address}</p>
                    
                    {loc.phone && <div style={{ fontSize: '11px', fontWeight: 600, margin: '2px 0 6px 0' }}>Tel: {loc.phone}</div>}

                    {productCount > 0 && (
                      <div style={{ marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #e2e8f0' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: '#3b82f6', marginBottom: '4px' }}>
                          📦 {productCount} productos registrados:
                        </div>
                        <div style={{ maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                          {sortedProducts.slice(0, 5).map((p, idx) => {
                            const prob = getProbabilityInfo(p.last_date);

                            return (
                              <div key={idx} style={{ fontSize: '10px', color: '#334155', display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: '#f8fafc', padding: '3px 6px', borderRadius: '4px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                                  <span>{p.name}</span>
                                  <span>x{p.qty}</span>
                                </div>
                                <span style={{
                                  backgroundColor: prob.bgColor,
                                  color: prob.textColor,
                                  border: `1px solid ${prob.borderColor}`,
                                  padding: '1px 6px',
                                  borderRadius: '10px',
                                  fontSize: '9px',
                                  fontWeight: 700,
                                  alignSelf: 'flex-start'
                                }}>
                                  {prob.label}
                                </span>
                              </div>
                            );
                          })}
                          {productCount > 5 && (
                            <div style={{ fontSize: '10px', color: '#64748b', fontStyle: 'italic', marginTop: '2px' }}>
                              + {productCount - 5} más...
                            </div>
                          )}
                        </div>
                      </div>
                    )}
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
