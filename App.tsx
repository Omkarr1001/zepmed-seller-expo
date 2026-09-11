import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as TaskManager from 'expo-task-manager';
import { jwtDecode } from 'jwt-decode';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  Image,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const API = {
  phpBaseUrl: 'https://api.zepmed.org/api/v1',
  authBaseUrl: 'https://auth.zepmed.org/api/v1',
  authFallbackBaseUrl: 'https://api.zepmed.org/auth-api/v1',
  authLegacyBaseUrl: 'https://zepmed.org/auth-api/v1',
};

const C = {
  bg: '#FAF9F5',
  surface: '#FFFFFF',
  ink: '#20211E',
  muted: '#72736F',
  line: '#E5DED5',
  orange: '#E2632E',
  orangeDark: '#C84E21',
  orangeSoft: '#F8E1D4',
  beige: '#F5EFE8',
  greenSoft: '#DDEBE1',
  green: '#315F49',
  blueSoft: '#DDE8F5',
  blue: '#2D5D85',
  yellowSoft: '#F6ECC8',
  yellow: '#84661B',
  redSoft: '#F2DADA',
  red: '#9A3D3A',
  purpleSoft: '#EAE0F2',
  purple: '#71508A',
};

const SESSION_KEY = 'zepmed:seller:session';
const PREF_KEY = 'zepmed:seller:prefs';
const PENDING_NOTIFICATIONS_KEY = 'zepmed:seller:pending-notifications';
const ORDER_POLL_TASK = 'zepmed-seller-order-poll';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

type ApiWrap<T> = { success: boolean; data?: T | null; message?: string | null };
type AuthSession = {
  access_token?: string | null;
  refresh_token?: string | null;
  expires_in?: number | null;
  user?: { id?: number | null; name?: string | null; mobile?: string | null; role?: string | null } | null;
};
type StoredSession = {
  accessToken?: string | null;
  refreshToken?: string | null;
  tokenExpiresAt?: number;
  userName?: string | null;
  userMobile?: string | null;
};
type PharmacyInfo = { name?: string | null; city?: string | null; address?: string | null; pincode?: string | null; phone?: string | null };
type PlanFeatures = { plan_code?: string | null; plan_name?: string | null; features?: string[] | null; is_active?: boolean | null; days_remaining?: number | null };
type SubscriptionInfo = {
  has_subscription?: boolean | null;
  is_active?: boolean | null;
  days_remaining?: number | null;
  expires_at?: string | null;
  subscription?: { plan_name?: string | null; plan_code?: string | null; features?: string | null; expires_at?: string | null; plan_price?: number | null } | null;
  plan_features?: PlanFeatures | null;
};
type SellerPlan = { id: number; name: string; code?: string | null; price?: number | null; duration_days?: number | null; features?: string | null };
type DashboardData = {
  orders_total?: number;
  pending_dispatch?: number;
  revenue_total?: number;
  delivered_count?: number;
  inventory_low_stock?: number;
  is_wholeseller?: boolean | null;
  pharmacy?: PharmacyInfo | null;
  subscription?: SubscriptionInfo | null;
  plan_features?: PlanFeatures | null;
};
type Order = {
  id: number;
  order_number: string;
  status: string;
  total_amount: number;
  customer_name?: string | null;
  address_line?: string | null;
  city?: string | null;
  pincode?: string | null;
  payment_method?: string | null;
  created_at?: string | null;
  fulfillment_status?: string | null;
  order_type?: string | null;
  routed_via?: string | null;
  is_virtual_shop_order?: boolean | null;
  customer_shop_mode?: string | null;
  preferred_pharmacy_name?: string | null;
  preferred_pharmacy_city?: string | null;
  shop_order_discount?: number | null;
  virtual_shop_label?: string | null;
  routing_notes?: string | null;
};
type OrderLineItem = {
  id: number;
  product_name?: string | null;
  price?: number | null;
  quantity?: number | null;
  stock_at_pharmacy?: number | null;
  in_seller_catalog?: boolean | null;
  catalog_note?: string | null;
  qty_pending?: number | null;
  qty_fulfilled?: number | null;
  qty_forwarded?: number | null;
  item_status?: string | null;
  forwarded_to_me?: boolean | null;
  fulfilled_by_me?: boolean | null;
};
type ForwardPharmacy = { id: number; name?: string | null; city?: string | null; nearby_label?: string | null; distance_km?: number | null };
type OrderDetail = Order & {
  customer_phone?: string | null;
  seller_notes?: string | null;
  inventory_mode?: string | null;
  delivery_fee?: number | null;
  subtotal?: number | null;
  prescription_url?: string | null;
  is_prescription_order?: boolean | null;
  viewer_is_owner?: boolean | null;
  items?: OrderLineItem[] | null;
  forward_pharmacies?: ForwardPharmacy[] | null;
  tracking?: Array<{ status?: string | null; message?: string | null; created_at?: string | null }> | null;
  invoice?: {
    subtotal?: number | null;
    delivery_fee?: number | null;
    total_amount?: number | null;
    lines?: Array<{ name?: string | null; quantity?: number | null; price?: number | null; line_total?: number | null }> | null;
  } | null;
};
type InventoryItem = {
  id: number;
  name: string;
  price: number;
  stock: number;
  category_name?: string | null;
  is_available?: number | null;
  requires_prescription?: number | null;
  auto_added?: number | null;
  unit?: string | null;
  retail_unit?: string | null;
  stock_unit_label?: string | null;
  purchase_unit_options?: Array<{ code: string; label: string; multiplier?: number | null; hint?: string | null }> | null;
};
type WholesellerPharmacy = {
  id: number;
  name: string;
  city?: string | null;
  address?: string | null;
  pincode?: string | null;
  catalog_count?: number | null;
  pincode_match?: boolean | null;
  city_match?: boolean | null;
  distance_label?: string | null;
};
type WholesaleOrder = {
  id: number;
  order_number: string;
  status: string;
  subtotal: number;
  buyer_pharmacy_name?: string | null;
  wholeseller_pharmacy_name?: string | null;
  items?: Array<{ product_name?: string | null; quantity_label?: string | null; quantity?: number | null; quantity_unit?: string | null }> | null;
};
type DailySalesReport = {
  from?: string | null;
  to?: string | null;
  summary?: { line_count?: number | null; total_qty?: number | null; total_amount?: number | null } | null;
  days?: Array<{
    date?: string | null;
    item_count?: number | null;
    total_amount?: number | null;
    lines?: Array<{ product_name?: string | null; order_number?: string | null; order_type?: string | null; quantity?: number | null; price?: number | null; line_total?: number | null }> | null;
  }> | null;
};

type TabKey = 'home' | 'orders' | 'catalog' | 'wholesale' | 'more';
type AuthTab = 'password' | 'otp' | 'register';
type OrderFilter = 'all' | 'pending' | 'rx' | 'preparing' | 'ready' | 'delivered';
type DashboardTarget = 'orders' | 'pending' | 'revenue' | 'delivered';

function cleanMobile(raw: string) {
  let mobile = raw.replace(/\D/g, '');
  if (mobile.length === 12 && mobile.startsWith('91')) mobile = mobile.slice(2);
  if (mobile.length === 11 && mobile.startsWith('0')) mobile = mobile.slice(1);
  return mobile;
}

function money(value?: number | null) {
  return `₹${Number(value ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

function shortMoney(value?: number | null) {
  const n = Number(value ?? 0);
  if (n >= 1000) return `₹${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return money(n);
}

function prettyDate(raw?: string | null) {
  if (!raw) return 'Today';
  return raw.slice(0, 16).replace('T', ' ');
}

function isPrescription(order: Pick<Order, 'order_type'>) {
  return order.order_type === 'prescription';
}

function isVirtualShop(order: Pick<Order, 'is_virtual_shop_order' | 'routed_via'>) {
  return order.is_virtual_shop_order === true || order.routed_via?.toLowerCase() === 'virtual_shop';
}

function statusTone(status?: string | null) {
  switch ((status ?? '').toLowerCase()) {
    case 'placed':
    case 'new':
    case 'pending':
      return { bg: C.yellowSoft, fg: C.yellow, label: 'New' };
    case 'prescription_review':
      return { bg: C.purpleSoft, fg: C.purple, label: 'Prescription' };
    case 'confirmed':
    case 'preparing':
      return { bg: C.blueSoft, fg: C.blue, label: (status ?? '').replace(/_/g, ' ') };
    case 'ready_for_pickup':
      return { bg: C.greenSoft, fg: C.green, label: 'Ready' };
    case 'delivered':
    case 'completed':
      return { bg: C.greenSoft, fg: C.green, label: 'Delivered' };
    case 'rejected':
    case 'cancelled':
      return { bg: C.redSoft, fg: C.red, label: (status ?? '').replace(/_/g, ' ') };
    default:
      return { bg: C.beige, fg: C.muted, label: status?.replace(/_/g, ' ') || 'Unknown' };
  }
}

function pendingStatus(status?: string | null) {
  return ['placed', 'new', 'pending', 'prescription_review'].includes((status ?? '').toLowerCase());
}

function quickActions(status: string) {
  const s = status.toLowerCase();
  if (s === 'confirmed') return [{ code: 'preparing', label: 'Preparing' }, { code: 'ready_for_pickup', label: 'Ready' }];
  if (s === 'preparing') return [{ code: 'ready_for_pickup', label: 'Ready' }];
  return [];
}

function mediaUrl(path?: string | null) {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API.phpBaseUrl.replace(/\/api\/v1\/?$/, '')}/${path.replace(/^\/+/, '')}`;
}

async function readSession(): Promise<StoredSession> {
  const raw = await AsyncStorage.getItem(SESSION_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function saveSession(session: StoredSession) {
  await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function expiryFromJwt(token?: string | null) {
  if (!token) return 0;
  try {
    const decoded = jwtDecode<{ exp?: number }>(token);
    return decoded.exp ? decoded.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function errorMessage(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network request failed|unable to resolve|failed to fetch/i.test(msg)) return 'Cannot reach ZepMed. Check internet and try again.';
  if (/timeout|timed out/i.test(msg)) return 'Connection timed out. Try again.';
  if (/server error \(502\)|bad gateway|http 502/i.test(msg)) return 'ZepMed server gateway error (502). The backend is temporarily unavailable; retry in a moment.';
  if (/server error \(503\)|server error \(504\)/i.test(msg)) return 'ZepMed server is temporarily unavailable. Retry in a moment.';
  return msg || 'Something went wrong.';
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function persistAuth(data: AuthSession) {
  const current = await readSession();
  const fieldExpiry = Math.max(0, data.expires_in ?? 0) * 1000;
  await saveSession({
    ...current,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || current.refreshToken,
    tokenExpiresAt: expiryFromJwt(data.access_token) || Date.now() + (fieldExpiry || 3600_000),
    userName: data.user?.name ?? current.userName,
    userMobile: data.user?.mobile ?? current.userMobile,
  });
}

async function refreshAccessToken() {
  const session = await readSession();
  if (!session.refreshToken) return false;
  try {
    const response = await fetch(`${API.authBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    const json = (await response.json()) as ApiWrap<AuthSession>;
    if (!response.ok || !json.success || !json.data?.access_token) return false;
    await persistAuth(json.data);
    return true;
  } catch {
    return false;
  }
}

