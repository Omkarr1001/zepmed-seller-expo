import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundFetch from 'expo-background-fetch';
import * as FileSystem from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import * as Sharing from 'expo-sharing';
import { StatusBar } from 'expo-status-bar';
import * as TaskManager from 'expo-task-manager';
import { jwtDecode } from 'jwt-decode';
import { csvFromRows, printBill, shareBillPdf, type PrinterLayout } from './printBill';
import { prepareOrderBell, startOrderBell, stopOrderBell } from './orderBell';
import { listPairedPrinters, readSellerPrefs, writeSellerPrefs, type PairedPrinter } from './printerNative';
import { setOrderWatchSound, silenceNativeOrder, startOrderWatch, stopOrderWatch } from './orderWatch';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Easing,
  Image,
  Linking,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
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
  phpFallbackBaseUrl: 'https://zepmed.org/api/v1',
  authBaseUrl: 'https://auth.zepmed.org/api/v1',
  authFallbackBaseUrl: 'https://api.zepmed.org/auth-api/v1',
  authLegacyBaseUrl: 'https://zepmed.org/auth-api/v1',
};

const C = {
  bg: '#F3F8F7',
  surface: '#FFFFFF',
  ink: '#12312F',
  muted: '#5E7370',
  line: '#D5E4E1',
  orange: '#E2632E',
  redAccent: '#EF4F3E',
  orangeDark: '#C84E21',
  orangeSoft: '#F8E1D4',
  beige: '#E7F3F1',
  greenSoft: '#D7EDE3',
  green: '#0F766E',
  blueSoft: '#DDE8F5',
  blue: '#2D5D85',
  yellowSoft: '#F6ECC8',
  yellow: '#84661B',
  redSoft: '#F2DADA',
  red: '#9A3D3A',
  purpleSoft: '#EAE0F2',
  purple: '#71508A',
  teal: '#0F766E',
  tealDeep: '#0B5B55',
  tealSoft: '#D7EFEA',
};
const LOGO = require('./assets/zepmed_logo.jpg');
const APP_ICON = require('./assets/ic_launcher.png');

const SESSION_KEY = 'zepmed:seller:session';
const PENDING_NOTIFICATIONS_KEY = 'zepmed:seller:pending-notifications-v4';
const NOTIF_RESET_KEY = 'zepmed:seller:notif-reset-v4';
const ORDER_POLL_TASK = 'zepmed-seller-order-poll';
const ORDER_NOTIFICATION_CATEGORY = 'zepmed-seller-order-actions';
const ORDER_CHANNEL = 'zepmed-order-bell-v4';
const silencedOrderIds = new Set<number>();
const TAB_LOGOS: Record<TabKey, number> = {
  home: require('./assets/tab-home.png'),
  orders: require('./assets/tab-orders.png'),
  catalog: require('./assets/tab-catalog.png'),
  stock: require('./assets/tab-stock.png'),
  more: require('./assets/tab-more.png'),
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
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
type PharmacyInfo = { id?: number; name?: string | null; city?: string | null; address?: string | null; pincode?: string | null; phone?: string | null; status?: string | null; delivery_fee?: number | null; min_order?: number | null };
type PharmacyInfoPayload = {
  pharmacy?: PharmacyInfo | null;
  billing?: { dl_number?: string | null; gstin?: string | null } | null;
  bill_header?: Record<string, unknown> | null;
};
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
  is_open?: boolean | number | null;
  auto_active_now?: boolean | number | null;
  pharmacy?: PharmacyInfo | null;
  subscription?: SubscriptionInfo | null;
  plan_features?: PlanFeatures | null;
  pharmacy_wallet_balance?: number | null;
  owner_name?: string | null;
  drug_license?: { status?: string | null; days_left?: number | null; expiry_date?: string | null; message?: string | null; restricted?: boolean | null; renewal_required?: boolean | null } | null;
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
  accept_timeout_minutes?: number | null;
  accept_seconds_remaining?: number | null;
  accept_deadline_at?: string | null;
  fulfillment_status?: string | null;
  order_type?: string | null;
  routed_via?: string | null;
  seller_confirmed_at?: string | null;
  forwarded_to_me?: boolean | number | null;
  viewer_is_owner?: boolean | null;
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

type TabKey = 'home' | 'orders' | 'catalog' | 'stock' | 'more';
type AuthTab = 'password' | 'otp' | 'register';
type OrderFilter = 'all' | 'pending' | 'rx' | 'preparing' | 'ready' | 'delivered';
type DashboardTarget = 'orders' | 'pending' | 'revenue' | 'delivered';
type MoreModule = 'pharmacy' | 'settings' | 'notifications' | 'rx' | 'stock' | 'virtual' | 'payouts' | 'wholesale' | 'referral' | 'products' | 'subscription' | 'printer' | null;
type ReportTab = 'items' | 'orders' | 'rx' | 'virtual' | 'wallet';
type CatalogSuggestion = { id?: number; product_id?: number; name: string; price?: number | null; seller_stock?: number | null };
type RxMedicineRow = { product_id?: number; name: string; qty: string; price: string };
type SellerSettings = {
  settings?: {
    store?: { auto_mode?: boolean | number; open_time?: string; close_time?: string; days?: number[] };
    notifications?: { order_sound?: boolean; order_vibrate?: boolean; desktop_alert?: boolean };
    advanced?: { order_poll_sec?: number; low_stock_alert?: boolean };
    delivery?: { delivery_fee?: number; min_order?: number; free_delivery_above?: number; per_km_rate?: number; included_km?: number; agent_per_km_rate?: number };
    printer?: { type?: string; model?: string; output?: string; language?: string; paper?: string; auto_print_on_ready?: boolean | number };
    modules?: Record<string, boolean>;
  };
  is_open?: boolean | number;
  auto_active_now?: boolean | number;
  pharmacy?: PharmacyInfo | null;
};
type SellerNotification = { id: number; title?: string | null; message?: string | null; body?: string | null; is_read?: number | boolean | null; created_at?: string | null; category?: string | null; type?: string | null };
type RxRequest = { id: number; customer_name?: string | null; customer_phone?: string | null; status?: string | null; prescription_url?: string | null; created_at?: string | null; notes?: string | null; request_number?: string | null; message?: string | null };
type DiscountRule = {
  id: number;
  name?: string | null;
  target_type?: string | null;
  target_id?: number | null;
  target_label?: string | null;
  product_name?: string | null;
  discount_pct?: number | null;
  min_order?: number | null;
  status?: string | null;
  is_live?: number | null;
  sort_order?: number | null;
  starts_at?: string | null;
  ends_at?: string | null;
};
type ReferralData = {
  seller_referral_code?: string | null;
  share_referral?: string | null;
  seller_mobile?: string | null;
  register_link?: string | null;
  referred_count?: number | null;
  referred_customers_count?: number | null;
  bonus_pending?: number | null;
  bonus_approved?: number | null;
  bonus_paid?: number | null;
  pharmacy_wallet_balance?: number | null;
  customers?: Array<{ name?: string | null; mobile?: string | null }> | null;
  recent_bonuses?: Array<{ amount?: number | null; status?: string | null; created_at?: string | null; note?: string | null }> | null;
};
type StockHistoryItem = { id?: number; product_name?: string | null; txn_type?: string | null; quantity?: number | null; notes?: string | null; reference_number?: string | null; created_at?: string | null };
type WalletTxn = { id?: number; created_at?: string | null; type?: string | null; amount?: number | null; source?: string | null; reference_type?: string | null; reference_id?: number | null; note?: string | null };
type OrderSalesItem = {
  id?: number;
  order_number?: string | null;
  status?: string | null;
  order_type?: string | null;
  payment_method?: string | null;
  created_at?: string | null;
  subtotal?: number | null;
  seller_payout_amount?: number | null;
  cod_collect_amount?: number | null;
  wallet_discount?: number | null;
  settlement_ok?: number | null;
  anomaly_messages?: string[] | null;
};
type OrderSalesReport = {
  from?: string | null;
  to?: string | null;
  items?: OrderSalesItem[] | null;
  summary?: { order_count?: number | null; subtotal?: number | null; seller_payout_total?: number | null; cod_collect_total?: number | null; anomaly_orders?: number | null } | null;
};
type RxOrdersReport = {
  rx_requests?: Array<{ id?: number; request_number?: string | null; customer_name?: string | null; customer_phone?: string | null; status?: string | null; created_at?: string | null }> | null;
  prescription_orders?: Array<{ order_number?: string | null; status?: string | null; seller_payout_amount?: number | null; created_at?: string | null }> | null;
  summary?: { rx_requests?: number | null; prescription_orders?: number | null; order_payout_total?: number | null } | null;
};
type ProductCategory = { id: number; name: string };
type SubscriptionPreview = { plan_id?: number | null; plan_name?: string | null; plan_price?: number | null; wallet_applied?: number | null; payable?: number | null; days?: number | null };
type StockSuggestion = { product_id?: number; id?: number; name?: string | null; product_name?: string | null; stock?: number | null; suggested_qty?: number | null; reason?: string | null };
type StockManagementData = { items?: InventoryItem[] | null; summary?: Record<string, number> | null };
type VirtualShopData = {
  pharmacy?: PharmacyInfo | null;
  settings?: SellerSettings['settings'] & { virtual_shop?: { listing_enabled?: boolean | number; discount_pct?: number; order_discount_pct?: number; order_discount_min?: number; managed_inventory?: boolean | number; banners?: Array<{ banner_id?: string; title?: string; image_url?: string; link_url?: string }> } };
  managed_inventory?: boolean | number;
  discounts?: DiscountRule[];
  banners?: Array<{ banner_id?: string; title?: string; image_url?: string; link_url?: string }>;
  listing_status?: string | null;
};
type PayoutOrder = { id: number; order_number?: string | null; status?: string | null; seller_payout_amount?: number | null; total_amount?: number | null; cod_collected?: number | null; created_at?: string | null };

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

function hasFeature(dash: DashboardData | null, feature: string) {
  const features = dash?.plan_features?.features ?? dash?.subscription?.plan_features?.features ?? [];
  return Array.isArray(features) && features.map((f) => String(f).toLowerCase()).includes(feature.toLowerCase());
}

function unwrapPharmacy(data?: PharmacyInfo | PharmacyInfoPayload | null): PharmacyInfo {
  if (!data) return {};
  if ('pharmacy' in data && data.pharmacy) return data.pharmacy;
  return data as PharmacyInfo;
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

function orderCanShowNewPopup(order: Order) {
  if (silencedOrderIds.has(order.id)) return false;
  if (!pendingStatus(order.status)) return false;
  if (order.seller_confirmed_at) return false;
  if (order.forwarded_to_me) return false;
  if (order.viewer_is_owner === false) return false;
  if (order.accept_seconds_remaining != null) return Number(order.accept_seconds_remaining) > 0;
  if (order.accept_deadline_at) {
    const normalized = order.accept_deadline_at.includes('T') ? order.accept_deadline_at : order.accept_deadline_at.replace(' ', 'T');
    const deadline = new Date(normalized).getTime();
    if (!Number.isNaN(deadline)) return deadline > Date.now();
  }
  return true;
}

function silenceOrderAlert(orderId: number) {
  silencedOrderIds.add(orderId);
}

function forgetSettledSilenced(orders: Order[]) {
  for (const id of [...silencedOrderIds]) {
    const order = orders.find((item) => item.id === id);
    if (!order || !pendingStatus(order.status) || order.seller_confirmed_at) silencedOrderIds.delete(id);
  }
}

function quickActions(status: string) {
  const s = status.toLowerCase();
  if (s === 'confirmed') return [{ code: 'preparing', label: 'Preparing' }, { code: 'ready_for_pickup', label: 'Ready' }];
  if (s === 'preparing') return [{ code: 'ready_for_pickup', label: 'Ready' }];
  return [];
}

function orderCardActions(order: Order) {
  if (pendingStatus(order.status)) {
    if (isPrescription(order)) return order.seller_confirmed_at ? [] : [{ code: 'rx_accept', label: 'Accept' }];
    return [{ code: 'confirmed', label: 'Accept' }];
  }
  return quickActions(order.status);
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
  if (isAbortError(err) || /abort/i.test(msg)) return 'Connection timed out. Please try again.';
  if (/network request failed|unable to resolve|failed to fetch/i.test(msg)) return 'Cannot reach ZepMed. Check internet and try again.';
  if (/timeout|timed out/i.test(msg) && !/printer/i.test(msg)) return 'Connection timed out. Try again.';
  if (/server error \(502\)|bad gateway|http 502/i.test(msg)) return 'ZepMed server gateway error (502). The backend is temporarily unavailable; retry in a moment.';
  if (/server error \(503\)|server error \(504\)/i.test(msg)) return 'ZepMed server is temporarily unavailable. Retry in a moment.';
  return msg || 'Something went wrong.';
}

function isAbortError(err: unknown) {
  return err instanceof Error && (err.name === 'AbortError' || /aborted|abort/i.test(err.message));
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
  const prefs = await readPrefs();
  startOrderWatch(data.access_token, data.refresh_token || current.refreshToken, prefs.sound);
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
    : [API.phpBaseUrl, API.phpFallbackBaseUrl];
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
      if (idx < bases.length - 1) continue;
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
    if ([404, 502, 503, 504].includes(response.status) && idx < bases.length - 1) continue;
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
  return readSellerPrefs();
}

function orderNotificationIds(orderId: number) {
  return {
    now: `zepmed-order-${orderId}`,
    remind: `zepmed-order-remind-${orderId}`,
  };
}

async function cancelStoredNotificationIds(stored?: string) {
  if (!stored) return;
  await Promise.all(stored.split('|').map(async (id) => {
    await Notifications.cancelScheduledNotificationAsync(id).catch(() => undefined);
    await Notifications.dismissNotificationAsync(id).catch(() => undefined);
  }));
}

async function ensureNotificationReady() {
  if (!(await AsyncStorage.getItem(NOTIF_RESET_KEY))) {
    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => undefined);
    await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
    await AsyncStorage.setItem(NOTIF_RESET_KEY, '1');
  }
  if (Platform.OS === 'android') {
    if (Number(Platform.Version) >= 33) {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS).catch(() => undefined);
    }
    await Notifications.setNotificationChannelAsync(ORDER_CHANNEL, {
      name: 'ZepMed new orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 400, 150, 400, 150, 500],
      sound: 'bell',
      enableVibrate: true,
      enableLights: true,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      showBadge: true,
    });
  }
  await Notifications.setNotificationCategoryAsync(ORDER_NOTIFICATION_CATEGORY, [
    { identifier: 'accept', buttonTitle: 'Accept', options: { opensAppToForeground: true } },
    { identifier: 'open', buttonTitle: 'Open', options: { opensAppToForeground: true } },
  ]).catch(() => undefined);
  const existing = await Notifications.getPermissionsAsync();
  if (!existing.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  }
  return true;
}

function orderNotificationContent(order: Order) {
  return {
    title: `New order ${order.order_number || ''}`.trim(),
    body: `${order.customer_name || 'Customer'} • ${money(order.total_amount)}. Tap to open and accept.`,
    sound: 'bell',
    data: { orderId: order.id },
    categoryIdentifier: ORDER_NOTIFICATION_CATEGORY,
    sticky: true,
    autoDismiss: false,
    priority: Notifications.AndroidNotificationPriority.MAX,
  };
}

async function schedulePendingOrderNotification(order: Order, existing: Record<string, string>, force = false) {
  const key = String(order.id);
  const ids = orderNotificationIds(order.id);
  if (existing[key] && !force) return existing;
  const ok = await ensureNotificationReady();
  if (!ok) return existing;
  await cancelStoredNotificationIds(existing[key]);
  await Notifications.scheduleNotificationAsync({
    identifier: ids.now,
    content: orderNotificationContent(order),
    trigger: null,
  });
  await Notifications.scheduleNotificationAsync({
    identifier: ids.remind,
    content: orderNotificationContent(order),
    trigger: { seconds: 60, repeats: true, channelId: ORDER_CHANNEL } as Notifications.NotificationTriggerInput,
  });
  return { ...existing, [key]: `${ids.now}|${ids.remind}` };
}

