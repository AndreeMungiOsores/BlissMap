/**
 * affiliationService.ts
 * Manages relationships between Doctors and Medical Centers (Sedes)
 * across BlissMap locators. Supports N:M assignments, updates, and Supabase persistence.
 */

import { supabase } from '../supabaseClient';
import type { LocationItem } from './groupService';
import { invalidateLocationsCache } from './locationService';
import { determineEntityType } from '../utils/entityUtils';
import { nameSimilarity } from '../utils/stringUtils';

export interface AffiliatedCenterView {
  center: LocationItem;
  doctors: LocationItem[];
}

export interface AffiliatedDoctorView {
  doctor: LocationItem;
  centers: LocationItem[];
}

/**
 * Safely parses string[] of IDs stored in custom_fields (which may be an array, JSON string, or comma-separated).
 */
export const parseIdList = (val: any): string[] => {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(v => String(v).trim()).filter(Boolean);
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.map(v => String(v).trim()).filter(Boolean);
      } catch {
        // fallback to split
      }
    }
    return trimmed.split(',').map(v => v.trim()).filter(Boolean);
  }
  return [];
};

/**
 * Determines whether a LocationItem is a Doctor or a Center.
 */
export const getEntityType = (loc: LocationItem): 'doctor' | 'center' => {
  return determineEntityType(loc);
};

/**
 * Builds a unified map of Center -> Doctors and Doctor -> Centers
 * by blending live API `linked_entities` with manual DB overrides from `custom_fields`.
 */
