import AsyncStorage from '@react-native-async-storage/async-storage';
import { NativeModules, PermissionsAndroid, Platform } from 'react-native';

const PREF_KEY = 'zepmed:seller:prefs';

type NativePrinter = {
  getPairedPrinters: () => Promise<Array<{ address: string; name: string }>>;
  printBase64: (macAddress: string, payload: string) => Promise<boolean>;
};

export type PairedPrinter = { address: string; name: string };

export type SellerPrefs = {
  sound: boolean;
  autoPrint: boolean;
  printerMac?: string | null;
  printerName?: string | null;
  printerLanguage?: string | null;
  printerPaper?: string | null;
};

function nativePrinter(): NativePrinter | null {
  return (NativeModules.ZepMedPrinter as NativePrinter | undefined) ?? null;
}

export async function readSellerPrefs(): Promise<SellerPrefs> {
  const raw = await AsyncStorage.getItem(PREF_KEY);
  const parsed = raw ? JSON.parse(raw) as Partial<SellerPrefs> : {};
  return {
    sound: parsed.sound ?? true,
    autoPrint: parsed.autoPrint ?? false,
    printerMac: parsed.printerMac || null,
    printerName: parsed.printerName || null,
    printerLanguage: parsed.printerLanguage || 'tspl',
    printerPaper: parsed.printerPaper || 'continuous',
  };
}

export async function writeSellerPrefs(next: Partial<SellerPrefs>) {
  const current = await readSellerPrefs();
  await AsyncStorage.setItem(PREF_KEY, JSON.stringify({ ...current, ...next }));
}

export async function requestBluetoothPermission() {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) < 31) return true;
  const result = await PermissionsAndroid.requestMultiple([
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
  ]);
  return result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT] === PermissionsAndroid.RESULTS.GRANTED;
}

export async function listPairedPrinters(): Promise<PairedPrinter[]> {
  const ok = await requestBluetoothPermission();
  if (!ok) throw new Error('Allow Bluetooth permission to list printers');
  const module = nativePrinter();
  if (!module) throw new Error('Bluetooth printer module is not available in this build');
  return module.getPairedPrinters();
}

function toBase64(bytes: Uint8Array) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return global.btoa(bin);
}

export async function printToBluetooth(mac: string, bytes: Uint8Array) {
  const ok = await requestBluetoothPermission();
  if (!ok) throw new Error('Allow Bluetooth permission to print');
  const module = nativePrinter();
  if (!module) throw new Error('Bluetooth printer module is not available in this build');
  await module.printBase64(mac, toBase64(bytes));
}
