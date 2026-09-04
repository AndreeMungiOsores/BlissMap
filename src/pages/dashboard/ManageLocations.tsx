import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { supabase } from '../../supabaseClient';
import type { Locator } from './DashboardLayout';
import localDoctorsData from '../../data/doctors_data.json';
import { 
  Plus, 
  Search, 
  Edit3, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Image as ImageIcon,
  MapPin,
  AlertCircle,
  Package,
  Link2,
  Link2Off,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Check,
  Tag,
  SlidersHorizontal
} from 'lucide-react';

import { fetchB2BSalesLocations } from '../../services/b2bApiService';

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
  lat?: number;
  lng?: number;
  phone: string | null;
  email: string | null;
  website: string | null;
  tags: string[];
  custom_fields: Record<string, string>;
  published: boolean;
  products?: ProductItem[];
  created_at?: string;
  is_manual_override?: boolean;
  grupo_economico_ids?: string[] | null;
}

interface SuggestedGroup {
  ids: string[];
  name: string;
  address: string;
  totalProducts: number;
  rucs: string[];
}

interface OutletContextType {
  activeLocator: Locator | null;
  fetchLocators?: () => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_NAMES = ['daysi timana', 'winston maldonado', 'marjorie villate', 'giuliana peching'];

const removeAccents = (str: string | null | undefined): string => {
  if (!str) return '';
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
};

const normalizeAddress = (addr: string): string =>
  removeAccents(addr)
    .replace(/\bav\b\.?/g, 'av').replace(/\bjr\b\.?/g, 'jr').replace(/\bcalle\b/g, 'cl')
    .replace(/\bnro\b\.?/g, '').replace(/\bnumero\b/g, '')
    .replace(/[.,#°]/g, ' ').replace(/\s+/g, ' ').trim();

const nameSimilarity = (a: string, b: string): number => {
  const bigrams = (s: string) => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) set.add(s[i] + s[i + 1]);
    return set;
  };
  const ba = bigrams(removeAccents(a));
  const bb = bigrams(removeAccents(b));
  if (ba.size === 0 || bb.size === 0) return 0;
  let intersection = 0;
  ba.forEach(g => { if (bb.has(g)) intersection++; });
  return (2 * intersection) / (ba.size + bb.size);
};

const detectPossibleGroups = (list: LocationItem[]): SuggestedGroup[] => {
  const groups: SuggestedGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i].id)) continue;
    const addrI = normalizeAddress(list[i].address);
    if (!addrI || addrI.length < 8) continue;
    const peers: LocationItem[] = [list[i]];

    for (let j = i + 1; j < list.length; j++) {
      if (used.has(list[j].id) || list[j].id === list[i].id) continue;
      if (list[i].grupo_economico_ids?.includes(list[j].id) || list[j].grupo_economico_ids?.includes(list[i].id)) continue;
      const addrJ = normalizeAddress(list[j].address);
      // Use address similarity >= 0.75 instead of exact match to handle minor API text variations
      if (nameSimilarity(addrI, addrJ) < 0.75) continue;
      if (nameSimilarity(list[i].name, list[j].name) >= 0.55) {
        peers.push(list[j]);
        used.add(list[j].id);
      }
    }

    if (peers.length >= 2) {
      used.add(list[i].id);
      const allProducts = peers.flatMap(p => p.products || []);
      const uniqueProducts = new Map<string, ProductItem>();
      allProducts.forEach(p => { if (!uniqueProducts.has(p.name)) uniqueProducts.set(p.name, p); });
      groups.push({
        ids: peers.map(p => p.id),
        name: peers[0].name,
        address: peers[0].address,
        totalProducts: uniqueProducts.size,
        rucs: peers.map(p => p.custom_fields?.['Documento'] || '').filter(Boolean),
      });
    }
  }
  return groups;
};

// ── Component ─────────────────────────────────────────────────────────────────

