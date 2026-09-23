import React, { useState, useEffect, useMemo, useCallback } from 'react';
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
  X
} from 'lucide-react';
import {
  type LocationItem,
  type SuggestedGroup,
  type ActiveGroup,
  detectPossibleGroups,
  getActiveGroups,
  unifyEconomicGroup,
  updateGroupPrimary,
  dissolveEconomicGroup
} from '../../services/groupService';
import {
  fetchLocatorLocations,
  locationsMemoryCache
} from '../../services/locationService';

interface OutletContextType {
  activeLocator: Locator | null;
  fetchLocators?: () => Promise<void>;
}

export const ManageEconomicGroups: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'active'>('suggestions');
  const [search, setSearch] = useState('');
  const [ignoredGroupKeys, setIgnoredGroupKeys] = useState<Set<string>>(new Set());
  const [selectedPrimaries, setSelectedPrimaries] = useState<Record<string, string>>({});
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>({});
  const [expandedActiveSecondary, setExpandedActiveSecondary] = useState<Record<string, boolean>>({});
  const [expandedActiveProducts, setExpandedActiveProducts] = useState<Record<string, boolean>>({});
  const [expandedSuggestions, setExpandedSuggestions] = useState<Record<string, boolean>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal Edit Active Group state
  const [editingGroup, setEditingGroup] = useState<ActiveGroup | null>(null);
  const [editingPrimaryId, setEditingPrimaryId] = useState<string>('');
  const [modalExpandedProducts, setModalExpandedProducts] = useState<Record<string, boolean>>({});
  const [modalSaving, setModalSaving] = useState(false);

  // Load locations for the active locator
  const loadData = useCallback(async (forceRefresh = false) => {
    if (!activeLocator) return;
    setLoading(true);
    setNotification(null);
    try {
      const data = await fetchLocatorLocations(activeLocator, forceRefresh);
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
  }, [activeLocator]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived: Suggested groups
  const suggestedGroups = useMemo(() => {
    const raw = detectPossibleGroups(locations);
    return raw.filter(g => !ignoredGroupKeys.has([...g.ids].sort().join('|')));
  }, [locations, ignoredGroupKeys]);

  // Derived: Active unified groups
  const activeGroups = useMemo(() => {
    return getActiveGroups(locations);
  }, [locations]);

  // Filtered by search
  const filteredSuggestions = useMemo(() => {
    if (!search.trim()) return suggestedGroups;
    const q = search.toLowerCase().trim();
    return suggestedGroups.filter(g =>
      g.name.toLowerCase().includes(q) ||
      g.address.toLowerCase().includes(q) ||
      g.rucs.some(r => r.includes(q)) ||
      g.members.some(m => m.name.toLowerCase().includes(q))
    );
  }, [suggestedGroups, search]);

  const filteredActiveGroups = useMemo(() => {
    if (!search.trim()) return activeGroups;
    const q = search.toLowerCase().trim();
    return activeGroups.filter(g =>
      g.primary.name.toLowerCase().includes(q) ||
      g.primary.address.toLowerCase().includes(q) ||
      g.rucs.some(r => r.includes(q)) ||
      g.members.some(m => m.name.toLowerCase().includes(q))
    );
  }, [activeGroups, search]);

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

  const handleToggleActiveSecondary = (primaryId: string) => {
    setExpandedActiveSecondary(prev => ({ ...prev, [primaryId]: !prev[primaryId] }));
  };

  const handleToggleActiveProducts = (primaryId: string) => {
    setExpandedActiveProducts(prev => ({ ...prev, [primaryId]: !prev[primaryId] }));
  };

  const handleToggleSuggestion = (groupKey: string) => {
    setExpandedSuggestions(prev => ({ ...prev, [groupKey]: !prev[groupKey] }));
  };

  const handleIgnoreGroup = (group: SuggestedGroup) => {
    const key = [...group.ids].sort().join('|');
    setIgnoredGroupKeys(prev => new Set([...prev, key]));
  };

  const handleUnify = async (group: SuggestedGroup) => {
    if (!activeLocator) return;
    const groupKey = [...group.ids].sort().join('|');
    const chosenPrimaryId = selectedPrimaries[groupKey] || group.primaryId;
    const chosenPrimary = group.members.find(m => m.id === chosenPrimaryId) || group.members[0];

    setActionLoading(groupKey);
    setNotification(null);
    try {
      await unifyEconomicGroup(activeLocator.id, group, chosenPrimaryId);
      
      // Update memory cache locally
      locationsMemoryCache.delete(activeLocator.id);
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

  // Keyboard accessibility: Close modal on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && editingGroup && !modalSaving) {
        setEditingGroup(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingGroup, modalSaving]);

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
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
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

          <button
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
        </div>

        {/* Quick Search in Groups */}
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
                            <span style={{ fontSize: '14px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                              Sugerencia #{groupIdx + 1}: Misma Sede Física
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
                          const entityType = member.custom_fields?.['entity_type'] || (member.id.startsWith('b2c-center') ? 'center' : 'doctor');
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
                              {/* Primary / Secondary Indicator Badge */}
                              <div style={{ marginBottom: '12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
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
              {filteredActiveGroups.map(group => {
                const isExpanded = expandedActiveSecondary[group.primary.id] || false;
                const isProductsExpanded = expandedActiveProducts[group.primary.id] || false;

                return (
                  <div
                    key={group.primary.id}
                    style={{
                      backgroundColor: 'var(--color-dark-surface)',
                      borderRadius: 'var(--radius-lg)',
                      border: '1px solid var(--color-dark-border)',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
                      overflow: 'hidden'
                    }}
                  >
                    {/* Active Group Header */}
                    <div
                      style={{
                        padding: '16px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '14px',
                        borderBottom: '1px solid var(--color-dark-border)'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1, minWidth: '260px' }}>
                        {group.primary.image_url ? (
                          <img
                            src={group.primary.image_url}
                            alt={group.primary.name}
                            style={{
                              width: '50px',
                              height: '50px',
                              borderRadius: 'var(--radius-sm)',
                              objectFit: 'cover',
                              border: '1px solid var(--color-dark-border)'
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: '50px',
                              height: '50px',
                              borderRadius: 'var(--radius-sm)',
                              backgroundColor: 'rgba(0, 80, 110, 0.1)',
                              color: '#00506E',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <Building2 size={24} />
                          </div>
                        )}

                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '16px', fontWeight: 800, color: 'var(--color-dark-text-primary)' }}>
                              {group.primary.name}
                            </span>
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
                              Grupo Económico ({group.members.length} entidades)
                            </span>
                            <span
                              style={{
                                fontSize: '11px',
                                fontWeight: 700,
                                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                                color: '#059669',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-full)'
                              }}
                            >
                              Visible en Mapa
                            </span>
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-dark-text-secondary)', marginTop: '4px' }}>
                            <MapPin size={13} style={{ color: 'var(--color-primary)' }} />
                            <span>{group.primary.address}</span>
                          </div>

                          <div style={{ fontSize: '11px', color: 'var(--color-dark-text-tertiary)', marginTop: '4px' }}>
                            RUCs integrados: <strong>{group.rucs.join(' • ') || '—'}</strong>
                          </div>
                        </div>
                      </div>

                      {/* Right action button: Editar Grupo */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => handleOpenEditModal(group)}
                          className="btn btn-secondary"
                          style={{
                            fontSize: '12px',
                            padding: '7px 14px',
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

                    {/* Integrated Products & Secondary Members Section */}
                    <div style={{ padding: '14px 20px', backgroundColor: 'var(--color-dark-bg)', borderBottom: (isExpanded || isProductsExpanded) ? '1px solid var(--color-dark-border)' : 'none' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
                        <button
                          type="button"
                          onClick={() => handleToggleActiveProducts(group.primary.id)}
                          disabled={group.totalProducts === 0}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            fontSize: '13px',
                            fontWeight: 600,
                            color: group.totalProducts > 0 ? 'var(--color-dark-text-primary)' : 'var(--color-dark-text-tertiary)',
                            cursor: group.totalProducts > 0 ? 'pointer' : 'default',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px'
                          }}
                          aria-expanded={isProductsExpanded}
                          title={group.totalProducts > 0 ? (isProductsExpanded ? 'Contraer lista de productos' : 'Ver productos combinados') : undefined}
                        >
                          <Package size={15} style={{ color: group.totalProducts > 0 ? 'var(--color-primary)' : 'var(--color-dark-text-tertiary)' }} />
                          <span>{group.totalProducts} productos combinados en esta sede</span>
                          {group.totalProducts > 0 && (
                            isProductsExpanded ? <ChevronUp size={14} style={{ color: 'var(--color-primary)' }} /> : <ChevronDown size={14} style={{ color: 'var(--color-dark-text-secondary)' }} />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => handleToggleActiveSecondary(group.primary.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--color-primary)',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                          aria-expanded={isExpanded}
                        >
                          {isExpanded ? 'Ocultar fichas secundarias' : `Ver ${group.secondaryMembers.length} ficha(s) secundaria(s) agrupada(s)`}
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>

                      {/* Combined Products Pills (Collapsible) */}
                      {isProductsExpanded && (
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: '5px',
                            marginTop: '10px',
                            maxHeight: '160px',
                            overflowY: 'auto',
                            padding: '4px 0'
                          }}
                        >
                          {group.combinedProducts.map((p, idx) => (
                            <span
                              key={idx}
                              style={{
                                fontSize: '11px',
                                padding: '2px 8px',
                                borderRadius: 'var(--radius-sm)',
                                backgroundColor: 'var(--color-dark-surface)',
                                border: '1px solid var(--color-dark-border)',
                                color: 'var(--color-dark-text-primary)'
                              }}
                            >
                              {p.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Secondary Members Details (Collapsible) */}
                    {isExpanded && (
                      <div style={{ padding: '16px 20px', backgroundColor: 'var(--color-dark-surface)' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-dark-text-secondary)', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Fichas Secundarias fusionadas bajo este grupo:
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                          {group.secondaryMembers.map(sec => (
                            <div
                              key={sec.id}
                              style={{
                                padding: '10px 14px',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-dark-bg)',
                                border: '1px solid var(--color-dark-border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                flexWrap: 'wrap',
                                gap: '10px'
                              }}
                            >
                              <div>
                                <div style={{ fontWeight: 700, fontSize: '13px', color: 'var(--color-dark-text-primary)' }}>
                                  {sec.name}
                                </div>
                                <div style={{ fontSize: '11px', color: 'var(--color-dark-text-secondary)', marginTop: '2px' }}>
                                  RS: {sec.custom_fields?.['Razón Social'] || sec.custom_fields?.['Razon Social'] || '—'} &nbsp;·&nbsp; 
                                  Doc: {sec.custom_fields?.['Documento'] || '—'} &nbsp;·&nbsp; 
                                  Aporta {sec.products?.length || 0} productos
                                </div>
                              </div>
                              <span
                                style={{
                                  fontSize: '11px',
                                  padding: '2px 8px',
                                  borderRadius: 'var(--radius-full)',
                                  backgroundColor: 'rgba(0,0,0,0.05)',
                                  color: 'var(--color-dark-text-secondary)'
                                }}
                              >
                                Oculto en mapa individualmente
                              </span>
                            </div>
                          ))}
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
                  const entityType = member.custom_fields?.['entity_type'] || (member.id.startsWith('b2c-center') ? 'center' : 'doctor');
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
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
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
    </div>
  );
};
