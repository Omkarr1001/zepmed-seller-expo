import AsyncStorage from '@react-native-async-storage/async-storage';

export const REJECTED_ORDERS_KEY = 'zepmed:seller:rejected-orders-v1';

type RejectedSnap = {
  id: number;
  order_number: string;
  status: string;
  total_amount: number;
  customer_name?: string | null;
  created_at?: string | null;
  payment_method?: string | null;
  address_line?: string | null;
  city?: string | null;
  pincode?: string | null;
  order_type?: string | null;
  is_prescription_order?: boolean | null;
};

const rejectedById = new Map<number, RejectedSnap>();

function asSnap(order: RejectedSnap): RejectedSnap | null {
  const id = Number(order?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  return {
    id,
    order_number: String(order.order_number || `Order #${id}`),
    status: 'rejected',
    total_amount: Number(order.total_amount || 0) || 0,
    customer_name: order.customer_name ?? null,
    created_at: order.created_at ?? null,
    payment_method: order.payment_method ?? null,
    address_line: order.address_line ?? null,
    city: order.city ?? null,
    pincode: order.pincode ?? null,
    order_type: order.order_type ?? null,
    is_prescription_order: order.is_prescription_order ?? null,
  };
}

async function persist() {
  await AsyncStorage.setItem(REJECTED_ORDERS_KEY, JSON.stringify([...rejectedById.values()]));
}

export async function hydrateRejectedOrders() {
  try {
    const raw = await AsyncStorage.getItem(REJECTED_ORDERS_KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : [];
    if (Array.isArray(parsed)) {
      for (const row of parsed) {
        const snap = asSnap(row as RejectedSnap);
        if (snap) rejectedById.set(snap.id, snap);
      }
    }
  } catch {
    // keep memory
  }
  return rejectedList();
}

export async function rememberRejectedOrder(order: RejectedSnap) {
  const snap = asSnap({ ...order, status: 'rejected' });
  if (!snap) return;
  rejectedById.set(snap.id, snap);
  await persist();
}

export function rejectedList(): RejectedSnap[] {
  return [...rejectedById.values()];
}

export function mergeRejectedSnaps<T extends { id: number; status?: string | null }>(
  orders: T[],
  snaps: ReadonlyArray<{ id: number; status?: string | null }>,
): T[] {
  const byId = new Map(orders.map((order) => [order.id, order]));
  for (const snap of snaps) {
    const id = Number(snap?.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const forced = { ...snap, id, status: 'rejected' as const };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, forced as T);
      continue;
    }
    const status = String(existing.status || '').toLowerCase();
    if (status !== 'rejected' && status !== 'cancelled') {
      byId.set(id, { ...existing, ...forced, status: 'rejected' } as T);
    }
  }
  return [...byId.values()];
}

export function mergeRejectedIntoOrders<T extends { id: number; status?: string | null }>(orders: T[]): T[] {
  return mergeRejectedSnaps(orders, rejectedList());
}
