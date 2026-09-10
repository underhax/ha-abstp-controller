import { afterEach, describe, expect, it, vi } from 'vitest';
import { SPEAKER_TIMER_INTERVAL_MS } from '../src/card/constants.ts';
import {
  SpeakerCoordinator,
  type SpeakerSyncCallbacks,
} from '../src/card/controllers/speaker-coordinator.ts';
import type { HassEntity, HomeAssistant } from '../src/types.ts';

const createMockHass = (): HomeAssistant =>
  ({
    callService: vi.fn().mockResolvedValue(undefined),
    callWS: vi.fn(),
    language: 'en',
    states: {},
  }) as unknown as HomeAssistant;

const createCallbacks = (): SpeakerSyncCallbacks => ({
  onPlaying: vi.fn(),
  onStopped: vi.fn(),
  onVolumeUpdate: vi.fn(),
});

describe('SpeakerCoordinator', (): void => {
  afterEach((): void => {
    vi.useRealTimers();
  });

  it('initializes without an active timer', (): void => {
    const coordinator = new SpeakerCoordinator();
    expect(coordinator.timer).toBeNull();
  });

  it('invokes the tick callback on every timer interval', (): void => {
    vi.useFakeTimers();
    const coordinator = new SpeakerCoordinator();
    const onTick = vi.fn();

    coordinator.startTimer(onTick);
    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS * 3);

    expect(onTick).toHaveBeenCalledTimes(3);
  });

  it('replaces an existing timer when starting a new one', (): void => {
    vi.useFakeTimers();
    const coordinator = new SpeakerCoordinator();
    const firstTick = vi.fn();
    const secondTick = vi.fn();

    coordinator.startTimer(firstTick);
    const firstTimer: number | null = coordinator.timer;
    coordinator.startTimer(secondTick);

    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS);

    expect(firstTick).not.toHaveBeenCalled();
    expect(secondTick).toHaveBeenCalledTimes(1);
    expect(coordinator.timer).not.toBe(firstTimer);
  });

  it('clears the active timer when stopped', (): void => {
    vi.useFakeTimers();
    const coordinator = new SpeakerCoordinator();
    coordinator.startTimer(vi.fn());

    coordinator.stopTimer();

    expect(coordinator.timer).toBeNull();
    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does nothing when stopping without an active timer', (): void => {
    const coordinator = new SpeakerCoordinator();

    coordinator.stopTimer();

    expect(coordinator.timer).toBeNull();
  });

  it('returns early when no entity is provided', (): void => {
    const callbacks = createCallbacks();

    SpeakerCoordinator.syncState(undefined, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).not.toHaveBeenCalled();
    expect(callbacks.onPlaying).not.toHaveBeenCalled();
    expect(callbacks.onStopped).not.toHaveBeenCalled();
  });

  it('reports the volume level when it is present', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: { volume_level: 0.5 },
      entity_id: 'media_player.example',
      state: 'idle',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).toHaveBeenCalledWith(0.5, undefined);
    expect(callbacks.onStopped).toHaveBeenCalledWith(false);
  });

  it('reports the muted flag when it is present', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: { is_volume_muted: true },
      entity_id: 'media_player.example',
      state: 'idle',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).toHaveBeenCalledWith(undefined, true);
    expect(callbacks.onStopped).toHaveBeenCalledWith(false);
  });

  it('skips the volume callback when both attributes are absent', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.example',
      state: 'off',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).not.toHaveBeenCalled();
    expect(callbacks.onStopped).toHaveBeenCalledWith(true);
  });

  it('reports active playback with both volume attributes', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: { is_volume_muted: false, volume_level: 0.8 },
      entity_id: 'media_player.example',
      state: 'playing',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).toHaveBeenCalledWith(0.8, false);
    expect(callbacks.onPlaying).toHaveBeenCalledTimes(1);
    expect(callbacks.onStopped).not.toHaveBeenCalled();
  });

  it('suppresses the playing callback while awaiting a playback start', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.example',
      state: 'playing',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, true);

    expect(callbacks.onPlaying).not.toHaveBeenCalled();
  });

  it('suppresses the playing callback while awaiting a playback stop', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.example',
      state: 'playing',
    };

    SpeakerCoordinator.syncState(entity, callbacks, true, false);

    expect(callbacks.onPlaying).not.toHaveBeenCalled();
  });

  it.each(['off', 'unavailable'])(
    'reports stopped playback for the %s state',
    (state: string): void => {
      const callbacks = createCallbacks();
      const entity: HassEntity = {
        attributes: {},
        entity_id: 'media_player.example',
        state,
      };

      SpeakerCoordinator.syncState(entity, callbacks, false, false);

      expect(callbacks.onStopped).toHaveBeenCalledWith(true);
      expect(callbacks.onPlaying).not.toHaveBeenCalled();
    },
  );

  it.each(['idle', 'paused', 'standby', 'buffering'])(
    'reports non-playing state for the %s state',
    (state: string): void => {
      const callbacks = createCallbacks();
      const entity: HassEntity = {
        attributes: {},
        entity_id: 'media_player.example',
        state,
      };

      SpeakerCoordinator.syncState(entity, callbacks, false, false);

      expect(callbacks.onStopped).toHaveBeenCalledWith(false);
      expect(callbacks.onPlaying).not.toHaveBeenCalled();
    },
  );

  it('does not report playback state for an unknown entity state', (): void => {
    const callbacks = createCallbacks();
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.example',
      state: 'unknown',
    };

    SpeakerCoordinator.syncState(entity, callbacks, false, false);

    expect(callbacks.onVolumeUpdate).not.toHaveBeenCalled();
    expect(callbacks.onPlaying).not.toHaveBeenCalled();
    expect(callbacks.onStopped).not.toHaveBeenCalled();
  });

  it('plays an item on the speaker with its position untouched', async (): Promise<void> => {
    const hass = createMockHass();

    await SpeakerCoordinator.play(hass, 'media_player.example', 'item_1', 'ep_1', 1.5, 120);

    expect(hass.callService).toHaveBeenCalledWith('abstp_controller', 'play', {
      current_time: 120,
      entity_id: 'media_player.example',
      episode_id: 'ep_1',
      item_id: 'item_1',
      speed: 1.5,
    });
  });

  it('plays an item on the speaker with a normalized zero position', async (): Promise<void> => {
    const hass = createMockHass();

    await SpeakerCoordinator.play(hass, 'media_player.example', 'item_1', undefined, 1.0, 0);

    expect(hass.callService).toHaveBeenCalledWith('abstp_controller', 'play', {
      current_time: 0.1,
      entity_id: 'media_player.example',
      episode_id: undefined,
      item_id: 'item_1',
      speed: 1.0,
    });
  });

  it('stops playback on the speaker', async (): Promise<void> => {
    const hass = createMockHass();

    await SpeakerCoordinator.stop(hass, 'media_player.example');

    expect(hass.callService).toHaveBeenCalledWith('abstp_controller', 'stop', {
      entity_id: 'media_player.example',
    });
  });

  it('sets the volume on the speaker', async (): Promise<void> => {
    const hass = createMockHass();

    await SpeakerCoordinator.setVolume(hass, 'media_player.example', 0.7);

    expect(hass.callService).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: 'media_player.example',
      volume_level: 0.7,
    });
  });

  it('sets the mute flag on the speaker', async (): Promise<void> => {
    const hass = createMockHass();

    await SpeakerCoordinator.setMute(hass, 'media_player.example', true);

    expect(hass.callService).toHaveBeenCalledWith('media_player', 'volume_mute', {
      entity_id: 'media_player.example',
      is_volume_muted: true,
    });
  });
});
