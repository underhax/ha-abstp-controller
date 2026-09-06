import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
  AbstpCardConfig,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from '../../types.ts';
import { isPodcastItem, resolveInitialPosition, resolveItemIds } from '../media.ts';
import {
  calculateSkipPosition,
  calculateSpeakerProgress,
  resolvePlayPosition,
} from '../playback.ts';
import { getCardStorageKey, loadSelectedPlayer, setStorageItem } from '../storage.ts';
import type { AudioController } from './audio-controller.ts';
import { BrowserAudioEngine } from './browser-audio-engine.ts';
import { SpeakerCoordinator } from './speaker-coordinator.ts';

export interface PlaybackControllerOptions {
  audio: AudioController;
  getConfig: () => AbstpCardConfig | undefined;
  getHass: () => HomeAssistant | undefined;
  onChaptersRequired?: (itemId: string) => void;
  onClearChapters?: () => void;
}

export class PlaybackController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: PlaybackControllerOptions;
  public readonly audio: AudioController;
  public readonly engine: BrowserAudioEngine = new BrowserAudioEngine();
  public readonly speaker: SpeakerCoordinator = new SpeakerCoordinator();

  public currentItem: MediaItem | PodcastEpisode | InProgressItem | null = null;
  public isPlaying: boolean = false;
  public isBuffering: boolean = false;
  public playbackPosition: number = 0;
  public playbackDuration: number = 0;
  public selectedPlayer: string = '';
  public awaitingPlaybackStart: boolean = false;
  public awaitingPlaybackStop: boolean = false;
  public playbackStopTimeout: number | null = null;
  public speakerSawNonPlaying: boolean = false;

  public constructor(host: ReactiveControllerHost, options: PlaybackControllerOptions) {
    this.host = host;
    this.options = options;
    this.audio = options.audio;
    this.host.addController(this);
  }

  public hostConnected(): void {
    this.setupAudioListeners();
    this.initSettings();
  }

  public hostDisconnected(): void {
    this.clearPlaybackStopTimeout();
    if (this.selectedPlayer === '') {
      void this.stop();
    } else {
      this.stopSpeakerTimer();
    }
  }

  public initSettings(): void {
    this.audio.initSettings();
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    this.selectedPlayer = loadSelectedPlayer(config);
    if (this.selectedPlayer === '') {
      this.audio.syncBrowserVolume(this.engine.player);
    }
  }

  public clearPlaybackStopTimeout(): void {
    this.awaitingPlaybackStop = false;
    if (this.playbackStopTimeout !== null) {
      window.clearTimeout(this.playbackStopTimeout);
      this.playbackStopTimeout = null;
    }
  }

  public setupAudioListeners(): void {
    this.engine.setupListeners({
      onBuffering: (buffering: boolean): void => {
        if (this.selectedPlayer === '') {
          this.isBuffering = buffering;
          this.host.requestUpdate();
        }
      },
      onPlaying: (): void => {
        this.isPlaying = true;
        this.isBuffering = false;
        this.host.requestUpdate();
      },
      onStopped: (): void => {
        this.isPlaying = false;
        this.isBuffering = false;
        this.host.requestUpdate();
      },
      onTimeUpdate: (pos: number, dur?: number): void => this.handleBrowserTimeUpdate(pos, dur),
    });
  }

  public handleBrowserTimeUpdate(pos: number, dur?: number): void {
    if (this.selectedPlayer !== '' || this.engine.awaitingPlaybackStop) {
      return;
    }
    if (pos <= 0 && (this.engine.awaitingPlaybackStart || this.isBuffering)) {
      return;
    }
    if (pos > 0 && (this.engine.awaitingPlaybackStart || this.isBuffering)) {
      this.isPlaying = true;
      this.isBuffering = false;
      this.engine.awaitingPlaybackStart = false;
    }
    const { position, duration } = this.engine.calculateProgress(
      pos,
      dur ?? 0,
      this.audio.currentSpeed,
      this.playbackDuration,
    );
    this.playbackPosition = position;
    this.playbackDuration = duration;
    this.host.requestUpdate();
  }

  public startSpeakerTimer(): void {
    this.speaker.startTimer((): void => {
      if (this.isPlaying && this.selectedPlayer !== '' && this.currentItem) {
        this.playbackPosition = calculateSpeakerProgress(
          this.playbackPosition,
          this.playbackDuration,
          this.audio.currentSpeed,
        );
        this.host.requestUpdate();
      }
    });
  }

  public stopSpeakerTimer(): void {
    this.speaker.stopTimer();
  }

  private handleSpeakerPlaying(): void {
    this.isBuffering = false;
    if (!this.isPlaying) {
      this.isPlaying = true;
      if (this.currentItem) {
        this.startSpeakerTimer();
      }
      this.host.requestUpdate();
    }
  }

  private handleAwaitingPlaybackState(state: string): boolean {
    if (!this.awaitingPlaybackStart) {
      return false;
    }
    if (state !== 'playing') {
      this.speakerSawNonPlaying = true;
      this.isBuffering = true;
      this.isPlaying = false;
      this.host.requestUpdate();
      return true;
    }
    if (this.speakerSawNonPlaying) {
      this.awaitingPlaybackStart = false;
      this.handleSpeakerPlaying();
      return true;
    }
    return true;
  }

  public syncPlaybackState(state: string): void {
    if (this.awaitingPlaybackStop || this.handleAwaitingPlaybackState(state)) {
      return;
    }
    if (state === 'playing') {
      this.handleSpeakerPlaying();
      return;
    }
    if (state === 'off' || state === 'unavailable') {
      this.handleSpeakerStopped(true);
      return;
    }
    if (state === 'idle' || state === 'paused' || state === 'standby' || state === 'buffering') {
      this.handleSpeakerStopped(false);
    }
  }

  public handleSpeakerStopped(isOffOrUnavailable: boolean): void {
    this.clearPlaybackStopTimeout();
    if (isOffOrUnavailable) {
      this.isBuffering = false;
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.stopSpeakerTimer();
    }
    this.host.requestUpdate();
  }

  public syncPlayerState(): void {
    if (this.selectedPlayer === '') {
      this.audio.syncBrowserVolume(this.engine.player);
      return;
    }
    const entity = this.options.getHass()?.states[this.selectedPlayer];
    if (!entity) {
      return;
    }
    const attrs = entity.attributes as { volume_level?: number; is_volume_muted?: boolean };
    this.audio.syncSpeakerVolume(
      typeof attrs.volume_level === 'number' ? attrs.volume_level : undefined,
      typeof attrs.is_volume_muted === 'boolean' ? attrs.is_volume_muted : undefined,
    );
    this.syncPlaybackState(entity.state);
  }

  public async playItem(
    item: MediaItem | PodcastEpisode | InProgressItem,
    startTime?: number,
  ): Promise<void> {
    const hass: HomeAssistant | undefined = this.options.getHass();
    if (!hass) {
      return;
    }

    const config: AbstpCardConfig | undefined = this.options.getConfig();
    this.currentItem = item;
    setStorageItem(getCardStorageKey('last_item_id', config), item.id);
    const initialPosition: number = resolveInitialPosition(item, startTime);
    this.playbackPosition = initialPosition;
    this.playbackDuration = item.duration;

    const { itemId, episodeId } = resolveItemIds(item);
    if (isPodcastItem(item)) {
      this.options.onClearChapters?.();
    } else {
      this.options.onChaptersRequired?.(itemId);
    }

    this.clearPlaybackStopTimeout();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    this.host.requestUpdate();

    if (this.selectedPlayer === '') {
      this.stopSpeakerTimer();
      try {
        await this.engine.startSession(
          hass,
          itemId,
          episodeId,
          this.audio.currentSpeed,
          initialPosition,
          this.audio.volumeLevel,
          this.audio.isMuted,
        );
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    } else {
      await this.playOnSpeaker(hass, itemId, episodeId, initialPosition);
    }
    this.host.requestUpdate();
  }

  private async playOnSpeaker(
    hass: HomeAssistant,
    itemId: string,
    episodeId: string | undefined,
    position: number,
  ): Promise<void> {
    this.stopSpeakerTimer();
    this.speakerSawNonPlaying = false;
    try {
      await SpeakerCoordinator.play(
        hass,
        this.selectedPlayer,
        itemId,
        episodeId,
        this.audio.currentSpeed,
        position,
      );
    } catch {
      this.isPlaying = false;
      this.isBuffering = false;
      this.awaitingPlaybackStart = false;
      this.host.requestUpdate();
      return;
    }
    window.setTimeout((): void => {
      if (this.awaitingPlaybackStart) {
        this.awaitingPlaybackStart = false;
        const liveHass = this.options.getHass();
        if (this.selectedPlayer && liveHass?.states[this.selectedPlayer]?.state === 'playing') {
          this.handleSpeakerPlaying();
        }
      }
    }, 2000);
  }

  public async stop(): Promise<void> {
    this.stopSpeakerTimer();
    this.isPlaying = false;
    this.isBuffering = false;
    this.awaitingPlaybackStart = false;
    this.awaitingPlaybackStop = true;
    if (this.playbackStopTimeout !== null) {
      window.clearTimeout(this.playbackStopTimeout);
    }
    this.playbackStopTimeout = window.setTimeout((): void => {
      this.awaitingPlaybackStop = false;
      this.playbackStopTimeout = null;
    }, 5000);
    this.host.requestUpdate();

    const hass: HomeAssistant | undefined = this.options.getHass();
    if (this.selectedPlayer === '') {
      await this.engine.stopSession(hass);
    } else if (hass) {
      try {
        await SpeakerCoordinator.stop(hass, this.selectedPlayer);
      } catch {}
    }
  }

  public togglePlayPause(): void {
    if (!this.currentItem) {
      return;
    }
    if (this.isPlaying || this.isBuffering) {
      void this.stop();
    } else {
      const startPos: number = resolvePlayPosition(
        this.playbackPosition,
        this.currentItem.progress,
      );
      void this.playItem(this.currentItem, startPos);
    }
  }

  public async restartPlayback(targetPosition?: number): Promise<void> {
    const posToPlay: number = targetPosition ?? this.playbackPosition;
    this.playbackPosition = posToPlay;
    this.clearPlaybackStopTimeout();
    this.stopSpeakerTimer();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    this.host.requestUpdate();

    const hass: HomeAssistant | undefined = this.options.getHass();
    if (!hass || !this.currentItem) {
      return;
    }
    const { itemId, episodeId } = resolveItemIds(this.currentItem);
    if (this.selectedPlayer === '') {
      try {
        await this.engine.restart(
          hass,
          itemId,
          episodeId,
          this.audio.currentSpeed,
          posToPlay,
          this.audio.volumeLevel,
          this.audio.isMuted,
        );
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
        this.host.requestUpdate();
      }
    } else {
      await this.playOnSpeaker(hass, itemId, episodeId, posToPlay);
    }
    this.host.requestUpdate();
  }

  public async seek(newPosition: number): Promise<void> {
    this.playbackPosition = newPosition;
    if (this.currentItem) {
      if ('current_time' in this.currentItem) {
        this.currentItem.current_time = newPosition;
      }
      this.currentItem.progress = newPosition;
      if (this.playbackDuration <= 0 && this.currentItem.duration > 0) {
        this.playbackDuration = this.currentItem.duration;
      }
      if (this.isPlaying || this.isBuffering) {
        await this.restartPlayback(newPosition);
      } else {
        await this.playItem(this.currentItem, newPosition);
      }
    }
    this.host.requestUpdate();
  }

  public async skip(seconds: number): Promise<void> {
    await this.seek(calculateSkipPosition(this.playbackPosition, this.playbackDuration, seconds));
  }

  public async selectItem(item: MediaItem | PodcastEpisode | InProgressItem): Promise<void> {
    if (this.isPlaying || this.isBuffering) {
      await this.stop();
    }
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    this.currentItem = item;
    setStorageItem(getCardStorageKey('last_item_id', config), item.id);
    this.playbackPosition = resolveInitialPosition(item);
    this.playbackDuration = item.duration || 0;
    this.isPlaying = false;
    this.isBuffering = false;

    if (isPodcastItem(item)) {
      this.options.onClearChapters?.();
    } else {
      const { itemId } = resolveItemIds(item);
      this.options.onChaptersRequired?.(itemId);
    }
    this.host.requestUpdate();
  }

  public async applySpeedIfChanged(speedOnOpen: number): Promise<void> {
    if (
      this.audio.currentSpeed !== speedOnOpen &&
      this.currentItem &&
      (this.isPlaying || this.isBuffering)
    ) {
      await this.restartPlayback(this.playbackPosition);
    }
  }

  public async selectPlayer(playerId: string): Promise<void> {
    if (this.selectedPlayer === playerId) {
      return;
    }
    const wasPlaying: boolean = this.isPlaying || this.isBuffering;
    const currentPos: number = Math.max(0, this.playbackPosition);
    const itemToResume: MediaItem | PodcastEpisode | InProgressItem | null = this.currentItem;

    if (wasPlaying) {
      await this.stop();
    }

    this.selectedPlayer = playerId;
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    setStorageItem(getCardStorageKey('selected_player', config), playerId);
    this.syncPlayerState();

    if (wasPlaying && itemToResume) {
      await this.playItem(itemToResume, currentPos);
    }
    this.host.requestUpdate();
  }

  public restoreItem(
    item: MediaItem | InProgressItem,
    position: number,
    duration: number,
    isPlaying: boolean,
    speed?: number,
  ): void {
    this.currentItem = item;
    if (speed !== undefined) {
      this.audio.currentSpeed = speed;
    }
    this.playbackPosition = position;
    this.playbackDuration = duration;
    if (isPlaying || this.isPlaying) {
      this.isPlaying = true;
      if (this.selectedPlayer !== '') {
        this.startSpeakerTimer();
      }
    }
    this.host.requestUpdate();
  }

  public setPlaybackPosition(pos: number): void {
    this.playbackPosition = pos;
    this.host.requestUpdate();
  }
}
