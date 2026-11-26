import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOutletContext, Link, useSearchParams } from 'react-router-dom';
import type { Locator } from './DashboardLayout';
import {
  Building2,
  MapPin,
  Link2,
  Link2Off,
  Star,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Package,
  ArrowLeft,
  Search,
  RefreshCw,
  Stethoscope,
  Building,
  X,
  Plus,
  Trash2,
  Check,
  ShieldCheck,
  Sparkles,
  Filter,
  RotateCcw
} from 'lucide-react';
import {
  type LocationItem,
  type SuggestedGroup,
  type ActiveGroup,
  type OfficialGeItem,
  detectPossibleGroups,
  getActiveGroups,
  unifyEconomicGroup,
  batchUnifyOfficialGroups,
  batchEnrichActiveGroups,
  updateGroupPrimary,
  createManualGroup,
  dissolveEconomicGroup,
  clearGeMatchCache,
  setOfficialCatalog,
  setDataverseIndex,
  type DvContactLite
} from '../../services/groupService';
import { supabase } from '../../supabaseClient';
import {
  fetchLocatorLocations,
  locationsMemoryCache
} from '../../services/locationService';
import { determineEntityType } from '../../utils/entityUtils';
import { EconomicGroupFichaView } from '../../components/EconomicGroupFichaView';
import { LocatorChips, VisibilityPill, locatorSlugsOf } from '../../components/LocatorPills';

interface OutletContextType {
  activeLocator: Locator | null;
  locators?: Locator[];
  fetchLocators?: () => Promise<void>;
}

const OfficialGeShieldBadge: React.FC<{ officialGe: OfficialGeItem }> = ({ officialGe }) => {
  return (
    <span
      style={{
        width: '24px',
        height: '24px',
        borderRadius: 'var(--radius-full)',
        backgroundColor: '#00506E',
        color: '#ffffff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        flexShrink: 0
      }}
      title={`${officialGe.idge} • ${officialGe.nombre}${officialGe.propietario ? ` - Propietario: ${officialGe.propietario}` : ''}`}
      aria-label={`${officialGe.idge} • ${officialGe.nombre}`}
    >
      <ShieldCheck size={14} />
    </span>
  );
};

/**
 * Una misma ficha (mismo id) puede venir en la lista de varios localizadores. Es UNA sola ficha publicada en varios canales:
 * se deja una sola vez (la versión con más datos propios) y se anotan todos sus localizadores.
 */
const mergeSameFichas = (list: LocationItem[]): LocationItem[] => {
  const byId = new Map<string, LocationItem[]>();
  for (const l of list) byId.set(l.id, [...(byId.get(l.id) || []), l]);
  const score = (l: LocationItem) =>
    (l.is_manual_override ? 4 : 0) + (l.custom_fields?.['dv_contact_id'] ? 2 : 0) + ((l.grupo_economico_ids || []).length > 0 ? 1 : 0);
  const out: LocationItem[] = [];
  for (const versions of byId.values()) {
    const best = [...versions].sort((a, b) => score(b) - score(a))[0];
    const slugs = [...new Set(versions.flatMap(v => locatorSlugsOf(v.custom_fields)))];
    const names = [...new Set(versions.map(v => v.custom_fields?.['_locator_name']).filter(Boolean))];
    out.push(
      versions.length === 1
        ? best
        : { ...best, custom_fields: { ...(best.custom_fields || {}), _locator_slugs: slugs.join(','), _locator_name: names.join(' + ') } }
    );
  }
  return out;
};

