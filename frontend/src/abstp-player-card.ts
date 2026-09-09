import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import {
  type CardPreferenceEvent,
  type LibraryUpdateEvent,
  setCardPreference,
  subscribeCardPreference,
  subscribeLibraryUpdates,
} from './card/api.ts';
import {
  DEFAULT_PLAYBACK_SPEED,
  DEFAULT_SKIP_SECONDS,
  LIBRARY_REFRESH_INTERVAL_MS,
} from './card/constants.ts';
import { AudioController } from './card/controllers/audio-controller.ts';
import { LibraryController } from './card/controllers/library-controller.ts';
import { PlaybackController } from './card/controllers/playback-controller.ts';
import { UiController } from './card/controllers/ui-controller.ts';
import { resolveItemIds } from './card/media.ts';
import { renderChaptersSection, scrollToActiveChapter } from './card/templates/chapters.ts';
import { filterAvailablePlayers, renderDevicePicker } from './card/templates/device-picker.ts';
import { renderHeroPlayer } from './card/templates/hero.ts';
import { renderLibrarySection } from './card/templates/library.ts';
import { audiobookshelfIcon } from './icons.ts';
import { cardStyles } from './styles.ts';
import type {
  AbstpCardConfig,
  ChapterItem,
  HomeAssistant,
  HomeAssistantConnection,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from './types.ts';
import './abstp-player-card-editor.ts';

@customElement('abstp-player-card')
export class AbstpPlayerCard extends LitElement {
  public static override styles: CSSResult = cardStyles;

  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config?: AbstpCardConfig;

  public readonly ui: UiController;
  public readonly library: LibraryController;
  public readonly audio: AudioController;
  public readonly playback: PlaybackController;

  private readonly _cardSize: number = 5;
  private _prevShowChapters: boolean = false;
  private _prevChaptersCount: number = 0;
  private cardPreferenceUnsubscribe: (() => void) | null = null;
  private libraryUpdateUnsubscribe: (() => void) | null = null;
  private libraryUpdateConnection: HomeAssistantConnection | undefined;
  private libraryRefreshInterval: number | null = null;
  private cardPreferenceConnection: HomeAssistantConnection | undefined;
  private cardPreferenceId: string = '';
  private cardPlayerOrder: string[] = [];
  private cardPreferenceSelectedPlayer: string | null = null;
  private cardPreferenceReady: boolean = false;
  private cardPreferenceRepairing: boolean = false;

  public constructor() {
    super();

    this.audio = new AudioController(this, {
      getConfig: (): AbstpCardConfig | undefined => this.config,
    });

    this.playback = new PlaybackController(this, {
      audio: this.audio,
      getConfig: (): AbstpCardConfig | undefined => this.config,
      getHass: (): HomeAssistant | undefined => this.hass,
      getPlayerOrder: (): string[] => this.cardPlayerOrder,
      onChaptersRequired: (itemId: string): void => {
        if (this.library.chaptersBookId !== itemId) {
          this.library.clearChapters();
          void this.library.fetchChapters(itemId);
        }
      },
      onClearChapters: (): void => {
        this.library.clearChapters();
        this.ui.showChapters = false;
      },
    });

    this.library = new LibraryController(this, {
      getConfig: (): AbstpCardConfig | undefined => this.config,
      getCurrentItem: (): MediaItem | PodcastEpisode | InProgressItem | null =>
        this.playback.currentItem,
      getHass: (): HomeAssistant | undefined => this.hass,
      getIsPlaying: (): boolean => this.playback.isPlaying || this.playback.isBuffering,
      getPlayerOrder: (): string[] => this.cardPlayerOrder,
      getSelectedPlayer: (): string => this.playback.selectedPlayer,
      onChaptersUnavailable: (): void => {
        this.ui.showChapters = false;
      },
      onRestoreItem: (
        item: MediaItem | InProgressItem,
        pos: number,
        dur: number,
        isPlaying: boolean,
        speed?: number,
      ): void => {
        this.playback.restoreItem(item, pos, dur, isPlaying, speed);
      },
      onSelectedPlayerChange: (playerId: string): void => {
        this.playback.selectedPlayer = playerId;
      },
    });

    this.ui = new UiController(this, {
      onApplySpeed: async (speedOnOpen: number): Promise<void> => {
        await this.playback.applySpeedIfChanged(speedOnOpen);
      },
      onChaptersOpened: async (): Promise<void> => {
        if (this.playback.currentItem) {
          const { itemId } = resolveItemIds(this.playback.currentItem);
          if (this.library.chaptersBookId !== itemId) {
            await this.library.fetchChapters(itemId);
          }
        }
      },
      onPageHide: (): void => {},
    });
  }

  public static async getConfigElement(): Promise<HTMLElement> {
    return document.createElement('abstp-player-card-editor');
  }

  public static getStubConfig(): Record<string, unknown> {
    return {
      card_id: crypto.randomUUID(),
      default_speed: DEFAULT_PLAYBACK_SPEED,
      skip_seconds: DEFAULT_SKIP_SECONDS,
      type: 'custom:abstp-player-card',
    };
  }

  public getCardSize(): number {
    return this._cardSize;
  }

  public setConfig(config: AbstpCardConfig): void {
    const previousSelectedPlayer: string = this.playback.selectedPlayer;
    this.config = config;
    this.playback.initSettings();
    if (previousSelectedPlayer) {
      this.playback.selectedPlayer = previousSelectedPlayer;
    }
  }

  protected override updated(changedProps: Map<string | number | symbol, unknown>): void {
    super.updated(changedProps);
    const chaptersOpened: boolean = this.ui.showChapters && !this._prevShowChapters;
    const chaptersLoaded: boolean =
      this.ui.showChapters && this.library.chapters.length > 0 && this._prevChaptersCount === 0;

    this._prevShowChapters = this.ui.showChapters;
    this._prevChaptersCount = this.library.chapters.length;

    if (chaptersOpened || chaptersLoaded) {
      void this.updateComplete.then((): void => {
        requestAnimationFrame((): void => {
          this.scrollToActiveChapter();
        });
      });
    }
    if (!this.hass) {
      return;
    }
    if (changedProps.has('config')) {
      void this.ensureCardPreferenceSubscription();
      void this.ensureLibraryUpdateSubscription();
      void this.reconcileCardPreference();
    }
    if (!changedProps.has('hass')) {
      return;
    }
    if (!this.library.libraryLoaded) {
      this.library.libraryLoaded = true;
      void this.ensureLibraryUpdateSubscription();
      if (!this.config?.card_id || !this.hass.connection) {
        void this.library.fetchLibrary();
      } else {
        void this.initializeCardState();
      }
    } else {
      void this.ensureCardPreferenceSubscription();
      void this.ensureLibraryUpdateSubscription();
    }
    this.playback.syncPlayerState();
    void this.reconcileCardPreference();
  }

  public scrollToActiveChapter(): void {
    scrollToActiveChapter(this.renderRoot);
  }

  protected override render(): TemplateResult {
    const lang: string = this.hass?.language ?? 'en';
    const allowedPlayers: string[] = filterAvailablePlayers(
      this.hass,
      this.config,
      this.cardPlayerOrder,
    );
    const filteredInProgress: InProgressItem[] = this.library.getFilteredInProgress();
    const filteredBooks: MediaItem[] = this.library.getFilteredBooks();
    const filteredPodcasts: MediaItem[] = this.library.getFilteredPodcasts();
    const playerEntity = this.playback.selectedPlayer
      ? this.hass?.states[this.playback.selectedPlayer]
      : undefined;
    const isTargetUnavailable: boolean =
      Boolean(this.hass) &&
      (!playerEntity ||
        playerEntity.state === 'unavailable' ||
        playerEntity.state === 'unknown' ||
        playerEntity.attributes.target_available === false);

    return html`
      <ha-card class="${isTargetUnavailable ? 'unavailable' : ''}">
        <div class="card-brand-icon" aria-hidden="true">${audiobookshelfIcon}</div>
        ${this.renderHeroPlayer(lang, allowedPlayers, isTargetUnavailable)}

        ${
          isTargetUnavailable
            ? html``
            : this.ui.showLibrary
              ? this.renderLibrarySection(filteredInProgress, filteredBooks, filteredPodcasts, lang)
              : this.ui.showChapters
                ? this.renderChaptersSection(lang)
                : html``
        }
      </ha-card>
    `;
  }

  private async initializeCardState(): Promise<void> {
    const libraryPromise: Promise<void> = this.library.fetchLibrary();
    await Promise.all([
      this.ensureCardPreferenceSubscription(),
      this.ensureLibraryUpdateSubscription(),
    ]);
    await libraryPromise;
  }

  private async ensureLibraryUpdateSubscription(): Promise<void> {
    const hass: HomeAssistant | undefined = this.hass;
    const connection: HomeAssistantConnection | undefined = hass?.connection;
    if (!hass || !connection || this.libraryUpdateConnection === connection) {
      return;
    }
    this.libraryUpdateUnsubscribe?.();
    this.libraryUpdateUnsubscribe = null;
    this.libraryUpdateConnection = connection;
    try {
      const unsubscribe: () => void = await subscribeLibraryUpdates(
        hass,
        (message: LibraryUpdateEvent): void => this.library.applyLibraryUpdate(message),
      );
      if (this.hass?.connection !== connection) {
        unsubscribe();
        return;
      }
      this.libraryUpdateUnsubscribe = unsubscribe;
    } catch {
      this.libraryUpdateConnection = undefined;
    }
  }

  private refreshLibraryInBackground(): void {
    if (this.playback.isPlaybackActive() || this.library.isFetchingLibrary) {
      return;
    }
    void this.library.fetchLibrary(true);
  }

  private handleVisibilityChange = (): void => {
    if (document.visibilityState === 'visible') {
      this.refreshLibraryInBackground();
    }
  };

  public override connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.libraryRefreshInterval = window.setInterval(
      (): void => this.refreshLibraryInBackground(),
      LIBRARY_REFRESH_INTERVAL_MS,
    );
  }

  private async ensureCardPreferenceSubscription(): Promise<void> {
    const hass: HomeAssistant | undefined = this.hass;
    const connection: HomeAssistantConnection | undefined = hass?.connection;
    const cardId: string | undefined = this.config?.card_id;
    if (!hass || !connection || !cardId) {
      return;
    }
    if (this.cardPreferenceConnection === connection && this.cardPreferenceId === cardId) {
      return;
    }
    this.cardPreferenceUnsubscribe?.();
    this.cardPreferenceUnsubscribe = null;
    this.cardPreferenceConnection = connection;
    this.cardPreferenceId = cardId;
    this.cardPreferenceSelectedPlayer = null;
    this.cardPreferenceReady = false;

    try {
      const unsubscribe: () => void = await subscribeCardPreference(
        hass,
        cardId,
        (message: CardPreferenceEvent): void => this.handleCardPreferenceEvent(message),
      );
      if (this.hass?.connection !== connection || this.config?.card_id !== cardId) {
        unsubscribe();
        return;
      }
      this.cardPreferenceUnsubscribe = unsubscribe;
    } catch {
      this.cardPreferenceConnection = undefined;
      this.cardPreferenceId = '';
    }
  }

  private handleCardPreferenceEvent(message: CardPreferenceEvent): void {
    const event = message;
    if (event.card_id !== this.config?.card_id) {
      return;
    }

    this.cardPreferenceReady = true;
    this.cardPlayerOrder = event.available_players;
    const allowedPlayers: string[] = this.getCardPreferencePlayers();
    const availablePlayers: Set<string> = new Set(event.available_players);
    const selectedPlayer: string | null = event.selected_player;
    const isPlayerAvailable = (id: string): boolean =>
      id === '' || !event.available_players_known || availablePlayers.has(id);
    const selectedIsValid: boolean =
      selectedPlayer !== null &&
      allowedPlayers.includes(selectedPlayer) &&
      isPlayerAvailable(selectedPlayer);
    const nextPlayer: string = selectedIsValid
      ? (selectedPlayer ?? '')
      : (allowedPlayers.find(isPlayerAvailable) ?? '');
    this.cardPreferenceSelectedPlayer = nextPlayer;
    this.requestUpdate();
    if (selectedPlayer !== null && !selectedIsValid && !this.cardPreferenceRepairing) {
      this.cardPreferenceRepairing = true;
      void this.saveCardPreference(nextPlayer).finally((): void => {
        this.cardPreferenceRepairing = false;
      });
    }
    if (this.playback.selectedPlayer !== nextPlayer) {
      void this.playback.selectPlayer(nextPlayer).then((): void => {
        void this.library.fetchLibrary();
      });
    }
  }

  private async reconcileCardPreference(): Promise<void> {
    if (!this.cardPreferenceReady || this.cardPreferenceRepairing || !this.hass) {
      return;
    }
    const allowedPlayers: string[] = this.getCardPreferencePlayers();
    const availablePlayers: Set<string> = new Set(
      Object.keys(this.hass.states).filter((id: string): boolean =>
        id.startsWith('media_player.abstp_'),
      ),
    );
    const isPlayerAvailable = (id: string): boolean => id === '' || availablePlayers.has(id);
    const selectedPlayer: string = this.playback.selectedPlayer;
    const preferredPlayer: string | null = this.cardPreferenceSelectedPlayer;
    if (preferredPlayer !== null && allowedPlayers.includes(preferredPlayer)) {
      if (selectedPlayer === preferredPlayer || !isPlayerAvailable(preferredPlayer)) {
        return;
      }
      this.cardPreferenceRepairing = true;
      try {
        await this.playback.selectPlayer(preferredPlayer);
      } finally {
        this.cardPreferenceRepairing = false;
      }
      return;
    }
    const selectedIsValid: boolean =
      allowedPlayers.includes(selectedPlayer) && isPlayerAvailable(selectedPlayer);
    if (selectedIsValid) {
      return;
    }
    const nextPlayer: string = allowedPlayers.find(isPlayerAvailable) ?? '';
    if (selectedPlayer === nextPlayer) {
      return;
    }
    this.cardPreferenceRepairing = true;
    try {
      this.cardPreferenceSelectedPlayer = nextPlayer;
      await this.playback.selectPlayer(nextPlayer);
      await this.saveCardPreference(nextPlayer);
    } finally {
      this.cardPreferenceRepairing = false;
    }
  }

  private getCardPreferencePlayers(): string[] {
    return filterAvailablePlayers(this.hass, this.config, this.cardPlayerOrder);
  }

  private async selectPlayerAndSave(playerId: string): Promise<void> {
    this.cardPreferenceSelectedPlayer = playerId;
    await this.playback.selectPlayer(playerId);
    await this.saveCardPreference(playerId);
  }

  private async saveCardPreference(selectedPlayer: string | null): Promise<void> {
    const hass: HomeAssistant | undefined = this.hass;
    const cardId: string | undefined = this.config?.card_id;
    if (!hass || !cardId) {
      return;
    }
    try {
      await setCardPreference(hass, cardId, selectedPlayer);
    } catch {
      return;
    }
  }

  public override disconnectedCallback(): void {
    this.cardPreferenceUnsubscribe?.();
    this.cardPreferenceUnsubscribe = null;
    this.libraryUpdateUnsubscribe?.();
    this.libraryUpdateUnsubscribe = null;
    this.libraryUpdateConnection = undefined;
    if (this.libraryRefreshInterval !== null) {
      window.clearInterval(this.libraryRefreshInterval);
      this.libraryRefreshInterval = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    this.cardPreferenceConnection = undefined;
    this.cardPreferenceId = '';
    this.cardPlayerOrder = [];
    this.cardPreferenceSelectedPlayer = null;
    this.cardPreferenceReady = false;
    super.disconnectedCallback();
  }

  private renderDevicePicker(lang: string, allowedPlayers: string[]): TemplateResult {
    if (this.config?.card_id && this.hass?.connection && !this.cardPreferenceReady) {
      return html`<div class="device-picker-row device-picker-row-pending" aria-hidden="true"></div>`;
    }
    return renderDevicePicker({
      allowedPlayers,
      config: this.config,
      hass: this.hass,
      lang,
      onSelectPlayer: (id: string): void => {
        this.ui.showDeviceMenu = false;
        void this.selectPlayerAndSave(id);
      },
      onToggleDeviceMenu: (): void => this.ui.toggleDeviceMenu(),
      selectedPlayer: this.playback.selectedPlayer,
      showDeviceMenu: this.ui.showDeviceMenu,
    });
  }

  private renderHeroPlayer(
    lang: string,
    allowedPlayers: string[],
    isTargetUnavailable: boolean,
  ): TemplateResult {
    return renderHeroPlayer({
      currentChapter: this.library.getCurrentChapter(
        this.playback.playbackPosition,
        this.playback.currentItem,
      ),
      currentItem: this.playback.currentItem,
      currentSpeed: this.audio.currentSpeed,
      devicePicker: this.renderDevicePicker(lang, allowedPlayers),
      hasNoChapters: this.library.hasNoNavigableChapters(this.playback.currentItem),
      isBuffering: this.playback.isBuffering,
      isMuted: this.audio.isMuted,
      isPlaying: this.playback.isPlaying,
      isTargetUnavailable,
      lang,
      onSeekChange: (targetPos: number): Promise<void> => this.playback.seek(targetPos),
      onSeekInput: (targetPos: number): void => {
        this.playback.setPlaybackPosition(targetPos);
      },
      onSkip: (sec: number): Promise<void> => this.playback.skip(sec),
      onSpeedAdjust: (spd: number): void => {
        this.audio.adjustSpeed(spd);
      },
      onStartSpeedHold: (step: number): void => {
        this.audio.startSpeedHold(step);
      },
      onStopSpeedHold: (): void => this.audio.stopSpeedHold(),
      onToggleChapters: (): void => {
        this.ui.toggleChapters(this.library.hasNoNavigableChapters(this.playback.currentItem));
      },
      onToggleLibrary: (): void => this.ui.toggleLibrary(),
      onToggleMute: (): Promise<void> =>
        this.audio.toggleMute(this.playback.selectedPlayer, this.hass),
      onTogglePlayPause: (): void => this.playback.togglePlayPause(),
      onToggleSpeedPopover: (): void => this.ui.toggleSpeedPopover(this.audio.currentSpeed),
      onToggleVolumePopover: (): void => this.ui.toggleVolumePopover(),
      onVolumeChange: (val: number): Promise<void> =>
        this.audio.setVolume(val, this.playback.selectedPlayer, this.hass),
      playbackDuration: this.playback.playbackDuration,
      playbackPosition: this.playback.playbackPosition,
      showChapters: this.ui.showChapters,
      showLibrary: this.ui.showLibrary,
      showSpeedPopover: this.ui.showSpeedPopover,
      showVolumePopover: this.ui.showVolumePopover,
      skipSec: this.config?.skip_seconds ?? DEFAULT_SKIP_SECONDS,
      volumeLevel: this.audio.volumeLevel,
    });
  }

  private renderLibrarySection(
    filteredInProgress: InProgressItem[],
    filteredBooks: MediaItem[],
    filteredPodcasts: MediaItem[],
    lang: string,
  ): TemplateResult {
    return renderLibrarySection({
      activeTab: this.library.activeTab,
      config: this.config,
      currentItem: this.playback.currentItem,
      episodes: this.library.episodes,
      filteredBooks,
      filteredInProgress,
      filteredPodcasts,
      hasInProgressItems: this.library.inProgress.length > 0,
      isRefreshing: this.library.isRefreshing,
      lang,
      onBackToPodcasts: (): void => this.library.backToPodcasts(),
      onClearSearch: (): void => this.library.clearSearch(),
      onRefresh: (): Promise<void> => this.library.fetchLibrary(),
      onSearchInput: (e: Event): void =>
        this.library.setSearchQuery((e.target as HTMLInputElement).value),
      onSelectItem: (item: InProgressItem | MediaItem | PodcastEpisode): Promise<void> =>
        this.playback.selectItem(item),
      onSelectPodcast: (podcastId: string): Promise<void> => this.library.fetchEpisodes(podcastId),
      onTabBooks: (): void => this.library.setActiveTab('books'),
      onTabInProgress: (): void => this.library.setActiveTab('in_progress'),
      onTabPodcasts: (): void => this.library.setActiveTab('podcasts'),
      podcasts: this.library.podcasts,
      searchQuery: this.library.searchQuery,
      selectedPodcastId: this.library.selectedPodcastId,
    });
  }

  private renderChaptersSection(lang: string): TemplateResult {
    return renderChaptersSection({
      chapters: this.library.chapters,
      currentChapter: this.library.getCurrentChapter(
        this.playback.playbackPosition,
        this.playback.currentItem,
      ),
      isLoadingChapters: this.library.isLoadingChapters,
      lang,
      onChapterClick: (ch: ChapterItem): Promise<void> => this.playback.seek(ch.start),
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