async function syncPendingOrderNotifications(orders: Order[], opts?: { forcePresent?: boolean }) {
  forgetSettledSilenced(orders);
  const prefs = await readPrefs();
  const current = await readNotificationMap();
  const alertableOrders = orders.filter(orderCanShowNewPopup);
  const pendingIds = new Set(alertableOrders.map((order) => String(order.id)));
  let next = { ...current };
  const appActive = AppState.currentState === 'active';

  if (!prefs.sound) {
    await stopOrderBell();
    await Promise.all(Object.values(next).map((id) => cancelStoredNotificationIds(id)));
    await writeNotificationMap({});
    await Notifications.setBadgeCountAsync(0).catch(() => undefined);
    return;
  }

  if (alertableOrders.length && appActive) await startOrderBell(true);
  else await stopOrderBell();

  for (const [orderId, notificationId] of Object.entries(current)) {
    if (!pendingIds.has(orderId)) {
      await cancelStoredNotificationIds(notificationId);
      delete next[orderId];
    }
  }

  for (const order of alertableOrders) {
    next = await schedulePendingOrderNotification(order, next, opts?.forcePresent || !appActive);
  }

  if (!alertableOrders.length) {
    await Notifications.dismissAllNotificationsAsync().catch(() => undefined);
  }

  await writeNotificationMap(next);
  await Notifications.setBadgeCountAsync(pendingIds.size).catch(() => undefined);
}

async function cancelOrderNotification(orderId: number) {
  silenceOrderAlert(orderId);
  silenceNativeOrder(orderId);
  await stopOrderBell();
  const map = await readNotificationMap();
  const ids = orderNotificationIds(orderId);
  await cancelStoredNotificationIds(map[String(orderId)]);
  await Notifications.cancelScheduledNotificationAsync(ids.now).catch(() => undefined);
  await Notifications.cancelScheduledNotificationAsync(ids.remind).catch(() => undefined);
  await Notifications.dismissNotificationAsync(ids.now).catch(() => undefined);
  await Notifications.dismissNotificationAsync(ids.remind).catch(() => undefined);
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
  async logout() {
    const session = await readSession();
    if (session.refreshToken) {
      await request<Record<string, unknown>>('auth/logout', { auth: true, body: { refresh_token: session.refreshToken } }).catch(() => undefined);
    }
    await stopOrderWatch();
    await saveSession({});
  },
  async me() {
    return request<AuthSession['user']>('auth/me');
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
  inventory: (search = '') => request<{ items?: InventoryItem[] | null }>('seller/inventory', { query: { search, page: 1, limit: 100, status: 'all' } }),
  updateStock: (body: unknown) => request<Record<string, unknown>>('seller/inventory/update', { body }),
  catalogSearch: (search: string) => request<{ items?: CatalogSuggestion[] | null }>('seller/catalog/search', { query: { search, limit: 30 } }),
  dailySalesReport: (from: string, to: string) => request<DailySalesReport>('seller/reports/daily-sales', { query: { from, to } }),
  orderSalesReport: (from: string, to: string) => request<OrderSalesReport>('seller/reports/order-sales', { query: { from, to } }),
  rxOrdersReport: (from: string, to: string) => request<RxOrdersReport>('seller/reports/rx-orders', { query: { from, to } }),
  virtualShopReport: (from: string, to: string) => request<OrderSalesReport>('seller/reports/virtual-shop', { query: { from, to } }),
  walletTransactions: (from: string, to: string) => request<{ items?: WalletTxn[] | null; summary?: Record<string, number> | null }>('seller/reports/wallet-transactions', { query: { from, to, limit: 100 } }),
  payoutOrders: () => request<{ items?: PayoutOrder[] | null; summary?: Record<string, number> | null }>('seller/payouts/orders', { query: { limit: 100, status: 'all' } }),
  pharmacyInfo: () => request<PharmacyInfoPayload>('seller/pharmacy-info'),
  savePharmacyInfo: (body: unknown) => request<PharmacyInfoPayload>('seller/pharmacy-info', { body }),
  settings: () => request<SellerSettings>('seller/settings'),
  saveSettings: (body: unknown) => request<SellerSettings>('seller/settings', { body }),
  notifications: (unread = false) => request<{ items?: SellerNotification[] | null; pagination?: unknown }>('seller/notifications', { query: { page: 1, limit: 50, unread: unread ? 1 : undefined } }),
  notificationUnreadCount: () => request<{ unread_count?: number | null }>('seller/notifications/unread-count'),
  markNotificationRead: (id: number) => request<Record<string, unknown>>(`seller/notifications/${id}/read`, { body: {} }),
  markAllNotificationsRead: () => request<Record<string, unknown>>('seller/notifications/read-all', { body: {} }),
  rxRequests: () => request<{ items?: RxRequest[] | null }>('seller/rx-requests', { query: { status: 'open' } }),
  rxRequestDetail: (requestId: number) => request<RxRequest>('seller/rx-requests/detail', { query: { request_id: requestId } }),
  rxRequestFillToCart: (body: unknown) => request<Record<string, unknown>>('seller/rx-requests/fill-to-cart', { body }),
  rxRequestReject: (body: unknown) => request<Record<string, unknown>>('seller/rx-requests/reject', { body }),
  rxRequestSendMessage: (body: unknown) => request<Record<string, unknown>>('seller/rx-requests/send-message', { body }),
  prescriptionFillToCart: (body: unknown) => request<Record<string, unknown>>('seller/orders/prescription-fill-to-cart', { body }),
  prescriptionSendMessage: (body: unknown) => request<Record<string, unknown>>('seller/orders/prescription-send-message', { body }),
  forwardPharmacies: (pincode?: string) => request<{ items?: ForwardPharmacy[] | null }>('seller/pharmacies/forward', { query: { pincode } }),
  platformIntegrations: () => request<{ items?: Array<{ name?: string; status?: string; label?: string }> | null }>('platform/integrations'),
  wholesellers: () => request<{ items?: WholesellerPharmacy[] | null }>('seller/pharmacies/wholesellers'),
  wholesaleLowStock: () => request<{ items?: InventoryItem[] | null }>('seller/wholesale/low-stock'),
  wholesaleCatalog: (id: number) => request<{ items?: InventoryItem[] | null }>('seller/wholesale/catalog', { query: { wholeseller_pharmacy_id: id } }),
  wholesaleOrders: (mode: 'buyer' | 'wholeseller') => request<{ items?: WholesaleOrder[] | null }>('seller/wholesale/orders', { query: { mode } }),
  wholesaleOrderDetail: (orderId: number) => request<WholesaleOrder>('seller/wholesale/orders/detail', { query: { order_id: orderId } }),
  wholesaleOrderInvoice: (orderId: number) => request<WholesaleOrder>('seller/wholesale/orders/invoice', { query: { order_id: orderId } }),
  wholesaleTransactions: () => request<{ items?: unknown[] | null }>('seller/wholesale/transactions'),
  createWholesaleOrder: (body: unknown) => request<WholesaleOrder>('seller/wholesale/orders/create', { body }),
  wholesaleAction: (orderId: number, action: string, extra?: Record<string, unknown>) => request<WholesaleOrder>('seller/wholesale/orders/action', { body: { order_id: orderId, action, ...(extra ?? {}) } }),
  attachInventory: (body: unknown) => request<Record<string, unknown>>('seller/inventory/attach', { body }),
  productCategories: () => request<{ items?: ProductCategory[] | null }>('seller/products/categories'),
  submitProduct: (body: unknown) => request<Record<string, unknown>>('seller/products/submit', { body }),
  bulkSubmitProducts: (rows: unknown[]) => request<Record<string, unknown>>('seller/products/bulk-submit', { body: { rows } }),
  stockManagement: (view = 'all', search = '') => request<StockManagementData>('seller/stock-management', { query: { page: 1, limit: 50, view, search } }),
  stockSuggestions: () => request<{ items?: StockSuggestion[] | null; summary?: Record<string, number> | null }>('seller/stock-management/suggestions'),
  addStock: (body: unknown) => request<Record<string, unknown>>('seller/stock-management/add', { body }),
  adjustStock: (body: unknown) => request<Record<string, unknown>>('seller/stock-management/adjust', { body }),
  importStock: (rows: Array<{ product_id: number; add_stock: number; reason?: string }>) => request<Record<string, unknown>>('seller/stock-management/import', { body: { rows } }),
  stockReport: (from: string, to: string) => request<{ items?: Array<{ product_name?: string; sold_in_range?: number; remaining_now?: number }> | null; summary?: { products?: number; sold_in_range?: number; remaining_now?: number } | null }>('seller/stock-management/report', { query: { from, to } }),
  stockHistory: () => request<{ items?: StockHistoryItem[] | null }>('seller/stock-management/history', { query: { page: 1, limit: 50 } }),
  virtualShop: () => request<VirtualShopData>('seller/virtual-shop'),
  saveVirtualShop: (body: unknown) => request<VirtualShopData>('seller/virtual-shop', { body }),
  discountRules: () => request<{ items?: DiscountRule[] | null }>('seller/discount-rules'),
  saveDiscountRule: (body: unknown) => request<Record<string, unknown>>('seller/discount-rules/save', { body }),
  deleteDiscountRule: (id: number) => request<Record<string, unknown>>(`seller/discount-rules/delete/${id}`, { body: {} }),
  referral: () => request<ReferralData>('seller/referral'),
  subscription: () => request<SubscriptionInfo>('seller/subscription'),
  subscriptionPlans: () => request<{ items?: SellerPlan[] | null }>('seller/subscription/plans'),
  subscriptionPreview: (planId: number) => request<SubscriptionPreview>('seller/subscription/preview', { query: { plan_id: planId, use_wallet: 1 } }),
  subscribePlan: (planId: number) => request<SubscriptionInfo>('seller/subscription/subscribe', { body: { plan_id: planId, payment_method: 'demo', demo_card: '4242 4242 4242 4242', simulate: 'success', use_wallet: 1 } }),
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
    const timer = setTimeout(() => setSplashDone(true), 2600);
    prepareOrderBell().catch(() => undefined);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    readSession().then(async (s) => {
      if (s.accessToken) {
        try { await authApi.me(); setLoggedIn(true); }
        catch { setLoggedIn(Boolean(s.accessToken)); }
      } else {
        setLoggedIn(false);
      }
      setBooting(false);
    });
  }, []);

  if (!splashDone) return <Splash />;
  if (booting) return <CenteredLoader />;
  if (!loggedIn) return <AuthScreen onDone={() => setLoggedIn(true)} />;
  return <SellerShell onLogout={async () => { await stopOrderBell(); await stopOrderWatch(); await authApi.logout(); setLoggedIn(false); }} />;
}

function Splash() {
  const pulse = useRef(new Animated.Value(0.92)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.94, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ])).start();
  }, [pulse]);
  return (
    <View style={s.splash}>
      <View style={s.splashGlow} />
      <Animated.View style={[s.splashMark, { transform: [{ scale: pulse }] }]}>
        <Image source={APP_ICON} style={s.splashAppIcon} resizeMode="cover" />
      </Animated.View>
      <Text style={s.splashTitle}>ZepMed Seller</Text>
      <Text style={s.splashSub}>Fastest medicine delivery partner</Text>
      <View style={s.dots}><View style={s.dot} /><View style={s.dot} /><View style={s.dot} /></View>
    </View>
  );
}

function CenteredLoader({ compact = false }: { compact?: boolean }) {
  return <View style={compact ? s.centerCompact : s.center}><ActivityIndicator color={C.teal} /></View>;
}

