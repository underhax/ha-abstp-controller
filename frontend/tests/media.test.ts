import { beforeEach, describe, expect, it } from 'vitest';
import {
  filterBooks,
  filterInProgress,
  filterPodcasts,
  findSavedItem,
  getCurrentChapter,
  hasNoNavigableChapters,
  isItemActive,
  isPodcastItem,
  resolveHeroCoverAndAuthor,
  resolveInitialPosition,
  resolveItemIds,
} from '../src/card/media.ts';
import { setStorageItem } from '../src/card/storage.ts';
import type { ChapterItem, InProgressItem, MediaItem, PodcastEpisode } from '../src/types.ts';

interface StorageMock {
  clear: () => void;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const storageMock: StorageMock = ((): StorageMock => {
  let store: Record<string, string> = {};
  return {
    clear: (): void => {
      store = {};
    },
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: storageMock,
  writable: true,
});

describe('isPodcastItem()', (): void => {
  it('returns false for null or undefined input', (): void => {
    expect(isPodcastItem(null)).toBe(false);
    expect(isPodcastItem(undefined)).toBe(false);
  });

  it('detects podcast item by podcast_id', (): void => {
    const ep: PodcastEpisode = {
      duration: 1800,
      id: 'ep_1',
      podcast_id: 'pod_1',
      progress: 0,
      title: 'Episode 1',
    };
    expect(isPodcastItem(ep)).toBe(true);
  });

  it('detects podcast item by media_type', (): void => {
    const item: MediaItem = {
      author: 'Host',
      cover_url: '',
      duration: 3600,
      id: 'pod_2',
      media_type: 'podcast',
      progress: 0,
      title: 'Podcast Show',
    };
    expect(isPodcastItem(item)).toBe(true);
  });

  it('detects podcast item by episode_id in in-progress item', (): void => {
    const item: InProgressItem = {
      author: 'Host',
      cover_url: '',
      current_time: 200,
      duration: 3600,
      episode_id: 'ep_99',
      id: 'pod_3',
      media_type: 'podcast',
      progress: 0.1,
      title: 'Podcast Show',
    };
    expect(isPodcastItem(item)).toBe(true);
  });

  it('returns false for standard audiobook media items', (): void => {
    const book: MediaItem = {
      author: 'Author Name',
      cover_url: '',
      duration: 7200,
      id: 'book_1',
      media_type: 'book',
      progress: 0,
      title: 'Audiobook Title',
    };
    expect(isPodcastItem(book)).toBe(false);
  });
});

describe('resolveItemIds()', (): void => {
  it('extracts episode and podcast IDs from podcast episode', (): void => {
    const ep: PodcastEpisode = {
      duration: 1000,
      id: 'ep_42',
      podcast_id: 'pod_root',
      progress: 0,
      title: 'Ep 42',
    };
    expect(resolveItemIds(ep)).toEqual({
      episodeId: 'ep_42',
      itemId: 'pod_root',
    });
  });

  it('extracts episode and item IDs from in-progress podcast item', (): void => {
    const item: InProgressItem = {
      author: 'Host',
      cover_url: '',
      current_time: 150,
      duration: 1000,
      episode_id: 'ep_sync',
      id: 'item_root',
      media_type: 'podcast',
      progress: 0.15,
      title: 'Ep Sync',
    };
    expect(resolveItemIds(item)).toEqual({
      episodeId: 'ep_sync',
      itemId: 'item_root',
    });
  });

  it('extracts item ID for standard book item', (): void => {
    const book: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 5000,
      id: 'book_pure',
      media_type: 'book',
      progress: 0,
      title: 'Book Pure',
    };
    expect(resolveItemIds(book)).toEqual({
      itemId: 'book_pure',
    });
  });
});

describe('resolveHeroCoverAndAuthor()', (): void => {
  it('returns blank strings for null input', (): void => {
    expect(resolveHeroCoverAndAuthor(null)).toEqual({
      author: '',
      coverId: '',
      narrator: '',
    });
  });

  it('resolves author, narrator and coverId for book with narrator', (): void => {
    const book: MediaItem = {
      author: 'J. Doe',
      cover_url: '',
      duration: 10000,
      id: 'book_cov_1',
      media_type: 'book',
      narrator: 'Narrator Voice',
      progress: 500,
      title: 'Sample Book',
    };
    expect(resolveHeroCoverAndAuthor(book)).toEqual({
      author: 'J. Doe',
      coverId: 'book_cov_1',
      narrator: 'Narrator Voice',
    });
  });

  it('resolves title as author when episode_title is present on in-progress item', (): void => {
    const item: InProgressItem = {
      author: 'Podcast Author',
      cover_url: '',
      current_time: 300,
      duration: 2000,
      episode_id: 'ep_hero',
      episode_title: 'Hero Episode',
      id: 'pod_hero',
      media_type: 'podcast',
      progress: 0.15,
      title: 'Show Title',
    };
    expect(resolveHeroCoverAndAuthor(item)).toEqual({
      author: 'Show Title',
      coverId: 'pod_hero',
      narrator: '',
    });
  });
});

describe('resolveInitialPosition()', (): void => {
  beforeEach((): void => {
    storageMock.clear();
  });

  it('prefers explicit startTime argument when valid', (): void => {
    const item: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 500,
      duration: 1000,
      id: 'item_st',
      media_type: 'book',
      progress: 500,
      title: 'Title',
    };
    expect(resolveInitialPosition(item, 120)).toBe(120);
  });

  it('uses current_time property when present', (): void => {
    const item: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 450,
      duration: 1000,
      id: 'item_cur',
      media_type: 'book',
      progress: 450,
      title: 'Title',
    };
    expect(resolveInitialPosition(item)).toBe(450);
  });

