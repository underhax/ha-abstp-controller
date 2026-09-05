import { render, type TemplateResult } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import {
  type LibrarySectionContext,
  type PodcastsViewContext,
  renderBooksGrid,
  renderInProgressCard,
  renderInProgressGrid,
  renderLibraryContent,
  renderLibrarySection,
  renderPodcastEpisodesGrid,
  renderPodcastsView,
  renderTabsBar,
  type TabsBarContext,
} from '../src/card/templates/library.ts';
import type { AbstpCardConfig, InProgressItem, MediaItem, PodcastEpisode } from '../src/types.ts';

const mockConfig: AbstpCardConfig = {
  type: 'custom:abstp-player-card',
};

const mockInProgressBook: InProgressItem = {
  author: 'Author Name',
  cover_url: '',
  current_time: 300,
  duration: 600,
  id: 'item-book-1',
  media_type: 'book',
  progress: 300,
  title: 'Book Title',
};

const mockInProgressPodcast: InProgressItem = {
  author: 'Host Name',
  cover_url: '',
  current_time: 150,
  duration: 300,
  episode_id: 'ep-1',
  episode_title: 'Episode 1 Title',
  id: 'item-podcast-1',
  media_type: 'podcast',
  progress: 150,
  title: 'Podcast Show Title',
};

const mockMediaBook: MediaItem = {
  author: 'Author One',
  cover_url: '',
  duration: 1200,
  id: 'book-1',
  is_finished: false,
  media_type: 'book',
  progress: 600,
  title: 'Book One',
};

const mockFinishedBook: MediaItem = {
  author: 'Author Two',
  cover_url: '',
  duration: 800,
  id: 'book-2',
  is_finished: true,
  media_type: 'book',
  progress: 800,
  title: 'Book Two',
};

const mockPodcast: MediaItem = {
  author: 'Podcast Host',
  cover_url: '',
  duration: 0,
  id: 'podcast-1',
  is_finished: false,
  media_type: 'podcast',
  progress: 0,
  title: 'My Favorite Podcast',
};

const mockEpisode: PodcastEpisode = {
  duration: 1800,
  id: 'ep-101',
  is_finished: false,
  progress: 900,
  title: 'Deep Dive Episode',
};

const mockFinishedEpisode: PodcastEpisode = {
  duration: 600,
  id: 'ep-102',
  is_finished: true,
  progress: 600,
  title: 'Intro Episode',
};

describe('renderTabsBar()', (): void => {
  it('renders all three tabs and handles clicks', (): void => {
    const onTabInProgress = vi.fn();
    const onTabBooks = vi.fn();
    const onTabPodcasts = vi.fn();
    const onRefresh = vi.fn();

    const context: TabsBarContext = {
      activeTab: 'books',
      config: mockConfig,
      filteredBooksCount: 5,
      filteredInProgressCount: 2,
      filteredPodcastsCount: 3,
      hasInProgressItems: true,
      isRefreshing: false,
      lang: 'en',
      onRefresh,
      onTabBooks,
      onTabInProgress,
      onTabPodcasts,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTabsBar(context), container);

    const buttons: NodeListOf<HTMLButtonElement> =
      container.querySelectorAll('.tabs-group .tab-btn');
    expect(buttons.length).toBe(3);

    buttons[0]?.click();
    expect(onTabInProgress).toHaveBeenCalledTimes(1);

    buttons[1]?.click();
    expect(onTabBooks).toHaveBeenCalledTimes(1);

    buttons[2]?.click();
    expect(onTabPodcasts).toHaveBeenCalledTimes(1);

    expect(buttons[1]?.classList.contains('active')).toBe(true);

    const refreshBtn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-refresh');
    refreshBtn?.click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.icon-spin')).toBeNull();
  });

  it('renders spinning icon when isRefreshing is true', (): void => {
    const context: TabsBarContext = {
      activeTab: 'books',
      config: mockConfig,
      filteredBooksCount: 0,
      filteredInProgressCount: 0,
      filteredPodcastsCount: 0,
      hasInProgressItems: false,
      isRefreshing: true,
      lang: 'en',
      onRefresh: vi.fn(),
      onTabBooks: vi.fn(),
      onTabInProgress: vi.fn(),
      onTabPodcasts: vi.fn(),
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTabsBar(context), container);

    expect(container.querySelector('.icon-spin')).not.toBeNull();
  });

  it('hides in-progress tab when no items exist and activeTab is different', (): void => {
    const context: TabsBarContext = {
      activeTab: 'books',
      config: mockConfig,
      filteredBooksCount: 1,
      filteredInProgressCount: 0,
      filteredPodcastsCount: 0,
      hasInProgressItems: false,
      isRefreshing: false,
      lang: 'en',
      onRefresh: vi.fn(),
      onTabBooks: vi.fn(),
      onTabInProgress: vi.fn(),
      onTabPodcasts: vi.fn(),
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTabsBar(context), container);

    const buttons: NodeListOf<HTMLButtonElement> =
      container.querySelectorAll('.tabs-group .tab-btn');
    expect(buttons.length).toBe(2);
  });

  it('respects hide_books and hide_podcasts config settings', (): void => {
    const context: TabsBarContext = {
      activeTab: 'in_progress',
      config: { ...mockConfig, hide_books: true, hide_podcasts: true },
      filteredBooksCount: 0,
      filteredInProgressCount: 1,
      filteredPodcastsCount: 0,
      hasInProgressItems: true,
      isRefreshing: false,
      lang: 'en',
      onRefresh: vi.fn(),
      onTabBooks: vi.fn(),
      onTabInProgress: vi.fn(),
      onTabPodcasts: vi.fn(),
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTabsBar(context), container);

    const buttons: NodeListOf<HTMLButtonElement> =
      container.querySelectorAll('.tabs-group .tab-btn');
    expect(buttons.length).toBe(1);
    expect(buttons[0]?.classList.contains('active')).toBe(true);
  });
});