export const ManageEconomicGroups: React.FC = () => {
  const { activeLocator, locators } = useOutletContext<OutletContextType>();

  // Los grupos económicos son globales: cada ficha se guarda en su propio localizador (locator_id); este id es solo el respaldo.
  const fallbackLocatorId = activeLocator?.id || locators?.[0]?.id || '4c30e857-f13f-42c5-adb3-a880dc611015';
  const [locatorScope, setLocatorScope] = useState<'all' | 'medicosbliss' | 'blissfarma'>('all');
  const [isScopeDropdownOpen, setIsScopeDropdownOpen] = useState(false);
  const scopeDropdownRef = useRef<HTMLDivElement>(null);

  // Close scope dropdown on outside click or escape key
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (scopeDropdownRef.current && !scopeDropdownRef.current.contains(e.target as Node)) {
        setIsScopeDropdownOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsScopeDropdownOpen(false);
      }
    };
    if (isScopeDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isScopeDropdownOpen]);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'suggestions'>('active');
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  useEffect(() => {
    setCurrentPage(1);
  }, [search]);
  const [ignoredGroupKeys, setIgnoredGroupKeys] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('bm_ignored_group_keys');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const [excludedSuggestionMembers, setExcludedSuggestionMembers] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem('bm_excluded_suggestion_members');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [selectedPrimaries, setSelectedPrimaries] = useState<Record<string, string>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
    const [expandedSuggestions, setExpandedSuggestions] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    text: string;
    action?: {
      label: string;
      onClick: () => void;
    };
  } | null>(null);

  // Modal Edit Active Group state
  const [editingGroup, setEditingGroup] = useState<ActiveGroup | null>(null);
  const [editingPrimaryId, setEditingPrimaryId] = useState<string>('');
  const [modalExpandedProducts, setModalExpandedProducts] = useState<Record<string, boolean>>({});
  const [modalSaving, setModalSaving] = useState(false);

  // Modal Create New Group state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createSearch, setCreateSearch] = useState('');
  const [createSelectedEntities, setCreateSelectedEntities] = useState<LocationItem[]>([]);
  const [createPrimaryId, setCreatePrimaryId] = useState<string>('');
  const [createSaving, setCreateSaving] = useState(false);

  // Batch process state
  const [batchProgress, setBatchProgress] = useState<{
    active: boolean;
    total: number;
    current: number;
    currentName: string;
  } | null>(null);

  // Load locations across locators according to selected scope (Global by default)
  const [dvReady, setDvReady] = useState(false);

  const loadData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setNotification(null);
    if (forceRefresh) {
      clearGeMatchCache();
    }
    try {
      // Catalogo vivo de grupos economicos e identidad exacta de contactos (espejo de Dataverse).
      // Si falla, se usa el archivo fijo y el parecido de nombres como antes.
      try {
        const { data: liveGroups } = await supabase
          .from('dv_mirror_grupos')
          .select('id,codigo,nombre,propietario,rol,estado');
        if (liveGroups && liveGroups.length > 0) {
          setOfficialCatalog(
            liveGroups
              .filter(g => g.estado === 0)
              .map(g => ({
                id: g.id,
                idge: g.codigo || '',
                nombre: g.nombre || '',
                propietario: g.propietario || '',
                rol: g.rol || ''
              }))
          );
          const dvContacts: DvContactLite[] = [];
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
              .from('dv_mirror_contactos')
              .select('id,ge_id,estado,documento,ruc,ruc10,cmp')
              .order('id')
              .range(from, from + 999);
            if (error || !data) break;
            dvContacts.push(...(data as DvContactLite[]));
            if (data.length < 1000) break;
          }
          if (dvContacts.length > 0) {
            setDataverseIndex(dvContacts, liveGroups.map(g => ({ id: g.id, codigo: g.codigo })));
            setDvReady(true);
          }
        }
      } catch (catErr) {
        console.warn('Datos vivos de Dataverse no disponibles, se usa el archivo local:', catErr);
      }
      const allLocators = locators && locators.length > 0 ? locators : (activeLocator ? [activeLocator] : []);
      let data: LocationItem[] = [];

      if (locatorScope === 'all') {
        const loadedArrays = await Promise.all(
          allLocators.map(async loc => {
            const locs = await fetchLocatorLocations(loc, forceRefresh);
            return locs.map(l => ({
              ...l,
              locator_id: l.locator_id || loc.id,
              custom_fields: {
                ...(l.custom_fields || {}),
                _locator_slug: loc.slug,
                _locator_name: loc.name
              }
            }));
          })
        );
        data = mergeSameFichas(loadedArrays.flat());
      } else {
        const targetLocator = allLocators.find(l => l.slug === locatorScope) || activeLocator;
        if (targetLocator) {
          const locs = await fetchLocatorLocations(targetLocator, forceRefresh);
          data = locs.map(l => ({
            ...l,
            locator_id: l.locator_id || targetLocator.id,
            custom_fields: {
              ...(l.custom_fields || {}),
              _locator_slug: targetLocator.slug,
              _locator_name: targetLocator.name
            }
          }));
        }
      }

      setLocations(data);
    } catch (err: any) {
      console.error('Error loading locations for economic groups:', err);
      setNotification({
        type: 'error',
        text: 'Error al cargar las ubicaciones. Por favor intenta nuevamente.'
      });
    } finally {
      setLoading(false);
    }
  }, [activeLocator, locators, locatorScope]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // NOTE: el limpiador automatico de grupos (reglas fijas por RUC que escribian en Supabase al abrir esta
  // pagina) fue retirado: Dataverse es ahora la fuente de verdad de grupo economico y propietario.



  // Derived: Suggested groups
  const suggestedGroups = useMemo(() => {
    void dvReady; // el indice de Dataverse (estado del modulo) cambia el resultado de la deteccion
    const raw = detectPossibleGroups(locations);
    return raw
      .map(g => {
        const baseKey = g.officialGe ? `ge-${g.officialGe.idge}` : [...g.ids].sort().join('|');
        const excludedIds = new Set(excludedSuggestionMembers[baseKey] || []);
        if (excludedIds.size === 0) return g;

        const filteredMembers = g.members.filter(m => !excludedIds.has(m.id));
        if (filteredMembers.length < 2) return null;

        const filteredIds = filteredMembers.map(m => m.id);
        const primaryStillExists = filteredMembers.some(m => m.id === g.primaryId);
        const primaryId = primaryStillExists ? g.primaryId : filteredMembers[0].id;

        return {
          ...g,
          ids: filteredIds,
          members: filteredMembers,
          primaryId,
          rucs: filteredMembers.map(m => m.custom_fields?.['Documento'] || '').filter(Boolean)
        };
      })
      .filter((g): g is SuggestedGroup => g !== null)
      .filter(g => !ignoredGroupKeys.has([...g.ids].sort().join('|')));
  }, [locations, ignoredGroupKeys, excludedSuggestionMembers, dvReady]);

  // Derived: Active unified groups
  const activeGroups = useMemo(() => {
    void dvReady;
    return getActiveGroups(locations);
  }, [locations, dvReady]);

  // Vista de ficha (página): se abre con ?ficha=<id de la ficha principal> y el botón Atrás del navegador la cierra.
  const [searchParams, setSearchParams] = useSearchParams();
  const fichaGroupId = searchParams.get('ficha');
  const fichaGroup = useMemo(() => (fichaGroupId ? activeGroups.find(g => g.primary.id === fichaGroupId) ?? null : null), [fichaGroupId, activeGroups]);
  const openFicha = (id: string) => {
    setSearchParams({ ficha: id });
    window.scrollTo({ top: 0 });
  };
  const closeFicha = () => setSearchParams({});

  // Official suggestions count
  const officialSuggestions = useMemo(() => {
    return suggestedGroups.filter(g => Boolean(g.officialGe));
  }, [suggestedGroups]);

  // Unificacion automatica de lo seguro: fichas que Dataverse (documento/CMP exacto) pone en el mismo grupo Y que estan
  // en el mismo local fisico. Respeta lo que se ignoro y lo que se separo a proposito (dv_no_auto_group).
  // Se ejecuta una vez por visita, avisa con una notificacion y se puede deshacer con "Editar grupo".
  const autoUnifyRanRef = useRef(false);
  useEffect(() => {
    if (loading || !dvReady || autoUnifyRanRef.current || locations.length === 0) return;
    const safe = suggestedGroups
      .filter(
        g =>
          g.officialGe &&
          g.verified &&
          g.sameVenue &&
          !g.members.some(m => m.custom_fields?.['dv_no_auto_group'])
      )
      .slice(0, 25);
    autoUnifyRanRef.current = true;
    if (safe.length === 0) return;
    (async () => {
      try {
        const targetLocatorId = fallbackLocatorId;
        const result = await batchUnifyOfficialGroups(targetLocatorId, safe);
        locationsMemoryCache.clear();
        await loadData(true);
        setNotification({
          type: result.errors.length === 0 ? 'success' : 'error',
          text:
            result.errors.length === 0
              ? `Se unificaron automáticamente ${result.successCount} grupo(s) confirmados por Dataverse (mismo grupo y misma dirección): ${safe.map(g => g.name).join(', ')}. Puedes separarlos desde "Editar grupo".`
              : `Unificación automática: ${result.successCount} grupo(s) unificados y ${result.errors.length} con error.`
        });
      } catch (err) {
        console.warn('Unificación automática no completada:', err);
      }
    })();
  }, [loading, dvReady, locations, suggestedGroups, activeLocator, loadData]);

  // Active groups with official GE match but missing crb7e_idge in database
  const unenrichedActiveGroups = useMemo(() => {
    return activeGroups.filter(g => g.officialGe && !g.primary.custom_fields?.['crb7e_idge']);
  }, [activeGroups]);

  // Filtered by search (supports name, address, RUC, GE code, GE name, and owner)
  const filteredSuggestions = useMemo(() => {
    if (!search.trim()) return suggestedGroups;
    const q = search.toLowerCase().trim();
    return suggestedGroups.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.address.toLowerCase().includes(q) ||
      g.rucs.some(r => r.includes(q)) ||
      g.members.some(m => m.name.toLowerCase().includes(q)) ||
      (g.officialGe && (
        g.officialGe.idge.toLowerCase().includes(q) ||
        g.officialGe.nombre.toLowerCase().includes(q) ||
        g.officialGe.propietario.toLowerCase().includes(q) ||
        g.officialGe.rol.toLowerCase().includes(q)
      ))
    );
  }, [suggestedGroups, search]);

  const filteredActiveGroups = useMemo(() => {
    if (!search.trim()) return activeGroups;
    const q = search.toLowerCase().trim();
    return activeGroups.filter(g =>
      g.primary.name.toLowerCase().includes(q) ||
      g.primary.address.toLowerCase().includes(q) ||
      g.rucs.some(r => r.includes(q)) ||
      g.members.some(m => m.name.toLowerCase().includes(q)) ||
      (g.officialGe && (
        g.officialGe.idge.toLowerCase().includes(q) ||
        g.officialGe.nombre.toLowerCase().includes(q) ||
        g.officialGe.propietario.toLowerCase().includes(q) ||
        g.officialGe.rol.toLowerCase().includes(q)
      ))
    );
  }, [activeGroups, search]);

  const totalPages = Math.max(1, Math.ceil(filteredActiveGroups.length / pageSize));
  const paginatedActiveGroups = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredActiveGroups.slice(start, start + pageSize);
  }, [filteredActiveGroups, currentPage, pageSize]);

  // Map of entity ID to existing group name (to detect and block entities that already belong to a group)
  const groupedEntityInfoMap = useMemo(() => {
    const map = new Map<string, string>();
    activeGroups.forEach(g => {
      map.set(g.primary.id, g.primary.name);
      g.primary.grupo_economico_ids?.forEach(id => {
        map.set(id, g.primary.name);
      });
      g.members.forEach(m => {
        map.set(m.id, g.primary.name);
      });
    });
    return map;
  }, [activeGroups]);

  // Filtered locations for Create New Group modal
  const createFilteredLocations = useMemo(() => {
    if (!createSearch.trim()) return locations;
    const q = createSearch.toLowerCase().trim();
    return locations.filter(loc =>
      loc.name.toLowerCase().includes(q) ||
      loc.address.toLowerCase().includes(q) ||
      (loc.custom_fields?.['Documento'] && loc.custom_fields['Documento'].includes(q)) ||
      (loc.custom_fields?.['Razón Social'] && loc.custom_fields['Razón Social'].toLowerCase().includes(q)) ||
      (loc.custom_fields?.['Razon Social'] && loc.custom_fields['Razon Social'].toLowerCase().includes(q))
    );
  }, [locations, createSearch]);

  // Auto-switch to active tab if there are no suggestions but there are active groups
  useEffect(() => {
    if (!loading && suggestedGroups.length === 0 && activeGroups.length > 0) {
      setActiveTab('active');
    }
  }, [loading, suggestedGroups.length, activeGroups.length]);

  // Handlers
  const handleSelectPrimary = (groupKey: string, memberId: string) => {
    setSelectedPrimaries(prev => ({ ...prev, [groupKey]: memberId }));
  };

  const handleToggleProducts = (entityId: string) => {
    setExpandedProducts(prev => ({ ...prev, [entityId]: !prev[entityId] }));
  };


  const handleToggleSuggestion = (groupKey: string) => {
    setExpandedSuggestions(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const handleIgnoreGroup = (group: SuggestedGroup) => {
    const key = [...group.ids].sort().join('|');
    setIgnoredGroupKeys(prev => {
      const next = new Set([...prev, key]);
      try {
        localStorage.setItem('bm_ignored_group_keys', JSON.stringify(Array.from(next)));
      } catch (err) {
        console.error('Error saving ignored groups to localStorage:', err);
      }
      return next;
    });
  };

  const handleExcludeMemberFromSuggestion = (group: SuggestedGroup, memberId: string) => {
    const baseKey = group.officialGe ? `ge-${group.officialGe.idge}` : [...group.ids].sort().join('|');
    const memberName = group.members.find(m => m.id === memberId)?.name || 'La ficha';

    setExcludedSuggestionMembers(prev => {
      const existing = prev[baseKey] || [];
      if (existing.includes(memberId)) return prev;
      const updated = { ...prev, [baseKey]: [...existing, memberId] };
      try {
        localStorage.setItem('bm_excluded_suggestion_members', JSON.stringify(updated));
      } catch (err) {
        console.error('Error saving excluded suggestion members to localStorage:', err);
      }
      return updated;
    });

    const remainingCount = group.members.filter(
      m => m.id !== memberId && !(excludedSuggestionMembers[baseKey] || []).includes(m.id)
    ).length;

    const handleUndo = () => {
      setExcludedSuggestionMembers(prev => {
        const next = { ...prev };
        delete next[baseKey];
        try {
          localStorage.setItem('bm_excluded_suggestion_members', JSON.stringify(next));
        } catch (err) {
          console.error(err);
        }
        return next;
      });
      setNotification({
        type: 'success',
        text: `Se restauró la sugerencia de "${group.officialGe?.nombre || group.name}".`
      });
    };

    if (remainingCount < 2) {
      setNotification({
        type: 'success',
        text: `"${memberName}" fue retirada de la sugerencia. Como solo queda 1 ficha, la sugerencia se ha descartado.`,
        action: {
          label: 'Deshacer',
          onClick: handleUndo
        }
      });
    } else {
      setNotification({
        type: 'success',
        text: `"${memberName}" fue excluida de este grupo. Ahora puedes unificar las ${remainingCount} fichas restantes.`,
        action: {
          label: 'Deshacer',
          onClick: handleUndo
        }
      });
    }
  };

  const totalDismissedSuggestions = Object.keys(excludedSuggestionMembers).length + ignoredGroupKeys.size;

  const handleResetDismissedSuggestions = () => {
    setExcludedSuggestionMembers({});
    setIgnoredGroupKeys(new Set());
    try {
      localStorage.removeItem('bm_excluded_suggestion_members');
      localStorage.removeItem('bm_ignored_group_keys');
    } catch (err) {
      console.error('Error clearing dismissed suggestions from localStorage:', err);
    }
    setNotification({
      type: 'success',
      text: 'Se han restablecido todas las sugerencias descartadas e ignoradas.'
    });
  };

  const handleUnify = async (group: SuggestedGroup) => {
    const targetLocatorId = fallbackLocatorId;
    const groupKey = [...group.ids].sort().join('|');
    const chosenPrimaryId = selectedPrimaries[groupKey] || group.primaryId;
    const chosenPrimary = group.members.find(m => m.id === chosenPrimaryId) || group.members[0];

    setActionLoading(groupKey);
    setNotification(null);
    try {
      await unifyEconomicGroup(targetLocatorId, group, chosenPrimaryId);
      
      // Clear memory cache across all locators so both maps stay in sync
      locationsMemoryCache.clear();
      await loadData(true);

      setNotification({
        type: 'success',
        text: `Grupo unificado con éxito. La ficha visible en el mapa será "${chosenPrimary.name}".`
      });
      // Switch to active tab to see the unified result
      setActiveTab('active');
    } catch (err: any) {
      console.error('Error unifying group:', err);
      setNotification({
        type: 'error',
        text: `Error al unificar el grupo: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setActionLoading(null);
    }
  };

  const handleBatchUnifyOfficial = async () => {
    const targetLocatorId = fallbackLocatorId;
    const confirmed = window.confirm(
      `¿Deseas unificar en lote los ${officialSuggestions.length} grupos oficiales CRM detectados?\n\nCada grupo se configurará automáticamente con su código oficial GE y metadatos correspondientes.`
    );
    if (!confirmed) return;

    setBatchProgress({
      active: true,
      total: officialSuggestions.length,
      current: 0,
      currentName: 'Iniciando unificación en lote...'
    });
    setNotification(null);

    try {
      const result = await batchUnifyOfficialGroups(
        targetLocatorId,
        officialSuggestions,
        (completed, total, currentName) => {
          setBatchProgress({
            active: true,
            total,
            current: completed,
            currentName
          });
        }
      );

      locationsMemoryCache.clear();
      await loadData(true);

      if (result.errors.length === 0) {
        setNotification({
          type: 'success',
          text: `¡Éxito! Se han unificado exitosamente los ${result.successCount} grupos oficiales CRM.`
        });
      } else {
        setNotification({
          type: 'error',
          text: `Se unificaron ${result.successCount} grupos. Hubo ${result.errors.length} errores.`
        });
      }
      setActiveTab('active');
    } catch (err: any) {
      console.error('Error during batch unification:', err);
      setNotification({
        type: 'error',
        text: `Error durante la unificación en lote: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setBatchProgress(null);
    }
  };

  const handleBatchEnrichActive = async () => {
    const confirmed = window.confirm(
      `¿Deseas sincronizar los códigos oficiales CRM en los ${unenrichedActiveGroups.length} grupos activos?\n\nEsto guardará de forma permanente el código GE, nombre del grupo y propietario en la base de datos.`
    );
    if (!confirmed) return;

    setBatchProgress({
      active: true,
      total: unenrichedActiveGroups.length,
      current: 0,
      currentName: 'Sincronizando metadatos...'
    });
    setNotification(null);

    try {
      const result = await batchEnrichActiveGroups(
        fallbackLocatorId,
        unenrichedActiveGroups,
        (completed, total, currentName) => {
          setBatchProgress({
            active: true,
            total,
            current: completed,
            currentName
          });
        }
      );

      locationsMemoryCache.clear();
      await loadData(true);

      if (result.errors.length === 0) {
        setNotification({
          type: 'success',
          text: `¡Éxito! Se sincronizaron los metadatos oficiales en los ${result.successCount} grupos activos.`
        });
      } else {
        setNotification({
          type: 'error',
          text: `Se sincronizaron ${result.successCount} grupos. Hubo ${result.errors.length} errores.`
        });
      }
    } catch (err: any) {
      console.error('Error during batch enrichment:', err);
      setNotification({
        type: 'error',
        text: `Error durante la sincronización: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setBatchProgress(null);
    }
  };

  const handleDissolve = async (primaryId: string, primaryName: string) => {
    const confirmed = window.confirm(
      `¿Deseas separar el grupo económico de "${primaryName}"?\n\nLas ubicaciones volverán a mostrarse como puntos independientes en el mapa público.`
    );
    if (!confirmed) return;

    setActionLoading(primaryId);
    setNotification(null);
    try {
      await dissolveEconomicGroup(primaryId);
      
      // Update memory cache locally
      locationsMemoryCache.clear();
      await loadData(true);

      setNotification({
        type: 'success',
        text: `El grupo económico de "${primaryName}" ha sido disuelto. Las ubicaciones ahora son independientes.`
      });
    } catch (err: any) {
      console.error('Error dissolving group:', err);
      setNotification({
        type: 'error',
        text: `Error al disolver el grupo: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Modal Handlers
  const handleOpenEditModal = (group: ActiveGroup) => {
    setEditingGroup(group);
    setEditingPrimaryId(group.primary.id);
    setModalExpandedProducts({});
  };

  const handleCloseEditModal = () => {
    if (modalSaving) return;
    setEditingGroup(null);
  };

  const handleToggleModalProducts = (entityId: string) => {
    setModalExpandedProducts(prev => ({ ...prev, [entityId]: !prev[entityId] }));
  };

  const handleSaveEditGroup = async () => {
    if (!editingGroup) return;

    // If the primary didn't change, simply close the modal
    if (editingPrimaryId === editingGroup.primary.id) {
      setEditingGroup(null);
      return;
    }

    const newPrimary = editingGroup.members.find(m => m.id === editingPrimaryId);
    if (!newPrimary) {
      setNotification({ type: 'error', text: 'No se encontró la ficha seleccionada como principal.' });
      return;
    }

    setModalSaving(true);
    try {
      const allMemberIds = editingGroup.members.map(m => m.id);
      await updateGroupPrimary(fallbackLocatorId, editingGroup.primary, newPrimary, allMemberIds);

      locationsMemoryCache.clear();
      await loadData(true);

      setNotification({
        type: 'success',
        text: `Grupo económico actualizado con éxito. La nueva ficha visible en el mapa será "${newPrimary.name}".`
      });
      setEditingGroup(null);
    } catch (err: any) {
      console.error('Error updating economic group primary:', err);
      setNotification({
        type: 'error',
        text: `Error al actualizar la ficha principal: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setModalSaving(false);
    }
  };

  const handleModalDissolve = async () => {
    if (!editingGroup) return;
    const primaryId = editingGroup.primary.id;
    const primaryName = editingGroup.primary.name;
    setEditingGroup(null);
    await handleDissolve(primaryId, primaryName);
  };

  // Create Group Handlers
  const handleToggleSelectForNewGroup = (loc: LocationItem) => {
    // Prevent adding if entity already belongs to another group
    const existingGroupName = groupedEntityInfoMap.get(loc.id);
    if (existingGroupName) {
      alert(`Esta ficha ya pertenece al grupo económico "${existingGroupName}". Para vincularla a otro grupo, primero debes disolver su grupo actual.`);
      return;
    }

    const isAlreadySelected = createSelectedEntities.some(e => e.id === loc.id);
    if (isAlreadySelected) {
      const next = createSelectedEntities.filter(e => e.id !== loc.id);
      setCreateSelectedEntities(next);
      if (createPrimaryId === loc.id) {
        setCreatePrimaryId(next.length > 0 ? next[0].id : '');
      }
    } else {
      const next = [...createSelectedEntities, loc];
      setCreateSelectedEntities(next);
      if (!createPrimaryId) {
        setCreatePrimaryId(loc.id);
      }
    }
  };

  const handleRemoveFromNewGroup = (entityId: string) => {
    const next = createSelectedEntities.filter(e => e.id !== entityId);
    setCreateSelectedEntities(next);
    if (createPrimaryId === entityId) {
      setCreatePrimaryId(next.length > 0 ? next[0].id : '');
    }
  };

  const handleSaveNewManualGroup = async () => {
    if (createSelectedEntities.length < 2) {
      setNotification({
        type: 'error',
        text: 'Debes seleccionar al menos 2 fichas para crear un grupo económico.'
      });
      return;
    }

    const primary = createSelectedEntities.find(e => e.id === createPrimaryId) || createSelectedEntities[0];
    const memberIds = createSelectedEntities.map(e => e.id);

    setCreateSaving(true);
    try {
      await createManualGroup(fallbackLocatorId, primary, memberIds);
      locationsMemoryCache.clear();
      await loadData(true);

      setNotification({
        type: 'success',
        text: `Grupo económico creado con éxito. La ficha visible en el mapa será "${primary.name}".`
      });
      setIsCreateModalOpen(false);
      setCreateSelectedEntities([]);
      setCreatePrimaryId('');
      setCreateSearch('');
      setActiveTab('active');
    } catch (err: any) {
      console.error('Error creating manual economic group:', err);
      setNotification({
        type: 'error',
        text: `Error al crear el grupo económico: ${err.message || 'Error desconocido'}`
      });
    } finally {
      setCreateSaving(false);
    }
  };

  // Keyboard accessibility: Close modals on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingGroup && !modalSaving) {
          setEditingGroup(null);
        } else if (isCreateModalOpen && !createSaving) {
          setIsCreateModalOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingGroup, modalSaving, isCreateModalOpen, createSaving]);

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '60px' }}>
      {!fichaGroupId && (<>
      {/* Top Breadcrumb & Header */}
      <div style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <Link
            to="/dashboard/locations"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              color: 'var(--color-dark-text-secondary)',
              fontSize: '13px',
              textDecoration: 'none'
            }}
          >
            <ArrowLeft size={14} />
            Volver a Ubicaciones
          </Link>
          <span style={{ color: 'var(--color-dark-border)' }}>/</span>
          <span style={{ fontSize: '13px', color: 'var(--color-dark-text-tertiary)' }}>
            Todos los localizadores
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ fontSize: '26px', fontWeight: 800, color: 'var(--color-dark-text-primary)', margin: 0, display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Building2 size={26} style={{ color: 'var(--color-primary)' }} />
              Grupos Económicos
            </h1>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => loadData(true)}
              className="btn btn-secondary"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 14px' }}
              title="Recargar datos"
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              Actualizar
            </button>

            <button
              onClick={() => {
                setCreateSelectedEntities([]);
                setCreatePrimaryId('');
                setCreateSearch('');
                setIsCreateModalOpen(true);
              }}
              className="btn btn-primary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '13px',
                padding: '8px 16px',
                fontWeight: 700
              }}
              title="Crear un nuevo grupo económico manualmente"
            >
              <Plus size={15} />
              Crear nuevo grupo
            </button>
          </div>
        </div>
      </div>

      </>)}

      {/* Notification Banner */}
      {notification && (
        <div
          style={{
            padding: '12px 16px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            backgroundColor: notification.type === 'success' ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: `1px solid ${notification.type === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: notification.type === 'success' ? '#15803d' : '#b91c1c',
            fontSize: '14px',
            flexWrap: 'wrap'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: '240px' }}>
            {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
            <span style={{ fontWeight: 500 }}>{notification.text}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {notification.action && (
              <button
                type="button"
                onClick={notification.action.onClick}
                style={{
                  padding: '4px 10px',
                  fontSize: '12px',
                  fontWeight: 700,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid currentColor',
                  backgroundColor: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  transition: 'opacity 0.15s ease'
                }}
              >
                <RotateCcw size={12} />
                {notification.action.label}
              </button>
            )}
            <button
              type="button"
              onClick={() => setNotification(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold', padding: '4px' }}
              aria-label="Cerrar notificación"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {!fichaGroupId && (<>
      {/* Navigation Tabs & Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          borderBottom: '1px solid var(--color-dark-border)',
          marginBottom: '24px',
          paddingBottom: '4px'
        }}
      >
        <div role="tablist" aria-label="Secciones de grupos económicos" style={{ display: 'flex', gap: '8px' }}>
          <button
            role="tab"
            aria-selected={activeTab === 'active'}
            onClick={() => setActiveTab('active')}
            style={{
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: 700,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              borderBottom: activeTab === 'active' ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === 'active' ? 'var(--color-primary)' : 'var(--color-dark-text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            <Link2 size={16} />
            Grupos Unificados Activos
            <span
              style={{
                backgroundColor: activeGroups.length > 0 ? '#00506E' : 'var(--color-dark-border)',
                color: activeGroups.length > 0 ? 'white' : 'var(--color-dark-text-secondary)',
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)'
              }}
            >
              {activeGroups.length}
            </span>
          </button>

          <button
            role="tab"
            aria-selected={activeTab === 'suggestions'}
            onClick={() => setActiveTab('suggestions')}
            style={{
              padding: '10px 18px',
              fontSize: '14px',
              fontWeight: 700,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              borderBottom: activeTab === 'suggestions' ? '2px solid var(--color-primary)' : '2px solid transparent',
              color: activeTab === 'suggestions' ? 'var(--color-primary)' : 'var(--color-dark-text-secondary)',
              transition: 'all 0.15s ease'
            }}
          >
            <AlertCircle size={16} />
            Sugerencias de Agrupación
            <span
              style={{
                backgroundColor: suggestedGroups.length > 0 ? '#ca8a04' : 'var(--color-dark-border)',
                color: suggestedGroups.length > 0 ? 'white' : 'var(--color-dark-text-secondary)',
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 8px',
                borderRadius: 'var(--radius-full)'
              }}
            >
              {suggestedGroups.length}
            </span>
          </button>
        </div>

        {/* Quick Search, Scope Filter, and Reset Dismissed */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {totalDismissedSuggestions > 0 && (
            <button
              type="button"
              onClick={handleResetDismissedSuggestions}
              title="Restablecer sugerencias que fueron ignoradas o fichas excluidas"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-dark-border)',
                backgroundColor: 'var(--color-dark-surface)',
                color: 'var(--color-dark-text-secondary)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'all 0.15s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-dark-bg)';
                e.currentTarget.style.color = 'var(--color-dark-text-primary)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--color-dark-surface)';
                e.currentTarget.style.color = 'var(--color-dark-text-secondary)';
              }}
            >
              <RotateCcw size={12} />
              <span>Restablecer descartadas ({totalDismissedSuggestions})</span>
            </button>
          )}
          <div style={{ position: 'relative', minWidth: '240px' }}>
            <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-dark-text-tertiary)' }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por sede, nombre o RUC..."
              className="form-control"
              style={{ paddingLeft: '34px', fontSize: '13px', height: '36px', width: '100%' }}
            />
          </div>

          {/* Discrete Filter Button */}
          <div style={{ position: 'relative' }} ref={scopeDropdownRef}>
            <button
              type="button"
              onClick={() => setIsScopeDropdownOpen(prev => !prev)}
              aria-label="Filtrar por ámbito de grupo económico"
              aria-haspopup="menu"
              aria-expanded={isScopeDropdownOpen}
              title={`Ámbito: ${locatorScope === 'all' ? 'Vista Global Corporativa (Ambos)' : locatorScope === 'medicosbliss' ? 'MedicosBliss (B2B)' : 'Blissfarma (B2C)'}`}
              style={{
                width: '36px',
                height: '36px',
                padding: 0,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 'var(--radius-md)',
                border: locatorScope !== 'all' ? '1.5px solid var(--color-primary)' : '1px solid var(--color-dark-border)',
                backgroundColor: locatorScope !== 'all' ? 'rgba(0, 80, 110, 0.08)' : 'var(--color-dark-surface)',
                color: locatorScope !== 'all' ? 'var(--color-primary)' : 'var(--color-dark-text-secondary)',
                cursor: 'pointer',
                position: 'relative',
                transition: 'all 0.15s ease'
              }}
            >
              <Filter size={15} />
              {locatorScope !== 'all' && (
                <span
                  style={{
                    position: 'absolute',
                    top: '6px',
                    right: '6px',
                    width: '6px',
                    height: '6px',
                    borderRadius: '50%',
                    backgroundColor: locatorScope === 'medicosbliss' ? '#3B82F6' : '#1EC8AA'
                  }}
                />
              )}
            </button>

            {/* Clickable Dropdown Menu */}
            {isScopeDropdownOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 6px)',
                  right: 0,
                  minWidth: '270px',
                  backgroundColor: 'var(--color-dark-surface, #ffffff)',
                  border: '1px solid var(--color-dark-border, #e2e8f0)',
                  borderRadius: 'var(--radius-lg, 10px)',
                  boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.1)',
                  zIndex: 100,
                  padding: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '4px'
                }}
                role="menu"
                aria-label="Seleccionar ámbito de visualización"
              >
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: 'var(--color-dark-text-tertiary)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    padding: '4px 8px 6px 8px',
                    borderBottom: '1px solid var(--color-dark-border)'
                  }}
                >
                  Ámbito de visualización
                </div>

                {[
                  { id: 'all', label: 'Vista Global Corporativa (Ambos)', icon: '🌐', title: 'Ver y gestionar grupos de toda la corporación' },
                  { id: 'medicosbliss', label: 'MedicosBliss (B2B)', icon: '🩺', title: 'Ver solo grupos con sedes en MedicosBliss' },
                  { id: 'blissfarma', label: 'Blissfarma (B2C)', icon: '💊', title: 'Ver solo grupos con sedes en Blissfarma' }
                ].map(opt => {
                  const isSelected = locatorScope === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitem"
                      title={opt.title}
                      onClick={() => {
                        setLocatorScope(opt.id as 'all' | 'medicosbliss' | 'blissfarma');
                        setIsScopeDropdownOpen(false);
                      }}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 10px',
                        borderRadius: 'var(--radius-md, 6px)',
                        border: 'none',
                        backgroundColor: isSelected ? 'rgba(0, 80, 110, 0.1)' : 'transparent',
                        color: isSelected ? 'var(--color-primary)' : 'var(--color-dark-text-primary)',
                        fontSize: '13px',
                        fontWeight: isSelected ? 700 : 500,
                        cursor: 'pointer',
                        textAlign: 'left',
                        transition: 'background-color 0.12s ease'
                      }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                        <span>{opt.icon}</span>
                        <span>{opt.label}</span>
                      </span>
                      {isSelected && <Check size={14} style={{ color: 'var(--color-primary)' }} />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Loading Spinner */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--color-dark-text-secondary)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px auto' }}></div>
          <p style={{ fontSize: '14px' }}>Analizando ubicaciones y detectando coincidencias...</p>
        </div>
      )}

      {/* ── TAB 1: SUGGESTED GROUPS ── */}
      {!loading && activeTab === 'suggestions' && (
        <div>
          {/* Official CRM Detected Batch Banner */}
          {officialSuggestions.length > 0 && !search && (
            <div
              style={{
                padding: '16px 20px',
                backgroundColor: 'rgba(0, 80, 110, 0.05)',
                border: '1px solid rgba(0, 80, 110, 0.2)',
                borderRadius: 'var(--radius-lg)',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#00506E',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#00506E' }}>
                    Grupos Oficiales CRM Detectados ({officialSuggestions.length})
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                    Se identificaron {officialSuggestions.length} agrupaciones con correspondencia en el catálogo oficial de Dynamics 365.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleBatchUnifyOfficial}
                disabled={Boolean(batchProgress?.active)}
                className="btn btn-primary"
                style={{
                  fontSize: '13px',
                  padding: '8px 20px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: '#00506E',
                  color: '#ffffff'
                }}
              >
                <Sparkles size={15} />
                Unificar Todos los Grupos Oficiales ({officialSuggestions.length})
              </button>
            </div>
          )}

          {filteredSuggestions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                backgroundColor: 'var(--color-dark-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-dark-border)'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: 'rgba(34, 197, 94, 0.1)',
                  color: '#15803d',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px auto'
                }}
              >
                <CheckCircle2 size={28} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-dark-text-primary)', margin: '0 0 6px 0' }}>
                {search ? 'No se encontraron sugerencias con esa búsqueda' : 'No hay sugerencias de grupos pendientes'}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', margin: 0, maxWidth: '500px', marginInline: 'auto' }}>
                {search
                  ? 'Intenta con otro término de búsqueda o limpia el filtro.'
                  : 'Todas las ubicaciones con direcciones coincidentes ya están unificadas o no presentan similitudes automáticas.'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
                {activeGroups.length > 0 && !search && (
                  <button
                    onClick={() => setActiveTab('active')}
                    className="btn btn-secondary"
                    style={{ fontSize: '13px' }}
                  >
                    Ver {activeGroups.length} grupo(s) activo(s)
                  </button>
                )}
                {totalDismissedSuggestions > 0 && (
                  <button
                    type="button"
                    onClick={handleResetDismissedSuggestions}
                    className="btn btn-secondary"
                    style={{ fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <RotateCcw size={13} />
                    Restablecer {totalDismissedSuggestions} sugerencia(s) descartada(s)
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {filteredSuggestions.map((group, groupIdx) => {
                const groupKey = [...group.ids].sort().join('|');
                const chosenPrimaryId = selectedPrimaries[groupKey] || group.primaryId;
                const chosenPrimary = group.members.find(m => m.id === chosenPrimaryId) || group.members[0];
                const isGroupActionLoading = actionLoading === groupKey;
                const isExpanded = expandedSuggestions[groupKey] || false;

                return (
                  <div
                    key={groupKey}
                    style={{
                      backgroundColor: 'var(--color-dark-surface)',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--color-dark-border)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Group Header (Clickable to toggle) */}
                    <div
                      onClick={() => handleToggleSuggestion(groupKey)}
                      style={{
                        padding: '16px 20px',
                        backgroundColor: isExpanded ? '#FAF8F5' : 'var(--color-dark-surface)',
                        borderBottom: isExpanded ? '1px solid var(--color-dark-border)' : 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '12px',
                        cursor: 'pointer',
                        transition: 'background-color 0.15s ease'
                      }}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleToggleSuggestion(groupKey);
                        }
                      }}
                      aria-expanded={isExpanded}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '36px',
                            height: '36px',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'rgba(0, 80, 110, 0.1)',
                            color: '#00506E',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                          }}
                        >
                          <Building2 size={18} />
                        </div>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            {group.officialGe ? (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 800,
                                  backgroundColor: '#00506E',
                                  color: '#ffffff',
                                  padding: '3px 9px',
                                  borderRadius: 'var(--radius-full)',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: '4px',
                                  letterSpacing: '0.3px'
                                }}
                              >
                                <ShieldCheck size={13} />
                                {group.officialGe.idge} • Oficial CRM
                              </span>
                            ) : (
                              <span
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 700,
                                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                                  color: '#a16207',
                                  padding: '2px 8px',
                                  borderRadius: 'var(--radius-full)'
                                }}
                              >
                                Sugerencia #{groupIdx + 1}: Misma Sede Física
                              </span>
                            )}
                            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                              {group.officialGe ? group.officialGe.nombre : group.name}
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(234, 179, 8, 0.15)',
                                color: '#a16207',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)'
                              }}
                            >
                              {group.members.length} entidades detectadas
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(0, 80, 110, 0.1)',
                                color: '#00506E',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)'
                              }}
                            >
                              {group.totalProducts} productos combinados
                            </span>
                          </div>
                          {group.officialGe && (
                            <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '3px' }}>
                              Propietario GE: <strong style={{ color: 'var(--color-dark-text-primary)' }}>{group.officialGe.propietario}</strong> • Rol: <strong>{group.officialGe.rol}</strong>
                            </div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                            <MapPin size={12} style={{ color: 'var(--color-primary)' }} />
                            <span>{group.address}</span>
                          </div>
                        </div>
                      </div>

                      {/* Header Actions */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleIgnoreGroup(group);
                          }}
                          disabled={isGroupActionLoading}
                          style={{
                            padding: '7px 14px',
                            fontSize: '12px',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-dark-border)',
                            background: 'transparent',
                            color: 'var(--color-dark-text-secondary)',
                            cursor: 'pointer'
                          }}
                        >
                          Ignorar
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUnify(group);
                          }}
                          disabled={isGroupActionLoading}
                          style={{
                            padding: '7px 18px',
                            fontSize: '12px',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-full)',
                            border: 'none',
                            backgroundColor: '#00506E',
                            color: 'white',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            opacity: isGroupActionLoading ? 0.7 : 1
                          }}
                        >
                          {isGroupActionLoading ? (
                            <>
                              <RefreshCw size={12} className="animate-spin" /> Unificando...
                            </>
                          ) : (
                            <>
                              <Link2 size={13} /> Unificar Grupo
                            </>
                          )}
                        </button>

                        {/* Expand / Collapse Arrow Toggle */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleSuggestion(groupKey);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '7px 12px',
                            fontSize: '12px',
                            fontWeight: 600,
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-dark-border)',
                            backgroundColor: isExpanded ? 'rgba(0, 80, 110, 0.08)' : '#ffffff',
                            color: isExpanded ? '#00506E' : 'var(--color-dark-text-secondary)',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease'
                          }}
                          aria-expanded={isExpanded}
                          title={isExpanded ? 'Contraer detalle' : 'Expandir detalle'}
                        >
                          <span>{isExpanded ? 'Ocultar' : 'Ver detalle'}</span>
                          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                        </button>
                      </div>
                    </div>

                    {/* Member Entities Comparison Grid (Collapsed by default) */}
                    {isExpanded && (
                      <div style={{ padding: '20px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-dark-text-secondary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Fichas que componen este grupo (Haz clic para seleccionar la Ficha Principal):
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                          gap: '16px'
                        }}
                      >
                        {group.members.map(member => {
                          const isPrimary = member.id === chosenPrimaryId;
                          const entityType = member.custom_fields?.['entity_type'] || determineEntityType(member);
                          const razonSocial = member.custom_fields?.['Razón Social'] || member.custom_fields?.['Razon Social'] || '';
                          const docNumber = member.custom_fields?.['Documento'] || '';
                          const cmpNumber = member.custom_fields?.['CMP'] || member.custom_fields?.['Colegiatura'] || '';
                          const productsList = member.products || [];
                          const isProdExpanded = expandedProducts[member.id] || false;

                          return (
                            <div
                              key={member.id}
                              onClick={() => handleSelectPrimary(groupKey, member.id)}
                              style={{
                                padding: '16px',
                                borderRadius: 'var(--radius-md)',
                                cursor: 'pointer',
                                transition: 'all 0.2s ease',
                                border: isPrimary
                                  ? '2px solid #00506E'
                                  : '1px solid var(--color-dark-border)',
                                backgroundColor: isPrimary
                                  ? 'rgba(0, 80, 110, 0.03)'
                                  : 'var(--color-dark-surface)',
                                boxShadow: isPrimary
                                  ? '0 0 0 3px rgba(0, 80, 110, 0.1)'
                                  : 'none',
                                position: 'relative'
                              }}
                            >
                              {/* Primary / Secondary Indicator Badge & Locator Pill */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  {isPrimary ? (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        fontSize: '11px',
                                        fontWeight: 800,
                                        padding: '4px 10px',
                                        borderRadius: 'var(--radius-full)',
                                        backgroundColor: '#00506E',
                                        color: 'white'
                                      }}
                                    >
                                      <Star size={11} fill="white" />
                                      FICHA PRINCIPAL (Visible en mapa)
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                        padding: '4px 10px',
                                        borderRadius: 'var(--radius-full)',
                                        backgroundColor: 'var(--color-dark-bg)',
                                        color: 'var(--color-dark-text-secondary)',
                                        border: '1px solid var(--color-dark-border)'
                                      }}
                                    >
                                      ↳ Ficha Secundaria
                                    </span>
                                  )}
                                  <LocatorChips cf={member.custom_fields} />
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  {/* Exclude / Remove button */}
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleExcludeMemberFromSuggestion(group, member.id);
                                    }}
                                    title="Quitar esta ficha de la sugerencia (no se unificará con las demás)"
                                    aria-label={`Quitar ${member.name} de este grupo`}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '4px',
                                      padding: '3px 8px',
                                      fontSize: '11px',
                                      fontWeight: 600,
                                      borderRadius: 'var(--radius-full)',
                                      border: '1px solid rgba(239, 68, 68, 0.3)',
                                      backgroundColor: 'rgba(239, 68, 68, 0.06)',
                                      color: '#dc2626',
                                      cursor: 'pointer',
                                      transition: 'all 0.15s ease'
                                    }}
                                    onMouseEnter={(e) => {
                                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.15)';
                                      e.currentTarget.style.borderColor = '#dc2626';
                                    }}
                                    onMouseLeave={(e) => {
                                      e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.06)';
                                      e.currentTarget.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                                    }}
                                  >
                                    <X size={12} />
                                    <span>Quitar de este grupo</span>
                                  </button>

                                  {/* Radio circle */}
                                  <div
                                    style={{
                                      width: '18px',
                                      height: '18px',
                                      borderRadius: '50%',
                                      border: isPrimary ? '5px solid #00506E' : '2px solid var(--color-dark-border)',
                                      backgroundColor: 'white'
                                    }}
                                    title={isPrimary ? 'Ficha principal seleccionada' : 'Haz clic para seleccionar como ficha principal'}
                                  />
                                </div>
                              </div>

                              {/* Card Content Header */}
                              <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px' }}>
                                {member.image_url ? (
                                  <img
                                    src={member.image_url}
                                    alt={member.name}
                                    style={{
                                      width: '44px',
                                      height: '44px',
                                      borderRadius: 'var(--radius-sm)',
                                      objectFit: 'cover',
                                      border: '1px solid var(--color-dark-border)',
                                      flexShrink: 0
                                    }}
                                  />
                                ) : (
                                  <div
                                    style={{
                                      width: '44px',
                                      height: '44px',
                                      borderRadius: 'var(--radius-sm)',
                                      backgroundColor: 'var(--color-dark-bg)',
                                      border: '1px solid var(--color-dark-border)',
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      color: 'var(--color-dark-text-tertiary)',
                                      flexShrink: 0
                                    }}
                                  >
                                    {entityType === 'center' ? <Building size={20} /> : <Stethoscope size={20} />}
                                  </div>
                                )}

                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-dark-text-primary)' }}>
                                      {member.name}
                                    </span>
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 700,
                                        padding: '1px 6px',
                                        borderRadius: 'var(--radius-full)',
                                        backgroundColor: entityType === 'center' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                                        color: entityType === 'center' ? '#2563eb' : '#059669'
                                      }}
                                    >
                                      {entityType === 'center' ? 'Centro' : 'Médico'}
                                    </span>
                                  </div>

                                  {razonSocial && razonSocial !== member.name && (
                                    <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                                      <strong style={{ color: 'var(--color-dark-text-tertiary)' }}>RS:</strong> {razonSocial}
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Attributes Info */}
                              <div
                                style={{
                                  fontSize: '12px',
                                  color: 'var(--color-dark-text-secondary)',
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: '4px',
                                  backgroundColor: 'var(--color-dark-bg)',
                                  padding: '8px 10px',
                                  borderRadius: 'var(--radius-sm)',
                                  marginBottom: '10px'
                                }}
                              >
                                {docNumber && (
                                  <div>
                                    <span style={{ color: 'var(--color-dark-text-tertiary)' }}>RUC / Doc:</span>{' '}
                                    <strong style={{ color: 'var(--color-dark-text-primary)' }}>{docNumber}</strong>
                                  </div>
                                )}
                                {cmpNumber && (
                                  <div>
                                    <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Colegiatura:</span>{' '}
                                    <strong style={{ color: 'var(--color-dark-text-primary)' }}>{cmpNumber}</strong>
                                  </div>
                                )}
                                <div style={{ wordBreak: 'break-word' }}>
                                  <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Dirección:</span>{' '}
                                  {member.address}
                                </div>
                              </div>

                              {/* Products List Toggle */}
                              <div style={{ fontSize: '12px' }}>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleProducts(member.id);
                                  }}
                                  style={{
                                    background: 'none',
                                    border: 'none',
                                    padding: 0,
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: 'var(--color-primary)',
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <Package size={13} />
                                  {productsList.length} producto(s) aportado(s)
                                  {isProdExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                </button>

                                {isProdExpanded && (
                                  <div
                                    style={{
                                      marginTop: '8px',
                                      padding: '8px',
                                      backgroundColor: 'var(--color-dark-bg)',
                                      borderRadius: 'var(--radius-sm)',
                                      display: 'flex',
                                      flexWrap: 'wrap',
                                      gap: '4px',
                                      maxHeight: '120px',
                                      overflowY: 'auto'
                                    }}
                                  >
                                    {productsList.length > 0 ? (
                                      productsList.map((p, idx) => (
                                        <span
                                          key={idx}
                                          style={{
                                            fontSize: '11px',
                                            padding: '2px 6px',
                                            backgroundColor: 'var(--color-dark-surface)',
                                            border: '1px solid var(--color-dark-border)',
                                            borderRadius: 'var(--radius-sm)',
                                            color: 'var(--color-dark-text-primary)'
                                          }}
                                        >
                                          {p.name}
                                        </span>
                                      ))
                                    ) : (
                                      <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                                        Sin productos específicos
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {/* Footer notice of chosen primary */}
                      <div
                        style={{
                          marginTop: '16px',
                          paddingTop: '12px',
                          borderTop: '1px dashed var(--color-dark-border)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          flexWrap: 'wrap',
                          gap: '10px',
                          fontSize: '13px'
                        }}
                      >
                        <div style={{ color: 'var(--color-dark-text-secondary)' }}>
                          Se guardará visible en el mapa como:{' '}
                          <strong style={{ color: '#00506E' }}>{chosenPrimary.name}</strong>
                          {chosenPrimary.address && ` (${chosenPrimary.address})`}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleUnify(group)}
                          disabled={isGroupActionLoading}
                          className="btn btn-primary"
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            padding: '8px 20px'
                          }}
                        >
                          <Link2 size={14} />
                          Confirmar y Unificar como Grupo
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: ACTIVE UNIFIED GROUPS ── */}
      {!loading && activeTab === 'active' && (
        <div>
          {/* Active Groups Sync Official CRM Metadata Banner */}
          {unenrichedActiveGroups.length > 0 && !search && (
            <div
              style={{
                padding: '16px 20px',
                backgroundColor: 'rgba(124, 58, 237, 0.05)',
                border: '1px solid rgba(124, 58, 237, 0.2)',
                borderRadius: 'var(--radius-lg)',
                marginBottom: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '16px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: '#7c3aed',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: 800, color: '#7c3aed' }}>
                    Sincronización Oficial CRM Disponible ({unenrichedActiveGroups.length})
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                    Hay {unenrichedActiveGroups.length} grupos activos que corresponden a códigos oficiales pero aún no guardaron su código GE en la base de datos.
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleBatchEnrichActive}
                disabled={Boolean(batchProgress?.active)}
                className="btn btn-primary"
                style={{
                  fontSize: '13px',
                  padding: '8px 20px',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: '#7c3aed',
                  color: '#ffffff'
                }}
              >
                <Sparkles size={15} />
                Sincronizar Códigos GE ({unenrichedActiveGroups.length})
              </button>
            </div>
          )}

          {filteredActiveGroups.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '60px 20px',
                backgroundColor: 'var(--color-dark-surface)',
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--color-dark-border)'
              }}
            >
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--color-dark-bg)',
                  color: 'var(--color-dark-text-tertiary)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  margin: '0 auto 16px auto'
                }}
              >
                <Link2Off size={28} />
              </div>
              <h3 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--color-dark-text-primary)', margin: '0 0 6px 0' }}>
                {search ? 'No se encontraron grupos activos con esa búsqueda' : 'No hay grupos económicos unificados activos'}
              </h3>
              <p style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', margin: 0, maxWidth: '500px', marginInline: 'auto' }}>
                {search
                  ? 'Intenta con otro término o limpia el buscador.'
                  : 'Cuando unifiques sugerencias de ubicaciones en la misma sede, se mostrarán aquí para que puedas gestionarlas o desunirlas cuando lo requieras.'}
              </p>
              {suggestedGroups.length > 0 && !search && (
                <button
                  onClick={() => setActiveTab('suggestions')}
                  className="btn btn-primary"
                  style={{ marginTop: '16px', fontSize: '13px' }}
                >
                  Ver {suggestedGroups.length} sugerencia(s) pendiente(s)
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {paginatedActiveGroups.map(group => {

                return (
                  <div
                    key={group.primary.id}
                    style={{
                      backgroundColor: 'var(--color-dark-surface)',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--color-dark-border)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* ── NIVEL 1: CABEZA DEL GRUPO ECONÓMICO (Identidad Corporativa) ── */}
                    <div
                      style={{
                        padding: '18px 22px',
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '16px',
                        background: 'linear-gradient(to right, rgba(0, 80, 110, 0.03), transparent)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', flex: 1, minWidth: '300px' }}>
                        {group.primary.image_url ? (
                          <img
                            src={group.primary.image_url}
                            alt={group.primary.name}
                            style={{
                              width: '56px',
                              height: '56px',
                              borderRadius: 'var(--radius-md)',
                              objectFit: 'cover',
                              border: '1.5px solid var(--color-dark-border)',
                              boxShadow: '0 2px 6px rgba(0,0,0,0.06)'
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '56px',
                              height: '56px',
                              borderRadius: 'var(--radius-md)',
                              backgroundColor: 'rgba(0, 80, 110, 0.1)',
                              color: '#00506E',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0
                            }}
                          >
                            <Building2 size={26} />
                          </div>
                        )}

                        <div style={{ flex: 1 }}>
                          {/* Title + Badges */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '17px', fontWeight: 800, color: 'var(--color-dark-text-primary)', letterSpacing: '-0.2px' }}>
                              {group.primary.name}
                            </span>
                            {group.officialGe && (
                              <OfficialGeShieldBadge officialGe={group.officialGe} />
                            )}
                            <VisibilityPill
                              cf={group.primary.custom_fields}
                              visible={group.primary.published !== false}
                              fallbackSlug={activeLocator?.slug || 'medicosbliss'}
                            />
                          </div>

                          {/* Owner & Role */}
                          {group.officialGe ? (
                            <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', marginTop: '4px' }}>
                              Dueño Real / Propietario GE: <strong style={{ color: 'var(--color-dark-text-primary)' }}>{group.officialGe.propietario}</strong>
                              &nbsp;·&nbsp; Rol: <strong style={{ color: 'var(--color-dark-text-primary)' }}>{group.officialGe.rol}</strong>
                            </div>
                          ) : (
                            (() => {
                              const primaryDoc =
                                group.primary.custom_fields?.['Médico'] ||
                                group.primary.custom_fields?.['Medicos'] ||
                                group.primary.custom_fields?.['Doctor'] ||
                                group.members.map(m => m.custom_fields?.['Médico'] || m.custom_fields?.['Doctor']).find(Boolean);
                              if (primaryDoc) {
                                return (
                                  <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', marginTop: '4px' }}>
                                    Dueño Real / Médico Titular: <strong style={{ color: 'var(--color-dark-text-primary)' }}>{primaryDoc}</strong>
                                    &nbsp;·&nbsp; Rol: <strong style={{ color: 'var(--color-dark-text-primary)' }}>Médico Titular</strong>
                                  </div>
                                );
                              }
                              return null;
                            })()
                          )}

                          {/* Address & Branding Cascade Indicators */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginTop: '6px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                              <MapPin size={13} style={{ color: 'var(--color-primary)' }} />
                              <span>Sede Principal: <strong>{group.primary.address}</strong></span>
                            </div>

                            {/* Cascada de branding: solo un ícono discreto; el detalle sale al pasar el cursor */}
                            {(group.primary.website || group.primary.instagram || group.primary.facebook || group.primary.phone) && (
                              <span
                                title="Cascada de branding: el logo y las redes de este grupo se heredan hacia sus sedes."
                                aria-label="Cascada de branding activa hacia sedes"
                                style={{ display: 'inline-flex', color: 'var(--color-dark-text-tertiary)', cursor: 'help' }}
                              >
                                <Sparkles size={13} />
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Un solo botón: abre la ficha del grupo (vista completa) */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => openFicha(group.primary.id)}
                          className="btn btn-secondary"
                          style={{
                            fontSize: '12px',
                            padding: '8px 16px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-dark-border)',
                            backgroundColor: 'white',
                            color: 'var(--color-dark-text-primary)',
                            cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
                          }}
                        >
                          Ver ficha
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>

              </div>
            );
              })}

              {/* Pagination Controls */}
            {filteredActiveGroups.length > pageSize && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '16px 20px',
                  backgroundColor: 'var(--color-dark-surface)',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-dark-border)',
                  marginTop: '20px'
                }}
              >
                <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
                  Mostrando <strong>{Math.min((currentPage - 1) * pageSize + 1, filteredActiveGroups.length)}</strong> –{' '}
                  <strong>{Math.min(currentPage * pageSize, filteredActiveGroups.length)}</strong> de{' '}
                  <strong>{filteredActiveGroups.length}</strong> grupos unificados
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '6px 14px', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
                  >
                    ◀ Anterior
                  </button>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
                      .map((p, idx, arr) => {
                        const showEllipsisBefore = idx > 0 && p - arr[idx - 1] > 1;
                        return (
                          <React.Fragment key={p}>
                            {showEllipsisBefore && <span style={{ padding: '0 4px', color: 'var(--color-dark-text-tertiary)' }}>…</span>}
                            <button
                              type="button"
                              onClick={() => setCurrentPage(p)}
                              style={{
                                minWidth: '32px',
                                height: '32px',
                                padding: '0 8px',
                                borderRadius: 'var(--radius-md)',
                                border: p === currentPage ? '1.5px solid var(--color-primary)' : '1px solid var(--color-dark-border)',
                                backgroundColor: p === currentPage ? 'rgba(0, 80, 110, 0.1)' : 'var(--color-dark-surface)',
                                color: p === currentPage ? 'var(--color-primary)' : 'var(--color-dark-text-secondary)',
                                fontSize: '12px',
                                fontWeight: p === currentPage ? 700 : 500,
                                cursor: 'pointer'
                              }}
                            >
                              {p}
                            </button>
                          </React.Fragment>
                        );
                      })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="btn btn-secondary"
                    style={{ fontSize: '12px', padding: '6px 14px', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
                  >
                    Siguiente ▶
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    )}

      </>)}

      {fichaGroupId && (
        <EconomicGroupFichaView group={fichaGroup} loading={loading} locations={locations} onBack={closeFicha} onEdit={handleOpenEditModal} />
      )}

      {/* ── MODAL: EDIT ACTIVE ECONOMIC GROUP ── */}
      {editingGroup && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '20px'
          }}
          onClick={handleCloseEditModal}
        >
          <div
            className="panel"
            style={{
              width: '100%',
              maxWidth: '860px',
              maxHeight: '90vh',
              backgroundColor: 'var(--color-dark-surface)',
              border: '1px solid var(--color-dark-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-group-modal-title"
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--color-dark-border)',
                backgroundColor: '#FAF8F5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(0, 80, 110, 0.1)',
                    color: '#00506E',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <Building2 size={20} />
                </div>
                <div>
                  <h2
                    id="edit-group-modal-title"
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      color: 'var(--color-dark-text-primary)',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    Editar fichas del grupo
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        backgroundColor: 'rgba(124, 58, 237, 0.1)',
                        color: '#7c3aed',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)'
                      }}
                    >
                      {editingGroup.members.length} entidades vinculadas
                    </span>
                  </h2>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                    <MapPin size={12} style={{ color: 'var(--color-primary)' }} />
                    <span>{editingGroup.primary.address || 'Sin dirección registrada'}</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCloseEditModal}
                disabled={modalSaving}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-dark-text-tertiary)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Cerrar ventana"
                aria-label="Cerrar ventana"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: Comparison Cards */}
            <div
              style={{
                padding: '20px 24px',
                overflowY: 'auto',
                flex: 1
              }}
            >
              <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-dark-text-secondary)', marginBottom: '14px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Fichas de PlazaDerma que componen este grupo (haz clic para elegir la ficha principal visible en el mapa):
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                  gap: '16px'
                }}
              >
                {editingGroup.members.map(member => {
                  const isPrimary = member.id === editingPrimaryId;
                  const entityType = member.custom_fields?.['entity_type'] || determineEntityType(member);
                  const razonSocial = member.custom_fields?.['Razón Social'] || member.custom_fields?.['Razon Social'] || '';
                  const docNumber = member.custom_fields?.['Documento'] || '';
                  const cmpNumber = member.custom_fields?.['CMP'] || member.custom_fields?.['Colegiatura'] || '';
                  const productsList = member.products || [];
                  const isProdExpanded = modalExpandedProducts[member.id] || false;

                  return (
                    <div
                      key={member.id}
                      onClick={() => setEditingPrimaryId(member.id)}
                      style={{
                        padding: '16px',
                        borderRadius: 'var(--radius-md)',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        border: isPrimary
                          ? '2px solid #00506E'
                          : '1px solid var(--color-dark-border)',
                        backgroundColor: isPrimary
                          ? 'rgba(0, 80, 110, 0.03)'
                          : 'var(--color-dark-surface)',
                        boxShadow: isPrimary
                          ? '0 0 0 3px rgba(0, 80, 110, 0.1)'
                          : 'none',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between'
                      }}
                    >
                      {/* Top Selection Status Badge */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isPrimary ? (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 800,
                                color: '#ffffff',
                                backgroundColor: '#00506E',
                                padding: '3px 10px',
                                borderRadius: 'var(--radius-full)',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              <Star size={11} fill="#ffffff" />
                              FICHA PRINCIPAL (Visible en mapa)
                            </span>
                          ) : (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 600,
                                color: 'var(--color-dark-text-secondary)',
                                backgroundColor: 'rgba(0,0,0,0.04)',
                                padding: '3px 8px',
                                borderRadius: 'var(--radius-full)'
                              }}
                            >
                              ↳ Ficha Secundaria
                            </span>
                          )}
                                  <LocatorChips cf={member.custom_fields} />
                        </div>

                        {/* Radio selection circle */}
                        <div
                          style={{
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            border: isPrimary ? '6px solid #00506E' : '2px solid var(--color-dark-border)',
                            backgroundColor: '#ffffff',
                            transition: 'all 0.15s ease'
                          }}
                        />
                      </div>

                      {/* Member Info */}
                      <div>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}>
                          {member.image_url ? (
                            <img
                              src={member.image_url}
                              alt={member.name}
                              style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: 'var(--radius-sm)',
                                objectFit: 'cover',
                                border: '1px solid var(--color-dark-border)',
                                flexShrink: 0
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: '42px',
                                height: '42px',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: entityType === 'doctor' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(0, 80, 110, 0.1)',
                                color: entityType === 'doctor' ? '#059669' : '#00506E',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0
                              }}
                            >
                              {entityType === 'doctor' ? <Stethoscope size={20} /> : <Building size={20} />}
                            </div>
                          )}

                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 800, fontSize: '13px', color: 'var(--color-dark-text-primary)', lineHeight: 1.3 }}>
                              {member.name}
                              <span
                                style={{
                                  marginLeft: '6px',
                                  fontSize: '10px',
                                  fontWeight: 700,
                                  padding: '1px 6px',
                                  borderRadius: 'var(--radius-full)',
                                  backgroundColor: entityType === 'doctor' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                  color: entityType === 'doctor' ? '#059669' : '#2563eb'
                                }}
                              >
                                {entityType === 'doctor' ? 'Médico' : 'Centro'}
                              </span>
                            </div>
                            {razonSocial && (
                              <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
                                RS: {razonSocial}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Identification Details */}
                        <div style={{ backgroundColor: 'var(--color-dark-bg)', padding: '8px 10px', borderRadius: 'var(--radius-sm)', fontSize: '11px', display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '10px' }}>
                          {docNumber && (
                            <div>
                              <span style={{ color: 'var(--color-dark-text-tertiary)' }}>RUC / Doc:</span>{' '}
                              <strong>{docNumber}</strong>
                            </div>
                          )}
                          {cmpNumber && (
                            <div>
                              <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Colegiatura:</span>{' '}
                              <strong>CMP {cmpNumber}</strong>
                            </div>
                          )}
                          <div style={{ color: 'var(--color-dark-text-secondary)', wordBreak: 'break-word' }}>
                            <span style={{ color: 'var(--color-dark-text-tertiary)' }}>Dirección:</span>{' '}
                            {member.address || '—'}
                          </div>
                        </div>
                      </div>

                      {/* Products Accordion & Direct Edit Link */}
                      <div style={{ paddingTop: '8px', borderTop: '1px solid var(--color-dark-border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px', fontSize: '12px' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggleModalProducts(member.id);
                          }}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Package size={13} />
                          {productsList.length} producto(s) aportado(s)
                          {isProdExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>

                        <Link
                          to={`/dashboard/locations/${member.id}/edit`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            fontSize: '11px',
                            color: 'var(--color-dark-text-tertiary)',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px'
                          }}
                          title="Abrir formulario para editar foto, teléfono o datos de esta ficha"
                        >
                          Editar ficha ↗
                        </Link>
                      </div>

                      {isProdExpanded && (
                        <div
                          style={{
                            marginTop: '8px',
                            padding: '8px',
                            backgroundColor: 'var(--color-dark-bg)',
                            borderRadius: 'var(--radius-sm)',
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '4px',
                            maxHeight: '100px',
                            overflowY: 'auto'
                          }}
                        >
                          {productsList.length > 0 ? (
                            productsList.map((p, idx) => (
                              <span
                                key={idx}
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 6px',
                                  backgroundColor: 'var(--color-dark-surface)',
                                  border: '1px solid var(--color-dark-border)',
                                  borderRadius: 'var(--radius-sm)',
                                  color: 'var(--color-dark-text-primary)'
                                }}
                              >
                                {p.name}
                              </span>
                            ))
                          ) : (
                            <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                              Sin productos específicos
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--color-dark-border)',
                backgroundColor: '#FAF8F5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              {/* Left: Chosen summary & Dissolve option */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
                  Visible en el mapa como:{' '}
                  <strong style={{ color: '#00506E' }}>
                    {editingGroup.members.find(m => m.id === editingPrimaryId)?.name || editingGroup.primary.name}
                  </strong>
                </div>

                <button
                  type="button"
                  onClick={handleModalDissolve}
                  disabled={modalSaving}
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#b91c1c',
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0
                  }}
                  title="Separar este grupo económico para que sus ubicaciones vuelvan a ser independientes"
                >
                  Desunir / Separar Grupo
                </button>
              </div>

              {/* Right: Actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={handleCloseEditModal}
                  disabled={modalSaving}
                  className="btn btn-secondary"
                  style={{ fontSize: '13px', padding: '8px 16px' }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleSaveEditGroup}
                  disabled={modalSaving}
                  className="btn btn-primary"
                  style={{
                    fontSize: '13px',
                    padding: '8px 20px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  {modalSaving ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={14} /> Guardar Cambios
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── MODAL: CREATE NEW ECONOMIC GROUP ── */}
      {isCreateModalOpen && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1200,
            padding: '20px'
          }}
          onClick={() => {
            if (!createSaving) setIsCreateModalOpen(false);
          }}
        >
          <div
            className="panel"
            style={{
              width: '100%',
              maxWidth: '960px',
              height: '85vh',
              maxHeight: '750px',
              backgroundColor: 'var(--color-dark-surface)',
              border: '1px solid var(--color-dark-border)',
              borderRadius: 'var(--radius-lg)',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden'
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-group-modal-title"
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '18px 24px',
                borderBottom: '1px solid var(--color-dark-border)',
                backgroundColor: '#FAF8F5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '12px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: 'var(--radius-md)',
                    backgroundColor: 'rgba(0, 80, 110, 0.1)',
                    color: '#00506E',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0
                  }}
                >
                  <Building2 size={20} />
                </div>
                <div>
                  <h2
                    id="create-group-modal-title"
                    style={{
                      fontSize: '18px',
                      fontWeight: 800,
                      color: 'var(--color-dark-text-primary)',
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    Crear Nuevo Grupo Económico
                  </h2>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!createSaving) setIsCreateModalOpen(false);
                }}
                disabled={createSaving}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--color-dark-text-tertiary)',
                  cursor: 'pointer',
                  padding: '6px',
                  borderRadius: 'var(--radius-full)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
                title="Cerrar ventana"
                aria-label="Cerrar ventana"
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: 2 Columns Responsive */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
                flex: 1,
                minHeight: 0,
                overflowY: 'auto'
              }}
            >
              {/* Left Column: Search & Available Entities */}
              <div
                style={{
                  borderRight: '1px solid var(--color-dark-border)',
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: '360px',
                  backgroundColor: 'var(--color-dark-surface)'
                }}
              >
                <div style={{ padding: '16px 20px 12px 20px', borderBottom: '1px solid var(--color-dark-border)' }}>
                  <div style={{ position: 'relative' }}>
                    <Search
                      size={15}
                      style={{
                        position: 'absolute',
                        left: '12px',
                        top: '50%',
                        transform: 'translateY(-50%)',
                        color: 'var(--color-dark-text-tertiary)'
                      }}
                    />
                    <input
                      type="text"
                      value={createSearch}
                      onChange={(e) => setCreateSearch(e.target.value)}
                      placeholder="Buscar por clínica, doctor, dirección o RUC..."
                      className="form-control"
                      style={{
                        paddingLeft: '36px',
                        height: '38px',
                        fontSize: '13px',
                        width: '100%'
                      }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px', fontSize: '11px', color: 'var(--color-dark-text-tertiary)' }}>
                    <span>Mostrando {createFilteredLocations.length} ubicaciones</span>
                    <span>{createSelectedEntities.length} seleccionadas</span>
                  </div>
                </div>

                {/* Locations Scroll List */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  {createFilteredLocations.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--color-dark-text-secondary)', fontSize: '13px' }}>
                      No se encontraron ubicaciones que coincidan con la búsqueda.
                    </div>
                  ) : (
                    createFilteredLocations.map((loc) => {
                      const existingGroupName = groupedEntityInfoMap.get(loc.id);
                      const isAlreadyGrouped = Boolean(existingGroupName);
                      const isSelected = createSelectedEntities.some((e) => e.id === loc.id);

                      return (
                        <div
                          key={loc.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 18px',
                            borderBottom: '1px solid var(--color-dark-border)',
                            backgroundColor: isSelected ? 'rgba(0, 80, 110, 0.04)' : 'transparent',
                            opacity: isAlreadyGrouped ? 0.65 : 1,
                            transition: 'background-color 0.15s ease'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', minWidth: 0, flex: 1, paddingRight: '12px' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                backgroundColor: isSelected ? 'rgba(0, 80, 110, 0.1)' : 'rgba(239, 68, 68, 0.08)',
                                color: isSelected ? '#00506E' : '#ef4444',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                marginTop: '2px'
                              }}
                            >
                              <MapPin size={16} />
                            </div>

                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark-text-primary)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                                {loc.name}
                              </div>
                              <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
                                {loc.address || 'Sin dirección registrada'}
                              </div>

                              {isAlreadyGrouped && (
                                <div
                                  style={{
                                    marginTop: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '10px',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '4px',
                                    backgroundColor: 'rgba(245, 158, 11, 0.12)',
                                    color: '#b45309'
                                  }}
                                  title={`Esta ficha ya está unificada en el grupo "${existingGroupName}"`}
                                >
                                  <AlertCircle size={10} />
                                  Ya en grupo: {existingGroupName}
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Action Button */}
                          <div>
                            {isAlreadyGrouped ? (
                              <button
                                type="button"
                                disabled
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  border: '1px solid var(--color-dark-border)',
                                  backgroundColor: 'rgba(0,0,0,0.04)',
                                  color: 'var(--color-dark-text-tertiary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'not-allowed'
                                }}
                                title={`No disponible: Ya forma parte del grupo "${existingGroupName}"`}
                              >
                                <Plus size={16} />
                              </button>
                            ) : isSelected ? (
                              <button
                                type="button"
                                onClick={() => handleToggleSelectForNewGroup(loc)}
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  border: 'none',
                                  backgroundColor: '#16a34a',
                                  color: '#ffffff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  boxShadow: '0 2px 5px rgba(22, 163, 74, 0.3)',
                                  transition: 'all 0.15s ease'
                                }}
                                title="Ficha seleccionada (clic para deseleccionar)"
                              >
                                <Check size={16} />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => handleToggleSelectForNewGroup(loc)}
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: '50%',
                                  border: '1px solid var(--color-dark-border)',
                                  backgroundColor: '#ffffff',
                                  color: 'var(--color-dark-text-secondary)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  cursor: 'pointer',
                                  transition: 'all 0.15s ease'
                                }}
                                title="Agregar al grupo"
                              >
                                <Plus size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Selected Entities & Ficha Principal Chooser */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  minHeight: 0,
                  backgroundColor: '#FAF8F5'
                }}
              >
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-dark-border)', backgroundColor: '#FAF8F5' }}>
                  <div style={{ fontWeight: 800, fontSize: '14px', color: 'var(--color-dark-text-primary)' }}>
                    Fichas Vinculadas ({createSelectedEntities.length})
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
                  {createSelectedEntities.length === 0 ? (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '40px 16px',
                        color: 'var(--color-dark-text-tertiary)',
                        border: '2px dashed var(--color-dark-border)',
                        borderRadius: 'var(--radius-md)',
                        marginTop: '20px'
                      }}
                    >
                      <Building2 size={32} style={{ margin: '0 auto 10px auto', opacity: 0.4 }} />
                      <div style={{ fontWeight: 600, fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
                        Ninguna ficha seleccionada
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {createSelectedEntities.map((item, idx) => {
                        const isPrimary = item.id === createPrimaryId;
                        const initial = (item.name || 'C').trim().charAt(0).toUpperCase();

                        // Soft avatar colors palette
                        const colors = [
                          { bg: '#fee2e2', text: '#b91c1c' },
                          { bg: '#fef3c7', text: '#b45309' },
                          { bg: '#e0f2fe', text: '#0369a1' },
                          { bg: '#f3e8ff', text: '#7e22ce' },
                          { bg: '#dcfce7', text: '#15803d' },
                          { bg: '#ffedd5', text: '#c2410c' }
                        ];
                        const color = colors[idx % colors.length];

                        return (
                          <div
                            key={item.id}
                            onClick={() => setCreatePrimaryId(item.id)}
                            style={{
                              padding: '12px 14px',
                              borderRadius: 'var(--radius-md)',
                              backgroundColor: isPrimary ? '#ffffff' : '#ffffff',
                              border: isPrimary ? '2px solid #00506E' : '1px solid var(--color-dark-border)',
                              boxShadow: isPrimary ? '0 0 0 3px rgba(0, 80, 110, 0.1)' : '0 1px 3px rgba(0,0,0,0.03)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '12px',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
                              <div
                                style={{
                                  width: '32px',
                                  height: '32px',
                                  borderRadius: 'var(--radius-sm)',
                                  backgroundColor: color.bg,
                                  color: color.text,
                                  fontWeight: 800,
                                  fontSize: '14px',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexShrink: 0
                                }}
                              >
                                {initial}
                              </div>

                              <div style={{ minWidth: 0, flex: 1 }}>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark-text-primary)', lineHeight: 1.3, wordBreak: 'break-word' }}>
                                  {item.name}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px', wordBreak: 'break-word' }}>
                                  {item.address || 'Sin dirección registrada'}
                                </div>
                                <div style={{ marginTop: '4px' }}>
                                  {isPrimary ? (
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        fontWeight: 800,
                                        backgroundColor: '#00506E',
                                        color: '#ffffff',
                                        padding: '2px 8px',
                                        borderRadius: 'var(--radius-full)',
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '3px'
                                      }}
                                    >
                                      <Star size={10} fill="#ffffff" /> Ficha Principal (Visible)
                                    </span>
                                  ) : (
                                    <span
                                      style={{
                                        fontSize: '10px',
                                        color: 'var(--color-dark-text-tertiary)',
                                        backgroundColor: 'rgba(0,0,0,0.04)',
                                        padding: '2px 6px',
                                        borderRadius: 'var(--radius-full)'
                                      }}
                                    >
                                      ↳ Ficha Secundaria
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRemoveFromNewGroup(item.id);
                              }}
                              style={{
                                background: 'none',
                                border: 'none',
                                color: '#9ca3af',
                                cursor: 'pointer',
                                padding: '6px',
                                borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.15s ease'
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#ef4444';
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#9ca3af';
                              }}
                              title="Quitar ficha del grupo"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '16px 24px',
                borderTop: '1px solid var(--color-dark-border)',
                backgroundColor: '#FAF8F5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '12px'
              }}
            >
              {/* Left: Summary */}
              <div>
                {createSelectedEntities.length < 2 ? (
                  <span style={{ fontSize: '13px', color: '#b45309', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                    <AlertCircle size={14} />
                    Selecciona al menos 2 fichas para crear un grupo económico.
                  </span>
                ) : (
                  <span style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)' }}>
                    Ficha visible en mapa:{' '}
                    <strong style={{ color: '#00506E' }}>
                      {createSelectedEntities.find((e) => e.id === createPrimaryId)?.name || createSelectedEntities[0]?.name}
                    </strong>{' '}
                    ({createSelectedEntities.length} entidades vinculadas)
                  </span>
                )}
              </div>

              {/* Right: Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  disabled={createSaving}
                  className="btn btn-secondary"
                  style={{ fontSize: '13px', padding: '8px 16px' }}
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={handleSaveNewManualGroup}
                  disabled={createSelectedEntities.length < 2 || createSaving}
                  className="btn btn-primary"
                  style={{
                    fontSize: '13px',
                    padding: '8px 22px',
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: (createSelectedEntities.length < 2 || createSaving) ? 0.6 : 1,
                    cursor: (createSelectedEntities.length < 2 || createSaving) ? 'not-allowed' : 'pointer'
                  }}
                >
                  {createSaving ? (
                    <>
                      <RefreshCw size={14} className="animate-spin" /> Guardando...
                    </>
                  ) : (
                    <>
                      <Link2 size={14} /> Guardar Vínculo
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Batch Processing Progress Modal Overlay */}
      {batchProgress && batchProgress.active && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
            backdropFilter: 'blur(3px)'
          }}
        >
          <div
            style={{
              backgroundColor: '#ffffff',
              borderRadius: 'var(--radius-lg)',
              padding: '28px 32px',
              maxWidth: '460px',
              width: '90%',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)',
              textAlign: 'center'
            }}
          >
            <RefreshCw size={36} className="animate-spin" style={{ color: '#00506E', margin: '0 auto 16px auto' }} />
            <h3 style={{ fontSize: '18px', fontWeight: 800, color: 'var(--color-dark-text-primary)', margin: '0 0 8px 0' }}>
              Procesando en Lote...
            </h3>
            <p style={{ fontSize: '13px', color: 'var(--color-dark-text-secondary)', margin: '0 0 16px 0' }}>
              {batchProgress.currentName}
            </p>
            {/* Progress Bar */}
            <div style={{ width: '100%', height: '8px', backgroundColor: 'var(--color-dark-bg)', borderRadius: '4px', overflow: 'hidden', marginBottom: '8px' }}>
              <div
                style={{
                  width: `${batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0}%`,
                  height: '100%',
                  backgroundColor: '#00506E',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-dark-text-tertiary)' }}>
              {batchProgress.current} de {batchProgress.total} completados ({Math.round(batchProgress.total > 0 ? (batchProgress.current / batchProgress.total) * 100 : 0)}%)
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
