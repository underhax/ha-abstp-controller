import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import { BrowserAudioPlayer } from './audio-player.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SKIP_SECONDS,
  DEFAULT_VOLUME_LEVEL,
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  PLAYBACK_SPEED_STEP,
  SPEAKER_TIMER_INTERVAL_MS,
  SPEED_HOLD_DELAY_MS,
  SPEED_HOLD_INTERVAL_MS,
  SPEED_PRESETS,
} from './card-constants.ts';
import {
  audiobookshelfIcon,
  browserIcon,
  chevronDownIcon,
  libraryIcon,
  minusIcon,
  playIcon,
  plusIcon,
  redoIcon,
  soundMuteIcon,
  soundOnIcon,
  speakerIcon,
  stopIcon,
  undoIcon,
  waitIcon,
} from './icons.ts';
import { localize } from './localize.ts';
import { cardStyles } from './styles.ts';
import type {
  AbstpCardConfig,
  ActiveSessionInfo,
  HassEntity,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PlaySession,
  PodcastEpisode,
} from './types.ts';
import './abstp-player-card-editor.ts';

@customElement('abstp-player-card')
export class AbstpPlayerCard extends LitElement {
  public static override styles: CSSResult = cardStyles;

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config?: AbstpCardConfig;
  @state() private activeTab: 'in_progress' | 'books' | 'podcasts' = 'in_progress';
  @state() private showLibrary: boolean = false;
  @state() private showSpeedPopover: boolean = false;
  @state() private showVolumePopover: boolean = false;
  @state() private showDeviceMenu: boolean = false;
  @state() private books: MediaItem[] = [];
  @state() private podcasts: MediaItem[] = [];
  @state() private inProgress: InProgressItem[] = [];
  @state() private episodes: Record<string, PodcastEpisode[]> = {};
  @state() private selectedPodcastId: string | null = null;
  @state() private searchQuery: string = '';
  @state() private filterProgress: 'all' | 'in_progress' | 'finished' = 'all';
  @state() private currentSession: PlaySession | null = null;
  @state() private currentItem: MediaItem | PodcastEpisode | InProgressItem | null = null;
  @state() private selectedPlayer: string = '';
  @state() private currentSpeed: number = DEFAULT_PLAYBACK_SPEED;
  @state() private speedOnOpen: number = DEFAULT_PLAYBACK_SPEED;
  @state() private volumeLevel: number = DEFAULT_VOLUME_LEVEL;
  @state() private isMuted: boolean = false;
  @state() private isPlaying: boolean = false;
  @state() private isBuffering: boolean = false;
  @state() private isRefreshing: boolean = false;
  @state() private playbackPosition: number = 0;
  @state() private playbackDuration: number = 0;
  @state() private browserStreamStartPos: number = 0;

  private browserPlayer: BrowserAudioPlayer = new BrowserAudioPlayer();
  private libraryLoaded: boolean = false;
  private userSelectedTab: boolean = false;
  private speakerTimer: number | null = null;
  private awaitingPlaybackStart: boolean = false;
  private speedHoldTimer: number | null = null;
  private speedHoldInterval: number | null = null;

