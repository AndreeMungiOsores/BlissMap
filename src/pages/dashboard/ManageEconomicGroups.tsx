import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
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
  Package,
  ArrowLeft,
  Search,
  RefreshCw,
  Stethoscope,
  Building,
  Pencil,
  X,
  Plus,
  Trash2,
  Check,
  ShieldCheck,
  Sparkles,
  Receipt,
  Store,
  Users,
  Filter
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
  areDoctorsConflicting,
  getDoctorTokens,
  normalizePersonTokens,
  evaluatePersonMatch,
  normalizeAddress
} from '../../services/groupService';
import { supabase } from '../../supabaseClient';
import {
  fetchLocatorLocations,
  locationsMemoryCache
} from '../../services/locationService';
import { determineEntityType } from '../../utils/entityUtils';

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

export const ManageEconomicGroups: React.FC = () => {
  const { activeLocator, locators } = useOutletContext<OutletContextType>();

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
  const [selectedPrimaries, setSelectedPrimaries] = useState<Record<string, string>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
    const [cardActiveTab, setCardActiveTab] = useState<Record<string, 'billing' | 'sedes' | 'staff' | 'products'>>({});
  const [expandedVehicleProducts, setExpandedVehicleProducts] = useState<Record<string, boolean>>({});
  const [expandedActiveCards, setExpandedActiveCards] = useState<Record<string, boolean>>({});

  const handleToggleActiveCard = (groupId: string) => {
    setExpandedActiveCards(prev => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  const getCardTab = (groupId: string): 'billing' | 'sedes' | 'staff' | 'products' => {
    return cardActiveTab[groupId] || 'billing';
  };

  const setCardTab = (groupId: string, tab: 'billing' | 'sedes' | 'staff' | 'products') => {
    setCardActiveTab(prev => ({ ...prev, [groupId]: tab }));
  };

  const toggleVehicleProducts = (vehicleKey: string) => {
    setExpandedVehicleProducts(prev => ({ ...prev, [vehicleKey]: !prev[vehicleKey] }));
  };
    const [expandedSuggestions, setExpandedSuggestions] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
  const loadData = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setNotification(null);
    if (forceRefresh) {
      clearGeMatchCache();
    }
    try {
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
        data = loadedArrays.flat();
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

  // Auto-dissolve specific legacy false positive groups (authorized cleanup - runs at most once)
  const legacyCleanupRanRef = useRef(false);
  useEffect(() => {
    if (loading || !activeLocator || legacyCleanupRanRef.current) return;
    const targets = locations.filter(
      l => (l.id === 'b2c-cmp-026094' || l.id === 'b2c-cmp-065743') &&
           l.grupo_economico_ids &&
           l.grupo_economico_ids.length > 0
    );

    if (targets.length > 0) {
      legacyCleanupRanRef.current = true;
      const dissolveTargets = async () => {
        try {
          for (const target of targets) {
            await dissolveEconomicGroup(target.id);
          }
          locationsMemoryCache.clear();
          clearGeMatchCache();
          await loadData(true);
        } catch (err: any) {
          console.error('Error auto-dissolving legacy false positives:', err);
        }
      };
      dissolveTargets();
    }
  }, [locations, loading, activeLocator, loadData]);

  // One-time in-browser sanitization of contaminated clusters using authenticated user session
  const dbSanitizedRef = useRef(false);
  useEffect(() => {
    if (loading || locations.length === 0 || dbSanitizedRef.current) return;
    dbSanitizedRef.current = true;

    // Detect clusters with conflicting doctors or misattributed GE tags
    const contaminated = locations.filter(l => {
      if (l.grupo_economico_ids && l.grupo_economico_ids.length > 1) {
        const members = locations.filter(m => l.grupo_economico_ids!.includes(m.id));
        if (members.some(m => areDoctorsConflicting(l, m))) return true;
      }
      // Detect conflict between GE Propietario and Location Doctor
      const storedProp = l.custom_fields?.['crb7e_propietarioge'];
      if (storedProp) {
        const docToks = getDoctorTokens(l);
        const propToks = normalizePersonTokens(storedProp);
        if (docToks.length >= 2 && propToks.length >= 2) {
          const res = evaluatePersonMatch(docToks, propToks);
          if (res.isConflict || !res.isMatch) return true;
        }
      }
      // Detect Luvak Derm SAC mistakenly bound to GE-0158 or with Jannell Obregon
      const ruc = l.custom_fields?.['Documento'] || l.custom_fields?.['RUC'];
      if (ruc === '20614466180' && (l.custom_fields?.['crb7e_idge'] !== 'GE-0420' || l.custom_fields?.['Médico']?.includes('Jannell'))) return true;
      // Detect ADVANCED DERMACLINIC S.A.C. (RUC 20612424331) mistakenly bound to GE-0124
      if (ruc === '20612424331' && l.custom_fields?.['crb7e_idge'] !== 'GE-0403') return true;
      // Detect Clínica Del Pilar contaminated with Dermaclinic in grupo_economico_ids
      if (l.id === 'erp-doc-blissfarma-20602477925-cl-nica-del-pilar-ayacucho' && l.grupo_economico_ids?.some(id => id.includes('dermaclinic') || id === '2184787d-1b04-4e9d-aebf-41e7b6f3f7be')) return true;
      // Detect Consultorio: Dra. Blanca Alva (RUC 20600905512) mistakenly bound to GE-0022 instead of GE-0103
      if (ruc === '20600905512' && l.custom_fields?.['crb7e_idge'] !== 'GE-0103') return true;
      // Detect Dermocentro La Piel (RUC 20614171775) mistakenly bound to GE-0334 instead of GE-0405
      if (ruc === '20614171775' && (l.custom_fields?.['crb7e_idge'] !== 'GE-0405' || l.custom_fields?.['Médico']?.includes('Garcia Saravia'))) return true;
      // Detect Servicios Medicos & Dermatologos Asociados (RUC 20549024760) mistakenly bound to GE-0369
      if (ruc === '20549024760' && l.custom_fields?.['crb7e_idge'] === 'GE-0369') return true;
      // Detect Dermia Risoul (RUC 20611868384) mistakenly bound to GE-0113 instead of GE-0274
      if (ruc === '20611868384' && l.custom_fields?.['crb7e_idge'] !== 'GE-0274') return true;
      // Detect Dermavita contaminated with Dermastage (Dr. Oscar Pereda)
      if (l.id === 'b2c-center-derma-vital-sociedad-anonima-cerrada' && (l.grupo_economico_ids?.some(id => id.includes('dermastage')) || l.custom_fields?.['Médicos']?.includes('Pereda'))) return true;
      // Detect Skin Center with merged Shinzato (GE-0008) and Laure (GE-0497)
      if (l.name === 'Skin Center') {
        if (ruc === '20615202666' && (l.grupo_economico_ids?.some(id => id.includes('20605935797') || id === 'e2dc11ea-0abd-4478-a41a-988b63c9fc56') || l.custom_fields?.['crb7e_idge'] !== 'GE-0497')) return true;
        if (ruc === '20605935797' && (l.grupo_economico_ids?.some(id => id.includes('20615202666') || id === 'b66f4302-04ec-4e1a-a315-614cbd62d8a9') || l.custom_fields?.['crb7e_idge'] !== 'GE-0008')) return true;
      }
      // Detect Dra. Violeta Muñoz contaminated with Dra. Tello / Apagüeño
      if (l.id === 'erp-doc-skinbliss-20615634051-e-v-beauty-skin-med-s-a-c-s' && l.grupo_economico_ids?.some(id => id.includes('apag-e-o') || id.includes('20609870835'))) return true;
      // Detect alien b2c-cmp- doctor IDs injected into grupo_economico_ids
      if (l.grupo_economico_ids?.some(id => id.startsWith('b2c-cmp-'))) {
        const ownCmp = (l.custom_fields?.['Colegiatura'] || l.custom_fields?.['CMP'] || (l.id.startsWith('b2c-cmp-') ? l.id.replace('b2c-cmp-', '') : '')).replace(/\D/g, '').replace(/^0+/, '');
        const hasAlien = l.grupo_economico_ids.some(id => {
          if (!id.startsWith('b2c-cmp-')) return false;
          const injectedCmp = id.replace('b2c-cmp-', '').replace(/^0+/, '');
          return !ownCmp || injectedCmp !== ownCmp;
        });
        if (hasAlien) return true;
      }
      // Detect Dermabeauty Center E.I.R.L. with duplicate RUC
      if (l.id === 'b2c-center-dermabeauty-center-e-i-r-l' && l.custom_fields?.['Documento'] !== '20612515884') return true;
      // Ensure Clínica Cderma affiliates Dra. Karel Rios Paredes (CMP 050850) and Dra. Jaqueline Calizaya (CMP 039704)
      if (l.name.toLowerCase().includes('cderma')) {
        const aff = l.custom_fields?.['medicos_afiliados_ids'] || '';
        if (!aff.includes('050850') || l.custom_fields?.['crb7e_idge'] === 'GE-0284') return true;
      }
      // Detect centers with empty Documento where a matching Razón Social has a known valid RUC
      const curDoc = (l.custom_fields?.['Documento'] || l.custom_fields?.['RUC'] || '').replace(/\D/g, '');
      const curRs = l.custom_fields?.['Razón Social'] || l.custom_fields?.['Razon Social'];
      if (!curDoc && curRs) {
        const match = locations.find(other => {
          const oDoc = (other.custom_fields?.['Documento'] || other.custom_fields?.['RUC'] || '').replace(/\D/g, '');
          const oRs = other.custom_fields?.['Razón Social'] || other.custom_fields?.['Razon Social'];
          return oDoc && (oDoc.length === 11 || oDoc.length === 8) && oRs && normalizeAddress(oRs) === normalizeAddress(curRs);
        });
        if (match) return true;
      }
      return false;
    });

    if (contaminated.length > 0) {
      (async () => {
        try {
          let updatedAny = false;
          for (const target of contaminated) {
            const ruc = target.custom_fields?.['Documento'] || target.custom_fields?.['RUC'];
            const newFields = { ...(target.custom_fields || {}) };

            // Specifically sanitize Luvak Derm SAC (RUC 20614466180) to GE-0420
            if (ruc === '20614466180') {
              newFields['crb7e_idge'] = 'GE-0420';
              newFields['crb7e_nombrege'] = 'Luvak Derm';
              newFields['crb7e_propietarioge'] = 'Katherine Noelia Obregon Candela';
              newFields['crb7e_rol'] = 'Dermatologo';
              newFields['Médico'] = 'Obregon Candela, Katherine Noelia';
              newFields['Médicos'] = 'Obregon Candela, Katherine Noelia';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields, grupo_economico_ids: null })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically sanitize ADVANCED DERMACLINIC S.A.C. (RUC 20612424331) to GE-0403 (Dora Lucia Vicuña Rios)
            if (ruc === '20612424331') {
              newFields['crb7e_idge'] = 'GE-0403';
              newFields['crb7e_nombrege'] = 'Dermaclinic - Vicuña';
              newFields['crb7e_propietarioge'] = 'Dora Lucia Vicuña Rios';
              newFields['crb7e_rol'] = 'Dermatologo';
              newFields['Médico'] = 'Vicuña Rios, Dora Lucia';
              newFields['Colegiatura'] = 'CMP 036951';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields, grupo_economico_ids: null })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically clean Clínica Del Pilar from foreign Dermaclinic members
            if (target.id === 'erp-doc-blissfarma-20602477925-cl-nica-del-pilar-ayacucho') {
              const cleanIds = (target.grupo_economico_ids || []).filter(
                id => !id.includes('dermaclinic') && id !== '2184787d-1b04-4e9d-aebf-41e7b6f3f7be'
              );
              await supabase
                .from('bm_locations')
                .update({
                  grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                  custom_fields: target.custom_fields
                })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically sanitize Consultorio: Dra. Blanca Alva (RUC 20600905512) to GE-0103
            if (ruc === '20600905512') {
              newFields['crb7e_idge'] = 'GE-0103';
              newFields['crb7e_nombrege'] = 'Ile De Beaute';
              newFields['crb7e_propietarioge'] = 'Blanca Luz Alva Huapaya';
              newFields['crb7e_rol'] = 'Dermatologo';
              newFields['Médico'] = 'Alva Huapaya, Blanca Luz';
              newFields['Médicos'] = 'Alva Huapaya, Blanca Luz';
              newFields['Colegiatura'] = 'CMP 057982';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically sanitize Dermocentro La Piel (RUC 20614171775) to GE-0405 (Teddy Jordan Nuñez Contreras)
            if (ruc === '20614171775') {
              newFields['crb7e_idge'] = 'GE-0405';
              newFields['crb7e_nombrege'] = 'Dermocentro La Piel';
              newFields['crb7e_propietarioge'] = 'Teddy Jordan Nuñez Contreras';
              newFields['crb7e_rol'] = 'Dermatologo';
              newFields['Médico'] = 'Nuñez Contreras, Teddy Jordan';
              newFields['Médicos'] = 'Nuñez Contreras, Teddy Jordan';
              newFields['Colegiatura'] = 'CMP 071064';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically strip false GE-0369 from Servicios Medicos & Dermatologos Asociados (RUC 20549024760, Dr. Héctor Cáceres Ríos)
            if (ruc === '20549024760') {
              delete newFields['crb7e_idge'];
              delete newFields['crb7e_nombrege'];
              delete newFields['crb7e_propietarioge'];
              delete newFields['crb7e_rol'];
              newFields['Médico'] = 'Caceres Rios, Hector Wilfredo';
              newFields['Médicos'] = 'Caceres Rios, Hector Wilfredo';
              newFields['Colegiatura'] = 'CMP 017740';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically sanitize Dermia Risoul (RUC 20611868384) to GE-0274 (Dra. Jenny Janeth Zapana Alarcon)
            if (ruc === '20611868384') {
              newFields['crb7e_idge'] = 'GE-0274';
              newFields['crb7e_nombrege'] = 'Dermia - Risoul';
              newFields['crb7e_propietarioge'] = 'Jenny Janeth Zapana Alarcon';
              newFields['crb7e_rol'] = 'Estetico';
              newFields['Médico'] = 'Zapana Alarcon, Jenny Janeth';
              newFields['Colegiatura'] = 'CMP 038212';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically separate Dermavita (Dra. Jacqueline Arce) from Dermastage (Dr. Oscar Pereda)
            if (target.id === 'b2c-center-derma-vital-sociedad-anonima-cerrada') {
              const cleanIds = (target.grupo_economico_ids || []).filter(
                id => !id.includes('dermastage')
              );
              newFields['Médico'] = 'Arce Izaguirre, Jacqueline';
              newFields['Médicos'] = 'Arce Izaguirre, Jacqueline';
              newFields['Colegiatura'] = 'CMP 058064';
              await supabase
                .from('bm_locations')
                .update({
                  grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                  custom_fields: newFields
                })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically separate Skin Center between Dr. Shinzato (GE-0008) and Dra. Laure (GE-0497)
            if (target.name === 'Skin Center') {
              if (ruc === '20615202666') {
                newFields['crb7e_idge'] = 'GE-0497';
                newFields['crb7e_nombrege'] = 'Tatiana Melissa Laure Velasquez';
                newFields['crb7e_propietarioge'] = 'Tatiana Melissa Laure Velasquez';
                newFields['crb7e_rol'] = 'Estetico';
                newFields['Médico'] = 'Laure Velasquez, Tatiana Melissa';
                newFields['Colegiatura'] = 'CMP 095949';
                const cleanIds = (target.grupo_economico_ids || []).filter(
                  id => !id.includes('20605935797') && id !== 'e2dc11ea-0abd-4478-a41a-988b63c9fc56'
                );
                await supabase
                  .from('bm_locations')
                  .update({
                    grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                    custom_fields: newFields
                  })
                  .eq('id', target.id);
                updatedAny = true;
                continue;
              } else if (ruc === '20605935797') {
                newFields['crb7e_idge'] = 'GE-0008';
                newFields['crb7e_nombrege'] = 'Shinzato';
                newFields['crb7e_propietarioge'] = 'Alberto Carlos Shinzato Uemura';
                newFields['crb7e_rol'] = 'Dermatologo';
                newFields['Médico'] = 'Shinzato Uemura, Alberto Carlos';
                newFields['Colegiatura'] = 'CMP 066953';
                const cleanIds = (target.grupo_economico_ids || []).filter(
                  id => !id.includes('20615202666') && id !== 'b66f4302-04ec-4e1a-a315-614cbd62d8a9'
                );
                await supabase
                  .from('bm_locations')
                  .update({
                    grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                    custom_fields: newFields
                  })
                  .eq('id', target.id);
                updatedAny = true;
                continue;
              }
            }

            // Specifically separate Consultorio: Dra. Violeta Muñoz from Dra. Tello / Apagüeño
            if (target.id === 'erp-doc-skinbliss-20615634051-e-v-beauty-skin-med-s-a-c-s') {
              const cleanIds = (target.grupo_economico_ids || []).filter(
                id => !id.includes('20609870835') && !id.includes('apag-e-o')
              );
              await supabase
                .from('bm_locations')
                .update({
                  grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                  custom_fields: target.custom_fields
                })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Specifically purge alien b2c-cmp- doctor IDs from grupo_economico_ids
            if (target.grupo_economico_ids?.some(id => id.startsWith('b2c-cmp-'))) {
              const ownCmp = (target.custom_fields?.['Colegiatura'] || target.custom_fields?.['CMP'] || (target.id.startsWith('b2c-cmp-') ? target.id.replace('b2c-cmp-', '') : '')).replace(/\D/g, '').replace(/^0+/, '');
              const cleanIds = target.grupo_economico_ids.filter(id => {
                if (!id.startsWith('b2c-cmp-')) return true;
                const injectedCmp = id.replace('b2c-cmp-', '').replace(/^0+/, '');
                return ownCmp && injectedCmp === ownCmp;
              });

              if (cleanIds.length !== target.grupo_economico_ids.length) {
                await supabase
                  .from('bm_locations')
                  .update({
                    grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                    custom_fields: target.custom_fields
                  })
                  .eq('id', target.id);
                updatedAny = true;
                continue;
              }
            }

            // Specifically affiliate Dra. Karel Ríos (CMP 050850) and Dra. Jaqueline Calizaya (CMP 039704) to Clínica Cderma, and clear false GE-0284
            if (target.name.toLowerCase().includes('cderma')) {
              let cdermaChanged = false;
              if (!target.custom_fields?.['medicos_afiliados_ids']?.includes('050850')) {
                newFields['medicos_afiliados_ids'] = JSON.stringify(['039704', '050850']);
                newFields['Médicos'] = 'Calizaya Quea De Contreras, Jaqueline Ymira, Rios Paredes, Karel';
                cdermaChanged = true;
              }
              if (newFields['crb7e_idge'] === 'GE-0284') {
                delete newFields['crb7e_idge'];
                delete newFields['crb7e_nombrege'];
                delete newFields['crb7e_propietarioge'];
                delete newFields['crb7e_rol'];
                cdermaChanged = true;
              }
              if (cdermaChanged) {
                await supabase
                  .from('bm_locations')
                  .update({ custom_fields: newFields })
                  .eq('id', target.id);
                updatedAny = true;
                continue;
              }
            }

            // Specifically sanitize Dermabeauty Center E.I.R.L. to its proper RUC 20612515884
            if (target.id === 'b2c-center-dermabeauty-center-e-i-r-l') {
              newFields['Documento'] = '20612515884';
              newFields['Razón Social'] = 'DERMABEAUTY CENTER E.I.R.L.';
              newFields['Razon Social'] = 'DERMABEAUTY CENTER E.I.R.L.';
              newFields['Nombre Comercial'] = 'Dermabeauty Center';
              await supabase
                .from('bm_locations')
                .update({ custom_fields: newFields })
                .eq('id', target.id);
              updatedAny = true;
              continue;
            }

            // Inherit valid RUC if target has empty Documento but has a known matching Razón Social
            if (!ruc && (newFields['Razón Social'] || newFields['Razon Social'])) {
              const rs = newFields['Razón Social'] || newFields['Razon Social'];
              const match = locations.find(other => {
                const oDoc = (other.custom_fields?.['Documento'] || other.custom_fields?.['RUC'] || '').replace(/\D/g, '');
                const oRs = other.custom_fields?.['Razón Social'] || other.custom_fields?.['Razon Social'];
                return oDoc && (oDoc.length === 11 || oDoc.length === 8) && oRs && normalizeAddress(oRs) === normalizeAddress(rs);
              });
              if (match) {
                const oDoc = (match.custom_fields?.['Documento'] || match.custom_fields?.['RUC'] || '').replace(/\D/g, '');
                newFields['Documento'] = oDoc;
              }
            }

            const cleanMembers = target.grupo_economico_ids
              ? locations.filter(m => target.grupo_economico_ids!.includes(m.id) && !areDoctorsConflicting(target, m))
              : [];
            const cleanIds = cleanMembers.map(m => m.id);
            const storedProp = newFields['crb7e_propietarioge'];
            if (storedProp) {
              const docToks = getDoctorTokens(target);
              const propToks = normalizePersonTokens(storedProp);
              if (docToks.length >= 2 && propToks.length >= 2) {
                const res = evaluatePersonMatch(docToks, propToks);
                if (res.isConflict || !res.isMatch) {
                  delete newFields['crb7e_idge'];
                  delete newFields['crb7e_nombrege'];
                  delete newFields['crb7e_propietarioge'];
                  delete newFields['crb7e_rol'];
                }
              }
            }

            await supabase
              .from('bm_locations')
              .update({
                grupo_economico_ids: cleanIds.length > 1 ? cleanIds : null,
                custom_fields: newFields
              })
              .eq('id', target.id);
            updatedAny = true;
          }

          if (updatedAny) {
            locationsMemoryCache.clear();
            clearGeMatchCache();
            await loadData(true);
          }
        } catch (err) {
          console.warn('Notice during automatic DB sanitization:', err);
        }
      })();
    }
  }, [loading, locations, loadData]);



  // Derived: Suggested groups
  const suggestedGroups = useMemo(() => {
    const raw = detectPossibleGroups(locations);
    return raw.filter(g => !ignoredGroupKeys.has([...g.ids].sort().join('|')));
  }, [locations, ignoredGroupKeys]);

  // Derived: Active unified groups
  const activeGroups = useMemo(() => {
    return getActiveGroups(locations);
  }, [locations]);

  // Official suggestions count
  const officialSuggestions = useMemo(() => {
    return suggestedGroups.filter(g => Boolean(g.officialGe));
  }, [suggestedGroups]);

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

  const handleUnify = async (group: SuggestedGroup) => {
    const targetLocatorId = activeLocator?.id || '4c30e857-f13f-42c5-adb3-a880dc611015';
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
    const targetLocatorId = activeLocator?.id || '4c30e857-f13f-42c5-adb3-a880dc611015';
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
    if (!activeLocator) return;
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
        activeLocator.id,
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

      locationsMemoryCache.delete(activeLocator.id);
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
    if (!activeLocator) return;
    const confirmed = window.confirm(
      `¿Deseas separar el grupo económico de "${primaryName}"?\n\nLas ubicaciones volverán a mostrarse como puntos independientes en el mapa público.`
    );
    if (!confirmed) return;

    setActionLoading(primaryId);
    setNotification(null);
    try {
      await dissolveEconomicGroup(primaryId);
      
      // Update memory cache locally
      locationsMemoryCache.delete(activeLocator.id);
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
    if (!activeLocator || !editingGroup) return;

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
      await updateGroupPrimary(activeLocator.id, editingGroup.primary, newPrimary, allMemberIds);

      locationsMemoryCache.delete(activeLocator.id);
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
    if (!activeLocator) return;
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
      await createManualGroup(activeLocator.id, primary, memberIds);
      locationsMemoryCache.delete(activeLocator.id);
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
            {activeLocator?.name || 'Localizador'}
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
            fontSize: '14px'
          }}
        >
          {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span style={{ flex: 1, fontWeight: 500 }}>{notification.text}</span>
          <button
            onClick={() => setNotification(null)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontWeight: 'bold' }}
          >
            ✕
          </button>
        </div>
      )}

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

        {/* Quick Search and Scope Filter Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              {activeGroups.length > 0 && !search && (
                <button
                  onClick={() => setActiveTab('active')}
                  className="btn btn-secondary"
                  style={{ marginTop: '16px', fontSize: '13px' }}
                >
                  Ver {activeGroups.length} grupo(s) activo(s)
                </button>
              )}
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

                                  {member.custom_fields?.['_locator_slug'] && (
                                    <span
                                      style={{
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        padding: '3px 8px',
                                        borderRadius: 'var(--radius-full)',
                                        backgroundColor: member.custom_fields['_locator_slug'] === 'blissfarma' ? 'rgba(30, 200, 170, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                        color: member.custom_fields['_locator_slug'] === 'blissfarma' ? '#0d9488' : '#1d4ed8',
                                        border: `1px solid ${member.custom_fields['_locator_slug'] === 'blissfarma' ? 'rgba(30, 200, 170, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                                      }}
                                    >
                                      {member.custom_fields['_locator_slug'] === 'blissfarma' ? '💊 Blissfarma' : '🩺 MedicosBliss'}
                                    </span>
                                  )}
                                </div>

                                {/* Radio circle */}
                                <div
                                  style={{
                                    width: '18px',
                                    height: '18px',
                                    borderRadius: '50%',
                                    border: isPrimary ? '5px solid #00506E' : '2px solid var(--color-dark-border)',
                                    backgroundColor: 'white'
                                  }}
                                />
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
                const isCardExpanded = expandedActiveCards[group.primary.id] || false;
                const currentTab = getCardTab(group.primary.id);
                const billingVehicles = group.billingVehicles || [];
                const physicalSedes = group.physicalSedes || [];
                const medicalStaff = group.medicalStaff || [];

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
                        borderBottom: isCardExpanded ? '1px solid var(--color-dark-border)' : 'none',
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
                            {/* Unified Visibility & Locator Pill */}
                            {(() => {
                              const isVisible = group.primary.published !== false;
                              const locSlug = group.primary.custom_fields?.['_locator_slug'] || activeLocator?.slug || 'medicosbliss';
                              const locName = locSlug === 'blissfarma' ? 'Blissfarma' : 'MedicosBliss';
                              const locIcon = locSlug === 'blissfarma' ? '💊' : '🩺';
                              return (
                                <span
                                  style={{
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    backgroundColor: isVisible ? 'rgba(16, 185, 129, 0.12)' : 'rgba(100, 116, 139, 0.12)',
                                    color: isVisible ? '#059669' : '#64748b',
                                    border: isVisible ? '1px solid rgba(16, 185, 129, 0.28)' : '1px solid rgba(100, 116, 139, 0.25)',
                                    padding: '3px 9px',
                                    borderRadius: 'var(--radius-full)',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                  }}
                                  title={isVisible ? `Publicado y visible en el mapa de ${locName}` : `Oculto / no visible en el mapa de ${locName}`}
                                >
                                  <span>{locIcon}</span>
                                  <span>{isVisible ? `Visible en ${locName}` : `Oculto en ${locName}`}</span>
                                </span>
                              );
                            })()}
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

                            {/* Branding Social Cascade Info */}
                            {(group.primary.website || group.primary.instagram || group.primary.facebook || group.primary.phone) && (
                              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '11px', padding: '2px 8px', borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(124, 58, 237, 0.08)', color: '#7c3aed', fontWeight: 600 }}>
                                <Sparkles size={11} />
                                <span>Cascada de branding activa hacia sedes</span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right action button: Toggle Desglose & Editar Grupo */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleActiveCard(group.primary.id)}
                          className="btn btn-secondary"
                          style={{
                            fontSize: '12px',
                            padding: '8px 14px',
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            borderRadius: 'var(--radius-full)',
                            border: '1px solid var(--color-dark-border)',
                            backgroundColor: isCardExpanded ? 'rgba(0, 80, 110, 0.08)' : 'white',
                            color: isCardExpanded ? 'var(--color-primary)' : 'var(--color-dark-text-primary)',
                            cursor: 'pointer',
                            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
                            transition: 'all 0.15s ease'
                          }}
                          title={isCardExpanded ? 'Contraer desglose' : 'Ver desglose completo'}
                          aria-expanded={isCardExpanded}
                        >
                          <span>{isCardExpanded ? 'Contraer' : 'Ver desglose'}</span>
                          {isCardExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(group)}
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
                          <Pencil size={13} style={{ color: 'var(--color-primary)' }} />
                          Editar Grupo
                        </button>
                      </div>
                    </div>

                    {isCardExpanded && (
                      <>
                        {/* ── BARRA DE NAVEGACIÓN JERÁRQUICA (4 NIVELES DEL FLUJO) ── */}
                    <div
                      style={{
                        padding: '10px 20px',
                        backgroundColor: 'var(--color-dark-bg)',
                        borderBottom: '1px solid var(--color-dark-border)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        flexWrap: 'wrap'
                      }}
                    >
                      {/* Tab 1: Facturación / RUCs */}
                      <button
                        type="button"
                        onClick={() => setCardTab(group.primary.id, 'billing')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: currentTab === 'billing' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
                          backgroundColor: currentTab === 'billing' ? '#00506E' : 'var(--color-dark-surface)',
                          color: currentTab === 'billing' ? '#ffffff' : 'var(--color-dark-text-secondary)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Receipt size={13} />
                        <span>1. Facturación / RUCs ({billingVehicles.length})</span>
                      </button>

                      {/* Tab 2: Sedes Físicas */}
                      <button
                        type="button"
                        onClick={() => setCardTab(group.primary.id, 'sedes')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: currentTab === 'sedes' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
                          backgroundColor: currentTab === 'sedes' ? '#00506E' : 'var(--color-dark-surface)',
                          color: currentTab === 'sedes' ? '#ffffff' : 'var(--color-dark-text-secondary)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Store size={13} />
                        <span>2. Sedes Físicas ({physicalSedes.length})</span>
                      </button>

                      {/* Tab 3: Staff Médico Afiliado */}
                      <button
                        type="button"
                        onClick={() => setCardTab(group.primary.id, 'staff')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: currentTab === 'staff' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
                          backgroundColor: currentTab === 'staff' ? '#00506E' : 'var(--color-dark-surface)',
                          color: currentTab === 'staff' ? '#ffffff' : 'var(--color-dark-text-secondary)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Users size={13} />
                        <span>3. Staff Médico ({medicalStaff.length})</span>
                      </button>

                      {/* Tab 4: Inventario Consolidado */}
                      <button
                        type="button"
                        onClick={() => setCardTab(group.primary.id, 'products')}
                        style={{
                          padding: '6px 14px',
                          borderRadius: 'var(--radius-full)',
                          fontSize: '12px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '6px',
                          border: currentTab === 'products' ? '1.5px solid #00506E' : '1px solid var(--color-dark-border)',
                          backgroundColor: currentTab === 'products' ? '#00506E' : 'var(--color-dark-surface)',
                          color: currentTab === 'products' ? '#ffffff' : 'var(--color-dark-text-secondary)',
                          transition: 'all 0.15s ease'
                        }}
                      >
                        <Package size={13} />
                        <span>4. Ventas Consolidadas ({group.totalProducts} prod.)</span>
                      </button>
                    </div>

                    {/* ── CONTENIDO DEL PANEL SEGÚN LA PESTAÑA ACTIVA ── */}
                    <div style={{ padding: '18px 22px' }}>
                      {/* ══ PESTAÑA 2: RAZONES SOCIALES / RUCs ══ */}
                      {currentTab === 'billing' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                Vehículos de Compra Asociados al Grupo
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                                RUCs 20, RUCs 10 y DNIs con los que este cliente factura. Todas las compras suman automáticamente al Grupo Económico.
                              </div>
                            </div>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(0, 80, 110, 0.08)', color: '#00506E' }}>
                              Cascada de Ventas Activa
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {billingVehicles.map((vehicle, vIdx) => {
                              const vehicleKey = `${group.primary.id}-${vehicle.documentNumber}`;
                              const isVehicleExpanded = expandedVehicleProducts[vehicleKey] || false;

                              return (
                                <div
                                  key={vIdx}
                                  style={{
                                    padding: '12px 16px',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--color-dark-bg)',
                                    border: '1px solid var(--color-dark-border)'
                                  }}
                                >
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                                    <div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <span
                                          style={{
                                            fontSize: '11px',
                                            fontWeight: 800,
                                            padding: '2px 7px',
                                            borderRadius: 'var(--radius-sm)',
                                            backgroundColor: vehicle.documentType === 'RUC 20' ? 'rgba(59, 130, 246, 0.15)' : (vehicle.documentType === 'RUC 10' ? 'rgba(124, 58, 237, 0.15)' : 'rgba(30, 200, 170, 0.15)'),
                                            color: vehicle.documentType === 'RUC 20' ? '#1d4ed8' : (vehicle.documentType === 'RUC 10' ? '#7c3aed' : '#0d9488')
                                          }}
                                        >
                                          {vehicle.documentType}
                                        </span>
                                        <span style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                          {vehicle.businessName}
                                        </span>
                                        <span style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)', fontFamily: 'monospace' }}>
                                          Doc: {vehicle.documentNumber}
                                        </span>
                                      </div>
                                      <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                                        Fichas asociadas: {vehicle.originNames.join(', ')}
                                      </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#059669', backgroundColor: 'rgba(16, 185, 129, 0.1)', padding: '3px 9px', borderRadius: 'var(--radius-full)' }}>
                                        +{vehicle.totalPurchasedQty} unid. ({vehicle.productsCount} prod.)
                                      </span>

                                      {vehicle.productsCount > 0 && (
                                        <button
                                          type="button"
                                          onClick={() => toggleVehicleProducts(vehicleKey)}
                                          style={{
                                            background: 'none',
                                            border: 'none',
                                            cursor: 'pointer',
                                            fontSize: '11px',
                                            fontWeight: 600,
                                            color: 'var(--color-primary)',
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: '3px',
                                            padding: 0
                                          }}
                                        >
                                          {isVehicleExpanded ? 'Ocultar' : 'Ver productos'}
                                          {isVehicleExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                        </button>
                                      )}
                                    </div>
                                  </div>

                                  {/* Desglose de productos de este vehículo */}
                                  {isVehicleExpanded && vehicle.products.length > 0 && (
                                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed var(--color-dark-border)' }}>
                                      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--color-dark-text-secondary)', marginBottom: '6px' }}>
                                        Productos facturados bajo este RUC / Razón Social:
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', maxHeight: '120px', overflowY: 'auto' }}>
                                        {vehicle.products.map((vp, vpIdx) => (
                                          <span
                                            key={vpIdx}
                                            style={{
                                              fontSize: '11px',
                                              padding: '2px 8px',
                                              borderRadius: 'var(--radius-sm)',
                                              backgroundColor: 'var(--color-dark-surface)',
                                              border: '1px solid var(--color-dark-border)',
                                              color: 'var(--color-dark-text-primary)'
                                            }}
                                          >
                                            {vp.name} {vp.qty ? `(${vp.qty} uds)` : ''}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* ══ PESTAÑA 3: SEDES FÍSICAS (LOCALES PLAZA DERMA) ══ */}
                      {currentTab === 'sedes' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                Locales y Sedes de Atención al Público
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                                Puntos físicos donde el grupo atiende a pacientes. Heredan el branding corporativo del grupo económico.
                              </div>
                            </div>
                            <span style={{ fontSize: '11px', fontWeight: 700, padding: '3px 10px', borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(124, 58, 237, 0.08)', color: '#7c3aed' }}>
                              Cascada de Branding Activa
                            </span>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {physicalSedes.map((sede, sIdx) => (
                              <div
                                key={sIdx}
                                style={{
                                  padding: '14px 16px',
                                  borderRadius: 'var(--radius-md)',
                                  backgroundColor: 'var(--color-dark-bg)',
                                  border: '1px solid var(--color-dark-border)',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  flexWrap: 'wrap',
                                  gap: '12px'
                                }}
                              >
                                <div style={{ flex: 1, minWidth: '240px' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                      {sede.name}
                                    </span>
                                    {sede.isPrimary ? (
                                      <span style={{ fontSize: '11px', fontWeight: 800, padding: '2px 8px', borderRadius: 'var(--radius-full)', backgroundColor: '#00506E', color: 'white' }}>
                                        Sede Principal (Insignia)
                                      </span>
                                    ) : (
                                      <span style={{ fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(0,0,0,0.06)', color: 'var(--color-dark-text-secondary)' }}>
                                        Sede Secundaria
                                      </span>
                                    )}
                                    {sede.brandingInherited && (
                                      <span style={{ fontSize: '10px', fontWeight: 700, padding: '2px 7px', borderRadius: 'var(--radius-full)', backgroundColor: 'rgba(124, 58, 237, 0.1)', color: '#7c3aed', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                                        <Sparkles size={10} /> Hereda Logo y Redes del GE
                                      </span>
                                    )}
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '5px' }}>
                                    <MapPin size={13} style={{ color: 'var(--color-primary)' }} />
                                    <span>{sede.address}</span>
                                    {sede.lat !== 0 && sede.lng !== 0 && (
                                      <span style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', fontFamily: 'monospace' }}>
                                        ({sede.lat.toFixed(4)}, {sede.lng.toFixed(4)})
                                      </span>
                                    )}
                                  </div>

                                  {sede.phone && (
                                    <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                                      Teléfono de atención: <strong>{sede.phone}</strong>
                                    </div>
                                  )}
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                  <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-dark-text-secondary)', backgroundColor: 'var(--color-dark-surface)', padding: '4px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-dark-border)' }}>
                                    {sede.staffCount > 0 ? `${sede.staffCount} médicos asignados` : 'Sin médicos asignados'}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* ══ PESTAÑA 4: STAFF MÉDICO AFILIADO (RELACIÓN N:M) ══ */}
                      {currentTab === 'staff' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                Directorio de Médicos Afiliados a las Sedes
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                                Relación laboral N:M independiente de las facturas. Médicos que pasan consulta en los locales de este grupo.
                              </div>
                            </div>
                            <Link
                              to="/dashboard/affiliations"
                              style={{
                                fontSize: '12px',
                                fontWeight: 700,
                                color: 'var(--color-primary)',
                                textDecoration: 'none',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '4px'
                              }}
                            >
                              Gestionar Afiliaciones &rarr;
                            </Link>
                          </div>

                          {medicalStaff.length === 0 ? (
                            <div
                              style={{
                                padding: '24px',
                                textAlign: 'center',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-dark-bg)',
                                border: '1px dashed var(--color-dark-border)'
                              }}
                            >
                              <Stethoscope size={28} style={{ color: 'var(--color-dark-text-tertiary)', margin: '0 auto 8px' }} />
                              <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--color-dark-text-secondary)' }}>
                                No se detectó staff médico asignado a estas sedes aún.
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                                Puedes vincular los doctores que pasan consulta en esta clínica desde el módulo de Afiliaciones.
                              </div>
                            </div>
                          ) : (
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                              {medicalStaff.map((doc, dIdx) => (
                                <div
                                  key={dIdx}
                                  style={{
                                    padding: '14px',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--color-dark-bg)',
                                    border: '1px solid var(--color-dark-border)',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: '12px'
                                  }}
                                >
                                  {doc.photoUrl ? (
                                    <img
                                      src={doc.photoUrl}
                                      alt={doc.name}
                                      style={{
                                        width: '44px',
                                        height: '44px',
                                        borderRadius: 'var(--radius-full)',
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
                                        borderRadius: 'var(--radius-full)',
                                        backgroundColor: 'rgba(30, 200, 170, 0.1)',
                                        color: '#0d9488',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexShrink: 0
                                      }}
                                    >
                                      <Stethoscope size={20} />
                                    </div>
                                  )}

                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                      {doc.name}
                                    </div>

                                    {(doc.cmp || doc.rne) && (
                                      <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px', fontFamily: 'monospace' }}>
                                        {[doc.cmp, doc.rne ? `RNE ${doc.rne}` : ''].filter(Boolean).join(' · ')}
                                      </div>
                                    )}

                                    {doc.specialty && (
                                      <div style={{ fontSize: '11px', color: 'var(--color-primary)', fontWeight: 600, marginTop: '2px' }}>
                                        {doc.specialty}
                                      </div>
                                    )}

                                    {/* Sedes donde atiende */}
                                    {doc.assignedSedes.length > 0 && (
                                      <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--color-dark-text-secondary)' }}>
                                        Pasa consulta en: <strong>{doc.assignedSedes.join(', ')}</strong>
                                      </div>
                                    )}

                                    {/* Multi-afiliación externa */}
                                    {doc.otherCenters.length > 0 && (
                                      <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--color-dark-text-tertiary)' }}>
                                        También atiende en: <em>{doc.otherCenters.slice(0, 2).join(', ')}{doc.otherCenters.length > 2 ? ` (+${doc.otherCenters.length - 2} más)` : ''}</em>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* ══ PESTAÑA: VENTAS CONSOLIDADAS / INVENTARIO ══ */}
                      {currentTab === 'products' && (
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
                            <div>
                              <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                                Inventario Consolidado de Ventas ({group.totalProducts} productos distintos)
                              </div>
                              <div style={{ fontSize: '12px', color: 'var(--color-dark-text-secondary)' }}>
                                Suma algebraica de cantidades compradas entre todos los RUCs y razones sociales del grupo.
                              </div>
                            </div>
                          </div>

                          {group.combinedProducts.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--color-dark-text-tertiary)', fontSize: '12px' }}>
                              No hay productos registrados para este grupo.
                            </div>
                          ) : (
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                                gap: '8px',
                                maxHeight: '280px',
                                overflowY: 'auto',
                                paddingRight: '4px'
                              }}
                            >
                              {group.combinedProducts.map((prod, pIdx) => (
                                <div
                                  key={pIdx}
                                  style={{
                                    padding: '8px 12px',
                                    borderRadius: 'var(--radius-sm)',
                                    backgroundColor: 'var(--color-dark-bg)',
                                    border: '1px solid var(--color-dark-border)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '8px'
                                  }}
                                >
                                  <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-dark-text-primary)', wordBreak: 'break-word' }}>
                                    {prod.name}
                                  </span>
                                  {prod.qty !== undefined && (
                                    <span style={{ fontSize: '11px', fontWeight: 800, color: '#059669', backgroundColor: 'rgba(16, 185, 129, 0.12)', padding: '2px 7px', borderRadius: 'var(--radius-full)', whiteSpace: 'nowrap' }}>
                                      {prod.qty} uds
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
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
                    Editar Grupo Económico
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
                Fichas que componen este grupo (Haz clic para seleccionar la Ficha Principal visible en el mapa):
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

                          {member.custom_fields?.['_locator_slug'] && (
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)',
                                backgroundColor: member.custom_fields['_locator_slug'] === 'blissfarma' ? 'rgba(30, 200, 170, 0.15)' : 'rgba(59, 130, 246, 0.15)',
                                color: member.custom_fields['_locator_slug'] === 'blissfarma' ? '#0d9488' : '#1d4ed8',
                                border: `1px solid ${member.custom_fields['_locator_slug'] === 'blissfarma' ? 'rgba(30, 200, 170, 0.3)' : 'rgba(59, 130, 246, 0.3)'}`
                              }}
                            >
                              {member.custom_fields['_locator_slug'] === 'blissfarma' ? '💊 Blissfarma' : '🩺 MedicosBliss'}
                            </span>
                          )}
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
