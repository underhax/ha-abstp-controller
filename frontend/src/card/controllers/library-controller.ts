import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type {
  AbstpCardConfig,
  ActiveSessionInfo,
  ChapterItem,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from '../../types.ts';
import { fetchChapters, fetchEpisodes, fetchLibrary } from '../api.ts';
import {
  filterBooks,
  filterInProgress,
  filterPodcasts,
  findSavedItem,
  getCurrentChapter,
  hasNoNavigableChapters,
  isPodcastItem,
  resolveInitialPosition,
  resolveItemIds,
} from '../media.ts';
import { getCardStorageKey, getStorageItem, setStorageItem } from '../storage.ts';

export interface LibraryControllerOptions {
  getConfig: () => AbstpCardConfig | undefined;
  getHass: () => HomeAssistant | undefined;
  getCurrentItem?: () => MediaItem | PodcastEpisode | InProgressItem | null;
  getSelectedPlayer?: () => string;
  getIsPlaying?: () => boolean;
  onRestoreItem?: (
    item: MediaItem | InProgressItem,
    position: number,
    duration: number,
    isPlaying: boolean,
    speed?: number,
  ) => void;
  onSelectedPlayerChange?: (playerId: string) => void;
  onChaptersUnavailable?: () => void;
}

export class LibraryController implements ReactiveController {
  private readonly host: ReactiveControllerHost;
  private readonly options: LibraryControllerOptions;

  public books: MediaItem[] = [];
  public podcasts: MediaItem[] = [];
  public inProgress: InProgressItem[] = [];
  public episodes: Record<string, PodcastEpisode[]> = {};
  public chapters: ChapterItem[] = [];
  public chaptersBookId: string = '';
  public selectedPodcastId: string | null = null;
  public searchQuery: string = '';
  public filterProgress: 'all' | 'in_progress' | 'finished' = 'all';
  public activeTab: 'in_progress' | 'books' | 'podcasts' = 'in_progress';
  public isRefreshing: boolean = false;
  public isLoadingChapters: boolean = false;
  public libraryLoaded: boolean = false;
  public userSelectedTab: boolean = false;

  public constructor(host: ReactiveControllerHost, options: LibraryControllerOptions) {
    this.host = host;
    this.options = options;
    this.host.addController(this);
  }

  public hostDisconnected(): void {
    this.isRefreshing = false;
  }

  public async fetchLibrary(): Promise<void> {
    const hass: HomeAssistant | undefined = this.options.getHass();
    if (!hass) {
      return;
    }
    this.isRefreshing = true;
    this.host.requestUpdate();
    try {
      const response = await fetchLibrary(hass);
      this.books = response.books;
      this.podcasts = response.podcasts;
      this.inProgress = response.in_progress ?? [];
      const config: AbstpCardConfig | undefined = this.options.getConfig();
      if (!this.userSelectedTab) {
        if (this.inProgress.length > 0) {
          this.activeTab = 'in_progress';
        } else if (!config?.hide_books) {
          this.activeTab = 'books';
        } else if (!config?.hide_podcasts) {
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
      this.host.requestUpdate();
    }
  }

  public async fetchEpisodes(podcastId: string): Promise<void> {
    const hass: HomeAssistant | undefined = this.options.getHass();
    if (!hass) {
      return;
    }
    this.selectedPodcastId = podcastId;
    this.isRefreshing = true;
    this.host.requestUpdate();
    try {
      const response = await fetchEpisodes(hass, podcastId);
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
      this.host.requestUpdate();
    }
  }

  public async fetchChapters(targetBookId?: string): Promise<void> {
    const hass: HomeAssistant | undefined = this.options.getHass();
    if (!hass) {
      return;
    }
    const currentItem: MediaItem | PodcastEpisode | InProgressItem | null | undefined =
      this.options.getCurrentItem?.();
    if (isPodcastItem(currentItem ?? null)) {
      this.clearChapters();
      this.options.onChaptersUnavailable?.();
      return;
    }
    const bookId: string = targetBookId ?? (currentItem ? resolveItemIds(currentItem).itemId : '');
    if (!bookId) {
      return;
    }
    if (this.chaptersBookId === bookId && this.chapters.length > 0) {
      return;
    }
    this.isLoadingChapters = true;
    this.host.requestUpdate();
    try {
      const response = await fetchChapters(hass, bookId);
      this.chapters = response.chapters;
      this.chaptersBookId = bookId;
      if (this.chapters.length <= 1) {
        this.options.onChaptersUnavailable?.();
      }
    } catch {
      this.chapters = [];
      this.chaptersBookId = bookId;
      this.options.onChaptersUnavailable?.();
    } finally {
      this.isLoadingChapters = false;
      this.host.requestUpdate();
    }
  }

  public clearChapters(): void {
    this.chapters = [];
    this.chaptersBookId = '';
    this.host.requestUpdate();
  }

  public restoreActiveOrSavedItem(activeSessions: Record<string, ActiveSessionInfo>): void {
    if (this.restoreFromActiveSession(activeSessions)) {
      return;
    }
    const currentItem: MediaItem | PodcastEpisode | InProgressItem | null | undefined =
      this.options.getCurrentItem?.();
    if (currentItem) {
      if (!this.options.getIsPlaying?.()) {
        const updatedItem: MediaItem | InProgressItem | undefined = this.findSavedItem(
          currentItem.id,
        );
        if (updatedItem) {
          const newPos: number = resolveInitialPosition(updatedItem);
          this.options.onRestoreItem?.(updatedItem, newPos, updatedItem.duration || 0, false);
          if (!isPodcastItem(updatedItem)) {
            void this.fetchChapters(updatedItem.id);
          }
        }
      }
      return;
    }
    this.restoreFromSavedOrDefault();
  }

  private resolveActiveSession(
    activeSessions: Record<string, ActiveSessionInfo>,
  ): ActiveSessionInfo | undefined {
    const selectedPlayer: string = this.options.getSelectedPlayer?.() ?? '';
    if (selectedPlayer && activeSessions[selectedPlayer]) {
      return activeSessions[selectedPlayer];
    }
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    if (config?.player_entity && activeSessions[config.player_entity]) {
      this.options.onSelectedPlayerChange?.(config.player_entity);
      return activeSessions[config.player_entity];
    }
    const allowedPlayers: string[] | undefined = config?.player_entities;
    if (allowedPlayers && allowedPlayers.length > 0) {
      const match: string | undefined = allowedPlayers.find((id: string): boolean =>
        Boolean(activeSessions[id]),
      );
      if (match) {
        this.options.onSelectedPlayerChange?.(match);
        return activeSessions[match];
      }
      return undefined;
    }
    if (config?.player_entity) {
      return undefined;
    }
    const activeEntityIds: string[] = Object.keys(activeSessions);
    if (activeEntityIds.length > 0) {
      const firstActiveId: string | undefined = activeEntityIds[0];
      if (firstActiveId !== undefined && activeSessions[firstActiveId]) {
        this.options.onSelectedPlayerChange?.(firstActiveId);
        return activeSessions[firstActiveId];
      }
    }
    return undefined;
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
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    setStorageItem(getCardStorageKey('last_item_id', config), matchedItem.id);
    this.options.onRestoreItem?.(
      matchedItem,
      activeSession.current_time,
      matchedItem.duration,
      true,
      activeSession.speed,
    );
    if (activeSession.episode_id || isPodcastItem(matchedItem)) {
      this.clearChapters();
      this.options.onChaptersUnavailable?.();
    } else {
      void this.fetchChapters(activeSession.item_id);
    }
    return true;
  }

  private restoreFromSavedOrDefault(): void {
    const config: AbstpCardConfig | undefined = this.options.getConfig();
    const lastItemId: string | null = getStorageItem(getCardStorageKey('last_item_id', config));
    const savedItem: MediaItem | InProgressItem | undefined = lastItemId
      ? this.findSavedItem(lastItemId)
      : undefined;
    const targetItem: MediaItem | InProgressItem | undefined =
      savedItem ?? this.inProgress[0] ?? this.books[0];
    if (!targetItem) {
      return;
    }
    const pos: number = resolveInitialPosition(targetItem);
    this.options.onRestoreItem?.(targetItem, pos, targetItem.duration || 0, false);
    if (isPodcastItem(targetItem)) {
      this.clearChapters();
      this.options.onChaptersUnavailable?.();
    } else {
      void this.fetchChapters(targetItem.id);
    }
  }

  public findSavedItem(itemId: string): MediaItem | InProgressItem | undefined {
    return findSavedItem(itemId, this.inProgress, this.books, this.podcasts);
  }

  public getFilteredInProgress(): InProgressItem[] {
    return filterInProgress(this.inProgress, this.searchQuery);
  }

  public getFilteredBooks(): MediaItem[] {
    return filterBooks(this.books, this.searchQuery, this.filterProgress);
  }

  public getFilteredPodcasts(): MediaItem[] {
    return filterPodcasts(this.podcasts, this.searchQuery);
  }

  public getCurrentChapter(
    pos: number,
    item: MediaItem | PodcastEpisode | InProgressItem | null,
  ): ChapterItem | null {
    return getCurrentChapter(this.chapters, pos, item);
  }

  public hasNoNavigableChapters(item: MediaItem | PodcastEpisode | InProgressItem | null): boolean {
    return hasNoNavigableChapters(item, this.chapters);
  }

  public setActiveTab(tab: 'in_progress' | 'books' | 'podcasts'): void {
    this.userSelectedTab = true;
    this.activeTab = tab;
    if (tab !== 'podcasts') {
      this.selectedPodcastId = null;
    }
    this.host.requestUpdate();
  }

  public backToPodcasts(): void {
    this.selectedPodcastId = null;
    this.host.requestUpdate();
  }

  public setSearchQuery(query: string): void {
    this.searchQuery = query;
    this.host.requestUpdate();
  }

  public clearSearch(): void {
    this.searchQuery = '';
    this.host.requestUpdate();
  }
}
