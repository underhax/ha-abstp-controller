import type { ReactiveControllerHost } from 'lit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserAudioPlayer } from '../src/audio-player.ts';
import { AudioController } from '../src/card/controllers/audio-controller.ts';
import type { AbstpCardConfig, HomeAssistant } from '../src/types.ts';

describe('AudioController', (): void => {
  let host: ReactiveControllerHost;
  let mockConfig: AbstpCardConfig;
  let audio: AudioController;

  beforeEach((): void => {
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

  it('initializes with default speed and volume from configuration', (): void => {
    audio.initSettings();

    expect(audio.currentSpeed).toBe(1.25);
    expect(audio.browserVolume).toBe(1.0);
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

  it('sets browser volume on audio player instance', async (): Promise<void> => {
    const mockPlayer = {
      setVolume: vi.fn(),
    } as unknown as BrowserAudioPlayer;

    await audio.setVolume(0.8, '', undefined, mockPlayer);

    expect(audio.volumeLevel).toBe(0.8);
    expect(audio.browserVolume).toBe(0.8);
    expect(mockPlayer.setVolume).toHaveBeenCalledWith(0.8);
  });

  it('sets speaker volume via Home Assistant callService', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await audio.setVolume(0.5, 'media_player.kitchen_speaker', mockHass, undefined);

    expect(audio.volumeLevel).toBe(0.5);
    expect(mockHass.callService).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: 'media_player.kitchen_speaker',
      volume_level: 0.5,
    });
  });

  it('toggles mute for browser audio', async (): Promise<void> => {
    const mockPlayer = {
      setVolume: vi.fn(),
    } as unknown as BrowserAudioPlayer;

    audio.volumeLevel = 0.7;
    await audio.toggleMute('', undefined, mockPlayer);

    expect(audio.isMuted).toBe(true);
    expect(audio.browserMuted).toBe(true);
    expect(mockPlayer.setVolume).toHaveBeenCalledWith(0);

    await audio.toggleMute('', undefined, mockPlayer);

    expect(audio.isMuted).toBe(false);
    expect(audio.browserMuted).toBe(false);
    expect(mockPlayer.setVolume).toHaveBeenCalledWith(0.7);
  });

  it('toggles mute for speaker via Home Assistant service', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await audio.toggleMute('media_player.living_room_speaker', mockHass, undefined);

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

  it('synchronizes browser volume attributes to player instance', (): void => {
    const mockPlayer = {
      setVolume: vi.fn(),
    } as unknown as BrowserAudioPlayer;

    audio.browserVolume = 0.7;
    audio.syncBrowserVolume(mockPlayer);

    expect(audio.browserVolume).toBe(0.7);
    expect(audio.volumeLevel).toBe(0.7);
    expect(audio.isMuted).toBe(false);
    expect(mockPlayer.setVolume).toHaveBeenCalledWith(0.7);
  });
});