export const resolveAllAffiliations = (
  locations: LocationItem[]
): {
  centers: AffiliatedCenterView[];
  doctors: AffiliatedDoctorView[];
} => {
  // Extract secondary-to-primary mapping for corporate economic groups
  const secondaryToPrimaryMap = new Map<string, string>();
  const secondaryIdsSet = new Set<string>();

  locations.forEach(loc => {
    if (loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0) {
      loc.grupo_economico_ids.forEach(secId => {
        if (secId !== loc.id) {
          secondaryToPrimaryMap.set(secId, loc.id);
          secondaryIdsSet.add(secId);
        }
      });
    }
  });

  locations.forEach(loc => {
    if (secondaryIdsSet.has(loc.id) && loc.custom_fields?.['db_id']) {
      const primaryId = secondaryToPrimaryMap.get(loc.id);
      if (primaryId) {
        secondaryToPrimaryMap.set(loc.custom_fields['db_id'], primaryId);
        secondaryIdsSet.add(loc.custom_fields['db_id']);
      }
    }
  });

  const doctorList = locations.filter(l => getEntityType(l) === 'doctor');
  // Only expose primary medical centers; secondary group duplicates are unified into their primary
  const centerList = locations.filter(l => getEntityType(l) === 'center' && !secondaryIdsSet.has(l.id));

  const locById = new Map<string, LocationItem>();
  locations.forEach(l => locById.set(l.id, l));

  // Relationships maps:
  // Key: doctorId -> Set<centerId>
  const doctorToCenters = new Map<string, Set<string>>();
  // Key: centerId -> Set<doctorId>
  const centerToDoctors = new Map<string, Set<string>>();

  // 1. Initialize from existing linked_entities (from API)
  doctorList.forEach(doc => {
    const set = doctorToCenters.get(doc.id) || new Set<string>();
    (doc.linked_entities || []).forEach(c => {
      const canonicalId = secondaryToPrimaryMap.get(c.id) || c.id;
      if (!secondaryIdsSet.has(canonicalId)) {
        set.add(canonicalId);
      }
    });
    // Overlay manual override if present
    const manualCenters = parseIdList(doc.custom_fields?.['centros_afiliados_ids']);
    if (manualCenters.length > 0) {
      set.clear();
      manualCenters.forEach(cid => {
        const canonicalId = secondaryToPrimaryMap.get(cid) || cid;
        if (!secondaryIdsSet.has(canonicalId)) {
          set.add(canonicalId);
        }
      });
    }
    doctorToCenters.set(doc.id, set);
  });

  centerList.forEach(cen => {
    const set = centerToDoctors.get(cen.id) || new Set<string>();
    (cen.linked_entities || []).forEach(d => set.add(d.id));
    // Overlay manual override if present
    const manualDoctors = parseIdList(cen.custom_fields?.['medicos_afiliados_ids']);
    if (manualDoctors.length > 0) {
      set.clear();
      manualDoctors.forEach(did => set.add(did));
    }
    centerToDoctors.set(cen.id, set);
  });

  // Auto-link B2B centers to matching doctors in doctorList if no manual override exists
  centerList.forEach(cen => {
    if (cen.custom_fields?.['medicos_afiliados_ids'] !== undefined) return;
    let b2bDocName = cen.custom_fields?.['Médico'];
    let b2bCmp = (cen.custom_fields?.['Colegiatura'] || cen.custom_fields?.['CMP'] || '').replace(/\D/g, '');

    // If primary lacks doctor metadata, check secondary members of its economic group
    if (!b2bDocName && !b2bCmp && cen.grupo_economico_ids) {
      for (const secId of cen.grupo_economico_ids) {
        const secLoc = locById.get(secId);
        if (secLoc) {
          if (!b2bDocName && secLoc.custom_fields?.['Médico']) {
            b2bDocName = secLoc.custom_fields['Médico'];
          }
          if (!b2bCmp && (secLoc.custom_fields?.['Colegiatura'] || secLoc.custom_fields?.['CMP'])) {
            b2bCmp = (secLoc.custom_fields['Colegiatura'] || secLoc.custom_fields['CMP'] || '').replace(/\D/g, '');
          }
        }
      }
    }

    if (b2bDocName || b2bCmp) {
      const match = doctorList.find(d => {
        const dCmp = (d.custom_fields?.['CMP'] || d.custom_fields?.['Colegiatura'] || '').replace(/\D/g, '');
        if (b2bCmp && dCmp && b2bCmp === dCmp) return true;
        if (b2bDocName && nameSimilarity(d.name, b2bDocName) > 0.8) return true;
        return false;
      });
      if (match) {
        const set = centerToDoctors.get(cen.id) || new Set<string>();
        set.add(match.id);
        centerToDoctors.set(cen.id, set);
      }
    }
  });

  // Cross-pollinate bi-directionally
  doctorToCenters.forEach((centerIds, doctorId) => {
    centerIds.forEach(centerId => {
      let docSet = centerToDoctors.get(centerId);
      if (!docSet) {
        docSet = new Set<string>();
        centerToDoctors.set(centerId, docSet);
      }
      docSet.add(doctorId);
    });
  });

  centerToDoctors.forEach((doctorIds, centerId) => {
    doctorIds.forEach(doctorId => {
      let cenSet = doctorToCenters.get(doctorId);
      if (!cenSet) {
        cenSet = new Set<string>();
        doctorToCenters.set(doctorId, cenSet);
      }
      cenSet.add(centerId);
    });
  });

  // Build final structured views
  const centers: AffiliatedCenterView[] = centerList.map(cen => {
    const docIds = Array.from(centerToDoctors.get(cen.id) || []);
    const docs = docIds
      .map(id => locById.get(id))
      .filter((d): d is LocationItem => d !== undefined);
    return {
      center: cen,
      doctors: docs,
    };
  });

  const doctors: AffiliatedDoctorView[] = doctorList.map(doc => {
    const cenIds = Array.from(doctorToCenters.get(doc.id) || []);
    const cens = cenIds
      .map(id => locById.get(id))
      .filter((c): c is LocationItem => c !== undefined);
    return {
      doctor: doc,
      centers: cens,
    };
  });

  return { centers, doctors };
};

/**
 * Persist updated center affiliations for a specific doctor.
 */
