import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

type RingNative = {
  setSession: (loggedIn: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setAppActive: (active: boolean) => void;
  show: (orderId: number, title: string, body: string) => void;
  dismiss: () => void;
  mute: (orderId: number) => void;
  unmute: (orderId: number) => void;
  syncMuted: (ids: number[]) => void;
};

export type SellerRingEvent = { orderId: number; title: string; body: string };

function native(): RingNative | null {
  if (Platform.OS !== 'android') return null;
  return (NativeModules.SellerOrderRing as RingNative | undefined) ?? null;
}

export function setSellerRingSession(loggedIn: boolean) {
  native()?.setSession(loggedIn);
}

export function setSellerRingSound(enabled: boolean) {
  native()?.setSoundEnabled(enabled);
}

export function setSellerRingAppActive(active: boolean) {
  native()?.setAppActive(active);
}

export function showSellerOrderRing(order: {
  id: number;
  order_number?: string | null;
  customer_name?: string | null;
  total_amount?: number | null;
}) {
  if (!order?.id) return;
  const title = `New order ${order.order_number || ''}`.trim();
  const who = String(order.customer_name || 'Customer').trim() || 'Customer';
  const amount = Number(order.total_amount || 0);
  const body = amount > 0 ? `${who} · ₹${Math.round(amount)}` : who;
  native()?.show(order.id, title, body);
}

export function dismissSellerRing() {
  native()?.dismiss();
}

export function muteSellerOrder(orderId: number) {
  if (orderId > 0) native()?.mute(orderId);
}

export function unmuteSellerOrder(orderId: number) {
  if (orderId > 0) native()?.unmute(orderId);
}

export function syncSellerMutedIds(ids: number[]) {
  native()?.syncMuted(ids.filter((id) => Number.isFinite(id) && id > 0));
}

export function subscribeSellerOrderRing(listener: (event: SellerRingEvent) => void) {
  if (Platform.OS !== 'android') return () => undefined;
  const sub = DeviceEventEmitter.addListener('sellerOrderRing', (raw: { orderId?: number; title?: string; body?: string }) => {
    const orderId = Number(raw?.orderId || 0);
    if (!orderId) return;
    listener({
      orderId,
      title: String(raw?.title || 'New order'),
      body: String(raw?.body || ''),
    });
  });
  return () => sub.remove();
}
