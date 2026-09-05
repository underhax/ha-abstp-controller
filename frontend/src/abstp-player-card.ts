import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import { BrowserAudioPlayer } from './audio-player.ts';
import {
  fetchChapters,
  fetchEpisodes,
  fetchLibrary,
  playOnSpeaker,
  setSpeakerMute,
  setSpeakerVolume,
  startBrowserSession,
  stopBrowserSession,
  stopSpeaker,
} from './card/api.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SKIP_SECONDS,
  DEFAULT_VOLUME_LEVEL,
  SPEAKER_TIMER_INTERVAL_MS,
  SPEED_HOLD_DELAY_MS,
  SPEED_HOLD_INTERVAL_MS,
} from './card/constants.ts';
import {
  filterBooks,
  filterInProgress,
  filterPodcasts,
  findSavedItem,
  getCurrentChapter,
  hasNoNavigableChapters,
  isPodcastItem,
  resolveHeroCoverAndAuthor,
  resolveInitialPosition,
  resolveItemIds,
} from './card/media.ts';
import {
  calculateBrowserPosition,
  calculateNextSpeed,
  calculateSkipPosition,
  calculateSpeakerProgress,
  clampVolume,
  isSpeedOutOfRange,
  normalizeSeekPosition,
  resolvePlayPosition,
} from './card/playback.ts';
import {
  getCardStorageKey,
  getStorageItem,
  loadBrowserAudioSettings,
  loadSelectedPlayer,
  loadSelectedSpeed,
  setStorageItem,
} from './card/storage.ts';
import { renderChaptersSection, scrollToActiveChapter } from './card/templates/chapters.ts';
import {
  renderDevicePicker,
  renderPlayerIcon,
  resolveDeviceSubtitle,
} from './card/templates/device-picker.ts';
import { renderHeroPlayer } from './card/templates/hero.ts';
import { renderLibrarySection } from './card/templates/library.ts';
import { formatTime } from './card/timeline.ts';
import { audiobookshelfIcon } from './icons.ts';
import { cardStyles } from './styles.ts';
import type {
  AbstpCardConfig,
  ActiveSessionInfo,
  ChapterItem,
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
  @state() private showChapters: boolean = false;
  @state() private chapters: ChapterItem[] = [];
  @state() private chaptersBookId: string = '';
  @state() private isLoadingChapters: boolean = false;
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
  private browserVolume: number = DEFAULT_VOLUME_LEVEL;
  private browserMuted: boolean = false;
  private libraryLoaded: boolean = false;
  private userSelectedTab: boolean = false;
  private speakerTimer: number | null = null;
  private awaitingPlaybackStart: boolean = false;
  private awaitingPlaybackStop: boolean = false;
  private playbackStopTimeout: number | null = null;
  private speedHoldTimer: number | null = null;
  private speedHoldInterval: number | null = null;

  private clearPlaybackStopTimeout(): void {
    if (this.playbackStopTimeout !== null) {
      window.clearTimeout(this.playbackStopTimeout);
      this.playbackStopTimeout = null;
    }
    this.awaitingPlaybackStop = false;
  }

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
    return getStorageItem(key);
  }

  private static setStorageItem(key: string, value: string): void {
    setStorageItem(key, value);
  }

  private getCardStorageKey(subKey: string): string {
    return getCardStorageKey(subKey, this.config);
  }

  private initBrowserVolume(): void {
    const { browserMuted, browserVolume } = loadBrowserAudioSettings(this.config);
    this.browserVolume = browserVolume;
    this.browserMuted = browserMuted;
  }

  private initSelectedPlayer(): void {
    this.selectedPlayer = loadSelectedPlayer(this.config);
    if (this.selectedPlayer === '') {
      this.volumeLevel = this.browserVolume;
      this.isMuted = this.browserMuted;
      this.browserPlayer.setVolume(this.browserMuted ? 0 : this.browserVolume);
    }
  }

  private initSelectedSpeed(): void {
    this.currentSpeed = loadSelectedSpeed(this.config);
  }

  public setConfig(config: AbstpCardConfig): void {
    this.config = config;
    this.initBrowserVolume();
    this.initSelectedPlayer();
    this.initSelectedSpeed();
  }

  public override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('keydown', this.handleGlobalKeydown);
    window.addEventListener('pointerdown', this.handleGlobalPointerDown);
    window.addEventListener('pagehide', this.handlePageHide);
    this.setupAudioListeners();
    this.initBrowserVolume();
    this.initSelectedPlayer();
    this.initSelectedSpeed();
  }

  public override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.clearPlaybackStopTimeout();
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
    if (this.showChapters && (changedProps.has('showChapters') || changedProps.has('chapters'))) {
      void this.updateComplete.then((): void => {
        requestAnimationFrame((): void => {
          this.scrollToActiveChapter();
        });
      });
    }
    if (!changedProps.has('hass') || !this.hass) {
      return;
    }
    if (!this.libraryLoaded) {
      this.libraryLoaded = true;
      void this.fetchLibrary();
    }
    this.syncPlayerState();
  }

  private scrollToActiveChapter(): void {
    scrollToActiveChapter(this.renderRoot);
  }

  private startSpeakerTimer(): void {
    this.stopSpeakerTimer();
    this.speakerTimer = window.setInterval((): void => {
      if (this.isPlaying && this.selectedPlayer !== '') {
        this.playbackPosition = calculateSpeakerProgress(
          this.playbackPosition,
          this.playbackDuration,
          this.currentSpeed,
        );
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

  private handleSpeakerStopped(isOffOrUnavailable: boolean): void {
    this.clearPlaybackStopTimeout();
    if (isOffOrUnavailable) {
      this.isBuffering = false;
    }
    if (this.isPlaying) {
      this.isPlaying = false;
      this.stopSpeakerTimer();
    }
  }

  private syncPlaybackState(state: string): void {
    if (state === 'playing') {
      if (!this.awaitingPlaybackStop && !this.awaitingPlaybackStart) {
        this.isBuffering = false;
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.startSpeakerTimer();
        }
      }
      return;
    }

    this.awaitingPlaybackStart = false;

    if (state === 'off' || state === 'unavailable') {
      this.handleSpeakerStopped(true);
      return;
    }

    if (state === 'idle' || state === 'paused' || state === 'standby' || state === 'buffering') {
      this.handleSpeakerStopped(false);
    }
  }

  private syncPlayerState(): void {
    if (this.selectedPlayer === '') {
      this.volumeLevel = this.browserVolume;
      this.isMuted = this.browserMuted;
      this.browserPlayer.setVolume(this.browserMuted ? 0 : this.browserVolume);
      return;
    }
    if (!this.hass) {
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
      if (playing) {
        if (!this.awaitingPlaybackStop) {
          this.isPlaying = true;
          this.isBuffering = false;
          this.awaitingPlaybackStart = false;
        }
      } else {
        this.isPlaying = false;
        if (!this.awaitingPlaybackStart) {
          this.isBuffering = false;
        }
        this.clearPlaybackStopTimeout();
      }
    });

    this.browserPlayer.onBuffering((buffering: boolean): void => {
      if (this.selectedPlayer === '' && !this.awaitingPlaybackStop) {
        this.isBuffering = buffering;
        if (!buffering && this.awaitingPlaybackStart) {
          this.isPlaying = true;
          this.awaitingPlaybackStart = false;
        }
      }
    });

    this.browserPlayer.onTime((pos: number, dur: number): void => {
      this.handleBrowserTimeUpdate(pos, dur);
    });

    this.browserPlayer.onError((): void => {
      this.isPlaying = false;
      this.isBuffering = false;
      this.awaitingPlaybackStart = false;
      this.clearPlaybackStopTimeout();
    });
  }

  private handleBrowserTimeUpdate(pos: number, dur: number): void {
    if (this.selectedPlayer !== '') {
      return;
    }
    if (this.awaitingPlaybackStop) {
      return;
    }
    if (pos <= 0 && (this.awaitingPlaybackStart || this.isBuffering)) {
      return;
    }
    if (pos > 0) {
      if (this.awaitingPlaybackStart || this.isBuffering) {
        this.isPlaying = true;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    }
    this.playbackPosition = calculateBrowserPosition(
      this.browserStreamStartPos,
      pos,
      this.currentSpeed,
      this.playbackDuration,
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
    return findSavedItem(itemId, this.inProgress, this.books, this.podcasts);
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
    if (activeSession.episode_id || AbstpPlayerCard.isPodcastItem(matchedItem)) {
      this.chapters = [];
      this.chaptersBookId = '';
      this.showChapters = false;
    } else {
      void this.fetchChapters(activeSession.item_id);
    }
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
    if (AbstpPlayerCard.isPodcastItem(targetItem)) {
      this.chapters = [];
      this.chaptersBookId = '';
      this.showChapters = false;
    } else {
      void this.fetchChapters(targetItem.id);
    }
  }

  private async fetchLibrary(): Promise<void> {
    if (!this.hass) {
      return;
    }
    this.isRefreshing = true;
    try {
      const response = await fetchLibrary(this.hass);
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
      this.restoreActiveOrSavedItem(response.active_sessions ?? {});
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
      const response = await fetchEpisodes(this.hass, podcastId);
      const podcast: MediaItem | undefined = this.podcasts.find(
        (p: MediaItem): boolean => p.id === podcastId,
      );
      const podcastTitle: string = podcast ? podcast.title : '';
      const mappedEpisodes: PodcastEpisode[] = response.episodes.map(
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

  private async fetchChapters(targetBookId?: string): Promise<void> {
    if (!this.hass) {
      return;
    }
    if (AbstpPlayerCard.isPodcastItem(this.currentItem)) {
      this.chapters = [];
      this.chaptersBookId = '';
      this.showChapters = false;
      return;
    }
    const bookId: string =
      targetBookId ??
      (this.currentItem ? AbstpPlayerCard.resolveItemIds(this.currentItem).itemId : '');
    if (!bookId) {
      return;
    }
    if (this.chaptersBookId === bookId && this.chapters.length > 0) {
      return;
    }
    this.isLoadingChapters = true;
    try {
      const response = await fetchChapters(this.hass, bookId);
      this.chapters = response.chapters;
      this.chaptersBookId = bookId;
      if (this.chapters.length <= 1) {
        this.showChapters = false;
      }
    } catch {
      this.chapters = [];
      this.chaptersBookId = bookId;
      this.showChapters = false;
    } finally {
      this.isLoadingChapters = false;
    }
  }

  private hasNoNavigableChapters(): boolean {
    return hasNoNavigableChapters(this.currentItem, this.chapters);
  }

  private getCurrentChapter(): ChapterItem | null {
    return getCurrentChapter(this.chapters, this.playbackPosition, this.currentItem);
  }

  private async handleChapterClick(ch: ChapterItem): Promise<void> {
    if (!this.currentItem) {
      return;
    }
    await this.handleSeek(ch.start);
  }

  public static isPodcastItem(item: MediaItem | PodcastEpisode | InProgressItem | null): boolean {
    return isPodcastItem(item);
  }

  private static resolveItemIds(item: MediaItem | PodcastEpisode | InProgressItem): {
    episodeId?: string | undefined;
    itemId: string;
  } {
    return resolveItemIds(item);
  }

  private static resolveInitialPosition(
    item: MediaItem | PodcastEpisode | InProgressItem,
    startTime?: number,
  ): number {
    return resolveInitialPosition(item, startTime);
  }

  public static calculateBrowserPosition = calculateBrowserPosition;
  public static calculateNextSpeed = calculateNextSpeed;
  public static calculateSkipPosition = calculateSkipPosition;
  public static calculateSpeakerProgress = calculateSpeakerProgress;
  public static clampVolume = clampVolume;
  public static isSpeedOutOfRange = isSpeedOutOfRange;
  public static normalizeSeekPosition = normalizeSeekPosition;
  public static resolvePlayPosition = resolvePlayPosition;

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
    if (AbstpPlayerCard.isPodcastItem(item)) {
      this.chapters = [];
      this.chaptersBookId = '';
      this.showChapters = false;
    } else if (itemId !== this.chaptersBookId) {
      this.chapters = [];
      this.chaptersBookId = '';
      void this.fetchChapters(itemId);
    }

    this.clearPlaybackStopTimeout();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    const safeStartPos: number = normalizeSeekPosition(initialPosition);
    if (this.selectedPlayer === '') {
      this.stopSpeakerTimer();
      try {
        const session: PlaySession = await startBrowserSession(
          this.hass,
          itemId,
          episodeId,
          this.currentSpeed,
          safeStartPos,
        );
        this.currentSession = session;
        this.browserPlayer.setVolume(this.isMuted ? 0 : this.volumeLevel);
        this.browserPlayer.playStream(session.stream_url);
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    } else {
      this.stopSpeakerTimer();
      try {
        await playOnSpeaker(
          this.hass,
          this.selectedPlayer,
          itemId,
          episodeId,
          this.currentSpeed,
          safeStartPos,
        );
      } catch {
        this.isPlaying = false;
        this.isBuffering = false;
        this.awaitingPlaybackStart = false;
      }
    }
  }

  private async handleStop(): Promise<void> {
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
    const sessionToStop: PlaySession | null = this.currentSession;
    this.currentSession = null;

    if (this.selectedPlayer === '') {
      this.browserPlayer.stop();
      if (this.hass && sessionToStop) {
        try {
          await stopBrowserSession(this.hass, sessionToStop.session_id);
        } catch {}
      }
    } else if (this.hass) {
      try {
        await stopSpeaker(this.hass, this.selectedPlayer);
      } catch {}
    }
  }

  private handleTogglePlayPause(): void {
    if (!this.currentItem) {
      return;
    }
    if (this.isPlaying || this.isBuffering) {
      this.isPlaying = false;
      this.isBuffering = false;
      this.awaitingPlaybackStart = false;
      this.awaitingPlaybackStop = true;
      void this.handleStop();
    } else {
      const startPos: number = resolvePlayPosition(
        this.playbackPosition,
        this.currentItem.progress,
      );
      void this.handlePlayItem(this.currentItem, startPos);
    }
  }

  private async handleSeek(newPosition: number): Promise<void> {
    this.playbackPosition = newPosition;
    if (this.currentItem) {
      AbstpPlayerCard.setStorageItem(`abstp_pos_${this.currentItem.id}`, String(newPosition));
      if (this.isPlaying || this.isBuffering) {
        this.isBuffering = true;
        this.isPlaying = false;
        if (this.selectedPlayer === '') {
          await this.restartBrowserPlayback(newPosition);
        } else {
          await this.restartSpeakerPlayback(newPosition);
        }
      } else {
        await this.handlePlayItem(this.currentItem, newPosition);
      }
    }
  }

  private async handleSkip(seconds: number): Promise<void> {
    const targetPos: number = calculateSkipPosition(
      this.playbackPosition,
      this.playbackDuration,
      seconds,
    );
    await this.handleSeek(targetPos);
  }

  private handleSpeedAdjust(newSpeed: number): void {
    this.currentSpeed = calculateNextSpeed(newSpeed, 0);
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
        const nextSpeed: number = calculateNextSpeed(this.currentSpeed, delta);
        if (isSpeedOutOfRange(nextSpeed)) {
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
    this.handleSpeedAdjust(calculateNextSpeed(this.currentSpeed, delta));
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
    if (AbstpPlayerCard.isPodcastItem(item)) {
      this.chapters = [];
      this.chaptersBookId = '';
      this.showChapters = false;
    } else {
      const { itemId } = AbstpPlayerCard.resolveItemIds(item);
      if (itemId !== this.chaptersBookId) {
        this.chapters = [];
        this.chaptersBookId = '';
        void this.fetchChapters(itemId);
      }
    }
  }

  private async restartBrowserPlayback(targetPosition?: number): Promise<void> {
    const posToPlay: number = targetPosition ?? this.playbackPosition;
    this.playbackPosition = posToPlay;
    this.browserStreamStartPos = posToPlay;
    this.clearPlaybackStopTimeout();
    this.browserPlayer.stop();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    const prevSession: PlaySession | null = this.currentSession;
    this.currentSession = null;
    if (this.hass && prevSession) {
      try {
        await stopBrowserSession(this.hass, prevSession.session_id);
      } catch {}
    }
    if (this.currentItem) {
      await this.handlePlayItem(this.currentItem, posToPlay);
    }
  }

  private async restartSpeakerPlayback(targetPosition?: number): Promise<void> {
    if (!this.hass || !this.currentItem) {
      return;
    }
    const posToPlay: number = targetPosition ?? this.playbackPosition;
    this.playbackPosition = posToPlay;
    this.clearPlaybackStopTimeout();
    this.stopSpeakerTimer();
    this.isBuffering = true;
    this.isPlaying = false;
    this.awaitingPlaybackStart = true;
    try {
      const { itemId, episodeId } = AbstpPlayerCard.resolveItemIds(this.currentItem);
      await playOnSpeaker(
        this.hass,
        this.selectedPlayer,
        itemId,
        episodeId,
        this.currentSpeed,
        normalizeSeekPosition(posToPlay),
      );
    } catch {
      this.isBuffering = false;
      this.isPlaying = false;
      this.awaitingPlaybackStart = false;
    }
    window.setTimeout((): void => {
      if (this.awaitingPlaybackStart) {
        this.awaitingPlaybackStart = false;
        if (this.isBuffering && this.selectedPlayer && this.hass) {
          const entityState: string | undefined = this.hass.states[this.selectedPlayer]?.state;
          if (entityState === 'playing') {
            this.isBuffering = false;
            this.isPlaying = true;
            this.startSpeakerTimer();
          }
        }
      }
    }, 3000);
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
      await this.restartBrowserPlayback(this.playbackPosition);
    } else {
      await this.restartSpeakerPlayback(this.playbackPosition);
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
    const roundedVol: number = clampVolume(val);
    this.volumeLevel = roundedVol;
    if (this.selectedPlayer === '') {
      this.browserVolume = roundedVol;
      if (this.isMuted && roundedVol > 0) {
        this.isMuted = false;
        this.browserMuted = false;
        AbstpPlayerCard.setStorageItem(this.getCardStorageKey('browser_muted'), 'false');
      }
      AbstpPlayerCard.setStorageItem(this.getCardStorageKey('browser_volume'), String(roundedVol));
      this.browserPlayer.setVolume(this.isMuted ? 0 : roundedVol);
    } else if (this.hass) {
      await setSpeakerVolume(this.hass, this.selectedPlayer, roundedVol);
    }
  }

  private async handleToggleMute(): Promise<void> {
    this.isMuted = !this.isMuted;
    if (this.selectedPlayer === '') {
      this.browserMuted = this.isMuted;
      AbstpPlayerCard.setStorageItem(
        this.getCardStorageKey('browser_muted'),
        String(this.browserMuted),
      );
      this.browserPlayer.setVolume(this.isMuted ? 0 : this.volumeLevel);
    } else if (this.hass) {
      await setSpeakerMute(this.hass, this.selectedPlayer, this.isMuted);
    }
  }

  public static formatTime = formatTime;

  private handleSearchInput(e: Event): void {
    this.searchQuery = (e.target as HTMLInputElement).value;
  }

  private handleClearSearch(): void {
    this.searchQuery = '';
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

  private toggleChapters(): void {
    if (this.hasNoNavigableChapters()) {
      return;
    }
    void this.closeSpeedPopover();
    this.showLibrary = false;
    this.showChapters = !this.showChapters;
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
    if (this.showChapters && this.currentItem) {
      const { itemId } = AbstpPlayerCard.resolveItemIds(this.currentItem);
      if (this.chaptersBookId !== itemId) {
        void this.fetchChapters(itemId);
      }
    }
  }

  private toggleLibrary(): void {
    void this.closeSpeedPopover();
    this.showChapters = false;
    this.showLibrary = !this.showLibrary;
    this.showVolumePopover = false;
    this.showDeviceMenu = false;
  }

  private getFilteredInProgress(): InProgressItem[] {
    return filterInProgress(this.inProgress, this.searchQuery);
  }

  private getFilteredBooks(): MediaItem[] {
    return filterBooks(this.books, this.searchQuery, this.filterProgress);
  }

  private getFilteredPodcasts(): MediaItem[] {
    return filterPodcasts(this.podcasts, this.searchQuery);
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
            : this.showChapters
              ? this.renderChaptersSection(lang)
              : html``
        }
      </ha-card>
    `;
  }

  public static renderPlayerIcon = renderPlayerIcon;
  public static resolveDeviceSubtitle = resolveDeviceSubtitle;

  private renderDevicePicker(lang: string, allowedPlayers: string[]): TemplateResult {
    return renderDevicePicker({
      allowedPlayers,
      config: this.config,
      hass: this.hass,
      lang,
      onSelectPlayer: (id: string): void => {
        void this.selectPlayer(id);
      },
      onToggleDeviceMenu: (): void => this.toggleDeviceMenu(),
      selectedPlayer: this.selectedPlayer,
      showDeviceMenu: this.showDeviceMenu,
    });
  }

  public static renderHeroPlayer = renderHeroPlayer;
  public static resolveHeroCoverAndAuthor = resolveHeroCoverAndAuthor;

  private renderHeroPlayer(lang: string, allowedPlayers: string[]): TemplateResult {
    return renderHeroPlayer({
      currentChapter: this.getCurrentChapter(),
      currentItem: this.currentItem,
      currentSpeed: this.currentSpeed,
      devicePicker: this.renderDevicePicker(lang, allowedPlayers),
      hasNoChapters: this.hasNoNavigableChapters(),
      isBuffering: this.isBuffering,
      isMuted: this.isMuted,
      isPlaying: this.isPlaying,
      lang,
      onSeekChange: (targetPos: number): Promise<void> => this.handleSeek(targetPos),
      onSeekInput: (targetPos: number): void => {
        this.playbackPosition = targetPos;
      },
      onSkip: (sec: number): Promise<void> => this.handleSkip(sec),
      onSpeedAdjust: (spd: number): void => this.handleSpeedAdjust(spd),
      onStartSpeedHold: (step: number): void => this.startSpeedHold(step),
      onStopSpeedHold: (): void => this.stopSpeedHold(),
      onToggleChapters: (): void => this.toggleChapters(),
      onToggleLibrary: (): void => this.toggleLibrary(),
      onToggleMute: (): Promise<void> => this.handleToggleMute(),
      onTogglePlayPause: (): void => this.handleTogglePlayPause(),
      onToggleSpeedPopover: (): void => this.toggleSpeedPopover(),
      onToggleVolumePopover: (): void => this.toggleVolumePopover(),
      onVolumeChange: (val: number): Promise<void> => this.handleVolumeChange(val),
      playbackDuration: this.playbackDuration,
      playbackPosition: this.playbackPosition,
      showChapters: this.showChapters,
      showLibrary: this.showLibrary,
      showSpeedPopover: this.showSpeedPopover,
      showVolumePopover: this.showVolumePopover,
      skipSec: this.config?.skip_seconds ?? DEFAULT_SKIP_SECONDS,
      volumeLevel: this.volumeLevel,
    });
  }

  public static renderLibrarySection = renderLibrarySection;

  private renderLibrarySection(
    filteredInProgress: InProgressItem[],
    filteredBooks: MediaItem[],
    filteredPodcasts: MediaItem[],
    lang: string,
  ): TemplateResult {
    return renderLibrarySection({
      activeTab: this.activeTab,
      config: this.config,
      currentItem: this.currentItem,
      episodes: this.episodes,
      filteredBooks,
      filteredInProgress,
      filteredPodcasts,
      hasInProgressItems: this.inProgress.length > 0,
      isRefreshing: this.isRefreshing,
      lang,
      onBackToPodcasts: (): void => this.handleBackToPodcasts(),
      onClearSearch: (): void => this.handleClearSearch(),
      onRefresh: (): Promise<void> => this.fetchLibrary(),
      onSearchInput: (e: Event): void => this.handleSearchInput(e),
      onSelectItem: (item: InProgressItem | MediaItem | PodcastEpisode): Promise<void> =>
        this.handleSelectItem(item),
      onSelectPodcast: (podcastId: string): Promise<void> => this.fetchEpisodes(podcastId),
      onTabBooks: (): void => this.handleTabBooks(),
      onTabInProgress: (): void => this.handleTabInProgress(),
      onTabPodcasts: (): void => this.handleTabPodcasts(),
      podcasts: this.podcasts,
      searchQuery: this.searchQuery,
      selectedPodcastId: this.selectedPodcastId,
    });
  }

  public static renderChaptersSection = renderChaptersSection;
  public static scrollToActiveChapter = scrollToActiveChapter;

  private renderChaptersSection(lang: string): TemplateResult {
    return renderChaptersSection({
      chapters: this.chapters,
      currentChapter: this.getCurrentChapter(),
      isLoadingChapters: this.isLoadingChapters,
      lang,
      onChapterClick: (ch: ChapterItem): Promise<void> => this.handleChapterClick(ch),
    });
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
