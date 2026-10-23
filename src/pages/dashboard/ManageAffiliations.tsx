import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import type { Locator } from './DashboardLayout';
import {
  Building2,
  Stethoscope,
  MapPin,
  Search,
  Plus,
  X,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  GraduationCap
} from 'lucide-react';
import type { LocationItem } from '../../services/groupService';
import {
  resolveAllAffiliations,
  updateDoctorCenters,
  updateCenterDoctors,
  removeSingleAffiliation,
  createManualCenter,
  type AffiliatedCenterView,
  type AffiliatedDoctorView
} from '../../services/affiliationService';
import {
  fetchLocatorLocations,
  invalidateLocationsCache
} from '../../services/locationService';
import { toTitleCase } from '../../services/b2bApiService';

interface OutletContextType {
  activeLocator: Locator | null;
  fetchLocators?: () => Promise<void>;
}

export const ManageAffiliations: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();

  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'centers' | 'doctors'>('centers');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'with_affiliations' | 'without_affiliations'>('all');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Modal 1: Assign doctors to center
  const [editingCenter, setEditingCenter] = useState<LocationItem | null>(null);
  const [modalDoctorSearch, setModalDoctorSearch] = useState('');
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<Set<string>>(new Set());
  const [modalSaving, setModalSaving] = useState(false);

  // Modal 2: Assign centers to doctor
  const [editingDoctor, setEditingDoctor] = useState<LocationItem | null>(null);
  const [modalCenterSearch, setModalCenterSearch] = useState('');
  const [selectedCenterIds, setSelectedCenterIds] = useState<Set<string>>(new Set());

  // Modal 3: Create new manual center
  const [isCreateCenterOpen, setIsCreateCenterOpen] = useState(false);
  const [newCenterName, setNewCenterName] = useState('');
  const [newCenterAddress, setNewCenterAddress] = useState('');
  const [newCenterPhone, setNewCenterPhone] = useState('');
  const [newCenterLat, setNewCenterLat] = useState('');
  const [newCenterLng, setNewCenterLng] = useState('');
  const [createSaving, setCreateSaving] = useState(false);

  // Load locations
  const loadData = useCallback(async (forceRefresh = false) => {
    if (!activeLocator) return;
    setLoading(true);
    setNotification(null);
    try {
      if (forceRefresh) {
        invalidateLocationsCache(activeLocator.id);
      }
      const data = await fetchLocatorLocations(activeLocator, forceRefresh);
      setLocations(data);
    } catch (err: any) {
      console.error('Error loading locations for affiliations:', err);
      setNotification({
        type: 'error',
        text: 'Error al cargar las ubicaciones. Por favor intenta de nuevo.'
      });
    } finally {
      setLoading(false);
    }
  }, [activeLocator]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Structured affiliations
  const { centers: allCenters, doctors: allDoctors } = useMemo(() => {
    return resolveAllAffiliations(locations);
  }, [locations]);

  // Filtered Centers
  const filteredCenters = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allCenters.filter(({ center, doctors }) => {
      // Filter status
      if (filterMode === 'with_affiliations' && doctors.length === 0) return false;
      if (filterMode === 'without_affiliations' && doctors.length > 0) return false;

      if (!q) return true;
      const inName = (center.name || '').toLowerCase().includes(q);
      const inAddr = (center.address || '').toLowerCase().includes(q);
      const inDoctors = doctors.some(d => 
        (d.name || '').toLowerCase().includes(q) ||
        (d.custom_fields?.['CMP'] || '').includes(q)
      );
      return inName || inAddr || inDoctors;
    });
  }, [allCenters, search, filterMode]);

  // Filtered Doctors
  const filteredDoctors = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allDoctors.filter(({ doctor, centers }) => {
      // Filter status
      if (filterMode === 'with_affiliations' && centers.length === 0) return false;
      if (filterMode === 'without_affiliations' && centers.length > 0) return false;

      if (!q) return true;
      const inName = (doctor.name || '').toLowerCase().includes(q);
      const inCmp = (doctor.custom_fields?.['CMP'] || '').includes(q);
      const inCenters = centers.some(c => 
        (c.name || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q)
      );
      return inName || inCmp || inCenters;
    });
  }, [allDoctors, search, filterMode]);

  // Handle Remove Affiliation
  const handleRemove = async (doctorId: string, centerId: string) => {
    if (!activeLocator) return;
    const actionKey = `${doctorId}-${centerId}`;
    setActionLoading(actionKey);
    try {
      await removeSingleAffiliation(activeLocator.id, doctorId, centerId, locations);
      await loadData(true);
      setNotification({
        type: 'success',
        text: 'Afiliación desvinculada exitosamente.'
      });
    } catch (err: any) {
      console.error('Error removing affiliation:', err);
      setNotification({
        type: 'error',
        text: 'No se pudo remover la afiliación.'
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Open Assign Doctors to Center Modal
  const openAssignDoctorsModal = (item: AffiliatedCenterView) => {
    setEditingCenter(item.center);
    setSelectedDoctorIds(new Set(item.doctors.map(d => d.id)));
    setModalDoctorSearch('');
  };

  // Save Center Doctors
  const handleSaveCenterDoctors = async () => {
    if (!activeLocator || !editingCenter) return;
    setModalSaving(true);
    try {
      await updateCenterDoctors(
        activeLocator.id,
        editingCenter,
        Array.from(selectedDoctorIds),
        locations
      );
      await loadData(true);
      setEditingCenter(null);
      setNotification({
        type: 'success',
        text: 'Médicos afiliados actualizados con éxito.'
      });
    } catch (err: any) {
      console.error('Error saving center doctors:', err);
      setNotification({
        type: 'error',
        text: 'Error al actualizar las afiliaciones del centro.'
      });
    } finally {
      setModalSaving(false);
    }
  };

  // Open Assign Centers to Doctor Modal
  const openAssignCentersModal = (item: AffiliatedDoctorView) => {
    setEditingDoctor(item.doctor);
    setSelectedCenterIds(new Set(item.centers.map(c => c.id)));
    setModalCenterSearch('');
  };

  // Save Doctor Centers
  const handleSaveDoctorCenters = async () => {
    if (!activeLocator || !editingDoctor) return;
    setModalSaving(true);
    try {
      await updateDoctorCenters(
        activeLocator.id,
        editingDoctor,
        Array.from(selectedCenterIds),
        locations
      );
      await loadData(true);
      setEditingDoctor(null);
      setNotification({
        type: 'success',
        text: 'Sedes asignadas al médico actualizadas con éxito.'
      });
    } catch (err: any) {
      console.error('Error saving doctor centers:', err);
      setNotification({
        type: 'error',
        text: 'Error al actualizar las sedes del médico.'
      });
    } finally {
      setModalSaving(false);
    }
  };

  // Save New Manual Center
  const handleCreateCenter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeLocator || !newCenterName.trim() || !newCenterAddress.trim()) return;
    setCreateSaving(true);
    try {
      await createManualCenter(
        activeLocator.id,
        {
          name: newCenterName.trim(),
          address: newCenterAddress.trim(),
          phone: newCenterPhone.trim() || undefined,
          lat: newCenterLat ? Number(newCenterLat) : undefined,
          lng: newCenterLng ? Number(newCenterLng) : undefined,
        },
        locations
      );
      await loadData(true);
      setIsCreateCenterOpen(false);
      setNewCenterName('');
      setNewCenterAddress('');
      setNewCenterPhone('');
      setNewCenterLat('');
      setNewCenterLng('');
      setNotification({
        type: 'success',
        text: 'Nueva sede médica creada y registrada exitosamente.'
      });
    } catch (err: any) {
      console.error('Error creating manual center:', err);
      setNotification({
        type: 'error',
        text: 'No se pudo crear la sede médica.'
      });
    } finally {
      setCreateSaving(false);
    }
  };

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', paddingBottom: '60px' }}>
      {/* Breadcrumb & Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Link
          to="/dashboard"
          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#64748b', textDecoration: 'none', fontSize: '13px', fontWeight: 600 }}
        >
          <ArrowLeft size={16} /> Volver a Localizadores
        </Link>
        <span style={{ color: '#cbd5e1' }}>/</span>
        <span style={{ fontSize: '13px', color: '#00506E', fontWeight: 700 }}>Afiliaciones (Médicos y Sedes)</span>
      </div>

      {/* Header Banner */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        flexWrap: 'wrap',
        gap: '16px',
        marginBottom: '24px',
        backgroundColor: '#FFFFFF',
        padding: '24px',
        borderRadius: '20px',
        border: '1.5px solid #E2E8F0',
        boxShadow: '0 4px 20px rgba(0, 80, 110, 0.04)'
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <div style={{
              width: '38px',
              height: '38px',
              borderRadius: '12px',
              backgroundColor: 'rgba(30, 200, 170, 0.15)',
              color: '#00506E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Stethoscope size={22} />
            </div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: '#00506E', margin: 0 }}>
              Gestión de Sedes y Médicos Afiliados
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={loading}
            className="btn btn-secondary"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '8px 14px' }}
          >
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
            Refrescar
          </button>

          <button
            type="button"
            onClick={() => setIsCreateCenterOpen(true)}
            className="btn btn-primary"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              padding: '8px 16px',
              backgroundColor: '#1EC8AA',
              borderColor: '#1EC8AA',
              color: '#FFFFFF',
              fontWeight: 700
            }}
          >
            <Plus size={16} />
            Nueva Sede Manual
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div style={{
          padding: '12px 18px',
          borderRadius: '14px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          fontSize: '13px',
          fontWeight: 600,
          backgroundColor: notification.type === 'success' ? '#F0FDF4' : '#FEF2F2',
          color: notification.type === 'success' ? '#166534' : '#991B1B',
          border: `1.5px solid ${notification.type === 'success' ? '#BBF7D0' : '#FECACA'}`
        }}>
          {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{notification.text}</span>
          <button
            type="button"
            onClick={() => setNotification(null)}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Tabs & Filters Bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '14px',
        marginBottom: '20px'
      }}>
        {/* Navigation Tabs */}
        <div style={{
          display: 'flex',
          gap: '6px',
          backgroundColor: '#F1F5F9',
          padding: '4px',
          borderRadius: '14px',
          border: '1px solid #E2E8F0'
        }}>
          <button
            type="button"
            onClick={() => setActiveTab('centers')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'centers' ? '#FFFFFF' : 'transparent',
              color: activeTab === 'centers' ? '#00506E' : '#64748B',
              boxShadow: activeTab === 'centers' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Building2 size={16} style={{ color: activeTab === 'centers' ? '#1EC8AA' : '#94A3B8' }} />
            <span>Por Centro Médico ({allCenters.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('doctors')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '10px',
              fontSize: '13px',
              fontWeight: 700,
              border: 'none',
              cursor: 'pointer',
              backgroundColor: activeTab === 'doctors' ? '#FFFFFF' : 'transparent',
              color: activeTab === 'doctors' ? '#00506E' : '#64748B',
              boxShadow: activeTab === 'doctors' ? '0 2px 6px rgba(0,0,0,0.06)' : 'none',
              transition: 'all 0.15s ease'
            }}
          >
            <Stethoscope size={16} style={{ color: activeTab === 'doctors' ? '#1EC8AA' : '#94A3B8' }} />
            <span>Por Médico ({allDoctors.length})</span>
          </button>
        </div>

        {/* Filter by status */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as any)}
            style={{
              padding: '8px 12px',
              borderRadius: '10px',
              border: '1.5px solid #CBD5E1',
              backgroundColor: '#FFFFFF',
              fontSize: '13px',
              fontWeight: 600,
              color: '#00506E',
              cursor: 'pointer'
            }}
          >
            <option value="all">Todas las entidades</option>
            <option value="with_affiliations">Con afiliaciones activas</option>
            <option value="without_affiliations">Sin afiliaciones asignadas</option>
          </select>
        </div>
      </div>

      {/* Real-time Search Box */}
      <div style={{ position: 'relative', marginBottom: '24px' }}>
        <Search size={18} style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={activeTab === 'centers' ? 'Buscar por sede, dirección o médico afiliado...' : 'Buscar médico por nombre, CMP o sede vinculada...'}
          style={{
            width: '100%',
            padding: '12px 16px 12px 46px',
            borderRadius: '14px',
            border: '1.5px solid #E2E8F0',
            backgroundColor: '#FFFFFF',
            fontSize: '14px',
            color: '#00506E',
            outline: 'none',
            boxShadow: '0 2px 10px rgba(0, 80, 110, 0.03)'
          }}
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* Main Content List */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px', color: '#64748B' }}>
          <div className="spinner" style={{ width: '32px', height: '32px', borderTopColor: '#1EC8AA' }}></div>
        </div>
      ) : activeTab === 'centers' ? (
        /* ──────────────── TAB 1: VISTA POR CENTRO MÉDICO ──────────────── */
        filteredCenters.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', backgroundColor: '#FFFFFF', borderRadius: '20px', border: '1.5px solid #E2E8F0' }}>
            <Building2 size={40} style={{ color: '#CBD5E1', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#00506E', margin: '0 0 6px 0' }}>No se encontraron sedes médicas</h3>
            <p style={{ color: '#64748B', fontSize: '13px', margin: 0 }}>Intenta con otro término de búsqueda o crea una nueva sede manual.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredCenters.map(({ center, doctors }) => (
              <div
                key={center.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '18px',
                  border: '1.5px solid #E2E8F0',
                  padding: '20px',
                  boxShadow: '0 2px 12px rgba(0, 80, 110, 0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
              >
                {/* Center Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                    {center.image_url ? (
                      <img
                        src={center.image_url}
                        alt={center.name}
                        style={{ width: '44px', height: '44px', borderRadius: '12px', objectFit: 'contain', border: '1.5px solid #E2E8F0', padding: '2px', backgroundColor: '#FFFFFF', flexShrink: 0 }}
                        onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
                      />
                    ) : (
                      <div style={{
                        width: '44px',
                        height: '44px',
                        borderRadius: '12px',
                        backgroundColor: '#F0FDFA',
                        color: '#1EC8AA',
                        border: '1.5px solid #CCFBF1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <Building2 size={24} />
                      </div>
                    )}
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#00506E', margin: '0 0 4px 0' }}>
                        {toTitleCase(center.name)}
                      </h3>
                      <p style={{ fontSize: '12px', color: '#64748B', margin: 0, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <MapPin size={13} style={{ color: '#1EC8AA' }} />
                        {center.address}
                      </p>
                      {center.lat && center.lng && (center.lat !== 0 || center.lng !== 0) ? (
                        <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', color: '#059669', backgroundColor: '#ECFDF5', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                          📍 Coordenadas verificadas ({center.lat.toFixed(4)}, {center.lng.toFixed(4)})
                        </span>
                      ) : (
                        <span style={{ display: 'inline-block', marginTop: '6px', fontSize: '11px', color: '#D97706', backgroundColor: '#FFFBEB', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                          ⚠️ Sin coordenadas exactas
                        </span>
                      )}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openAssignDoctorsModal({ center, doctors })}
                    className="btn btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#00506E',
                      borderColor: '#CBD5E1',
                      padding: '8px 14px'
                    }}
                  >
                    <Plus size={14} style={{ color: '#1EC8AA' }} />
                    Asignar / Gestionar Médicos ({doctors.length})
                  </button>
                </div>

                {/* Affiliated Doctors Section */}
                <div style={{ backgroundColor: '#F8FAFC', borderRadius: '14px', padding: '14px', border: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#00506E', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                    🩺 Médicos que atienden en esta sede ({doctors.length})
                  </div>

                  {doctors.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic', padding: '6px 0' }}>
                      No hay médicos asignados a esta sede todavía. Usa el botón "Asignar Médicos" para vincular profesionales.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '10px' }}>
                      {doctors.map(doc => {
                        const isRemoving = actionLoading === `${doc.id}-${center.id}`;
                        return (
                          <div
                            key={doc.id}
                            style={{
                              backgroundColor: '#FFFFFF',
                              borderRadius: '12px',
                              padding: '10px 12px',
                              border: '1.5px solid #E2E8F0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px'
                            }}
                          >
                            <div style={{ minWidth: 0, flexGrow: 1 }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#00506E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {toTitleCase(doc.name)}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', display: 'flex', gap: '6px', alignItems: 'center', marginTop: '2px' }}>
                                {doc.custom_fields?.['CMP'] && <span>CMP: <strong>{doc.custom_fields['CMP']}</strong></span>}
                                {doc.custom_fields?.['Interés en'] && <span>· {doc.custom_fields['Interés en']}</span>}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemove(doc.id, center.id)}
                              disabled={isRemoving}
                              title="Desvincular médico de este centro"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#94A3B8',
                                padding: '4px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.15s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              {isRemoving ? <div className="spinner" style={{ width: '14px', height: '14px' }}></div> : <X size={15} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* ──────────────── TAB 2: VISTA POR MÉDICO ──────────────── */
        filteredDoctors.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 24px', backgroundColor: '#FFFFFF', borderRadius: '20px', border: '1.5px solid #E2E8F0' }}>
            <Stethoscope size={40} style={{ color: '#CBD5E1', marginBottom: '12px' }} />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: '#00506E', margin: '0 0 6px 0' }}>No se encontraron médicos</h3>
            <p style={{ color: '#64748B', fontSize: '13px', margin: 0 }}>Intenta con otro término o verifica que el médico esté registrado en el localizador.</p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {filteredDoctors.map(({ doctor, centers }) => (
              <div
                key={doctor.id}
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '18px',
                  border: '1.5px solid #E2E8F0',
                  padding: '20px',
                  boxShadow: '0 2px 12px rgba(0, 80, 110, 0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px'
                }}
              >
                {/* Doctor Header Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px' }}>
                    {doctor.image_url ? (
                      <img
                        src={doctor.image_url}
                        alt={doctor.name}
                        style={{ width: '48px', height: '48px', borderRadius: '12px', objectFit: 'cover', border: '1.5px solid #E2E8F0' }}
                      />
                    ) : (
                      <div style={{
                        width: '48px',
                        height: '48px',
                        borderRadius: '12px',
                        backgroundColor: '#EFF6FF',
                        color: '#3B82F6',
                        border: '1.5px solid #DBEAFE',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0
                      }}>
                        <Stethoscope size={24} />
                      </div>
                    )}
                    <div>
                      <h3 style={{ fontSize: '16px', fontWeight: 800, color: '#00506E', margin: '0 0 4px 0' }}>
                        {toTitleCase(doctor.name)}
                      </h3>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px', color: '#64748B' }}>
                        {doctor.custom_fields?.['CMP'] && (
                          <span style={{ backgroundColor: 'rgba(0, 80, 110, 0.08)', color: '#00506E', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                            CMP: {doctor.custom_fields['CMP']}
                          </span>
                        )}
                        {doctor.custom_fields?.['RNE'] && (
                          <span style={{ backgroundColor: 'rgba(30, 200, 170, 0.12)', color: '#00506E', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                            RNE: {doctor.custom_fields['RNE']}
                          </span>
                        )}
                        {doctor.custom_fields?.['Graduado en'] && (
                          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <GraduationCap size={13} /> {doctor.custom_fields['Graduado en']}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => openAssignCentersModal({ doctor, centers })}
                    className="btn btn-secondary"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: '#00506E',
                      borderColor: '#CBD5E1',
                      padding: '8px 14px'
                    }}
                  >
                    <Plus size={14} style={{ color: '#1EC8AA' }} />
                    Asignar / Gestionar Sedes ({centers.length})
                  </button>
                </div>

                {/* Affiliated Centers Section */}
                <div style={{ backgroundColor: '#F8FAFC', borderRadius: '14px', padding: '14px', border: '1px solid #F1F5F9' }}>
                  <div style={{ fontSize: '11px', fontWeight: 800, color: '#00506E', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
                    🏥 Sedes donde atiende este médico ({centers.length})
                  </div>

                  {centers.length === 0 ? (
                    <div style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic', padding: '6px 0' }}>
                      Este médico no tiene sedes asignadas. En el mapa aparecerá sin ubicación exacta hasta que le asignes al menos una sede.
                    </div>
                  ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '10px' }}>
                      {centers.map(cen => {
                        const isRemoving = actionLoading === `${doctor.id}-${cen.id}`;
                        return (
                          <div
                            key={cen.id}
                            style={{
                              backgroundColor: '#FFFFFF',
                              borderRadius: '12px',
                              padding: '10px 12px',
                              border: '1.5px solid #E2E8F0',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              gap: '10px'
                            }}
                          >
                            <div style={{ minWidth: 0, flexGrow: 1 }}>
                              <div style={{ fontSize: '13px', fontWeight: 700, color: '#00506E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {toTitleCase(cen.name)}
                              </div>
                              <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '2px' }}>
                                {cen.address}
                              </div>
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemove(doctor.id, cen.id)}
                              disabled={isRemoving}
                              title="Desvincular esta sede del médico"
                              style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: '#94A3B8',
                                padding: '4px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                transition: 'color 0.15s ease'
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.color = '#EF4444'; e.currentTarget.style.backgroundColor = '#FEF2F2'; }}
                              onMouseLeave={(e) => { e.currentTarget.style.color = '#94A3B8'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                            >
                              {isRemoving ? <div className="spinner" style={{ width: '14px', height: '14px' }}></div> : <X size={15} />}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {/* ──────────────── MODAL 1: ASIGNAR MÉDICOS A UN CENTRO ──────────────── */}
      {editingCenter && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 50, 80, 0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#00506E', margin: 0 }}>
                  Asignar Médicos a la Sede
                </h3>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0 0' }}>
                  {toTitleCase(editingCenter.name)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCenter(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Search */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <input
                type="text"
                value={modalDoctorSearch}
                onChange={(e) => setModalDoctorSearch(e.target.value)}
                placeholder="Buscar médico por nombre o CMP..."
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #CBD5E1',
                  fontSize: '13px',
                  color: '#00506E',
                  outline: 'none'
                }}
              />
            </div>

            {/* Doctors Checklist */}
            <div style={{ padding: '14px 20px', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allDoctors
                .filter(({ doctor }) => {
                  const q = modalDoctorSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (doctor.name || '').toLowerCase().includes(q) || (doctor.custom_fields?.['CMP'] || '').includes(q);
                })
                .map(({ doctor }) => {
                  const isChecked = selectedDoctorIds.has(doctor.id);
                  return (
                    <label
                      key={doctor.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        backgroundColor: isChecked ? '#F0FDFA' : '#F8FAFC',
                        border: `1.5px solid ${isChecked ? '#1EC8AA' : '#E2E8F0'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = new Set(selectedDoctorIds);
                          if (e.target.checked) next.add(doctor.id);
                          else next.delete(doctor.id);
                          setSelectedDoctorIds(next);
                        }}
                        style={{ accentColor: '#1EC8AA', width: '16px', height: '16px' }}
                      />
                      <div style={{ flexGrow: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#00506E' }}>
                          {toTitleCase(doctor.name)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748B' }}>
                          {doctor.custom_fields?.['CMP'] ? `CMP ${doctor.custom_fields['CMP']}` : ''}
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: '#F8FAFC' }}>
              <button
                type="button"
                onClick={() => setEditingCenter(null)}
                className="btn btn-secondary"
                disabled={modalSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveCenterDoctors}
                disabled={modalSaving}
                className="btn btn-primary"
                style={{ backgroundColor: '#1EC8AA', borderColor: '#1EC8AA', color: '#FFFFFF', fontWeight: 700 }}
              >
                {modalSaving ? 'Guardando...' : `Guardar Médicos (${selectedDoctorIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL 2: ASIGNAR SEDES A UN MÉDICO ──────────────── */}
      {editingDoctor && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 50, 80, 0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: '#FFFFFF',
            borderRadius: '20px',
            width: '100%',
            maxWidth: '560px',
            maxHeight: '85vh',
            display: 'flex',
            flexDirection: 'column',
            boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            overflow: 'hidden'
          }}>
            <div style={{ padding: '20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#00506E', margin: 0 }}>
                  Asignar Sedes al Médico
                </h3>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0 0' }}>
                  {toTitleCase(editingDoctor.name)} {editingDoctor.custom_fields?.['CMP'] ? `(CMP: ${editingDoctor.custom_fields['CMP']})` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingDoctor(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Search */}
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #F1F5F9' }}>
              <input
                type="text"
                value={modalCenterSearch}
                onChange={(e) => setModalCenterSearch(e.target.value)}
                placeholder="Buscar sede por nombre o dirección..."
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: '10px',
                  border: '1.5px solid #CBD5E1',
                  fontSize: '13px',
                  color: '#00506E',
                  outline: 'none'
                }}
              />
            </div>

            {/* Centers Checklist */}
            <div style={{ padding: '14px 20px', overflowY: 'auto', flexGrow: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {allCenters
                .filter(({ center }) => {
                  const q = modalCenterSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (center.name || '').toLowerCase().includes(q) || (center.address || '').toLowerCase().includes(q);
                })
                .map(({ center }) => {
                  const isChecked = selectedCenterIds.has(center.id);
                  return (
                    <label
                      key={center.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px',
                        padding: '10px 14px',
                        borderRadius: '12px',
                        backgroundColor: isChecked ? '#F0FDFA' : '#F8FAFC',
                        border: `1.5px solid ${isChecked ? '#1EC8AA' : '#E2E8F0'}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const next = new Set(selectedCenterIds);
                          if (e.target.checked) next.add(center.id);
                          else next.delete(center.id);
                          setSelectedCenterIds(next);
                        }}
                        style={{ accentColor: '#1EC8AA', width: '16px', height: '16px' }}
                      />
                      <div style={{ flexGrow: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 700, color: '#00506E' }}>
                          {toTitleCase(center.name)}
                        </div>
                        <div style={{ fontSize: '11px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {center.address}
                        </div>
                      </div>
                    </label>
                  );
                })}
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: '#F8FAFC' }}>
              <button
                type="button"
                onClick={() => setEditingDoctor(null)}
                className="btn btn-secondary"
                disabled={modalSaving}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveDoctorCenters}
                disabled={modalSaving}
                className="btn btn-primary"
                style={{ backgroundColor: '#1EC8AA', borderColor: '#1EC8AA', color: '#FFFFFF', fontWeight: 700 }}
              >
                {modalSaving ? 'Guardando...' : `Guardar Sedes (${selectedCenterIds.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ──────────────── MODAL 3: CREAR NUEVA SEDE MANUAL ──────────────── */}
      {isCreateCenterOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 50, 80, 0.5)',
          backdropFilter: 'blur(4px)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '20px'
        }}>
          <form
            onSubmit={handleCreateCenter}
            style={{
              backgroundColor: '#FFFFFF',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '500px',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
              overflow: 'hidden'
            }}
          >
            <div style={{ padding: '20px', borderBottom: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#00506E', margin: 0 }}>
                  Registrar Nueva Sede Médica
                </h3>
                <p style={{ fontSize: '12px', color: '#64748B', margin: '4px 0 0 0' }}>
                  Crea un centro o consultorio físico para asignar médicos
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateCenterOpen(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8' }}
              >
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#00506E', marginBottom: '6px' }}>
                  Nombre de la Sede / Centro Médico *
                </label>
                <input
                  type="text"
                  required
                  value={newCenterName}
                  onChange={(e) => setNewCenterName(e.target.value)}
                  placeholder="Ej. Clínica Delgado, Consultorio Miraflores..."
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#00506E', marginBottom: '6px' }}>
                  Dirección Física Completa *
                </label>
                <input
                  type="text"
                  required
                  value={newCenterAddress}
                  onChange={(e) => setNewCenterAddress(e.target.value)}
                  placeholder="Ej. Av. Angamos Oeste 401, Miraflores, Lima"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#00506E', marginBottom: '6px' }}>
                  Teléfono / Contacto (Opcional)
                </label>
                <input
                  type="text"
                  value={newCenterPhone}
                  onChange={(e) => setNewCenterPhone(e.target.value)}
                  placeholder="Ej. 999888777"
                  style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #CBD5E1', fontSize: '13px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#00506E', marginBottom: '6px' }}>
                    Latitud (Opcional)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newCenterLat}
                    onChange={(e) => setNewCenterLat(e.target.value)}
                    placeholder="-12.1123"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #CBD5E1', fontSize: '13px' }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: '12px', fontWeight: 700, color: '#00506E', marginBottom: '6px' }}>
                    Longitud (Opcional)
                  </label>
                  <input
                    type="number"
                    step="any"
                    value={newCenterLng}
                    onChange={(e) => setNewCenterLng(e.target.value)}
                    placeholder="-77.0298"
                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid #CBD5E1', fontSize: '13px' }}
                  />
                </div>
              </div>
            </div>

            <div style={{ padding: '16px 20px', borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'flex-end', gap: '10px', backgroundColor: '#F8FAFC' }}>
              <button
                type="button"
                onClick={() => setIsCreateCenterOpen(false)}
                className="btn btn-secondary"
                disabled={createSaving}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={createSaving}
                className="btn btn-primary"
                style={{ backgroundColor: '#1EC8AA', borderColor: '#1EC8AA', color: '#FFFFFF', fontWeight: 700 }}
              >
                {createSaving ? 'Creando...' : 'Crear Sede'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
