/**
 * groupService.ts
 * Logic for detecting, unifiying, and managing economic groups of locations
 * across BlissMap locators (MedicosBliss and Blissfarma).
 */

import { supabase } from '../supabaseClient';
import { removeAccents, nameSimilarity } from '../utils/stringUtils';

export interface ProductItem {
  name: string;
  qty: number;
  last_date?: string;
  brand?: string;
}

export interface LocationItem {
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
  published?: boolean;
  products?: ProductItem[];
  created_at?: string;
  is_manual_override?: boolean;
  grupo_economico_ids?: string[] | null;
}

export interface SuggestedGroup {
  ids: string[];
  name: string;
  address: string;
  totalProducts: number;
  rucs: string[];
  members: LocationItem[];
  primaryId: string;
}

export interface ActiveGroup {
  primary: LocationItem;
  members: LocationItem[];
  secondaryMembers: LocationItem[];
  totalProducts: number;
  combinedProducts: ProductItem[];
  rucs: string[];
}

export const normalizeAddress = (addr: string): string =>
  removeAccents(addr)
    .replace(/\bav\b\.?/g, 'av')
    .replace(/\bjr\b\.?/g, 'jr')
    .replace(/\bcalle\b/g, 'cl')
    .replace(/\bnro\b\.?/g, '')
    .replace(/\bnumero\b/g, '')
    .replace(/[.,#°]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Detect possible economic groups based on high address similarity (>= 0.75)
 * and name similarity (>= 0.55).
 */
export const detectPossibleGroups = (list: LocationItem[]): SuggestedGroup[] => {
  const groups: SuggestedGroup[] = [];
  const used = new Set<string>();

  for (let i = 0; i < list.length; i++) {
    if (used.has(list[i].id)) continue;
    const addrI = normalizeAddress(list[i].address);
    if (!addrI || addrI.length < 8) continue;
    const peers: LocationItem[] = [list[i]];

    for (let j = i + 1; j < list.length; j++) {
      if (used.has(list[j].id) || list[j].id === list[i].id) continue;
      // Skip if already in an active unified group
      if (
        list[i].grupo_economico_ids?.includes(list[j].id) ||
        list[j].grupo_economico_ids?.includes(list[i].id)
      ) {
        continue;
      }
      const addrJ = normalizeAddress(list[j].address);
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
      allProducts.forEach(p => {
        if (!uniqueProducts.has(p.name)) uniqueProducts.set(p.name, p);
      });

      // Default primary: member with the most products or image
      const defaultPrimary = peers.reduce((best, cur) => {
        const curScore = (cur.products?.length || 0) * 10 + (cur.image_url ? 5 : 0);
        const bestScore = (best.products?.length || 0) * 10 + (best.image_url ? 5 : 0);
        return curScore >= bestScore ? cur : best;
      }, peers[0]);

      groups.push({
        ids: peers.map(p => p.id),
        name: defaultPrimary.name,
        address: defaultPrimary.address,
        totalProducts: uniqueProducts.size,
        rucs: peers.map(p => p.custom_fields?.['Documento'] || '').filter(Boolean),
        members: peers,
        primaryId: defaultPrimary.id,
      });
    }
  }
  return groups;
};

/**
 * Get active unified groups from a list of locations.
 */
export const getActiveGroups = (list: LocationItem[]): ActiveGroup[] => {
  const primaryLocs = list.filter(
    loc => loc.grupo_economico_ids && loc.grupo_economico_ids.length > 0
  );

  return primaryLocs.map(primary => {
    const memberIds = primary.grupo_economico_ids || [];
    let members = list.filter(l => memberIds.includes(l.id));
    if (!members.some(m => m.id === primary.id)) {
      members = [primary, ...members];
    }
    const secondaryMembers = members.filter(m => m.id !== primary.id);

    const allProducts = members.flatMap(m => m.products || []);
    const uniqueProducts = new Map<string, ProductItem>();
    allProducts.forEach(p => {
      if (!uniqueProducts.has(p.name)) uniqueProducts.set(p.name, p);
    });

    const rucs = Array.from(
      new Set(
        members
          .map(m => m.custom_fields?.['Documento'])
          .filter((d): d is string => Boolean(d))
      )
    );

    return {
      primary,
      members,
      secondaryMembers,
      totalProducts: uniqueProducts.size,
      combinedProducts: Array.from(uniqueProducts.values()),
      rucs,
    };
  });
};

/**
 * Unify an economic group by setting grupo_economico_ids on the chosen primary location.
 */
export const unifyEconomicGroup = async (
  activeLocatorId: string,
  group: SuggestedGroup,
  chosenPrimaryId?: string
): Promise<void> => {
  const primaryId = chosenPrimaryId || group.primaryId;
  const primary = group.members.find(m => m.id === primaryId) || group.members[0];

  const payload: any = {
    id: primary.id,
    locator_id: activeLocatorId,
    name: primary.name,
    address: primary.address,
    lat: primary.lat ?? 0,
    lng: primary.lng ?? 0,
    image_url: primary.image_url || null,
    custom_fields: primary.custom_fields || {},
    published: primary.published !== false,
    grupo_economico_ids: group.ids,
  };

  const { error } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
};

/**
 * Update the primary entity of an active economic group.
 * Removes grupo_economico_ids from the previous primary and assigns it to the new primary.
 */
export const updateGroupPrimary = async (
  activeLocatorId: string,
  oldPrimary: LocationItem,
  newPrimary: LocationItem,
  allMemberIds: string[]
): Promise<void> => {
  if (oldPrimary.id === newPrimary.id) {
    return;
  }

  const memberIdsSet = new Set(allMemberIds);
  memberIdsSet.add(oldPrimary.id);
  memberIdsSet.add(newPrimary.id);
  const updatedIds = Array.from(memberIdsSet);

  // 1. Remove grupo_economico_ids from old primary
  const { error: removeErr } = await supabase
    .from('bm_locations')
    .update({ grupo_economico_ids: null })
    .eq('id', oldPrimary.id);

  if (removeErr) throw removeErr;

  // 2. Assign grupo_economico_ids to the new primary
  const payload: any = {
    id: newPrimary.id,
    locator_id: activeLocatorId,
    name: newPrimary.name,
    address: newPrimary.address || oldPrimary.address,
    lat: (newPrimary.lat && newPrimary.lat !== 0) ? newPrimary.lat : (oldPrimary.lat ?? 0),
    lng: (newPrimary.lng && newPrimary.lng !== 0) ? newPrimary.lng : (oldPrimary.lng ?? 0),
    image_url: newPrimary.image_url || null,
    custom_fields: newPrimary.custom_fields || {},
    published: newPrimary.published !== false,
    grupo_economico_ids: updatedIds,
  };

  const { error: upsertErr } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (upsertErr) throw upsertErr;
};

/**
 * Dissolve an existing economic group by removing grupo_economico_ids.
 */
export const dissolveEconomicGroup = async (primaryId: string): Promise<void> => {
  const { error } = await supabase
    .from('bm_locations')
    .update({ grupo_economico_ids: null })
    .eq('id', primaryId);

  if (error) throw error;
};

/**
 * Manually create a new economic group with a specified primary and member list.
 */
export const createManualGroup = async (
  activeLocatorId: string,
  primary: LocationItem,
  memberIds: string[]
): Promise<void> => {
  const memberIdsSet = new Set(memberIds);
  memberIdsSet.add(primary.id);
  const finalIds = Array.from(memberIdsSet);

  const payload: any = {
    id: primary.id,
    locator_id: activeLocatorId,
    name: primary.name,
    address: primary.address,
    lat: primary.lat ?? 0,
    lng: primary.lng ?? 0,
    image_url: primary.image_url || null,
    custom_fields: primary.custom_fields || {},
    published: primary.published !== false,
    grupo_economico_ids: finalIds,
  };

  const { error } = await supabase
    .from('bm_locations')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw error;
};
