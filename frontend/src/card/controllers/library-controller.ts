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
import { fetchChapters, fetchEpisodes, fetchLibrary, type LibraryResponse } from '../api.ts';
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
import { filterAvailablePlayers } from '../templates/device-picker.ts';

export interface LibraryControllerOptions {
  getConfig: () => AbstpCardConfig | undefined;
  getHass: () => HomeAssistant | undefined;
  getPlayerOrder?: () => string[];
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

  private libraryFetchGeneration: number = 0;

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
    const fetchGeneration: number = ++this.libraryFetchGeneration;
    this.isRefreshing = true;
    this.host.requestUpdate();
    try {
      const response = await fetchLibrary(hass);
      if (fetchGeneration !== this.libraryFetchGeneration) {
        return;
      }
      this.applyLibraryResponse(response);
    } catch {
      if (fetchGeneration !== this.libraryFetchGeneration) {
        return;
      }
      this.books = [];
      this.podcasts = [];
      this.inProgress = [];
    } finally {
      if (fetchGeneration === this.libraryFetchGeneration) {
        this.isRefreshing = false;
        this.host.requestUpdate();
      }
    }
  }

  private applyLibraryResponse(response: LibraryResponse): void {
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

  private static getSessionId(playerId: string): string {
    return playerId === '' ? 'browser' : playerId;
  }

  private static findAllowedPlayerSession(
    activeSessions: Record<string, ActiveSessionInfo>,
    allowedPlayers: string[],
  ): [string, ActiveSessionInfo] | undefined {
    for (const playerId of allowedPlayers) {
      const session: ActiveSessionInfo | undefined =
        activeSessions[LibraryController.getSessionId(playerId)];
      if (session) {
        return [playerId, session];
      }
    }
    return undefined;
  }

  private resolveActiveSession(
    activeSessions: Record<string, ActiveSessionInfo>,
  ): ActiveSessionInfo | undefined {
    const selectedPlayer: string = this.options.getSelectedPlayer?.() ?? '';
    const selectedSession: ActiveSessionInfo | undefined =
      activeSessions[LibraryController.getSessionId(selectedPlayer)];
    if (selectedSession) {
      return selectedSession;
    }

    const config: AbstpCardConfig | undefined = this.options.getConfig();
    const allowedPlayers: string[] = filterAvailablePlayers(
      this.options.getHass(),
      config,
      this.options.getPlayerOrder?.(),
    );
    const allowedSession: [string, ActiveSessionInfo] | undefined =
      LibraryController.findAllowedPlayerSession(activeSessions, allowedPlayers);
    if (allowedSession) {
      this.options.onSelectedPlayerChange?.(allowedSession[0]);
      return allowedSession[1];
    }
    if (allowedPlayers.length > 0) {
      return undefined;
    }

    const firstActiveId: string | undefined = Object.keys(activeSessions)[0];
    const firstSession: ActiveSessionInfo | undefined =
      firstActiveId === undefined ? undefined : activeSessions[firstActiveId];
    if (firstActiveId === undefined || !firstSession) {
      return undefined;
    }
    const selectedId: string = firstActiveId === 'browser' ? '' : firstActiveId;
    this.options.onSelectedPlayerChange?.(selectedId);
    return firstSession;
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
    const hass: HomeAssistant | undefined = this.options.getHass();
    const selectedPlayer: string = this.options.getSelectedPlayer?.() ?? '';
    const playerEntity = selectedPlayer !== '' ? hass?.states?.[selectedPlayer] : undefined;
    const restoredItemId: string | undefined = playerEntity?.attributes.item_id as
      | string
      | undefined;
    const savedItem: MediaItem | InProgressItem | undefined = restoredItemId
      ? this.findSavedItem(restoredItemId)
      : undefined;
    if (restoredItemId && !savedItem) {
      return;
    }
    const targetItem: MediaItem | InProgressItem | undefined =
      savedItem ?? this.inProgress[0] ?? this.books[0];
    if (!targetItem) {
      return;
    }
    const restoredPos: number | undefined =
      typeof playerEntity?.attributes.current_time === 'number'
        ? (playerEntity.attributes.current_time as number)
        : typeof playerEntity?.attributes.media_position === 'number'
          ? (playerEntity.attributes.media_position as number)
          : undefined;
    const pos: number =
      savedItem && restoredPos !== undefined && restoredPos >= 0
        ? restoredPos
        : resolveInitialPosition(targetItem);
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
