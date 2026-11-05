import AsyncStorage from '@react-native-async-storage/async-storage';

export const MUTED_ORDER_IDS_KEY = 'muted_order_ids';

const mutedOrderIds = new Set<number>();
const listeners = new Set<() => void>();

function notifyMuted() {
  for (const listener of listeners) listener();
}

function parseMutedIds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

export function subscribeMutedOrders(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isOrderMuted(orderId: number) {
  return mutedOrderIds.has(orderId);
}

export function mutedOrderIdList() {
  return [...mutedOrderIds];
}

async function persistMuted() {
  await AsyncStorage.setItem(MUTED_ORDER_IDS_KEY, JSON.stringify([...mutedOrderIds]));
}

export async function hydrateMutedOrderIds() {
  try {
    const raw = await AsyncStorage.getItem(MUTED_ORDER_IDS_KEY);
    // Merge, never clear first. Clearing dropped an in-memory mute when a
    // notification handler reloaded storage before persist finished, so the
    // bell came back a few seconds later.
    for (const id of parseMutedIds(raw)) mutedOrderIds.add(id);
  } catch {
    // Keep whatever is already in memory.
  }
  notifyMuted();
  return mutedOrderIdList();
}

export async function muteOrder(orderId: number) {
  if (orderId <= 0) return;
  mutedOrderIds.add(orderId);
  await persistMuted();
  notifyMuted();
}

export async function unmuteOrder(orderId: number) {
  mutedOrderIds.delete(orderId);
  await persistMuted();
  notifyMuted();
}
