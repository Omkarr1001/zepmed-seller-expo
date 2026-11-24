import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const SELLER_FCM_TOKEN_KEY = 'zepmed:seller:fcm-token';

export const SELLER_FCM_CHANNEL = 'zepmed-seller-orders';
export const SELLER_FCM_QUIET_CHANNEL = 'zepmed-seller-orders-quiet';
export const SELLER_FCM_SOUND = 'order_bell';

export function isStubPushToken(token?: string | null): boolean {
  const value = String(token || '').trim();
  if (!value) return true;
  if (value.startsWith('android-install:')) return true;
  if (value.startsWith('ExponentPushToken')) return true;
  if (value.startsWith('ExpoPushToken')) return true;
  return false;
}

export function nativePushTokenFromDevice(device: { data?: unknown } | string | null | undefined): string {
  if (!device) return '';
  if (typeof device === 'string') return device.trim();
  return String(device.data || '').trim();
}

export type SellerDeviceTokenBody = {
  fcm_token: string;
  token: string;
  platform: string;
  device_type: string;
  device_name: string;
  unbind?: number;
};

export function sellerDeviceTokenBody(token: string, unbind = false): SellerDeviceTokenBody {
  return {
    fcm_token: token,
    token,
    platform: 'android',
    device_type: 'android',
    device_name: 'ZepMed Seller Expo',
    ...(unbind ? { unbind: 1 } : {}),
  };
}

export function orderIdFromSellerLink(url?: string | null): number {
  if (!url) return 0;
  const match = String(url).match(/order\/(\d+)/i);
  if (!match) return 0;
  const id = Number(match[1]);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

type DeviceTokenPoster = (body: SellerDeviceTokenBody) => Promise<unknown>;

/**
 * Register the native FCM token (not ExpoPushToken) after login so killed-app
 * tray + order_bell can fire on channel zepmed-seller-orders.
 */
export async function registerSellerPush(opts: {
  ensureReady: () => Promise<boolean>;
  postDeviceToken: DeviceTokenPoster;
}): Promise<string | null> {
  if (Platform.OS !== 'android') return null;
  const ok = await opts.ensureReady();
  if (!ok) return null;
  const device = await Notifications.getDevicePushTokenAsync();
  const token = nativePushTokenFromDevice(device);
  if (isStubPushToken(token)) return null;
  await opts.postDeviceToken(sellerDeviceTokenBody(token, false));
  await AsyncStorage.setItem(SELLER_FCM_TOKEN_KEY, token);
  return token;
}

export async function readSellerFcmToken(): Promise<string> {
  return (await AsyncStorage.getItem(SELLER_FCM_TOKEN_KEY)) || '';
}

export async function clearSellerFcmToken() {
  await AsyncStorage.removeItem(SELLER_FCM_TOKEN_KEY);
}

export function orderIdFromNotificationData(data?: Record<string, unknown> | null): number {
  if (!data) return 0;
  const raw = data.orderId ?? data.order_id ?? data.orderID;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 0;
}

export function isPrescriptionNotification(data?: Record<string, unknown> | null): boolean {
  if (!data) return false;
  const type = String(data.order_type ?? data.orderType ?? '').toLowerCase();
  return type === 'prescription'
    || data.is_prescription_order === true
    || data.is_prescription_order === 1
    || data.is_prescription_order === '1'
    || data.is_prescription === true
    || data.rx === true
    || data.rx === 1
    || data.rx === '1';
}

function positivePushAmount(...values: unknown[]): number {
  for (const value of values) {
    if (value == null || value === '') continue;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Immediate list/detail seed so a notification tap does not wait on seller/orders. */
export function orderStubFromNotificationData(data?: Record<string, unknown> | null): {
  id: number;
  order_number: string;
  status: string;
  total_amount: number;
  customer_name: string | null;
  notes: string | null;
  order_type: string | null;
  is_prescription_order: boolean;
  payment_method: string | null;
  created_at: string;
} | null {
  if (!data) return null;
  const id = orderIdFromNotificationData(data);
  if (!id) return null;
  const rx = isPrescriptionNotification(data);
  const customer = String(data.customer_name || data.customerName || data.customer || '').trim();
  return {
    id,
    order_number: String(data.order_number || data.orderNumber || `Order #${id}`),
    status: String(data.status || data.order_status || (rx ? 'prescription_review' : 'placed')),
    total_amount: positivePushAmount(
      data.total_amount,
      data.totalAmount,
      data.customer_payable,
      data.cod_collect_amount,
      data.grand_total,
      data.bill_total,
      data.amount,
      data.total,
    ),
    customer_name: customer && customer.toLowerCase() !== 'customer' ? customer : (customer || null),
    notes: data.notes ? String(data.notes) : null,
    order_type: rx ? 'prescription' : (data.order_type ? String(data.order_type) : null),
    is_prescription_order: rx,
    payment_method: data.payment_method ? String(data.payment_method) : null,
    created_at: String(data.created_at || new Date().toISOString()),
  };
}
