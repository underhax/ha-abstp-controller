import { describe, expect, it, vi } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import { AbstpPlayerCardEditor } from '../src/abstp-player-card-editor.ts';
import type { AbstpCardConfig, ChapterItem, InProgressItem } from '../src/types.ts';

describe('AbstpPlayerCard', (): void => {
  it('creates stub configuration with default values', (): void => {
    const stub = AbstpPlayerCard.getStubConfig() as unknown as AbstpCardConfig;
    expect(stub.type).toBe('custom:abstp-player-card');
    expect(stub.default_speed).toBe(1.0);
    expect(stub.skip_seconds).toBe(10);
  });

  it('instantiates the card element and updates config properties', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig({
      default_speed: 1.5,
      player_entity: 'media_player.living_room_speaker',
      skip_seconds: 15,
      title: 'Custom Title',
      type: 'custom:abstp-player-card',
    });
    expect(card).toBeDefined();
  });

  it('provides the custom card editor element', async (): Promise<void> => {
    const editor: HTMLElement = await AbstpPlayerCard.getConfigElement();
    expect(editor.tagName.toLowerCase()).toBe('abstp-player-card-editor');
  });

  it('closes open popovers on Escape keydown', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.connectedCallback();
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;
    (card as unknown as { showVolumePopover: boolean }).showVolumePopover = true;
    (card as unknown as { showDeviceMenu: boolean }).showDeviceMenu = true;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect((card as unknown as { showSpeedPopover: boolean }).showSpeedPopover).toBe(false);
    expect((card as unknown as { showVolumePopover: boolean }).showVolumePopover).toBe(false);
    expect((card as unknown as { showDeviceMenu: boolean }).showDeviceMenu).toBe(false);
    card.disconnectedCallback();
  });

  it('closes open popovers when clicking outside the card element', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.connectedCallback();
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;

    const outsideTarget: HTMLDivElement = document.createElement('div');
    document.body.appendChild(outsideTarget);
    outsideTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect((card as unknown as { showSpeedPopover: boolean }).showSpeedPopover).toBe(false);
    card.disconnectedCallback();
    document.body.removeChild(outsideTarget);
  });

  it('applies changed speed and triggers buffering on popover close', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentSpeed: number }).currentSpeed = 1.0;
    (card as unknown as { speedOnOpen: number }).speedOnOpen = 1.0;
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'test_book' };

    (card as unknown as { handleSpeedAdjust: (spd: number) => void }).handleSpeedAdjust(1.5);
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(false);

    await (card as unknown as { closeSpeedPopover: () => Promise<void> }).closeSpeedPopover();
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(true);
  });

  it('scopes selected player and storage keys per card configuration', (): void => {
    const card1: AbstpPlayerCard = new AbstpPlayerCard();
    card1.setConfig({
      player_entities: ['media_player.bedroom_mini'],
      title: 'Bedroom Card',
      type: 'custom:abstp-player-card',
    });
    expect((card1 as unknown as { selectedPlayer: string }).selectedPlayer).toBe(
      'media_player.bedroom_mini',
    );

    const card2: AbstpPlayerCard = new AbstpPlayerCard();
    card2.setConfig({
      player_entities: ['media_player.kitchen_mini'],
      title: 'Kitchen Card',
      type: 'custom:abstp-player-card',
    });
    expect((card2 as unknown as { selectedPlayer: string }).selectedPlayer).toBe(
      'media_player.kitchen_mini',
    );
  });

  it('handles browser audio progress calculation and ignores non-finite duration', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { selectedPlayer: string }).selectedPlayer = '';
    (card as unknown as { browserStreamStartPos: number }).browserStreamStartPos = 120;
    (card as unknown as { currentSpeed: number }).currentSpeed = 1.5;
    (card as unknown as { playbackDuration: number }).playbackDuration = 3600;

    (
      card as unknown as { handleBrowserTimeUpdate: (pos: number, dur: number) => void }
    ).handleBrowserTimeUpdate(10, Number.POSITIVE_INFINITY);

    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(135);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(3600);
  });

  it('selects an item without automatically starting playback', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (
      card as unknown as {
        handleSelectItem: (item: { id: string; progress: number; duration: number }) => void;
      }
    ).handleSelectItem({
      duration: 7200,
      id: 'selected_book_1',
      progress: 300,
    });

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(false);
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(300);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(7200);
  });

  it('stops current playback when selecting a new item', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'old_book' };

    await (
      card as unknown as {
        handleSelectItem: (item: {
          duration: number;
          id: string;
          progress: number;
        }) => Promise<void>;
      }
    ).handleSelectItem({
      duration: 3600,
      id: 'new_book',
      progress: 0,
    });

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { currentItem: { id: string } }).currentItem.id).toBe('new_book');
  });

  it('initializes with activeTab set to in_progress', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    expect((card as unknown as { activeTab: string }).activeTab).toBe('in_progress');
  });

  it('switches to in_progress tab and marks tab as user selected', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { activeTab: string }).activeTab = 'books';
    (card as unknown as { selectedPodcastId: string | null }).selectedPodcastId = 'pod_1';
    (card as unknown as { handleTabInProgress: () => void }).handleTabInProgress();

    expect((card as unknown as { activeTab: string }).activeTab).toBe('in_progress');
    expect((card as unknown as { selectedPodcastId: string | null }).selectedPodcastId).toBeNull();
    expect((card as unknown as { userSelectedTab: boolean }).userSelectedTab).toBe(true);
  });

  it('filters in_progress items by title, author, or episode title', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { inProgress: InProgressItem[] }).inProgress = [
      {
        author: 'Author One',
        cover_url: 'https://example.com/cover1.jpg',
        current_time: 120,
        duration: 3600,
        id: 'item_1',
        media_type: 'book',
        progress: 120,
        title: 'Book One',
      },
      {
        author: 'Author Two',
        cover_url: 'https://example.com/cover2.jpg',
        current_time: 300,
        duration: 1800,
        episode_id: 'ep_1',
        episode_title: 'Special Episode',
        id: 'item_2',
        media_type: 'podcast',
        progress: 300,
        title: 'Podcast Two',
      },
    ];

    (card as unknown as { searchQuery: string }).searchQuery = 'special';
    let filtered: InProgressItem[] = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('item_2');

    (card as unknown as { searchQuery: string }).searchQuery = 'author one';
    filtered = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('item_1');

    (card as unknown as { searchQuery: string }).searchQuery = 'nonexistent';
    filtered = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(0);
  });

  it('selects an in_progress item and sets playback position from progress', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const inProgressItem: InProgressItem = {
      author: 'Test Author',
      cover_url: 'https://example.com/cover.jpg',
      current_time: 450,
      duration: 3600,
      id: 'in_progress_book',
      media_type: 'book',
      progress: 450,
      title: 'In Progress Book',
    };

    await (
      card as unknown as {
        handleSelectItem: (item: InProgressItem) => Promise<void>;
      }
    ).handleSelectItem(inProgressItem);

    expect((card as unknown as { currentItem: InProgressItem | null }).currentItem?.id).toBe(
      'in_progress_book',
    );
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(450);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(3600);
  });

  it('resolves item IDs correctly for podcast episodes and in_progress podcast items', (): void => {
    const resolveIds = (
      AbstpPlayerCard as unknown as {
        resolveItemIds: (item: unknown) => { episodeId?: string; itemId: string };
      }
    ).resolveItemIds;

    const bookItem = { id: 'book_123' };
    expect(resolveIds(bookItem)).toEqual({ itemId: 'book_123' });

    const podcastEpisode = { id: 'ep_456', podcast_id: 'pod_789' };
    expect(resolveIds(podcastEpisode)).toEqual({ episodeId: 'ep_456', itemId: 'pod_789' });

    const inProgressPodcast = { episode_id: 'ep_456', id: 'pod_789' };
    expect(resolveIds(inProgressPodcast)).toEqual({ episodeId: 'ep_456', itemId: 'pod_789' });
  });

  it('resolves initial position from current_time for in_progress items', (): void => {
    const resolvePos = (
      AbstpPlayerCard as unknown as {
        resolveInitialPosition: (item: unknown, startTime?: number) => number;
      }
    ).resolveInitialPosition;

    const inProgressItem: InProgressItem = {
      author: 'Author',
      cover_url: 'https://example.com/cover.jpg',
      current_time: 500,
      duration: 3600,
      id: 'in_prog_1',
      media_type: 'book',
      progress: 500,
      title: 'Book',
    };

    expect(resolvePos(inProgressItem)).toBe(500);
    expect(resolvePos(inProgressItem, 120)).toBe(120);
  });

  it('filters finished and in-progress books based on is_finished', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { books: unknown[] }).books = [
      {
        author: 'A1',
        duration: 1000,
        id: 'b1',
        is_finished: false,
        progress: 200,
        title: 'Active Book',
      },
      {
        author: 'A2',
        duration: 1000,
        id: 'b2',
        is_finished: true,
        progress: 1000,
        title: 'Finished Book',
      },
    ];

    (card as unknown as { filterProgress: string }).filterProgress = 'finished';
    let filtered: unknown[] = (
      card as unknown as { getFilteredBooks: () => unknown[] }
    ).getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as { id: string }).id).toBe('b2');

    (card as unknown as { filterProgress: string }).filterProgress = 'in_progress';
    filtered = (card as unknown as { getFilteredBooks: () => unknown[] }).getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as { id: string }).id).toBe('b1');
  });

  it('toggles chapters panel and closes library panel mutually', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'multi_chapter_book' };
    (card as unknown as { chapters: unknown[] }).chapters = [
      { duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' },
      { duration: 100, end: 200, id: 1, start: 100, title: 'Chapter 2' },
    ];
    (card as unknown as { showLibrary: boolean }).showLibrary = true;
    (card as unknown as { toggleChapters: () => void }).toggleChapters();

    expect((card as unknown as { showChapters: boolean }).showChapters).toBe(true);
    expect((card as unknown as { showLibrary: boolean }).showLibrary).toBe(false);

    (card as unknown as { toggleLibrary: () => void }).toggleLibrary();
    expect((card as unknown as { showChapters: boolean }).showChapters).toBe(false);
    expect((card as unknown as { showLibrary: boolean }).showLibrary).toBe(true);
  });

  it('determines current chapter based on playback position', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'test_book' };
    (card as unknown as { chapters: unknown[] }).chapters = [
      { duration: 100, end: 100, id: 0, start: 0, title: 'Chapter 1' },
      { duration: 200, end: 300, id: 1, start: 100, title: 'Chapter 2' },
      { duration: 150, end: 450, id: 2, start: 300, title: 'Chapter 3' },
    ];

    (card as unknown as { playbackPosition: number }).playbackPosition = 50;
    let ch = (
      card as unknown as {
        getCurrentChapter: () => { id: number; title: string } | null;
      }
    ).getCurrentChapter();
    expect(ch?.id).toBe(0);
    expect(ch?.title).toBe('Chapter 1');

    (card as unknown as { playbackPosition: number }).playbackPosition = 250;
    ch = (
      card as unknown as {
        getCurrentChapter: () => { id: number; title: string } | null;
      }
    ).getCurrentChapter();
    expect(ch?.id).toBe(1);
    expect(ch?.title).toBe('Chapter 2');

    (card as unknown as { playbackPosition: number }).playbackPosition = 500;
    ch = (
      card as unknown as {
        getCurrentChapter: () => { id: number; title: string } | null;
      }
    ).getCurrentChapter();
    expect(ch?.id).toBe(2);
    expect(ch?.title).toBe('Chapter 3');
  });

  it('resolves narrator along with author and coverId in resolveHeroCoverAndAuthor', (): void => {
    const resolve = (
      AbstpPlayerCard as unknown as {
        resolveHeroCoverAndAuthor: (item: unknown) => {
          author: string;
          coverId: string;
          narrator: string;
        };
      }
    ).resolveHeroCoverAndAuthor;

    const book = {
      author: 'Frank Herbert',
      id: 'book_1',
      narrator: 'George Guidall',
      title: 'Dune',
    };
    const meta = resolve(book);
    expect(meta.author).toBe('Frank Herbert');
    expect(meta.coverId).toBe('book_1');
    expect(meta.narrator).toBe('George Guidall');
  });

  it('scrolls chapters list to previous chapter before active chapter', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockList = document.createElement('div');
    mockList.className = 'chapters-list';
    mockList.scrollTop = 0;

    const mockFirst = document.createElement('div');
    mockFirst.className = 'chapter-item';
    Object.defineProperty(mockFirst, 'offsetTop', { value: 0 });
    Object.defineProperty(mockFirst, 'offsetParent', { value: mockList });

    const mockPrev = document.createElement('div');
    mockPrev.className = 'chapter-item';
    Object.defineProperty(mockPrev, 'offsetTop', { value: 150 });
    Object.defineProperty(mockPrev, 'offsetParent', { value: mockList });

    const mockItem = document.createElement('div');
    mockItem.className = 'chapter-item active';
    Object.defineProperty(mockItem, 'offsetTop', { value: 200 });
    Object.defineProperty(mockItem, 'offsetParent', { value: mockList });

    mockList.appendChild(mockFirst);
    mockList.appendChild(mockPrev);
    mockList.appendChild(mockItem);
    document.body.appendChild(mockList);

    Object.defineProperty(card, 'renderRoot', {
      value: {
        querySelector: (sel: string): HTMLElement | null => {
          if (sel === '.chapters-list') {
            return mockList;
          }
          if (sel === '.chapter-item.active') {
            return mockItem;
          }
          return null;
        },
      },
    });

    (card as unknown as { scrollToActiveChapter: () => void }).scrollToActiveChapter();
    expect(mockList.scrollTop).toBe(150);

    document.body.removeChild(mockList);
  });

  it('scrolls chapters list to top when active chapter is first', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockList = document.createElement('div');
    mockList.className = 'chapters-list';
    mockList.scrollTop = 100;

    const mockItem = document.createElement('div');
    mockItem.className = 'chapter-item active';
    Object.defineProperty(mockItem, 'offsetTop', { value: 0 });
    Object.defineProperty(mockItem, 'offsetParent', { value: mockList });

    mockList.appendChild(mockItem);
    document.body.appendChild(mockList);

    Object.defineProperty(card, 'renderRoot', {
      value: {
        querySelector: (sel: string): HTMLElement | null => {
          if (sel === '.chapters-list') {
            return mockList;
          }
          if (sel === '.chapter-item.active') {
            return mockItem;
          }
          return null;
        },
      },
    });

    (card as unknown as { scrollToActiveChapter: () => void }).scrollToActiveChapter();
    expect(mockList.scrollTop).toBe(0);

    document.body.removeChild(mockList);
  });

  it('triggers buffering animation when changing chapter during playback', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { isBuffering: boolean }).isBuffering = false;
    (card as unknown as { currentItem: { id: string; duration: number } }).currentItem = {
      duration: 3600,
      id: 'book_1',
    };
    (card as unknown as { selectedPlayer: string }).selectedPlayer = 'media_player.test_speaker';

    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
      states: {
        'media_player.test_speaker': {
          attributes: {},
          state: 'playing',
        },
      },
    };
    (card as unknown as { hass: typeof mockHass }).hass = mockHass;

    const chapter: ChapterItem = {
      duration: 300,
      end: 600,
      id: 2,
      start: 300,
      title: 'Chapter 2',
    };

    const promise: Promise<void> = (
      card as unknown as { handleChapterClick: (ch: ChapterItem) => Promise<void> }
    ).handleChapterClick(chapter);

    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(true);
    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);

    await promise;

    expect(mockHass.callService).toHaveBeenCalledWith('abstp_controller', 'play', {
      current_time: 300,
      entity_id: 'media_player.test_speaker',
      episode_id: undefined,
      item_id: 'book_1',
      speed: 1.0,
    });
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(300);
  });

  it('switches chapter and starts streaming from chapter start time in browser mode', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { isBuffering: boolean }).isBuffering = false;
    (card as unknown as { currentItem: { id: string; duration: number } }).currentItem = {
      duration: 3600,
      id: 'book_browser',
    };
    (card as unknown as { selectedPlayer: string }).selectedPlayer = '';
    (card as unknown as { browserStreamStartPos: number }).browserStreamStartPos = 0;
    (card as unknown as { playbackPosition: number }).playbackPosition = 120;

    const mockHass = {
      callWS: vi.fn().mockResolvedValue({
        current_time: 450,
        duration: 3600,
        session_id: 'new_session_123',
        stream_url: 'http://example.com/stream.mp3',
      }),
    };
    (card as unknown as { hass: typeof mockHass }).hass = mockHass;

    const chapter: ChapterItem = {
      duration: 300,
      end: 750,
      id: 2,
      start: 450,
      title: 'Chapter 2',
    };

    await (
      card as unknown as { handleChapterClick: (ch: ChapterItem) => Promise<void> }
    ).handleChapterClick(chapter);

    expect(mockHass.callWS).toHaveBeenCalledWith(
      expect.objectContaining({
        current_time: 450,
        item_id: 'book_browser',
        type: 'abstp_controller/start_session',
      }),
    );
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(450);
    expect((card as unknown as { browserStreamStartPos: number }).browserStreamStartPos).toBe(450);

    (
      card as unknown as { handleBrowserTimeUpdate: (pos: number, dur: number) => void }
    ).handleBrowserTimeUpdate(0, 3600);
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(450);

    (
      card as unknown as { handleBrowserTimeUpdate: (pos: number, dur: number) => void }
    ).handleBrowserTimeUpdate(5, 3600);
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(455);
    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(true);
  });

  it('identifies podcast items versus book items accurately', (): void => {
    expect(AbstpPlayerCard.isPodcastItem(null)).toBe(false);
    expect(
      AbstpPlayerCard.isPodcastItem({
        author: 'Author',
        cover_url: '',
        duration: 100,
        id: 'book_1',
        media_type: 'book',
        progress: 0,
        title: 'Book',
      }),
    ).toBe(false);
    expect(
      AbstpPlayerCard.isPodcastItem({
        duration: 200,
        id: 'ep_1',
        podcast_id: 'pod_1',
        progress: 0,
        title: 'Episode',
      }),
    ).toBe(true);
    expect(
      AbstpPlayerCard.isPodcastItem({
        author: 'Host',
        cover_url: '',
        duration: 300,
        id: 'pod_1',
        media_type: 'podcast',
        progress: 0,
        title: 'Podcast',
      }),
    ).toBe(true);
  });

  it('clears chapters and disables chapters button when podcast episode is selected', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { chapters: unknown[] }).chapters = [
      { duration: 100, end: 100, id: 1, start: 0, title: 'Chapter 1' },
    ];
    (card as unknown as { chaptersBookId: string }).chaptersBookId = 'prev_book';
    (card as unknown as { showChapters: boolean }).showChapters = true;

    const podcastEpisode = {
      duration: 300,
      id: 'ep_10',
      podcast_id: 'pod_1',
      progress: 0,
      title: 'Episode 10',
    };

    await (
      card as unknown as {
        handleSelectItem: (item: typeof podcastEpisode) => Promise<void>;
      }
    ).handleSelectItem(podcastEpisode);

    expect((card as unknown as { chapters: ChapterItem[] }).chapters.length).toBe(0);
    expect((card as unknown as { chaptersBookId: string }).chaptersBookId).toBe('');
    expect((card as unknown as { showChapters: boolean }).showChapters).toBe(false);

    const getChapter = (
      card as unknown as { getCurrentChapter: () => ChapterItem | null }
    ).getCurrentChapter.bind(card);
    expect(getChapter()).toBeNull();

    (card as unknown as { toggleChapters: () => void }).toggleChapters();
    expect((card as unknown as { showChapters: boolean }).showChapters).toBe(false);
  });

  it('disables chapters navigation and hides chapter label when book has at most one chapter', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentItem: { id: string } }).currentItem = {
      id: 'single_chapter_book',
    };
    (card as unknown as { chapters: unknown[] }).chapters = [
      { duration: 3600, end: 3600, id: 0, start: 0, title: 'Chapter 1' },
    ];

    expect(
      (card as unknown as { hasNoNavigableChapters: () => boolean }).hasNoNavigableChapters(),
    ).toBe(true);

    const getChapter = (
      card as unknown as { getCurrentChapter: () => ChapterItem | null }
    ).getCurrentChapter.bind(card);
    expect(getChapter()).toBeNull();

    (card as unknown as { toggleChapters: () => void }).toggleChapters();
    expect((card as unknown as { showChapters: boolean }).showChapters).toBe(false);
  });

  it('immediately switches to stopped state on stop click and ignores stale playing updates', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
      callWS: vi.fn().mockResolvedValue(undefined),
      states: {
        'media_player.test_speaker': {
          attributes: {},
          entity_id: 'media_player.test_speaker',
          state: 'playing',
        },
      },
    };
    (card as unknown as { hass: typeof mockHass }).hass = mockHass;
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'book_1' };
    (card as unknown as { selectedPlayer: string }).selectedPlayer = 'media_player.test_speaker';
    (card as unknown as { isPlaying: boolean }).isPlaying = true;

    (card as unknown as { handleTogglePlayPause: () => void }).handleTogglePlayPause();

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(false);

    (card as unknown as { syncPlaybackState: (state: string) => void }).syncPlaybackState(
      'playing',
    );

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);

    (card as unknown as { syncPlaybackState: (state: string) => void }).syncPlaybackState('idle');

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { awaitingPlaybackStop: boolean }).awaitingPlaybackStop).toBe(false);
  });

  it('ignores trailing browser time updates after stopping playback', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'book_2' };
    (card as unknown as { selectedPlayer: string }).selectedPlayer = '';
    (card as unknown as { isPlaying: boolean }).isPlaying = true;

    (card as unknown as { handleTogglePlayPause: () => void }).handleTogglePlayPause();

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);

    (
      card as unknown as { handleBrowserTimeUpdate: (pos: number, dur: number) => void }
    ).handleBrowserTimeUpdate(50, 100);

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
  });

  it('preserves and restores browser volume when switching between speaker and browser', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
      callWS: vi.fn().mockResolvedValue(undefined),
      states: {
        'media_player.station': {
          attributes: {
            is_volume_muted: false,
            volume_level: 0.1,
          },
          entity_id: 'media_player.station',
          state: 'idle',
        },
      },
    };
    (card as unknown as { hass: typeof mockHass }).hass = mockHass;
    (card as unknown as { selectedPlayer: string }).selectedPlayer = '';

    await (
      card as unknown as { handleVolumeChange: (val: number) => Promise<void> }
    ).handleVolumeChange(0.5);

    expect((card as unknown as { volumeLevel: number }).volumeLevel).toBe(0.5);
    const getBrowserVolume = (): number =>
      (card as unknown as { browserPlayer: { getVolume: () => number } }).browserPlayer.getVolume();
    expect(getBrowserVolume()).toBe(0.5);

    await (card as unknown as { selectPlayer: (id: string) => Promise<void> }).selectPlayer(
      'media_player.station',
    );

    expect((card as unknown as { selectedPlayer: string }).selectedPlayer).toBe(
      'media_player.station',
    );
    expect((card as unknown as { volumeLevel: number }).volumeLevel).toBe(0.1);

    await (card as unknown as { selectPlayer: (id: string) => Promise<void> }).selectPlayer('');

    expect((card as unknown as { selectedPlayer: string }).selectedPlayer).toBe('');
    expect((card as unknown as { volumeLevel: number }).volumeLevel).toBe(0.5);
    expect(getBrowserVolume()).toBe(0.5);
  });
});

describe('AbstpPlayerCardEditor', (): void => {
  it('sets config correctly without errors', (): void => {
    const editor: AbstpPlayerCardEditor = new AbstpPlayerCardEditor();
    editor.setConfig({
      default_speed: 1.25,
      player_entities: ['media_player.living_room_speaker'],
      title: 'Test Editor',
      type: 'custom:abstp-player-card',
    });
    expect(editor).toBeDefined();
  });
});