export const ManageLocations: React.FC = () => {
  const { activeLocator, fetchLocators } = useOutletContext<OutletContextType>();

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'manual'>('all');
  const [loading, setLoading] = useState(true);
  const [error] = useState<string | null>(null);
  const [ignoredGroupKeys, setIgnoredGroupKeys] = useState<Set<string>>(new Set());
  const [bannerOpen, setBannerOpen] = useState(true);

  // Brand Visibility Section State
  const [brandVisibilityOpen, setBrandVisibilityOpen] = useState(false);
  const [hiddenBrands, setHiddenBrands] = useState<Set<string>>(new Set());
  const [savingBrands, setSavingBrands] = useState(false);
  const [brandSaveSuccess, setBrandSaveSuccess] = useState(false);

  // Sync hiddenBrands with activeLocator or localStorage fallback
  useEffect(() => {
    if (activeLocator) {
      const storedLocal = localStorage.getItem(`bm_hidden_brands_${activeLocator.id}`);
      const initialHidden: string[] = activeLocator.hidden_brands && Array.isArray(activeLocator.hidden_brands)
        ? activeLocator.hidden_brands
        : (storedLocal ? JSON.parse(storedLocal) : []);
      
      setHiddenBrands(new Set(initialHidden.map(b => b.toUpperCase())));
    }
  }, [activeLocator]);

  const fetchLocations = useCallback(async () => {
    if (!activeLocator) return;
    setLoading(true);
    try {
      // 1. Fetch live/cached B2B API locations
      const { locations: apiLocations } = await fetchB2BSalesLocations(localDoctorsData as any);

      // 2. Fetch Supabase manual overrides
      let dbData: any[] = [];
      try {
        const { data } = await supabase
          .from('bm_locations')
          .select('*')
          .eq('locator_id', activeLocator.id);
        if (data) dbData = data;
      } catch (dbErr) {
        console.warn('Supabase locations fetch notice:', dbErr);
      }

      const dbMap = new Map<string, any>();
      dbData.forEach(item => {
        dbMap.set(item.id, item);
      });

      // 3. Merge: Apply DB manual overrides over API base locations with smart RUC + Name fallback
      const mergedList: LocationItem[] = apiLocations.map((apiLoc: any) => {
        let override = dbMap.get(apiLoc.id);

        // Fallback: Match by Document (RUC/DNI) extracted from custom_fields OR from the DB record's own id field.
        // This ensures records saved with legacy id formats (empresa-prefix, array-index, or empresa-agnostic)
        // are still matched to the correct API entry.
        if (!override) {
          const apiDocNum = (apiLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');

          if (apiDocNum) {
            for (const [dbId, dbItem] of dbMap.entries()) {
              // Try custom_fields.Documento first, then extract digits from the record's own id
              const dbDocFromFields = (dbItem.custom_fields?.['Documento'] || '').replace(/\D/g, '');
              // Extract any 8-11 digit sequence embedded in the id string (RUC = 11 digits, DNI = 8 digits)
              const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
              const dbDocNum = dbDocFromFields || dbDocFromId;

              const apiNameClean = (apiLoc.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const dbNameClean = (dbItem.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

              if (dbDocNum && dbDocNum === apiDocNum) {
                // Accept the match if names overlap OR if either name is missing/very short
                const nameMatch = !apiNameClean || !dbNameClean ||
                  apiNameClean.includes(dbNameClean) || dbNameClean.includes(apiNameClean) ||
                  apiNameClean.length < 4 || dbNameClean.length < 4;
                if (nameMatch) {
                  override = dbItem;
                  dbMap.delete(dbId);
                  break;
                }
              }
            }
          }
        } else {
          dbMap.delete(apiLoc.id);
        }

        if (override) {
          return {
            ...apiLoc,
            ...override,
            products: (override.products && Array.isArray(override.products) && override.products.length > 0) 
              ? override.products 
              : apiLoc.products,
            is_manual_override: true,
            custom_fields: { ...(apiLoc.custom_fields || {}), ...(override.custom_fields || {}) },
            published: override.published !== undefined ? override.published : true,
            grupo_economico_ids: override.grupo_economico_ids || null,
          };
        }

        return {
          ...apiLoc,
          is_manual_override: false,
          published: true,
          grupo_economico_ids: null,
        } as LocationItem;
      });

      // Build a set of RUCs already represented in mergedList to avoid unshifting DB orphans
      // that are duplicates of the same clinic saved under a different empresa ID.
      const mergedRucSet = new Set<string>();
      mergedList.forEach(loc => {
        const ruc = (loc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
        if (ruc) mergedRucSet.add(ruc);
      });

      // Add any truly new custom locations from DB that were not in API and not already covered
      dbMap.forEach((customDbLoc, dbId) => {
        const dbDocFromFields = (customDbLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
        const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
        const dbDocNum = dbDocFromFields || dbDocFromId;

        // Skip if this RUC is already in the merged list — it's a stale duplicate from a legacy empresa ID
        if (dbDocNum && mergedRucSet.has(dbDocNum)) return;

        mergedList.unshift({
          ...customDbLoc,
          is_manual_override: true,
          published: customDbLoc.published !== undefined ? customDbLoc.published : true,
          grupo_economico_ids: customDbLoc.grupo_economico_ids || null,
        } as LocationItem);
      });

      const filtered = mergedList.filter(
        loc => !TEST_NAMES.some(tn => loc.name.toLowerCase().includes(tn))
      );

      setLocations(filtered);
    } catch (err: any) {
      console.error(err);
      setLocations(localDoctorsData as any);
    } finally {
      setLoading(false);
    }
  }, [activeLocator]);

  useEffect(() => { fetchLocations(); }, [fetchLocations]);

  const handleTogglePublish = async (id: string, currentStatus: boolean) => {
    try {
      if (!id.startsWith('doc-')) {
        await supabase.from('bm_locations').update({ published: !currentStatus }).eq('id', id);
      }
      setLocations(prev => prev.map(loc => loc.id === id ? { ...loc, published: !currentStatus } : loc));
    } catch (err: any) {
      console.error(err);
      setLocations(prev => prev.map(loc => loc.id === id ? { ...loc, published: !currentStatus } : loc));
    }
  };

  const handleDeleteLocation = async (id: string, name: string) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar la ubicación "${name}"?`)) return;
    try {
      if (!id.startsWith('doc-')) {
        await supabase.from('bm_locations').delete().eq('id', id);
      }
      setLocations(prev => prev.filter(loc => loc.id !== id));
    } catch (err: any) {
      console.error(err);
      setLocations(prev => prev.filter(loc => loc.id !== id));
    }
  };

  const handleUnifyGroup = async (group: SuggestedGroup) => {
    const members = locations.filter(l => group.ids.includes(l.id));
    const primary = members.reduce((best, cur) =>
      (cur.products?.length || 0) >= (best.products?.length || 0) ? cur : best
    );
    try {
      await supabase.from('bm_locations').upsert({
        id: primary.id,
        locator_id: activeLocator!.id,
        name: primary.name,
        address: primary.address,
        lat: primary.lat ?? 0,
        lng: primary.lng ?? 0,
        image_url: primary.image_url || null,
        custom_fields: primary.custom_fields || {},
        published: primary.published !== false,
        grupo_economico_ids: group.ids,
      }, { onConflict: 'id' });
    } catch (err) {
      console.error('Error unifying group:', err);
    }
    await fetchLocations();
  };

  const handleDissolveGroup = async (primaryId: string) => {
    if (!window.confirm('¿Deseas separar este grupo económico? Las ubicaciones volverán a mostrarse de forma independiente.')) return;
    try {
      await supabase.from('bm_locations').update({ grupo_economico_ids: null }).eq('id', primaryId);
    } catch (err) {
      console.error('Error dissolving group:', err);
    }
    await fetchLocations();
  };

  const handleIgnoreGroup = (group: SuggestedGroup) => {
    const key = [...group.ids].sort().join('|');
    setIgnoredGroupKeys(prev => new Set([...prev, key]));
  };

  // ── Derived state ─────────────────────────────────────────────────────────

  const suggestedGroups = useMemo(() => {
    const raw = detectPossibleGroups(locations);
    return raw.filter(g => !ignoredGroupKeys.has([...g.ids].sort().join('|')));
  }, [locations, ignoredGroupKeys]);

  const groupSecondaryIds = useMemo(() => {
    const secondary = new Set<string>();
    locations.forEach(loc => {
      if (loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0) {
        loc.grupo_economico_ids.forEach(gid => { if (gid !== loc.id) secondary.add(gid); });
      }
    });
    return secondary;
  }, [locations]);

  // Count total manual overrides saved in Supabase
  const manualCount = useMemo(() => locations.filter(loc => loc.is_manual_override).length, [locations]);

  const filteredLocations = useMemo(() => locations.filter(loc => {
    if (groupSecondaryIds.has(loc.id)) return false;
    if (filterMode === 'manual' && !loc.is_manual_override) return false;
    const searchClean = removeAccents(search.trim());
    if (!searchClean) return true;
    const matchesName = removeAccents(loc.name).includes(searchClean);
    const matchesAddress = removeAccents(loc.address).includes(searchClean);
    const matchesTags = loc.tags?.some(t => removeAccents(t).includes(searchClean));
    const matchesProducts = loc.products?.some(p => {
      const cleanName = removeAccents(p.name);
      const cleanBrand = removeAccents(p.brand || '');
      const combined = `${cleanBrand} ${cleanName}`.trim();
      if (cleanName.includes(searchClean) || (cleanBrand && cleanBrand.includes(searchClean)) || combined.includes(searchClean)) {
        return true;
      }
      const tokens = searchClean.split(/\s+/).filter(t => t.length > 0);
      if (tokens.length > 1) {
        return tokens.every(token => combined.includes(token));
      }
      return false;
    });
    const matchesCustom = loc.custom_fields && Object.values(loc.custom_fields).some(v => removeAccents(String(v)).includes(searchClean));
    if (matchesName || matchesAddress || matchesTags || matchesProducts || matchesCustom) {
      return true;
    }
    const tokens = searchClean.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length > 1) {
      const allLocText = removeAccents([
        loc.name,
        loc.address,
        ...(loc.tags || []),
        ...Object.values(loc.custom_fields || {}),
        ...(loc.products || []).map(p => `${p.brand || ''} ${p.name}`)
      ].join(' '));
      return tokens.every(token => allLocText.includes(token));
    }
    return false;
  }), [locations, groupSecondaryIds, filterMode, search]);

  // Extract unique brands with product counts across the full dataset
  const brandStats = useMemo(() => {
    const map = new Map<string, { brand: string; count: number }>();
    locations.forEach(loc => {
      loc.products?.forEach(p => {
        if (p.brand && p.brand.trim()) {
          const raw = p.brand.trim();
          const upper = raw.toUpperCase();
          const existing = map.get(upper);
          if (existing) {
            existing.count += 1;
          } else {
            map.set(upper, { brand: raw, count: 1 });
          }
        }
      });
    });
    return Array.from(map.values()).sort((a, b) => a.brand.localeCompare(b.brand));
  }, [locations]);

  const toggleBrandVisibility = (brandName: string) => {
    const key = brandName.toUpperCase();
    setHiddenBrands(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setBrandSaveSuccess(false);
  };

  const handleSelectAllBrands = () => {
    setHiddenBrands(new Set());
    setBrandSaveSuccess(false);
  };

  const handleDeselectAllBrands = () => {
    const allKeys = new Set(brandStats.map(b => b.brand.toUpperCase()));
    setHiddenBrands(allKeys);
    setBrandSaveSuccess(false);
  };

  const handleSaveBrandVisibility = async () => {
    if (!activeLocator) return;
    setSavingBrands(true);
    setBrandSaveSuccess(false);
    const hiddenArray = Array.from(hiddenBrands);

    // 1. Instant fallback via localStorage
    try {
      localStorage.setItem(`bm_hidden_brands_${activeLocator.id}`, JSON.stringify(hiddenArray));
    } catch (e) {
      console.warn('localStorage save warning:', e);
    }

    // 2. Persist to Supabase
    try {
      const { error: sbError } = await supabase
        .from('bm_locators')
        .update({ hidden_brands: hiddenArray })
        .eq('id', activeLocator.id);

      if (sbError) {
        console.warn('Supabase update notice (requires ALTER TABLE bm_locators):', sbError);
      } else if (fetchLocators) {
        await fetchLocators();
      }
    } catch (err) {
      console.warn('Supabase update exception:', err);
    } finally {
      setSavingBrands(false);
      setBrandSaveSuccess(true);
      setTimeout(() => setBrandSaveSuccess(false), 3500);
    }
  };

  if (!activeLocator) {
    return (
      <div style={{
        textAlign: 'center',
        padding: '80px 20px',
        border: '1px dashed var(--color-dark-border)',
        borderRadius: 'var(--radius-lg)',
        backgroundColor: 'var(--color-dark-surface)'
      }}>
        <MapPin size={48} style={{ color: 'var(--color-dark-text-tertiary)', marginBottom: '16px' }} />
        <h3 style={{ fontSize: '20px', fontWeight: 600, marginBottom: '8px' }}>Ningún localizador seleccionado</h3>
        <p style={{ color: 'var(--color-dark-text-secondary)', maxWidth: '400px', margin: '0 auto 24px auto', fontSize: '15px' }}>
          Por favor selecciona o crea un localizador en el panel lateral para poder gestionar sus ubicaciones.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Ubicaciones y Productos</h1>
          <p className="admin-subtitle">Gestiona los médicos y sus catálogos de productos del mapa: <strong>{activeLocator.name}</strong></p>
        </div>
        <Link to="/dashboard/locations/new" className="btn btn-primary">
          <Plus size={18} />
          Agregar Ubicación
        </Link>
      </div>

      {/* Controls */}
      <div className="panel" style={{ padding: '14px 24px', display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flexGrow: 1, minWidth: '280px', display: 'flex', alignItems: 'center' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', color: 'var(--color-dark-text-tertiary)' }} />
          <input 
            type="text" 
            placeholder="Buscar por médico, dirección, etiqueta o producto (ej: Sebiaclear, Topialyse)..." 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-control"
            style={{ width: '100%', paddingLeft: '40px' }}
          />
        </div>

        {/* Filter Pills */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setFilterMode('all')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: filterMode === 'all' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
              backgroundColor: filterMode === 'all' ? '#00506E' : 'transparent',
              color: filterMode === 'all' ? '#FFFFFF' : 'var(--color-dark-text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            Todos ({locations.length - groupSecondaryIds.size})
          </button>

          <button
            type="button"
            onClick={() => setFilterMode('manual')}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: filterMode === 'manual' ? '1.5px solid #1EC8AA' : '1px solid rgba(30, 200, 170, 0.4)',
              backgroundColor: filterMode === 'manual' ? '#1EC8AA' : 'rgba(30, 200, 170, 0.1)',
              color: filterMode === 'manual' ? '#FFFFFF' : '#00506E',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
            title="Filtrar comercios con ediciones manuales guardadas en Supabase"
          >
            <Edit3 size={13} />
            Editados Manualmente ({manualCount})
          </button>

          <button
            type="button"
            onClick={() => setBrandVisibilityOpen(prev => !prev)}
            style={{
              padding: '7px 14px',
              borderRadius: 'var(--radius-full)',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              border: brandVisibilityOpen ? '1.5px solid #1EC8AA' : '1px solid rgba(30, 200, 170, 0.4)',
              backgroundColor: brandVisibilityOpen ? '#1EC8AA' : 'rgba(30, 200, 170, 0.08)',
              color: brandVisibilityOpen ? '#FFFFFF' : '#00506E',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'all 0.15s ease'
            }}
            aria-expanded={brandVisibilityOpen}
            title="Configurar qué marcas se muestran u ocultan en el mapa público"
          >
            <Tag size={13} />
            Visibilidad de Marcas ({brandStats.length - hiddenBrands.size}/{brandStats.length})
            {brandVisibilityOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
        </div>
        
        <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', fontWeight: 600, whiteSpace: 'nowrap', marginLeft: 'auto' }}>
          {filteredLocations.length} de {locations.length} médicos
        </div>
      </div>

      {/* Brand Visibility Section */}
      {brandVisibilityOpen && (
        <section 
          aria-label="Gestión de Visibilidad de Marcas en el Mapa"
          style={{
            marginBottom: '20px',
            borderRadius: 'var(--radius-lg)',
            border: '1.5px solid rgba(30, 200, 170, 0.4)',
            backgroundColor: 'var(--color-dark-surface)',
            boxShadow: '0 4px 20px -2px rgba(0,0,0,0.06)',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div style={{
            padding: '16px 22px',
            borderBottom: '1px solid var(--color-dark-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px',
            backgroundColor: 'rgba(30, 200, 170, 0.04)'
          }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <SlidersHorizontal size={17} style={{ color: '#1EC8AA' }} />
                <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: 'var(--color-dark-text-primary)' }}>
                  Visibilidad de Marcas en el Mapa Público
                </h3>
                <span style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  backgroundColor: hiddenBrands.size === 0 ? 'rgba(30, 200, 170, 0.15)' : 'rgba(239, 68, 68, 0.12)',
                  color: hiddenBrands.size === 0 ? '#1EC8AA' : '#ef4444',
                  padding: '2px 8px',
                  borderRadius: 'var(--radius-full)'
                }}>
                  {brandStats.length - hiddenBrands.size} de {brandStats.length} marcas activas
                </span>
              </div>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                Selecciona qué marcas se exhibirán a los clientes en el mapa público y su buscador. Los comercios y productos de las marcas desactivadas no serán visibles en la web pública.
              </p>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                type="button"
                onClick={handleSelectAllBrands}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid var(--color-dark-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-dark-text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Marcar todas las marcas para que se muestren en el mapa"
              >
                Marcar todas
              </button>
              <button
                type="button"
                onClick={handleDeselectAllBrands}
                style={{
                  padding: '6px 12px',
                  borderRadius: 'var(--radius-full)',
                  fontSize: '12px',
                  fontWeight: 600,
                  border: '1px solid var(--color-dark-border)',
                  backgroundColor: 'transparent',
                  color: 'var(--color-dark-text-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
                title="Desmarcar todas las marcas"
              >
                Desmarcar todas
              </button>
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{
            padding: '20px 22px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
            gap: '12px'
          }}>
            {brandStats.map(item => {
              const isHidden = hiddenBrands.has(item.brand.toUpperCase());
              const isVisible = !isHidden;

              return (
                <div
                  key={item.brand}
                  onClick={() => toggleBrandVisibility(item.brand)}
                  role="checkbox"
                  aria-checked={isVisible}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === ' ' || e.key === 'Enter') {
                      e.preventDefault();
                      toggleBrandVisibility(item.brand);
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderRadius: 'var(--radius-md)',
                    border: `1.5px solid ${isVisible ? '#1EC8AA' : 'var(--color-dark-border)'}`,
                    backgroundColor: isVisible ? 'rgba(30, 200, 170, 0.05)' : 'var(--color-dark-bg)',
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    userSelect: 'none'
                  }}
                  title={isVisible ? `Hacer clic para ocultar ${item.brand} del mapa` : `Hacer clic para mostrar ${item.brand} en el mapa`}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Tag size={13} style={{ color: isVisible ? '#1EC8AA' : 'var(--color-dark-text-tertiary)', flexShrink: 0 }} />
                      <span style={{
                        fontSize: '13px',
                        fontWeight: 700,
                        color: isVisible ? 'var(--color-dark-text-primary)' : 'var(--color-dark-text-tertiary)',
                        textDecoration: isVisible ? 'none' : 'line-through',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap'
                      }}>
                        {item.brand}
                      </span>
                    </div>
                    <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                      {item.count} {item.count === 1 ? 'producto' : 'productos'}
                    </span>
                  </div>

                  {/* Toggle Checkbox Badge */}
                  <div style={{
                    width: '26px',
                    height: '26px',
                    borderRadius: 'var(--radius-full)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: isVisible ? '#1EC8AA' : 'transparent',
                    border: `1.5px solid ${isVisible ? '#1EC8AA' : 'var(--color-dark-border)'}`,
                    color: isVisible ? '#FFFFFF' : 'var(--color-dark-text-tertiary)',
                    flexShrink: 0,
                    marginLeft: '8px',
                    transition: 'all 0.15s ease'
                  }}>
                    {isVisible ? <Check size={15} strokeWidth={3} /> : <EyeOff size={13} />}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer with Save Action and Status */}
          <div style={{
            padding: '14px 22px',
            borderTop: '1px solid var(--color-dark-border)',
            backgroundColor: 'rgba(0, 0, 0, 0.02)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
              <span>
                {hiddenBrands.size === 0
                  ? '✅ Todas las marcas están visibles en el mapa público.'
                  : `👁️ ${hiddenBrands.size} ${hiddenBrands.size === 1 ? 'marca oculta' : 'marcas ocultas'} en el mapa público.`}
              </span>
              {brandSaveSuccess && (
                <span style={{ color: '#1EC8AA', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                  <Check size={14} /> ¡Visibilidad guardada!
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleSaveBrandVisibility}
              disabled={savingBrands}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 20px',
                fontSize: '13px',
                fontWeight: 700,
                borderRadius: 'var(--radius-full)',
                backgroundColor: '#00506E',
                border: 'none',
                color: '#FFFFFF',
                cursor: savingBrands ? 'not-allowed' : 'pointer',
                opacity: savingBrands ? 0.7 : 1,
                transition: 'all 0.15s ease'
              }}
            >
              {savingBrands ? (
                <>
                  <div className="spinner" style={{ width: '14px', height: '14px' }} />
                  <span>Guardando...</span>
                </>
              ) : (
                <>
                  <Eye size={15} />
                  <span>Guardar Visibilidad en el Mapa</span>
                </>
              )}
            </button>
          </div>
        </section>
      )}

      {/* Suggested Groups Banner */}
      {suggestedGroups.length > 0 && (
        <div style={{
          marginBottom: '16px', borderRadius: 'var(--radius-lg)',
          border: '1px solid rgba(234,179,8,0.4)', backgroundColor: 'rgba(234,179,8,0.06)', overflow: 'hidden'
        }}>
          <button type="button" onClick={() => setBannerOpen(o => !o)} style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 20px', background: 'none', border: 'none', cursor: 'pointer',
            color: '#ca8a04', fontWeight: 700, fontSize: '13px', gap: '10px'
          }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Link2 size={15} />
              Posibles grupos económicos detectados ({suggestedGroups.length}) — misma dirección, nombre similar
            </span>
            {bannerOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
          {bannerOpen && (
            <div style={{ padding: '0 20px 16px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {suggestedGroups.map(group => (
                <div key={group.ids.join('|')} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap',
                  gap: '10px', padding: '12px 16px',
                  backgroundColor: 'var(--color-dark-surface)', borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--color-dark-border)'
                }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark-text-primary)' }}>
                      {group.name} <span style={{ color: 'var(--color-dark-text-tertiary)', fontWeight: 400 }}>×{group.ids.length}</span>
                    </div>
                    <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>{group.address}</div>
                    <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '2px' }}>
                      RUCs: {group.rucs.join(' • ')} &nbsp;·&nbsp; {group.totalProducts} productos combinados
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleIgnoreGroup(group)} style={{
                      padding: '6px 14px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 600,
                      border: '1px solid var(--color-dark-border)', background: 'transparent',
                      color: 'var(--color-dark-text-secondary)', cursor: 'pointer'
                    }}>Ignorar</button>
                    <button type="button" onClick={() => handleUnifyGroup(group)} style={{
                      padding: '6px 14px', borderRadius: 'var(--radius-full)', fontSize: '12px', fontWeight: 700,
                      border: 'none', backgroundColor: '#00506E', color: '#fff', cursor: 'pointer',
                      display: 'inline-flex', alignItems: 'center', gap: '6px'
                    }}>
                      <Link2 size={12} />
                      Unificar como Grupo
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Locations Table */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center', padding: '60px' }}>
            <div className="spinner"></div>
          </div>
        ) : error ? (
          <div style={{ padding: '40px', display: 'flex', alignItems: 'center', gap: '10px', color: '#f87171' }}>
            <AlertCircle size={20} />
            <span>{error}</span>
          </div>
        ) : filteredLocations.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-dark-text-secondary)' }}>
            <MapPin size={40} style={{ color: 'var(--color-dark-text-tertiary)', marginBottom: '12px' }} />
            <h4 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-dark-text-primary)', marginBottom: '6px' }}>No se encontraron ubicaciones</h4>
            <p style={{ fontSize: '14px' }}>
              {search ? 'Intenta cambiar los términos de búsqueda.' : 'Crea tu primera ubicación haciendo clic en "Agregar Ubicación".'}
            </p>
          </div>
        ) : (
          <div className="admin-table-container">
            <table className="admin-table">
              <thead>
                <tr>
                  <th style={{ width: '60px' }}>Foto</th>
                  <th>Médico / Razón Social</th>
                  <th>Dirección</th>
                  <th>Productos Registrados</th>
                  <th>Estado</th>
                  <th style={{ width: '100px', textAlign: 'right' }}>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredLocations.slice(0, 100).map(loc => {
                  const isGroup = !!(loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0);
                  // Merge products from all group members if this is a primary group entry
                  const groupMemberProds = isGroup
                    ? locations
                        .filter(l => loc.grupo_economico_ids!.includes(l.id) && l.id !== loc.id)
                        .flatMap(l => l.products || [])
                    : [];
                  const allGroupProds = [...(loc.products || []), ...groupMemberProds];
                  const dedupedProds = Array.from(new Map(allGroupProds.map(p => [p.name, p])).values());
                  const productCount = dedupedProds.length;

                  // Collect all RUCs for the group
                  const groupRucs = isGroup
                    ? [loc.custom_fields?.['Documento'], ...locations
                        .filter(l => loc.grupo_economico_ids!.includes(l.id) && l.id !== loc.id)
                        .map(l => l.custom_fields?.['Documento'])]
                        .filter(Boolean)
                    : [loc.custom_fields?.['Documento']].filter(Boolean);

                  return (
                    <tr key={`${loc.id}-${loc.custom_fields?.['Documento'] || ''}`}>
                      <td>
                        {loc.image_url ? (
                          <img src={loc.image_url} alt={loc.name}
                            style={{ width: '48px', height: '48px', objectFit: 'cover', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)' }} />
                        ) : (
                          <div style={{ width: '48px', height: '48px', backgroundColor: 'var(--color-dark-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-dark-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-dark-text-tertiary)' }}>
                            <ImageIcon size={18} />
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 600, color: 'var(--color-dark-text-primary)' }}>{loc.name}</span>
                          {loc.is_manual_override && (
                            <span style={{
                              fontSize: '10px', fontWeight: 700, color: '#00506E',
                              backgroundColor: 'rgba(30, 200, 170, 0.15)', border: '1px solid rgba(30, 200, 170, 0.35)',
                              padding: '2px 7px', borderRadius: 'var(--radius-full)',
                              display: 'inline-flex', alignItems: 'center', gap: '4px'
                            }}>
                              <Edit3 size={10} style={{ color: '#1EC8AA' }} />
                              Edición Manual
                            </span>
                          )}
                          {isGroup && (
                            <span style={{
                              fontSize: '10px', fontWeight: 700, color: '#7c3aed',
                              backgroundColor: 'rgba(124,58,237,0.1)', border: '1px solid rgba(124,58,237,0.3)',
                              padding: '2px 7px', borderRadius: 'var(--radius-full)',
                              display: 'inline-flex', alignItems: 'center', gap: '4px'
                            }}>
                              <Link2 size={10} />
                              Grupo Económico
                            </span>
                          )}
                        </div>
                        {loc.custom_fields?.['Razón Social'] && (
                          <div style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', marginTop: '2px' }}>
                            RS: {loc.custom_fields['Razón Social']}
                          </div>
                        )}
                        {groupRucs.length > 0 && (
                          <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                            {groupRucs.join(' | ')}
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', maxWidth: '240px' }}>
                        {loc.address}
                      </td>
                      <td>
                        {productCount > 0 ? (
                          <div>
                            <span className="badge" style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8', gap: '4px' }}>
                              <Package size={12} />
                              {productCount} {productCount === 1 ? 'producto' : 'productos'}
                            </span>
                            <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px', maxWidth: '220px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {dedupedProds.slice(0, 2).map(p => p.name).join(', ')}
                              {productCount > 2 && '...'}
                            </div>
                          </div>
                        ) : (
                          <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)' }}>Sin productos</span>
                        )}
                      </td>
                      <td>
                        <button onClick={() => handleTogglePublish(loc.id, loc.published)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center' }}
                          title={loc.published ? 'Cambiar a borrador' : 'Publicar'}
                        >
                          {loc.published ? (
                            <span className="badge badge-success" style={{ gap: '4px', cursor: 'pointer' }}>
                              <ToggleRight size={18} style={{ color: 'var(--color-success)' }} />
                              Publicado
                            </span>
                          ) : (
                            <span className="badge badge-draft" style={{ gap: '4px', cursor: 'pointer' }}>
                              <ToggleLeft size={18} style={{ color: 'var(--color-dark-text-secondary)' }} />
                              Borrador
                            </span>
                          )}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'end' }}>
                          {isGroup && (
                            <button type="button" className="btn-icon"
                              onClick={() => handleDissolveGroup(loc.id)}
                              style={{ color: '#7c3aed' }}
                              onMouseEnter={(e) => e.currentTarget.style.color = '#a855f7'}
                              onMouseLeave={(e) => e.currentTarget.style.color = '#7c3aed'}
                              title="Desunir grupo económico"
                            >
                              <Link2Off size={16} />
                            </button>
                          )}
                          <Link to={`/dashboard/locations/${loc.id}/edit`} className="btn-icon"
                            style={{ color: 'var(--color-dark-text-secondary)' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'white'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                            title="Editar Ubicación"
                          >
                            <Edit3 size={16} />
                          </Link>
                          <button className="btn-icon" onClick={() => handleDeleteLocation(loc.id, loc.name)}
                            style={{ color: 'var(--color-dark-text-secondary)' }}
                            onMouseEnter={(e) => e.currentTarget.style.color = 'var(--color-danger)'}
                            onMouseLeave={(e) => e.currentTarget.style.color = 'var(--color-dark-text-secondary)'}
                            title="Eliminar Ubicación"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
