import React, { useEffect, useState, useRef, useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LocatorMap } from '../components/LocatorMap';
import localDoctorsData from '../data/doctors_data.json';
import { fetchB2BSalesLocations } from '../services/b2bApiService';
import logoImg from '../assets/logo.png';
import { 
  Search, 
  MapPin, 
  Navigation,
  AlertCircle,
  Package,
  X,
  Tag,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  MessageCircle
} from 'lucide-react';

interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
  sku?: string;
  image_url?: string;
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
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
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

        // Load live sales data from ERP API with 1-hour cache and fallback
        const baseFallback = currentLocations.length >= 50 ? currentLocations : (localDoctorsData as LocationItem[]);
        const { locations: apiLocations } = await fetchB2BSalesLocations(baseFallback);

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

        setLocator(currentLocator);
        setLocations(apiLocations);
      } catch (err: any) {
        console.error(err);
        const { locations: apiLocations } = await fetchB2BSalesLocations(localDoctorsData as LocationItem[]);
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
        setLocations(apiLocations);
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

  // An explicit selection is ONLY active when a user clicked a product chip or clicked a brand from suggestions
  const isSelectionActive = selectedProducts.length > 0 || selectedBrand !== null;

  // Search Query Active State (Requires at least 3 characters for text search)
  const minQueryLen = 3;
  const queryClean = searchQuery.trim().toLowerCase();
  const isQueryActive = queryClean.length >= minQueryLen;
  const hasActiveProductSearch = isSelectionActive || isQueryActive;

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
    setSelectedBrand(null);
    setSearchQuery('');
    setIsDropdownOpen(false);
    setMobileSheetState('collapsed');
  };

  const removeProductFilter = (productName: string) => {
    setSelectedProducts(prev => prev.filter(p => p !== productName));
  };

  const selectBrandFilter = (brandName: string) => {
    setSelectedBrand(brandName);
    setSelectedProducts([]);
    setSearchQuery('');
    setIsDropdownOpen(false);
    setMobileSheetState('collapsed');
  };

  const removeBrandFilter = () => {
    setSelectedBrand(null);
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
                if (selectedBrand && p.brand && p.brand.toUpperCase() === selectedBrand.toUpperCase()) return true;
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

        // 2. Selected brand filter
        if (selectedBrand) {
          const carriesBrand = loc.products?.some(p => p.brand && p.brand.toUpperCase() === selectedBrand.toUpperCase());
          if (!carriesBrand) return false;
        }

        // 3. Free Text Search Filter (Only active when at least 4 characters typed and no explicit selection)
        if (isQueryActive && !isSelectionActive) {
          const inName = loc.name.toLowerCase().includes(queryClean);
          const inAddress = loc.address.toLowerCase().includes(queryClean);
          const inTags = loc.tags?.some(t => t.toLowerCase().includes(queryClean));
          const inCustom = loc.custom_fields && Object.values(loc.custom_fields).some(v => String(v).toLowerCase().includes(queryClean));
          const inProducts = loc.products?.some(p => p.name.toLowerCase().includes(queryClean) || (p.brand && p.brand.toLowerCase().includes(queryClean)));
          
          if (!inName && !inAddress && !inTags && !inCustom && !inProducts) {
            return false;
          }
        }

        // 4. Distance Radius Filter
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
        if (b.latestMatchingDate !== a.latestMatchingDate) {
          return b.latestMatchingDate.localeCompare(a.latestMatchingDate);
        }
        if (userCoords) {
          return (a.distance || 0) - (b.distance || 0);
        }
        return a.name.localeCompare(b.name);
      });
  }, [locations, selectedProducts, selectedBrand, queryClean, isQueryActive, isSelectionActive, hasActiveProductSearch, radius, userCoords, locator?.distance_unit]);

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
      <div className={`locator-sidebar sheet-${mobileSheetState} ${!isSelectionActive ? 'mobile-hidden-sheet' : ''}`}>
        
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

        {/* Selected Product/Brand Banner: REMOVED — chip in search bar is sufficient */}

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

          {/* Selected Product/Brand Pills (Tarjetitas) */}
          {isSelectionActive && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '8px' }}>
              {selectedBrand && (
                <div 
                  style={{
                    backgroundColor: 'rgba(0, 80, 110, 0.12)',
                    border: '1px solid rgba(0, 80, 110, 0.3)',
                    color: '#00506E',
                    padding: '4px 10px',
                    borderRadius: 'var(--radius-full)',
                    fontSize: '12px',
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
                  }}
                >
                  <Tag size={13} style={{ color: '#00506E' }} />
                  <span>Marca: {selectedBrand}</span>
                  <button 
                    onClick={removeBrandFilter}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#00506E', display: 'flex' }}
                    title="Quitar marca"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}

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
        {/* Probability legend — shown once when a product/brand is selected */}
        {isSelectionActive && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '6px 16px 8px',
            flexWrap: 'wrap'
          }}>
            <span style={{ fontSize: '10px', fontWeight: 700, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.4px', marginRight: '2px' }}>Stock:</span>
            {[{ color: '#22c55e', label: 'Alta' }, { color: '#f59e0b', label: 'Media' }, { color: '#ef4444', label: 'Baja' }].map(({ color, label }) => (
              <span key={label} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px', color: '#475569', fontWeight: 600 }}>
                <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: color, display: 'inline-block', flexShrink: 0 }} />
                {label}
              </span>
            ))}
          </div>
        )}
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

            // Calculate top probability info
            const topProb = matchingProducts.length > 0 ? getProbabilityInfo(matchingProducts[0].last_date) : null;

            return (
              <div 
                key={loc.id} 
                className={`locator-card ${isActiveCard ? 'active' : ''}`}
                ref={el => { cardRefs.current[loc.id] = el; }}
                onClick={() => {
                  setSelectedLocationId(prev => prev === loc.id ? null : loc.id);
                }}
                style={{ display: 'flex', flexDirection: 'column', gap: '0', padding: '14px 16px', gridTemplateColumns: 'none' }}
              >
                {/* Main Row: Doctor Icon, Doctor Info, Stock Probability & Chevron */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%' }}>
                  
                  {/* Left: Map Pin Icon & Doctor Name + Address */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flexGrow: 1, minWidth: 0 }}>
                    {loc.image_url ? (
                      <img src={loc.image_url} alt={loc.name} style={{ width: '42px', height: '42px', borderRadius: '12px', objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: '42px', height: '42px', borderRadius: '12px', backgroundColor: '#F1F5F9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748B', flexShrink: 0 }}>
                        <MapPin size={20} />
                      </div>
                    )}

                    <div style={{ minWidth: 0, flexGrow: 1 }}>
                      <h4 style={{ fontSize: '13px', fontWeight: 700, color: '#00506E', margin: 0, lineHeight: '1.35', wordBreak: 'break-word', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {loc.name}
                      </h4>
                      <p style={{ fontSize: '11px', color: '#64748B', margin: '2px 0 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {loc.address}
                      </p>
                    </div>
                  </div>

                  {/* Right: Stock Probability Dot & Chevron Arrow */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {topProb && (
                      <span
                        aria-label={`Probabilidad de stock: ${topProb.label}`}
                        title={topProb.label}
                        style={{
                          width: '10px',
                          height: '10px',
                          borderRadius: '50%',
                          backgroundColor: topProb.label === 'Alta probabilidad' ? '#22c55e' : topProb.label === 'Media probabilidad' ? '#f59e0b' : '#ef4444',
                          display: 'inline-block',
                          flexShrink: 0,
                          boxShadow: `0 0 0 2px ${topProb.label === 'Alta probabilidad' ? 'rgba(34,197,94,0.2)' : topProb.label === 'Media probabilidad' ? 'rgba(245,158,11,0.2)' : 'rgba(239,68,68,0.2)'}`
                        }}
                      />
                    )}
                    <ChevronRight size={18} style={{ color: '#94A3B8', transform: isActiveCard ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease' }} />
                  </div>

                </div>

                {/* Expanded View / Desglose on Selection */}
                {isActiveCard && (
                  <div style={{
                    marginTop: '12px',
                    paddingTop: '12px',
                    borderTop: '1px solid #E2E8F0',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px'
                  }}>
                    {razonSocial && (
                      <p style={{ fontSize: '12px', color: '#475569', margin: 0 }}>
                        <strong style={{ color: '#00506E', fontWeight: 600 }}>Razón Social:</strong> {razonSocial}
                      </p>
                    )}

                    {loc.distance !== undefined && (
                      <p style={{ fontSize: '12px', color: '#1EC8AA', fontWeight: 600, margin: 0 }}>
                        📍 A {loc.distance.toFixed(1)} {locator.distance_unit} de ti
                      </p>
                    )}

                    {/* Products List Section with Images (Only shown when a product or brand is selected) */}
                    {(() => {
                      if (!isSelectionActive || !loc.products || loc.products.length === 0) return null;

                      const matchingProducts = loc.products.filter(prod => {
                        if (selectedProducts.length > 0) {
                          return selectedProducts.some(sp => prod.name.toLowerCase().includes(sp.toLowerCase()));
                        }
                        if (selectedBrand) {
                          return prod.brand?.toLowerCase() === selectedBrand.toLowerCase();
                        }
                        return true;
                      });

                      if (matchingProducts.length === 0) return null;

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '4px' }}>
                          <span style={{ fontSize: '11px', fontWeight: 700, color: '#00506E', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                            Producto Seleccionado ({matchingProducts.length})
                          </span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '180px', overflowY: 'auto', paddingRight: '2px' }}>
                            {matchingProducts.map((prod, pIdx) => {
                              const pProb = getProbabilityInfo(prod.last_date);
                              return (
                                <div key={pIdx} style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '10px',
                                  backgroundColor: '#F8FAFC',
                                  padding: '6px 10px',
                                  borderRadius: '8px',
                                  border: '1px solid #E2E8F0'
                                }}>
                                  {/* Product Thumbnail Image */}
                                  {prod.image_url ? (
                                    <img 
                                      src={prod.image_url} 
                                      alt={prod.name}
                                      style={{
                                        width: '38px',
                                        height: '38px',
                                        objectFit: 'contain',
                                        backgroundColor: '#FFFFFF',
                                        borderRadius: '6px',
                                        border: '1px solid #E2E8F0',
                                        padding: '2px',
                                        flexShrink: 0
                                      }}
                                      onError={(e) => {
                                        (e.target as HTMLElement).style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    <div style={{
                                      width: '38px',
                                      height: '38px',
                                      borderRadius: '6px',
                                      backgroundColor: '#E6FFFA',
                                      border: '1px solid #B2F5EA',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: '#1EC8AA',
                                      flexShrink: 0
                                    }}>
                                      <Package size={18} />
                                    </div>
                                  )}

                                  {/* Product Info */}
                                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '12px', fontWeight: 600, color: '#00506E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                      {prod.name}
                                    </div>
                                    {prod.brand && (
                                      <div style={{ fontSize: '10px', color: '#64748B', fontWeight: 500 }}>
                                        Marca: <span style={{ fontWeight: 700, color: '#1EC8AA' }}>{prod.brand}</span>
                                      </div>
                                    )}
                                  </div>

                                  {/* Probability Badge */}
                                  <span style={{
                                    backgroundColor: pProb.bgColor,
                                    color: pProb.textColor,
                                    border: `1px solid ${pProb.borderColor}`,
                                    padding: '2px 6px',
                                    borderRadius: 'var(--radius-full)',
                                    fontWeight: 700,
                                    fontSize: '10px',
                                    whiteSpace: 'nowrap',
                                    flexShrink: 0
                                  }}>
                                    {pProb.label}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Actions Row: Cómo llegar + WhatsApp */}
                    {(() => {
                      const cleanDigits = loc.phone ? loc.phone.replace(/\D/g, '') : '';
                      const cleanPhone = (cleanDigits.length === 9 && cleanDigits.startsWith('9')) 
                        ? cleanDigits 
                        : (cleanDigits.length === 11 && cleanDigits.startsWith('519')) 
                          ? cleanDigits.substring(2) 
                          : (cleanDigits.length >= 7 ? cleanDigits : null);

                      // Build pre-filled WhatsApp message with selected products/brands
                      let whatsappUrl: string | null = null;
                      if (cleanPhone) {
                        let waMessage = '';
                        if (isSelectionActive && loc.products && loc.products.length > 0) {
                          const matchingProds = loc.products.filter(prod => {
                            if (selectedProducts.length > 0) return selectedProducts.some(sp => prod.name.toLowerCase().includes(sp.toLowerCase()));
                            if (selectedBrand) return prod.brand?.toLowerCase() === selectedBrand.toLowerCase();
                            return false;
                          });

                          if (matchingProds.length === 1) {
                            const p = matchingProds[0];
                            const brandStr = p.brand ? ` de ${p.brand}` : '';
                            waMessage = `¡Hola! Encontré su centro en Plaza Derma, ¿me podrían confirmar que tienen "${p.name}"${brandStr} para acercarme a comprarlo?`;
                          } else if (matchingProds.length > 1) {
                            const uniqueBrands = [...new Set(matchingProds.map(p => p.brand).filter(Boolean))];
                            const sameBrand = uniqueBrands.length === 1;

                            if (sameBrand) {
                              // All products from same brand → list all products then "de MARCA"
                              const names = matchingProds.map(p => `"${p.name}"`).join(', ');
                              waMessage = `¡Hola! Encontré su centro en Plaza Derma, ¿me podrían confirmar que tienen los productos ${names} de ${uniqueBrands[0]} para acercarme a comprarlo?`;
                            } else {
                              // Products from different brands → inline each with its brand
                              const productList = matchingProds.map(p => p.brand ? `"${p.name}" de ${p.brand}` : `"${p.name}"`).join(', ');
                              waMessage = `¡Hola! Encontré su centro en Plaza Derma, ¿me podrían confirmar que tienen los productos ${productList} para acercarme a comprarlo?`;
                            }
                          }
                        }

                        const encodedMsg = waMessage ? `?text=${encodeURIComponent(waMessage)}` : '';
                        whatsappUrl = `https://wa.me/51${cleanPhone}${encodedMsg}`;
                      }

                      return (
                        <div style={{ display: 'flex', gap: '8px', marginTop: '6px', width: '100%' }}>
                          <a 
                            href={googleMapsUrl} 
                            target="_blank" 
                            rel="noreferrer" 
                            className="locator-directions-btn" 
                            onClick={(e) => e.stopPropagation()}
                            style={{ marginTop: 0, padding: '9px 12px', fontSize: '13px', fontWeight: 700, whiteSpace: 'nowrap' }}
                          >
                            <Navigation size={14} />
                            Cómo llegar
                          </a>

                          {whatsappUrl && (
                            <a 
                              href={whatsappUrl} 
                              target="_blank" 
                              rel="noreferrer" 
                              className="locator-whatsapp-btn"
                              onClick={(e) => e.stopPropagation()}
                              style={{ padding: '9px 12px', fontSize: '13px' }}
                              title={`Enviar WhatsApp a ${loc.name}`}
                            >
                              <MessageCircle size={15} />
                              WhatsApp
                            </a>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
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
          locations={isSelectionActive ? processedLocations : []}
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