  it('loads saved position from storage when current_time is missing', (): void => {
    setStorageItem('abstp_pos_book_saved', '750');
    const book: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 1000,
      id: 'book_saved',
      media_type: 'book',
      progress: 100,
      title: 'Title',
    };
    expect(resolveInitialPosition(book)).toBe(750);
  });

  it('falls back to item.progress when storage and current_time are absent', (): void => {
    const book: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 1000,
      id: 'book_fallback',
      media_type: 'book',
      progress: 350,
      title: 'Title',
    };
    expect(resolveInitialPosition(book)).toBe(350);
  });
});

describe('isItemActive()', (): void => {
  it('returns false when currentItem is null', (): void => {
    const item: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 10,
      duration: 100,
      id: 'item_1',
      media_type: 'book',
      progress: 10,
      title: 'Book',
    };
    expect(isItemActive(null, item)).toBe(false);
  });

  it('matches matching book IDs', (): void => {
    const current: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 100,
      id: 'book_active',
      media_type: 'book',
      progress: 10,
      title: 'Book',
    };
    const target: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 10,
      duration: 100,
      id: 'book_active',
      media_type: 'book',
      progress: 10,
      title: 'Book',
    };
    expect(isItemActive(current, target)).toBe(true);
  });

  it('matches podcast episodes by ID and episode_id', (): void => {
    const current: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 50,
      duration: 200,
      episode_id: 'ep_10',
      id: 'pod_main',
      media_type: 'podcast',
      progress: 50,
      title: 'Podcast',
    };
    const targetMatch: InProgressItem = {
      author: 'Author',
      cover_url: '',
      current_time: 50,
      duration: 200,
      episode_id: 'ep_10',
      id: 'pod_main',
      media_type: 'podcast',
      progress: 50,
      title: 'Podcast',
    };
    const targetDiffEp: InProgressItem = {
      ...targetMatch,
      episode_id: 'ep_20',
    };
    expect(isItemActive(current, targetMatch)).toBe(true);
    expect(isItemActive(current, targetDiffEp)).toBe(false);
  });
});

describe('hasNoNavigableChapters() and getCurrentChapter()', (): void => {
  const chapters: ChapterItem[] = [
    { duration: 600, end: 600, id: 1, start: 0, title: 'Chapter 1' },
    { duration: 600, end: 1200, id: 2, start: 600, title: 'Chapter 2' },
  ];

  it('reports no navigable chapters for null item or podcast', (): void => {
    expect(hasNoNavigableChapters(null, chapters)).toBe(true);
    const podcast: MediaItem = {
      author: 'A',
      cover_url: '',
      duration: 1200,
      id: 'p1',
      media_type: 'podcast',
      progress: 0,
      title: 'Pod',
    };
    expect(hasNoNavigableChapters(podcast, chapters)).toBe(true);
  });

  it('reports no navigable chapters when chapters count is 1 or less', (): void => {
    const book: MediaItem = {
      author: 'A',
      cover_url: '',
      duration: 1200,
      id: 'b1',
      media_type: 'book',
      progress: 0,
      title: 'Book',
    };
    expect(hasNoNavigableChapters(book, [chapters[0] as ChapterItem])).toBe(true);
    expect(hasNoNavigableChapters(book, chapters)).toBe(false);
  });

  it('locates chapter corresponding to current position', (): void => {
    const book: MediaItem = {
      author: 'A',
      cover_url: '',
      duration: 1200,
      id: 'b1',
      media_type: 'book',
      progress: 0,
      title: 'Book',
    };
    expect(getCurrentChapter(chapters, 300, book)?.title).toBe('Chapter 1');
    expect(getCurrentChapter(chapters, 650, book)?.title).toBe('Chapter 2');
    expect(getCurrentChapter(chapters, 1500, book)?.title).toBe('Chapter 2');
  });
});