describe('renderInProgressCard()', (): void => {
  it('renders audiobook card with progress bar and responds to click', (): void => {
    const onSelect = vi.fn();
    const result: TemplateResult = renderInProgressCard(mockInProgressBook, null, onSelect);
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.card-title')?.textContent).toBe('Book Title');
    expect(container.querySelector('.card-author')?.textContent).toBe('Author Name');
    expect(container.querySelector('.progress-bar-fill')).not.toBeNull();

    const mediaCard: HTMLElement | null = container.querySelector('.media-card');
    mediaCard?.click();
    expect(onSelect).toHaveBeenCalledWith(mockInProgressBook);
  });

  it('renders podcast episode card with episode title and podcast title', (): void => {
    const onSelect = vi.fn();
    const result: TemplateResult = renderInProgressCard(
      mockInProgressPodcast,
      mockInProgressPodcast,
      onSelect,
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.card-title')?.textContent).toBe('Episode 1 Title');
    expect(container.querySelector('.card-author')?.textContent).toBe('Podcast Show Title');
    expect(container.querySelector('.media-card')?.classList.contains('active')).toBe(true);
  });

  it('hides cover image on error event', (): void => {
    const result: TemplateResult = renderInProgressCard(mockInProgressBook, null, vi.fn());
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    const img: HTMLImageElement | null = container.querySelector('img');
    expect(img).not.toBeNull();
    img?.dispatchEvent(new Event('error'));
    expect(img?.style.display).toBe('none');
  });
});

describe('renderInProgressGrid()', (): void => {
  it('renders empty state when items list is empty', (): void => {
    const result: TemplateResult = renderInProgressGrid([], null, 'en', vi.fn());
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders grid of in-progress items when items exist', (): void => {
    const result: TemplateResult = renderInProgressGrid(
      [mockInProgressBook, mockInProgressPodcast],
      null,
      'en',
      vi.fn(),
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    const cards: NodeListOf<HTMLElement> = container.querySelectorAll('.media-card');
    expect(cards.length).toBe(2);
  });
});

describe('renderBooksGrid()', (): void => {
  it('renders empty state when books array is empty', (): void => {
    const result: TemplateResult = renderBooksGrid([], null, 'en', vi.fn());
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders books with finished indicator and handles selection', (): void => {
    const onSelect = vi.fn();
    const result: TemplateResult = renderBooksGrid(
      [mockMediaBook, mockFinishedBook],
      mockMediaBook,
      'en',
      onSelect,
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    const cards: NodeListOf<HTMLElement> = container.querySelectorAll('.media-card');
    expect(cards.length).toBe(2);
    expect(cards[0]?.classList.contains('active')).toBe(true);
    expect(container.querySelector('.progress-bar-fill.finished')).not.toBeNull();

    cards[0]?.click();
    expect(onSelect).toHaveBeenCalledWith(mockMediaBook);

    const img: HTMLImageElement | null = cards[0]?.querySelector('img') ?? null;
    img?.dispatchEvent(new Event('error'));
    expect(img?.style.display).toBe('none');
  });
});

describe('renderPodcastEpisodesGrid()', (): void => {
  it('renders episode items with formatted duration and finished progress', (): void => {
    const onSelect = vi.fn();
    const result: TemplateResult = renderPodcastEpisodesGrid(
      [mockEpisode, mockFinishedEpisode],
      'podcast-1',
      mockEpisode,
      onSelect,
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    const cards: NodeListOf<HTMLElement> = container.querySelectorAll('.media-card');
    expect(cards.length).toBe(2);
    expect(cards[0]?.classList.contains('active')).toBe(true);
    expect(container.querySelector('.progress-bar-fill.finished')).not.toBeNull();

    cards[1]?.click();
    expect(onSelect).toHaveBeenCalledWith(mockFinishedEpisode);

    const img: HTMLImageElement | null = cards[0]?.querySelector('img') ?? null;
    img?.dispatchEvent(new Event('error'));
    expect(img?.style.display).toBe('none');
  });
});

describe('renderPodcastsView()', (): void => {
  it('renders empty state when podcasts list is empty in root view', (): void => {
    const context: PodcastsViewContext = {
      episodes: {},
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onSelectItem: vi.fn(),
      onSelectPodcast: vi.fn(),
      podcasts: [],
      selectedPodcastId: null,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPodcastsView(context), container);

    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders podcast cards and handles podcast click in root view', (): void => {
    const onSelectPodcast = vi.fn();
    const context: PodcastsViewContext = {
      episodes: {},
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onSelectItem: vi.fn(),
      onSelectPodcast,
      podcasts: [mockPodcast],
      selectedPodcastId: null,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPodcastsView(context), container);

    const card: HTMLElement | null = container.querySelector('.media-card');
    expect(card).not.toBeNull();
    card?.click();
    expect(onSelectPodcast).toHaveBeenCalledWith('podcast-1');

    const img: HTMLImageElement | null = card?.querySelector('img') ?? null;
    img?.dispatchEvent(new Event('error'));
    expect(img?.style.display).toBe('none');
  });

  it('renders episode view with header, back button, and loading state', (): void => {
    const onBack = vi.fn();
    const context: PodcastsViewContext = {
      allPodcasts: [mockPodcast],
      episodes: {},
      isRefreshing: true,
      lang: 'en',
      onBackToPodcasts: onBack,
      onSelectItem: vi.fn(),
      onSelectPodcast: vi.fn(),
      podcasts: [mockPodcast],
      selectedPodcastId: 'podcast-1',
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPodcastsView(context), container);

    expect(container.querySelector('.podcast-header-title')?.textContent).toBe(
      'My Favorite Podcast',
    );
    expect(container.querySelector('.empty-state')).not.toBeNull();

    const backBtn: HTMLButtonElement | null = container.querySelector('.podcast-header button');
    backBtn?.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders episode view empty state when not refreshing and no episodes exist', (): void => {
    const context: PodcastsViewContext = {
      episodes: { 'podcast-1': [] },
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onSelectItem: vi.fn(),
      onSelectPodcast: vi.fn(),
      podcasts: [mockPodcast],
      selectedPodcastId: 'podcast-1',
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPodcastsView(context), container);

    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders episode grid when episodes are available for selected podcast', (): void => {
    const onSelect = vi.fn();
    const context: PodcastsViewContext = {
      episodes: { 'podcast-1': [mockEpisode] },
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onSelectItem: onSelect,
      onSelectPodcast: vi.fn(),
      podcasts: [mockPodcast],
      selectedPodcastId: 'podcast-1',
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPodcastsView(context), container);

    const episodeCard: HTMLElement | null = container.querySelector('.media-card');
    expect(episodeCard).not.toBeNull();
    episodeCard?.click();
    expect(onSelect).toHaveBeenCalledWith(mockEpisode);
  });
});

describe('renderLibraryContent()', (): void => {
  const baseContext: LibrarySectionContext = {
    activeTab: 'in_progress',
    config: mockConfig,
    currentItem: null,
    episodes: {},
    filteredBooks: [mockMediaBook],
    filteredInProgress: [mockInProgressBook],
    filteredPodcasts: [mockPodcast],
    hasInProgressItems: true,
    isRefreshing: false,
    lang: 'en',
    onBackToPodcasts: vi.fn(),
    onClearSearch: vi.fn(),
    onRefresh: vi.fn(),
    onSearchInput: vi.fn(),
    onSelectItem: vi.fn(),
    onSelectPodcast: vi.fn(),
    onTabBooks: vi.fn(),
    onTabInProgress: vi.fn(),
    onTabPodcasts: vi.fn(),
    podcasts: [mockPodcast],
    searchQuery: '',
    selectedPodcastId: null,
  };

  it('renders loading state when isRefreshing is true and no podcast is selected', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderLibraryContent({ ...baseContext, isRefreshing: true }), container);

    expect(container.querySelector('.empty-state')).not.toBeNull();
  });

  it('renders in-progress grid when activeTab is in_progress', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderLibraryContent({ ...baseContext, activeTab: 'in_progress' }), container);

    expect(container.querySelector('.card-title')?.textContent).toBe('Book Title');
  });

  it('renders books grid when activeTab is books', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderLibraryContent({ ...baseContext, activeTab: 'books' }), container);

    expect(container.querySelector('.card-title')?.textContent).toBe('Book One');
  });

  it('renders podcasts view when activeTab is podcasts', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderLibraryContent({ ...baseContext, activeTab: 'podcasts' }), container);

    expect(container.querySelector('.card-title')?.textContent?.trim()).toBe('My Favorite Podcast');
  });
});

