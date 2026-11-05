import { Audio } from 'expo-av';
import { AppState, Vibration } from 'react-native';

let sound: Audio.Sound | null = null;
let ringing = false;
let generation = 0;

export async function prepareOrderBell() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
  });
}

/**
 * Start looping bell + vibration for a new order.
 * Safe to call from SellerShell poll while seller is on any tab.
 */
export async function startOrderBell(vibrate = true) {
  if (AppState.currentState !== 'active') {
    // Screen off / background: one vibrate pulse, never the looping bell.
    if (vibrate) {
      Vibration.cancel();
      Vibration.vibrate([0, 400, 150, 400, 150, 500], false);
    }
    return;
  }
  if (ringing) {
    // Do not restart the repeating vibrate pattern. Re-calling vibrate() here
    // is what made Silence feel like it failed a few seconds later.
    return;
  }
  const mine = generation + 1;
  generation = mine;
  ringing = true;
  try {
    // Vibrate immediately so seller feels the alert before audio finishes loading.
    if (vibrate) Vibration.vibrate([0, 400, 150, 400, 150, 500], true);
    await prepareOrderBell();
    if (generation !== mine) {
      Vibration.cancel();
      return;
    }
    const created = await Audio.Sound.createAsync(require('./assets/bell.mp3'), {
      shouldPlay: true,
      isLooping: true,
      volume: 1,
    });
    if (generation !== mine) {
      Vibration.cancel();
      await created.sound.unloadAsync().catch(() => undefined);
      return;
    }
    sound = created.sound;
    await sound.playAsync();
  } catch {
    if (generation === mine) ringing = false;
  }
}

export async function stopOrderBell() {
  generation += 1;
  ringing = false;
  Vibration.cancel();
  Vibration.cancel();
  if (sound) {
    const current = sound;
    sound = null;
    try {
      await current.stopAsync();
      await current.unloadAsync();
    } catch {
      // already released
    }
  }
  Vibration.cancel();
}

export function isOrderBellRinging() {
  return ringing;
}

export function shouldRingInApp() {
  return AppState.currentState === 'active';
}
