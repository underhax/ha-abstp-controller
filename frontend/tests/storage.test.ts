import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SPEED } from '../src/card/constants.ts';
import {
  getCardStorageKey,
  getCardStorageScope,
  getStorageItem,
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

  it('returns null when localStorage access throws', (): void => {
    const getSpy = vi.spyOn(storageMock, 'getItem').mockImplementation((): string | null => {
      throw new Error('blocked');
    });

    expect(getStorageItem('blocked_key')).toBeNull();

    getSpy.mockRestore();
  });

  it('stores nothing when localStorage access throws', (): void => {
    const setSpy = vi.spyOn(storageMock, 'setItem').mockImplementation((): void => {
      throw new Error('blocked');
    });

    expect(() => setStorageItem('blocked_key', 'value')).not.toThrow();

    setSpy.mockRestore();
  });

  it('handles a missing window global', (): void => {
    vi.stubGlobal('window', undefined);

    expect(getStorageItem('missing_key')).toBeNull();
    expect(() => setStorageItem('missing_key', 'value')).not.toThrow();

    vi.unstubAllGlobals();
  });
});

describe('getCardStorageScope()', (): void => {
  it('returns card_id when specified', (): void => {
    expect(getCardStorageScope({ card_id: 'card_living_room' })).toBe('card_living_room');
  });

  it('joins player_entities when array is provided', (): void => {
    expect(
      getCardStorageScope({
        player_entities: ['media_player.kitchen', 'media_player.bedroom'],
      }),
    ).toBe('media_player.kitchen_media_player.bedroom');
  });

  it('defaults to "default" when config is empty or missing', (): void => {
    expect(getCardStorageScope()).toBe('default');
    expect(getCardStorageScope({})).toBe('default');
  });
});

describe('getCardStorageKey()', (): void => {
  it('formats card storage key with scope prefix', (): void => {
    const key = getCardStorageKey('volume', { card_id: 'card_bed' });
    expect(key).toBe('abstp_card_bed_volume');
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
