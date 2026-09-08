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
});
