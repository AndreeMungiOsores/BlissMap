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
  MessageCircle,
  ArrowLeft,
  Building2
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

export type MobileSheetState = 'collapsed' | 'half' | 'full';
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

  // Navigation Selector Modal State
  const [navTarget, setNavTarget] = useState<{ lat: number; lng: number; name: string } | null>(null);

  // 3-Stage Mobile Bottom Sheet State ('collapsed' | 'half' | 'full')
  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>('collapsed');
  const [dragHeight, setDragHeight] = useState<number | null>(null);

  // Touch & Drag Handling for Mobile Sheet (Google Maps 3-stage 1-to-1 finger tracking)
  const sidebarRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef<number | null>(null);
  const initialHeightRef = useRef<number>(140);
  const isSwipingRef = useRef<boolean>(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches && e.touches.length === 1) {
      touchStartYRef.current = e.touches[0].clientY;
      isSwipingRef.current = false;
      if (sidebarRef.current) {
        initialHeightRef.current = sidebarRef.current.getBoundingClientRect().height;
      }
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartYRef.current !== null && e.touches && e.touches.length === 1) {
      const deltaY = e.touches[0].clientY - touchStartYRef.current;
      if (Math.abs(deltaY) > 5) {
        isSwipingRef.current = true;
      }

      // Calculate 1-to-1 height following user finger exactly
      const calculatedHeight = initialHeightRef.current - deltaY;

      // Min/Max height bounds with safe top margin for mobile status bar
      const topSafeOffset = Math.max(64, Math.round(window.innerHeight * 0.08));
      const minH = 110;
      const maxH = window.innerHeight - topSafeOffset;
      const clampedHeight = Math.max(minH, Math.min(maxH, calculatedHeight));

      setDragHeight(clampedHeight);
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartYRef.current !== null) {
      const endY = e.changedTouches && e.changedTouches.length > 0 ? e.changedTouches[0].clientY : touchStartYRef.current;
      const deltaY = endY - touchStartYRef.current;

      const topSafeOffset = Math.max(64, Math.round(window.innerHeight * 0.08));
      const collapsedH = 140;
      const halfH = Math.min(window.innerHeight * 0.45, window.innerHeight - 220);
      const fullH = window.innerHeight - topSafeOffset;

      const midPointLow = (collapsedH + halfH) / 2;
      const midPointHigh = (halfH + fullH) / 2;

      const currentH = dragHeight !== null ? dragHeight : (initialHeightRef.current - deltaY);

      // Fast swipe UP
      if (deltaY < -40) {
        isSwipingRef.current = true;
        if (initialHeightRef.current < halfH && deltaY < -150) {
          setMobileSheetState('full');
        } else if (initialHeightRef.current >= halfH) {
          setMobileSheetState('full');
        } else {
          setMobileSheetState('half');
        }
      }
      // Fast swipe DOWN
      else if (deltaY > 40) {
        isSwipingRef.current = true;
        if (initialHeightRef.current > halfH && deltaY > 150) {
          setMobileSheetState('collapsed');
        } else if (initialHeightRef.current > halfH) {
          setMobileSheetState('half');
        } else {
          setMobileSheetState('collapsed');
        }
      }
      // Position-based snapping
      else {
        if (currentH < midPointLow) {
          setMobileSheetState('collapsed');
        } else if (currentH > midPointHigh) {
          setMobileSheetState('full');
        } else {
          setMobileSheetState('half');
        }
      }
    }

    touchStartYRef.current = null;
    setDragHeight(null);
  };

  const handleClickHandleBar = () => {
    if (isSwipingRef.current) {
      isSwipingRef.current = false;
      return;
    }
    setMobileSheetState(prev => {
      if (prev === 'collapsed') return 'half';
      if (prev === 'half') return 'full';
      return 'collapsed';
    });
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

  const isDragFull = dragHeight !== null && dragHeight > (window.innerHeight * 0.55);

  return (
    <div className="locator-layout" style={dynamicStyles}>
      
      {/* Sidebar Panel / Mobile Bottom Sheet */}
      <div 
        ref={sidebarRef}
        className={`locator-sidebar sheet-${mobileSheetState} ${isDragFull ? 'is-drag-full' : ''} ${!isSelectionActive ? 'mobile-hidden-sheet' : ''}`}
        style={dragHeight !== null ? { 
          height: `${dragHeight}px`, 
          transition: 'none',
          zIndex: isDragFull ? 1200 : undefined 
        } : undefined}
      >
        
        {/* Mobile Drag Handle Bar (Touch Swipe Supported Google Maps Pattern) */}
        <div 
          className="bottom-sheet-handle-bar"
          onClick={handleClickHandleBar}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          role="button"
          tabIndex={0}
          aria-expanded={mobileSheetState !== 'collapsed'}
          aria-label={mobileSheetState === 'collapsed' ? 'Deslizar hacia arriba para ver los médicos' : mobileSheetState === 'half' ? 'Deslizar hacia arriba para maximizar' : 'Deslizar hacia abajo para ver el mapa'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              handleClickHandleBar();
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

        {/* Results View: Conditional Dedicated Detail View vs General Cards List */}
        {(() => {
          const selectedLocation = selectedLocationId 
            ? (processedLocations.find(l => l.id === selectedLocationId) || locations.find(l => l.id === selectedLocationId))
            : null;

          // -------------------------------------------------------------
          // 1. DEDICATED SINGLE-LOCATION DETAIL VIEW (When a comercio is selected)
          // -------------------------------------------------------------
          if (selectedLocation) {
            return (
              <div className="location-detail-view" style={{ padding: '8px 16px 24px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                
                {/* Back Button Bar */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                  <button
                    type="button"
                    onClick={() => setSelectedLocationId(null)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 14px',
                      borderRadius: 'var(--radius-full)',
                      backgroundColor: 'rgba(0, 80, 110, 0.08)',
                      border: '1.5px solid rgba(0, 80, 110, 0.25)',
                      color: '#00506E',
                      fontSize: '13px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      boxShadow: '0 2px 6px rgba(0,0,0,0.04)',
                      transition: 'all 0.15s ease'
                    }}
                    aria-label="Volver a la lista general de médicos"
                  >
                    <ArrowLeft size={17} style={{ color: '#00506E' }} />
                    <span>Volver a la lista</span>
                  </button>

                  {selectedLocation.distance !== undefined && (
                    <span style={{ fontSize: '11px', color: '#1EC8AA', fontWeight: 700, backgroundColor: 'rgba(30, 200, 170, 0.12)', border: '1px solid rgba(30, 200, 170, 0.3)', padding: '4px 10px', borderRadius: 'var(--radius-full)' }}>
                      📍 A {selectedLocation.distance.toFixed(1)} {locator.distance_unit}
                    </span>
                  )}
                </div>

                {/* Hero Header Card: Large Photo / Avatar & Commerce Details */}
                <div style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '20px',
                  padding: '16px',
                  border: '1.5px solid rgba(30, 200, 170, 0.35)',
                  boxShadow: '0 4px 20px rgba(0, 80, 110, 0.08)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '14px'
                }}>
                  {/* Large Photo / Avatar */}
                  {selectedLocation.image_url ? (
                    <img 
                      src={selectedLocation.image_url} 
                      alt={selectedLocation.name} 
                      style={{ width: '64px', height: '64px', borderRadius: '16px', objectFit: 'cover', flexShrink: 0, border: '1.5px solid #E2E8F0', boxShadow: '0 3px 10px rgba(0,0,0,0.08)' }} 
                    />
                  ) : (
                    <div style={{ width: '64px', height: '64px', borderRadius: '16px', backgroundColor: 'rgba(30, 200, 170, 0.12)', border: '1.5px solid rgba(30, 200, 170, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#00506E', flexShrink: 0, boxShadow: '0 3px 10px rgba(0,0,0,0.04)' }}>
                      <Building2 size={32} />
                    </div>
                  )}

                  <div style={{ flexGrow: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#00506E', margin: '0 0 4px 0', lineHeight: '1.3' }}>
                      {selectedLocation.name}
                    </h3>
                    <p style={{ fontSize: '12px', color: '#475569', margin: 0, lineHeight: '1.4', fontWeight: 500 }}>
                      {selectedLocation.address}
                    </p>

                    {selectedLocation.custom_fields?.['Médico'] && selectedLocation.custom_fields['Médico'] !== selectedLocation.name && (
                      <div style={{ fontSize: '11px', color: '#64748B', marginTop: '6px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span>👨‍⚕️ {selectedLocation.custom_fields['Médico']}</span>
                        {selectedLocation.custom_fields['Colegiatura'] && (
                          <span style={{ fontSize: '10px', backgroundColor: '#F1F5F9', padding: '1px 6px', borderRadius: '4px', color: '#475569' }}>
                            {selectedLocation.custom_fields['Colegiatura']}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Products List Section with Enlarged Photos */}
                {(() => {
                  const allProds = selectedLocation.products || [];
                  if (allProds.length === 0) return null;

                  const matchingProds = allProds.filter(prod => {
                    if (selectedProducts.length > 0) {
                      return selectedProducts.some(sp => prod.name.toLowerCase().includes(sp.toLowerCase()));
                    }
                    if (selectedBrand) {
                      return prod.brand?.toLowerCase() === selectedBrand.toLowerCase();
                    }
                    return true;
                  });

                  const displayProds = matchingProds.length > 0 ? matchingProds : allProds;

                  return (
                    <div style={{
                      backgroundColor: '#FFFFFF',
                      borderRadius: '20px',
                      padding: '16px',
                      border: '1px solid #E2E8F0',
                      boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '12px'
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#00506E', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                          PRODUCTO SELECCIONADO ({displayProds.length})
                        </span>
                      </div>

                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: displayProds.length > 1 ? 'repeat(auto-fit, minmax(140px, 1fr))' : '1fr', 
                        gap: '12px', 
                        maxHeight: '340px', 
                        overflowY: 'auto', 
                        paddingRight: '2px' 
                      }}>
                        {displayProds.map((prod, pIdx) => {
                          const pProb = getProbabilityInfo(prod.last_date);
                          return (
                            <div key={pIdx} style={{
                              display: 'flex',
                              flexDirection: 'column',
                              alignItems: 'center',
                              textAlign: 'center',
                              gap: '10px',
                              backgroundColor: '#F8FAFC',
                              padding: '14px 12px',
                              borderRadius: '16px',
                              border: '1px solid #E2E8F0',
                              boxShadow: '0 2px 8px rgba(0,0,0,0.02)'
                            }}>
                              {/* 1. Large Product Photo (Top First) */}
                              {prod.image_url ? (
                                <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                                  <img 
                                    src={prod.image_url} 
                                    alt={prod.name}
                                    style={{
                                      width: '100%',
                                      maxHeight: '110px',
                                      height: '110px',
                                      objectFit: 'contain',
                                      backgroundColor: '#FFFFFF',
                                      borderRadius: '12px',
                                      border: '1.5px solid #E2E8F0',
                                      padding: '6px',
                                      boxShadow: '0 3px 10px rgba(0,0,0,0.05)'
                                    }}
                                    onError={(e) => {
                                      (e.target as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                </div>
                              ) : (
                                <div style={{
                                  width: '100%',
                                  height: '95px',
                                  borderRadius: '12px',
                                  backgroundColor: '#E6FFFA',
                                  border: '1.5px solid #B2F5EA',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  color: '#1EC8AA'
                                }}>
                                  <Package size={32} />
                                </div>
                              )}

                              {/* 2. Product Name & Brand (Below Image) */}
                              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 800, color: '#00506E', lineHeight: '1.35', wordBreak: 'break-word' }}>
                                  {prod.name}
                                </div>
                                {prod.brand && (
                                  <div style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>
                                    Marca: <span style={{ fontWeight: 700, color: '#1EC8AA' }}>{prod.brand}</span>
                                  </div>
                                )}
                              </div>

                              {/* 3. Stock Probability Badge (Bottom) */}
                              <span style={{
                                backgroundColor: pProb.bgColor,
                                color: pProb.textColor,
                                border: `1px solid ${pProb.borderColor}`,
                                padding: '4px 12px',
                                borderRadius: 'var(--radius-full)',
                                fontWeight: 700,
                                fontSize: '10px',
                                whiteSpace: 'nowrap',
                                marginTop: 'auto'
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

                {/* Primary Action Buttons: Cómo llegar + WhatsApp */}
                {(() => {
                  const cleanDigits = selectedLocation.phone ? selectedLocation.phone.replace(/\D/g, '') : '';
                  const cleanPhone = (cleanDigits.length === 9 && cleanDigits.startsWith('9')) 
                    ? cleanDigits 
                    : (cleanDigits.length === 11 && cleanDigits.startsWith('519')) 
                      ? cleanDigits.substring(2) 
                      : (cleanDigits.length >= 7 ? cleanDigits : null);

                  let whatsappUrl: string | null = null;
                  if (cleanPhone) {
                    let waMessage = `¡Hola! Encontré ${selectedLocation.name} en Plaza Derma, ¿me podrían dar informes?`;
                    if (isSelectionActive && selectedLocation.products && selectedLocation.products.length > 0) {
                      const matchingProds = selectedLocation.products.filter(prod => {
                        if (selectedProducts.length > 0) return selectedProducts.some(sp => prod.name.toLowerCase().includes(sp.toLowerCase()));
                        if (selectedBrand) return prod.brand?.toLowerCase() === selectedBrand.toLowerCase();
                        return false;
                      });

                      if (matchingProds.length === 1) {
                        const p = matchingProds[0];
                        const brandStr = p.brand ? ` de ${p.brand}` : '';
                        waMessage = `¡Hola! Encontré su centro en Plaza Derma, ¿me podrían confirmar que tienen "${p.name}"${brandStr} para acercarme a comprarlo?`;
                      } else if (matchingProds.length > 1) {
                        const names = matchingProds.map(p => `"${p.name}"`).join(', ');
                        waMessage = `¡Hola! Encontré su centro en Plaza Derma, ¿me me podrían confirmar que tienen los productos ${names} para acercarme a comprarlo?`;
                      }
                    }
                    whatsappUrl = `https://wa.me/51${cleanPhone}?text=${encodeURIComponent(waMessage)}`;
                  }

                  return (
                    <div style={{ display: 'flex', gap: '10px', width: '100%', marginTop: '4px' }}>
                      <button 
                        type="button"
                        className="locator-directions-btn" 
                        onClick={() => setNavTarget({ lat: selectedLocation.lat, lng: selectedLocation.lng, name: selectedLocation.name })}
                        style={{ flex: 1, marginTop: 0, padding: '12px 16px', fontSize: '14px', fontWeight: 800, borderRadius: '14px' }}
                      >
                        <Navigation size={16} />
                        Cómo llegar
                      </button>

                      {whatsappUrl && (
                        <a 
                          href={whatsappUrl} 
                          target="_blank" 
                          rel="noreferrer" 
                          className="locator-whatsapp-btn"
                          style={{ flex: 1, padding: '12px 16px', fontSize: '14px', fontWeight: 800, borderRadius: '14px' }}
                          title={`Enviar WhatsApp a ${selectedLocation.name}`}
                        >
                          <MessageCircle size={17} />
                          WhatsApp
                        </a>
                      )}
                    </div>
                  );
                })()}

              </div>
            );
          }

          // -------------------------------------------------------------
          // 2. GENERAL CARDS LIST VIEW (When no comercio is selected)
          // -------------------------------------------------------------
          return (
            <>
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

                  const topProb = matchingProducts.length > 0 ? getProbabilityInfo(matchingProducts[0].last_date) : null;

                  return (
                    <div 
                      key={loc.id} 
                      className="locator-card"
                      ref={el => { cardRefs.current[loc.id] = el; }}
                      onClick={() => {
                        setSelectedLocationId(loc.id);
                        if (mobileSheetState === 'collapsed') {
                          setMobileSheetState('half');
                        }
                      }}
                      style={{ display: 'flex', flexDirection: 'column', gap: '0', padding: '14px 16px', gridTemplateColumns: 'none' }}
                    >
                      {/* Main Row: Doctor Icon, Doctor Name + Address, Stock Probability & Chevron */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', width: '100%' }}>
                        
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
                          <ChevronRight size={18} style={{ color: '#94A3B8' }} />
                        </div>

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
            </>
          );
        })()}
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

      {/* Navigation App Chooser Modal (Google Maps & Waze) */}
      {navTarget && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-label="Seleccionar aplicación de mapas"
          onClick={() => setNavTarget(null)}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 50, 80, 0.5)',
            backdropFilter: 'blur(6px)',
            zIndex: 3000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px'
          }}
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '20px',
              padding: '24px',
              maxWidth: '360px',
              width: '100%',
              boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative'
            }}
          >
            <button
              type="button"
              onClick={() => setNavTarget(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#64748B',
                padding: '4px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
              aria-label="Cerrar modal"
            >
              <X size={20} />
            </button>

            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#00506E', margin: 0, paddingRight: '24px' }}>
                ¿Cómo deseas llegar?
              </h3>
              <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0 0', lineHeight: '1.3' }}>
                Selecciona tu aplicación de navegación preferida para llegar a <strong>{navTarget.name}</strong>:
              </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {/* Google Maps Link */}
              <a
                href={`https://www.google.com/maps/dir/?api=1&destination=${navTarget.lat},${navTarget.lng}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setNavTarget(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderRadius: '14px',
                  backgroundColor: '#F8FAFC',
                  border: '1.5px solid #E2E8F0',
                  color: '#0F172A',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: '14px',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '22px' }}>🗺️</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 800, color: '#1E293B' }}>Google Maps</span>
                  <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 500 }}>Navegación estándar en web / app</span>
                </div>
                <ChevronRight size={18} style={{ marginLeft: 'auto', color: '#94A3B8' }} />
              </a>

              {/* Waze Link */}
              <a
                href={`https://waze.com/ul?ll=${navTarget.lat},${navTarget.lng}&navigate=yes`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setNavTarget(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 16px',
                  borderRadius: '14px',
                  backgroundColor: 'rgba(5, 195, 221, 0.08)',
                  border: '1.5px solid rgba(5, 195, 221, 0.35)',
                  color: '#00506E',
                  textDecoration: 'none',
                  fontWeight: 700,
                  fontSize: '14px',
                  transition: 'all 0.15s ease'
                }}
              >
                <span style={{ fontSize: '22px' }}>🚙</span>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 800, color: '#00506E' }}>Waze</span>
                  <span style={{ fontSize: '11px', color: '#0284C7', fontWeight: 500 }}>Navegación con tráfico en vivo</span>
                </div>
                <ChevronRight size={18} style={{ marginLeft: 'auto', color: '#05C3DD' }} />
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
