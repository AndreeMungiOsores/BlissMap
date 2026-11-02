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
  linked_entities?: LocationItem[];
}

interface LocatorMapProps {
  locations: LocationItem[];
  selectedLocationId: string | null;
  onSelectLocation: (id: string | null) => void;
  mapStyle: string;
  markerType: string;
  markerColor: string;
  markerImageUrl: string | null;
  markerScale?: number;
  zoomControl?: boolean;
  initialCenterToLima?: boolean;
  /** When true, locations that have an image_url are drawn with their logo/photo instead of the generic pin. */
  showLocationLogos?: boolean;
}

// Custom Cluster Icon generator with gradient colors, size scaling and interactive hint bubble
const createCustomClusterIcon = (cluster: any) => {
  const count = cluster.getChildCount();
  let sizeClass = 'cluster-small';
  if (count >= 50) {
    sizeClass = 'cluster-large';
  } else if (count >= 10) {
    sizeClass = 'cluster-medium';
  }

  return L.divIcon({
    html: `
      <div class="cluster-bubble-hint" title="Toca para ver ${count} lugares" aria-label="Toca para ver ${count} lugares">
        <span>Toca para ver</span>
      </div>
      <div class="cluster-inner"><span>${count}</span></div>
    `,
    className: `custom-marker-cluster ${sizeClass}`,
    iconSize: L.point(44, 44),
    iconAnchor: L.point(22, 22)
  });
};


// Leaflet center updater, bounds adjuster and initial zoom watcher helper
const FitMapBounds: React.FC<{
  locations: LocationItem[];
  selectedLocation: LocationItem | null;
  initialCenterToLima?: boolean;
}> = ({ locations, selectedLocation, initialCenterToLima }) => {
  const map = useMap();
  const hasInitializedRef = React.useRef(false);
  const initialZoomRef = React.useRef<number | null>(null);

  // Sync zoom state with CSS class on map container
  const updateZoomClass = React.useCallback(() => {
    const container = map.getContainer();
    if (!container) return;

    if (initialZoomRef.current === null) return;

    const currentZoom = map.getZoom();
    // Allow small epsilon (0.2) for fractional zoom on mobile pinch gestures
    const isAtInitial = currentZoom <= (initialZoomRef.current + 0.2);
    if (isAtInitial) {
      container.classList.add('map-at-initial-zoom');
    } else {
      container.classList.remove('map-at-initial-zoom');
    }
  }, [map]);

  // Listen to zoom and move events
  useEffect(() => {
    map.on('zoom', updateZoomClass);
    map.on('zoomend', updateZoomClass);
    map.on('moveend', updateZoomClass);

    return () => {
      map.off('zoom', updateZoomClass);
      map.off('zoomend', updateZoomClass);
      map.off('moveend', updateZoomClass);
    };
  }, [map, updateZoomClass]);

  useEffect(() => {
    if (selectedLocation) {
      const isDoctor = selectedLocation.custom_fields?.['entity_type'] === 'doctor';
      const validSedes = (isDoctor && selectedLocation.linked_entities)
        ? selectedLocation.linked_entities.filter(s => s.lat && s.lng && (s.lat !== 0 || s.lng !== 0))
        : [];

      if (validSedes.length > 1) {
        const lats = validSedes.map(s => s.lat);
        const lngs = validSedes.map(s => s.lng);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        const isNearby = (maxLat - minLat < 0.003) && (maxLng - minLng < 0.003);

        if (isNearby) {
          map.setView([lats[0], lngs[0]], 16, { animate: true });
        } else {
          const bounds = L.latLngBounds(validSedes.map(s => [s.lat, s.lng]));
          map.fitBounds(bounds, { padding: [70, 70], maxZoom: 16 });
        }

        map.once('moveend', () => {
          const isMobile = window.innerWidth <= 768;
          if (isMobile) {
            const sheetH = window.innerHeight * 0.45;
            const offsetPx = Math.round(sheetH / 2);
            map.panBy([0, offsetPx], { animate: true, duration: 0.4 });
          }
          updateZoomClass();
        });
      } else {
        const targetLat = validSedes.length === 1 ? validSedes[0].lat : selectedLocation.lat;
        const targetLng = validSedes.length === 1 ? validSedes[0].lng : selectedLocation.lng;

        if (targetLat && targetLng && (targetLat !== 0 || targetLng !== 0)) {
          map.setView([targetLat, targetLng], 17, { animate: true });

          // On mobile the map is full-screen (100vh) with a bottom sheet overlaid on top.
          map.once('moveend', () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
              const sheetH = window.innerHeight * 0.45;
              const offsetPx = Math.round(sheetH / 2);
              map.panBy([0, offsetPx], { animate: true, duration: 0.4 });
            }
            updateZoomClass();
          });
        }
      }
    } else if (locations.length > 0) {
      if (initialCenterToLima && !hasInitializedRef.current) {
        hasInitializedRef.current = true;
        map.setView([-12.07, -77.03], 11, { animate: false });
        initialZoomRef.current = 11;
        updateZoomClass();
        return;
      }
      const validLocs = locations.filter(loc => loc.lat && loc.lng && (loc.lat !== 0 || loc.lng !== 0));
      if (validLocs.length > 0) {
        const bounds = L.latLngBounds(validLocs.map(loc => [loc.lat, loc.lng]));
        map.fitBounds(bounds, { padding: [50, 50], maxZoom: 14 });

        // Calculate expected initial zoom and sync
        try {
          const targetZoom = Math.min(map.getBoundsZoom(bounds, false, L.point(50, 50)), 14);
          initialZoomRef.current = targetZoom;
          updateZoomClass();
        } catch {
          // Fallback if bounds calculation needs rendered dimensions
          initialZoomRef.current = map.getZoom();
          updateZoomClass();
        }

        map.once('moveend', () => {
          initialZoomRef.current = map.getZoom();
          updateZoomClass();
        });
      }
    }
  }, [locations, selectedLocation, map, initialCenterToLima, updateZoomClass]);

  return null;
};

