import { NativeModules } from 'react-native';

type NativeWatch = {
  start: (token: string, refreshToken: string | null, soundEnabled: boolean) => void;
  setSound: (enabled: boolean) => void;
  silence: (orderId: number) => void;
  stop: () => void;
};

function native(): NativeWatch | null {
  return (NativeModules.ZepMedOrderWatch as NativeWatch | undefined) ?? null;
}

export function startOrderWatch(token?: string | null, refreshToken?: string | null, soundEnabled = true) {
  if (!token) return;
  native()?.start(token, refreshToken || null, soundEnabled);
}

export function setOrderWatchSound(enabled: boolean) {
  native()?.setSound(enabled);
}

export function silenceNativeOrder(orderId: number) {
  native()?.silence(orderId);
}

export function stopOrderWatch() {
  native()?.stop();
}