export const updateDoctorCenters = async (
  activeLocatorId: string,
  doctor: LocationItem,
  newCenterIds: string[],
  allLocations: LocationItem[]
): Promise<void> => {
  const currentCenterIds = parseIdList(doctor.custom_fields?.['centros_afiliados_ids']) || 
    (doctor.linked_entities || []).map(c => c.id);

  const addedCenters = newCenterIds.filter(id => !currentCenterIds.includes(id));
  const removedCenters = currentCenterIds.filter(id => !newCenterIds.includes(id));

  // 1. Update doctor in Supabase
  const updatedDoctorCustomFields = {
    ...(doctor.custom_fields || {}),
    entity_type: 'doctor',
    centros_afiliados_ids: JSON.stringify(newCenterIds),
  };

  const doctorPayload: any = {
    id: doctor.id,
    locator_id: activeLocatorId,
    name: doctor.name,
    address: doctor.address,
    lat: doctor.lat ?? 0,
    lng: doctor.lng ?? 0,
    image_url: doctor.image_url || null,
    phone: doctor.phone || null,
    tags: doctor.tags || [],
    custom_fields: updatedDoctorCustomFields,
    published: doctor.published !== false,
  };

  const { error: docErr } = await supabase
    .from('bm_locations')
    .upsert(doctorPayload, { onConflict: 'id' });

  if (docErr) throw docErr;

  // 2. Synchronize added centers
  for (const centerId of addedCenters) {
    const center = allLocations.find(l => l.id === centerId);
    if (!center) continue;

    const existingDoctors = parseIdList(center.custom_fields?.['medicos_afiliados_ids']) ||
      (center.linked_entities || []).map(d => d.id);
    if (!existingDoctors.includes(doctor.id)) {
      existingDoctors.push(doctor.id);
      const centerPayload: any = {
        id: center.id,
        locator_id: activeLocatorId,
        name: center.name,
        address: center.address,
        lat: center.lat ?? 0,
        lng: center.lng ?? 0,
        image_url: center.image_url || null,
        phone: center.phone || null,
        tags: center.tags || [],
        custom_fields: {
          ...(center.custom_fields || {}),
          entity_type: 'center',
          medicos_afiliados_ids: JSON.stringify(existingDoctors),
        },
        published: center.published !== false,
      };
      await supabase.from('bm_locations').upsert(centerPayload, { onConflict: 'id' });
    }
  }

  // 3. Synchronize removed centers
  for (const centerId of removedCenters) {
    const center = allLocations.find(l => l.id === centerId);
    if (!center) continue;

    const existingDoctors = (parseIdList(center.custom_fields?.['medicos_afiliados_ids']) ||
      (center.linked_entities || []).map(d => d.id))
      .filter(id => id !== doctor.id);

    const centerPayload: any = {
      id: center.id,
      locator_id: activeLocatorId,
      name: center.name,
      address: center.address,
      lat: center.lat ?? 0,
      lng: center.lng ?? 0,
      image_url: center.image_url || null,
      phone: center.phone || null,
      tags: center.tags || [],
      custom_fields: {
        ...(center.custom_fields || {}),
        entity_type: 'center',
        medicos_afiliados_ids: JSON.stringify(existingDoctors),
      },
      published: center.published !== false,
    };
    await supabase.from('bm_locations').upsert(centerPayload, { onConflict: 'id' });
  }

  invalidateLocationsCache(activeLocatorId);
};

/**
 * Persist updated doctor affiliations for a specific center.
 */