  private readonly _cardSize: number = 5;

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('abstp-player-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return {
      default_speed: DEFAULT_PLAYBACK_SPEED,
      skip_seconds: DEFAULT_SKIP_SECONDS,
      type: 'custom:abstp-player-card',
    };
  }

  public getCardSize(): number {
    return this._cardSize;
  }

  private static getStorageItem(key: string): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key);
      }
    } catch {
      return null;
    }
    return null;
  }

  private static setStorageItem(key: string, value: string): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value);
      }
    } catch {}
  }

  private getCardStorageScope(): string {
    if (this.config?.player_entity) {
      return this.config.player_entity;
    }
    if (this.config?.player_entities && this.config.player_entities.length > 0) {
      return this.config.player_entities.join('_');
    }
    if (this.config?.title) {
      return this.config.title.replace(/\s+/gu, '_').toLowerCase();
    }
    return 'default';
  }

  private getCardStorageKey(subKey: string): string {
    return `abstp_${this.getCardStorageScope()}_${subKey}`;
  }

  private initSelectedPlayer(): void {
    const allowed: string[] | undefined = this.config?.player_entities;
    const savedPlayer: string | null = AbstpPlayerCard.getStorageItem(
      this.getCardStorageKey('selected_player'),
    );
    const allowBrowser: boolean = allowed === undefined || allowed.includes('');
    const isValidPlayer = (p: string): boolean =>
      p === '' ? allowBrowser : allowed === undefined || allowed.includes(p);

    if (savedPlayer !== null && isValidPlayer(savedPlayer)) {
      this.selectedPlayer = savedPlayer;
      return;
    }

    if (this.config?.player_entity !== undefined && isValidPlayer(this.config.player_entity)) {
      this.selectedPlayer = this.config.player_entity;
      return;
    }

    if (allowed && allowed.length > 0) {
      this.selectedPlayer = allowed[0] ?? '';
      return;
    }

    this.selectedPlayer = '';
  }

  private initSelectedSpeed(): void {
    const savedSpeed: string | null = AbstpPlayerCard.getStorageItem(
      this.getCardStorageKey('selected_speed'),
    );
    if (savedSpeed !== null) {
      const parsedSpeed: number = Number.parseFloat(savedSpeed);
      if (
        !Number.isNaN(parsedSpeed) &&
        parsedSpeed >= MIN_PLAYBACK_SPEED &&
        parsedSpeed <= MAX_PLAYBACK_SPEED
      ) {
        this.currentSpeed = parsedSpeed;
        return;
      }
    }
    if (this.config?.default_speed !== undefined) {
      this.currentSpeed = this.config.default_speed;
    }
  }

  public setConfig(config: AbstpCardConfig): void {
    this.config = config;
    this.initSelectedPlayer();
    this.initSelectedSpeed();
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleGlobalKeydown);
    window.addEventListener('pointerdown', this.handleGlobalPointerDown);
    window.addEventListener('pagehide', this.handlePageHide);
    this.setupAudioListeners();
    this.initSelectedPlayer();
    this.initSelectedSpeed();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('keydown', this.handleGlobalKeydown);
    window.removeEventListener('pointerdown', this.handleGlobalPointerDown);
    window.removeEventListener('pagehide', this.handlePageHide);
    this.stopSpeedHold();
    if (this.selectedPlayer === '') {
      void this.handleStop();
    } else {
      this.stopSpeakerTimer();
    }
  }

  private handlePageHide = (): void => {
    if (this.selectedPlayer === '') {
      void this.handleStop();
    }
  };

  private handleGlobalKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      void this.closeAllPopovers();
    }
  };

  private handleGlobalPointerDown = (e: PointerEvent): void => {
    const path: EventTarget[] = e.composedPath();

    if (this.showSpeedPopover) {
      const insideSpeed: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('speed-popover') || el.classList.contains('ctrl-btn-speed')),
      );
      if (!insideSpeed) {
        void this.closeSpeedPopover();
      }
    }

    if (this.showVolumePopover) {
      const insideVolume: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('volume-popover') || el.classList.contains('ctrl-btn-volume')),
      );
      if (!insideVolume) {
        this.showVolumePopover = false;
      }
    }

    if (this.showDeviceMenu) {
      const insideDevice: boolean = path.some(
        (el: EventTarget): boolean =>
          el instanceof HTMLElement &&
          (el.classList.contains('device-menu-popover') || el.classList.contains('device-badge')),
      );
      if (!insideDevice) {
        this.showDeviceMenu = false;
      }
    }
  };

  private async closeAllPopovers(): Promise<void> {
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
    await this.closeSpeedPopover();
  }

  protected override updated(changedProps: Map<string | number | symbol, unknown>): void {
    super.updated(changedProps);
    if (!changedProps.has('hass') || !this.hass) {
      return;
    }
    if (!this.libraryLoaded) {
      this.libraryLoaded = true;
      void this.fetchLibrary();
    } else {
      this.syncPlayerState();
    }
  }

  private startSpeakerTimer(): void {
    this.stopSpeakerTimer();
    this.speakerTimer = window.setInterval((): void => {
      if (this.isPlaying && this.selectedPlayer !== '') {
        const step: number = this.currentSpeed > 0 ? this.currentSpeed : DEFAULT_PLAYBACK_SPEED;
        this.playbackPosition = Math.min(this.playbackDuration, this.playbackPosition + step);
        if (this.currentItem) {
          AbstpPlayerCard.setStorageItem(
            `abstp_pos_${this.currentItem.id}`,
            String(this.playbackPosition),
          );
        }
      }
    }, SPEAKER_TIMER_INTERVAL_MS);
  }

  private stopSpeakerTimer(): void {
    if (this.speakerTimer !== null) {
      clearInterval(this.speakerTimer);
      this.speakerTimer = null;
    }
  }

  private syncVolumeAttributes(attributes: Record<string, unknown>): void {
    const mediaAttrs = attributes as {
      volume_level?: number;
      is_volume_muted?: boolean;
    };
    if (typeof mediaAttrs.volume_level === 'number') {
      this.volumeLevel = mediaAttrs.volume_level;
    }
    if (typeof mediaAttrs.is_volume_muted === 'boolean') {
      this.isMuted = mediaAttrs.is_volume_muted;
    }
  }

  private syncPlaybackState(state: string): void {
    if (state === 'playing') {
      if (!this.awaitingPlaybackStart) {
        this.isBuffering = false;
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.startSpeakerTimer();
        }
      }
      return;
    }

    if (state === 'off' || state === 'unavailable') {
      this.awaitingPlaybackStart = false;
      this.isBuffering = false;
      if (this.isPlaying) {
        this.isPlaying = false;
        this.stopSpeakerTimer();
      }
      return;
    }

    if (state === 'idle' || state === 'paused' || state === 'standby' || state === 'buffering') {
      if (this.isPlaying) {
        this.isPlaying = false;
        this.stopSpeakerTimer();
      }
    }
  }

  private syncPlayerState(): void {
    if (!this.selectedPlayer || !this.hass) {
      return;
    }
    const entity: HassEntity | undefined = this.hass.states[this.selectedPlayer];
    if (!entity) {
      return;
    }
    this.syncVolumeAttributes(entity.attributes);
    this.syncPlaybackState(entity.state);
  }

  private setupAudioListeners(): void {
    this.browserPlayer.onState((playing: boolean): void => {
      this.isPlaying = playing;
      if (playing) {
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    });

    this.browserPlayer.onBuffering((buffering: boolean): void => {
      if (this.selectedPlayer === '') {
        this.isBuffering = buffering;
      }
    });

    this.browserPlayer.onTime((pos: number, dur: number): void => {
      this.handleBrowserTimeUpdate(pos, dur);
    });

    this.browserPlayer.onError((): void => {
      this.isPlaying = false;
      this.isBuffering = false;
      this.awaitingPlaybackStart = false;
    });
  }

  private handleBrowserTimeUpdate(pos: number, dur: number): void {
    if (this.selectedPlayer !== '') {
      return;
    }
    if (pos > 0) {
      if (!this.isPlaying) {
        this.isPlaying = true;
      }
      if (this.isBuffering) {
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    }
    const effectiveSpeed: number =
      this.currentSpeed > 0 ? this.currentSpeed : DEFAULT_PLAYBACK_SPEED;
    const calculatedPos: number = this.browserStreamStartPos + pos * effectiveSpeed;
    this.playbackPosition = Math.min(
      this.playbackDuration > 0 ? this.playbackDuration : calculatedPos,
      calculatedPos,
    );
    if (Number.isFinite(dur) && dur > 0 && this.playbackDuration <= 0) {
      this.playbackDuration = dur;
    }
    if (this.currentItem) {
      AbstpPlayerCard.setStorageItem(
        `abstp_pos_${this.currentItem.id}`,
        String(this.playbackPosition),
      );
    }
  }

  private resolveActiveSession(
    activeSessions: Record<string, ActiveSessionInfo>,
  ): ActiveSessionInfo | undefined {
    if (this.selectedPlayer && activeSessions[this.selectedPlayer]) {
      return activeSessions[this.selectedPlayer];
    }
    const allowedPlayers: string[] | undefined = this.config?.player_entities;
    if (allowedPlayers && allowedPlayers.length > 0) {
      const match: string | undefined = allowedPlayers.find((id: string): boolean =>
        Boolean(activeSessions[id]),
      );
      if (match) {
        this.selectedPlayer = match;
        return activeSessions[match];
      }
      return undefined;
    }
    if (this.config?.player_entity) {
      return undefined;
    }
    const activeEntityIds: string[] = Object.keys(activeSessions);
    if (activeEntityIds.length > 0) {
      const firstActiveId: string | undefined = activeEntityIds[0];
      if (firstActiveId !== undefined && activeSessions[firstActiveId]) {
        this.selectedPlayer = firstActiveId;
        return activeSessions[firstActiveId];
      }
    }
    return undefined;
  }

  private findSavedItem(itemId: string): MediaItem | InProgressItem | undefined {
    return (
      this.inProgress.find((i: InProgressItem): boolean => i.id === itemId) ||
      this.books.find((b: MediaItem): boolean => b.id === itemId) ||
      this.podcasts.find((p: MediaItem): boolean => p.id === itemId)
    );
  }

  private restoreActiveOrSavedItem(activeSessions: Record<string, ActiveSessionInfo>): void {
    if (this.restoreFromActiveSession(activeSessions)) {
      return;
    }
    this.restoreFromSavedOrDefault();
  }

  private restoreFromActiveSession(activeSessions: Record<string, ActiveSessionInfo>): boolean {
    const activeSession: ActiveSessionInfo | undefined = this.resolveActiveSession(activeSessions);
    if (!activeSession) {
      return false;
    }
    const matchedItem: MediaItem | InProgressItem | undefined = this.findSavedItem(
      activeSession.item_id,
    );
    if (!matchedItem) {
      return false;
    }
    this.currentItem = matchedItem;
    this.currentSpeed = activeSession.speed;
    this.playbackPosition = activeSession.current_time;
    this.playbackDuration = matchedItem.duration;
    this.isPlaying = true;
    AbstpPlayerCard.setStorageItem(this.getCardStorageKey('last_item_id'), matchedItem.id);
    AbstpPlayerCard.setStorageItem(
      `abstp_pos_${matchedItem.id}`,
      String(activeSession.current_time),
    );
    return true;
  }

  private restoreFromSavedOrDefault(): void {
    const lastItemId: string | null = AbstpPlayerCard.getStorageItem(
      this.getCardStorageKey('last_item_id'),
    );
    const savedItem: MediaItem | InProgressItem | undefined = lastItemId
      ? this.findSavedItem(lastItemId)
      : undefined;
    const targetItem: MediaItem | InProgressItem | undefined =
      savedItem ?? this.inProgress[0] ?? this.books[0];
    if (!targetItem) {
      return;
    }
    this.currentItem = targetItem;
    const savedPos: string | null = AbstpPlayerCard.getStorageItem(`abstp_pos_${targetItem.id}`);
    if (!this.isPlaying) {
      this.playbackPosition =
        savedPos !== null ? Number.parseFloat(savedPos) : targetItem.progress || 0;
      this.playbackDuration = targetItem.duration || 0;
    }
  }

  private async fetchLibrary(): Promise<void> {
    if (!this.hass) {
      return;
    }
    this.isRefreshing = true;
    try {
      const response = await this.hass.callWS<{
        active_sessions?: Record<string, ActiveSessionInfo>;
        books: MediaItem[];
        in_progress?: InProgressItem[];
        podcasts: MediaItem[];
      }>({
        type: 'abstp_controller/get_library',
      });
      this.books = response.books;
      this.podcasts = response.podcasts;
      this.inProgress = response.in_progress ?? [];
      if (!this.userSelectedTab) {
        if (this.inProgress.length > 0) {
          this.activeTab = 'in_progress';
        } else if (!this.config?.hide_books) {
          this.activeTab = 'books';
        } else if (!this.config?.hide_podcasts) {
          this.activeTab = 'podcasts';
        }
      }
      this.restoreActiveOrSavedItem(response.active_sessions || {});
    } catch {
      this.books = [];
      this.podcasts = [];
      this.inProgress = [];
    } finally {
      this.isRefreshing = false;
    }
  }

  private async fetchEpisodes(podcastId: string): Promise<void> {
    if (!this.hass) {
      return;
    }
    this.selectedPodcastId = podcastId;
    this.isRefreshing = true;
    try {
      const response = await this.hass.callWS<{
        episodes: PodcastEpisode[];
      }>({
        podcast_id: podcastId,
        type: 'abstp_controller/get_episodes',
      });
      const podcast: MediaItem | undefined = this.podcasts.find(
        (p: MediaItem): boolean => p.id === podcastId,
      );
      const podcastTitle: string = podcast ? podcast.title : '';
      const mappedEpisodes: PodcastEpisode[] = (response.episodes ?? []).map(
        (ep: PodcastEpisode): PodcastEpisode => ({
          ...ep,
          podcast_id: podcastId,
          podcast_title: podcastTitle,
        }),
      );
      this.episodes = {
        ...this.episodes,
        [podcastId]: mappedEpisodes,
      };
    } catch {
      this.episodes = {
        ...this.episodes,
        [podcastId]: [],
      };
    } finally {
      this.isRefreshing = false;
    }
  }

  private static resolveItemIds(item: MediaItem | PodcastEpisode | InProgressItem): {
    episodeId?: string | undefined;
    itemId: string;
  } {
    if ('podcast_id' in item && item.podcast_id) {
      return { episodeId: item.id, itemId: item.podcast_id };
    }
    if ('episode_id' in item && item.episode_id) {
      return { episodeId: item.episode_id, itemId: item.id };
    }
    return { itemId: item.id };
  }

  private static resolveInitialPosition(
    item: MediaItem | PodcastEpisode | InProgressItem,
    startTime?: number,
  ): number {
    if (startTime !== undefined && Number.isFinite(startTime) && startTime >= 0) {
      return startTime;
    }
    if ('current_time' in item && typeof item.current_time === 'number' && item.current_time > 0) {
      return item.current_time;
    }
    const savedPos: string | null = AbstpPlayerCard.getStorageItem(`abstp_pos_${item.id}`);
    if (savedPos !== null) {
      const parsed: number = Number.parseFloat(savedPos);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return Math.max(0, item.progress || 0);
  }

  private async handlePlayItem(
    item: MediaItem | PodcastEpisode | InProgressItem,
    startTime?: number,
  ): Promise<void> {
    if (!this.hass) {
      return;
    }

    this.currentItem = item;
    AbstpPlayerCard.setStorageItem(this.getCardStorageKey('last_item_id'), item.id);
    const initialPosition: number = AbstpPlayerCard.resolveInitialPosition(item, startTime);
    this.browserStreamStartPos = initialPosition;
    this.playbackPosition = initialPosition;
    AbstpPlayerCard.setStorageItem(`abstp_pos_${item.id}`, String(initialPosition));
    this.playbackDuration = item.duration;
    const { itemId, episodeId } = AbstpPlayerCard.resolveItemIds(item);

    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    if (this.selectedPlayer === '') {
      this.stopSpeakerTimer();
      try {
        const session: PlaySession = await this.hass.callWS<PlaySession>({
          current_time: initialPosition,
          episode_id: episodeId,
          item_id: itemId,
          speed: this.currentSpeed,
          type: 'abstp_controller/start_session',
        });
        this.currentSession = session;
        this.browserPlayer.playStream(session.stream_url);
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    } else {
      this.stopSpeakerTimer();
      try {
        await this.hass.callService('abstp_controller', 'play', {
          current_time: initialPosition,
          entity_id: this.selectedPlayer,
          episode_id: episodeId,
          item_id: itemId,
          speed: this.currentSpeed,
        });
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      } finally {
        this.awaitingPlaybackStart = false;
      }
    }
  }

  private async handleStop(): Promise<void> {
    this.stopSpeakerTimer();
    this.isPlaying = false;
    this.isBuffering = false;
    this.awaitingPlaybackStart = false;
    const sessionToStop: PlaySession | null = this.currentSession;
    this.currentSession = null;

    if (this.selectedPlayer === '') {
      this.browserPlayer.stop();
      if (this.hass && sessionToStop) {
        try {
          await this.hass.callWS({
            session_id: sessionToStop.session_id,
            type: 'abstp_controller/stop_session',
          });
        } catch {}
      }
    } else if (this.hass) {
      try {
        await this.hass.callService('abstp_controller', 'stop', {
          entity_id: this.selectedPlayer,
        });
      } catch {}
    }
  }

  private handleTogglePlayPause(): void {
    if (!this.currentItem) {
      return;
    }
    if (this.isPlaying || this.isBuffering) {
      void this.handleStop();
    } else {
      const startPos: number =
        this.playbackPosition > 0
          ? this.playbackPosition
          : Math.max(0, this.currentItem.progress || 0);
      void this.handlePlayItem(this.currentItem, startPos);
    }
  }

  private async handleSeek(newPosition: number): Promise<void> {
    this.playbackPosition = newPosition;
    if (this.currentItem) {
      AbstpPlayerCard.setStorageItem(`abstp_pos_${this.currentItem.id}`, String(newPosition));
      await this.handlePlayItem(this.currentItem, newPosition);
    }
  }

  private async handleSkip(seconds: number): Promise<void> {
    const targetPos: number = Math.max(
      0,
      Math.min(this.playbackDuration, this.playbackPosition + seconds),
    );
    await this.handleSeek(targetPos);
  }

  private handleSpeedAdjust(newSpeed: number): void {
    const roundedSpeed: number = Math.round(newSpeed * 100) / 100;
    this.currentSpeed = Math.min(MAX_PLAYBACK_SPEED, Math.max(MIN_PLAYBACK_SPEED, roundedSpeed));
    AbstpPlayerCard.setStorageItem(
      this.getCardStorageKey('selected_speed'),
      String(this.currentSpeed),
    );
    if (this.currentItem) {
      AbstpPlayerCard.setStorageItem(
        `abstp_pos_${this.currentItem.id}`,
        String(this.playbackPosition),
      );
    }
  }

  private startSpeedHold(delta: number): void {
    this.stopSpeedHold();
    this.adjustSpeedByDelta(delta);
    this.speedHoldTimer = window.setTimeout((): void => {
      this.speedHoldInterval = window.setInterval((): void => {
        const nextSpeed: number = Math.round((this.currentSpeed + delta) * 100) / 100;
        if (nextSpeed < MIN_PLAYBACK_SPEED || nextSpeed > MAX_PLAYBACK_SPEED) {
          this.stopSpeedHold();
          return;
        }
        this.adjustSpeedByDelta(delta);
      }, SPEED_HOLD_INTERVAL_MS);
    }, SPEED_HOLD_DELAY_MS);
  }

  private stopSpeedHold(): void {
    if (this.speedHoldTimer !== null) {
      window.clearTimeout(this.speedHoldTimer);
      this.speedHoldTimer = null;
    }
    if (this.speedHoldInterval !== null) {
      window.clearInterval(this.speedHoldInterval);
      this.speedHoldInterval = null;
    }
  }

  private adjustSpeedByDelta(delta: number): void {
    const nextSpeed: number = Math.round((this.currentSpeed + delta) * 100) / 100;
    const clamped: number = Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, nextSpeed));
    this.handleSpeedAdjust(clamped);
  }

  private async handleSelectItem(item: MediaItem | PodcastEpisode | InProgressItem): Promise<void> {
    if (this.isPlaying || this.isBuffering) {
      await this.handleStop();
    }
    this.currentItem = item;
    AbstpPlayerCard.setStorageItem(this.getCardStorageKey('last_item_id'), item.id);
    this.playbackPosition = AbstpPlayerCard.resolveInitialPosition(item);
    this.playbackDuration = item.duration || 0;
    this.isPlaying = false;
    this.isBuffering = false;
  }

  private async restartBrowserPlayback(): Promise<void> {
    this.browserPlayer.stop();
    if (this.hass && this.currentSession) {
      try {
        await this.hass.callWS({
          session_id: this.currentSession.session_id,
          type: 'abstp_controller/stop_session',
        });
      } catch {}
    }
    if (this.currentItem) {
      await this.handlePlayItem(this.currentItem, this.playbackPosition);
    }
  }

  private async restartSpeakerPlayback(): Promise<void> {
    if (!this.hass || !this.currentItem) {
      return;
    }
    this.stopSpeakerTimer();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    try {
      await this.hass.callService('abstp_controller', 'stop', {
        entity_id: this.selectedPlayer,
      });
    } catch {}
    try {
      const { itemId, episodeId } = AbstpPlayerCard.resolveItemIds(this.currentItem);
      await this.hass.callService('abstp_controller', 'play', {
        current_time: this.playbackPosition,
        entity_id: this.selectedPlayer,
        episode_id: episodeId,
        item_id: itemId,
        speed: this.currentSpeed,
      });
    } catch {
      this.isBuffering = false;
      this.awaitingPlaybackStart = false;
    } finally {
      this.awaitingPlaybackStart = false;
    }
  }

  private async applySpeedIfChanged(): Promise<void> {
    if (this.currentSpeed === this.speedOnOpen) {
      return;
    }
    this.speedOnOpen = this.currentSpeed;
    if (!this.currentItem || (!this.isPlaying && !this.isBuffering)) {
      return;
    }
    this.isBuffering = true;
    this.isPlaying = false;
    if (this.selectedPlayer === '') {
      await this.restartBrowserPlayback();
    } else {
      await this.restartSpeakerPlayback();
    }
  }

  private async closeSpeedPopover(): Promise<void> {
    if (!this.showSpeedPopover) {
      return;
    }
    this.showSpeedPopover = false;
    await this.applySpeedIfChanged();
  }

  private async handleVolumeChange(val: number): Promise<void> {
    const roundedVol: number = Math.round(Math.min(1.0, Math.max(0.0, val)) * 10) / 10;
    this.volumeLevel = roundedVol;
    if (this.selectedPlayer === '') {
      this.browserPlayer.setVolume(roundedVol);
    } else if (this.hass) {
      await this.hass.callService('media_player', 'volume_set', {
        entity_id: this.selectedPlayer,
        volume_level: roundedVol,
      });
    }
  }

  private async handleToggleMute(): Promise<void> {
    this.isMuted = !this.isMuted;
    if (this.selectedPlayer === '') {
      this.browserPlayer.setVolume(this.isMuted ? 0 : this.volumeLevel);
    } else if (this.hass) {
      await this.hass.callService('media_player', 'volume_mute', {
        entity_id: this.selectedPlayer,
        is_volume_muted: this.isMuted,
      });
    }
  }

  private static formatTime(seconds: number): string {
    if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds < 0) {
      return '0:00';
    }
    const s: number = Math.floor(seconds);
    const hrs: number = Math.floor(s / 3600);
    const mins: number = Math.floor((s % 3600) / 60);
    const secs: number = s % 60;
    if (hrs > 0) {
      return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
    }
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }

  private handleSearchInput(e: Event): void {
    this.searchQuery = (e.target as HTMLInputElement).value;
  }

  private handleTabInProgress(): void {
    this.userSelectedTab = true;
    this.activeTab = 'in_progress';
    this.selectedPodcastId = null;
  }

  private handleTabBooks(): void {
    this.userSelectedTab = true;
    this.activeTab = 'books';
    this.selectedPodcastId = null;
  }

  private handleTabPodcasts(): void {
    this.userSelectedTab = true;
    this.activeTab = 'podcasts';
  }

  private handleBackToPodcasts(): void {
    this.selectedPodcastId = null;
  }

  private async selectPlayer(playerId: string): Promise<void> {
    if (this.selectedPlayer === playerId) {
      this.showDeviceMenu = false;
      return;
    }
    const wasPlaying: boolean = this.isPlaying || this.isBuffering;
    const currentPos: number = Math.max(0, this.playbackPosition);
    const itemToResume = this.currentItem;

    if (wasPlaying) {
      await this.handleStop();
    }

    this.selectedPlayer = playerId;
    this.showDeviceMenu = false;
    AbstpPlayerCard.setStorageItem(this.getCardStorageKey('selected_player'), playerId);
    this.syncPlayerState();

    if (wasPlaying && itemToResume) {
      await this.handlePlayItem(itemToResume, currentPos);
    }
  }

  private toggleDeviceMenu(): void {
    this.showDeviceMenu = !this.showDeviceMenu;
    this.showSpeedPopover = false;
    this.showVolumePopover = false;
  }

  private toggleSpeedPopover(): void {
    if (this.showSpeedPopover) {
      void this.closeSpeedPopover();
    } else {
      this.speedOnOpen = this.currentSpeed;
      this.showSpeedPopover = true;
      this.showVolumePopover = false;
      this.showDeviceMenu = false;
    }
  }

  private toggleVolumePopover(): void {
    void this.closeSpeedPopover();
    this.showVolumePopover = !this.showVolumePopover;
    this.showDeviceMenu = false;
  }

  private toggleLibrary(): void {
    void this.closeSpeedPopover();
    this.showLibrary = !this.showLibrary;
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
  }

  private getFilteredInProgress(): InProgressItem[] {
    const query: string = this.searchQuery.toLowerCase();
    return this.inProgress.filter((item: InProgressItem): boolean => {
      const title: string = item.title || '';
      const author: string = item.author || '';
      const epTitle: string = item.episode_title ?? '';
      return (
        title.toLowerCase().includes(query) ||
        author.toLowerCase().includes(query) ||
        epTitle.toLowerCase().includes(query)
      );
    });
  }

  private getFilteredBooks(): MediaItem[] {
    const query: string = this.searchQuery.toLowerCase();
    return this.books.filter((b: MediaItem): boolean => {
      const title: string = b.title || '';
      const author: string = b.author || '';
      const matchQuery: boolean =
        title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
      if (!matchQuery) {
        return false;
      }
      if (this.filterProgress === 'in_progress') {
        return !b.is_finished && b.progress > 0 && b.progress < b.duration;
      }
      if (this.filterProgress === 'finished') {
        return Boolean(b.is_finished) || (b.progress >= b.duration && b.duration > 0);
      }
      return true;
    });
  }

  private getFilteredPodcasts(): MediaItem[] {
    const query: string = this.searchQuery.toLowerCase();
    return this.podcasts.filter((p: MediaItem): boolean => {
      const title: string = p.title || '';
      const author: string = p.author || '';
      return title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
    });
  }

  protected override render(): TemplateResult {
    const lang: string = this.hass?.language ?? 'en';
    const allPlayers: string[] = Object.keys(this.hass?.states ?? {}).filter(
      (id: string): boolean => {
        if (!id.startsWith('media_player.')) {
          return false;
        }
        const lowerId: string = id.toLowerCase();
        if (lowerId.includes('intent') || lowerId.includes('yandex_station_intents')) {
          return false;
        }
        const entity: HassEntity | undefined = this.hass?.states[id];
        if (!entity) {
          return false;
        }
        const entityAttrs = entity.attributes as {
          device_class?: string;
          supported_features?: number;
        };
        const devClass: string = (entityAttrs.device_class ?? '').toLowerCase();
        if (devClass === 'intent' || devClass === 'intents') {
          return false;
        }
        const features: number = entityAttrs.supported_features ?? 0;
        return (features & 512) !== 0;
      },
    );
    let allowedPlayers: string[] = allPlayers;
    if (this.config?.player_entities && this.config.player_entities.length > 0) {
      const allowed: string[] = this.config.player_entities;
      allowedPlayers = allPlayers.filter((id: string): boolean => allowed.includes(id));
    }

    const filteredInProgress: InProgressItem[] = this.getFilteredInProgress();
    const filteredBooks: MediaItem[] = this.getFilteredBooks();
    const filteredPodcasts: MediaItem[] = this.getFilteredPodcasts();

    return html`
      <ha-card>
        <div class="card-brand-icon" aria-hidden="true">${audiobookshelfIcon}</div>
        ${this.renderHeroPlayer(lang, allowedPlayers)}

        ${
          this.showLibrary
            ? this.renderLibrarySection(filteredInProgress, filteredBooks, filteredPodcasts, lang)
            : html``
        }
      </ha-card>
    `;
  }

  private static renderPlayerIcon(
    entity: HassEntity | undefined,
    entityId?: string,
  ): TemplateResult {
    if (!entity && !entityId) {
      return browserIcon;
    }
    const id: string = (entityId ?? entity?.entity_id ?? '').toLowerCase();
    const entityAttrs = entity?.attributes as
      | { icon?: string; device_class?: string; app_name?: string }
      | undefined;
    const iconAttr: string | undefined = entityAttrs?.icon;
    if (iconAttr) {
      return html`<ha-icon class="icon icon-device" .icon=${iconAttr}></ha-icon>`;
    }

    if (id.includes('chromecast') || id.includes('_cast') || entityAttrs?.app_name === 'Cast') {
      return html`<ha-icon class="icon icon-device" icon="mdi:cast"></ha-icon>`;
    }
    if (id.includes('androidtv') || id.includes('android_tv') || id.includes('remote')) {
      return html`<ha-icon class="icon icon-device" icon="mdi:remote-tv"></ha-icon>`;
    }
    if (id.includes('yandex') || id.includes('station') || id.includes('alice')) {
      return speakerIcon;
    }

    const deviceClass: string | undefined = entityAttrs?.device_class;
    if (deviceClass === 'tv') {
      return html`<ha-icon class="icon icon-device" icon="mdi:television"></ha-icon>`;
    }
    if (deviceClass === 'speaker') {
      return html`<ha-icon class="icon icon-device" icon="mdi:speaker"></ha-icon>`;
    }
    if (deviceClass === 'receiver') {
      return html`<ha-icon class="icon icon-device" icon="mdi:audio-video"></ha-icon>`;
    }
    return speakerIcon;
  }

  private static resolveDeviceSubtitle(
    id: string,
    entity: HassEntity | undefined,
    lang: string,
  ): string {
    if (entity?.state === 'unavailable') {
      return localize('card.unavailable', lang);
    }
    const lowerId: string = id.toLowerCase();
    if (lowerId.includes('chromecast') || lowerId.includes('_cast')) {
      return 'Chromecast';
    }
    if (
      lowerId.includes('androidtv') ||
      lowerId.includes('android_tv') ||
      lowerId.includes('remote')
    ) {
      return 'Android TV Remote';
    }
    if (lowerId.includes('yandex') || lowerId.includes('station')) {
      return 'Yandex Station';
    }
    return id.replace('media_player.', '');
  }

  private renderSpeakerMenuItem(id: string, lang: string): TemplateResult {
    const entity: HassEntity | undefined = this.hass?.states[id];
    const friendlyName: string = entity?.attributes.friendly_name ?? id;
    const isUnavailable: boolean = entity?.state === 'unavailable';
    const isSelected: boolean = this.selectedPlayer === id;
    const subtitle: string = AbstpPlayerCard.resolveDeviceSubtitle(id, entity, lang);

    return html`
      <div
        class="device-menu-item ${isSelected ? 'active' : ''} ${isUnavailable ? 'disabled' : ''}"
        @click=${(): void => {
          if (!isUnavailable) {
            void this.selectPlayer(id);
          }
        }}
      >
        ${AbstpPlayerCard.renderPlayerIcon(entity, id)}
        <div class="device-item-info">
          <span class="device-item-name">${friendlyName}</span>
          ${subtitle ? html`<span class="device-item-area">${subtitle}</span>` : html``}
        </div>
      </div>
    `;
  }

  private renderDeviceMenuPopover(
    lang: string,
    allowBrowser: boolean,
    isBrowser: boolean,
    allowedSpeakers: string[],
  ): TemplateResult {
    return html`
      <div class="device-menu-popover">
        ${
          allowBrowser
            ? html`
              <div
                class="device-menu-item ${isBrowser ? 'active' : ''}"
                @click=${(): void => {
                  void this.selectPlayer('');
                }}
              >
                ${browserIcon}
                <div class="device-item-info">
                  <span class="device-item-name">${localize('card.browser', lang)}</span>
                </div>
              </div>
            `
            : html``
        }
        ${allowedSpeakers.map((id: string): TemplateResult => this.renderSpeakerMenuItem(id, lang))}
      </div>
    `;
  }

  private renderDevicePicker(lang: string, allowedPlayers: string[]): TemplateResult {
    const allowBrowser: boolean =
      this.config?.player_entities === undefined || this.config.player_entities.includes('');
    const allowedSpeakers: string[] = allowedPlayers.filter((id: string): boolean => id !== '');
    const totalOptionsCount: number = (allowBrowser ? 1 : 0) + allowedSpeakers.length;
    const isSingleConfigured: boolean = totalOptionsCount <= 1;

    const isBrowser: boolean = this.selectedPlayer === '';
    const currentEntity: HassEntity | undefined = !isBrowser
      ? this.hass?.states[this.selectedPlayer]
      : undefined;
    const currentName: string = isBrowser
      ? localize('card.browser', lang)
      : (currentEntity?.attributes.friendly_name ?? this.selectedPlayer);

    if (isSingleConfigured) {
      return html`
        <div class="device-picker-row">
          <div class="device-badge device-badge-btn" title="${currentName}">
            ${isBrowser ? browserIcon : AbstpPlayerCard.renderPlayerIcon(currentEntity, this.selectedPlayer)}
            <span class="device-name">${currentName}</span>
          </div>
        </div>
      `;
    }

    return html`
      <div class="device-picker-row">
        <div
          class="device-badge device-badge-btn clickable"
          @click=${(): void => this.toggleDeviceMenu()}
          title="${localize('card.target_device', lang)}"
        >
          ${isBrowser ? browserIcon : AbstpPlayerCard.renderPlayerIcon(currentEntity, this.selectedPlayer)}
          <span class="device-name">${currentName}</span>
          ${chevronDownIcon}
        </div>

        ${
          this.showDeviceMenu
            ? this.renderDeviceMenuPopover(lang, allowBrowser, isBrowser, allowedSpeakers)
            : html``
        }
      </div>
    `;
  }

  private static resolveHeroCoverAndAuthor(
    item: MediaItem | PodcastEpisode | InProgressItem | null,
  ): {
    coverId: string;
    author: string;
  } {
    if (!item) {
      return { author: '', coverId: '' };
    }
    const coverId: string = 'podcast_id' in item && item.podcast_id ? item.podcast_id : item.id;
    const author: string =
      'episode_title' in item && item.episode_title
        ? item.title
        : 'author' in item && item.author
          ? item.author
          : 'podcast_title' in item && item.podcast_title
            ? (item.podcast_title as string)
            : '';
    return { author, coverId };
  }

  private calculateTimelineMetrics(): {
    effectiveDuration: number;
    effectivePosition: number;
    effectiveSpeed: number;
    remainingSeconds: number;
    progressPercent: number;
    speedAdjustedDuration: number;
    speedAdjustedPosition: number;
  } {
    const effectiveSpeed: number =
      this.currentSpeed > 0 ? this.currentSpeed : DEFAULT_PLAYBACK_SPEED;
    const effectivePosition: number = Number.isFinite(this.playbackPosition)
      ? this.playbackPosition
      : 0;
    const effectiveDuration: number =
      this.playbackDuration > 0 && Number.isFinite(this.playbackDuration)
        ? this.playbackDuration
        : 0;
    const speedAdjustedDuration: number =
      effectiveDuration > 0 ? Math.round(effectiveDuration / effectiveSpeed) : 0;
    const speedAdjustedPosition: number =
      effectivePosition > 0 ? Math.round(effectivePosition / effectiveSpeed) : 0;
    const remainingSeconds: number = Math.max(0, speedAdjustedDuration - speedAdjustedPosition);
    const progressPercent: number =
      effectiveDuration > 0
        ? Math.min(100, Math.max(0, Math.round((effectivePosition / effectiveDuration) * 100)))
        : 0;
    return {
      effectiveDuration,
      effectivePosition,
      effectiveSpeed,
      progressPercent,
      remainingSeconds,
      speedAdjustedDuration,
      speedAdjustedPosition,
    };
  }

  private renderHeroPlayer(lang: string, allowedPlayers: string[]): TemplateResult {
    const item: MediaItem | PodcastEpisode | InProgressItem | null = this.currentItem;
    const title: string = item
      ? 'episode_title' in item && item.episode_title
        ? item.episode_title
        : item.title
      : localize('card.no_active_track', lang);
    const { coverId, author } = AbstpPlayerCard.resolveHeroCoverAndAuthor(item);
    const {
      effectiveDuration,
      effectivePosition,
      progressPercent,
      remainingSeconds,
      speedAdjustedDuration,
      speedAdjustedPosition,
    } = this.calculateTimelineMetrics();

    return html`
      <div class="player-hero">
        ${this.renderDevicePicker(lang, allowedPlayers)}

        <div class="now-playing-body">
          <div class="player-cover">
            ${
              coverId
                ? html`
                  <img
                    src="/api/abstp_controller/cover/${coverId}"
                    alt="${title}"
                    loading="lazy"
                  />
                `
                : html`<div class="placeholder">${libraryIcon}</div>`
            }
          </div>
          <div class="player-meta">
            <div class="player-title" title="${title}">${title}</div>
            ${author ? html`<div class="player-author" title="${author}">${author}</div>` : html``}
            ${
              this.playbackDuration > 0
                ? html`
                  <div class="player-duration">
                    ⏱ ${AbstpPlayerCard.formatTime(this.playbackDuration)}
                  </div>
                `
                : html``
            }
          </div>
        </div>

        <div class="timeline-container">
          <input
            type="range"
            class="time-slider"
            style="--slider-progress: ${progressPercent}%;"
            min="0"
            max="${effectiveDuration > 0 ? effectiveDuration : 100}"
            .value="${String(effectivePosition)}"
            @input=${(e: Event): void => {
              this.playbackPosition = Number((e.target as HTMLInputElement).value);
            }}
            @change=${(e: Event): void => {
              const targetPos: number = Number((e.target as HTMLInputElement).value);
              void this.handleSeek(targetPos);
            }}
          />
          <div class="time-labels">
            <span>
              ${
                speedAdjustedDuration > 0
                  ? `${AbstpPlayerCard.formatTime(speedAdjustedDuration)} / ${AbstpPlayerCard.formatTime(speedAdjustedPosition)} / ${progressPercent}%`
                  : `${AbstpPlayerCard.formatTime(speedAdjustedPosition)}`
              }
            </span>
            <span>-${AbstpPlayerCard.formatTime(remainingSeconds)}</span>
          </div>
        </div>

        ${this.renderControlsBar(lang)}
      </div>
    `;
  }

  private renderPlaybackControls(lang: string, skipSec: number): TemplateResult {
    return html`
      <div class="playback-group">
        <button
          class="ctrl-btn ctrl-btn-rewind skip-btn"
          @click=${(): void => {
            void this.handleSkip(-skipSec);
          }}
          title="${localize('card.skip_backward', lang, { s: skipSec })}"
        >
          ${undoIcon}
          <span class="skip-value">${skipSec}</span>
        </button>

        <button
          class="ctrl-btn ctrl-btn-play play-main"
          @click=${(): void => this.handleTogglePlayPause()}
          title="${
            this.isBuffering
              ? localize('card.buffering', lang)
              : this.isPlaying
                ? localize('card.stop', lang)
                : localize('card.play', lang)
          }"
        >
          ${
            this.isBuffering
              ? html`<span class="icon-spin">${waitIcon}</span>`
              : this.isPlaying
                ? stopIcon
                : playIcon
          }
        </button>

        <button
          class="ctrl-btn ctrl-btn-forward skip-btn"
          @click=${(): void => {
            void this.handleSkip(skipSec);
          }}
          title="${localize('card.skip_forward', lang, { s: skipSec })}"
        >
          ${redoIcon}
          <span class="skip-value">${skipSec}</span>
        </button>
      </div>
    `;
  }

  private renderSpeedControls(lang: string): TemplateResult {
    return html`
      <div class="popover-anchor">
        <button
          class="ctrl-btn ctrl-btn-speed speed-pill-btn ${this.showSpeedPopover ? 'active' : ''}"
          @click=${(): void => this.toggleSpeedPopover()}
          title="${localize('card.speed_settings', lang)}"
        >
          ${this.currentSpeed}x
        </button>

        ${
          this.showSpeedPopover
            ? html`
              <div class="speed-popover">
                <div class="speed-popover-presets">
                  ${SPEED_PRESETS.map(
                    (spd: number): TemplateResult => html`
                      <button
                        class="speed-preset-btn ${this.currentSpeed === spd ? 'active' : ''}"
                        @click=${(): void => {
                          this.handleSpeedAdjust(spd);
                        }}
                      >
                        ${spd}x
                      </button>
                    `,
                  )}
                </div>
                <div class="speed-popover-adjust">
                  <button
                    class="speed-adjust-btn speed-btn-minus"
                    ?disabled=${this.currentSpeed <= MIN_PLAYBACK_SPEED}
                    @pointerdown=${(e: PointerEvent): void => {
                      e.preventDefault();
                      this.startSpeedHold(-PLAYBACK_SPEED_STEP);
                    }}
                    @pointerup=${(): void => this.stopSpeedHold()}
                    @pointercancel=${(): void => this.stopSpeedHold()}
                    @pointerleave=${(): void => this.stopSpeedHold()}
                    title="${localize('card.decrease_speed', lang)}"
                  >
                    ${minusIcon}
                  </button>
                  <span class="speed-current-display">${this.currentSpeed}x</span>
                  <button
                    class="speed-adjust-btn speed-btn-plus"
                    ?disabled=${this.currentSpeed >= MAX_PLAYBACK_SPEED}
                    @pointerdown=${(e: PointerEvent): void => {
                      e.preventDefault();
                      this.startSpeedHold(PLAYBACK_SPEED_STEP);
                    }}
                    @pointerup=${(): void => this.stopSpeedHold()}
                    @pointercancel=${(): void => this.stopSpeedHold()}
                    @pointerleave=${(): void => this.stopSpeedHold()}
                    title="${localize('card.increase_speed', lang)}"
                  >
                    ${plusIcon}
                  </button>
                </div>
              </div>
            `
            : html``
        }
      </div>
    `;
  }

  private renderVolumeControls(lang: string, isMutedState: boolean): TemplateResult {
    return html`
      <div class="popover-anchor">
        <button
          class="ctrl-btn ctrl-btn-volume icon-btn ${this.showVolumePopover ? 'active' : ''}"
          @click=${(): void => this.toggleVolumePopover()}
          title="${localize('card.volume', lang)}"
        >
          ${isMutedState ? soundMuteIcon : soundOnIcon}
        </button>

        ${
          this.showVolumePopover
            ? html`
              <div class="volume-popover">
                <span class="volume-percent-label">
                  ${Math.round(this.volumeLevel * 100)}%
                </span>
                <div class="volume-vertical-track">
                  <input
                    type="range"
                    class="volume-slider-vertical"
                    style="--volume-percent: ${Math.round(this.volumeLevel * 100)}%;"
                    min="0"
                    max="1"
                    step="0.1"
                    .value="${String(this.volumeLevel)}"
                    @input=${(e: Event): void => {
                      const val: number = Number((e.target as HTMLInputElement).value);
                      void this.handleVolumeChange(val);
                    }}
                  />
                </div>
                <button
                  class="ctrl-btn"
                  @click=${(): void => {
                    void this.handleToggleMute();
                  }}
                  title="${
                    isMutedState ? localize('card.unmute', lang) : localize('card.mute', lang)
                  }"
                >
                  ${isMutedState ? soundMuteIcon : soundOnIcon}
                </button>
              </div>
            `
            : html``
        }
      </div>
    `;
  }

  private renderControlsBar(lang: string): TemplateResult {
    const skipSec: number = this.config?.skip_seconds ?? DEFAULT_SKIP_SECONDS;
    const isMutedState: boolean = this.isMuted || this.volumeLevel === 0;

    return html`
      <div class="controls-bar">
        <div class="controls-left-placeholder"></div>
        ${this.renderPlaybackControls(lang, skipSec)}
        <div class="controls-right-group">
          ${this.renderSpeedControls(lang)}
          ${this.renderVolumeControls(lang, isMutedState)}

          <button
            class="ctrl-btn ctrl-btn-library icon-btn ${this.showLibrary ? 'active' : ''}"
            @click=${(): void => this.toggleLibrary()}
            title="${localize('card.library_toggle', lang)}"
          >
            ${libraryIcon}
          </button>
        </div>
      </div>
    `;
  }

  private renderTabsBar(
    filteredInProgress: InProgressItem[],
    filteredBooks: MediaItem[],
    filteredPodcasts: MediaItem[],
    lang: string,
  ): TemplateResult {
    const showInProgress: boolean = this.inProgress.length > 0 || this.activeTab === 'in_progress';
    return html`
      <div class="tabs-bar">
        <div class="tabs-group">
          ${
            showInProgress
              ? html`
                <button
                  class="tab-btn ${this.activeTab === 'in_progress' ? 'active' : ''}"
                  @click=${(): void => this.handleTabInProgress()}
                >
                  ${localize('card.continue_listening', lang)} (${filteredInProgress.length})
                </button>
              `
              : html``
          }
          ${
            !this.config?.hide_books
              ? html`
                <button
                  class="tab-btn ${this.activeTab === 'books' ? 'active' : ''}"
                  @click=${(): void => this.handleTabBooks()}
                >
                  ${localize('card.books', lang)} (${filteredBooks.length})
                </button>
              `
              : html``
          }
          ${
            !this.config?.hide_podcasts
              ? html`
                <button
                  class="tab-btn ${this.activeTab === 'podcasts' ? 'active' : ''}"
                  @click=${(): void => this.handleTabPodcasts()}
                >
                  ${localize('card.podcasts', lang)} (${filteredPodcasts.length})
                </button>
              `
              : html``
          }
        </div>

        <button
          class="ctrl-btn ctrl-btn-refresh icon-btn"
          @click=${(): void => {
            void this.fetchLibrary();
          }}
          title="${localize('card.refresh', lang)}"
        >
          <span class="${this.isRefreshing ? 'icon-spin' : ''}">${waitIcon}</span>
        </button>
      </div>
    `;
  }

  private renderLibraryContent(
    filteredInProgress: InProgressItem[],
    filteredBooks: MediaItem[],
    filteredPodcasts: MediaItem[],
    lang: string,
  ): TemplateResult {
    if (this.isRefreshing && !this.selectedPodcastId) {
      return html`<div class="empty-state">${localize('card.loading', lang)}</div>`;
    }
    if (this.activeTab === 'in_progress') {
      return this.renderInProgressGrid(filteredInProgress, lang);
    }
    if (this.activeTab === 'books') {
      return this.renderBooksGrid(filteredBooks, lang);
    }
    return this.renderPodcastsView(filteredPodcasts, lang);
  }

  private renderLibrarySection(
    filteredInProgress: InProgressItem[],
    filteredBooks: MediaItem[],
    filteredPodcasts: MediaItem[],
    lang: string,
  ): TemplateResult {
    return html`
      <div class="library-section">
        <div class="search-row">
          <input
            type="text"
            class="search-input"
            placeholder="${localize('card.search', lang)}"
            .value=${this.searchQuery}
            @input=${(e: Event): void => this.handleSearchInput(e)}
          />
        </div>

        ${this.renderTabsBar(filteredInProgress, filteredBooks, filteredPodcasts, lang)}
        ${this.renderLibraryContent(filteredInProgress, filteredBooks, filteredPodcasts, lang)}
      </div>
    `;
  }

  private isItemActive(item: InProgressItem): boolean {
    if (!this.currentItem) {
      return false;
    }
    if ('episode_id' in this.currentItem && this.currentItem.episode_id) {
      return this.currentItem.id === item.id && this.currentItem.episode_id === item.episode_id;
    }
    return this.currentItem.id === item.id;
  }

  private renderInProgressCard(item: InProgressItem): TemplateResult {
    const progressPercent: number =
      item.duration > 0 ? Math.min(100, (item.current_time / item.duration) * 100) : 0;
    const isActive: boolean = this.isItemActive(item);
    const isPodcastEp: boolean = item.media_type === 'podcast' && Boolean(item.episode_title);
    const titleText: string = isPodcastEp ? (item.episode_title ?? item.title) : item.title;
    const subtitleText: string = isPodcastEp ? item.title : item.author;

    return html`
      <div
        class="media-card ${isActive ? 'active' : ''}"
        @click=${(): void => {
          void this.handleSelectItem(item);
        }}
      >
        <div class="card-cover">
          <div class="placeholder">${item.media_type === 'podcast' ? '🎙️' : '📖'}</div>
          <img
            src="/api/abstp_controller/cover/${item.id}"
            alt="${item.title}"
            loading="lazy"
            @error=${(e: Event): void => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          ${
            progressPercent > 0
              ? html`
                <div class="progress-bar-bg">
                  <div
                    class="progress-bar-fill"
                    style="width: ${progressPercent}%"
                  ></div>
                </div>
              `
              : html``
          }
        </div>
        <div class="card-info">
          <div class="card-title" title="${titleText}">${titleText}</div>
          <div class="card-author" title="${subtitleText}">${subtitleText}</div>
        </div>
      </div>
    `;
  }

  private renderInProgressGrid(items: InProgressItem[], lang: string): TemplateResult {
    if (items.length === 0) {
      return html`<div class="empty-state">${localize('card.no_items', lang)}</div>`;
    }

    return html`
      <div class="library-grid">
        ${items.map((item: InProgressItem): TemplateResult => this.renderInProgressCard(item))}
      </div>
    `;
  }

  private renderBooksGrid(books: MediaItem[], lang: string): TemplateResult {
    if (books.length === 0) {
      return html`<div class="empty-state">${localize('card.no_items', lang)}</div>`;
    }

    return html`
      <div class="library-grid">
        ${books.map((book: MediaItem): TemplateResult => {
          const progressPercent: number =
            book.duration > 0 ? Math.min(100, (book.progress / book.duration) * 100) : 0;
          const isActive: boolean = this.currentItem?.id === book.id;
          return html`
            <div
              class="media-card ${isActive ? 'active' : ''}"
              @click=${(): void => {
                void this.handleSelectItem(book);
              }}
            >
              <div class="card-cover">
                <div class="placeholder">📖</div>
                <img
                  src="/api/abstp_controller/cover/${book.id}"
                  alt="${book.title}"
                  loading="lazy"
                  @error=${(e: Event): void => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                ${
                  book.is_finished
                    ? html`
                      <div class="progress-bar-bg">
                        <div class="progress-bar-fill finished"></div>
                      </div>
                    `
                    : progressPercent > 0
                      ? html`
                        <div class="progress-bar-bg">
                          <div
                            class="progress-bar-fill"
                            style="width: ${progressPercent}%"
                          ></div>
                        </div>
                      `
                      : html``
                }
              </div>
              <div class="card-info">
                <div class="card-title" title="${book.title}">${book.title}</div>
                <div class="card-author" title="${book.author}">${book.author}</div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderPodcastEpisodesGrid(episodesList: PodcastEpisode[]): TemplateResult {
    const podcastId: string = this.selectedPodcastId ?? '';
    return html`
      <div class="library-grid">
        ${episodesList.map((ep: PodcastEpisode): TemplateResult => {
          const isActive: boolean = this.currentItem?.id === ep.id;
          const progressPercent: number =
            ep.duration > 0 ? Math.min(100, ((ep.progress || 0) / ep.duration) * 100) : 0;
          return html`
            <div
              class="media-card ${isActive ? 'active' : ''}"
              @click=${(): void => {
                void this.handleSelectItem(ep);
              }}
            >
              <div class="card-cover">
                <div class="placeholder">🎙️</div>
                <img
                  src="/api/abstp_controller/cover/${podcastId}"
                  alt="${ep.title}"
                  loading="lazy"
                  @error=${(e: Event): void => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                ${
                  ep.is_finished
                    ? html`
                      <div class="progress-bar-bg">
                        <div class="progress-bar-fill finished"></div>
                      </div>
                    `
                    : progressPercent > 0
                      ? html`
                        <div class="progress-bar-bg">
                          <div
                            class="progress-bar-fill"
                            style="width: ${progressPercent}%"
                          ></div>
                        </div>
                      `
                      : html``
                }
              </div>
              <div class="card-info">
                <div class="card-title" title="${ep.title}">${ep.title}</div>
                <div class="card-author">
                  ⏱ ${AbstpPlayerCard.formatTime(ep.duration)}
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private renderPodcastsView(podcasts: MediaItem[], lang: string): TemplateResult {
    if (this.selectedPodcastId) {
      const episodesList: PodcastEpisode[] = this.episodes[this.selectedPodcastId] ?? [];
      const currentPodcast: MediaItem | undefined = this.podcasts.find(
        (p: MediaItem): boolean => p.id === this.selectedPodcastId,
      );
      const podcastTitle: string = currentPodcast
        ? currentPodcast.title
        : localize('card.podcasts', lang);

      return html`
        <div class="podcast-header">
          <button
            class="ctrl-btn icon-btn"
            @click=${(): void => this.handleBackToPodcasts()}
          >
            ←
          </button>
          <span class="podcast-header-title">${podcastTitle}</span>
        </div>
        ${
          this.isRefreshing && episodesList.length === 0
            ? html`<div class="empty-state">${localize('card.loading', lang)}</div>`
            : episodesList.length === 0
              ? html`<div class="empty-state">${localize('card.no_items', lang)}</div>`
              : this.renderPodcastEpisodesGrid(episodesList)
        }
      `;
    }

    if (podcasts.length === 0) {
      return html`<div class="empty-state">${localize('card.no_items', lang)}</div>`;
    }

    return html`
      <div class="library-grid">
        ${podcasts.map((podcast: MediaItem): TemplateResult => {
          const isActive: boolean = this.currentItem?.id === podcast.id;
          return html`
            <div
              class="media-card ${isActive ? 'active' : ''}"
              @click=${(): void => {
                void this.fetchEpisodes(podcast.id);
              }}
            >
              <div class="card-cover">
                <div class="placeholder">🎙️</div>
                <img
                  src="/api/abstp_controller/cover/${podcast.id}"
                  alt="${podcast.title}"
                  loading="lazy"
                  @error=${(e: Event): void => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <div class="card-info">
                <div class="card-title" title="${podcast.title}">
                  ${podcast.title}
                </div>
                <div class="card-author" title="${podcast.author}">
                  ${podcast.author}
                </div>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

interface WindowWithCustomCards extends Window {
  customCards?: Array<{
    description: string;
    name: string;
    preview?: boolean;
    type: string;
  }>;
}

const windowWithCards = window as WindowWithCustomCards;
windowWithCards.customCards = windowWithCards.customCards ?? [];
if (
  !windowWithCards.customCards.some(
    (card: { type: string }): boolean => card.type === 'abstp-player-card',
  )
) {
  windowWithCards.customCards.push({
    description: 'Transcoded Audiobookshelf player card with speed control',
    name: 'Audiobookshelf Player',
    preview: true,
    type: 'abstp-player-card',
  });
}
