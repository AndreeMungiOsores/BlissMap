/**
 * locationService.ts
 * Centralized location loading, merging, and caching service for dashboard pages.
 */

import { supabase } from '../supabaseClient';
import { fetchB2BSalesLocations } from './b2bApiService';
import { fetchB2CLocations, filterBlissfarmaOnly, deduplicateB2BAgainstB2C } from './b2cApiService';
import localDoctorsData from '../data/doctors_data.json';
import { cleanRS, isRSMatch } from '../utils/stringUtils';
import { determineEntityType } from '../utils/entityUtils';
import type { LocationItem } from './groupService';
import type { Locator } from '../pages/dashboard/DashboardLayout';

const TEST_NAMES = ['daysi timana', 'winston maldonado', 'marjorie villate', 'giuliana peching'];

export const locationsMemoryCache = new Map<string, LocationItem[]>();

export const invalidateLocationsCache = (locatorId?: string) => {
  if (locatorId) {
    locationsMemoryCache.delete(locatorId);
  } else {
    locationsMemoryCache.clear();
  }
};

export const fetchLocatorLocations = async (
  activeLocator: Locator,
  forceRefresh = false
): Promise<LocationItem[]> => {
  if (!forceRefresh && locationsMemoryCache.has(activeLocator.id)) {
    return locationsMemoryCache.get(activeLocator.id)!;
  }

  // 1. Fetch live/cached API locations (B2B for default locators, or B2C+B2B mix for Blissfarma)
  let apiLocations: LocationItem[];

  if (activeLocator.slug === 'blissfarma') {
    const [b2cResult, b2bResult] = await Promise.all([
      fetchB2CLocations(),
      fetchB2BSalesLocations(localDoctorsData as any)
    ]);
    const b2bFiltered = filterBlissfarmaOnly(b2bResult.locations);
    const b2bDeduped = deduplicateB2BAgainstB2C(
      [...b2cResult.doctors, ...b2cResult.centers],
      b2bFiltered
    );
    apiLocations = [...b2cResult.doctors, ...b2cResult.centers, ...b2bDeduped];
  } else {
    const b2bRes = await fetchB2BSalesLocations(localDoctorsData as any);
    apiLocations = b2bRes.locations;
  }

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

  // 3. Merge: Apply DB manual overrides over API base locations with smart RUC + RS + CMP fallback
  const mergedList: LocationItem[] = apiLocations.map((apiLoc: any) => {
    let override = dbMap.get(apiLoc.id);

    if (!override) {
      const apiDocNum = (apiLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
      const apiRS =
        apiLoc.custom_fields?.['Razón Social'] ||
        apiLoc.custom_fields?.['Razon Social'] ||
        (apiLoc.custom_fields?.['entity_type'] === 'center' ? apiLoc.name : '') ||
        '';
      const apiCMP = (apiLoc.custom_fields?.['CMP'] || apiLoc.custom_fields?.['Colegiatura'] || '').replace(
        /\D/g,
        ''
      );
      const apiNameClean = (apiLoc.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const [dbId, dbItem] of dbMap.entries()) {
        const dbDocFromFields = (dbItem.custom_fields?.['Documento'] || '').replace(/\D/g, '');
        const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
        const dbDocNum = dbDocFromFields || dbDocFromId;
        const dbRS = dbItem.custom_fields?.['Razón Social'] || dbItem.custom_fields?.['Razon Social'] || '';
        const dbCMP = (dbItem.custom_fields?.['CMP'] || dbItem.custom_fields?.['Colegiatura'] || '').replace(
          /\D/g,
          ''
        );
        const dbNameClean = (dbItem.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        // 1. Document (RUC / DNI)
        if (dbDocNum && apiDocNum && dbDocNum === apiDocNum) {
          const nameMatch =
            !apiNameClean ||
            !dbNameClean ||
            apiNameClean.includes(dbNameClean) ||
            dbNameClean.includes(apiNameClean) ||
            apiNameClean.length < 4 ||
            dbNameClean.length < 4;
          if (nameMatch) {
            override = dbItem;
            dbMap.delete(dbId);
            break;
          }
        }

        // 2. Razón Social (RS) matching (crucial for centers/clinics)
        if (apiRS && dbRS && isRSMatch(apiRS, dbRS)) {
          override = dbItem;
          dbMap.delete(dbId);
          break;
        }
        if (apiLoc.name && dbRS && isRSMatch(apiLoc.name, dbRS)) {
          override = dbItem;
          dbMap.delete(dbId);
          break;
        }
        if (apiRS && dbItem.name && isRSMatch(apiRS, dbItem.name)) {
          override = dbItem;
          dbMap.delete(dbId);
          break;
        }

        // 3. CMP (Colegiatura) with name overlap
        if (apiCMP && dbCMP && apiCMP.replace(/^0+/, '') === dbCMP.replace(/^0+/, '')) {
          const nameMatch =
            !apiNameClean ||
            !dbNameClean ||
            apiNameClean.includes(dbNameClean) ||
            dbNameClean.includes(apiNameClean);
          if (nameMatch) {
            override = dbItem;
            dbMap.delete(dbId);
            break;
          }
        }
      }
    } else {
      dbMap.delete(apiLoc.id);
    }

    if (override) {
      const hasValidCoords = override.lat && override.lng && (override.lat !== 0 || override.lng !== 0);
      const newLat = hasValidCoords ? override.lat : apiLoc.lat;
      const newLng = hasValidCoords ? override.lng : apiLoc.lng;

      let updatedTags = Array.from(new Set([...(apiLoc.tags || []), ...(override.tags || [])]));
      if (hasValidCoords) {
        updatedTags = updatedTags.filter((t: string) => t !== 'Sin ubicación exacta');
      }

      const apiRS = apiLoc.custom_fields?.['Razón Social'] || apiLoc.custom_fields?.['Razon Social'] || '';
      const isOverrideJustRS = override.name && apiRS && isRSMatch(override.name, apiRS);
      const effectiveName =
        isOverrideJustRS && apiLoc.name && !isRSMatch(apiLoc.name, apiRS)
          ? apiLoc.name
          : override.name || apiLoc.name;

      return {
        ...apiLoc,
        ...override,
        id: apiLoc.id,
        name: effectiveName,
        address: override.address || apiLoc.address,
        lat: newLat,
        lng: newLng,
        tags: updatedTags,
        image_url: override.image_url || apiLoc.image_url || null,
        products:
          override.products && Array.isArray(override.products) && override.products.length > 0
            ? override.products
            : apiLoc.products,
        linked_entities: apiLoc.linked_entities || override.linked_entities,
        is_manual_override: true,
        custom_fields: {
          ...(apiLoc.custom_fields || {}),
          ...(override.custom_fields || {}),
          db_id: override.id,
          'Nombre Comercial': effectiveName,
          entity_type:
            override.custom_fields?.['entity_type'] ||
            apiLoc.custom_fields?.['entity_type'] ||
            determineEntityType({ ...apiLoc, ...override, custom_fields: { ...(apiLoc.custom_fields || {}), ...(override.custom_fields || {}) } }),
        },
        published: override.published !== undefined ? override.published : true,
        grupo_economico_ids: override.grupo_economico_ids || null,
      };
    }

    return {
      ...apiLoc,
      custom_fields: {
        ...(apiLoc.custom_fields || {}),
        entity_type: apiLoc.custom_fields?.['entity_type'] || determineEntityType(apiLoc),
      },
      is_manual_override: false,
      published: true,
      grupo_economico_ids: null,
    } as LocationItem;
  });

  // Build sets of RUCs and RS already represented in mergedList to avoid duplicates
  const mergedRucSet = new Set<string>();
  const mergedRSSet = new Set<string>();
  mergedList.forEach(loc => {
    const ruc = (loc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
    if (ruc) mergedRucSet.add(ruc);
    const rs = loc.custom_fields?.['Razón Social'] || loc.custom_fields?.['Razon Social'] || '';
    if (rs) mergedRSSet.add(cleanRS(rs));
  });

  // Add any truly new custom locations from DB that were not in API and not already covered
  dbMap.forEach((customDbLoc, dbId) => {
    const dbDocFromFields = (customDbLoc.custom_fields?.['Documento'] || '').replace(/\D/g, '');
    const dbDocFromId = (dbId.match(/\b(\d{8,11})\b/) || [])[1] || '';
    const dbDocNum = dbDocFromFields || dbDocFromId;
    const dbRS = customDbLoc.custom_fields?.['Razón Social'] || customDbLoc.custom_fields?.['Razon Social'] || '';
    const cleanDbRS = cleanRS(dbRS);

    if (dbDocNum && mergedRucSet.has(dbDocNum)) return;
    if (cleanDbRS && mergedRSSet.has(cleanDbRS)) return;

    mergedList.unshift({
      ...customDbLoc,
      is_manual_override: true,
      published: customDbLoc.published !== undefined ? customDbLoc.published : true,
      grupo_economico_ids: customDbLoc.grupo_economico_ids || null,
      custom_fields: {
        ...(customDbLoc.custom_fields || {}),
        entity_type:
          customDbLoc.custom_fields?.['entity_type'] ||
          determineEntityType(customDbLoc),
      },
    } as LocationItem);
  });

  // Rehydrate linked_entities from manual affiliations (centros_afiliados_ids & medicos_afiliados_ids)
  const parseIdList = (val: any): string[] => {
    if (!val) return [];
    if (Array.isArray(val)) return val;
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return String(val).split(',').map(s => s.trim()).filter(Boolean);
    }
    return [];
  };

  // Build secondary to primary group mapping
  const secondaryToPrimaryMap = new Map<string, string>();
  mergedList.forEach(loc => {
    if (loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0) {
      loc.grupo_economico_ids.forEach(secId => {
        if (secId !== loc.id) {
          secondaryToPrimaryMap.set(secId, loc.id);
        }
      });
    }
  });

  const locLookup = new Map<string, LocationItem>();
  mergedList.forEach(l => {
    locLookup.set(l.id, l);
    if (l.custom_fields?.['db_id']) {
      locLookup.set(l.custom_fields['db_id'], l);
    }
  });

  mergedList.forEach(loc => {
    const rawCenters = loc.custom_fields?.['centros_afiliados_ids'];
    if (rawCenters !== undefined) {
      const cids = parseIdList(rawCenters);
      const dedupedMap = new Map<string, LocationItem>();
      cids.forEach(cid => {
        const canonicalId = secondaryToPrimaryMap.get(cid) || cid;
        const target = locLookup.get(canonicalId);
        if (target && !dedupedMap.has(target.id)) {
          dedupedMap.set(target.id, target);
        }
      });
      loc.linked_entities = Array.from(dedupedMap.values());
    }

    const rawDoctors = loc.custom_fields?.['medicos_afiliados_ids'];
    if (rawDoctors !== undefined) {
      const dids = parseIdList(rawDoctors);
      const dedupedMap = new Map<string, LocationItem>();
      dids.forEach(did => {
        const target = locLookup.get(did);
        if (target && !dedupedMap.has(target.id)) {
          dedupedMap.set(target.id, target);
        }
      });
      loc.linked_entities = Array.from(dedupedMap.values());

      if ((!loc.products || loc.products.length === 0) && loc.linked_entities.length > 0) {
        const prodMap = new Map<string, any>();
        loc.linked_entities.forEach(d => {
          (d.products || []).forEach(p => {
            if (!prodMap.has(p.name)) prodMap.set(p.name, p);
          });
        });
        loc.products = Array.from(prodMap.values());
      }
    }
  });

  const filtered = mergedList.filter(
    loc => !TEST_NAMES.some(tn => loc.name.toLowerCase().includes(tn))
  );

  locationsMemoryCache.set(activeLocator.id, filtered);
  return filtered;
};