export const updateCenterDoctors = async (
  activeLocatorId: string,
  center: LocationItem,
  newDoctorIds: string[],
  allLocations: LocationItem[]
): Promise<void> => {
  const currentDoctorIds = parseIdList(center.custom_fields?.['medicos_afiliados_ids']) || 
    (center.linked_entities || []).map(d => d.id);

  const addedDoctors = newDoctorIds.filter(id => !currentDoctorIds.includes(id));
  const removedDoctors = currentDoctorIds.filter(id => !newDoctorIds.includes(id));

  // 1. Update center in Supabase
  const updatedCenterCustomFields = {
    ...(center.custom_fields || {}),
    entity_type: 'center',
    medicos_afiliados_ids: JSON.stringify(newDoctorIds),
  };

  const centerPayload: any = {
    id: center.id,
    locator_id: activeLocatorId,
    name: center.name,
    address: center.address,
    lat: center.lat ?? 0,
    lng: center.lng ?? 0,
    image_url: center.image_url || null,
    phone: center.phone || null,
    tags: center.tags || [],
    custom_fields: updatedCenterCustomFields,
    published: center.published !== false,
  };

  const { error: cenErr } = await supabase
    .from('bm_locations')
    .upsert(centerPayload, { onConflict: 'id' });

  if (cenErr) throw cenErr;

  // 2. Synchronize added doctors
  for (const docId of addedDoctors) {
    const doc = allLocations.find(l => l.id === docId);
    if (!doc) continue;

    const existingCenters = parseIdList(doc.custom_fields?.['centros_afiliados_ids']) ||
      (doc.linked_entities || []).map(c => c.id);
    if (!existingCenters.includes(center.id)) {
      existingCenters.push(center.id);
      const docPayload: any = {
        id: doc.id,
        locator_id: activeLocatorId,
        name: doc.name,
        address: doc.address,
        lat: doc.lat ?? 0,
        lng: doc.lng ?? 0,
        image_url: doc.image_url || null,
        phone: doc.phone || null,
        tags: doc.tags || [],
        custom_fields: {
          ...(doc.custom_fields || {}),
          entity_type: 'doctor',
          centros_afiliados_ids: JSON.stringify(existingCenters),
        },
        published: doc.published !== false,
      };
      await supabase.from('bm_locations').upsert(docPayload, { onConflict: 'id' });
    }
  }

  // 3. Synchronize removed doctors
  for (const docId of removedDoctors) {
    const doc = allLocations.find(l => l.id === docId);
    if (!doc) continue;

    const existingCenters = (parseIdList(doc.custom_fields?.['centros_afiliados_ids']) ||
      (doc.linked_entities || []).map(c => c.id))
      .filter(id => id !== center.id);

    const docPayload: any = {
      id: doc.id,
      locator_id: activeLocatorId,
      name: doc.name,
      address: doc.address,
      lat: doc.lat ?? 0,
      lng: doc.lng ?? 0,
      image_url: doc.image_url || null,
      phone: doc.phone || null,
      tags: doc.tags || [],
      custom_fields: {
        ...(doc.custom_fields || {}),
        entity_type: 'doctor',
        centros_afiliados_ids: JSON.stringify(existingCenters),
      },
      published: doc.published !== false,
    };
    await supabase.from('bm_locations').upsert(docPayload, { onConflict: 'id' });
  }

  invalidateLocationsCache(activeLocatorId);
};

/**
 * Remove a single link between a doctor and a center atomically.
 */
