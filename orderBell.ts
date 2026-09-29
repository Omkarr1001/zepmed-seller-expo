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

export async function startOrderBell(vibrate = true) {
  if (AppState.currentState !== 'active') return;
  if (ringing) return;
  const mine = generation + 1;
  generation = mine;
  ringing = true;
  try {
    await prepareOrderBell();
    if (generation !== mine) return;
    if (vibrate) Vibration.vibrate([0, 400, 150, 400, 150, 500], true);
    const created = await Audio.Sound.createAsync(require('./assets/bell.mp3'), {
      shouldPlay: true,
      isLooping: true,
      volume: 1,
    });
    if (generation !== mine) {
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
}

export function isOrderBellRinging() {
  return ringing;
}

export function shouldRingInApp() {
  return AppState.currentState === 'active';
}
