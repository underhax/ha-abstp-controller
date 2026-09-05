import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PLAYBACK_SPEED, DEFAULT_VOLUME_LEVEL } from '../src/card/constants.ts';
import {
  getCardStorageKey,
  getCardStorageScope,
  getItemPositionStorageKey,
  getStorageItem,
  loadBrowserAudioSettings,
  loadSelectedPlayer,
  loadSelectedSpeed,
  setStorageItem,
} from '../src/card/storage.ts';

interface StorageMock {
  clear: () => void;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const storageMock: StorageMock = ((): StorageMock => {
  let store: Record<string, string> = {};
  return {
    clear: (): void => {
      store = {};
    },
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: storageMock,
  writable: true,
});

describe('getStorageItem() and setStorageItem()', (): void => {
  beforeEach((): void => {
    storageMock.clear();
  });

  it('stores and retrieves items from localStorage', (): void => {
    setStorageItem('test_key', 'test_val');
    expect(getStorageItem('test_key')).toBe('test_val');
  });

  it('returns null for missing keys', (): void => {
    expect(getStorageItem('non_existent')).toBeNull();
  });
});

describe('getCardStorageScope()', (): void => {
  it('returns player_entity when specified', (): void => {
    expect(getCardStorageScope({ player_entity: 'media_player.living_room' })).toBe(
      'media_player.living_room',
    );
  });

  it('joins player_entities when array is provided', (): void => {
    expect(
      getCardStorageScope({
        player_entities: ['media_player.kitchen', 'media_player.bedroom'],
      }),
    ).toBe('media_player.kitchen_media_player.bedroom');
  });

  it('uses sanitized lowercase title when entities are omitted', (): void => {
    expect(getCardStorageScope({ title: 'My Custom Card' })).toBe('my_custom_card');
  });

  it('defaults to "default" when config is empty or missing', (): void => {
    expect(getCardStorageScope()).toBe('default');
    expect(getCardStorageScope({})).toBe('default');
  });
});

describe('getCardStorageKey() and getItemPositionStorageKey()', (): void => {
  it('formats card storage key with scope prefix', (): void => {
    const key = getCardStorageKey('volume', { player_entity: 'media_player.bed' });
    expect(key).toBe('abstp_media_player.bed_volume');
  });

  it('formats item position storage key', (): void => {
    expect(getItemPositionStorageKey('item_123')).toBe('abstp_pos_item_123');
  });
});

describe('loadBrowserAudioSettings()', (): void => {
  beforeEach((): void => {
    storageMock.clear();
  });

  it('loads default values when nothing is stored', (): void => {
    const settings = loadBrowserAudioSettings();
    expect(settings.browserVolume).toBe(DEFAULT_VOLUME_LEVEL);
    expect(settings.browserMuted).toBe(false);
  });

  it('loads and parses stored volume and muted status', (): void => {
    setStorageItem('abstp_default_browser_volume', '0.7');
    setStorageItem('abstp_default_browser_muted', 'true');

    const settings = loadBrowserAudioSettings();
    expect(settings.browserVolume).toBe(0.7);
    expect(settings.browserMuted).toBe(true);
  });

  it('ignores invalid volume numbers and keeps default', (): void => {
    setStorageItem('abstp_default_browser_volume', 'invalid');
    const settings = loadBrowserAudioSettings();
    expect(settings.browserVolume).toBe(DEFAULT_VOLUME_LEVEL);
  });
});

describe('loadSelectedPlayer()', (): void => {
  beforeEach((): void => {
    storageMock.clear();
  });

  it('returns stored player if valid and allowed', (): void => {
    setStorageItem('abstp_default_selected_player', 'media_player.kitchen');
    const player = loadSelectedPlayer({
      player_entities: ['media_player.kitchen', 'media_player.bedroom'],
    });
    expect(player).toBe('media_player.kitchen');
  });

  it('falls back to player_entity when stored player is not present', (): void => {
    const player = loadSelectedPlayer({ player_entity: 'media_player.living_room' });
    expect(player).toBe('media_player.living_room');
  });

  it('falls back to first allowed entity', (): void => {
    const player = loadSelectedPlayer({
      player_entities: ['media_player.first', 'media_player.second'],
    });
    expect(player).toBe('media_player.first');
  });

  it('returns empty string when browser playback is default option', (): void => {
    const player = loadSelectedPlayer();
    expect(player).toBe('');
  });
});

describe('loadSelectedSpeed()', (): void => {
  beforeEach((): void => {
    storageMock.clear();
  });

  it('loads valid speed from storage', (): void => {
    setStorageItem('abstp_default_selected_speed', '1.25');
    expect(loadSelectedSpeed()).toBe(1.25);
  });

  it('falls back to default_speed from config when not stored', (): void => {
    expect(loadSelectedSpeed({ default_speed: 1.75 })).toBe(1.75);
  });

  it('falls back to constant default when out of bounds or missing', (): void => {
    setStorageItem('abstp_default_selected_speed', '50.0');
    expect(loadSelectedSpeed()).toBe(DEFAULT_PLAYBACK_SPEED);
  });
});
