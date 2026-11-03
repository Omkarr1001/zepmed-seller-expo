import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const SELLER_FCM_CHANNEL = 'zepmed-seller-orders';
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

type DeviceTokenPoster = (body: { fcm_token: string; token: string; platform: string; device_type: string; device_name: string }) => Promise<unknown>;

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
  await opts.postDeviceToken({
    fcm_token: token,
    token,
    platform: 'android',
    device_type: 'android',
    device_name: 'ZepMed Seller Expo',
  });
  return token;
}

export function orderIdFromNotificationData(data?: Record<string, unknown> | null): number {
  if (!data) return 0;
  const raw = data.orderId ?? data.order_id ?? data.orderID;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : 0;
}
