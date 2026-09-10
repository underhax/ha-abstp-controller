import type { ReactiveControllerHost } from 'lit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryController } from '../src/card/controllers/library-controller.ts';
import type {
  AbstpCardConfig,
  ChapterItem,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from '../src/types.ts';

describe('LibraryController', (): void => {
  let host: ReactiveControllerHost;
  let mockConfig: AbstpCardConfig;
  let mockHass: HomeAssistant;
  let library: LibraryController;

  beforeEach((): void => {
    host = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    mockConfig = {
      default_speed: 1.0,
      type: 'custom:abstp-player-card',
    };
    mockHass = {
      callWS: vi.fn(),
    } as unknown as HomeAssistant;

    library = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
    });
  });

  it('initializes with default library state', (): void => {
    expect(library.activeTab).toBe('in_progress');
    expect(library.filterProgress).toBe('all');
    expect(library.searchQuery).toBe('');
    expect(library.books).toEqual([]);
    expect(library.podcasts).toEqual([]);
    expect(library.inProgress).toEqual([]);
    expect(library.selectedPodcastId).toBeNull();
  });

  it('switches tabs and tracks user tab selection', (): void => {
    library.setActiveTab('books');
    expect(library.activeTab).toBe('books');
    expect(library.userSelectedTab).toBe(true);

    library.setActiveTab('podcasts');
    expect(library.activeTab).toBe('podcasts');
  });

  it('navigates back to podcasts from episode list', (): void => {
    library.activeTab = 'podcasts';
    library.selectedPodcastId = 'pod_123';

    library.backToPodcasts();
    expect(library.selectedPodcastId).toBeNull();
    expect(library.activeTab).toBe('podcasts');
  });

  it('sets and clears search query', (): void => {
    library.setSearchQuery('galaxy');
    expect(library.searchQuery).toBe('galaxy');

    library.clearSearch();
    expect(library.searchQuery).toBe('');
  });

  it('filters in-progress items by search query', (): void => {
    library.inProgress = [
      {
        author: 'Frank Herbert',
        cover_url: 'https://example.com/dune.jpg',
        current_time: 100,
        duration: 1000,
        id: 'book_1',
        media_type: 'book',
        progress: 100,
        title: 'Dune',
      },
      {
        author: 'Dan Carlin',
        cover_url: 'https://example.com/hardcore.jpg',
        current_time: 200,
        duration: 2000,
        episode_id: 'ep_1',
        episode_title: 'Supernova in the East',
        id: 'pod_1',
        media_type: 'podcast',
        progress: 200,
        title: 'Hardcore History',
      },
    ];

    library.setSearchQuery('dune');
    let filtered: InProgressItem[] = library.getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('book_1');

    library.setSearchQuery('supernova');
    filtered = library.getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('pod_1');

    library.setSearchQuery('unknown');
    expect(library.getFilteredInProgress()).toHaveLength(0);
  });

  it('filters books by search query and progress filter', (): void => {
    library.books = [
      {
        author: 'Isaac Asimov',
        cover_url: '',
        duration: 3600,
        id: 'b1',
        is_finished: false,
        media_type: 'book',
        progress: 1200,
        title: 'Foundation',
      },
      {
        author: 'Arthur C. Clarke',
        cover_url: '',
        duration: 4000,
        id: 'b2',
        is_finished: true,
        media_type: 'book',
        progress: 4000,
        title: '2001: A Space Odyssey',
      },
    ];

    library.filterProgress = 'finished';
    let filtered: MediaItem[] = library.getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('b2');

    library.filterProgress = 'in_progress';
    filtered = library.getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('b1');

    library.filterProgress = 'all';
    library.setSearchQuery('space');
    filtered = library.getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('b2');
  });

  it('filters podcasts by search query', (): void => {
    library.podcasts = [
      {
        author: 'Host A',
        cover_url: '',
        duration: 1800,
        id: 'p1',
        media_type: 'podcast',
        progress: 0,
        title: 'Tech Talk',
      },
      {
        author: 'Host B',
        cover_url: '',
        duration: 2400,
        id: 'p2',
        media_type: 'podcast',
        progress: 0,
        title: 'Science Hour',
      },
    ];

    library.setSearchQuery('tech');
    const filtered: MediaItem[] = library.getFilteredPodcasts();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('p1');
  });

  it('fetches library data and updates controller state', async (): Promise<void> => {
    const mockData = {
      books: [
        {
          author: 'A1',
          cover_url: '',
          duration: 100,
          id: 'b1',
          media_type: 'book' as const,
          progress: 0,
          title: 'Book 1',
        },
      ],
      in_progress: [],
      podcasts: [],
    };
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue(mockData);

    await library.fetchLibrary();

    expect(library.books).toHaveLength(1);
    expect(library.books[0]?.id).toBe('b1');
    expect(library.isRefreshing).toBe(false);
  });

  it('handles library fetch failure gracefully', async (): Promise<void> => {
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await library.fetchLibrary();

    expect(library.isRefreshing).toBe(false);
  });

  it('ignores stale library responses after a newer response restores the current item', async (): Promise<void> => {
    let resolveFirst: ((value: object) => void) | undefined;
    let resolveSecond: ((value: object) => void) | undefined;
    const firstResponse: Promise<object> = new Promise((resolve): void => {
      resolveFirst = resolve;
    });
    const secondResponse: Promise<object> = new Promise((resolve): void => {
      resolveSecond = resolve;
    });
    const onRestoreItem = vi.fn();
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.living_room',
      onRestoreItem,
    });
    const callWS = mockHass.callWS as ReturnType<typeof vi.fn>;
    callWS
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse)
      .mockResolvedValue({ chapters: [] });

    const firstFetch: Promise<void> = customLibrary.fetchLibrary();
    const secondFetch: Promise<void> = customLibrary.fetchLibrary();

    resolveSecond?.({
      active_sessions: {
        'media_player.living_room': {
          current_time: 200,
          entity_id: 'media_player.living_room',
          episode_id: null,
          item_id: 'new_book',
          session_id: 'new_session',
          speed: 1,
        },
      },
      books: [
        {
          author: 'New Author',
          cover_url: '',
          duration: 1000,
          id: 'new_book',
          media_type: 'book',
          progress: 200,
          title: 'New Book',
        },
      ],
      in_progress: [],
      podcasts: [],
    });
    await secondFetch;

    resolveFirst?.({
      active_sessions: {
        'media_player.living_room': {
          current_time: 100,
          entity_id: 'media_player.living_room',
          episode_id: null,
          item_id: 'old_book',
          session_id: 'old_session',
          speed: 1,
        },
      },
      books: [
        {
          author: 'Old Author',
          cover_url: '',
          duration: 1000,
          id: 'old_book',
          media_type: 'book',
          progress: 100,
          title: 'Old Book',
        },
      ],
      in_progress: [],
      podcasts: [],
    });
    await firstFetch;

    expect(customLibrary.books[0]?.id).toBe('new_book');
    expect(onRestoreItem).toHaveBeenCalledTimes(1);
    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new_book' }),
      200,
      1000,
      true,
      1,
    );
    expect(customLibrary.isRefreshing).toBe(false);
  });

  it('fetches podcast episodes and caches them', async (): Promise<void> => {
    const mockEpisodes: PodcastEpisode[] = [
      {
        duration: 1200,
        id: 'ep_1',
        podcast_id: 'pod_10',
        progress: 0,
        title: 'Episode One',
      },
    ];
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      episodes: mockEpisodes,
    });

    const podcastId = 'pod_10';
    await library.fetchEpisodes(podcastId);

    expect(library.selectedPodcastId).toBe(podcastId);
    expect(library.episodes[podcastId]).toEqual([
      {
        ...mockEpisodes[0],
        podcast_id: 'pod_10',
        podcast_title: '',
      },
    ]);
  });

  it('fetches chapters and updates chapters list', async (): Promise<void> => {
    const mockChapters: ChapterItem[] = [
      { duration: 300, end: 300, id: 0, start: 0, title: 'Chapter 1' },
      { duration: 400, end: 700, id: 1, start: 300, title: 'Chapter 2' },
    ];
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: mockChapters,
    });

    await library.fetchChapters('book_chapters');

    expect(library.chapters).toEqual(mockChapters);
    expect(library.chaptersBookId).toBe('book_chapters');
    expect(library.isLoadingChapters).toBe(false);
  });

  it('identifies current chapter based on playback position', (): void => {
    library.chapters = [
      { duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' },
      { duration: 200, end: 300, id: 1, start: 100, title: 'Chapter 2' },
    ];

    const currentItem = { id: 'book_ch' } as MediaItem;
    expect(library.getCurrentChapter(50, currentItem)?.title).toBe('Chapter 1');
    expect(library.getCurrentChapter(150, currentItem)?.title).toBe('Chapter 2');
    expect(library.getCurrentChapter(350, currentItem)?.title).toBe('Chapter 2');
  });

  it('determines whether navigable chapters exist', (): void => {
    library.chapters = [];
    const item = { id: 'book_ch' } as MediaItem;
    expect(library.hasNoNavigableChapters(item)).toBe(true);

    library.chapters = [{ duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' }];
    expect(library.hasNoNavigableChapters(item)).toBe(true);

    library.chapters = [
      { duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' },
      { duration: 200, end: 300, id: 1, start: 100, title: 'Chapter 2' },
    ];
    expect(library.hasNoNavigableChapters(item)).toBe(false);
  });

  it('restores from active session matching selected player', (): void => {
    const onRestoreItem = vi.fn();
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.living_room',
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Author',
        cover_url: '',
        duration: 3600,
        id: 'book_session',
        media_type: 'book',
        progress: 0,
        title: 'Book Session',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({
      'media_player.living_room': {
        current_time: 1500,
        entity_id: 'media_player.living_room',
        episode_id: null,
        item_id: 'book_session',
        session_id: 'sess_1',
        speed: 1.25,
      },
    });

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'book_session' }),
      1500,
      3600,
      true,
      1.25,
    );
  });

  it('restores browser active session by empty string browser player id', (): void => {
    const onRestoreItem = vi.fn();
    const customHass: HomeAssistant = {
      ...mockHass,
      states: {},
    } as HomeAssistant;
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => ({
        player_entities: [''],
        type: 'custom:abstp-player-card',
      }),
      getHass: (): HomeAssistant => customHass,
      getSelectedPlayer: (): string => '',
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Author',
        cover_url: '',
        duration: 3600,
        id: 'browser_book',
        media_type: 'book',
        progress: 0,
        title: 'Browser Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({
      browser: {
        current_time: 900,
        entity_id: 'browser',
        episode_id: null,
        item_id: 'browser_book',
        session_id: 'session_browser',
        speed: 1.5,
      },
    });

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'browser_book' }),
      900,
      3600,
      true,
      1.5,
    );
  });

  it('does not select a default item when the player reports an unknown item', (): void => {
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.living_room': {
        attributes: { item_id: 'unknown_book' },
        entity_id: 'media_player.living_room',
        state: 'playing',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.living_room',
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Fallback Author',
        cover_url: '',
        duration: 3600,
        id: 'fallback_book',
        media_type: 'book',
        progress: 0,
        title: 'Fallback Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('preserves existing current item when active session is absent', (): void => {
    const onRestoreItem = vi.fn();
    const existingItem: MediaItem = {
      author: 'Existing Author',
      cover_url: '',
      duration: 5000,
      id: 'existing_book',
      media_type: 'book',
      progress: 0,
      title: 'Existing Book',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): MediaItem => existingItem,
      getHass: (): HomeAssistant => mockHass,
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Other Author',
        cover_url: '',
        duration: 3600,
        id: 'other_book',
        media_type: 'book',
        progress: 0,
        title: 'Other Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('updates existing current item with fresh server progress when stopped', (): void => {
    const onRestoreItem = vi.fn();
    const existingItem: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 5000,
      id: 'book_update',
      media_type: 'book',
      progress: 1000,
      title: 'Book Update',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): MediaItem => existingItem,
      getHass: (): HomeAssistant => mockHass,
      getIsPlaying: (): boolean => false,
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'Author',
        cover_url: '',
        current_time: 2500,
        duration: 5000,
        id: 'book_update',
        media_type: 'book',
        progress: 2500,
        title: 'Book Update',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ current_time: 2500, id: 'book_update' }),
      2500,
      5000,
      false,
    );
  });

  it('uses in-progress current time instead of stale player attributes', (): void => {
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.abstp_living_room': {
        attributes: { item_id: 'book_1', media_position: 100 },
        entity_id: 'media_player.abstp_living_room',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living_room',
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'Author',
        cover_url: '',
        current_time: 2500,
        duration: 5000,
        id: 'book_1',
        media_type: 'book',
        progress: 2500,
        title: 'Book One',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ current_time: 2500, id: 'book_1' }),
      2500,
      5000,
      false,
    );
  });

  it('does not overwrite current item when playback is active', (): void => {
    const onRestoreItem = vi.fn();
    const existingItem: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 5000,
      id: 'book_playing',
      media_type: 'book',
      progress: 1000,
      title: 'Book Playing',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): MediaItem => existingItem,
      getHass: (): HomeAssistant => mockHass,
      getIsPlaying: (): boolean => true,
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'Author',
        cover_url: '',
        current_time: 2500,
        duration: 5000,
        id: 'book_playing',
        media_type: 'book',
        progress: 2500,
        title: 'Book Playing',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('clears fetching flags when disconnected', (): void => {
    library.isFetchingLibrary = true;
    library.isRefreshing = true;

    library.hostDisconnected();

    expect(library.isFetchingLibrary).toBe(false);
    expect(library.isRefreshing).toBe(false);
  });

  it('returns early when hass is unavailable before fetching the library', async (): Promise<void> => {
    const noHassLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): undefined => undefined,
    });

    await noHassLibrary.fetchLibrary();

    expect(noHassLibrary.books).toEqual([]);
    expect(noHassLibrary.isFetchingLibrary).toBe(false);
  });

  it('ignores stale library failures after a newer response', async (): Promise<void> => {
    let rejectFirst: ((reason: Error) => void) | undefined;
    let resolveSecond: ((value: object) => void) | undefined;
    const firstResponse: Promise<object> = new Promise((_resolve, reject): void => {
      rejectFirst = reject;
    });
    const secondResponse: Promise<object> = new Promise((resolve): void => {
      resolveSecond = resolve;
    });
    const callWS = mockHass.callWS as ReturnType<typeof vi.fn>;
    callWS
      .mockImplementationOnce(() => firstResponse)
      .mockImplementationOnce(() => secondResponse)
      .mockResolvedValue({ chapters: [] });

    const firstFetch: Promise<void> = library.fetchLibrary();
    const secondFetch: Promise<void> = library.fetchLibrary();

    resolveSecond?.({ books: [], in_progress: [], podcasts: [] });
    await secondFetch;

    rejectFirst?.(new Error('Network error'));
    await firstFetch;

    expect(library.isRefreshing).toBe(false);
    expect(library.isFetchingLibrary).toBe(false);
  });

  it('marks the in-progress tab as active when in-progress items exist', (): void => {
    library.applyLibraryUpdate({
      books: [],
      in_progress: [
        {
          author: 'InAuthor',
          cover_url: '',
          current_time: 10,
          duration: 1000,
          id: 'in_1',
          media_type: 'book',
          progress: 10,
          title: 'In Progress Book',
        },
      ],
      podcasts: [],
    });

    expect(library.activeTab).toBe('in_progress');
  });

  it('selects the podcasts tab when books are hidden', (): void => {
    const hiddenBooksLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => ({
        ...mockConfig,
        hide_books: true,
        hide_podcasts: false,
      }),
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
    });

    hiddenBooksLibrary.applyLibraryUpdate({
      books: [],
      in_progress: [],
      podcasts: [],
    });

    expect(hiddenBooksLibrary.activeTab).toBe('podcasts');
  });

  it('returns early when hass is unavailable before fetching episodes', async (): Promise<void> => {
    const noHassLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): undefined => undefined,
    });

    await noHassLibrary.fetchEpisodes('pod_1');

    expect(noHassLibrary.selectedPodcastId).toBeNull();
    expect(noHassLibrary.episodes).toEqual({});
  });

  it('keeps an empty episode list when the episode fetch fails', async (): Promise<void> => {
    const failedPodcastId: string = 'pod_fail';
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    await library.fetchEpisodes(failedPodcastId);

    expect(library.episodes[failedPodcastId]).toEqual([]);
  });

  it('maps the podcast title onto fetched episodes', async (): Promise<void> => {
    const podcastId: string = 'pod_title';
    library.podcasts = [
      {
        author: 'Podcast Host',
        cover_url: '',
        duration: 1800,
        id: podcastId,
        media_type: 'podcast',
        progress: 0,
        title: 'Titled Podcast',
      },
    ];
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      episodes: [
        {
          duration: 600,
          id: 'ep_1',
          progress: 0,
          title: 'Episode One',
        },
      ],
    });

    await library.fetchEpisodes(podcastId);

    const loadedEpisode: PodcastEpisode | undefined = library.episodes[podcastId]?.[0];
    expect(loadedEpisode?.podcast_title).toBe('Titled Podcast');
    expect(loadedEpisode?.podcast_id).toBe(podcastId);
  });

  it('returns early when hass is unavailable before fetching chapters', async (): Promise<void> => {
    const noHassLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): undefined => undefined,
    });

    await noHassLibrary.fetchChapters('book_1');

    expect(noHassLibrary.chapters).toEqual([]);
    expect(noHassLibrary.isLoadingChapters).toBe(false);
  });

  it('clears chapters when the current item is a podcast', async (): Promise<void> => {
    const onChaptersUnavailable = vi.fn();
    library.chapters = [{ duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' }];
    const podcastItem: PodcastEpisode = {
      duration: 600,
      id: 'ep_1',
      podcast_id: 'pod_1',
      progress: 0,
      title: 'Episode One',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): PodcastEpisode => podcastItem,
      getHass: (): HomeAssistant => mockHass,
      onChaptersUnavailable,
    });

    await customLibrary.fetchChapters();

    expect(customLibrary.chapters).toEqual([]);
    expect(customLibrary.chaptersBookId).toBe('');
    expect(onChaptersUnavailable).toHaveBeenCalled();
  });

  it('returns early when no book id can be resolved for chapters', async (): Promise<void> => {
    await library.fetchChapters();

    expect(library.chapters).toEqual([]);
    expect(library.isLoadingChapters).toBe(false);
  });

  it('skips refetching chapters already loaded for the same book', async (): Promise<void> => {
    const callWS = mockHass.callWS as ReturnType<typeof vi.fn>;
    callWS.mockResolvedValue({
      chapters: [
        { duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' },
        { duration: 200, end: 300, id: 1, start: 100, title: 'Chapter 2' },
      ],
    });

    await library.fetchChapters('book_cached');
    await library.fetchChapters('book_cached');

    expect(callWS).toHaveBeenCalledTimes(1);
  });

  it('switches to the session player when the selected player is inactive', (): void => {
    const onRestoreItem = vi.fn();
    const onSelectedPlayerChange = vi.fn();
    mockHass.states = {
      'media_player.abstp_a': {
        attributes: {},
        entity_id: 'media_player.abstp_a',
        state: 'idle',
      },
      'media_player.abstp_b': {
        attributes: {},
        entity_id: 'media_player.abstp_b',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_a',
      onRestoreItem,
      onSelectedPlayerChange,
    });
    customLibrary.books = [
      {
        author: 'Session Author',
        cover_url: '',
        duration: 3600,
        id: 'session_book',
        media_type: 'book',
        progress: 0,
        title: 'Session Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({
      'media_player.abstp_b': {
        current_time: 120,
        entity_id: 'media_player.abstp_b',
        episode_id: null,
        item_id: 'session_book',
        session_id: 'session_b',
        speed: 1,
      },
    });

    expect(onSelectedPlayerChange).toHaveBeenCalledWith('media_player.abstp_b');
    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session_book' }),
      120,
      3600,
      true,
      1,
    );
  });

  it('ignores active sessions referencing unknown items', (): void => {
    const onRestoreItem = vi.fn();
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      onRestoreItem,
    });

    customLibrary.restoreActiveOrSavedItem({
      'media_player.abstp_z': {
        current_time: 50,
        entity_id: 'media_player.abstp_z',
        episode_id: null,
        item_id: 'ghost_book',
        session_id: 'session_z',
        speed: 1,
      },
    });

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('clears chapters when the active session resumes a podcast episode', (): void => {
    const onChaptersUnavailable = vi.fn();
    const onRestoreItem = vi.fn();
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living',
      onChaptersUnavailable,
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'Podcast Author',
        cover_url: '',
        current_time: 120,
        duration: 600,
        episode_id: 'ep_1',
        id: 'pod_session',
        media_type: 'podcast',
        progress: 120,
        title: 'Podcast Episode',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({
      'media_player.abstp_living': {
        current_time: 300,
        entity_id: 'media_player.abstp_living',
        episode_id: 'ep_1',
        item_id: 'pod_session',
        session_id: 'session_pod',
        speed: 1.5,
      },
    });

    expect(onChaptersUnavailable).toHaveBeenCalled();
    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pod_session' }),
      300,
      600,
      true,
      1.5,
    );
  });

  it('returns early when no saved item can be restored by default', (): void => {
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.abstp_living': {
        attributes: {},
        entity_id: 'media_player.abstp_living',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living',
      onRestoreItem,
    });

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('clears chapters when restoring a default podcast item', (): void => {
    const onChaptersUnavailable = vi.fn();
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.abstp_living': {
        attributes: { item_id: 'pod_default' },
        entity_id: 'media_player.abstp_living',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living',
      onChaptersUnavailable,
      onRestoreItem,
    });
    customLibrary.podcasts = [
      {
        author: 'Default Author',
        cover_url: '',
        duration: 1800,
        id: 'pod_default',
        media_type: 'podcast',
        progress: 0,
        title: 'Default Podcast',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onChaptersUnavailable).toHaveBeenCalled();
    expect(onRestoreItem).toHaveBeenCalled();
  });

  it('leaves the refreshing flag off during background library fetches', async (): Promise<void> => {
    let resolveFetch: ((value: object) => void) | undefined;
    const pendingFetch: Promise<object> = new Promise((resolve): void => {
      resolveFetch = resolve;
    });
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockReturnValueOnce(pendingFetch);

    const fetchPromise: Promise<void> = library.fetchLibrary(true);

    expect(library.isFetchingLibrary).toBe(true);
    expect(library.isRefreshing).toBe(false);

    resolveFetch?.({ books: [], in_progress: [], podcasts: [] });
    await fetchPromise;

    expect(library.isRefreshing).toBe(false);
  });

  it('defaults missing in-progress lists to an empty array', (): void => {
    library.applyLibraryUpdate({
      books: [],
      podcasts: [],
    });

    expect(library.inProgress).toEqual([]);
  });

  it('keeps the current tab when both books and podcasts are hidden', (): void => {
    const hiddenLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => ({
        ...mockConfig,
        hide_books: true,
        hide_podcasts: true,
      }),
      getCurrentItem: (): null => null,
      getHass: (): HomeAssistant => mockHass,
    });

    hiddenLibrary.applyLibraryUpdate({
      books: [],
      in_progress: [],
      podcasts: [],
    });

    expect(hiddenLibrary.activeTab).toBe('in_progress');
  });

  it('resolves the book id from the current item when no target is given', async (): Promise<void> => {
    const currentItem: MediaItem = {
      author: 'Current Author',
      cover_url: '',
      duration: 3600,
      id: 'book_current',
      media_type: 'book',
      progress: 0,
      title: 'Current Book',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): MediaItem => currentItem,
      getHass: (): HomeAssistant => mockHass,
    });
    (mockHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      chapters: [{ duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' }],
    });

    await customLibrary.fetchChapters();

    expect(customLibrary.chaptersBookId).toBe('book_current');
  });

  it('falls back to zero duration when restoring an item without a duration', (): void => {
    const onRestoreItem = vi.fn();
    const existingItem: MediaItem = {
      author: 'NoDuration Author',
      cover_url: '',
      duration: 0,
      id: 'book_noduration',
      media_type: 'book',
      progress: 0,
      title: 'No Duration Book',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): MediaItem => existingItem,
      getHass: (): HomeAssistant => mockHass,
      getIsPlaying: (): boolean => false,
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'NoDuration Author',
        cover_url: '',
        current_time: 30,
        duration: 0,
        id: 'book_noduration',
        media_type: 'book',
        progress: 30,
        title: 'No Duration Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'book_noduration' }),
      30,
      0,
      false,
    );
  });

  it('skips chapter fetch when the stopped current item is a podcast', (): void => {
    const onRestoreItem = vi.fn();
    const onChaptersUnavailable = vi.fn();
    const currentItem: PodcastEpisode = {
      duration: 600,
      id: 'ep_pod',
      podcast_id: 'pod_pod',
      progress: 0,
      title: 'Pod Episode',
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getCurrentItem: (): PodcastEpisode => currentItem,
      getHass: (): HomeAssistant => mockHass,
      getIsPlaying: (): boolean => false,
      onChaptersUnavailable,
      onRestoreItem,
    });
    customLibrary.inProgress = [
      {
        author: 'Pod Author',
        cover_url: '',
        current_time: 25,
        duration: 600,
        episode_id: 'ep_pod',
        id: 'pod_pod',
        media_type: 'podcast',
        progress: 25,
        title: 'Pod Episode',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).toHaveBeenCalled();
    expect(onChaptersUnavailable).not.toHaveBeenCalled();
  });

  it('reads a string episode id from the player attributes', (): void => {
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.abstp_living': {
        attributes: { episode_id: 'ep_string', item_id: 'book_ep' },
        entity_id: 'media_player.abstp_living',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living',
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Episode Author',
        cover_url: '',
        duration: 3600,
        id: 'book_ep',
        media_type: 'book',
        progress: 0,
        title: 'Episode Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).not.toHaveBeenCalled();
  });

  it('falls back to zero duration when restoring a default item without a duration', (): void => {
    const onRestoreItem = vi.fn();
    mockHass.states = {
      'media_player.abstp_living': {
        attributes: { item_id: 'book_default' },
        entity_id: 'media_player.abstp_living',
        state: 'idle',
      },
    };
    const customLibrary = new LibraryController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getSelectedPlayer: (): string => 'media_player.abstp_living',
      onRestoreItem,
    });
    customLibrary.books = [
      {
        author: 'Default Author',
        cover_url: '',
        duration: 0,
        id: 'book_default',
        media_type: 'book',
        progress: 0,
        title: 'Default Book',
      },
    ];

    customLibrary.restoreActiveOrSavedItem({});

    expect(onRestoreItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'book_default' }),
      0,
      0,
      false,
    );
  });
});