function AuthScreen({ onDone }: { onDone: () => void }) {
  const [tab, setTab] = useState<AuthTab>('otp');
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
    <ScrollView style={s.authScreen} contentContainerStyle={s.authWrap} keyboardShouldPersistTaps="handled">
      <View style={s.loginBrand}>
        <Image source={LOGO} style={s.authLogo} resizeMode="contain" />
      </View>
      <Text style={s.loginTitle}>Welcome to ZepMed</Text>
      <Text style={s.loginSub}>Your premium healthcare & medicine companion</Text>

      {tab === 'otp' ? (
        <>
          <Text style={s.loginLabel}>ENTER MOBILE NUMBER</Text>
          <View style={s.phoneInputRow}>
            <Text style={s.countryCode}>+91</Text>
            <View style={s.phoneDivider} />
            <TextInput
              value={mobile}
              onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))}
              keyboardType="phone-pad"
              placeholder="98765 43210"
              placeholderTextColor="#A6ADBB"
              style={s.phoneInput}
            />
          </View>
          <TouchableOpacity style={[s.otpButton, loading && { opacity: 0.6 }]} disabled={loading} onPress={() => run(() => authApi.sendLoginOtp(mobile), 'OTP sent. Check WhatsApp.')}>
            <Text style={s.otpButtonText}>{loading ? 'Sending...' : 'Send OTP'}</Text>
          </TouchableOpacity>
          {notice.includes('OTP sent') || otp ? <Field label="OTP" value={otp} onChangeText={setOtp} keyboardType="number-pad" /> : null}
          {notice.includes('OTP sent') || otp ? <Primary label={loading ? 'Verifying...' : 'Verify OTP'} disabled={loading} onPress={() => run(() => authApi.loginOtp(mobile, otp))} /> : null}
          <View style={s.orRow}><View style={s.orLine} /><Text style={s.orText}>OR</Text><View style={s.orLine} /></View>
          <TouchableOpacity style={s.whatsappButton} disabled={loading} onPress={() => run(() => authApi.sendLoginOtp(mobile), 'OTP sent on WhatsApp.')}>
            <Text style={s.whatsappText}>▱  Login via WhatsApp</Text>
          </TouchableOpacity>
          <View style={s.authLinks}>
            <TouchableOpacity onPress={() => { setTab('password'); setError(''); }}><Text style={s.authLinkText}>Password login</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => { setTab('register'); setError(''); }}><Text style={s.authLinkText}>Register seller</Text></TouchableOpacity>
          </View>
        </>
      ) : null}
      {tab === 'password' ? (
        <>
          <Field label="Mobile" value={mobile} onChangeText={setMobile} keyboardType="phone-pad" />
          <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry />
          <Primary label={loading ? 'Signing in...' : 'Sign In'} disabled={loading} onPress={() => run(() => authApi.loginPassword(mobile, password))} />
          <Secondary label="Back to OTP login" disabled={loading} onPress={() => setTab('otp')} />
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
          <Secondary label="Back to OTP login" disabled={loading} onPress={() => setTab('otp')} />
        </>
      ) : null}
      {error ? <Notice tone="error" title={error} /> : notice.includes('OTP sent') ? <Notice tone="success" title={notice} /> : null}
      <Text style={s.termsText}>By continuing, you agree to our <Text style={s.termsLink} onPress={() => Linking.openURL('https://zepmed.org/terms')}>Terms of Service</Text> and <Text style={s.termsLink} onPress={() => Linking.openURL('https://zepmed.org/privacy')}>Privacy Policy</Text></Text>
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
  const [moreModule, setMoreModule] = useState<MoreModule>(null);
  const [fresh, setFresh] = useState<Order | null>(null);
  const knownOrders = useRef<Set<number>>(new Set());
  const refreshInFlight = useRef(false);
  const refreshQueued = useRef(false);
  const tabHistory = useRef<TabKey[]>([]);

  const goTab = useCallback((next: TabKey, filter?: OrderFilter) => {
    if (filter) setOrderFilter(filter);
    setTab((current) => {
      if (current !== next) tabHistory.current.push(current);
      return next;
    });
  }, []);

  const refresh = useCallback(async (silent = false, force = false) => {
    if (refreshInFlight.current) {
      if (force) refreshQueued.current = true;
      return;
    }
    refreshInFlight.current = true;
    if (!silent) setRefreshing(true);
    setError('');
    let nextError = '';
    try {
      try {
        const d = await sellerApi.dashboard();
        setDash(d.data ?? null);
      } catch (err) {
        if (!silent || !isAbortError(err)) nextError = errorMessage(err);
      }

      let next: Order[] = [];
      try {
        const o = await sellerApi.orders();
        next = (o.data?.items ?? []).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? '') || b.id - a.id);
      } catch (err) {
        if (!silent || !isAbortError(err)) nextError = nextError || errorMessage(err);
      }

      const firstFresh = next.find((order) => !knownOrders.current.has(order.id) && orderCanShowNewPopup(order));
      if (knownOrders.current.size && firstFresh) {
        setFresh(firstFresh);
        Vibration.vibrate([0, 300, 120, 300]);
        goTab('orders', 'pending');
      }
      knownOrders.current = new Set(next.map((order) => order.id));
      setOrders(next);
      await syncPendingOrderNotifications(next);

      try {
        const inv = await sellerApi.inventory();
        setInventory(inv.data?.items ?? []);
      } catch (err) {
        if (!isAbortError(err) && !inventory.length) nextError = nextError || errorMessage(err);
      }
      if (nextError) setError(nextError);
    } catch (err) {
      if (!silent || !isAbortError(err)) setError(errorMessage(err));
    } finally {
      setRefreshing(false);
      refreshInFlight.current = false;
      if (refreshQueued.current) {
        refreshQueued.current = false;
        refresh(true, true);
      }
    }
  }, [goTab, inventory.length, tab]);

  useEffect(() => {
    refresh(true);
    const timer = setInterval(() => refresh(true), 15000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    readSession().then(async (session) => {
      const prefs = await readPrefs();
      startOrderWatch(session.accessToken, session.refreshToken, prefs.sound);
    }).catch(() => undefined);
    registerOrderBackgroundTask().catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const orderId = Number(response.notification.request.content.data?.orderId || 0);
      const actionId = response.actionIdentifier;
      if (orderId && actionId === 'accept') {
        const order = orders.find((item) => item.id === orderId);
        const code = order && isPrescription(order) ? 'rx_accept' : 'confirmed';
        action(orderId, code).catch(() => openOrder(orderId));
      } else if (orderId) {
        openOrder(orderId);
      }
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh(true);
        return;
      }
      stopOrderBell();
      syncPendingOrderNotifications(orders, { forcePresent: true }).catch(() => undefined);
    });
    return () => {
      sub.remove();
      appSub.remove();
    };
  }, [orders, refresh]);

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
      if (moreModule) {
        setMoreModule(null);
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
  }, [moreModule, refresh, selectedOrder, showReport, tab]);

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
      setFresh((current) => current?.id === orderId ? null : current);
      setOrders((current) => current.map((order) => (
        order.id === orderId
          ? { ...order, status: code === 'rx_accept' ? 'confirmed' : code, seller_confirmed_at: new Date().toISOString() }
          : order
      )));
      await refresh(true, true);
    } catch (err) {
      Alert.alert('Action failed', errorMessage(err));
    }
  }

  async function toggleStoreOpen(nextOpen: boolean) {
    const previous = dash?.is_open;
    setDash((currentDash) => currentDash ? { ...currentDash, is_open: nextOpen } : currentDash);
    try {
      await sellerApi.saveSettings({ is_open: nextOpen ? 1 : 0 });
      await refresh(true);
    } catch (err) {
      setDash((currentDash) => currentDash ? { ...currentDash, is_open: previous } : currentDash);
      Alert.alert('Store status', errorMessage(err));
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
  if (showReport) return <ReportsScreen onBack={() => setShowReport(false)} />;
  if (moreModule) return <MoreModuleScreen module={moreModule} dash={dash} onBack={() => { setMoreModule(null); refresh(true); }} onRefresh={() => refresh(true)} />;

  return (
    <View style={s.screen}>
      <View style={{ paddingTop: insets.top, backgroundColor: '#FFF' }}>
        <Header
          title={tab === 'home' ? 'ZepMed Seller' : tab === 'stock' ? 'Stock Management' : tab[0].toUpperCase() + tab.slice(1)}
          subtitle={[dash?.pharmacy?.name, dash?.pharmacy?.city].filter(Boolean).join(' • ') || 'Pharmacy'}
          onRefresh={() => refresh()}
        />
      </View>
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh()} tintColor={C.teal} />} contentContainerStyle={s.body}>
        {fresh && tab === 'orders' ? <FreshBanner order={fresh} onClose={() => setFresh(null)} onOpen={() => openOrder(fresh.id)} /> : null}
        {error ? <Notice tone="error" title={error} /> : null}
        {tab === 'home' ? <HomeScreen dash={dash} orders={orders} onOpenOrder={openOrder} onAction={action} onDashboardTarget={openDashboardTarget} onStoreToggle={toggleStoreOpen} /> : null}
        {tab === 'orders' ? <OrdersScreen orders={orders} filter={orderFilter} onFilter={setOrderFilter} onOpenOrder={openOrder} onAction={action} /> : null}
        {tab === 'catalog' ? <CatalogScreen items={inventory} onEdit={setEditItem} onStock={() => goTab('stock')} onAddProducts={() => setMoreModule('products')} /> : null}
        {tab === 'stock' ? <StockManagementScreen /> : null}
        {tab === 'more' ? <MoreScreen dash={dash} onReport={() => setShowReport(true)} onOpenModule={setMoreModule} onRefresh={() => refresh()} onLogout={onLogout} /> : null}
      </ScrollView>
      <BottomTabs current={tab} setTab={goTab} pending={orders.filter((o) => pendingStatus(o.status)).length} />
      <StockEditModal item={editItem} onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); refresh(true); }} />
      <NewOrderPopup order={fresh} onClose={() => setFresh(null)} onOpen={() => { const order = fresh; setFresh(null); if (order) openOrder(order.id); }} />
    </View>
  );
}

function Header({ title, subtitle, onRefresh, onLogout }: { title: string; subtitle: string; onRefresh: () => void; onLogout?: () => void }) {
  return (
    <View style={s.header}>
      <Image source={APP_ICON} style={s.headerLogo} resizeMode="cover" />
      <View style={{ flex: 1 }}>
        <Text style={s.headerTitle} numberOfLines={1}>{title}</Text>
        <Text style={s.headerSub} numberOfLines={1}>{subtitle}</Text>
      </View>
      <IconButton label="↻" onPress={onRefresh} />
      {onLogout ? <IconButton label="‹" onPress={onLogout} /> : null}
    </View>
  );
}

function HomeScreen({
  dash,
  orders,
  onOpenOrder,
  onAction,
  onDashboardTarget,
  onStoreToggle,
}: {
  dash: DashboardData | null;
  orders: Order[];
  onOpenOrder: (id: number) => void;
  onAction: (id: number, code: string) => void;
  onDashboardTarget: (target: DashboardTarget) => void;
  onStoreToggle: (nextOpen: boolean) => void;
}) {
  if (!dash) return <CenteredLoader />;
  const open = dash.is_open !== false && dash.is_open !== 0;
  return (
    <>
      <View style={s.dashboardCard}>
        <View style={s.rowBetween}>
          <View>
            <Text style={s.bigTitle}>{dash.pharmacy?.name || 'Your pharmacy'}</Text>
            <Text style={s.muted}>{dash.pharmacy?.city || 'Open for orders'} • Open for orders</Text>
          </View>
          <Pill text={open ? 'Open' : 'Closed'} tone={open ? 'green' : 'red'} />
        </View>
        <TouchableOpacity style={[s.storeToggle, open ? s.storeToggleOpen : s.storeToggleClosed]} onPress={() => onStoreToggle(!open)}>
          <View>
            <Text style={[s.storeToggleTitle, { color: open ? C.green : C.red }]}>{open ? 'Store is open' : 'Store is closed'}</Text>
            <Text style={[s.storeToggleBody, { color: open ? C.green : C.red }]}>{open ? 'Tap to stop receiving new customer orders' : 'Tap to start receiving new customer orders'}</Text>
          </View>
          <Text style={[s.storeToggleAction, { color: open ? C.green : C.red }]}>{open ? 'Close' : 'Open'}</Text>
        </TouchableOpacity>
        <View style={s.summaryGrid}>
          <SummaryTile label="Total Orders" value={String(dash.orders_total ?? 0)} onPress={() => onDashboardTarget('orders')} />
          <SummaryTile label="Revenue" value={shortMoney(dash.revenue_total)} onPress={() => onDashboardTarget('revenue')} />
          <SummaryTile label="Pending" value={String(dash.pending_dispatch ?? 0)} onPress={() => onDashboardTarget('pending')} />
          <SummaryTile label="Delivered" value={String(dash.delivered_count ?? 0)} onPress={() => onDashboardTarget('delivered')} />
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
      {dash.drug_license?.message ? (
        <View style={[s.infoCard, { backgroundColor: dash.drug_license.restricted ? C.redSoft : C.yellowSoft }]}>
          <Text style={[s.infoTitle, { color: dash.drug_license.restricted ? C.red : C.yellow }]}>Drug license {dash.drug_license.status || ''}</Text>
          <Text style={[s.infoText, { color: dash.drug_license.restricted ? C.red : C.yellow }]}>{dash.drug_license.message}{dash.drug_license.expiry_date ? ` • Expires ${dash.drug_license.expiry_date}` : ''}</Text>
        </View>
      ) : null}
      <View style={s.statRow}>
        <StatCard label="Wallet" value={shortMoney(dash.pharmacy_wallet_balance)} warm />
        <StatCard label="Owner" value={dash.owner_name || dash.pharmacy?.name || '-'} />
      </View>
      <HomeReferralCard />
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

function CatalogScreen({ items, onEdit, onStock, onAddProducts }: { items: InventoryItem[]; onEdit: (item: InventoryItem) => void; onStock: () => void; onAddProducts: () => void }) {
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
      <View style={s.inputRow}>
        <TouchableOpacity style={[s.smallChip, lowOnly && { backgroundColor: C.ink }]} onPress={() => setLowOnly(!lowOnly)}>
          <Text style={[s.smallChipText, lowOnly && { color: '#FFF' }]}>Low stock only</Text>
        </TouchableOpacity>
        <TouchableOpacity style={s.smallChip} onPress={onAddProducts}>
          <Text style={s.smallChipText}>Add products</Text>
        </TouchableOpacity>
      </View>
      {lowCount ? <TouchableOpacity style={s.purchaseCta} onPress={onStock}><Text style={s.purchaseText}>Open Stock Management</Text><Text style={s.purchaseArrow}>→</Text></TouchableOpacity> : null}
      {filtered.map((item) => <ProductRow key={item.id} item={item} onPress={() => onEdit(item)} />)}
      {!filtered.length ? <Empty title="Catalog empty" body="Attach a catalog item or submit a new product for approval." /> : null}
    </>
  );
}

function MoreScreen({ dash, onReport, onOpenModule, onRefresh, onLogout }: { dash: DashboardData | null; onReport: () => void; onOpenModule: (module: MoreModule) => void; onRefresh: () => void; onLogout: () => void }) {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    sellerApi.notificationUnreadCount().then((r) => setUnread(Number(r.data?.unread_count ?? 0))).catch(() => setUnread(0));
  }, []);
  return (
    <>
      <SectionTitle title="Pharmacy profile" />
      <View style={s.card}>
        <Info label="Store" value={dash?.pharmacy?.name || '-'} />
        <Info label="Location" value={[dash?.pharmacy?.address, dash?.pharmacy?.city, dash?.pharmacy?.pincode].filter(Boolean).join(', ') || '-'} />
        <Info label="Phone" value={dash?.pharmacy?.phone || 'Not set'} />
      </View>
      <SectionTitle title="Operations" />
      <View style={s.moreGrid}>
        {[
          ['pharmacy', '🏥', 'Pharmacy', 'DL · GST · bill header'],
          ['settings', '⚙️', 'Settings', 'Hours · delivery · alerts'],
          ['printer', '🖨️', 'Printer', 'Thermal 58 · half A4'],
          ['notifications', '🔔', 'Alerts', unread ? `${unread} unread` : 'Inbox'],
          ['rx', '💊', 'Rx desk', 'Fill cart · message'],
          ['stock', '📦', 'Stock', 'Add · history · sold'],
          ['virtual', '🛍️', 'Virtual shop', 'Listing · discounts'],
          ['wholesale', '🏪', 'Wholesale', hasFeature(dash, 'wholesale') || dash?.is_wholeseller ? 'B2B buy & fulfill' : 'Growth plan'],
          ['products', '➕', 'Products', 'Attach · submit'],
          ['payouts', '💳', 'Payouts', 'Wallet audit'],
          ['referral', '🎁', 'Referral', 'Share & bonus'],
          ['subscription', '⭐', 'Plans', 'Preview · subscribe'],
        ].map(([key, icon, title, body]) => (
          <TouchableOpacity key={key} style={s.moreTile} onPress={() => onOpenModule(key as MoreModule)}>
            <Text style={s.moreTileIcon}>{icon}</Text>
            <Text style={s.moreTileTitle}>{title}</Text>
            <Text style={s.moreTileBody}>{body}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <MenuItem title="Reports & Audit" body="Item sales, order sales, Rx, virtual shop and wallet" onPress={onReport} />
      <MenuItem title="Sync data" body="Refresh dashboard, orders and catalog" onPress={onRefresh} />
      <SubscriptionSection dash={dash} />
      <MenuItem title="Logout" body="Sign out from this seller device" onPress={onLogout} />
      <MenuItem title="App Support" body="Use this when backend or order sync needs checking" onPress={() => Alert.alert('Support', 'Contact ZepMed support with your pharmacy name and mobile number.')} />
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
      <WholesaleExtras dash={dash} canWholesale={canWholesale} onRefresh={() => { onRefresh(); load(); }} />
      {canWholesale ? <SectionTitle title="Nearby Wholesellers" /> : null}
      {wholesellers.map((w) => <MenuItem key={w.id} title={w.name} body={`${w.city || '-'} • ${w.pincode || '-'} • ${w.catalog_count ?? 0} products`} badge={w.distance_label || (w.pincode_match ? 'Same pincode' : w.city_match ? 'Same city' : undefined)} onPress={() => openCatalog(w)} />)}
      {!loading && canWholesale && !wholesellers.length ? <Empty title="No wholesalers" body="No nearby wholesellers are available, or the server did not return this list." /> : null}
      {canWholesale ? <SectionTitle title="My Purchase Orders" /> : null}
      {myOrders.slice(0, 10).map((o) => <WholesaleOrderCard key={o.id} order={o} mode="buyer" onChanged={load} />)}
      {!loading && canWholesale && !myOrders.length ? <Text style={s.muted}>No B2B purchase orders yet.</Text> : null}
      {dash?.is_wholeseller ? <SectionTitle title="Incoming Orders" /> : null}
      {incoming.slice(0, 10).map((o) => <WholesaleOrderCard key={o.id} order={o} mode="wholeseller" onChanged={load} />)}
      {!loading && dash?.is_wholeseller && !incoming.length ? <Text style={s.muted}>No incoming wholesale orders yet.</Text> : null}
    </>
  );
}

function MoreModuleScreen({ module, dash, onBack, onRefresh }: { module: MoreModule; dash: DashboardData | null; onBack: () => void; onRefresh: () => void }) {
  const insets = useSafeAreaInsets();
  const title = module === 'pharmacy' ? 'Pharmacy Info'
    : module === 'settings' ? 'Store Settings'
      : module === 'notifications' ? 'Notifications'
        : module === 'rx' ? 'Prescription Rx'
          : module === 'stock' ? 'Stock Management'
            : module === 'virtual' ? 'Virtual Shop'
              : module === 'wholesale' ? 'Wholesale'
                : module === 'referral' ? 'Referral'
                  : module === 'products' ? 'Add Products'
                    : module === 'subscription' ? 'Subscription'
                      : module === 'printer' ? 'Printer Settings'
                        : 'Payouts & Wallet';
  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={onBack}><Text style={s.backText}>‹ Back</Text></TouchableOpacity>
        <View style={{ flex: 1 }}><Text style={s.headerTitle}>{title}</Text><Text style={s.headerSub}>{dash?.pharmacy?.name || 'Seller module'}</Text></View>
      </View>
      <ScrollView contentContainerStyle={s.body}>
        {module === 'pharmacy' ? <PharmacyInfoScreen /> : null}
        {module === 'settings' ? <StoreSettingsScreen /> : null}
        {module === 'notifications' ? <NotificationsScreen /> : null}
        {module === 'rx' ? <RxRequestsScreen /> : null}
        {module === 'stock' ? <StockManagementScreen /> : null}
        {module === 'virtual' ? <VirtualShopScreen /> : null}
        {module === 'payouts' ? <PayoutsScreen /> : null}
        {module === 'wholesale' ? <WholesaleScreen dash={dash} canWholesale={hasFeature(dash, 'wholesale')} onRefresh={onRefresh} /> : null}
        {module === 'referral' ? <ReferralScreen /> : null}
        {module === 'products' ? <ProductsScreen /> : null}
        {module === 'subscription' ? <SubscriptionSection dash={dash} /> : null}
        {module === 'printer' ? <PrinterSettingsScreen dash={dash} /> : null}
      </ScrollView>
    </View>
  );
}

function PharmacyInfoScreen() {
  const [form, setForm] = useState({ name: '', address: '', city: '', pincode: '', phone: '', dl_number: '', gstin: '', delivery_fee: '', min_order: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await sellerApi.pharmacyInfo();
      const p = unwrapPharmacy(res.data);
      const billing = res.data && 'billing' in (res.data ?? {}) ? res.data.billing : {};
      setForm({
        name: p.name || '',
        address: p.address || '',
        city: p.city || '',
        pincode: p.pincode || '',
        phone: p.phone || '',
        dl_number: billing?.dl_number || '',
        gstin: billing?.gstin || '',
        delivery_fee: String(p.delivery_fee ?? ''),
        min_order: String(p.min_order ?? ''),
      });
    } catch (err) { setError(errorMessage(err)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    setSaving(true);
    try {
      await sellerApi.savePharmacyInfo({
        address: form.address,
        city: form.city,
        pincode: form.pincode,
        phone: form.phone,
        dl_number: form.dl_number,
        gstin: form.gstin,
      });
      Alert.alert('Pharmacy', 'Bill details saved');
    } catch (err) { Alert.alert('Pharmacy', errorMessage(err)); }
    finally { setSaving(false); }
  }
  if (loading) return <CenteredLoader compact />;
  return <FormCard error={error} onRetry={load}>
    <Field label="Store name" value={form.name} editable={false} />
    <Text style={s.muted}>Contact admin to change the store name.</Text>
    <Field label="Address" value={form.address} onChangeText={(v) => setForm({ ...form, address: v })} multiline />
    <View style={s.inputRow}><Field label="City" value={form.city} onChangeText={(v) => setForm({ ...form, city: v })} compact /><Field label="Pincode" value={form.pincode} onChangeText={(v) => setForm({ ...form, pincode: v.replace(/\D/g, '').slice(0, 6) })} compact /></View>
    <Field label="Bill mobile" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v.replace(/\D/g, '').slice(0, 10) })} />
    <Field label="Drug license no." value={form.dl_number} onChangeText={(v) => setForm({ ...form, dl_number: v })} />
    <Field label="GSTIN" value={form.gstin} onChangeText={(v) => setForm({ ...form, gstin: v.toUpperCase() })} />
    <Text style={s.muted}>Delivery ₹{form.delivery_fee || 0} · Min order ₹{form.min_order || 0}. Change delivery in Store Settings.</Text>
    <Primary label={saving ? 'Saving...' : 'Save bill details'} onPress={save} disabled={saving} />
  </FormCard>;
}