export const removeSingleAffiliation = async (
  activeLocatorId: string,
  doctorId: string,
  centerId: string,
  allLocations: LocationItem[]
): Promise<void> => {
  const doc = allLocations.find(l => l.id === doctorId);
  const cen = allLocations.find(l => l.id === centerId);

  if (doc) {
    const idsToRemove = new Set<string>([centerId]);
    if (cen?.grupo_economico_ids) {
      cen.grupo_economico_ids.forEach(id => idsToRemove.add(id));
    }
    const currentCenters = (parseIdList(doc.custom_fields?.['centros_afiliados_ids']) ||
      (doc.linked_entities || []).map(c => c.id))
      .filter(id => !idsToRemove.has(id));

    await supabase.from('bm_locations').upsert({
      id: doc.id,
      locator_id: activeLocatorId,
      name: doc.name,
      address: doc.address,
      lat: doc.lat ?? 0,
      lng: doc.lng ?? 0,
      image_url: doc.image_url || null,
      phone: doc.phone || null,
      tags: doc.tags || [],
      custom_fields: {
        ...(doc.custom_fields || {}),
        entity_type: 'doctor',
        centros_afiliados_ids: JSON.stringify(currentCenters),
      },
      published: doc.published !== false,
    }, { onConflict: 'id' });
  }

  if (cen) {
    const currentDoctors = (parseIdList(cen.custom_fields?.['medicos_afiliados_ids']) ||
      (cen.linked_entities || []).map(d => d.id))
      .filter(id => id !== doctorId);
    await supabase.from('bm_locations').upsert({
      id: cen.id,
      locator_id: activeLocatorId,
      name: cen.name,
      address: cen.address,
      lat: cen.lat ?? 0,
      lng: cen.lng ?? 0,
      image_url: cen.image_url || null,
      phone: cen.phone || null,
      tags: cen.tags || [],
      custom_fields: {
        ...(cen.custom_fields || {}),
        entity_type: 'center',
        medicos_afiliados_ids: JSON.stringify(currentDoctors),
      },
      published: cen.published !== false,
    }, { onConflict: 'id' });

    // Also clean up any secondary group members in DB if they existed
    if (cen.grupo_economico_ids && cen.grupo_economico_ids.length > 0) {
      for (const secId of cen.grupo_economico_ids) {
        if (secId !== cen.id) {
          const secLoc = allLocations.find(l => l.id === secId);
          if (secLoc) {
            const secDoctors = (parseIdList(secLoc.custom_fields?.['medicos_afiliados_ids']) ||
              (secLoc.linked_entities || []).map(d => d.id))
              .filter(id => id !== doctorId);
            await supabase.from('bm_locations').upsert({
              id: secLoc.id,
              locator_id: activeLocatorId,
              name: secLoc.name,
              address: secLoc.address,
              lat: secLoc.lat ?? 0,
              lng: secLoc.lng ?? 0,
              image_url: secLoc.image_url || null,
              phone: secLoc.phone || null,
              tags: secLoc.tags || [],
              custom_fields: {
                ...(secLoc.custom_fields || {}),
                entity_type: 'center',
                medicos_afiliados_ids: JSON.stringify(secDoctors),
              },
              published: secLoc.published !== false,
            }, { onConflict: 'id' });
          }
        }
      }
    }
  }

  invalidateLocationsCache(activeLocatorId);
};

/**
 * Manually register a new medical center (sede) in Supabase.
 */
export const createManualCenter = async (
  activeLocatorId: string,
  data: {
    name: string;
    address: string;
    lat?: number;
    lng?: number;
    phone?: string;
    initialDoctorIds?: string[];
  },
  allLocations: LocationItem[]
): Promise<LocationItem> => {
  const newId = `custom-center-${Date.now()}`;
  const initialDocs = data.initialDoctorIds || [];

  const payload: any = {
    id: newId,
    locator_id: activeLocatorId,
    name: data.name,
    address: data.address,
    lat: data.lat ?? 0,
    lng: data.lng ?? 0,
    image_url: null,
    phone: data.phone || null,
    tags: ['Centro Médico', 'Manual Admin'],
    custom_fields: {
      entity_type: 'center',
      'Razón Social': data.name,
      'Nombre Comercial': data.name,
      medicos_afiliados_ids: JSON.stringify(initialDocs),
    },
    published: true,
  };

  const { data: inserted, error } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' })
    .select()
    .single();

  if (error) throw error;

  // Sync initial doctors if any
  for (const docId of initialDocs) {
    const doc = allLocations.find(l => l.id === docId);
    if (!doc) continue;
    const existingCenters = parseIdList(doc.custom_fields?.['centros_afiliados_ids']) ||
      (doc.linked_entities || []).map(c => c.id);
    if (!existingCenters.includes(newId)) {
      existingCenters.push(newId);
      await supabase.from('bm_locations').upsert({
        id: doc.id,
        locator_id: activeLocatorId,
        name: doc.name,
        address: doc.address,
        lat: doc.lat ?? 0,
        lng: doc.lng ?? 0,
        image_url: doc.image_url || null,
        phone: doc.phone || null,
        tags: doc.tags || [],
        custom_fields: {
          ...(doc.custom_fields || {}),
          entity_type: 'doctor',
          centros_afiliados_ids: JSON.stringify(existingCenters),
        },
        published: doc.published !== false,
      }, { onConflict: 'id' });
    }
  }

  invalidateLocationsCache(activeLocatorId);
  return inserted as LocationItem;
};
