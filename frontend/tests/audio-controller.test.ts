import type { ReactiveControllerHost } from 'lit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLAYBACK_SPEED } from '../src/card/constants.ts';
import { AudioController } from '../src/card/controllers/audio-controller.ts';
import type { AbstpCardConfig, HomeAssistant } from '../src/types.ts';

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

describe('AudioController', (): void => {
  let host: ReactiveControllerHost;
  let mockConfig: AbstpCardConfig;
  let audio: AudioController;

  beforeEach((): void => {
    storageMock.clear();
    host = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    mockConfig = {
      default_speed: 1.25,
      type: 'custom:abstp-player-card',
    };
    audio = new AudioController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
    });
  });

  it('initializes with default speed from configuration', (): void => {
    audio.initSettings();

    expect(audio.currentSpeed).toBe(1.25);
  });

  it('adjusts speed within boundaries', (): void => {
    audio.adjustSpeed(1.5);

    expect(audio.currentSpeed).toBe(1.5);
    expect(host.requestUpdate).toHaveBeenCalled();

    audio.adjustSpeed(5.0);
    expect(audio.currentSpeed).toBe(3.0);
  });

  it('starts and stops speed hold timer interval correctly', (): void => {
    vi.useFakeTimers();

    audio.currentSpeed = 1.0;
    audio.startSpeedHold(0.1);

    expect(audio.currentSpeed).toBe(1.1);

    vi.advanceTimersByTime(300);
    expect(audio.currentSpeed).toBe(1.1);

    vi.advanceTimersByTime(150);
    expect(audio.currentSpeed).toBe(1.2);

    audio.stopSpeedHold();
    vi.advanceTimersByTime(300);
    expect(audio.currentSpeed).toBe(1.2);

    vi.useRealTimers();
  });

  it('sets speaker volume via Home Assistant callService', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await audio.setVolume(0.5, 'media_player.kitchen_speaker', mockHass);

    expect(audio.volumeLevel).toBe(0.5);
    expect(mockHass.callService).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: 'media_player.kitchen_speaker',
      volume_level: 0.5,
    });
  });

  it('toggles mute for speaker via Home Assistant service', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await audio.toggleMute('media_player.living_room_speaker', mockHass);

    expect(audio.isMuted).toBe(true);
    expect(mockHass.callService).toHaveBeenCalledWith('media_player', 'volume_mute', {
      entity_id: 'media_player.living_room_speaker',
      is_volume_muted: true,
    });
  });

  it('synchronizes speaker volume and mute attributes', (): void => {
    audio.syncSpeakerVolume(0.35, true);

    expect(audio.volumeLevel).toBe(0.35);
    expect(audio.isMuted).toBe(true);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('synchronizes playback speed from virtual player attributes', (): void => {
    audio.syncPlaybackSpeed(1.75);

    expect(audio.currentSpeed).toBe(1.75);
  });

  it('persists selected speed to localStorage', (): void => {
    audio.currentSpeed = 1.6;
    audio.persistSelectedSpeed();

    expect(storageMock.getItem('abstp_default_selected_speed')).toBe('1.6');
  });

  it('synchronizes speaker speed from attribute with fallback', (): void => {
    audio.syncSpeakerSpeed(1.8);
    expect(audio.currentSpeed).toBe(1.8);

    audio.syncSpeakerSpeed(undefined);
    expect(audio.currentSpeed).toBe(1.25);
  });

  it('marks speed dirty preventing syncPlaybackSpeed overwrite', (): void => {
    audio.markSpeedDirty();
    audio.currentSpeed = 1.5;
    audio.syncPlaybackSpeed(1.0);

    expect(audio.currentSpeed).toBe(1.5);
  });

  it('initializes settings when connected', (): void => {
    audio.hostConnected();

    expect(audio.currentSpeed).toBe(1.25);
  });

  it('clears speed hold timers when disconnected', (): void => {
    audio.speedHoldTimer = 1;
    audio.speedHoldInterval = 2;

    audio.hostDisconnected();

    expect(audio.speedHoldTimer).toBeNull();
    expect(audio.speedHoldInterval).toBeNull();
  });

  it('resets playback speed to the configured default', (): void => {
    audio.currentSpeed = 1.9;
    audio.markSpeedDirty();

    audio.resetPlaybackSpeed();

    expect(audio.currentSpeed).toBe(1.25);
    audio.syncPlaybackSpeed(2.0);
    expect(audio.currentSpeed).toBe(2.0);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('resets playback speed to the constant default without config', (): void => {
    const plainAudio = new AudioController(host, {
      getConfig: (): AbstpCardConfig => ({ type: 'custom:abstp-player-card' }),
    });
    plainAudio.currentSpeed = 2.5;

    plainAudio.resetPlaybackSpeed();

    expect(plainAudio.currentSpeed).toBe(DEFAULT_PLAYBACK_SPEED);
  });

  it('updates volume without a speaker service call', async (): Promise<void> => {
    await audio.setVolume(0.4, '', undefined);

    expect(audio.volumeLevel).toBe(0.4);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('toggles mute without a speaker service call', async (): Promise<void> => {
    await audio.toggleMute('', undefined);

    expect(audio.isMuted).toBe(true);
    expect(host.requestUpdate).toHaveBeenCalled();
  });
});