function StoreSettingsScreen() {
  const [settings, setSettings] = useState<SellerSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const res = await sellerApi.settings(); setSettings(res.data ?? {}); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  function update(next: Partial<SellerSettings>) { setSettings((s0) => ({ ...(s0 ?? {}), ...next })); }
  function updateStore(next: Record<string, unknown>) { setSettings((s0) => ({ ...(s0 ?? {}), settings: { ...(s0?.settings ?? {}), store: { ...(s0?.settings?.store ?? {}), ...next } } })); }
  function updateNotif(next: Record<string, boolean>) { setSettings((s0) => ({ ...(s0 ?? {}), settings: { ...(s0?.settings ?? {}), notifications: { ...(s0?.settings?.notifications ?? {}), ...next } } })); }
  function updateDelivery(next: Record<string, unknown>) { setSettings((s0) => ({ ...(s0 ?? {}), settings: { ...(s0?.settings ?? {}), delivery: { ...(s0?.settings?.delivery ?? {}), ...next } } })); }
  function updateAdvanced(next: Record<string, unknown>) { setSettings((s0) => ({ ...(s0 ?? {}), settings: { ...(s0?.settings ?? {}), advanced: { ...(s0?.settings?.advanced ?? {}), ...next } } })); }
  async function save() {
    const payload = {
      ...(settings?.settings ?? {}),
      is_open: settings?.is_open ? 1 : 0,
    };
    setSaving(true);
    try { await sellerApi.saveSettings(payload); Alert.alert('Settings', 'Store settings saved'); await load(); }
    catch (err) { Alert.alert('Settings', errorMessage(err)); }
    finally { setSaving(false); }
  }
  if (loading) return <CenteredLoader compact />;
  const store = settings?.settings?.store ?? {};
  const n = settings?.settings?.notifications ?? {};
  const d = settings?.settings?.delivery ?? {};
  const a = settings?.settings?.advanced ?? {};
  const auto = Boolean(store.auto_mode);
  return <FormCard error={error} onRetry={load}>
    <ToggleRow title="Open for customer orders" body="When off, customers cannot place new orders at this pharmacy." value={Boolean(settings?.is_open)} onValueChange={(v) => update({ is_open: v })} />
    <ToggleRow title="Auto open / close" body="Use schedule instead of manual open state." value={auto} onValueChange={(v) => updateStore({ auto_mode: v })} />
    <View style={s.inputRow}><Field label="Open from" value={store.open_time || '09:00'} onChangeText={(v) => updateStore({ open_time: v })} compact /><Field label="Close at" value={store.close_time || '21:00'} onChangeText={(v) => updateStore({ close_time: v })} compact /></View>
    <SectionTitle title="Delivery" />
    <View style={s.inputRow}><Field label="Delivery fee" value={String(d.delivery_fee ?? '')} onChangeText={(v) => updateDelivery({ delivery_fee: Number(v || 0) })} keyboardType="decimal-pad" compact /><Field label="Min order" value={String(d.min_order ?? '')} onChangeText={(v) => updateDelivery({ min_order: Number(v || 0) })} keyboardType="decimal-pad" compact /></View>
    <View style={s.inputRow}><Field label="Free above" value={String(d.free_delivery_above ?? '')} onChangeText={(v) => updateDelivery({ free_delivery_above: Number(v || 0) })} keyboardType="decimal-pad" compact /><Field label="Per km rate" value={String(d.per_km_rate ?? '')} onChangeText={(v) => updateDelivery({ per_km_rate: Number(v || 0) })} keyboardType="decimal-pad" compact /></View>
    <SectionTitle title="Alerts" />
    <ToggleRow title="Order sound alert" body="Ring for new orders until accepted." value={n.order_sound !== false} onValueChange={(v) => updateNotif({ order_sound: v })} />
    <ToggleRow title="Vibrate" body="Use vibration for order alerts where supported." value={n.order_vibrate !== false} onValueChange={(v) => updateNotif({ order_vibrate: v })} />
    <ToggleRow title="Popup banner" body="Show in-app new order popup." value={n.desktop_alert !== false} onValueChange={(v) => updateNotif({ desktop_alert: v })} />
    <ToggleRow title="Low stock alert" body="Highlight products that need restock." value={a.low_stock_alert !== false} onValueChange={(v) => updateAdvanced({ low_stock_alert: v })} />
    <SettingsPanel />
    <IntegrationsCard />
    <Primary label={saving ? 'Saving...' : 'Save Settings'} onPress={save} disabled={saving} />
  </FormCard>;
}

