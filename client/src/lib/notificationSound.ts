const SOUND_ENABLED_KEY = "tradequip.notifications.soundEnabled";

let audioContext: AudioContext | null = null;

export function isNotificationSoundEnabled(): boolean {
  try {
    const raw = localStorage.getItem(SOUND_ENABLED_KEY);
    if (raw === null) return true;
    return raw !== "0" && raw.toLowerCase() !== "false";
  } catch {
    return true;
  }
}

export function setNotificationSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(SOUND_ENABLED_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage failures.
  }
}

export function shouldPlayNotificationSound(adminSoundEnabled = true): boolean {
  if (!adminSoundEnabled) return false;
  return isNotificationSoundEnabled();
}

export function playNotificationSound(options?: { adminSoundEnabled?: boolean }) {
  if (!shouldPlayNotificationSound(options?.adminSoundEnabled ?? true)) return;
  if (typeof window === "undefined") return;

  const AudioCtor = (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtor) return;

  try {
    if (!audioContext) {
      audioContext = new AudioCtor();
    }
    const ctx = audioContext;
    if (!ctx) return;

    const now = ctx.currentTime;
    const gain = ctx.createGain();
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();

    oscA.type = "sine";
    oscA.frequency.setValueAtTime(920, now);
    oscA.frequency.exponentialRampToValueAtTime(1100, now + 0.1);

    oscB.type = "triangle";
    oscB.frequency.setValueAtTime(680, now);
    oscB.frequency.exponentialRampToValueAtTime(860, now + 0.12);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.06, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);

    oscA.connect(gain);
    oscB.connect(gain);
    gain.connect(ctx.destination);

    oscA.start(now);
    oscB.start(now);
    oscA.stop(now + 0.2);
    oscB.stop(now + 0.2);
  } catch {
    // Ignore audio playback failures.
  }
}
