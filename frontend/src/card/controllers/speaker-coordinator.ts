import type { HassEntity, HomeAssistant } from '../../types.ts';
import { playOnSpeaker, setSpeakerMute, setSpeakerVolume, stopSpeaker } from '../api.ts';
import { SPEAKER_TIMER_INTERVAL_MS } from '../constants.ts';
import { normalizeSeekPosition } from '../playback.ts';

export interface SpeakerSyncCallbacks {
  onPlaying: () => void;
  onStopped: (isOffOrUnavailable: boolean) => void;
  onVolumeUpdate: (volumeLevel?: number, isMuted?: boolean) => void;
}

export class SpeakerCoordinator {
  public timer: number | null = null;

  public startTimer(onTick: () => void): void {
    this.stopTimer();
    this.timer = window.setInterval((): void => {
      onTick();
    }, SPEAKER_TIMER_INTERVAL_MS);
  }

  public stopTimer(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  public static syncState(
    entity: HassEntity | undefined,
    callbacks: SpeakerSyncCallbacks,
    awaitingPlaybackStop: boolean,
    awaitingPlaybackStart: boolean,
  ): void {
    if (!entity) {
      return;
    }
    const mediaAttrs = entity.attributes as {
      volume_level?: number;
      is_volume_muted?: boolean;
    };
    if (
      typeof mediaAttrs.volume_level === 'number' ||
      typeof mediaAttrs.is_volume_muted === 'boolean'
    ) {
      callbacks.onVolumeUpdate(
        typeof mediaAttrs.volume_level === 'number' ? mediaAttrs.volume_level : undefined,
        typeof mediaAttrs.is_volume_muted === 'boolean' ? mediaAttrs.is_volume_muted : undefined,
      );
    }

    const state: string = entity.state;
    if (state === 'playing') {
      if (!awaitingPlaybackStop && !awaitingPlaybackStart) {
        callbacks.onPlaying();
      }
      return;
    }

    if (state === 'off' || state === 'unavailable') {
      callbacks.onStopped(true);
      return;
    }

    if (state === 'idle' || state === 'paused' || state === 'standby' || state === 'buffering') {
      callbacks.onStopped(false);
    }
  }

  public static async play(
    hass: HomeAssistant,
    playerId: string,
    itemId: string,
    episodeId: string | undefined,
    speed: number,
    position: number,
  ): Promise<void> {
    await playOnSpeaker(hass, playerId, itemId, episodeId, speed, normalizeSeekPosition(position));
  }

  public static async stop(hass: HomeAssistant, playerId: string): Promise<void> {
    await stopSpeaker(hass, playerId);
  }

  public static async setVolume(
    hass: HomeAssistant,
    playerId: string,
    volume: number,
  ): Promise<void> {
    await setSpeakerVolume(hass, playerId, volume);
  }

  public static async setMute(
    hass: HomeAssistant,
    playerId: string,
    isMuted: boolean,
  ): Promise<void> {
    await setSpeakerMute(hass, playerId, isMuted);
  }
}