function PrinterSettingsScreen({ dash }: { dash: DashboardData | null }) {
  const [settings, setSettings] = useState<SellerSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [printers, setPrinters] = useState<PairedPrinter[]>([]);
  const [selectedMac, setSelectedMac] = useState('');
  const [selectedName, setSelectedName] = useState('');
  const load = useCallback(async () => {
    try {
      setSettings((await sellerApi.settings()).data ?? {});
      const prefs = await readPrefs();
      setSelectedMac(prefs.printerMac || '');
      setSelectedName(prefs.printerName || '');
      try { setPrinters(await listPairedPrinters()); } catch { setPrinters([]); }
    } catch (err) { Alert.alert('Printer', errorMessage(err)); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const p = settings?.settings?.printer ?? {};
  function updatePrinter(next: Record<string, unknown>) {
    setSettings((s0) => ({ ...(s0 ?? {}), settings: { ...(s0?.settings ?? {}), printer: { ...(s0?.settings?.printer ?? {}), ...next } } }));
  }
  async function save() {
    setSaving(true);
    try {
      await sellerApi.saveSettings({ ...(settings?.settings ?? {}), is_open: settings?.is_open ? 1 : 0 });
      await writeSellerPrefs({
        autoPrint: Boolean(p.auto_print_on_ready),
        printerMac: selectedMac || null,
        printerName: selectedName || null,
        printerLanguage: String(p.language || 'tspl'),
        printerPaper: String(p.paper || 'continuous'),
      });
      Alert.alert('Printer', selectedMac ? `Saved ${selectedName || selectedMac}` : 'Settings saved. Select a paired Bluetooth printer to print bills.');
    } catch (err) { Alert.alert('Printer', errorMessage(err)); }
    finally { setSaving(false); }
  }
  async function preview() {
    try {
      await printBill({
        order_number: 'SAMPLE-001',
        created_at: new Date().toISOString(),
        customer_name: 'Sample Customer',
        customer_phone: '9876543210',
        payment_method: 'COD',
        total_amount: 248,
        items: [{ product_name: 'Paracetamol 500', quantity: 2, price: 24 }, { product_name: 'Cough syrup', quantity: 1, price: 200 }],
      }, (p.type === 'a4_half' ? 'a4_half' : 'thermal_58') as PrinterLayout, dash?.pharmacy, {
        language: String(p.language || 'tspl'),
        paper: String(p.paper || 'continuous'),
        mac: selectedMac || undefined,
      });
    } catch (err) {
      Alert.alert('Print', err instanceof Error ? err.message : errorMessage(err));
    }
  }
  return (
    <>
      <View style={s.heroCard}>
        <Text style={s.heroKicker}>Bill printing</Text>
        <Text style={s.bigTitle}>Same shop printer as the seller panel</Text>
        <Text style={s.muted}>Pair the printer in Android Bluetooth settings, select it here, then print. Thermal bills go over Bluetooth with no extra blank paper after the tear.</Text>
      </View>
      <TouchableOpacity style={[s.choiceCard, (p.type || 'thermal_58') === 'thermal_58' && s.choiceCardOn]} onPress={() => updatePrinter({ type: 'thermal_58' })}>
        <Text style={s.itemTitle}>Thermal 58 mm</Text>
        <Text style={s.muted}>Milestone / POS-58 Bluetooth shop printer</Text>
      </TouchableOpacity>
      <TouchableOpacity style={[s.choiceCard, p.type === 'a4_half' && s.choiceCardOn]} onPress={() => updatePrinter({ type: 'a4_half' })}>
        <Text style={s.itemTitle}>Half A4 / desktop</Text>
        <Text style={s.muted}>Wider counter bill with full totals</Text>
      </TouchableOpacity>
      <SectionTitle title="Paired Bluetooth printer" />
      {printers.length ? printers.map((device) => (
        <TouchableOpacity key={device.address} style={[s.choiceCard, selectedMac === device.address && s.choiceCardOn]} onPress={() => { setSelectedMac(device.address); setSelectedName(device.name); }}>
          <Text style={s.itemTitle}>{device.name}</Text>
          <Text style={s.muted}>{device.address}</Text>
        </TouchableOpacity>
      )) : <Text style={s.muted}>No paired printers found. Pair the shop printer in Android Bluetooth settings, then tap Refresh list.</Text>}
      <Secondary label="Refresh printer list" onPress={() => listPairedPrinters().then(setPrinters).catch((err) => Alert.alert('Printer', errorMessage(err)))} />
      <Field label="Printer model" value={p.model || ''} onChangeText={(v) => updatePrinter({ model: v })} placeholder="Milestone 523-L58P" />
      <Field label="Language" value={p.language || 'tspl'} onChangeText={(v) => updatePrinter({ language: v })} placeholder="tspl / escpos" />
      <Field label="Paper" value={p.paper || 'continuous'} onChangeText={(v) => updatePrinter({ paper: v })} placeholder="continuous" />
      <Text style={s.muted}>Use continuous for a shop roll with no gap. Gap makes the printer hunt for a space and feed blank paper.</Text>
      <ToggleRow title="Auto-print on ready" body="Print the bill when you mark an order ready." value={p.auto_print_on_ready !== false} onValueChange={(v) => updatePrinter({ auto_print_on_ready: v ? 1 : 0 })} />
      <Primary label={saving ? 'Saving...' : 'Save printer settings'} onPress={save} disabled={saving} />
      <Secondary label="Print sample bill" onPress={preview} />
    </>
  );
}

function NotificationsScreen() {
  const [items, setItems] = useState<SellerNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const res = await sellerApi.notifications(unreadOnly); setItems(res.data?.items ?? []); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, [unreadOnly]);
  useEffect(() => { load(); }, [load]);
  async function markRead(id: number) { await sellerApi.markNotificationRead(id); load(); }
  async function markAll() { await sellerApi.markAllNotificationsRead(); load(); }
  return <>
    <View style={s.rowBetween}><TouchableOpacity style={[s.smallChip, unreadOnly && { backgroundColor: C.ink }]} onPress={() => setUnreadOnly(!unreadOnly)}><Text style={[s.smallChipText, unreadOnly && { color: '#FFF' }]}>Unread only</Text></TouchableOpacity><Secondary label="Read all" compact onPress={markAll} /></View>
    {loading ? <CenteredLoader compact /> : null}
    {error ? <Notice tone="error" title="Could not load notifications" body={error} /> : null}
    {items.map((n) => <TouchableOpacity key={n.id} style={s.card} onPress={() => markRead(n.id)}><View style={s.rowBetween}><Text style={s.itemTitle}>{n.title || n.category || 'Notification'}</Text>{n.is_read ? <Pill text="Read" /> : <Pill text="Unread" tone="orange" />}</View><Text style={s.muted}>{n.message || n.body || '-'}</Text><Text style={s.footer}>{prettyDate(n.created_at)}</Text></TouchableOpacity>)}
    {!loading && !items.length ? <Empty title="No notifications" body="Admin approvals and platform alerts will appear here." /> : null}
  </>;
}

function RxRequestsScreen() {
  const [items, setItems] = useState<RxRequest[]>([]);
  const [selected, setSelected] = useState<RxRequest | null>(null);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CatalogSuggestion[]>([]);
  const [cart, setCart] = useState<Array<{ product_id: number; name: string; quantity: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const res = await sellerApi.rxRequests(); setItems(res.data?.items ?? []); }
    catch (err) { setError(errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function searchCatalog(q: string) {
    setSearch(q);
    if (q.trim().length < 2) return setResults([]);
    try { const res = await sellerApi.catalogSearch(q); setResults(res.data?.items ?? []); } catch { setResults([]); }
  }
  async function fillToCart() {
    if (!selected || !cart.length) return Alert.alert('Rx', 'Search and add at least one catalog medicine.');
    try { await sellerApi.rxRequestFillToCart({ request_id: selected.id, items: cart.map((i) => ({ product_id: i.product_id, quantity: i.quantity })), seller_notes: note }); Alert.alert('Rx', 'Medicines sent to customer cart'); setSelected(null); setCart([]); load(); }
    catch (err) { Alert.alert('Rx', errorMessage(err)); }
  }
  async function reject() {
    if (!selected) return;
    try { await sellerApi.rxRequestReject({ request_id: selected.id, note }); Alert.alert('Rx', 'Request rejected'); setSelected(null); load(); }
    catch (err) { Alert.alert('Rx', errorMessage(err)); }
  }
  async function message() {
    if (!selected || !note.trim()) return Alert.alert('Rx', 'Enter a message first.');
    try { await sellerApi.rxRequestSendMessage({ request_id: selected.id, message: note }); Alert.alert('Rx', 'Message sent'); }
    catch (err) { Alert.alert('Rx', errorMessage(err)); }
  }
  if (selected) return <>
    <TouchableOpacity onPress={() => setSelected(null)}><Text style={s.backText}>‹ Requests</Text></TouchableOpacity>
    <View style={s.card}><Text style={s.itemTitle}>{selected.customer_name || 'Customer'} Rx</Text><Text style={s.muted}>{selected.status || '-'} • {prettyDate(selected.created_at)}</Text>{selected.prescription_url ? <Image source={{ uri: mediaUrl(selected.prescription_url) }} style={s.rxImage} resizeMode="contain" /> : null}</View>
    <Field label="Message / seller notes" value={note} onChangeText={setNote} multiline />
    <SearchBox placeholder="Search medicine from catalog" value={search} onChangeText={searchCatalog} />
    {results.slice(0, 6).map((p) => {
      const productId = Number(p.product_id ?? p.id ?? 0);
      return <MenuItem key={productId || p.name} title={p.name} body={`${money(p.price)} • ${p.seller_stock ?? 0} available`} onPress={() => { if (!productId) return; setCart((c) => c.some((x) => x.product_id === productId) ? c : [...c, { product_id: productId, name: p.name, quantity: 1 }]); setResults([]); setSearch(''); }} />;
    })}
    {cart.map((c) => <View key={c.product_id} style={s.card}><View style={s.rowBetween}><Text style={s.itemTitle}>{c.name}</Text><TextInput style={s.qtyInput} value={String(c.quantity)} keyboardType="number-pad" onChangeText={(v) => setCart((list) => list.map((x) => x.product_id === c.product_id ? { ...x, quantity: Math.max(1, Number(v.replace(/\D/g, '') || 1)) } : x))} /></View></View>)}
    <Primary label="Send Medicines To Customer Cart" onPress={fillToCart} />
    <View style={s.inputRow}><Secondary label="Send Message" onPress={message} compact /><Danger label="Reject Rx" onPress={reject} compact /></View>
  </>;
  return <>
    {loading ? <CenteredLoader compact /> : null}
    {error ? <Notice tone="error" title="Could not load Rx requests" body={error} /> : null}
    {items.map((rx) => <MenuItem key={rx.id} title={rx.customer_name || `Rx #${rx.id}`} body={`${rx.status || 'pending'} • ${prettyDate(rx.created_at)}`} badge={rx.status || undefined} onPress={async () => {
      setSelected(rx);
      setNote(rx.notes || '');
      try {
        const detail = await sellerApi.rxRequestDetail(rx.id);
        if (detail.data) {
          setSelected(detail.data);
          setNote(detail.data.notes || detail.data.message || '');
        }
      } catch { /* list row is enough to continue */ }
    }} />)}
    {!loading && !items.length ? <Empty title="No open Rx requests" body="Customer prescription requests will appear here." /> : null}
  </>;
}

function StockManagementScreen() {
  const [view, setView] = useState('all');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suggestions, setSuggestions] = useState<StockSuggestion[]>([]);
  const [history, setHistory] = useState<StockHistoryItem[]>([]);
  const [report, setReport] = useState<Array<{ product_name?: string; sold_in_range?: number; remaining_now?: number }>>([]);
  const [query, setQuery] = useState('');
  const [customQty, setCustomQty] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [stock, sugg, hist, sold] = await Promise.all([
        sellerApi.stockManagement(view === 'history' || view === 'sold' ? 'all' : view, query),
        sellerApi.stockSuggestions().catch(() => ({ data: { items: [] } })),
        sellerApi.stockHistory().catch(() => ({ data: { items: [] } })),
        sellerApi.stockReport(from, to).catch(() => ({ data: { items: [] } })),
      ]);
      setItems(stock.data?.items ?? []);
      setSuggestions(sugg.data?.items ?? []);
      setHistory(hist.data?.items ?? []);
      setReport(sold.data?.items ?? []);
    } catch (err) { Alert.alert('Stock', errorMessage(err)); }
    finally { setLoading(false); }
  }, [from, query, to, view]);
  useEffect(() => { load(); }, [load]);
  async function add(item: InventoryItem, qty: number) {
    try { await sellerApi.addStock({ product_id: item.id, add_stock: qty, reason: 'Seller app stock add' }); load(); }
    catch (err) { Alert.alert('Stock', errorMessage(err)); }
  }
  return <>
    <SearchBox placeholder="Search stock" value={query} onChangeText={setQuery} />
    <Segment<string> value={view} options={[['all', 'All'], ['low', 'Low'], ['out', 'Out'], ['suggested', 'Suggested'], ['history', 'History'], ['sold', 'Sold']]} onChange={setView} />
    {loading ? <CenteredLoader compact /> : null}
    {suggestions.length && view !== 'history' && view !== 'sold' ? (
      <>
        <Notice tone="warn" title={`${suggestions.length} restock suggestions`} body={suggestions.slice(0, 3).map((x) => x.name || x.product_name).filter(Boolean).join(', ')} />
        <Secondary label="Import suggested restock" onPress={async () => {
          const rows = suggestions.map((x) => ({ product_id: Number(x.product_id ?? x.id ?? 0), add_stock: Number(x.suggested_qty || 10), reason: x.reason || 'Suggested restock' })).filter((r) => r.product_id);
          if (!rows.length) return;
          try { await sellerApi.importStock(rows); Alert.alert('Stock', 'Suggested quantities imported'); load(); }
          catch (err) { Alert.alert('Stock', errorMessage(err)); }
        }} />
      </>
    ) : null}
    {view === 'history' ? history.map((h, idx) => (
      <View key={h.id ?? idx} style={s.card}>
        <Text style={s.itemTitle}>{h.product_name || 'Stock movement'}</Text>
        <Text style={s.muted}>{(h.txn_type || '').replace(/_/g, ' ')} • Qty {h.quantity ?? 0} • {prettyDate(h.created_at)}</Text>
        {h.notes || h.reference_number ? <Text style={s.muted}>{h.notes || h.reference_number}</Text> : null}
      </View>
    )) : null}
    {view === 'sold' ? (
      <>
        <View style={s.inputRow}><Field label="From" value={from} onChangeText={setFrom} compact /><Field label="To" value={to} onChangeText={setTo} compact /></View>
        <Secondary label="Load sold report" onPress={load} />
        {report.map((row, idx) => (
          <View key={idx} style={s.card}>
            <Text style={s.itemTitle}>{row.product_name || 'Product'}</Text>
            <Text style={s.muted}>Sold {row.sold_in_range ?? 0} • Remaining {row.remaining_now ?? 0}</Text>
          </View>
        ))}
      </>
    ) : null}
    {view !== 'history' && view !== 'sold' ? items.map((item) => (
      <View key={item.id} style={s.card}>
        <View style={s.rowBetween}>
          <View><Text style={s.itemTitle}>{item.name}</Text><Text style={s.muted}>{item.category_name || 'Catalog'} • {item.stock} in stock</Text></View>
          <Text style={s.itemPrice}>{money(item.price)}</Text>
        </View>
        <View style={s.inputRow}>
          <Secondary label="+10" onPress={() => add(item, 10)} compact />
          <Secondary label="+25" onPress={() => add(item, 25)} compact />
          <Danger label="Set 0" onPress={() => sellerApi.adjustStock({ product_id: item.id, action: 'set', quantity: 0, reason: 'Seller app adjustment' }).then(load).catch((err) => Alert.alert('Stock', errorMessage(err)))} compact />
        </View>
        <View style={s.inputRow}>
          <Field label="Custom qty" value={customQty[item.id] || ''} onChangeText={(v) => setCustomQty((m) => ({ ...m, [item.id]: v.replace(/\D/g, '') }))} compact />
          <Secondary label="Add qty" compact onPress={() => add(item, Number(customQty[item.id] || 0))} />
        </View>
      </View>
    )) : null}
    {!loading && view !== 'history' && view !== 'sold' && !items.length ? <Empty title="No stock items" body="Add products from catalog or confirm orders to build stock." /> : null}
    {!loading && view === 'history' && !history.length ? <Empty title="No stock history" body="Adds and adjustments will appear here." /> : null}
  </>;
}

function VirtualShopScreen() {
  const [data, setData] = useState<VirtualShopData | null>(null);
  const [rules, setRules] = useState<DiscountRule[]>([]);
  const [managed, setManaged] = useState(true);
  const [listed, setListed] = useState(true);
  const [discount, setDiscount] = useState('0');
  const [orderDiscount, setOrderDiscount] = useState('0');
  const [orderMin, setOrderMin] = useState('0');
  const [bannerUrl, setBannerUrl] = useState('');
  const [ruleName, setRuleName] = useState('');
  const [rulePct, setRulePct] = useState('10');
  const [ruleType, setRuleType] = useState<'all' | 'category' | 'product'>('all');
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [shop, offers] = await Promise.all([sellerApi.virtualShop(), sellerApi.discountRules().catch(() => ({ data: { items: [] } }))]);
      const vs = shop.data ?? {};
      setData(vs);
      setManaged(Boolean(vs.managed_inventory ?? vs.settings?.virtual_shop?.managed_inventory ?? true));
      setListed(Boolean(vs.settings?.virtual_shop?.listing_enabled ?? true));
      setDiscount(String(vs.settings?.virtual_shop?.discount_pct ?? 0));
      setOrderDiscount(String(vs.settings?.virtual_shop?.order_discount_pct ?? 0));
      setOrderMin(String(vs.settings?.virtual_shop?.order_discount_min ?? 0));
      setRules(offers.data?.items ?? vs.discounts ?? []);
    } catch (err) { Alert.alert('Virtual Shop', errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function save() {
    try {
      await sellerApi.saveVirtualShop({
        virtual_shop: {
          listing_enabled: listed ? 1 : 0,
          discount_pct: Number(discount || 0),
          order_discount_pct: Number(orderDiscount || 0),
          order_discount_min: Number(orderMin || 0),
          managed_inventory: managed ? 1 : 0,
          ...(bannerUrl.trim() ? { append_banners: [{ title: 'Shop banner', image_url: bannerUrl.trim() }] } : {}),
        },
        managed_inventory: managed ? 1 : 0,
      });
      Alert.alert('Virtual Shop', 'Virtual shop saved');
      setBannerUrl('');
      load();
    } catch (err) { Alert.alert('Virtual Shop', errorMessage(err)); }
  }
  async function saveRule() {
    if (!ruleName.trim()) return Alert.alert('Discount', 'Offer name is required.');
    try {
      await sellerApi.saveDiscountRule({ name: ruleName.trim(), target_type: ruleType, discount_pct: Number(rulePct || 0), status: 'Active' });
      setRuleName('');
      load();
    } catch (err) { Alert.alert('Discount', errorMessage(err)); }
  }
  if (loading) return <CenteredLoader compact />;
  return <>
    <View style={s.card}><Text style={s.itemTitle}>{data?.pharmacy?.name || 'My Store'}</Text><Text style={s.muted}>Listing status: {data?.listing_status || 'available through admin approval flow'}</Text></View>
    <ToggleRow title="Listing enabled" body="Show this pharmacy in Virtual Shop listings after approval." value={listed} onValueChange={setListed} />
    <ToggleRow title="Managed inventory" body="Customers who choose My Store see your seller inventory." value={managed} onValueChange={setManaged} />
    <Field label="Default shop discount %" value={discount} onChangeText={(v) => setDiscount(v.replace(/[^\d.]/g, ''))} />
    <View style={s.inputRow}>
      <Field label="Order discount %" value={orderDiscount} onChangeText={(v) => setOrderDiscount(v.replace(/[^\d.]/g, ''))} compact />
      <Field label="Min order" value={orderMin} onChangeText={(v) => setOrderMin(v.replace(/[^\d.]/g, ''))} compact />
    </View>
    <Field label="Banner image URL" value={bannerUrl} onChangeText={setBannerUrl} placeholder="https://..." />
    <Secondary label="Pick banner from gallery" onPress={async () => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Banner', 'Gallery permission is required.');
      const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
      if (picked.canceled || !picked.assets[0]) return;
      try {
        const session = await readSession();
        const form = new FormData();
        form.append('image', { uri: picked.assets[0].uri, name: 'banner.jpg', type: 'image/jpeg' } as unknown as Blob);
        const res = await fetch(`${API.phpBaseUrl}/seller/upload/banner`, { method: 'POST', headers: { Authorization: `Bearer ${session.accessToken}` }, body: form });
        const json = await res.json() as ApiWrap<{ image_url?: string; url?: string }>;
        if (!res.ok || json.success === false) throw new Error(json.message || 'Upload failed');
        setBannerUrl(mediaUrl(json.data?.image_url || json.data?.url) || '');
        Alert.alert('Banner', 'Image uploaded. Save Virtual Shop to attach it.');
      } catch (err) { Alert.alert('Banner', errorMessage(err)); }
    }} />
    <Primary label="Save Virtual Shop" onPress={save} />
    <SectionTitle title="Discount offers" right={`${rules.length}`} />
    {rules.map((rule) => (
      <View key={rule.id} style={s.card}>
        <View style={s.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={s.itemTitle}>{rule.name || 'Offer'}</Text>
            <Text style={s.muted}>{(rule.target_type || 'all')} • {rule.target_label || 'All products'} • {rule.discount_pct ?? 0}%</Text>
          </View>
          <Pill text={rule.is_live ? 'Live' : (rule.status || 'Off')} tone={rule.is_live ? 'green' : 'orange'} />
        </View>
        <Danger label="Delete" compact onPress={() => sellerApi.deleteDiscountRule(rule.id).then(load).catch((err) => Alert.alert('Discount', errorMessage(err)))} />
      </View>
    ))}
    <Field label="New offer name" value={ruleName} onChangeText={setRuleName} />
    <View style={s.inputRow}>
      <Field label="Discount %" value={rulePct} onChangeText={(v) => setRulePct(v.replace(/[^\d.]/g, ''))} compact />
      <Field label="Target" value={ruleType} onChangeText={(v) => setRuleType((v === 'category' || v === 'product' ? v : 'all'))} compact />
    </View>
    <Secondary label="Save discount offer" onPress={saveRule} />
  </>;
}

function PayoutsScreen() {
  const today = new Date().toISOString().slice(0, 10);
  const [items, setItems] = useState<PayoutOrder[]>([]);
  const [wallet, setWallet] = useState<WalletTxn[]>([]);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [payouts, txns] = await Promise.all([sellerApi.payoutOrders(), sellerApi.walletTransactions(from, to).catch(() => ({ data: { items: [] } }))]);
      setItems(payouts.data?.items ?? []);
      setWallet(txns.data?.items ?? []);
    } catch (err) { Alert.alert('Payouts', errorMessage(err)); }
    finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);
  const total = items.reduce((sum, i) => sum + Number(i.seller_payout_amount ?? 0), 0);
  return <>
    <View style={s.statRow}><StatCard label="Payout rows" value={String(items.length)} /><StatCard label="Payout total" value={shortMoney(total)} warm /></View>
    <View style={s.inputRow}><Field label="From" value={from} onChangeText={setFrom} compact /><Field label="To" value={to} onChangeText={setTo} compact /></View>
    <Secondary label="Refresh Payouts" onPress={load} />
    {loading ? <CenteredLoader compact /> : null}
    {items.slice(0, 30).map((o) => <View key={o.id} style={s.card}><View style={s.rowBetween}><Text style={s.itemTitle}>{o.order_number || `Order #${o.id}`}</Text><Text style={s.itemPrice}>{money(o.seller_payout_amount)}</Text></View><Text style={s.muted}>{o.status || '-'} • Order value {money(o.total_amount)} • {prettyDate(o.created_at)}</Text></View>)}
    <SectionTitle title="Wallet Transactions" right={`${wallet.length}`} />
    {wallet.slice(0, 20).map((w, idx) => (
      <View key={`${w.id ?? idx}`} style={s.card}>
        <View style={s.rowBetween}><Text style={s.itemTitle}>{(w.type || 'txn').replace(/_/g, ' ')}</Text><Text style={s.itemPrice}>{money(w.amount)}</Text></View>
        <Text style={s.muted}>{w.source || w.reference_type || 'Wallet'} {w.reference_id ? `#${w.reference_id}` : ''} • {prettyDate(w.created_at)}</Text>
        {w.note ? <Text style={s.muted}>{w.note}</Text> : null}
      </View>
    ))}
  </>;
}

