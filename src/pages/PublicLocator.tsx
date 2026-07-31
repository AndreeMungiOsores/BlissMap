import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LocatorMap } from '../components/LocatorMap';
import localDoctorsData from '../data/doctors_data.json';
import logoImg from '../assets/logo.png';
import { 
  Search, 
  MapPin, 
  Navigation,
  AlertCircle,
  Package,
  X,
  Sparkles,
  Tag,
  ChevronUp,
  ChevronDown
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
    : '30, 200, 170';
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
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [radius, setRadius] = useState<number | 'all'>('all');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geolocating, setGeolocating] = useState(false);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [visibleLimit, setVisibleLimit] = useState(30);

  // Mobile Bottom Sheet State ('collapsed' | 'expanded')
  const [mobileSheetState, setMobileSheetState] = useState<'collapsed' | 'expanded'>('collapsed');

  // Touch Gesture Handling for Mobile Swipe (Deslizar con el dedo hacia arriba / abajo)
  const touchStartYRef = useRef<number | null>(null);
  const touchCurrentYRef = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
      touchCurrentYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current !== null && e.touches && e.touches.length === 1) {
      touchCurrentYRef.current = e.touches[0].clientY;
    }
  };

  const handleTouchEnd = () => {
    if (touchStartYRef.current !== null && touchCurrentYRef.current !== null) {
      const deltaY = touchCurrentYRef.current - touchStartYRef.current;
      // If dragged UP by more than 20px -> EXPAND
      if (deltaY < -20) {
        setMobileSheetState('expanded');
      } 
      // If dragged DOWN by more than 20px -> COLLAPSE
      else if (deltaY > 20) {
        setMobileSheetState('collapsed');
      }
    }
    touchStartYRef.current = null;
    touchCurrentYRef.current = null;
  };

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
            search_placeholder: 'Escribe producto, marca o médico...',
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
          search_placeholder: 'Escribe producto, marca o médico...',
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

  // Search Query Active State (Requires at least 4 characters for text search)
  const minQueryLen = 4;
  const queryClean = searchQuery.trim().toLowerCase();
  const isQueryActive = queryClean.length >= minQueryLen;
  const hasActiveProductSearch = selectedProducts.length > 0 || isQueryActive;

  // Brand suggestions matching query (only when >= 4 chars typed)
  const brandSuggestions = useMemo(() => {
    if (!isQueryActive) return [];
    return allUniqueBrands.filter(b => b.toLowerCase().includes(queryClean));
  }, [queryClean, isQueryActive, allUniqueBrands]);

  // Product suggestions matching query or brand (only when >= 4 chars typed)
  const productSuggestions = useMemo(() => {
    if (!isQueryActive) return [];
    return allUniqueProducts.filter(
      p => (p.name.toLowerCase().includes(queryClean) || (p.brand && p.brand.toLowerCase().includes(queryClean))) && !selectedProducts.includes(p.name)
    ).slice(0, 8);
  }, [queryClean, isQueryActive, allUniqueProducts, selectedProducts]);

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
    // Expand mobile sheet when selecting a product to let user see results
    setMobileSheetState('expanded');
  };

  const removeProductFilter = (productName: string) => {
    setSelectedProducts(prev => prev.filter(p => p !== productName));
  };

  const selectBrandFilter = (brandName: string) => {
    setSearchQuery(brandName);
    setIsDropdownOpen(false);
    // Expand mobile sheet when selecting a brand
    setMobileSheetState('expanded');
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
        let latestMatchingDate = '';

        if (loc.products && loc.products.length > 0) {
          // If a specific product or brand search filter is active, calculate probability score ONLY on matching products!
          const matchingProducts = hasActiveProductSearch
            ? loc.products.filter(p => {
                if (selectedProducts.length > 0 && selectedProducts.includes(p.name)) return true;
                if (isQueryActive) {
                  if (p.name.toLowerCase().includes(queryClean)) return true;
                  if (p.brand && p.brand.toLowerCase().includes(queryClean)) return true;
                }
                return false;
              })
            : loc.products;

          const targetProducts = matchingProducts.length > 0 ? matchingProducts : loc.products;

          targetProducts.forEach(p => {
            const prob = getProbabilityInfo(p.last_date);
            if (prob.score > maxProbScore) {
              maxProbScore = prob.score;
            }
            if (p.last_date && p.last_date > latestMatchingDate) {
              latestMatchingDate = p.last_date;
            }
          });
        }

        if (userCoords) {
          const dist = calculateDistance(userCoords.lat, userCoords.lng, loc.lat, loc.lng, unit as 'km' | 'mi');
          return { ...loc, distance: dist, maxProbScore, latestMatchingDate };
        }
        return { ...loc, maxProbScore, latestMatchingDate };
      })
      .filter(loc => {
        // 1. Multi-product tags filter
        if (selectedProducts.length > 0) {
          const carriesProduct = loc.products?.some(p => selectedProducts.includes(p.name));
          if (!carriesProduct) return false;
        }

        // 2. Free Text Search Filter (Only active when at least 4 characters typed)
        if (isQueryActive) {
          const inName = loc.name.toLowerCase().includes(queryClean);
          const inAddress = loc.address.toLowerCase().includes(queryClean);
          const inTags = loc.tags?.some(t => t.toLowerCase().includes(queryClean));
          const inCustom = loc.custom_fields && Object.values(loc.custom_fields).some(v => String(v).toLowerCase().includes(queryClean));
          const inProducts = loc.products?.some(p => p.name.toLowerCase().includes(queryClean) || (p.brand && p.brand.toLowerCase().includes(queryClean)));
          
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
        // 1. Sort strictly by matching product probability score (Alta = 3, Media = 2, Baja = 1)
        if (b.maxProbScore !== a.maxProbScore) {
          return b.maxProbScore - a.maxProbScore;
        }
        // 2. Secondary sort: Most recent purchase date first
        if (b.latestMatchingDate !== a.latestMatchingDate) {
          return b.latestMatchingDate.localeCompare(a.latestMatchingDate);
        }
        // 3. Distance radius if user coordinates active
        if (userCoords) {
          return (a.distance || 0) - (b.distance || 0);
        }
        // 4. Alphabetical doctor name
        return a.name.localeCompare(b.name);
      });
  }, [locations, selectedProducts, queryClean, isQueryActive, hasActiveProductSearch, radius, userCoords, locator?.distance_unit]);

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
      
      {/* Sidebar Panel / Mobile Bottom Sheet */}
      <div className={`locator-sidebar sheet-${mobileSheetState} ${!hasActiveProductSearch ? 'mobile-hidden-sheet' : ''}`}>
        
        {/* Mobile Drag Handle Bar (Touch Swipe Supported Google Maps Pattern) */}
        <div 
          className="bottom-sheet-handle-bar"
          onClick={() => setMobileSheetState(prev => prev === 'collapsed' ? 'expanded' : 'collapsed')}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          role="button"
          tabIndex={0}
          aria-expanded={mobileSheetState === 'expanded'}
          aria-label={mobileSheetState === 'collapsed' ? 'Deslizar hacia arriba para ver la lista de médicos' : 'Deslizar hacia abajo para ver el mapa'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setMobileSheetState(prev => prev === 'collapsed' ? 'expanded' : 'collapsed');
            }
          }}
        >
          <div className="bottom-sheet-pill" />
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: 700,
            color: '#00506E',
            marginTop: '4px',
            backgroundColor: 'rgba(30, 200, 170, 0.12)',
            border: '1px solid rgba(30, 200, 170, 0.35)',
            padding: '6px 18px',
            borderRadius: 'var(--radius-full)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)'
          }}>
            {mobileSheetState === 'collapsed' ? (
              <>
                <ChevronUp size={18} style={{ color: '#1EC8AA' }} />
                <span>Desliza para ver médicos</span>
              </>
            ) : (
              <>
                <ChevronDown size={18} style={{ color: '#1EC8AA' }} />
                <span>Desliza para ver el mapa</span>
              </>
            )}
          </div>
        </div>

        {/* Sidebar Header & Search Box */}
        <div className="locator-search-container">
          {/* Logo Row (Hidden on Mobile) */}
          <div className="locator-logo-row mobile-hide" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <img src={logoImg} alt="PlazaDerma Logo" style={{ height: '48px', maxWidth: '200px', objectFit: 'contain' }} />
            {isPreview && (
              <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--color-primary)', backgroundColor: 'rgba(30, 200, 170, 0.12)', padding: '2px 8px', borderRadius: 'var(--radius-full)' }}>
                Vista Previa
              </span>
            )}
          </div>

          {/* Selected Product Pills (Tarjetitas) */}
          {selectedProducts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
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
                placeholder="Escribe producto, marca o médico..."
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
            {isDropdownOpen && isQueryActive && (brandSuggestions.length > 0 || productSuggestions.length > 0) && (
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

          {/* Filters Row (Hidden on Mobile) */}
          <div className="locator-filters-row mobile-hide" style={{ marginTop: '8px' }}>
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

          {/* Result Info (Hidden on Mobile) */}
          <div className="locator-results-info mobile-hide" style={{ marginTop: '6px' }}>
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
            
            // Filter specific matching products ONLY when active search is performed
            const matchingProducts = hasActiveProductSearch
              ? (loc.products || []).filter(p => {
                  if (selectedProducts.length > 0 && selectedProducts.includes(p.name)) {
                    return true;
                  }
                  if (isQueryActive) {
                    if (p.name.toLowerCase().includes(queryClean)) return true;
                    if (p.brand && p.brand.toLowerCase().includes(queryClean)) return true;
                  }
                  return false;
                }).sort((a, b) => getProbabilityInfo(b.last_date).score - getProbabilityInfo(a.last_date).score)
              : [];

            // Extract Razón Social from custom_fields
            const razonSocial = loc.custom_fields?.['Razón Social'] || loc.custom_fields?.['Razon Social'] || loc.custom_fields?.['razon_social'];

            return (
              <div 
                key={loc.id} 
                className={`locator-card ${isActiveCard ? 'active' : ''}`}
                ref={el => { cardRefs.current[loc.id] = el; }}
                onClick={() => {
                  setSelectedLocationId(loc.id);
                }}
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

                {/* Card Content: ONLY Doctor Name, Address, and Razón Social */}
                <div className="locator-card-content">
                  <div>
                    {/* 1. Doctor Name */}
                    <h4 className="locator-card-name">{loc.name}</h4>

                    {/* 2. Address */}
                    <p className="locator-card-address">{loc.address}</p>

                    {/* 3. Razón Social (only) */}
                    {razonSocial && (
                      <p style={{ fontSize: '12px', color: '#475569', marginTop: '4px', lineHeight: '1.4' }}>
                        <strong style={{ color: '#00506E', fontWeight: 600 }}>Razón Social:</strong> {razonSocial}
                      </p>
                    )}

                    {/* Distance if geolocated */}
                    {loc.distance !== undefined && (
                      <span className="locator-card-distance" style={{ marginTop: '6px' }}>
                        A {loc.distance.toFixed(1)} {locator.distance_unit} de ti
                      </span>
                    )}

                    {/* Render ONLY the searched/selected product(s) when a product search is active */}
                    {hasActiveProductSearch && matchingProducts.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <Sparkles size={12} />
                          {isQueryActive ? `Producto coincidente:` : 'Producto seleccionado:'}
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
          onSelectLocation={(locId) => {
            setSelectedLocationId(locId);
          }}
          mapStyle={locator.map_style}
          markerType={locator.marker_type}
          markerColor={locator.marker_color}
          markerImageUrl={locator.marker_image_url}
        />
      </div>

    </div>
  );
};