export const LocatorMap: React.FC<LocatorMapProps> = ({
  locations,
  selectedLocationId,
  onSelectLocation,
  mapStyle,
  markerType,
  markerColor,
  markerImageUrl,
  markerScale = 1.0,
  zoomControl = false,
  initialCenterToLima = false,
  showLocationLogos = false
}) => {
  const selectedLocation = locations.find(loc => loc.id === selectedLocationId || loc.custom_fields?.['db_id'] === selectedLocationId) || null;

  // Leaflet Dynamic Colored Pin SVG / Custom image loader
  const getLeafletIcon = (locId: string, logoUrl?: string | null) => {
    const isDirectlySelected = locId === selectedLocationId ||
      Boolean(selectedLocation && (selectedLocation.id === locId || selectedLocation.custom_fields?.['db_id'] === locId));
    const isLinkedSede = selectedLocation?.custom_fields?.['entity_type'] === 'doctor' &&
      Boolean(selectedLocation.linked_entities?.some(s => s.id === locId || s.custom_fields?.['db_id'] === locId));
    const isActive = isDirectlySelected || isLinkedSede;
    const finalColor = markerColor;
    const currentScale = Math.min(Math.max(Number(markerScale) || 1.0, 0.5), 3.0);

    // Location logo/photo pin: takes precedence over the pin configured in the admin panel
    if (showLocationLogos && logoUrl) {
      const safeUrl = logoUrl.trim().replace(/"/g, '%22').replace(/</g, '%3C').replace(/>/g, '%3E');
      const activeFactor = isActive ? 1.3 : 1.0;
      const circle = Math.round(44 * activeFactor * currentScale);
      const tail = Math.round(10 * activeFactor * currentScale);
      const totalH = circle + tail;
      const html = `<div class="logo-pin${isActive ? ' logo-pin-active' : ''}" style="width:${circle}px;height:${totalH}px;--pin-color:${finalColor}">`
        + (isActive ? `<div class="active-marker-pulse" style="--pulse-color:${finalColor};bottom:0"></div>` : '')
        + `<div class="logo-pin-circle" style="width:${circle}px;height:${circle}px"><img src="${safeUrl}" alt="" draggable="false" onerror="this.style.display='none'" /></div>`
        + `<div class="logo-pin-tail" style="border-left-width:${Math.round(tail * 0.8)}px;border-right-width:${Math.round(tail * 0.8)}px;border-top-width:${tail}px"></div>`
        + `</div>`;
      return L.divIcon({
        html,
        className: `custom-pin-container logo-pin-container${isActive ? ' active-pin-container' : ''}`,
        iconSize: [circle, totalH],
        iconAnchor: [Math.round(circle / 2), totalH],
        popupAnchor: [0, -totalH]
      });
    }

    if (markerType === 'custom' && markerImageUrl) {
      const baseSize = isActive ? 40 : 32;
      const w = Math.round(baseSize * currentScale);
      const h = Math.round(baseSize * currentScale);
      return L.icon({
        iconUrl: markerImageUrl,
        iconSize: [w, h],
        iconAnchor: [Math.round(w / 2), h],
        popupAnchor: [0, -h]
      });
    }

    // Dynamic colored pin SVG
    const activeFactor = isActive ? 1.6 : 1.0;
    const width = Math.round(34 * activeFactor * currentScale);
    const height = Math.round(34 * activeFactor * currentScale);
    const anchorX = Math.round(17 * activeFactor * currentScale);
    const anchorY = Math.round(34 * activeFactor * currentScale);

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
        center={initialCenterToLima ? [-12.07, -77.03] : [-12.046374, -77.042793]} // default Lima, Peru
        zoom={initialCenterToLima ? 11 : 12}
        style={{ width: '100%', height: '100%' }}
        zoomControl={zoomControl}
        scrollWheelZoom={true}
      >
        <FitMapBounds locations={locations} selectedLocation={selectedLocation} initialCenterToLima={initialCenterToLima} />
        
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
            if (!loc.lat || !loc.lng || (loc.lat === 0 && loc.lng === 0)) return null;
            return (
              <LeafletMarker
                key={`${loc.id}-${loc.custom_fields?.['Documento'] || ''}`}
                position={[loc.lat, loc.lng]}
                icon={getLeafletIcon(loc.id, loc.image_url)}
                eventHandlers={{
                  click: () => onSelectLocation(loc.id),
                }}
              >
                <Popup>
                  <div style={{ color: '#00506E', width: '220px', fontFamily: 'var(--font-sans)', fontSize: '13px', padding: '2px' }}>
                    <h4 style={{ fontWeight: 700, fontSize: '14px', margin: '0 0 4px 0', color: '#00506E', lineHeight: '1.3' }}>{loc.name}</h4>
                    <p style={{ fontSize: '12px', color: '#64748B', margin: '0 0 8px 0', lineHeight: '1.3' }}>{loc.address}</p>
                    
                    {loc.phone && <div style={{ fontSize: '11px', fontWeight: 600, color: '#475569', margin: '0 0 8px 0' }}>Tel: {loc.phone}</div>}

                    <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                      <a 
                        href={`https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`}
                        target="_blank" 
                        rel="noreferrer" 
                        style={{
                          flexGrow: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          backgroundColor: '#1EC8AA',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: '11px',
                          padding: '6px 6px',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          boxShadow: '0 2px 4px rgba(30, 200, 170, 0.25)'
                        }}
                        title="Navegar con Google Maps"
                      >
                        🗺️ Maps
                      </a>

                      <a 
                        href={`https://waze.com/ul?ll=${loc.lat},${loc.lng}&navigate=yes`}
                        target="_blank" 
                        rel="noreferrer" 
                        style={{
                          flexGrow: 1,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '3px',
                          backgroundColor: '#05C3DD',
                          color: '#FFFFFF',
                          fontWeight: 700,
                          fontSize: '11px',
                          padding: '6px 6px',
                          borderRadius: '8px',
                          textDecoration: 'none',
                          boxShadow: '0 2px 4px rgba(5, 195, 221, 0.25)'
                        }}
                        title="Navegar con Waze"
                      >
                        🚙 Waze
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