async function ensureFreshToken() {
  const session = await readSession();
  if (!session.accessToken) return;
  const expiry = session.tokenExpiresAt ?? 0;
  if (!expiry || Date.now() >= expiry - 120_000) await refreshAccessToken();
}

async function request<T>(
  path: string,
  options: { auth?: boolean; method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string | number | boolean | null | undefined>; retry?: boolean } = {},
): Promise<ApiWrap<T>> {
  const params = new URLSearchParams();
  Object.entries(options.query ?? {}).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') params.append(k, String(v));
  });
  if (!options.auth) await ensureFreshToken();
  const session = await readSession();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (!options.auth && session.accessToken) headers.Authorization = `Bearer ${session.accessToken.replace(/^bearer\s+/i, '')}`;

  const bases = options.auth
    ? [API.authBaseUrl, API.authFallbackBaseUrl, API.authLegacyBaseUrl]
    : [API.phpBaseUrl];
  let lastError: unknown;

  for (let idx = 0; idx < bases.length; idx += 1) {
    const url = `${bases[idx]}/${path.replace(/^\/+/, '')}${params.toString() ? `?${params}` : ''}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 18000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? (options.body ? 'POST' : 'GET'),
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      lastError = err;
      if (options.auth && idx < bases.length - 1) continue;
      throw err;
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 && !options.auth && options.retry !== false) {
      const refreshed = await refreshAccessToken();
      if (refreshed) return request<T>(path, { ...options, retry: false });
      await saveSession({});
    }
    let json: ApiWrap<T>;
    try {
      json = (await response.json()) as ApiWrap<T>;
    } catch {
      json = { success: response.ok, message: response.statusText, data: null };
    }
    if (response.ok && json.success !== false) return json;

    const err = new Error(json.message || `Server error (${response.status})`);
    lastError = err;
    if (options.auth && [404, 502, 503, 504].includes(response.status) && idx < bases.length - 1) continue;
    if (!options.auth && options.retry !== false && [502, 503, 504].includes(response.status)) {
      await delay(900);
      return request<T>(path, { ...options, retry: false });
    }
    throw err;
  }
  throw lastError instanceof Error ? lastError : new Error('Something went wrong.');
}

async function readNotificationMap(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(PENDING_NOTIFICATIONS_KEY);
  return raw ? JSON.parse(raw) : {};
}

async function writeNotificationMap(value: Record<string, string>) {
  await AsyncStorage.setItem(PENDING_NOTIFICATIONS_KEY, JSON.stringify(value));
}

async function readPrefs() {
  const raw = await AsyncStorage.getItem(PREF_KEY);
  const parsed = raw ? JSON.parse(raw) as { sound?: boolean; autoPrint?: boolean } : {};
  return { sound: parsed.sound ?? true, autoPrint: parsed.autoPrint ?? false };
}

async function ensureNotificationReady() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('order-alerts', {
      name: 'Order alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 150, 400, 150, 500],
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }
  return true;
}

async function schedulePendingOrderNotification(order: Order, existing: Record<string, string>) {
  const key = String(order.id);
  if (existing[key]) return existing;
  const ok = await ensureNotificationReady();
  if (!ok) return existing;
  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title: `New order pending ${order.order_number}`,
      body: `${order.customer_name || 'Customer'} • ${money(order.total_amount)}. Tap to open and accept.`,
      sound: 'default',
      data: { orderId: order.id },
      priority: Notifications.AndroidNotificationPriority.MAX,
    },
    trigger: { seconds: 20, repeats: true, channelId: 'order-alerts' } as Notifications.NotificationTriggerInput,
  });
  return { ...existing, [key]: id };
}

async function syncPendingOrderNotifications(orders: Order[]) {
  const prefs = await readPrefs();
  const current = await readNotificationMap();
  const pendingIds = new Set(orders.filter((order) => pendingStatus(order.status)).map((order) => String(order.id)));
  let next = { ...current };

  if (!prefs.sound) {
    await Promise.all(Object.values(next).map((id) => Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined)));
    await writeNotificationMap({});
    await Notifications.setBadgeCountAsync(0).catch(() => undefined);
    return;
  }

  for (const [orderId, notificationId] of Object.entries(current)) {
    if (!pendingIds.has(orderId)) {
      await Notifications.cancelScheduledNotificationAsync(notificationId).catch(() => undefined);
      delete next[orderId];
    }
  }

  for (const order of orders.filter((item) => pendingStatus(item.status))) {
    next = await schedulePendingOrderNotification(order, next);
  }

  await writeNotificationMap(next);
  await Notifications.setBadgeCountAsync(pendingIds.size).catch(() => undefined);
}

async function cancelOrderNotification(orderId: number) {
  const map = await readNotificationMap();
  const id = map[String(orderId)];
  if (id) await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
  delete map[String(orderId)];
  await writeNotificationMap(map);
}

const authApi = {
  async loginPassword(mobile: string, password: string) {
    const res = await request<AuthSession>('auth/login', {
      auth: true,
      body: { mobile: cleanMobile(mobile), password, role: 'SELLER', device_type: 'android', device_name: 'ZepMed Seller Expo' },
    });
    if (res.data?.user?.role && res.data.user.role.toLowerCase() !== 'seller') throw new Error('This account is not a seller');
    if (!res.data?.access_token) throw new Error(res.message || 'Login failed');
    await persistAuth(res.data);
  },
  async sendLoginOtp(mobile: string) {
    await request<Record<string, unknown>>('auth/otp/send', { auth: true, body: { mobile: cleanMobile(mobile), purpose: 'login' } });
  },
  async loginOtp(mobile: string, otp: string) {
    const res = await request<AuthSession>('auth/login/otp', {
      auth: true,
      body: { mobile: cleanMobile(mobile), otp, device_type: 'android', device_name: 'ZepMed Seller Expo' },
    });
    if (!res.data?.access_token) throw new Error(res.message || 'OTP login failed');
    await persistAuth(res.data);
  },
  async sendRegisterOtp(mobile: string) {
    await request<Record<string, unknown>>('auth/otp/send', { auth: true, body: { mobile: cleanMobile(mobile), purpose: 'register', role: 'SELLER' } });
  },
  async registerSeller(params: { mobile: string; otp: string; name: string; password: string; storeName: string; drugLicense: string; gst: string }) {
    const verified = await request<{ registration_token?: string | null }>('auth/otp/verify', {
      auth: true,
      body: { mobile: cleanMobile(params.mobile), otp: params.otp, purpose: 'register', role: 'SELLER' },
    });
    const token = verified.data?.registration_token;
    if (!token) throw new Error(verified.message || 'OTP verification failed');
    const res = await request<AuthSession>('auth/register', {
      auth: true,
      body: {
        registration_token: token,
        name: params.name,
        password: params.password,
        device_type: 'android',
        device_name: 'ZepMed Seller Expo',
        store_name: params.storeName,
        drug_license: params.drugLicense,
        gst_number: params.gst || undefined,
      },
    });
    if (!res.data?.access_token) throw new Error(res.message || 'Registration failed');
    await persistAuth(res.data);
  },
};

const sellerApi = {
  dashboard: () => request<DashboardData>('seller/dashboard'),
  orders: () => request<{ items?: Order[] | null }>('seller/orders'),
  orderDetail: (orderId: number) => request<OrderDetail>('seller/orders/detail', { query: { order_id: orderId } }),
  orderInvoice: (orderId: number) => request<OrderDetail>('seller/orders/invoice', { query: { order_id: orderId } }),
  processOrder: (body: unknown) => request<Record<string, unknown>>('seller/orders/process', { body }),
  prescriptionFill: (body: unknown) => request<OrderDetail>('seller/orders/prescription-fill', { body }),
  orderAction: (orderId: number, action: string) => request<Record<string, unknown>>('seller/orders/action', { body: { order_id: orderId, action } }),
  inventory: () => request<{ items?: InventoryItem[] | null }>('seller/inventory'),
  updateStock: (body: unknown) => request<Record<string, unknown>>('seller/inventory/update', { body }),
  catalogSearch: (search: string) => request<{ items?: Array<{ product_id: number; name: string; price?: number | null; seller_stock?: number | null }> | null }>('seller/catalog/search', { query: { search, limit: 15 } }),
  dailySalesReport: (from: string, to: string) => request<DailySalesReport>('seller/reports/daily-sales', { query: { from, to } }),
  wholesellers: () => request<{ items?: WholesellerPharmacy[] | null }>('seller/pharmacies/wholesellers'),
  wholesaleCatalog: (id: number) => request<{ items?: InventoryItem[] | null }>('seller/wholesale/catalog', { query: { wholeseller_pharmacy_id: id } }),
  wholesaleOrders: (mode: 'buyer' | 'wholeseller') => request<{ items?: WholesaleOrder[] | null }>('seller/wholesale/orders', { query: { mode } }),
  createWholesaleOrder: (body: unknown) => request<WholesaleOrder>('seller/wholesale/orders/create', { body }),
  wholesaleAction: (orderId: number, action: string) => request<WholesaleOrder>('seller/wholesale/orders/action', { body: { order_id: orderId, action } }),
  subscription: () => request<SubscriptionInfo>('seller/subscription'),
  subscriptionPlans: () => request<{ items?: SellerPlan[] | null }>('seller/subscription/plans'),
  subscribePlan: (planId: number) => request<SubscriptionInfo>('seller/subscription/subscribe', { body: { plan_id: planId, payment_method: 'demo', demo_card: '4242 4242 4242 4242', simulate: 'success' } }),
};

TaskManager.defineTask(ORDER_POLL_TASK, async () => {
  try {
    const session = await readSession();
    if (!session.accessToken) return BackgroundFetch.BackgroundFetchResult.NoData;
    const prefs = await readPrefs();
    if (!prefs.sound) {
      await syncPendingOrderNotifications([]);
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    const response = await sellerApi.orders();
    const orders = response.data?.items ?? [];
    await syncPendingOrderNotifications(orders);
    return orders.some((order) => pendingStatus(order.status))
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

async function registerOrderBackgroundTask() {
  try {
    await ensureNotificationReady();
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Restricted || status === BackgroundFetch.BackgroundFetchStatus.Denied) return;
    const registered = await TaskManager.isTaskRegisteredAsync(ORDER_POLL_TASK);
    if (!registered) {
      await BackgroundFetch.registerTaskAsync(ORDER_POLL_TASK, {
        minimumInterval: 60,
        stopOnTerminate: false,
        startOnBoot: true,
      });
    }
  } catch {
    // Background fetch availability differs by device and Android battery policy.
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <SellerRoot />
    </SafeAreaProvider>
  );
}

function SellerRoot() {
  const [splashDone, setSplashDone] = useState(false);
  const [booting, setBooting] = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSplashDone(true), 1800);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    readSession().then((s) => {
      setLoggedIn(Boolean(s.accessToken));
      setBooting(false);
    });
  }, []);

  if (!splashDone) return <Splash />;
  if (booting) return <CenteredLoader />;
  if (!loggedIn) return <AuthScreen onDone={() => setLoggedIn(true)} />;
  return <SellerShell onLogout={async () => { await saveSession({}); setLoggedIn(false); }} />;
}

function Splash() {
  return (
    <View style={s.splash}>
      <View style={s.splashMark}>
        <View style={s.zTile}><Text style={s.zText}>Z+</Text></View>
      </View>
      <Text style={s.splashTitle}>ZepMed Seller</Text>
      <Text style={s.splashSub}>Pharmacy order management</Text>
      <View style={s.dots}><View style={s.dot} /><View style={s.dot} /><View style={s.dot} /></View>
    </View>
  );
}

function CenteredLoader({ compact = false }: { compact?: boolean }) {
  return <View style={compact ? s.centerCompact : s.center}><ActivityIndicator color={C.orange} /></View>;
}

function AuthScreen({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<AuthTab>('password');
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [drugLicense, setDrugLicense] = useState('');
  const [gst, setGst] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('Secure seller access');
  const [error, setError] = useState('');

  async function run(task: () => Promise<void>, success?: string) {
    setLoading(true);
    setError('');
    try {
      await task();
      if (success) setNotice(success);
      else onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled">
      <View style={s.authHero}>
        <View style={s.zTile}><Text style={s.zText}>Z+</Text></View>
        <Text style={s.authTitle}>Welcome back</Text>
        <Text style={s.authSub}>Manage your pharmacy operations securely</Text>
      </View>
      <Segment<AuthTab>
        value={tab}
        options={[['password', 'Password'], ['otp', 'OTP'], ['register', 'Register']]}
        onChange={(v) => { setTab(v); setError(''); setNotice('Secure seller access'); }}
      />
      {tab === 'password' ? (
        <>
          <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          <Primary label={loading ? 'Signing in...' : 'Sign In'} disabled={loading} onPress={() => run(() => authApi.loginPassword(mobile, password))} />
        </>
      ) : null}
      {tab === 'otp' ? (
        <>
          <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
          <Field label="OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
          <Secondary label="Send OTP" disabled={loading} onPress={() => run(() => authApi.sendLoginOtp(mobile), 'OTP sent. Check WhatsApp.')} />
          <Primary label={loading ? 'Verifying...' : 'Login with OTP'} disabled={loading} onPress={() => run(() => authApi.loginOtp(mobile, otp))} />
        </>
      ) : null}
      {tab === 'register' ? (
        <>
          <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
          <Field label="OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" />
          <Field label="Owner name" value={name} onChangeText={setName} />
          <Field label="Pharmacy name" value={storeName} onChangeText={setStoreName} />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          <Field label="Drug license" value={drugLicense} onChangeText={setDrugLicense} />
          <Field label="GST optional" value={gst} onChangeText={setGst} />
          <Secondary label="Send registration OTP" disabled={loading} onPress={() => run(() => authApi.sendRegisterOtp(mobile), 'Registration OTP sent.')} />
          <Primary label={loading ? 'Submitting...' : 'Register as seller'} disabled={loading} onPress={() => run(() => authApi.registerSeller({ mobile, otp, name, password, storeName, drugLicense, gst }))} />
        </>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : <Notice tone="success" title={notice} body="Session and preferences are stored securely." />}
    </ScrollView>
  );
}

function SellerShell({ onLogout }: { onLogout: () => Promise<void> }) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabKey>('home');
  const [orderFilter, setOrderFilter] = useState<OrderFilter>('all');
  const [dash, setDash] = useState<DashboardData | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [selectedOrder, setSelectedOrder] = useState<OrderDetail | null>(null);
  const [editItem, setEditItem] = useState<InventoryItem | null>(null);
  const [showReport, setShowReport] = useState(false);
  const [fresh, setFresh] = useState<Order | null>(null);
  const knownOrders = useRef<Set<number>>(new Set());
  const refreshInFlight = useRef(false);
  const tabHistory = useRef<TabKey[]>([]);

  const canWholesale = dash?.plan_features?.features?.includes('wholesale') || dash?.is_wholeseller === true;

  const goTab = useCallback((next: TabKey, filter?: OrderFilter) => {
    if (filter) setOrderFilter(filter);
    setTab((current) => {
      if (current !== next) tabHistory.current.push(current);
      return next;
    });
  }, []);

  const refresh = useCallback(async (silent = false) => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    if (!silent) setRefreshing(true);
    setError('');
    let nextError = '';
    try {
      try {
        const d = await sellerApi.dashboard();
        setDash(d.data ?? null);
      } catch (err) {
        nextError = errorMessage(err);
      }

      let next: Order[] = [];
      try {
        const o = await sellerApi.orders();
        next = (o.data?.items ?? []).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
      } catch (err) {
        nextError = nextError || errorMessage(err);
      }

      const firstFresh = next.find((order) => !knownOrders.current.has(order.id) && pendingStatus(order.status));
      if (knownOrders.current.size && firstFresh) {
        setFresh(firstFresh);
        Vibration.vibrate([0, 300, 120, 300]);
        goTab('orders', 'pending');
      } else if (!knownOrders.current.size) {
        const firstPending = next.find((order) => pendingStatus(order.status));
        if (firstPending) setFresh(firstPending);
      }
      knownOrders.current = new Set(next.map((order) => order.id));
      setOrders(next);
      await syncPendingOrderNotifications(next);

      if (tab === 'home' || tab === 'catalog') {
        try {
          const inv = await sellerApi.inventory();
          setInventory(inv.data?.items ?? []);
        } catch (err) {
          if (!inventory.length) nextError = nextError || errorMessage(err);
        }
      }
      if (nextError) setError(nextError);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
    }
  }, [goTab, inventory.length, tab]);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(true), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    registerOrderBackgroundTask().catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = Number(response.notification.request.content.data?.orderId || 0);
      if (orderId) openOrder(orderId);
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh(true);
    });
    return () => {
      sub.remove();
      appSub.remove();
    };
  }, [refresh]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (selectedOrder) {
        setSelectedOrder(null);
        refresh(true);
        return true;
      }
      if (showReport) {
        setShowReport(false);
        return true;
      }
      const previous = tabHistory.current.pop();
      if (previous && previous !== tab) {
        setTab(previous);
        return true;
      }
      if (tab !== 'home') {
        setTab('home');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [refresh, selectedOrder, showReport, tab]);

  async function openOrder(id: number) {
    const seed = orders.find((order) => order.id === id);
    if (seed) setSelectedOrder(seed as OrderDetail);
    try {
      const detail = await sellerApi.orderDetail(id);
      setSelectedOrder(detail.data ?? null);
    } catch (err) {
      Alert.alert('Order', errorMessage(err));
    }
  }

  async function action(orderId: number, code: string) {
    try {
      await sellerApi.orderAction(orderId, code);
      await cancelOrderNotification(orderId);
      await refresh(true);
    } catch (err) {
      Alert.alert('Action failed', errorMessage(err));
    }
  }

  function openDashboardTarget(target: DashboardTarget) {
    if (target === 'revenue') {
      setShowReport(true);
      return;
    }
    const nextFilter: OrderFilter = target === 'pending' ? 'pending' : target === 'delivered' ? 'delivered' : 'all';
    goTab('orders', nextFilter);
  }

  if (selectedOrder) return <OrderDetailScreen order={selectedOrder} dash={dash} onBack={() => { setSelectedOrder(null); refresh(true); }} />;
  if (showReport) return <DailySalesScreen onBack={() => setShowReport(false)} />;

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Header
        title={tab === 'home' ? 'ZepMed Seller' : tab[0].toUpperCase() + tab.slice(1)}
        subtitle={[dash?.pharmacy?.name, dash?.pharmacy?.city].filter(Boolean).join(' • ') || 'Pharmacy'}
        onRefresh={() => refresh()}
        onLogout={onLogout}
      />
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh()} tintColor={C.orange} />} contentContainerStyle={s.body}>
        {fresh && tab === 'orders' ? <FreshBanner order={fresh} onClose={() => setFresh(null)} onOpen={() => openOrder(fresh.id)} /> : null}
        {error ? <Notice tone="error" title={error} /> : null}
        {tab === 'home' ? <HomeScreen dash={dash} orders={orders} onOpenOrder={openOrder} onAction={action} onDashboardTarget={openDashboardTarget} /> : null}
        {tab === 'orders' ? <OrdersScreen orders={orders} filter={orderFilter} onFilter={setOrderFilter} onOpenOrder={openOrder} onAction={action} /> : null}
        {tab === 'catalog' ? <CatalogScreen items={inventory} onEdit={setEditItem} onWholesale={() => goTab('wholesale')} /> : null}
        {tab === 'wholesale' ? <WholesaleScreen dash={dash} canWholesale={Boolean(canWholesale)} onRefresh={() => refresh(true)} /> : null}
        {tab === 'more' ? <MoreScreen dash={dash} onReport={() => setShowReport(true)} onRefresh={() => refresh()} /> : null}
      </ScrollView>
      <BottomTabs current={tab} setTab={goTab} pending={orders.filter((o) => pendingStatus(o.status)).length} showWholesale={Boolean(canWholesale)} />
      <StockEditModal item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); refresh(true); }} />
      <NewOrderPopup order={fresh} onClose={() => setFresh(null)} onOpen={() => { const order = fresh; setFresh(null); if (order) openOrder(order.id); }} />
    </View>
  );
}

function Header({ title, subtitle, onRefresh, onLogout }: { title: string; subtitle: string; onRefresh: () => void; onLogout: () => void }) {
  return (
    <View style={s.header}>
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle}>{title}</Text>
        <Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <IconButton label="↻" onPress={onRefresh} />
      <IconButton label="↗" onPress={onLogout} />
    </View>
  );
}

function HomeScreen({
  dash,
  orders,
  onOpenOrder,
  onAction,
  onDashboardTarget,
}: {
  dash: DashboardData | null;
  orders: Order[];
  onOpenOrder: (id: number) => void;
  onAction: (id: number, code: string) => void;
  onDashboardTarget: (target: DashboardTarget) => void;
}) {
  if (!dash) return <CenteredLoader />;
  return (
    <>
      <View style={s.dashboardCard}>
        <View style={s.rowBetween}>
          <View>
            <Text style={s.bigTitle}>{dash.pharmacy?.name || 'Your pharmacy'}</Text>
            <Text style={s.muted}>{dash.pharmacy?.city || 'Open for orders'} • Open for orders</Text>
          </View>
          <Pill text="Live" tone="green" />
        </View>
        <View style={s.kpiGrid}>
          <Kpi label="Orders" value={String(dash.orders_total ?? 0)} tone="blue" onPress={() => onDashboardTarget('orders')} />
          <Kpi label="Pending" value={String(dash.pending_dispatch ?? 0)} tone="orange" onPress={() => onDashboardTarget('pending')} />
          <Kpi label="Revenue" value={shortMoney(dash.revenue_total)} tone="green" onPress={() => onDashboardTarget('revenue')} />
          <Kpi label="Delivered" value={String(dash.delivered_count ?? 0)} tone="purple" onPress={() => onDashboardTarget('delivered')} />
        </View>
      </View>
      <View style={[s.infoCard, { backgroundColor: C.blueSoft }]}>
        <Text style={[s.infoTitle, { color: C.blue }]}>Global catalog synced</Text>
        <Text style={[s.infoText, { color: C.blue }]}>Products update when orders are confirmed</Text>
      </View>
      {(dash.inventory_low_stock ?? 0) > 0 ? (
        <View style={[s.infoCard, { backgroundColor: C.yellowSoft }]}>
          <Text style={[s.infoTitle, { color: C.yellow }]}>{dash.inventory_low_stock} products are low in stock</Text>
          <Text style={[s.infoText, { color: C.yellow }]}>Review stock or purchase from a wholeseller.</Text>
        </View>
      ) : null}
      <SectionTitle title="Recent orders" right={`${orders.length} total`} />
      {orders.slice(0, 6).map((o) => <OrderCard key={o.id} order={o} onOpen={() => onOpenOrder(o.id)} onAction={(code) => onAction(o.id, code)} />)}
      {!orders.length ? <Empty title="No orders yet" body="New customer orders will appear here." /> : null}
    </>
  );
}

function OrdersScreen({
  orders,
  filter,
  onFilter,
  onOpenOrder,
  onAction,
}: {
  orders: Order[];
  filter: OrderFilter;
  onFilter: (filter: OrderFilter) => void;
  onOpenOrder: (id: number) => void;
  onAction: (id: number, code: string) => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const statusMap: Record<OrderFilter, string[] | null> = {
      all: null,
      pending: ['placed', 'new', 'pending', 'prescription_review'],
      rx: ['prescription_review'],
      preparing: ['confirmed', 'preparing'],
      ready: ['ready_for_pickup'],
      delivered: ['delivered', 'completed'],
    };
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      const byStatus = statusMap[filter]?.includes(o.status.toLowerCase()) ?? true;
      const byQuery = !q || o.order_number.toLowerCase().includes(q) || (o.customer_name ?? '').toLowerCase().includes(q) || (o.address_line ?? '').toLowerCase().includes(q);
      return byStatus && byQuery;
    });
  }, [filter, orders, query]);
  return (
    <>
      <SearchBox placeholder="Search order #, customer, address..." value={query} onChangeText={setQuery} />
      <Segment<OrderFilter>
        value={filter}
        options={[['all', 'All'], ['pending', 'Pending'], ['rx', 'Prescription'], ['preparing', 'Preparing'], ['ready', 'Ready'], ['delivered', 'Delivered']]}
        onChange={onFilter}
        dark
      />
      <Text style={s.count}>{filtered.length} orders</Text>
      {filtered.map((o) => <OrderCard key={o.id} order={o} onOpen={() => onOpenOrder(o.id)} onAction={(code) => onAction(o.id, code)} />)}
      {!filtered.length ? <Empty title="No matching orders" body="Try another search or filter." /> : null}
    </>
  );
}

function CatalogScreen({ items, onEdit, onWholesale }: { items: InventoryItem[]; onEdit: (item: InventoryItem) => void; onWholesale: () => void }) {
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const lowCount = items.filter((i) => i.stock <= 10).length;
  const filtered = items.filter((i) => {
    const q = query.toLowerCase();
    return (!q || i.name.toLowerCase().includes(q) || (i.category_name ?? '').toLowerCase().includes(q)) && (!lowOnly || i.stock <= 10);
  });
  return (
    <>
      <View style={s.statRow}>
        <StatCard label="Products" value={String(items.length)} />
        <StatCard label="Low stock" value={String(lowCount)} warm />
      </View>
      <SearchBox placeholder="Search catalog" value={query} onChangeText={setQuery} />
      <TouchableOpacity style={[s.smallChip, lowOnly && { backgroundColor: C.ink }]} onPress={() => setLowOnly(!lowOnly)}>
        <Text style={[s.smallChipText, lowOnly && { color: '#FFF' }]}>Low stock only</Text>
      </TouchableOpacity>
      {lowCount ? <TouchableOpacity style={s.purchaseCta} onPress={onWholesale}><Text style={s.purchaseText}>Purchase from wholeseller</Text><Text style={s.purchaseArrow}>→</Text></TouchableOpacity> : null}
      {filtered.map((item) => <ProductRow key={item.id} item={item} onPress={() => onEdit(item)} />)}
      {!filtered.length ? <Empty title="Catalog empty" body="Products appear after you confirm orders." /> : null}
    </>
  );
}

function MoreScreen({ dash, onReport, onRefresh }: { dash: DashboardData | null; onReport: () => void; onRefresh: () => void }) {
  return (
    <>
      <SectionTitle title="Pharmacy profile" />
      <View style={s.card}>
        <Info label="Store" value={dash?.pharmacy?.name || '-'} />
        <Info label="Location" value={[dash?.pharmacy?.address, dash?.pharmacy?.city, dash?.pharmacy?.pincode].filter(Boolean).join(', ') || '-'} />
        <Info label="Phone" value={dash?.pharmacy?.phone || 'Not set'} />
      </View>
      <SectionTitle title="Operations" />
      <MenuItem title="Daily Sales Report" body="Day-wise items sold with export data" onPress={onReport} />
      <MenuItem title="Sync data" body="Refresh dashboard, orders and catalog" onPress={onRefresh} />
      <SubscriptionSection dash={dash} />
      <SettingsPanel />
      <Text style={s.footer}>ZepMed Seller partner app</Text>
    </>
  );
}

function WholesaleScreen({ dash, canWholesale, onRefresh }: { dash: DashboardData | null; canWholesale: boolean; onRefresh: () => void }) {
  const [wholesellers, setWholesellers] = useState<WholesellerPharmacy[]>([]);
  const [catalog, setCatalog] = useState<InventoryItem[]>([]);
  const [myOrders, setMyOrders] = useState<WholesaleOrder[]>([]);
  const [incoming, setIncoming] = useState<WholesaleOrder[]>([]);
  const [selected, setSelected] = useState<WholesellerPharmacy | null>(null);
  const [qty, setQty] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    const problems: string[] = [];
    if (canWholesale) {
      try {
        const w = await sellerApi.wholesellers();
        setWholesellers(w.data?.items ?? []);
      } catch (err) {
        setWholesellers([]);
        problems.push(`Wholesellers: ${errorMessage(err)}`);
      }
      try {
        const mine = await sellerApi.wholesaleOrders('buyer');
        setMyOrders(mine.data?.items ?? []);
      } catch (err) {
        setMyOrders([]);
        problems.push(`Purchase orders: ${errorMessage(err)}`);
      }
    } else {
      setWholesellers([]);
      setMyOrders([]);
    }
    if (dash?.is_wholeseller) {
      try {
        const inc = await sellerApi.wholesaleOrders('wholeseller');
        setIncoming(inc.data?.items ?? []);
      } catch (err) {
        setIncoming([]);
        problems.push(`Incoming orders: ${errorMessage(err)}`);
      }
    } else {
      setIncoming([]);
    }
    if (problems.length) setLoadError(problems.join('\n'));
    setLoading(false);
  }, [canWholesale, dash?.is_wholeseller]);

  useEffect(() => { load(); }, [load]);

  async function openCatalog(w: WholesellerPharmacy) {
    setSelected(w);
    setCatalog([]);
    setQty({});
    setCatalogError('');
    setCatalogLoading(true);
    try {
      const res = await sellerApi.wholesaleCatalog(w.id);
      setCatalog(res.data?.items ?? []);
    } catch (err) {
      setCatalogError(errorMessage(err));
    } finally {
      setCatalogLoading(false);
    }
  }

  async function placeOrder() {
    if (!selected) return;
    const lines = Object.entries(qty).map(([id, value]) => ({ product_id: Number(id), quantity: Number(value), quantity_unit: 'strip' })).filter((line) => line.quantity > 0);
    if (!lines.length) return Alert.alert('Wholesale', 'Enter quantity for at least one item.');
    try {
      await sellerApi.createWholesaleOrder({ wholeseller_pharmacy_id: selected.id, items: lines, notes: '' });
      setSelected(null);
      onRefresh();
      load();
    } catch (err) {
      Alert.alert('Wholesale', errorMessage(err));
    }
  }

  if (!canWholesale && !dash?.is_wholeseller) {
    return <Empty title="Wholesale locked" body="Purchase stock from wholesalers with a Growth or Premium plan." />;
  }
  if (selected) {
    return (
      <>
        <TouchableOpacity onPress={() => setSelected(null)}><Text style={s.backText}>‹ Back</Text></TouchableOpacity>
        <SectionTitle title={selected.name} right={selected.city || ''} />
        {catalogLoading ? <CenteredLoader compact /> : null}
        {catalogError ? <Notice tone="error" title="Could not load catalog" body={catalogError} /> : null}
        {catalog.map((item) => (
          <View key={item.id} style={s.card}>
            <View style={s.rowBetween}>
              <View style={{ flex: 1 }}>
                <Text style={s.itemTitle}>{item.name}</Text>
                <Text style={s.muted}>{money(item.price)} • {item.stock} in stock</Text>
              </View>
              <TextInput style={s.qtyInput} value={qty[item.id] || ''} keyboardType="number-pad" placeholder="Qty" onChangeText={(v) => setQty((m) => ({ ...m, [item.id]: v.replace(/\D/g, '') }))} />
            </View>
          </View>
        ))}
        {!catalogLoading && !catalogError && !catalog.length ? <Empty title="No products" body="This wholeseller has no catalog items available right now." /> : null}
        {catalogError ? <Secondary label="Retry catalog" onPress={() => openCatalog(selected)} /> : null}
        {catalog.length ? <Primary label="Place Purchase Order" onPress={placeOrder} /> : null}
      </>
    );
  }
  return (
    <>
      {loading ? <ActivityIndicator color={C.orange} /> : null}
      {loadError ? <Notice tone="error" title="Wholesale sync issue" body={loadError} /> : null}
      {loadError ? <Secondary label="Retry wholesale" onPress={load} /> : null}
      {(dash?.inventory_low_stock ?? 0) > 0 ? <Notice tone="warn" title={`${dash?.inventory_low_stock} products low on stock`} body="Purchase from a nearby wholeseller below." /> : null}
      {canWholesale ? <SectionTitle title="Nearby Wholesellers" /> : null}
      {wholesellers.map((w) => <MenuItem key={w.id} title={w.name} body={`${w.city || '-'} • ${w.pincode || '-'} • ${w.catalog_count ?? 0} products`} badge={w.distance_label || (w.pincode_match ? 'Same pincode' : w.city_match ? 'Same city' : undefined)} onPress={() => openCatalog(w)} />)}
      {!loading && canWholesale && !wholesellers.length ? <Empty title="No wholesalers" body="No nearby wholesellers are available, or the server did not return this list." /> : null}
      {canWholesale ? <SectionTitle title="My Purchase Orders" /> : null}
      {myOrders.slice(0, 10).map((o) => <WholesaleOrderCard key={o.id} order={o} />)}
      {!loading && canWholesale && !myOrders.length ? <Text style={s.muted}>No B2B purchase orders yet.</Text> : null}
      {dash?.is_wholeseller ? <SectionTitle title="Incoming Orders" /> : null}
      {incoming.slice(0, 10).map((o) => <WholesaleOrderCard key={o.id} order={o} action={(code) => sellerApi.wholesaleAction(o.id, code).then(load)} />)}
      {!loading && dash?.is_wholeseller && !incoming.length ? <Text style={s.muted}>No incoming wholesale orders yet.</Text> : null}
    </>
  );
}

function OrderDetailScreen({ order, dash, onBack }: { order: OrderDetail; dash: DashboardData | null; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState(order);
  const [notes, setNotes] = useState(order.seller_notes || '');
  const [acting, setActing] = useState(false);
  const [fulfill, setFulfill] = useState<Record<number, string>>({});
  const [rxRows, setRxRows] = useState<Array<{ name: string; qty: string; price: string }>>([{ name: '', qty: '1', price: '' }]);

  useEffect(() => {
    const next: Record<number, string> = {};
    detail.items?.forEach((item) => { next[item.id] = String(item.qty_pending ?? item.quantity ?? 0); });
    setFulfill(next);
  }, [detail.id]);

  async function reload() {
    const res = await sellerApi.orderDetail(detail.id);
    if (res.data) setDetail(res.data);
  }

  async function run(code: string) {
    setActing(true);
    try {
      await sellerApi.orderAction(detail.id, code);
      await cancelOrderNotification(detail.id);
      await reload();
      if (code === 'ready_for_pickup') onBack();
    } catch (err) {
      Alert.alert('Order', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function process(finalStatus: string) {
    setActing(true);
    try {
      await sellerApi.processOrder({
        order_id: detail.id,
        seller_notes: notes,
        final_status: finalStatus,
        items: (detail.items ?? []).map((item) => ({ order_item_id: item.id, fulfill_qty: Number(fulfill[item.id] || 0), forward_qty: 0, forward_to_pharmacy_id: 0 })),
      });
      await cancelOrderNotification(detail.id);
      await reload();
      if (finalStatus === 'ready_for_pickup' || finalStatus === 'rejected') onBack();
    } catch (err) {
      Alert.alert('Order', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function submitRx() {
    const items = rxRows.filter((r) => r.name.trim()).map((r) => ({ medicine_name: r.name.trim(), quantity: Number(r.qty || 1), price: Number(r.price || 0), disposition: 'fulfill' }));
    if (!items.length) return Alert.alert('Prescription', 'Add medicines you will supply.');
    setActing(true);
    try {
      const res = await sellerApi.prescriptionFill({ order_id: detail.id, items, seller_notes: notes, final_status: 'confirmed' });
      await cancelOrderNotification(detail.id);
      if (res.data) setDetail(res.data);
    } catch (err) {
      Alert.alert('Prescription', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  const pending = pendingStatus(detail.status);
  const rx = detail.is_prescription_order || isPrescription(detail);
  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Header title={rx ? 'Prescription Order' : detail.order_number} subtitle={detail.status.replace(/_/g, ' ')} onRefresh={reload} onLogout={onBack} />
      <ScrollView contentContainerStyle={s.body}>
        <TouchableOpacity onPress={onBack}><Text style={s.backText}>‹ Back to orders</Text></TouchableOpacity>
        <OrderStepper status={detail.status} />
        {isVirtualShop(detail) ? <VirtualShopBanner order={detail} /> : null}
        <View style={s.card}>
          <Text style={s.itemTitle}>{detail.customer_name || 'Customer'} • {detail.customer_phone || '-'}</Text>
          <Text style={s.muted}>{[detail.address_line, detail.city, detail.pincode].filter(Boolean).join(', ')}</Text>
          <View style={s.rowBetween}><Text style={s.amount}>Total {money(detail.total_amount)}</Text>{detail.payment_method ? <Pill text={detail.payment_method.toUpperCase()} tone="blue" /> : null}</View>
        </View>
        {rx && mediaUrl(detail.prescription_url) ? <Image source={{ uri: mediaUrl(detail.prescription_url) }} style={s.rxImage} resizeMode="contain" /> : null}
        {detail.tracking?.length ? (
          <>
            <SectionTitle title="Tracking timeline" />
            <View style={s.card}>{detail.tracking.map((t, idx) => <Info key={`${t.status}-${idx}`} label={t.status?.replace(/_/g, ' ') || 'Update'} value={`${t.message || ''} ${prettyDate(t.created_at)}`} />)}</View>
          </>
        ) : null}
        <SectionTitle title={rx ? 'Medicines' : 'Line items'} right={pending && !rx ? 'Set fulfill qty' : undefined} />
        {rx && pending ? (
          <>
            {rxRows.map((row, idx) => (
              <View key={idx} style={s.card}>
                <Field label="Medicine name" value={row.name} onChangeText={(v) => setRxRows((rows) => rows.map((r, i) => i === idx ? { ...r, name: v } : r))} />
                <View style={s.inputRow}>
                  <Field label="Qty" value={row.qty} onChangeText={(v) => setRxRows((rows) => rows.map((r, i) => i === idx ? { ...r, qty: v.replace(/\D/g, '') } : r))} keyboardType="number-pad" compact />
                  <Field label="Price" value={row.price} onChangeText={(v) => setRxRows((rows) => rows.map((r, i) => i === idx ? { ...r, price: v.replace(/[^0-9.]/g, '') } : r))} keyboardType="decimal-pad" compact />
                </View>
              </View>
            ))}
            <Secondary label="Add medicine I have" onPress={() => setRxRows((rows) => [...rows, { name: '', qty: '1', price: '' }])} />
          </>
        ) : (
          detail.items?.map((item) => (
            <View key={item.id} style={s.card}>
              <Text style={s.itemTitle}>{item.product_name || 'Item'}</Text>
              <Text style={s.muted}>Ordered {item.quantity ?? 0} • {item.catalog_note || 'New on confirm'} • {money(item.price)}</Text>
              {pending && !rx ? <Field label="Fulfill" value={fulfill[item.id] || '0'} onChangeText={(v) => setFulfill((m) => ({ ...m, [item.id]: v.replace(/\D/g, '') }))} keyboardType="number-pad" compact /> : null}
            </View>
          ))
        )}
        <Field label="Notes to customer" value={notes} onChangeText={setNotes} multiline />
        {pending && rx ? <Primary label={acting ? 'Saving...' : 'Confirm order'} disabled={acting} onPress={submitRx} /> : null}
        {pending && !rx ? (
          <>
            <Primary label="Confirm & Save" disabled={acting} onPress={() => process('confirmed')} />
            <Primary label="Confirm & Ready for Pickup" disabled={acting} onPress={() => process('ready_for_pickup')} />
            <Secondary label="Confirm & Start Preparing" disabled={acting} onPress={() => process('preparing')} />
            <Danger label="Reject order" disabled={acting} onPress={() => process('rejected')} />
          </>
        ) : null}
        {!pending && quickActions(detail.status).map((a) => <Primary key={a.code} label={a.label} disabled={acting} onPress={() => run(a.code)} />)}
      </ScrollView>
    </View>
  );
}

function SubscriptionSection({ dash }: { dash: DashboardData | null }) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(dash?.subscription ?? null);
  const [plans, setPlans] = useState<SellerPlan[]>([]);
  useEffect(() => {
    Promise.all([sellerApi.subscription(), sellerApi.subscriptionPlans()])
      .then(([sub, p]) => { setInfo(sub.data ?? null); setPlans(p.data?.items ?? []); })
      .catch(() => undefined);
  }, []);
  return (
    <>
      <SectionTitle title="Subscription & plans" />
      <View style={s.card}>
        <Text style={s.itemTitle}>{info?.subscription?.plan_name || 'No active plan'}</Text>
        <Text style={s.muted}>{info?.is_active ? 'Active' : 'Upgrade to unlock wholesale and analytics'} • {info?.days_remaining ?? 0} days remaining</Text>
      </View>
      {plans.map((p) => (
        <View key={p.id} style={s.card}>
          <Text style={s.itemTitle}>{p.name}</Text>
          <Text style={s.amount}>{money(p.price)} • {p.duration_days ?? 30} days</Text>
          {p.features ? <Text style={s.muted}>{p.features}</Text> : null}
          <Secondary label="Buy plan demo pay" onPress={() => sellerApi.subscribePlan(p.id).then((r) => setInfo(r.data ?? null)).catch((err) => Alert.alert('Subscription', errorMessage(err)))} />
        </View>
      ))}
    </>
  );
}

function DailySalesScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [report, setReport] = useState<DailySalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const res = await sellerApi.dailySalesReport(from, to);
      setReport(res.data ?? null);
    } catch (err) {
      Alert.alert('Report', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Header title="Daily Sales Report" subtitle="Prescription + regular orders" onRefresh={load} onLogout={onBack} />
      <ScrollView contentContainerStyle={s.body}>
        <TouchableOpacity onPress={onBack}><Text style={s.backText}>‹ Back</Text></TouchableOpacity>
        <View style={s.card}>
          <View style={s.inputRow}>
            <Field label="From" value={from} onChangeText={setFrom} compact />
            <Field label="To" value={to} onChangeText={setTo} compact />
          </View>
          <Primary label={loading ? 'Loading...' : 'Load'} onPress={load} disabled={loading} />
        </View>
        {report?.summary ? <View style={s.statRow}><StatCard label="Lines" value={String(report.summary.line_count ?? 0)} /><StatCard label="Qty" value={String(report.summary.total_qty ?? 0)} /><StatCard label="Total" value={money(report.summary.total_amount)} warm /></View> : null}
        {report?.days?.map((day) => (
          <View key={day.date || Math.random()} style={{ gap: 8 }}>
            <SectionTitle title={day.date || ''} right={money(day.total_amount)} />
            {day.lines?.map((line, idx) => <View key={idx} style={s.card}><Text style={s.itemTitle}>{line.product_name || '-'}</Text><Text style={s.muted}>{line.order_number} • {line.order_type || 'regular'}</Text><Text style={s.amount}>Qty {line.quantity ?? 0} × {money(line.price)} = {money(line.line_total)}</Text></View>)}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function SettingsPanel() {
  const [sound, setSound] = useState(true);
  const [autoPrint, setAutoPrint] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(PREF_KEY).then((raw) => {
      if (!raw) return;
      const parsed = JSON.parse(raw) as { sound?: boolean; autoPrint?: boolean };
      setSound(parsed.sound ?? true);
      setAutoPrint(parsed.autoPrint ?? false);
    });
  }, []);
  function save(next: { sound?: boolean; autoPrint?: boolean }) {
    const value = { sound, autoPrint, ...next };
    setSound(value.sound);
    setAutoPrint(value.autoPrint);
    AsyncStorage.setItem(PREF_KEY, JSON.stringify(value));
    if (!value.sound) syncPendingOrderNotifications([]).catch(() => undefined);
  }
  return (
    <>
      <SectionTitle title="Order alerts" />
      <View style={s.card}>
        <View style={s.rowBetween}><View><Text style={s.itemTitle}>Sound on new order</Text><Text style={s.muted}>Bell and vibrate on new order</Text></View><Switch value={sound} onValueChange={(v) => save({ sound: v })} /></View>
        <Secondary label="Test order vibration" onPress={() => Vibration.vibrate([0, 300, 120, 300])} />
        <View style={s.rowBetween}><View><Text style={s.itemTitle}>Auto-print on ready</Text><Text style={s.muted}>Enabled for native printer integration</Text></View><Switch value={autoPrint} onValueChange={(v) => save({ autoPrint: v })} /></View>
      </View>
    </>
  );
}

function StockEditModal({ item, onClose, onSaved }: { item: InventoryItem | null; onClose: () => void; onSaved: () => void }) {
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('');
  const [available, setAvailable] = useState(true);
  useEffect(() => {
    if (item) {
      setPrice(String(item.price));
      setStock(String(item.stock));
      setAvailable(item.is_available !== 0);
    }
  }, [item]);
  async function save() {
    if (!item) return;
    try {
      await sellerApi.updateStock({ product_id: item.id, price: Number(price || item.price), stock: Number(stock || item.stock), is_available: available ? 1 : 0 });
      onSaved();
    } catch (err) {
      Alert.alert('Update product', errorMessage(err));
    }
  }
  return (
    <Modal visible={Boolean(item)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalShade}>
        <View style={s.modalCard}>
          <Text style={s.bigTitle}>Update product</Text>
          <Text style={s.muted}>{item?.name}</Text>
          <Field label="Price" value={price} onChangeText={(v) => setPrice(v.replace(/[^0-9.]/g, ''))} keyboardType="decimal-pad" />
          <Field label="Stock qty" value={stock} onChangeText={(v) => setStock(v.replace(/\D/g, ''))} keyboardType="number-pad" />
          <View style={s.rowBetween}><Text style={s.itemTitle}>Available for sale</Text><Switch value={available} onValueChange={setAvailable} /></View>
          <Primary label="Save" onPress={save} />
          <Secondary label="Cancel" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function OrderCard({ order, onOpen, onAction }: { order: Order; onOpen: () => void; onAction: (code: string) => void }) {
  const tone = statusTone(order.status);
  return (
    <TouchableOpacity style={s.orderCard} onPress={onOpen}>
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={s.orderNo}>{order.order_number}</Text>
          <Text style={s.muted}>{prettyDate(order.created_at)}</Text>
        </View>
        <View style={[s.pill, { backgroundColor: tone.bg, minWidth: 120 }]}><Text style={[s.pillText, { color: tone.fg }]}>{tone.label}</Text></View>
      </View>
      {isPrescription(order) ? <Text style={s.rxBadge}>Prescription order</Text> : null}
      {isVirtualShop(order) ? <VirtualShopBanner order={order} compact /> : null}
      <View style={s.rowBetween}>
        <View style={{ flex: 1 }}>
          <Text style={s.customer}>{order.customer_name || 'Customer'}</Text>
          <Text style={s.muted}>{[order.address_line, order.city].filter(Boolean).join(', ')}</Text>
        </View>
        <Text style={s.orderAmount}>{money(order.total_amount)}</Text>
      </View>
      <View style={s.actionRow}>
        {order.payment_method ? <Pill text={order.payment_method.toUpperCase()} /> : null}
        {quickActions(order.status).map((a) => <TouchableOpacity key={a.code} style={s.actionPill} onPress={() => onAction(a.code)}><Text style={s.actionText}>{a.label}</Text></TouchableOpacity>)}
      </View>
    </TouchableOpacity>
  );
}

function ProductRow({ item, onPress }: { item: InventoryItem; onPress: () => void }) {
  const low = item.stock <= 5;
  return (
    <TouchableOpacity style={s.productCard} onPress={onPress}>
      <View style={[s.plusTile, { backgroundColor: low ? C.redSoft : C.blueSoft }]}><Text style={[s.plus, { color: low ? C.red : C.blue }]}>+</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={s.itemTitle}>{item.name}</Text>
        <Text style={s.muted}>{item.category_name || 'Medicine'}</Text>
        <Text style={[s.stockText, { color: low ? C.red : C.green }]}>{item.stock} in stock</Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 30 }}>
        <Text style={s.itemPrice}>{money(item.price)}</Text>
        {item.requires_prescription === 1 ? <Pill text="Rx" /> : item.auto_added === 1 ? <Pill text="Auto-added" tone="purple" /> : low ? <Pill text="Low" tone="red" /> : null}
      </View>
    </TouchableOpacity>
  );
}

function FreshBanner({ order, onOpen, onClose }: { order: Order; onOpen: () => void; onClose: () => void }) {
  return (
    <TouchableOpacity style={s.freshBanner} onPress={onOpen}>
      <View style={{ flex: 1 }}><Text style={s.freshTitle}>New order received!</Text><Text style={s.freshText}>{order.order_number} • {order.customer_name || 'Customer'} • {money(order.total_amount)}</Text></View>
      <Pressable onPress={onClose}><Text style={s.close}>×</Text></Pressable>
    </TouchableOpacity>
  );
}

function NewOrderPopup({ order, onOpen, onClose }: { order: Order | null; onOpen: () => void; onClose: () => void }) {
  return (
    <Modal visible={Boolean(order)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.modalShade}>
        <View style={s.newOrderModal}>
          <View style={s.zTile}><Text style={s.zText}>Z+</Text></View>
          <Text style={s.newOrderTitle}>New order received</Text>
          <Text style={s.newOrderNo}>{order?.order_number}</Text>
          <Text style={s.newOrderBody}>{order?.customer_name || 'Customer'} • {money(order?.total_amount)}</Text>
          <Text style={s.newOrderHint}>Notifications will continue until this order is accepted or moved out of pending.</Text>
          <Primary label="Open order" onPress={onOpen} />
          <Secondary label="Later" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function VirtualShopBanner({ order, compact }: { order: Pick<Order, 'virtual_shop_label' | 'preferred_pharmacy_name' | 'shop_order_discount' | 'routing_notes' | 'customer_shop_mode'>; compact?: boolean }) {
  return (
    <View style={[s.virtualBanner, compact && { marginVertical: 8 }]}>
      <Text style={s.virtualTitle}>{order.virtual_shop_label || 'Virtual Shop order'}</Text>
      {order.preferred_pharmacy_name ? <Text style={s.virtualText}>Preferred shop: {order.preferred_pharmacy_name}</Text> : null}
      {order.shop_order_discount ? <Text style={s.virtualText}>Virtual shop discount: {money(order.shop_order_discount)}</Text> : null}
      {order.routing_notes ? <Text style={s.virtualText}>{order.routing_notes}</Text> : null}
    </View>
  );
}

function WholesaleOrderCard({ order, action }: { order: WholesaleOrder; action?: (code: string) => void }) {
  return (
    <View style={s.card}>
      <Text style={s.itemTitle}>{order.order_number}</Text>
      <Text style={s.muted}>{order.wholeseller_pharmacy_name || order.buyer_pharmacy_name || '-'} • {money(order.subtotal)} • {order.status}</Text>
      {order.items?.slice(0, 2).map((i, idx) => <Text key={idx} style={s.muted}>{i.product_name || i.quantity_label || `${i.quantity ?? 0} ${i.quantity_unit || ''}`}</Text>)}
      {action ? <View style={s.actionRow}><Secondary label="Confirm" compact onPress={() => action('confirm')} /><Danger label="Reject" compact onPress={() => action('reject')} /><Primary label="Fulfill" compact onPress={() => action('fulfill')} /></View> : null}
    </View>
  );
}

function BottomTabs({ current, setTab, pending, showWholesale }: { current: TabKey; setTab: (tab: TabKey) => void; pending: number; showWholesale: boolean }) {
  const tabs: Array<[TabKey, string, string]> = [['home', 'Home', '⌂'], ['orders', 'Orders', '▣'], ['catalog', 'Catalog', '▦']];
  if (showWholesale) tabs.push(['wholesale', 'Wholesale', '◇']);
  tabs.push(['more', 'More', '•••']);
  return (
    <View style={s.tabs}>
      {tabs.map(([key, label, icon]) => (
        <TouchableOpacity key={key} style={[s.tab, current === key && s.tabActive]} onPress={() => setTab(key)}>
          <View><Text style={[s.tabIcon, current === key && s.tabTextActive]}>{icon}</Text>{key === 'orders' && pending > 0 ? <Text style={s.badge}>{pending > 9 ? '9+' : pending}</Text> : null}</View>
          <Text style={[s.tabLabel, current === key && s.tabTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function Segment<T extends string>({ value, options, onChange, dark }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void; dark?: boolean }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.segment}>
      {options.map(([v, label]) => {
        const selected = value === v;
        return <TouchableOpacity key={v} style={[s.segmentItem, selected && (dark ? s.segmentDark : s.segmentSelected)]} onPress={() => onChange(v)}><Text style={[s.segmentText, selected && (dark ? { color: '#FFF' } : { color: C.orange })]}>{label}</Text></TouchableOpacity>;
      })}
    </ScrollView>
  );
}

function Field(props: React.ComponentProps<typeof TextInput> & { label: string; compact?: boolean }) {
  const { label, compact, style, ...rest } = props;
  return (
    <View style={[compact && { flex: 1 }]}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput placeholderTextColor={C.muted} style={[s.input, compact && s.inputCompact, style]} {...rest} />
    </View>
  );
}

function SearchBox(props: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return <TextInput style={s.search} placeholderTextColor={C.muted} {...props} />;
}

function Primary({ label, onPress, disabled, compact }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return <TouchableOpacity disabled={disabled} style={[s.primary, compact && s.compactButton, disabled && { opacity: 0.55 }]} onPress={onPress}><Text style={s.primaryText}>{label}</Text></TouchableOpacity>;
}

function Secondary({ label, onPress, disabled, compact }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return <TouchableOpacity disabled={disabled} style={[s.secondary, compact && s.compactButton, disabled && { opacity: 0.55 }]} onPress={onPress}><Text style={s.secondaryText}>{label}</Text></TouchableOpacity>;
}

function Danger({ label, onPress, disabled, compact }: { label: string; onPress: () => void; disabled?: boolean; compact?: boolean }) {
  return <TouchableOpacity disabled={disabled} style={[s.secondary, compact && s.compactButton, { borderColor: C.redSoft }]} onPress={onPress}><Text style={[s.secondaryText, { color: C.red }]}>{label}</Text></TouchableOpacity>;
}

function Pill({ text, tone }: { text: string; tone?: 'green' | 'blue' | 'red' | 'purple' }) {
  const color = tone === 'green' ? [C.greenSoft, C.green] : tone === 'blue' ? [C.blueSoft, C.blue] : tone === 'red' ? [C.redSoft, C.red] : tone === 'purple' ? [C.purpleSoft, C.purple] : [C.beige, C.muted];
  return <View style={[s.pill, { backgroundColor: color[0] }]}><Text style={[s.pillText, { color: color[1] }]}>{text}</Text></View>;
}

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return <View style={s.sectionTitle}><Text style={s.sectionText}>{title}</Text>{right ? <Text style={s.sectionRight}>{right}</Text> : null}</View>;
}

function Kpi({ label, value, tone, onPress }: { label: string; value: string; tone?: 'blue' | 'orange' | 'green' | 'purple'; onPress?: () => void }) {
  const palette = tone === 'green'
    ? [C.greenSoft, C.green]
    : tone === 'purple'
      ? [C.purpleSoft, C.purple]
      : tone === 'orange'
        ? [C.orangeSoft, C.orange]
        : [C.blueSoft, C.blue];
  return (
    <TouchableOpacity activeOpacity={0.82} disabled={!onPress} style={[s.kpi, { backgroundColor: palette[0] }]} onPress={onPress}>
      <Text style={[s.kpiLabel, { color: palette[1] }]}>{label}</Text>
      <Text style={s.kpiValue}>{value}</Text>
      <Text style={[s.kpiArrow, { color: palette[1] }]}>›</Text>
    </TouchableOpacity>
  );
}

function StatCard({ label, value, warm }: { label: string; value: string; warm?: boolean }) {
  return <View style={[s.statCard, warm && { backgroundColor: C.yellowSoft }]}><Text style={s.kpiLabel}>{label}</Text><Text style={[s.statValue, warm && { color: C.yellow }]}>{value}</Text></View>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <View style={{ marginBottom: 10 }}><Text style={s.kpiLabel}>{label}</Text><Text style={s.infoValue}>{value}</Text></View>;
}

function MenuItem({ title, body, badge, onPress }: { title: string; body: string; badge?: string; onPress: () => void }) {
  return <TouchableOpacity style={s.menuItem} onPress={onPress}><View style={{ flex: 1 }}><Text style={s.itemTitle}>{title}</Text><Text style={s.muted}>{body}</Text></View>{badge ? <Pill text={badge} tone="green" /> : null}<Text style={s.chev}>›</Text></TouchableOpacity>;
}

function Notice({ tone, title, body }: { tone: 'success' | 'error' | 'warn'; title: string; body?: string }) {
  const bg = tone === 'success' ? C.greenSoft : tone === 'warn' ? C.yellowSoft : C.redSoft;
  const fg = tone === 'success' ? C.green : tone === 'warn' ? C.yellow : C.red;
  return <View style={[s.notice, { backgroundColor: bg }]}><Text style={[s.noticeTitle, { color: fg }]}>{title}</Text>{body ? <Text style={[s.noticeBody, { color: fg }]}>{body}</Text> : null}</View>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return <View style={s.empty}><Text style={s.emptyTitle}>{title}</Text><Text style={s.muted}>{body}</Text></View>;
}

function IconButton({ label, onPress }: { label: string; onPress: () => void }) {
  return <TouchableOpacity style={s.iconButton} onPress={onPress}><Text style={s.iconText}>{label}</Text></TouchableOpacity>;
}

function OrderStepper({ status }: { status: string }) {
  const steps = ['New', 'Confirmed', 'Preparing', 'Ready'];
  const normalized = status === 'ready_for_pickup' ? 'Ready' : status === 'preparing' ? 'Preparing' : status === 'confirmed' ? 'Confirmed' : 'New';
  const current = Math.max(0, steps.indexOf(normalized));
  return <View style={s.stepper}>{steps.map((step, idx) => <View key={step} style={s.step}><Text style={[s.stepDot, idx <= current && { color: C.orange }]}>●</Text><Text style={s.stepText}>{step}</Text></View>)}</View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  centerCompact: { minHeight: 120, alignItems: 'center', justifyContent: 'center' },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg },
  splashMark: { width: 118, height: 118, borderRadius: 28, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  zTile: { width: 54, height: 54, borderRadius: 14, backgroundColor: C.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  zText: { color: C.orange, fontWeight: '900', fontSize: 22 },
  splashTitle: { marginTop: 34, fontSize: 28, fontWeight: '900', color: C.ink },
  splashSub: { marginTop: 8, color: C.muted, fontSize: 16 },
  dots: { flexDirection: 'row', gap: 12, marginTop: 56 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.orange },
  authWrap: { padding: 28, gap: 20 },
  authHero: { backgroundColor: '#FFF', borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 20, minHeight: 176, justifyContent: 'center' },
  authTitle: { marginTop: 16, color: C.ink, fontSize: 27, fontWeight: '900' },
  authSub: { color: C.muted, marginTop: 4, fontSize: 14 },
  header: { minHeight: 92, paddingHorizontal: 18, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.bg },
  headerTitle: { color: C.ink, fontWeight: '900', fontSize: 22 },
  headerSub: { color: C.muted, marginTop: 3, fontSize: 12 },
  iconButton: { width: 39, height: 39, borderRadius: 12, backgroundColor: C.beige, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: C.muted, fontSize: 22, fontWeight: '900' },
  body: { paddingHorizontal: 18, paddingBottom: 110, gap: 14 },
  dashboardCard: { backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 18, gap: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 2 },
  card: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  bigTitle: { color: C.ink, fontWeight: '900', fontSize: 20 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: { width: '47.9%', aspectRatio: 1, borderRadius: 16, padding: 14, justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(32,33,30,0.05)', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 1 },
  kpiLabel: { color: C.muted, fontSize: 12, fontWeight: '800' },
  kpiValue: { color: C.ink, fontSize: 26, fontWeight: '900', marginTop: 4 },
  kpiArrow: { position: 'absolute', right: 12, bottom: 8, fontSize: 28, fontWeight: '900' },
  infoCard: { borderRadius: 16, padding: 16 },
  infoTitle: { fontWeight: '900', fontSize: 15 },
  infoText: { marginTop: 6, fontSize: 13 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  sectionText: { color: C.ink, fontSize: 20, fontWeight: '900' },
  sectionRight: { color: C.muted, fontSize: 12, fontWeight: '700' },
  orderCard: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 12 },
  orderNo: { color: C.ink, fontSize: 18, fontWeight: '900' },
  customer: { color: C.ink, fontSize: 16, fontWeight: '900' },
  orderAmount: { color: C.ink, fontSize: 21, fontWeight: '900' },
  amount: { color: C.ink, fontWeight: '900', fontSize: 16 },
  pill: { borderRadius: 18, paddingHorizontal: 14, paddingVertical: 7, alignItems: 'center' },
  pillText: { fontSize: 12, fontWeight: '900' },
  rxBadge: { color: C.purple, fontSize: 12, fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  actionPill: { borderRadius: 18, backgroundColor: C.greenSoft, paddingHorizontal: 16, paddingVertical: 8 },
  actionText: { color: C.green, fontSize: 12, fontWeight: '900' },
  freshBanner: { backgroundColor: C.orangeSoft, borderColor: '#EEC9B8', borderWidth: 1, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center' },
  freshTitle: { color: C.orange, fontWeight: '900', fontSize: 15 },
  freshText: { color: C.ink, marginTop: 8 },
  close: { color: C.muted, fontSize: 24, fontWeight: '900' },
  search: { height: 54, backgroundColor: '#FFF', borderWidth: 1, borderColor: C.line, borderRadius: 16, paddingHorizontal: 18, color: C.ink, fontSize: 15 },
  segment: { flexDirection: 'row', gap: 10, paddingVertical: 2 },
  segmentItem: { minWidth: 86, height: 30, borderRadius: 18, backgroundColor: C.beige, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  segmentSelected: { backgroundColor: C.orangeSoft },
  segmentDark: { backgroundColor: C.ink },
  segmentText: { color: C.muted, fontSize: 12, fontWeight: '900' },
  count: { color: C.muted, fontSize: 14, fontWeight: '800' },
  statRow: { flexDirection: 'row', gap: 18 },
  statCard: { flex: 1, backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, minHeight: 82 },
  statValue: { color: C.ink, fontWeight: '900', fontSize: 28, marginTop: 8 },
  smallChip: { alignSelf: 'flex-start', paddingHorizontal: 14, height: 30, borderRadius: 18, backgroundColor: C.beige, justifyContent: 'center' },
  smallChipText: { color: C.muted, fontWeight: '900', fontSize: 12 },
  purchaseCta: { height: 60, borderRadius: 16, backgroundColor: C.greenSoft, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  purchaseText: { color: C.green, fontSize: 16, fontWeight: '900' },
  purchaseArrow: { color: C.green, fontSize: 28, fontWeight: '900' },
  productCard: { backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'center' },
  plusTile: { width: 50, height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  plus: { fontSize: 28, fontWeight: '900' },
  itemTitle: { color: C.ink, fontSize: 16, fontWeight: '900' },
  itemPrice: { color: C.ink, fontSize: 16, fontWeight: '900' },
  stockText: { fontSize: 13, fontWeight: '900', marginTop: 10 },
  fieldLabel: { color: C.muted, fontSize: 12, fontWeight: '800', marginBottom: 7, marginLeft: 2 },
  input: { minHeight: 56, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: '#FFF', paddingHorizontal: 14, color: C.ink, fontSize: 16 },
  inputCompact: { minHeight: 48 },
  inputRow: { flexDirection: 'row', gap: 10 },
  primary: { minHeight: 56, borderRadius: 14, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: '#FFF', fontSize: 16, fontWeight: '900' },
  secondary: { minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryText: { color: C.orange, fontSize: 14, fontWeight: '900' },
  compactButton: { minHeight: 38, flex: 1 },
  notice: { borderRadius: 14, padding: 14 },
  noticeTitle: { fontWeight: '900', fontSize: 14 },
  noticeBody: { marginTop: 8, fontSize: 13, lineHeight: 18 },
  empty: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 28, alignItems: 'center' },
  emptyTitle: { color: C.ink, fontSize: 17, fontWeight: '900', marginBottom: 6 },
  infoValue: { color: C.ink, fontSize: 14, fontWeight: '800', marginTop: 4 },
  menuItem: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  chev: { color: C.muted, fontSize: 28 },
  footer: { color: C.muted, textAlign: 'center', fontSize: 12, marginTop: 8 },
  qtyInput: { width: 78, height: 48, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: '#FFF', textAlign: 'center', color: C.ink, fontWeight: '900' },
  backText: { color: C.orange, fontSize: 16, fontWeight: '900' },
  rxImage: { height: 250, backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line },
  virtualBanner: { backgroundColor: '#FFF7ED', borderRadius: 14, padding: 12 },
  virtualTitle: { color: C.orangeDark, fontWeight: '900', fontSize: 13 },
  virtualText: { color: C.yellow, fontSize: 12, marginTop: 4 },
  stepper: { backgroundColor: C.greenSoft, borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', flex: 1 },
  stepDot: { color: C.muted, fontSize: 18 },
  stepText: { color: C.muted, fontSize: 11, fontWeight: '800', marginTop: 4 },
  tabs: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 80, backgroundColor: '#FFF', borderTopWidth: 1, borderTopColor: C.line, flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 10, paddingTop: 8 },
  tab: { minWidth: 64, height: 58, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: C.beige },
  tabIcon: { color: C.muted, fontSize: 22, fontWeight: '900', textAlign: 'center' },
  tabLabel: { color: C.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
  tabTextActive: { color: C.orange },
  badge: { position: 'absolute', right: -14, top: -8, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#A34641', color: '#FFF', fontWeight: '900', textAlign: 'center', overflow: 'hidden', fontSize: 11, lineHeight: 20 },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.36)', justifyContent: 'center', padding: 22 },
  modalCard: { backgroundColor: C.bg, borderRadius: 22, padding: 20, gap: 12 },
  newOrderModal: { backgroundColor: C.bg, borderRadius: 24, padding: 22, gap: 12, alignItems: 'center' },
  newOrderTitle: { color: C.orange, fontSize: 18, fontWeight: '900', marginTop: 4 },
  newOrderNo: { color: C.ink, fontSize: 24, fontWeight: '900' },
  newOrderBody: { color: C.ink, fontSize: 16, fontWeight: '800' },
  newOrderHint: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 4 },
});
