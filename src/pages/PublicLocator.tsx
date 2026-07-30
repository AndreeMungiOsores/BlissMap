import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LocatorMap } from '../components/LocatorMap';
import localDoctorsData from '../data/doctors_data.json';
import logoImg from '../assets/logo.png';
import { 
  Search, 
  MapPin, 
  Phone, 
  Mail, 
  Globe, 
  Navigation,
  AlertCircle,
  Package,
  ChevronDown,
  ChevronUp,
  X,
  Sparkles,
  Tag
} from 'lucide-react';

interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
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

export type ProbabilityTier = 'alta' | 'media' | 'baja';

export interface ProbabilityInfo {
  tier: ProbabilityTier;
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
  score: number;
}

// Pre-calculated memoized probability info
export const getProbabilityInfo = (lastDateStr?: string): ProbabilityInfo => {
  if (!lastDateStr) {
    return {
      tier: 'baja',
      label: 'Baja probabilidad',
      bgColor: '#ffe4e6', // Pastel Red
      textColor: '#9f1239',
      borderColor: '#fecdd3',
      score: 1
    };
  }

  const refDate = new Date('2026-07-30').getTime();
  const purchaseDate = new Date(lastDateStr).getTime();
  const diffMs = Math.max(0, refDate - purchaseDate);
  const diffDays = diffMs / (1000 * 3600 * 24);
  const diffMonths = diffDays / 30.4375;

  if (diffMonths <= 2) {
    return {
      tier: 'alta',
      label: 'Alta probabilidad',
      bgColor: '#dcfce7', // Pastel Green
      textColor: '#15803d',
      borderColor: '#86efac',
      score: 3
    };
  } else if (diffMonths <= 4) {
    return {
      tier: 'media',
      label: 'Media probabilidad',
      bgColor: '#fef9c3', // Pastel Yellow
      textColor: '#a16207',
      borderColor: '#fde047',
      score: 2
    };
  } else {
    return {
      tier: 'baja',
      label: 'Baja probabilidad',
      bgColor: '#ffe4e6', // Pastel Red
      textColor: '#be123c',
      borderColor: '#fda4af',
      score: 1
    };
  }
};

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number, unit: 'km' | 'mi') => {
  const R = unit === 'km' ? 6371 : 3959;
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
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});

  // Search & Filter State
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [radius, setRadius] = useState<number | 'all'>('all');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocating, setGeolocating] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(30);

  const cardsContainerRef = useRef<HTMLDivElement>(null);
  const searchWrapperRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const fetchLocatorData = async () => {
      setLoading(true);
      setError(null);
      try {
        let currentLocator: LocatorData | null = null;
        let currentLocations: LocationItem[] = [];

        const TEST_NAMES = ['daysi timana', 'winston maldonado', 'marjorie villate', 'giuliana peching'];

        const { data: locatorData } = await supabase
          .from('bm_locators')
          .select('*')
          .eq('slug', slug)
          .maybeSingle();

        if (locatorData) {
          currentLocator = locatorData;
          const { data: locationsData } = await supabase
            .from('bm_locations')
            .select('*')
            .eq('locator_id', locatorData.id)
            .eq('published', true);
            
          if (locationsData && locationsData.length > 0) {
            const cleanedDbLocs = (locationsData as LocationItem[]).filter(
              loc => !TEST_NAMES.some(tn => loc.name.toLowerCase().includes(tn))
            );
            if (cleanedDbLocs.length >= 50) {
              currentLocations = cleanedDbLocs;
            }
          }
        }

        // Always load local dataset (411 doctors) for medicosbliss / plaza-derma or when db count is low
        if (currentLocations.length < 50) {
          currentLocator = currentLocator || {
            id: 'local-medicosbliss',
            name: 'MedicosBliss',
            slug: slug || 'medicosbliss',
            map_style: 'default',
            accent_color: '#1EC8AA',
            marker_type: 'standard',
            marker_color: '#1EC8AA',
            marker_image_url: null,
            search_placeholder: 'Buscar por producto, marca o médico...',
            distance_unit: 'km'
          };
          currentLocations = localDoctorsData as LocationItem[];
        }

        setLocator(currentLocator);
        setLocations(currentLocations);
      } catch (err: any) {
        console.error(err);
        setLocator({
          id: 'local-medicosbliss',
          name: 'MedicosBliss',
          slug: slug || 'medicosbliss',
          map_style: 'default',
          accent_color: '#1EC8AA',
          marker_type: 'standard',
          marker_color: '#1EC8AA',
          marker_image_url: null,
          search_placeholder: 'Buscar por producto, marca o médico...',
          distance_unit: 'km'
        });
        setLocations(localDoctorsData as LocationItem[]);
      } finally {
        setLoading(false);
      }
    };

    if (slug) {
      fetchLocatorData();
    }
  }, [slug]);

  // Extract all unique brands across dataset
  const allUniqueBrands = useMemo(() => {
    const set = new Set<string>();
    locations.forEach(loc => {
      loc.products?.forEach(p => {
        if (p.brand) set.add(p.brand.toUpperCase());
      });
    });
    return Array.from(set).sort();
  }, [locations]);

  // Extract all unique products across all locations
  const allUniqueProducts = useMemo(() => {
    const map = new Map<string, ProductItem>();
    locations.forEach(loc => {
      loc.products?.forEach(p => {
        if (!map.has(p.name)) {
          map.set(p.name, p);
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [locations]);

  // Brand suggestions matching query
  const brandSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    return allUniqueBrands.filter(b => b.toLowerCase().includes(q));
  }, [searchQuery, allUniqueBrands]);

  // Product suggestions matching query or brand
  const productSuggestions = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return [];
    return allUniqueProducts.filter(
      p => (p.name.toLowerCase().includes(q) || (p.brand && p.brand.toLowerCase().includes(q))) && !selectedProducts.includes(p.name)
    ).slice(0, 8);
  }, [searchQuery, allUniqueProducts, selectedProducts]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchWrapperRef.current && !searchWrapperRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addProductFilter = (productName: string) => {
    if (!selectedProducts.includes(productName)) {
      setSelectedProducts(prev => [...prev, productName]);
    }
    setSearchQuery('');
    setIsDropdownOpen(false);
  };

  const removeProductFilter = (productName: string) => {
    setSelectedProducts(prev => prev.filter(p => p !== productName));
  };

  const selectBrandFilter = (brandName: string) => {
    setSearchQuery(brandName);
    setIsDropdownOpen(false);
  };

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

  const toggleProductExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedProducts(prev => ({ ...prev, [id]: !prev[id] }));
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

  // Process, filter, and sort locations (Memoized for high performance)
  const processedLocations = useMemo(() => {
    const unit = locator?.distance_unit || 'km';
    return locations
      .map(loc => {
        let maxProbScore = 0;

        if (loc.products && loc.products.length > 0) {
          loc.products.forEach(p => {
            const prob = getProbabilityInfo(p.last_date);
            if (prob.score > maxProbScore) {
              maxProbScore = prob.score;
            }
          });
        }

        if (userCoords) {
          const dist = calculateDistance(userCoords.lat, userCoords.lng, loc.lat, loc.lng, unit as 'km' | 'mi');
          return { ...loc, distance: dist, maxProbScore };
        }
        return { ...loc, maxProbScore };
      })
      .filter(loc => {
        // 1. Multi-product tags filter
        if (selectedProducts.length > 0) {
          const carriesProduct = loc.products?.some(p => selectedProducts.includes(p.name));
          if (!carriesProduct) return false;
        }

        // 2. Free Text Search Filter (Matches Doctor Name, Address, Product Name, OR Product Brand!)
        const query = searchQuery.toLowerCase().trim();
        if (query) {
          const inName = loc.name.toLowerCase().includes(query);
          const inAddress = loc.address.toLowerCase().includes(query);
          const inTags = loc.tags?.some(t => t.toLowerCase().includes(query));
          const inCustom = loc.custom_fields && Object.values(loc.custom_fields).some(v => String(v).toLowerCase().includes(query));
          const inProducts = loc.products?.some(p => p.name.toLowerCase().includes(query) || (p.brand && p.brand.toLowerCase().includes(query)));
          
          if (!inName && !inAddress && !inTags && !inCustom && !inProducts) {
            return false;
          }
        }

        // 3. Distance Radius Filter
        if (radius !== 'all' && userCoords && loc.distance !== undefined) {
          if (loc.distance > radius) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        if (b.maxProbScore !== a.maxProbScore) {
          return b.maxProbScore - a.maxProbScore;
        }
        if (userCoords) {
          return (a.distance || 0) - (b.distance || 0);
        }
        return a.name.localeCompare(b.name);
      });
  }, [locations, selectedProducts, searchQuery, radius, userCoords, locator?.distance_unit]);

  const visibleLocations = processedLocations.slice(0, visibleLimit);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', backgroundColor: '#FAF8F5' }}>
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
        backgroundColor: '#FAF8F5',
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

  const dynamicStyles = {
    '--accent-color': locator.accent_color,
    '--accent-color-rgb': hexToRgb(locator.accent_color)
  } as React.CSSProperties;

  return (
    <div className="locator-layout" style={dynamicStyles}>
      
      {/* Sidebar Panel */}
      <div className="locator-sidebar">
        
        {/* Sidebar Header & Search Box */}
        <div className="locator-search-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <img src={logoImg} alt="PlazaDerma Logo" style={{ height: '54px', maxWidth: '220px', objectFit: 'contain' }} />
            {isPreview && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', backgroundColor: 'rgba(30, 200, 170, 0.12)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                Vista Previa
              </span>
            )}
          </div>

          {/* Selected Product Pills (Tarjetitas) */}
          {selectedProducts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '10px' }}>
              {selectedProducts.map(pName => (
                <div 
                  key={pName}
                  style={{
                    backgroundColor: 'rgba(30, 200, 170, 0.12)',
                    border: '1px solid rgba(30, 200, 170, 0.3)',
                    color: '#00506E',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '12px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                >
                  <Package size={13} style={{ color: '#1EC8AA' }} />
                  <span>{pName}</span>
                  <button 
                    onClick={() => removeProductFilter(pName)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#00506E', display: 'flex' }}
                    title="Quitar producto"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Autocomplete Input Container */}
          <div style={{ position: 'relative' }} ref={searchWrapperRef}>
            <div className="locator-search-input-wrapper">
              <Search size={18} className="locator-search-icon" />
              <input 
                type="text" 
                placeholder="Escribe producto, marca (ej. SVR) o médico..."
                value={searchQuery}
                onFocus={() => setIsDropdownOpen(true)}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setIsDropdownOpen(true);
                }}
                className="locator-search-input"
              />
            </div>

            {/* Suggestions Dropdown (Brands & Products) */}
            {isDropdownOpen && (brandSuggestions.length > 0 || productSuggestions.length > 0) && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                left: 0,
                right: 0,
                backgroundColor: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 'var(--radius-md)',
                boxShadow: '0 10px 25px -5px rgba(0,0,0,0.1)',
                zIndex: 1000,
                maxHeight: '300px',
                overflowY: 'auto'
              }}>
                {/* Brand Suggestions Header */}
                {brandSuggestions.length > 0 && (
                  <div>
                    <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 700, color: '#00506E', textTransform: 'uppercase', backgroundColor: '#FAF8F5', borderBottom: '1px solid #f1f5f9' }}>
                      🏷️ Marcas coincidentes
                    </div>
                    {brandSuggestions.map(bName => (
                      <div
                        key={bName}
                        onClick={() => selectBrandFilter(bName)}
                        style={{
                          padding: '10px 14px',
                          fontSize: '13px',
                          color: '#00506E',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          borderBottom: '1px solid #f8fafc',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(30, 200, 170, 0.08)'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <Tag size={15} style={{ color: '#1EC8AA' }} />
                        <span>Marca: {bName}</span>
                        <span style={{ fontSize: '10px', backgroundColor: '#1EC8AA', color: '#fff', padding: '1px 6px', borderRadius: '10px', marginLeft: 'auto' }}>
                          Ver productos de {bName}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Product Suggestions Header */}
                {productSuggestions.length > 0 && (
                  <div>
                    <div style={{ padding: '6px 12px', fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', backgroundColor: '#FAF8F5', borderBottom: '1px solid #f1f5f9' }}>
                      📦 Productos sugeridos
                    </div>
                    {productSuggestions.map(p => (
                      <div
                        key={p.name}
                        onClick={() => addProductFilter(p.name)}
                        style={{
                          padding: '10px 14px',
                          fontSize: '13px',
                          color: '#1e293b',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '8px',
                          transition: 'background 0.15s ease'
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#f1f5f9'}
                        onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <Package size={15} style={{ color: '#1EC8AA' }} />
                          <span style={{ fontWeight: 500 }}>{p.name}</span>
                        </div>
                        {p.brand && (
                          <span style={{ fontSize: '10px', fontWeight: 700, color: '#00506E', backgroundColor: '#F4F0E8', padding: '1px 6px', borderRadius: '4px' }}>
                            {p.brand}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Filters Row */}
          <div className="locator-filters-row" style={{ marginTop: '10px' }}>
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
          <div className="locator-results-info" style={{ marginTop: '8px' }}>
            {processedLocations.length === 0 ? 'No se encontraron médicos' : (
              `${processedLocations.length} ${processedLocations.length === 1 ? 'médico encontrado' : 'médicos encontrados'}`
            )}
          </div>
        </div>

        {/* Results Card List */}
        <div className="locator-list" ref={cardsContainerRef}>
          {visibleLocations.map(loc => {
            const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${loc.lat},${loc.lng}`;
            const isActiveCard = selectedLocationId === loc.id;
            const isExpanded = !!expandedProducts[loc.id];
            const productCount = loc.products?.length || 0;
            
            // Check if any product filter or search text is active
            const queryClean = searchQuery.trim().toLowerCase();
            const hasActiveProductSearch = selectedProducts.length > 0 || queryClean.length > 0;
            
            // Filter specific matching products for active search preview (by name OR by brand!)
            const matchingProducts = (loc.products || []).filter(p => {
              if (selectedProducts.length > 0 && selectedProducts.includes(p.name)) {
                return true;
              }
              if (queryClean.length > 0) {
                if (p.name.toLowerCase().includes(queryClean)) return true;
                if (p.brand && p.brand.toLowerCase().includes(queryClean)) return true;
              }
              return false;
            }).sort((a, b) => getProbabilityInfo(b.last_date).score - getProbabilityInfo(a.last_date).score);

            // Sort all products by probability for full expanded list
            const sortedAllProducts = loc.products ? [...loc.products].sort((a, b) => {
              return getProbabilityInfo(b.last_date).score - getProbabilityInfo(a.last_date).score;
            }) : [];

            return (
              <div 
                key={loc.id} 
                className={`locator-card ${isActiveCard ? 'active' : ''}`}
                ref={el => { cardRefs.current[loc.id] = el; }}
                onClick={() => setSelectedLocationId(loc.id)}
                style={{ gridTemplateColumns: '60px 1fr' }}
              >
                {/* Photo or Pin */}
                {loc.image_url ? (
                  <img src={loc.image_url} alt={loc.name} className="locator-card-img" style={{ width: '60px', height: '60px' }} />
                ) : (
                  <div className="locator-card-placeholder-img" style={{ width: '60px', height: '60px' }}>
                    <MapPin size={22} />
                  </div>
                )}

                {/* Card Content */}
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

                    {/* Custom Fields */}
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

                    {/* Target Product Preview & Collapsible Catalog */}
                    {productCount > 0 && (
                      <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                        
                        {/* 1. Show ONLY the specific searched product(s) or brand matching products in preview when collapsed */}
                        {hasActiveProductSearch && matchingProducts.length > 0 && !isExpanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '8px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <Sparkles size={12} />
                              {queryClean ? `Productos coincidentes con "${searchQuery}":` : 'Producto seleccionado:'}
                            </div>
                            {matchingProducts.map((p, mIdx) => {
                              const prob = getProbabilityInfo(p.last_date);
                              return (
                                <div key={mIdx} style={{
                                  backgroundColor: '#f0f9ff',
                                  border: '1px solid #bae6fd',
                                  padding: '6px 10px',
                                  borderRadius: 'var(--radius-md)',
                                  fontSize: '12px'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                    <span style={{ fontWeight: 700, color: '#0369a1' }}>
                                      {p.brand && <span style={{ backgroundColor: '#00506E', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', marginRight: '6px' }}>{p.brand}</span>}
                                      {p.name}
                                    </span>
                                    <span style={{ backgroundColor: '#0284c7', color: '#fff', padding: '1px 6px', borderRadius: 'var(--radius-full)', fontWeight: 700, fontSize: '10px' }}>
                                      x{p.qty}
                                    </span>
                                  </div>
                                  <span style={{
                                    backgroundColor: prob.bgColor,
                                    color: prob.textColor,
                                    border: `1px solid ${prob.borderColor}`,
                                    padding: '2px 8px',
                                    borderRadius: 'var(--radius-full)',
                                    fontWeight: 700,
                                    fontSize: '10px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}>
                                    <Sparkles size={10} />
                                    {prob.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Expand / Collapse Button */}
                        <button
                          type="button"
                          onClick={(e) => toggleProductExpand(loc.id, e)}
                          style={{
                            background: 'rgba(30, 200, 170, 0.08)',
                            border: '1px solid rgba(30, 200, 170, 0.25)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '4px 10px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: '#00506E',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            width: '100%',
                            cursor: 'pointer'
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Package size={14} style={{ color: '#1EC8AA' }} />
                            {isExpanded ? 'Ocultar catálogo completo' : `Ver los ${productCount} productos de este médico`}
                          </span>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {/* Full Catalog Display when Expanded */}
                        {isExpanded && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '8px', maxHeight: '200px', overflowY: 'auto' }}>
                            {sortedAllProducts.map((p, pIdx) => {
                              const prob = getProbabilityInfo(p.last_date);

                              return (
                                <div key={pIdx} style={{
                                  backgroundColor: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                  padding: '6px 10px',
                                  borderRadius: 'var(--radius-md)',
                                  fontSize: '12px',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px'
                                }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ fontWeight: 600, color: '#1e293b' }}>
                                      {p.brand && <span style={{ backgroundColor: '#00506E', color: '#fff', padding: '1px 5px', borderRadius: '3px', fontSize: '9px', marginRight: '6px' }}>{p.brand}</span>}
                                      {p.name}
                                    </span>
                                    <span style={{
                                      backgroundColor: '#1EC8AA',
                                      color: '#fff',
                                      padding: '1px 6px',
                                      borderRadius: 'var(--radius-full)',
                                      fontWeight: 700,
                                      fontSize: '10px'
                                    }}>
                                      x{p.qty}
                                    </span>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <span style={{
                                      backgroundColor: prob.bgColor,
                                      color: prob.textColor,
                                      border: `1px solid ${prob.borderColor}`,
                                      padding: '2px 8px',
                                      borderRadius: 'var(--radius-full)',
                                      fontWeight: 700,
                                      fontSize: '10px',
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px'
                                    }}>
                                      <Sparkles size={10} />
                                      {prob.label}
                                    </span>

                                    {p.last_date && (
                                      <span style={{ fontSize: '10px', color: '#64748b' }}>
                                        Última compra: {p.last_date.split(' ')[0]}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
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

          {/* Show More Button for DOM Pagination */}
          {processedLocations.length > visibleLimit && (
            <button
              onClick={() => setVisibleLimit(prev => prev + 30)}
              className="btn btn-secondary"
              style={{ width: '100%', margin: '16px 0', padding: '10px', fontSize: '13px' }}
            >
              Cargar más médicos ({processedLocations.length - visibleLimit} restantes)
            </button>
          )}
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
