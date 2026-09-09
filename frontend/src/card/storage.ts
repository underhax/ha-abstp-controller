import type { AbstpCardConfig } from '../types.ts';
import { DEFAULT_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from './constants.ts';

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
