import type { AbstpCardConfig } from '../types.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_VOLUME_LEVEL,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
} from './constants.ts';

export interface SavedBrowserAudioSettings {
  browserMuted: boolean;
  browserVolume: number;
}

export function getStorageItem(key: string): string | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(key);
    }
  } catch {
    return null;
  }
  return null;
}

export function setStorageItem(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(key, value);
    }
  } catch {}
}

export function getCardStorageScope(config?: Partial<AbstpCardConfig>): string {
  if (config?.card_id) {
    return config.card_id;
  }
  if (config?.player_entities && config.player_entities.length > 0) {
    return config.player_entities.join('_');
  }
  return 'default';
}

export function getCardStorageKey(subKey: string, config?: Partial<AbstpCardConfig>): string {
  return `abstp_${getCardStorageScope(config)}_${subKey}`;
}

export function loadBrowserAudioSettings(
  config?: Partial<AbstpCardConfig>,
): SavedBrowserAudioSettings {
  let browserVolume: number = DEFAULT_VOLUME_LEVEL;
  let browserMuted: boolean = false;

  const savedVol: string | null = getStorageItem(getCardStorageKey('browser_volume', config));
  if (savedVol !== null) {
    const parsed: number = Number.parseFloat(savedVol);
    if (!Number.isNaN(parsed) && parsed >= 0 && parsed <= 1.0) {
      browserVolume = Math.round(parsed * 10) / 10;
    }
  }
  const savedMuted: string | null = getStorageItem(getCardStorageKey('browser_muted', config));
  if (savedMuted !== null) {
    browserMuted = savedMuted === 'true';
  }

  return { browserMuted, browserVolume };
}

export function loadSelectedSpeed(config?: Partial<AbstpCardConfig>): number {
  const savedSpeed: string | null = getStorageItem(getCardStorageKey('selected_speed', config));
  if (savedSpeed !== null) {
    const parsedSpeed: number = Number.parseFloat(savedSpeed);
    if (
      !Number.isNaN(parsedSpeed) &&
      parsedSpeed >= MIN_PLAYBACK_SPEED &&
      parsedSpeed <= MAX_PLAYBACK_SPEED
    ) {
      return parsedSpeed;
    }
  }
  if (config?.default_speed !== undefined) {
    return config.default_speed;
  }
  return DEFAULT_PLAYBACK_SPEED;
}