describe('renderLibrarySection()', (): void => {
  it('renders search row, tabs bar, and handles search input and clear button', (): void => {
    const onSearchInput = vi.fn();
    const onClearSearch = vi.fn();
    const context: LibrarySectionContext = {
      activeTab: 'books',
      config: mockConfig,
      currentItem: null,
      episodes: {},
      filteredBooks: [mockMediaBook],
      filteredInProgress: [],
      filteredPodcasts: [],
      hasInProgressItems: false,
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onClearSearch,
      onRefresh: vi.fn(),
      onSearchInput,
      onSelectItem: vi.fn(),
      onSelectPodcast: vi.fn(),
      onTabBooks: vi.fn(),
      onTabInProgress: vi.fn(),
      onTabPodcasts: vi.fn(),
      podcasts: [],
      searchQuery: 'test search',
      selectedPodcastId: null,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderLibrarySection(context), container);

    const searchInput: HTMLInputElement | null = container.querySelector('.search-input');
    expect(searchInput).not.toBeNull();
    expect(searchInput?.value).toBe('test search');

    searchInput?.dispatchEvent(new Event('input'));
    expect(onSearchInput).toHaveBeenCalledTimes(1);

    const clearBtn: HTMLButtonElement | null = container.querySelector('.search-clear-btn');
    expect(clearBtn).not.toBeNull();
    clearBtn?.dispatchEvent(new MouseEvent('click'));
    expect(onClearSearch).toHaveBeenCalledTimes(1);

    expect(container.querySelector('.tabs-bar')).not.toBeNull();
    expect(container.querySelector('.library-grid')).not.toBeNull();
  });

  it('omits clear button when search query is empty', (): void => {
    const context: LibrarySectionContext = {
      activeTab: 'books',
      config: mockConfig,
      currentItem: null,
      episodes: {},
      filteredBooks: [mockMediaBook],
      filteredInProgress: [],
      filteredPodcasts: [],
      hasInProgressItems: false,
      isRefreshing: false,
      lang: 'en',
      onBackToPodcasts: vi.fn(),
      onClearSearch: vi.fn(),
      onRefresh: vi.fn(),
      onSearchInput: vi.fn(),
      onSelectItem: vi.fn(),
      onSelectPodcast: vi.fn(),
      onTabBooks: vi.fn(),
      onTabInProgress: vi.fn(),
      onTabPodcasts: vi.fn(),
      podcasts: [],
      searchQuery: '',
      selectedPodcastId: null,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderLibrarySection(context), container);

    expect(container.querySelector('.search-clear-btn')).toBeNull();
  });
});
