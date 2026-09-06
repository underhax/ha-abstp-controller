import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import { DEFAULT_PLAYBACK_SPEED, DEFAULT_SKIP_SECONDS } from './card/constants.ts';
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

  public constructor() {
    super();

    this.audio = new AudioController(this, {
      getConfig: (): AbstpCardConfig | undefined => this.config,
    });

    this.playback = new PlaybackController(this, {
      audio: this.audio,
      getConfig: (): AbstpCardConfig | undefined => this.config,
      getHass: (): HomeAssistant | undefined => this.hass,
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
      onPageHide: (): void => {
        if (this.playback.selectedPlayer === '') {
          void this.playback.stop();
        }
      },
    });
  }

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

  public setConfig(config: AbstpCardConfig): void {
    this.config = config;
    this.playback.initSettings();
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
    if (!changedProps.has('hass') || !this.hass) {
      return;
    }
    if (!this.library.libraryLoaded) {
      this.library.libraryLoaded = true;
      void this.library.fetchLibrary();
    }
    this.playback.syncPlayerState();
  }

  public scrollToActiveChapter(): void {
    scrollToActiveChapter(this.renderRoot);
  }

  protected override render(): TemplateResult {
    const lang: string = this.hass?.language ?? 'en';
    const allowedPlayers: string[] = filterAvailablePlayers(this.hass, this.config);
    const filteredInProgress: InProgressItem[] = this.library.getFilteredInProgress();
    const filteredBooks: MediaItem[] = this.library.getFilteredBooks();
    const filteredPodcasts: MediaItem[] = this.library.getFilteredPodcasts();

    return html`
      <ha-card>
        <div class="card-brand-icon" aria-hidden="true">${audiobookshelfIcon}</div>
        ${this.renderHeroPlayer(lang, allowedPlayers)}

        ${
          this.ui.showLibrary
            ? this.renderLibrarySection(filteredInProgress, filteredBooks, filteredPodcasts, lang)
            : this.ui.showChapters
              ? this.renderChaptersSection(lang)
              : html``
        }
      </ha-card>
    `;
  }

  private renderDevicePicker(lang: string, allowedPlayers: string[]): TemplateResult {
    return renderDevicePicker({
      allowedPlayers,
      config: this.config,
      hass: this.hass,
      lang,
      onSelectPlayer: (id: string): void => {
        void this.playback.selectPlayer(id);
      },
      onToggleDeviceMenu: (): void => this.ui.toggleDeviceMenu(),
      selectedPlayer: this.playback.selectedPlayer,
      showDeviceMenu: this.ui.showDeviceMenu,
    });
  }

  private renderHeroPlayer(lang: string, allowedPlayers: string[]): TemplateResult {
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
        this.audio.toggleMute(this.playback.selectedPlayer, this.hass, this.playback.engine.player),
      onTogglePlayPause: (): void => this.playback.togglePlayPause(),
      onToggleSpeedPopover: (): void => this.ui.toggleSpeedPopover(this.audio.currentSpeed),
      onToggleVolumePopover: (): void => this.ui.toggleVolumePopover(),
      onVolumeChange: (val: number): Promise<void> =>
        this.audio.setVolume(
          val,
          this.playback.selectedPlayer,
          this.hass,
          this.playback.engine.player,
        ),
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