function OrderDetailScreen({ order, dash, onBack }: { order: OrderDetail; dash: DashboardData | null; onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState(order);
  const [notes, setNotes] = useState(order.seller_notes || '');
  const [acting, setActing] = useState(false);
  const [fulfill, setFulfill] = useState<Record<number, string>>({});
  const [rxRows, setRxRows] = useState<RxMedicineRow[]>([{ name: '', qty: '1', price: '' }]);
  const [rxSuggest, setRxSuggest] = useState<Record<number, CatalogSuggestion[]>>({});
  const [rxImageOpen, setRxImageOpen] = useState(false);
  const [forward, setForward] = useState<Record<number, { qty: string; pharmacyId: string }>>({});
  const [invoice, setInvoice] = useState<OrderDetail['invoice']>(order.invoice ?? null);
  const [showInvoice, setShowInvoice] = useState(false);

  useEffect(() => {
    const next: Record<number, string> = {};
    detail.items?.forEach((item) => { next[item.id] = String(item.qty_pending ?? item.quantity ?? 0); });
    setFulfill(next);
  }, [detail.id]);

  async function reload() {
    const res = await sellerApi.orderDetail(detail.id);
    if (res.data) {
      const next = res.data;
      if (!next.forward_pharmacies?.length) {
        try {
          const fwd = await sellerApi.forwardPharmacies(next.pincode || undefined);
          next.forward_pharmacies = fwd.data?.items ?? [];
        } catch { /* order can still be processed without forward list */ }
      }
      setDetail(next);
    }
  }

  function updateRxRow(index: number, next: Partial<RxMedicineRow>) {
    setRxRows((rows) => rows.map((row, i) => i === index ? { ...row, ...next } : row));
  }

  async function searchRxCatalog(index: number, text: string) {
    updateRxRow(index, { name: text, product_id: undefined });
    if (text.trim().length < 2) {
      setRxSuggest((all) => ({ ...all, [index]: [] }));
      return;
    }
    try {
      const res = await sellerApi.catalogSearch(text);
      setRxSuggest((all) => ({ ...all, [index]: res.data?.items ?? [] }));
    } catch {
      setRxSuggest((all) => ({ ...all, [index]: [] }));
    }
  }

  function chooseRxProduct(index: number, product: CatalogSuggestion) {
    const productId = Number(product.product_id ?? product.id ?? 0);
    updateRxRow(index, {
      product_id: productId || undefined,
      name: product.name,
      price: product.price != null ? String(product.price) : '',
    });
    setRxSuggest((all) => ({ ...all, [index]: [] }));
  }

  async function run(code: string) {
    setActing(true);
    try {
      await sellerApi.orderAction(detail.id, code);
      await cancelOrderNotification(detail.id);
      setDetail((current) => current ? { ...current, status: code === 'rx_accept' ? 'confirmed' : code, seller_confirmed_at: new Date().toISOString() } : current);
      await reload();
      if (code === 'ready_for_pickup') {
        const prefs = await readPrefs();
        if (prefs.autoPrint) await printCurrentBill().catch(() => undefined);
        onBack();
      }
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
        items: (detail.items ?? []).map((item) => ({
          order_item_id: item.id,
          fulfill_qty: Number(fulfill[item.id] || 0),
          forward_qty: Number(forward[item.id]?.qty || 0),
          forward_to_pharmacy_id: Number(forward[item.id]?.pharmacyId || 0),
        })),
      });
      await cancelOrderNotification(detail.id);
      setDetail((current) => current ? { ...current, status: finalStatus, seller_confirmed_at: current.seller_confirmed_at || new Date().toISOString() } : current);
      await reload();
      if (finalStatus === 'ready_for_pickup') {
        const prefs = await readPrefs();
        if (prefs.autoPrint) await printCurrentBill().catch(() => undefined);
      }
      if (finalStatus === 'ready_for_pickup' || finalStatus === 'rejected') onBack();
    } catch (err) {
      Alert.alert('Order', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function submitRx() {
    const items = rxRows.filter((r) => r.name.trim()).map((r) => ({ product_id: r.product_id, medicine_name: r.name.trim(), quantity: Number(r.qty || 1), fulfill_qty: Number(r.qty || 1), price: Number(r.price || 0), disposition: 'fulfill' }));
    if (!items.length) return Alert.alert('Prescription', 'Add medicines you will supply.');
    setActing(true);
    try {
      const res = await sellerApi.prescriptionFill({ order_id: detail.id, items, seller_notes: notes, final_status: 'confirmed' });
      await cancelOrderNotification(detail.id);
      if (res.data) setDetail(res.data);
      else setDetail((current) => current ? { ...current, status: 'confirmed', seller_confirmed_at: new Date().toISOString() } : current);
    } catch (err) {
      Alert.alert('Prescription', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function sendRxToCart() {
    const items = rxRows.filter((r) => r.product_id).map((r) => ({ product_id: r.product_id, quantity: Number(r.qty || 1), price: Number(r.price || 0) }));
    if (!items.length) return Alert.alert('Prescription', 'Pick catalog medicines before sending to cart.');
    setActing(true);
    try {
      await sellerApi.prescriptionFillToCart({ order_id: detail.id, items, seller_notes: notes });
      Alert.alert('Prescription', 'Medicines sent to customer cart');
      await reload();
    } catch (err) {
      Alert.alert('Prescription', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function sendOrderMessage() {
    if (!notes.trim()) return Alert.alert('Order', 'Enter a message first.');
    setActing(true);
    try {
      await sellerApi.prescriptionSendMessage({ order_id: detail.id, message: notes });
      Alert.alert('Order', 'Message sent to customer');
    } catch (err) {
      Alert.alert('Order', errorMessage(err));
    } finally {
      setActing(false);
    }
  }

  async function loadInvoice() {
    try {
      const res = await sellerApi.orderInvoice(detail.id);
      setInvoice(res.data?.invoice ?? res.data as OrderDetail['invoice']);
      setShowInvoice(true);
      return res.data;
    } catch (err) {
      Alert.alert('Invoice', errorMessage(err));
      return null;
    }
  }

  async function printCurrentBill() {
    const bill = { ...detail, invoice: invoice ?? detail.invoice };
    const prefs = await readPrefs();
    await printBill(bill, 'thermal_58', dash?.pharmacy, {
      language: prefs.printerLanguage,
      paper: prefs.printerPaper || 'continuous',
      mac: prefs.printerMac || undefined,
    });
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
        {rx && mediaUrl(detail.prescription_url) ? (
          <TouchableOpacity activeOpacity={0.9} onPress={() => setRxImageOpen(true)}>
            <Image source={{ uri: mediaUrl(detail.prescription_url) }} style={s.rxImage} resizeMode="contain" />
            <Text style={s.tapHint}>Tap prescription to view fullscreen</Text>
          </TouchableOpacity>
        ) : null}
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
                <Field label="Medicine name" value={row.name} onChangeText={(v) => searchRxCatalog(idx, v)} />
                {(rxSuggest[idx] ?? []).slice(0, 5).map((product) => (
                  <TouchableOpacity key={product.product_id ?? product.id ?? product.name} style={s.suggestionRow} onPress={() => chooseRxProduct(idx, product)}>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemTitle}>{product.name}</Text>
                      <Text style={s.muted}>{product.seller_stock ?? 0} available</Text>
                    </View>
                    <Text style={s.itemPrice}>{money(product.price)}</Text>
                  </TouchableOpacity>
                ))}
                {row.name.trim().length >= 2 && !(rxSuggest[idx] ?? []).length ? <Text style={s.muted}>No catalog match yet. Check spelling or add another medicine name.</Text> : null}
                <View style={s.inputRow}>
                  <Field label="Qty" value={row.qty} onChangeText={(v) => updateRxRow(idx, { qty: v.replace(/\D/g, '') })} keyboardType="number-pad" compact />
                  <Field label="Price" value={row.price} onChangeText={(v) => updateRxRow(idx, { price: v.replace(/[^0-9.]/g, '') })} keyboardType="decimal-pad" compact />
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
              {pending && !rx && (detail.forward_pharmacies?.length || dash?.pharmacy) ? (
                <View style={s.inputRow}>
                  <Field label="Forward qty" value={forward[item.id]?.qty || ''} onChangeText={(v) => setForward((m) => ({ ...m, [item.id]: { qty: v.replace(/\D/g, ''), pharmacyId: m[item.id]?.pharmacyId || String(detail.forward_pharmacies?.[0]?.id || '') } }))} compact />
                  <Field
                    label="Forward pharmacy id"
                    value={forward[item.id]?.pharmacyId || String(detail.forward_pharmacies?.[0]?.id || '')}
                    onChangeText={(v) => setForward((m) => ({ ...m, [item.id]: { qty: m[item.id]?.qty || '', pharmacyId: v.replace(/\D/g, '') } }))}
                    compact
                  />
                </View>
              ) : null}
            </View>
          ))
        )}
        {detail.forward_pharmacies?.length ? (
          <View style={s.card}>
            <Text style={s.itemTitle}>Nearby pharmacies to forward</Text>
            {detail.forward_pharmacies.map((p) => <Text key={p.id} style={s.muted}>#{p.id} {p.name} • {p.city || p.nearby_label || ''} {p.distance_km != null ? `• ${p.distance_km} km` : ''}</Text>)}
          </View>
        ) : null}
        <Field label="Notes to customer" value={notes} onChangeText={setNotes} multiline />
        <View style={s.inputRow}>
          <Secondary label={showInvoice ? 'Hide invoice' : 'View invoice'} compact onPress={() => (showInvoice ? setShowInvoice(false) : loadInvoice())} />
          <Primary label="Print bill" compact onPress={() => printCurrentBill().catch((err) => Alert.alert('Print', err instanceof Error ? err.message : errorMessage(err)))} />
        </View>
        <Secondary label="Share bill PDF" onPress={() => {
          const layout = 'thermal_58' as PrinterLayout;
          shareBillPdf({ ...detail, invoice }, layout, dash?.pharmacy).catch((err) => Alert.alert('Bill', errorMessage(err)));
        }} />
        {showInvoice && invoice ? (
          <View style={s.card}>
            <Text style={s.itemTitle}>Invoice</Text>
            {invoice.lines?.map((line, idx) => <Text key={idx} style={s.muted}>{line.name} × {line.quantity ?? 0} = {money(line.line_total ?? line.price)}</Text>)}
            <Text style={s.amount}>Subtotal {money(invoice.subtotal)} • Delivery {money(invoice.delivery_fee)} • Total {money(invoice.total_amount)}</Text>
          </View>
        ) : null}
        {pending && rx && detail.status === 'prescription_review' && !detail.seller_confirmed_at ? (
          <Primary label={acting ? 'Accepting...' : 'Accept Prescription'} disabled={acting} onPress={() => run('rx_accept')} />
        ) : null}
        {pending && rx ? <Primary label={acting ? 'Saving...' : 'Fill prescription & confirm'} disabled={acting} onPress={submitRx} /> : null}
        {pending && rx ? <Secondary label={acting ? 'Sending...' : 'Send catalog items to cart'} disabled={acting} onPress={sendRxToCart} /> : null}
        {rx ? <Secondary label="Message customer" disabled={acting} onPress={sendOrderMessage} /> : null}
        {pending && !rx ? (
          <>
            <Primary label="Confirm & Save" disabled={acting} onPress={() => process('confirmed')} />
            <Primary label="Confirm & Ready for Pickup" disabled={acting} onPress={() => process('ready_for_pickup')} />
            <Secondary label="Confirm & Start Preparing" disabled={acting} onPress={() => process('preparing')} />
            <Danger label="Reject order" disabled={acting} onPress={() => process('rejected')} />
          </>
        ) : null}
        {pending && rx ? <Danger label="Wrong prescription" disabled={acting} onPress={() => run('wrong_prescription')} /> : null}
        {!pending && quickActions(detail.status).map((a) => <Primary key={a.code} label={a.label} disabled={acting} onPress={() => run(a.code)} />)}
      </ScrollView>
      <Modal visible={rxImageOpen} animationType="fade" onRequestClose={() => setRxImageOpen(false)}>
        <View style={s.imageViewer}>
          <TouchableOpacity style={s.imageClose} onPress={() => setRxImageOpen(false)}>
            <Text style={s.imageCloseText}>Close</Text>
          </TouchableOpacity>
          {mediaUrl(detail.prescription_url) ? <Image source={{ uri: mediaUrl(detail.prescription_url) }} style={s.fullRxImage} resizeMode="contain" /> : null}
        </View>
      </Modal>
    </View>
  );
}

function SubscriptionSection({ dash }: { dash: DashboardData | null }) {
  const [info, setInfo] = useState<SubscriptionInfo | null>(dash?.subscription ?? null);
  const [plans, setPlans] = useState<SellerPlan[]>([]);
  const [preview, setPreview] = useState<Record<number, SubscriptionPreview>>({});
  useEffect(() => {
    Promise.all([sellerApi.subscription(), sellerApi.subscriptionPlans()])
      .then(([sub, p]) => { setInfo(sub.data ?? null); setPlans(p.data?.items ?? []); })
      .catch(() => undefined);
  }, []);
  async function showPreview(planId: number) {
    try {
      const res = await sellerApi.subscriptionPreview(planId);
      setPreview((m) => ({ ...m, [planId]: res.data ?? {} }));
    } catch (err) {
      Alert.alert('Subscription', errorMessage(err));
    }
  }
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
          {preview[p.id] ? <Text style={s.muted}>Wallet {money(preview[p.id].wallet_applied)} • Payable {money(preview[p.id].payable ?? preview[p.id].plan_price)}</Text> : null}
          <View style={s.inputRow}>
            <Secondary label="Preview" compact onPress={() => showPreview(p.id)} />
            <Secondary label="Buy demo pay" compact onPress={() => sellerApi.subscribePlan(p.id).then((r) => setInfo(r.data ?? null)).catch((err) => Alert.alert('Subscription', errorMessage(err)))} />
          </View>
        </View>
      ))}
    </>
  );
}

function ReportsScreen({ onBack }: { onBack: () => void }) {
  const insets = useSafeAreaInsets();
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<ReportTab>('items');
  const [items, setItems] = useState<DailySalesReport | null>(null);
  const [orders, setOrders] = useState<OrderSalesReport | null>(null);
  const [rx, setRx] = useState<RxOrdersReport | null>(null);
  const [virtual, setVirtual] = useState<OrderSalesReport | null>(null);
  const [wallet, setWallet] = useState<{ items?: WalletTxn[] | null; summary?: Record<string, number> | null } | null>(null);
  const [loading, setLoading] = useState(false);
  async function load(nextTab = tab) {
    setLoading(true);
    try {
      if (nextTab === 'items') setItems((await sellerApi.dailySalesReport(from, to)).data ?? null);
      if (nextTab === 'orders') setOrders((await sellerApi.orderSalesReport(from, to)).data ?? null);
      if (nextTab === 'rx') setRx((await sellerApi.rxOrdersReport(from, to)).data ?? null);
      if (nextTab === 'virtual') setVirtual((await sellerApi.virtualShopReport(from, to)).data ?? null);
      if (nextTab === 'wallet') setWallet((await sellerApi.walletTransactions(from, to)).data ?? null);
    } catch (err) {
      Alert.alert('Report', errorMessage(err));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);
  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <Header title="Reports & Audit" subtitle="Seller sales, Rx, virtual shop and wallet" onRefresh={() => load()} onLogout={onBack} />
      <ScrollView contentContainerStyle={s.body}>
        <TouchableOpacity onPress={onBack}><Text style={s.backText}>‹ Back</Text></TouchableOpacity>
        <View style={s.card}>
          <View style={s.inputRow}>
            <Field label="From" value={from} onChangeText={setFrom} compact />
            <Field label="To" value={to} onChangeText={setTo} compact />
          </View>
          <Segment<ReportTab> value={tab} options={[['items', 'Items'], ['orders', 'Orders'], ['rx', 'Rx'], ['virtual', 'Virtual'], ['wallet', 'Wallet']]} onChange={(v) => { setTab(v); load(v); }} dark />
          <Primary label={loading ? 'Loading...' : 'Load'} onPress={() => load()} disabled={loading} />
          <Secondary label="Export CSV" onPress={async () => {
            const headers = ['Type', 'Ref', 'Amount', 'Date'];
            const rows: Array<Array<string | number>> = [];
            if (tab === 'items') items?.days?.forEach((d) => d.lines?.forEach((l) => rows.push(['item', l.order_number || '', l.line_total ?? 0, d.date || ''])));
            if (tab === 'orders' || tab === 'virtual') (tab === 'orders' ? orders : virtual)?.items?.forEach((o) => rows.push(['order', o.order_number || '', o.seller_payout_amount ?? 0, o.created_at || '']));
            if (tab === 'rx') rx?.prescription_orders?.forEach((o) => rows.push(['rx', o.order_number || '', o.seller_payout_amount ?? 0, o.created_at || '']));
            if (tab === 'wallet') wallet?.items?.forEach((w) => rows.push([w.type || 'txn', w.reference_id || '', w.amount ?? 0, w.created_at || '']));
            const csv = csvFromRows(headers, rows);
            const path = `${FileSystem.cacheDirectory}zepmed-${tab}-report.csv`;
            await FileSystem.writeAsStringAsync(path, csv);
            if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export report' });
            else await Share.share({ message: csv });
          }} />
        </View>
        {tab === 'items' && items?.summary ? <View style={s.statRow}><StatCard label="Lines" value={String(items.summary.line_count ?? 0)} /><StatCard label="Qty" value={String(items.summary.total_qty ?? 0)} /><StatCard label="Total" value={money(items.summary.total_amount)} warm /></View> : null}
        {tab === 'items' ? items?.days?.map((day) => (
          <View key={day.date || Math.random()} style={{ gap: 8 }}>
            <SectionTitle title={day.date || ''} right={money(day.total_amount)} />
            {day.lines?.map((line, idx) => <View key={idx} style={s.card}><Text style={s.itemTitle}>{line.product_name || '-'}</Text><Text style={s.muted}>{line.order_number} • {line.order_type || 'regular'}</Text><Text style={s.amount}>Qty {line.quantity ?? 0} × {money(line.price)} = {money(line.line_total)}</Text></View>)}
          </View>
        )) : null}
        {tab === 'orders' || tab === 'virtual' ? (
          <>
            <View style={s.statRow}>
              <StatCard label="Orders" value={String((tab === 'orders' ? orders : virtual)?.summary?.order_count ?? 0)} />
              <StatCard label="Payout" value={money((tab === 'orders' ? orders : virtual)?.summary?.seller_payout_total)} warm />
            </View>
            {((tab === 'orders' ? orders : virtual)?.items ?? []).map((o, idx) => (
              <View key={o.id ?? idx} style={s.card}>
                <View style={s.rowBetween}><Text style={s.itemTitle}>{o.order_number || 'Order'}</Text><Text style={s.itemPrice}>{money(o.seller_payout_amount)}</Text></View>
                <Text style={s.muted}>{(o.status || '').replace(/_/g, ' ')} • {o.payment_method || 'COD'} • {prettyDate(o.created_at)}</Text>
                {o.anomaly_messages?.length ? <Text style={[s.muted, { color: C.red }]}>{o.anomaly_messages.join(' · ')}</Text> : null}
              </View>
            ))}
          </>
        ) : null}
        {tab === 'rx' ? (
          <>
            <View style={s.statRow}><StatCard label="Rx requests" value={String(rx?.summary?.rx_requests ?? rx?.rx_requests?.length ?? 0)} /><StatCard label="Rx orders" value={String(rx?.summary?.prescription_orders ?? rx?.prescription_orders?.length ?? 0)} warm /></View>
            {rx?.rx_requests?.map((r, idx) => <View key={r.id ?? idx} style={s.card}><Text style={s.itemTitle}>{r.customer_name || r.request_number || `Rx ${r.id}`}</Text><Text style={s.muted}>{r.status || '-'} • {r.customer_phone || ''} • {prettyDate(r.created_at)}</Text></View>)}
            {rx?.prescription_orders?.map((o, idx) => <View key={idx} style={s.card}><Text style={s.itemTitle}>{o.order_number || 'Rx order'}</Text><Text style={s.muted}>{(o.status || '').replace(/_/g, ' ')} • {money(o.seller_payout_amount)} • {prettyDate(o.created_at)}</Text></View>)}
          </>
        ) : null}
        {tab === 'wallet' ? (
          <>
            <View style={s.statRow}><StatCard label="Credits" value={money(wallet?.summary?.credit_total)} /><StatCard label="Net" value={money(wallet?.summary?.net)} warm /></View>
            {wallet?.items?.map((w, idx) => <View key={w.id ?? idx} style={s.card}><View style={s.rowBetween}><Text style={s.itemTitle}>{(w.type || 'txn').replace(/_/g, ' ')}</Text><Text style={s.itemPrice}>{money(w.amount)}</Text></View><Text style={s.muted}>{w.source || w.note || ''} • {prettyDate(w.created_at)}</Text></View>)}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function SettingsPanel() {
  const [sound, setSound] = useState(true);
  const [autoPrint, setAutoPrint] = useState(false);
  useEffect(() => {
    readPrefs().then((parsed) => {
      setSound(parsed.sound);
      setAutoPrint(parsed.autoPrint);
    });
  }, []);
  function save(next: { sound?: boolean; autoPrint?: boolean }) {
    const value = { sound, autoPrint, ...next };
    setSound(value.sound);
    setAutoPrint(value.autoPrint);
    writeSellerPrefs(value).catch(() => undefined);
    setOrderWatchSound(value.sound);
    if (!value.sound) syncPendingOrderNotifications([]).catch(() => undefined);
  }
  return (
    <>
      <SectionTitle title="Order alerts" />
      <View style={s.card}>
        <View style={s.rowBetween}><View><Text style={s.itemTitle}>Sound on new order</Text><Text style={s.muted}>Bell and vibrate on new order</Text></View><Switch value={sound} onValueChange={(v) => save({ sound: v })} /></View>
        <Secondary label="Test order bell" onPress={() => { startOrderBell(true); setTimeout(() => stopOrderBell(), 4000); }} />
        <Secondary label="Allow lock-screen alerts" onPress={() => Linking.openSettings()} />
        <View style={s.rowBetween}><View><Text style={s.itemTitle}>Auto-print on ready</Text><Text style={s.muted}>Print to the saved Bluetooth printer</Text></View><Switch value={autoPrint} onValueChange={(v) => save({ autoPrint: v })} /></View>
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
        {orderCardActions(order).map((a) => <TouchableOpacity key={a.code} style={s.actionPill} onPress={() => onAction(a.code)}><Text style={s.actionText}>{a.label}</Text></TouchableOpacity>)}
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
          <Image source={LOGO} style={s.authLogo} resizeMode="contain" />
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

function WholesaleOrderCard({ order, mode, onChanged, action }: { order: WholesaleOrder; mode?: 'buyer' | 'wholeseller'; onChanged?: () => void; action?: (code: string) => void }) {
  const [detail, setDetail] = useState<WholesaleOrder | null>(null);
  async function run(code: string) {
    try {
      await sellerApi.wholesaleAction(order.id, code);
      onChanged?.();
    } catch (err) {
      Alert.alert('Wholesale', errorMessage(err));
    }
  }
  async function openDetail() {
    try {
      const res = await sellerApi.wholesaleOrderDetail(order.id);
      setDetail(res.data ?? order);
    } catch (err) {
      Alert.alert('Wholesale', errorMessage(err));
    }
  }
  async function openInvoice() {
    try {
      const res = await sellerApi.wholesaleOrderInvoice(order.id);
      Alert.alert('Invoice', `${res.data?.order_number || order.order_number} • ${money(res.data?.subtotal ?? order.subtotal)}`);
    } catch (err) {
      Alert.alert('Invoice', errorMessage(err));
    }
  }
  return (
    <View style={s.card}>
      <TouchableOpacity onPress={openDetail}>
        <Text style={s.itemTitle}>{order.order_number}</Text>
        <Text style={s.muted}>{order.wholeseller_pharmacy_name || order.buyer_pharmacy_name || '-'} • {money(order.subtotal)} • {order.status}</Text>
        {order.items?.slice(0, 2).map((i, idx) => <Text key={idx} style={s.muted}>{i.product_name || i.quantity_label || `${i.quantity ?? 0} ${i.quantity_unit || ''}`}</Text>)}
        {detail?.items?.slice(0, 6).map((i, idx) => <Text key={`d-${idx}`} style={s.muted}>{i.product_name || i.quantity_label || `${i.quantity ?? 0}`}</Text>)}
      </TouchableOpacity>
      <View style={s.actionRow}>
        <Secondary label="Invoice" compact onPress={openInvoice} />
        {mode === 'buyer' ? <Danger label="Cancel" compact onPress={() => run('cancel')} /> : null}
        {mode === 'wholeseller' || action ? (
          <>
            <Secondary label="Confirm" compact onPress={() => (action ? action('confirm') : run('confirm'))} />
            <Danger label="Reject" compact onPress={() => (action ? action('reject') : run('reject'))} />
            <Primary label="Fulfill" compact onPress={() => (action ? action('fulfill') : run('fulfill'))} />
          </>
        ) : null}
      </View>
    </View>
  );
}

function WholesaleExtras({ dash, canWholesale }: { dash: DashboardData | null; canWholesale: boolean; onRefresh?: () => void }) {
  const [low, setLow] = useState<InventoryItem[]>([]);
  const [txns, setTxns] = useState<Array<{ id?: number; product_name?: string; txn_type?: string; quantity?: number; created_at?: string }>>([]);
  useEffect(() => {
    if (!canWholesale && !dash?.is_wholeseller) return;
    sellerApi.wholesaleLowStock().then((r) => setLow(r.data?.items ?? [])).catch(() => setLow([]));
    sellerApi.wholesaleTransactions().then((r) => setTxns((r.data?.items ?? []) as typeof txns)).catch(() => setTxns([]));
  }, [canWholesale, dash?.is_wholeseller]);
  if (!canWholesale && !dash?.is_wholeseller) return null;
  return (
    <>
      {low.length ? <Notice tone="warn" title={`${low.length} wholesale restock items`} body={low.slice(0, 3).map((i) => i.name).join(', ')} /> : null}
      {txns.length ? (
        <>
          <SectionTitle title="Wholesale stock movements" right={`${txns.length}`} />
          {txns.slice(0, 6).map((t, idx) => <Text key={t.id ?? idx} style={s.muted}>{(t.txn_type || 'txn').replace(/_/g, ' ')} • {t.product_name || '-'} • {t.quantity ?? 0} • {prettyDate(t.created_at)}</Text>)}
        </>
      ) : null}
    </>
  );
}

function HomeReferralCard() {
  const [data, setData] = useState<ReferralData | null>(null);
  useEffect(() => {
    sellerApi.referral().then((r) => setData(r.data ?? null)).catch(() => undefined);
  }, []);
  if (!data) return null;
  const code = data.share_referral || data.seller_referral_code || data.seller_mobile || '';
  return (
    <View style={s.card}>
      <Text style={s.itemTitle}>Referral</Text>
      <Text style={s.muted}>{code || 'Code loading'} • {data.referred_customers_count ?? data.referred_count ?? 0} customers • Bonus {money(data.bonus_approved)}</Text>
      {code ? <Secondary label="Share referral" onPress={() => Share.share({ message: data.register_link || `Join ZepMed with my referral ${code}` })} /> : null}
    </View>
  );
}

function ReferralScreen() {
  const [data, setData] = useState<ReferralData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData((await sellerApi.referral()).data ?? null); }
    catch (err) { Alert.alert('Referral', errorMessage(err)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  if (loading) return <CenteredLoader compact />;
  const code = data?.share_referral || data?.seller_referral_code || data?.seller_mobile || '';
  return <>
    <View style={s.statRow}>
      <StatCard label="Customers" value={String(data?.referred_customers_count ?? data?.referred_count ?? 0)} />
      <StatCard label="Wallet" value={shortMoney(data?.pharmacy_wallet_balance)} warm />
    </View>
    <View style={s.card}>
      <Text style={s.itemTitle}>{code || 'No referral code yet'}</Text>
      <Text style={s.muted}>Pending {money(data?.bonus_pending)} • Approved {money(data?.bonus_approved)} • Paid {money(data?.bonus_paid)}</Text>
      {data?.register_link ? <Text style={s.muted}>{data.register_link}</Text> : null}
      <Secondary label="Share" onPress={() => Share.share({ message: data?.register_link || `Join ZepMed with my referral ${code}` })} />
    </View>
    {data?.customers?.slice(0, 20).map((c, idx) => <Info key={idx} label={c.name || 'Customer'} value={c.mobile || '-'} />)}
    {data?.recent_bonuses?.slice(0, 10).map((b, idx) => <Text key={idx} style={s.muted}>{money(b.amount)} • {b.status || ''} • {prettyDate(b.created_at)}</Text>)}
  </>;
}

function ProductsScreen() {
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<CatalogSuggestion[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [categoryId, setCategoryId] = useState('');
  useEffect(() => {
    sellerApi.productCategories().then((r) => setCategories(r.data?.items ?? [])).catch(() => setCategories([]));
  }, []);
  async function searchCatalog(q: string) {
    setSearch(q);
    if (q.trim().length < 2) return setResults([]);
    try { setResults((await sellerApi.catalogSearch(q)).data?.items ?? []); } catch { setResults([]); }
  }
  async function attach(item: CatalogSuggestion) {
    const productId = Number(item.product_id ?? item.id ?? 0);
    if (!productId) return;
    try {
      await sellerApi.attachInventory({ product_id: productId, price: item.price ?? 0, stock: 0, is_available: 1 });
      Alert.alert('Catalog', `${item.name} attached to your inventory`);
    } catch (err) { Alert.alert('Catalog', errorMessage(err)); }
  }
  async function submit() {
    if (!name.trim() || !price) return Alert.alert('Product', 'Name and price are required.');
    try {
      await sellerApi.submitProduct({ name: name.trim(), price: Number(price), stock: Number(stock || 0), category_id: Number(categoryId || 0) || undefined });
      Alert.alert('Product', 'Submitted for admin approval');
      setName('');
      setPrice('');
    } catch (err) { Alert.alert('Product', errorMessage(err)); }
  }
  return <>
    <SectionTitle title="Attach from catalog" />
    <SearchBox placeholder="Search ZepMed catalog" value={search} onChangeText={searchCatalog} />
    {results.slice(0, 8).map((p) => {
      const id = Number(p.product_id ?? p.id ?? 0);
      return <MenuItem key={id || p.name} title={p.name} body={`${money(p.price)} • stock ${p.seller_stock ?? 0}`} onPress={() => attach(p)} />;
    })}
    <SectionTitle title="Submit new product" />
    <Field label="Product name" value={name} onChangeText={setName} />
    <View style={s.inputRow}><Field label="Price" value={price} onChangeText={(v) => setPrice(v.replace(/[^\d.]/g, ''))} compact /><Field label="Opening stock" value={stock} onChangeText={(v) => setStock(v.replace(/\D/g, ''))} compact /></View>
    <Field label="Category id" value={categoryId} onChangeText={(v) => setCategoryId(v.replace(/\D/g, ''))} />
    {categories.length ? <Text style={s.muted}>{categories.slice(0, 8).map((c) => `${c.id} ${c.name}`).join(' · ')}</Text> : null}
    <Primary label="Submit for approval" onPress={submit} />
    <SectionTitle title="Bulk submit" />
    <Text style={s.muted}>One product per line: name, price, stock</Text>
    <BulkProductBox categories={categories} />
  </>;
}

function BulkProductBox({ categories }: { categories: ProductCategory[] }) {
  const [raw, setRaw] = useState('');
  async function submit() {
    const rows = raw.split('\n').map((line) => line.split(',').map((x) => x.trim())).filter((cols) => cols[0]).map((cols) => ({
      name: cols[0],
      price: Number(cols[1] || 0),
      stock: Number(cols[2] || 0),
      category_id: categories[0]?.id,
    }));
    if (!rows.length) return Alert.alert('Bulk submit', 'Add at least one line: name, price, stock');
    try {
      const res = await sellerApi.bulkSubmitProducts(rows);
      Alert.alert('Bulk submit', res.message || `Submitted ${rows.length} products`);
      setRaw('');
    } catch (err) { Alert.alert('Bulk submit', errorMessage(err)); }
  }
  return <>
    <TextInput style={[s.input, { minHeight: 110, textAlignVertical: 'top' }]} multiline value={raw} onChangeText={setRaw} placeholder="Paracetamol 500, 20, 50" placeholderTextColor={C.muted} />
    <Secondary label="Bulk submit for approval" onPress={submit} />
  </>;
}

function IntegrationsCard() {
  const [items, setItems] = useState<Array<{ name?: string; status?: string; label?: string }>>([]);
  useEffect(() => {
    sellerApi.platformIntegrations().then((r) => setItems(r.data?.items ?? [])).catch(() => setItems([]));
  }, []);
  if (!items.length) return null;
  return (
    <>
      <SectionTitle title="Integrations" />
      {items.map((item, idx) => <Info key={idx} label={item.label || item.name || 'Integration'} value={item.status || '-'} />)}
    </>
  );
}

function BottomTabs({ current, setTab, pending }: { current: TabKey; setTab: (tab: TabKey) => void; pending: number }) {
  const insets = useSafeAreaInsets();
  const tabs: Array<[TabKey, string]> = [['home', 'Home'], ['orders', 'Orders'], ['catalog', 'Catalog'], ['stock', 'Stock'], ['more', 'More']];
  return (
    <View style={[s.tabs, { bottom: Math.max(insets.bottom, 10) }]}>
      {tabs.map(([key, label]) => (
        <TouchableOpacity key={key} style={[s.tab, current === key && s.tabActive]} onPress={() => setTab(key)} activeOpacity={0.85}>
          <AnimatedTabLogo source={TAB_LOGOS[key]} active={current === key} badge={key === 'orders' && pending > 0 ? (pending > 9 ? '9+' : String(pending)) : undefined} />
          <Text style={[s.tabLabel, current === key && s.tabTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function AnimatedTabLogo({ source, active, badge }: { source: number; active: boolean; badge?: string }) {
  const progress = useRef(new Animated.Value(active ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: active ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [active, progress]);
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.16] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, -2] });
  const opacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });
  return (
    <Animated.View style={[s.tabLogo, active && s.tabLogoActive, { opacity, transform: [{ translateY }, { scale }] }]}>
      <Image source={source} style={s.tabIconImage} resizeMode="contain" />
      {badge ? <Text style={s.badge}>{badge}</Text> : null}
    </Animated.View>
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

function FormCard({ children, error, onRetry }: { children: React.ReactNode; error?: string; onRetry?: () => void }) {
  return (
    <View style={s.card}>
      {error ? <Notice tone="error" title="Could not load data" body={error} /> : null}
      {error && onRetry ? <Secondary label="Retry" onPress={onRetry} /> : null}
      {children}
    </View>
  );
}

function ToggleRow({ title, body, value, onValueChange }: { title: string; body: string; value: boolean; onValueChange: (value: boolean) => void }) {
  return (
    <View style={s.toggleRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.itemTitle}>{title}</Text>
        <Text style={s.muted}>{body}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
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

function Pill({ text, tone }: { text: string; tone?: 'green' | 'blue' | 'red' | 'purple' | 'orange' }) {
  const color = tone === 'green' ? [C.greenSoft, C.green] : tone === 'blue' ? [C.blueSoft, C.blue] : tone === 'red' ? [C.redSoft, C.red] : tone === 'purple' ? [C.purpleSoft, C.purple] : tone === 'orange' ? [C.orangeSoft, C.orange] : [C.beige, C.muted];
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

function SummaryTile({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.summaryTile} activeOpacity={0.82} onPress={onPress}>
      <Text style={s.summaryLabel}>{label}</Text>
      <Text style={s.summaryValue}>{value}</Text>
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
  splashGlow: { position: 'absolute', width: 280, height: 280, borderRadius: 140, backgroundColor: C.tealSoft, opacity: 0.9 },
  splashLogoCard: { width: 250, height: 108, borderRadius: 24, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 10 },
  splashLogo: { width: 210, height: 72 },
  splashMark: { width: 118, height: 118, borderRadius: 32, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', shadowColor: C.teal, shadowOpacity: 0.28, shadowRadius: 22, shadowOffset: { width: 0, height: 12 }, elevation: 8 },
  splashAppIcon: { width: 118, height: 118 },
  zTile: { width: 54, height: 54, borderRadius: 14, backgroundColor: C.orangeSoft, alignItems: 'center', justifyContent: 'center' },
  zText: { color: C.orange, fontWeight: '900', fontSize: 22 },
  splashTitle: { marginTop: 34, fontSize: 28, fontWeight: '900', color: C.tealDeep },
  splashSub: { marginTop: 8, color: C.muted, fontSize: 16 },
  dots: { flexDirection: 'row', gap: 12, marginTop: 56 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: C.orange },
  authScreen: { flex: 1, backgroundColor: '#FFF' },
  authWrap: { paddingHorizontal: 34, paddingTop: 104, paddingBottom: 48, gap: 18, minHeight: '100%' },
  authHero: { backgroundColor: '#FFF', borderColor: C.line, borderWidth: 1, borderRadius: 22, padding: 20, minHeight: 176, justifyContent: 'center' },
  authTitle: { marginTop: 16, color: C.ink, fontSize: 27, fontWeight: '900' },
  authSub: { color: C.muted, marginTop: 4, fontSize: 14 },
  loginBrand: { alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  authLogo: { width: 220, height: 76 },
  loginLogo: { width: 50, height: 50, borderRadius: 12, backgroundColor: C.redAccent, alignItems: 'center', justifyContent: 'center' },
  loginLogoText: { color: '#FFF', fontSize: 34, fontWeight: '800', marginTop: -2 },
  loginBrandText: { color: '#101828', fontSize: 32, fontWeight: '900' },
  loginTitle: { color: '#111827', textAlign: 'center', fontSize: 28, fontWeight: '900', marginTop: 4 },
  loginSub: { color: '#667085', textAlign: 'center', fontSize: 16, marginBottom: 36 },
  loginLabel: { color: '#667085', fontSize: 14, fontWeight: '900' },
  phoneInputRow: { height: 58, borderRadius: 10, borderWidth: 1, borderColor: '#D7DDE6', backgroundColor: '#F9FAFB', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18 },
  countryCode: { color: '#111827', fontSize: 20, fontWeight: '900' },
  phoneDivider: { width: 1, height: 24, backgroundColor: '#AEB6C3', marginHorizontal: 14 },
  phoneInput: { flex: 1, color: '#111827', fontSize: 18, minHeight: 58 },
  otpButton: { height: 60, borderRadius: 10, backgroundColor: C.redAccent, alignItems: 'center', justifyContent: 'center', marginTop: 10 },
  otpButtonText: { color: '#FFF', fontSize: 18, fontWeight: '900' },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginVertical: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: '#EAECF0' },
  orText: { color: '#98A2B3', fontWeight: '900', fontSize: 13 },
  whatsappButton: { height: 60, borderRadius: 10, borderWidth: 1, borderColor: '#22C55E', backgroundColor: '#ECFDF3', alignItems: 'center', justifyContent: 'center' },
  whatsappText: { color: '#22C55E', fontSize: 17, fontWeight: '900' },
  authLinks: { flexDirection: 'row', justifyContent: 'center', gap: 22, marginTop: 2 },
  authLinkText: { color: C.redAccent, fontWeight: '800', fontSize: 13 },
  termsText: { color: '#667085', fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 'auto' },
  termsLink: { color: C.redAccent, textDecorationLine: 'underline' },
  header: { minHeight: 84, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#FFF', borderBottomWidth: 1, borderBottomColor: C.line, shadowColor: C.teal, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  headerLogo: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.teal },
  headerTitle: { color: C.ink, fontWeight: '900', fontSize: 22 },
  headerSub: { color: C.muted, marginTop: 3, fontSize: 12 },
  iconButton: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.tealSoft, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: C.muted, fontSize: 22, fontWeight: '900' },
  body: { paddingHorizontal: 18, paddingBottom: 128, gap: 14 },
  dashboardCard: { backgroundColor: '#FFF', borderRadius: 22, borderWidth: 1, borderColor: C.line, padding: 18, gap: 16, shadowColor: C.teal, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 3 },
  card: { backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 16, gap: 10, shadowColor: '#0F766E', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  bigTitle: { color: C.ink, fontWeight: '900', fontSize: 20 },
  muted: { color: C.muted, fontSize: 13, lineHeight: 19 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  kpi: { width: '47.9%', aspectRatio: 1, borderRadius: 16, padding: 14, justifyContent: 'space-between', borderWidth: 1, borderColor: 'rgba(32,33,30,0.05)', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 1 },
  kpiLabel: { color: C.muted, fontSize: 12, fontWeight: '800' },
  kpiValue: { color: C.ink, fontSize: 26, fontWeight: '900', marginTop: 4 },
  kpiArrow: { position: 'absolute', right: 12, bottom: 8, fontSize: 28, fontWeight: '900' },
  storeToggle: { minHeight: 72, borderRadius: 16, padding: 14, borderWidth: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  storeToggleOpen: { backgroundColor: C.greenSoft, borderColor: '#C6DCCB' },
  storeToggleClosed: { backgroundColor: C.redSoft, borderColor: '#E2C0C0' },
  storeToggleTitle: { fontSize: 16, fontWeight: '900' },
  storeToggleBody: { fontSize: 12, marginTop: 4 },
  storeToggleAction: { fontSize: 14, fontWeight: '900' },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  summaryTile: { width: '47.9%', minHeight: 70, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, padding: 12, justifyContent: 'center' },
  summaryLabel: { color: C.muted, fontSize: 11, fontWeight: '900' },
  summaryValue: { color: C.ink, fontSize: 21, fontWeight: '900', marginTop: 5 },
  infoCard: { borderRadius: 16, padding: 16 },
  infoTitle: { fontWeight: '900', fontSize: 15 },
  infoText: { marginTop: 6, fontSize: 13 },
  sectionTitle: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  sectionText: { color: C.ink, fontSize: 20, fontWeight: '900' },
  sectionRight: { color: C.muted, fontSize: 12, fontWeight: '700' },
  orderCard: { backgroundColor: '#FFF', borderRadius: 18, borderWidth: 1, borderColor: C.line, padding: 16, gap: 12, shadowColor: C.teal, shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
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
  toggleRow: { minHeight: 76, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: '#FFF', padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  primary: { minHeight: 56, borderRadius: 16, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, shadowColor: C.teal, shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
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
  tapHint: { color: C.muted, textAlign: 'center', fontSize: 12, marginTop: 8 },
  suggestionRow: { borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.beige, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  imageViewer: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  imageClose: { position: 'absolute', top: 44, right: 18, zIndex: 2, minHeight: 42, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.92)', paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  imageCloseText: { color: C.ink, fontWeight: '900' },
  fullRxImage: { width: '100%', height: '100%' },
  virtualBanner: { backgroundColor: '#FFF7ED', borderRadius: 14, padding: 12 },
  virtualTitle: { color: C.orangeDark, fontWeight: '900', fontSize: 13 },
  virtualText: { color: C.yellow, fontSize: 12, marginTop: 4 },
  stepper: { backgroundColor: C.greenSoft, borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between' },
  step: { alignItems: 'center', flex: 1 },
  stepDot: { color: C.muted, fontSize: 18 },
  stepText: { color: C.muted, fontSize: 11, fontWeight: '800', marginTop: 4 },
  tabs: { position: 'absolute', left: 12, right: 12, bottom: 10, height: 78, backgroundColor: '#FFFFFF', borderRadius: 28, borderWidth: 1, borderColor: '#E3EEEC', flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingHorizontal: 6, shadowColor: '#0F766E', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 14 },
  tab: { minWidth: 60, height: 66, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: C.tealSoft },
  tabLogo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4FAF9', overflow: 'hidden' },
  tabLogoActive: { backgroundColor: '#FFF', shadowColor: C.teal, shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  tabIconImage: { width: 36, height: 36 },
  tabIcon: { color: C.muted, fontSize: 21, fontWeight: '900', textAlign: 'center', lineHeight: 24 },
  tabLabel: { color: C.muted, fontSize: 11, fontWeight: '800', marginTop: 3 },
  tabTextActive: { color: C.teal },
  badge: { position: 'absolute', right: -8, top: -6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: C.redAccent, color: '#FFF', fontWeight: '900', textAlign: 'center', overflow: 'hidden', fontSize: 10, lineHeight: 18 },
  modalShade: { flex: 1, backgroundColor: 'rgba(0,0,0,0.36)', justifyContent: 'center', padding: 22 },
  modalCard: { backgroundColor: C.bg, borderRadius: 22, padding: 20, gap: 12 },
  newOrderModal: { backgroundColor: C.bg, borderRadius: 24, padding: 22, gap: 12, alignItems: 'center' },
  newOrderTitle: { color: C.orange, fontSize: 18, fontWeight: '900', marginTop: 4 },
  newOrderNo: { color: C.ink, fontSize: 24, fontWeight: '900' },
  newOrderBody: { color: C.ink, fontSize: 16, fontWeight: '800' },
  newOrderHint: { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginBottom: 4 },
  moreGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  moreTile: { width: '47.8%', minHeight: 108, borderRadius: 20, backgroundColor: '#FFF', borderWidth: 1, borderColor: C.line, padding: 14, justifyContent: 'flex-start', shadowColor: C.teal, shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 1 },
  moreTileIcon: { fontSize: 22, marginBottom: 8 },
  moreTileTitle: { color: C.ink, fontSize: 15, fontWeight: '900' },
  moreTileBody: { color: C.muted, fontSize: 12, lineHeight: 16, marginTop: 4 },
  heroCard: { backgroundColor: C.tealSoft, borderRadius: 20, padding: 18, gap: 8, borderWidth: 1, borderColor: '#C8E6DF' },
  heroKicker: { color: C.teal, fontSize: 12, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase' },
  choiceCard: { backgroundColor: '#FFF', borderRadius: 16, borderWidth: 1, borderColor: C.line, padding: 16, gap: 6 },
  choiceCardOn: { borderColor: C.orange, backgroundColor: C.orangeSoft },
});