describe('findSavedItem()', (): void => {
  const inProgress: InProgressItem[] = [
    {
      author: 'Author 1',
      cover_url: '',
      current_time: 10,
      duration: 100,
      id: 'ip_1',
      media_type: 'book',
      progress: 10,
      title: 'Item 1',
    },
  ];
  const books: MediaItem[] = [
    {
      author: 'Author 2',
      cover_url: '',
      duration: 200,
      id: 'book_2',
      media_type: 'book',
      progress: 0,
      title: 'Book 2',
    },
  ];
  const podcasts: MediaItem[] = [
    {
      author: 'Author 3',
      cover_url: '',
      duration: 300,
      id: 'pod_3',
      media_type: 'podcast',
      progress: 0,
      title: 'Podcast 3',
    },
  ];

  it('finds items across lists by id', (): void => {
    expect(findSavedItem('ip_1', inProgress, books, podcasts)?.id).toBe('ip_1');
    expect(findSavedItem('book_2', inProgress, books, podcasts)?.id).toBe('book_2');
    expect(findSavedItem('pod_3', inProgress, books, podcasts)?.id).toBe('pod_3');
    expect(findSavedItem('unknown', inProgress, books, podcasts)).toBeUndefined();
  });
});

describe('filterInProgress(), filterBooks() and filterPodcasts()', (): void => {
  it('filters in-progress items by title, author or episode title', (): void => {
    const items: InProgressItem[] = [
      {
        author: 'Arthur Conan Doyle',
        cover_url: '',
        current_time: 10,
        duration: 100,
        id: '1',
        media_type: 'book',
        progress: 10,
        title: 'Sherlock Holmes',
      },
      {
        author: 'Leo Tolstoy',
        cover_url: '',
        current_time: 20,
        duration: 200,
        id: '2',
        media_type: 'book',
        progress: 20,
        title: 'War and Peace',
      },
    ];
    expect(filterInProgress(items, 'sherlock').length).toBe(1);
    expect(filterInProgress(items, 'Tolstoy').length).toBe(1);
    expect(filterInProgress(items, 'unknown').length).toBe(0);
  });

  it('filters books by search query and progress state', (): void => {
    const books: MediaItem[] = [
      {
        author: 'Author A',
        cover_url: '',
        duration: 1000,
        id: 'b1',
        is_finished: false,
        media_type: 'book',
        progress: 200,
        title: 'Book Active',
      },
      {
        author: 'Author B',
        cover_url: '',
        duration: 1000,
        id: 'b2',
        is_finished: true,
        media_type: 'book',
        progress: 1000,
        title: 'Book Completed',
      },
    ];
    expect(filterBooks(books, '', 'in_progress').map((b: MediaItem): string => b.id)).toEqual([
      'b1',
    ]);
    expect(filterBooks(books, '', 'finished').map((b: MediaItem): string => b.id)).toEqual(['b2']);
    expect(filterBooks(books, 'Completed', 'all').length).toBe(1);
  });

  it('filters podcasts by title and author', (): void => {
    const podcasts: MediaItem[] = [
      {
        author: 'Tech News Host',
        cover_url: '',
        duration: 3600,
        id: 'p1',
        media_type: 'podcast',
        progress: 0,
        title: 'Daily Tech',
      },
    ];
    expect(filterPodcasts(podcasts, 'daily').length).toBe(1);
    expect(filterPodcasts(podcasts, 'news').length).toBe(1);
    expect(filterPodcasts(podcasts, 'sports').length).toBe(0);
  });
});
