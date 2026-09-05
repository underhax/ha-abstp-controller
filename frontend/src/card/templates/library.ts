import { html, type TemplateResult } from 'lit-html';
import { audiobookIcon, clearIcon, podcastIcon, waitIcon } from '../../icons.ts';
import { localize } from '../../localize.ts';
import type { AbstpCardConfig, InProgressItem, MediaItem, PodcastEpisode } from '../../types.ts';
import { isItemActive } from '../media.ts';
import { formatTime } from '../timeline.ts';

export interface TabsBarContext {
  activeTab: string;
  config?: AbstpCardConfig | undefined;
  filteredBooksCount: number;
  filteredInProgressCount: number;
  filteredPodcastsCount: number;
  hasInProgressItems: boolean;
  isRefreshing: boolean;
  lang: string;
  onRefresh: () => void | Promise<void>;
  onTabBooks: () => void;
  onTabInProgress: () => void;
  onTabPodcasts: () => void;
}

export interface PodcastsViewContext {
  allPodcasts?: MediaItem[] | undefined;
  currentItem?: InProgressItem | MediaItem | PodcastEpisode | null | undefined;
  episodes: Record<string, PodcastEpisode[]>;
  isRefreshing: boolean;
  lang: string;
  podcasts: MediaItem[];
  selectedPodcastId: string | null;
  onBackToPodcasts: () => void;
  onSelectItem: (item: PodcastEpisode) => void | Promise<void>;
  onSelectPodcast: (podcastId: string) => void | Promise<void>;
}

export interface LibrarySectionContext {
  activeTab: string;
  config?: AbstpCardConfig | undefined;
  currentItem?: InProgressItem | MediaItem | PodcastEpisode | null | undefined;
  episodes: Record<string, PodcastEpisode[]>;
  filteredBooks: MediaItem[];
  filteredInProgress: InProgressItem[];
  filteredPodcasts: MediaItem[];
  hasInProgressItems: boolean;
  isRefreshing: boolean;
  lang: string;
  podcasts: MediaItem[];
  searchQuery: string;
  selectedPodcastId: string | null;
  onBackToPodcasts: () => void;
  onClearSearch: () => void;
  onRefresh: () => void | Promise<void>;
  onSearchInput: (event: Event) => void;
  onSelectItem: (item: InProgressItem | MediaItem | PodcastEpisode) => void | Promise<void>;
  onSelectPodcast: (podcastId: string) => void | Promise<void>;
  onTabBooks: () => void;
  onTabInProgress: () => void;
  onTabPodcasts: () => void;
}

export function renderTabsBar(context: TabsBarContext): TemplateResult {
  const showInProgress: boolean = context.hasInProgressItems || context.activeTab === 'in_progress';

  return html`
    <div class="tabs-bar">
      <div class="tabs-group">
        ${
          showInProgress
            ? html`
              <button
                class="tab-btn ${context.activeTab === 'in_progress' ? 'active' : ''}"
                @click=${(): void => context.onTabInProgress()}
              >
                ${localize('card.continue_listening', context.lang)} (${context.filteredInProgressCount})
              </button>
            `
            : html``
        }
        ${
          !context.config?.hide_books
            ? html`
              <button
                class="tab-btn ${context.activeTab === 'books' ? 'active' : ''}"
                @click=${(): void => context.onTabBooks()}
              >
                ${localize('card.books', context.lang)} (${context.filteredBooksCount})
              </button>
            `
            : html``
        }
        ${
          !context.config?.hide_podcasts
            ? html`
              <button
                class="tab-btn ${context.activeTab === 'podcasts' ? 'active' : ''}"
                @click=${(): void => context.onTabPodcasts()}
              >
                ${localize('card.podcasts', context.lang)} (${context.filteredPodcastsCount})
              </button>
            `
            : html``
        }
      </div>

      <button
        class="ctrl-btn ctrl-btn-refresh icon-btn"
        @click=${(): void => {
          void context.onRefresh();
        }}
        title="${localize('card.refresh', context.lang)}"
      >
        <span class="${context.isRefreshing ? 'icon-spin' : ''}">${waitIcon}</span>
      </button>
    </div>
  `;
}

export function renderInProgressCard(
  item: InProgressItem,
  currentItem: InProgressItem | MediaItem | PodcastEpisode | null | undefined,
  onSelectItem: (item: InProgressItem) => void | Promise<void>,
): TemplateResult {
  const progressPercent: number =
    item.duration > 0 ? Math.min(100, (item.current_time / item.duration) * 100) : 0;
  const isActive: boolean = isItemActive(currentItem, item);
  const isPodcastEp: boolean = item.media_type === 'podcast' && Boolean(item.episode_title);
  const titleText: string = isPodcastEp ? (item.episode_title ?? item.title) : item.title;
  const subtitleText: string = isPodcastEp ? item.title : item.author;

  return html`
    <div
      class="media-card ${isActive ? 'active' : ''}"
      @click=${(): void => {
        void onSelectItem(item);
      }}
    >
      <div class="card-cover">
        <div class="placeholder">${item.media_type === 'podcast' ? podcastIcon : audiobookIcon}</div>
        <img
          src="/api/abstp_controller/cover/${item.id}"
          alt=""
          loading="lazy"
          @error=${(e: Event): void => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        ${
          progressPercent > 0
            ? html`
              <div class="progress-bar-bg">
                <div
                  class="progress-bar-fill"
                  style="width: ${progressPercent}%"
                ></div>
              </div>
            `
            : html``
        }
      </div>
      <div class="card-info">
        <div class="card-author" title="${subtitleText}">${subtitleText}</div>
        <div class="card-title" title="${titleText}">${titleText}</div>
      </div>
    </div>
  `;
}

export function renderInProgressGrid(
  items: InProgressItem[],
  currentItem: InProgressItem | MediaItem | PodcastEpisode | null | undefined,
  lang: string,
  onSelectItem: (item: InProgressItem) => void | Promise<void>,
): TemplateResult {
  if (items.length === 0) {
    return html`<div class="empty-state">${localize('card.no_items', lang)}</div>`;
  }

  return html`
    <div class="library-grid">
      ${items.map(
        (item: InProgressItem): TemplateResult =>
          renderInProgressCard(item, currentItem, onSelectItem),
      )}
    </div>
  `;
}

export function renderBooksGrid(
  books: MediaItem[],
  currentItem: InProgressItem | MediaItem | PodcastEpisode | null | undefined,
  lang: string,
  onSelectItem: (item: MediaItem) => void | Promise<void>,
): TemplateResult {
  if (books.length === 0) {
    return html`<div class="empty-state">${localize('card.no_items', lang)}</div>`;
  }

  return html`
    <div class="library-grid">
      ${books.map((book: MediaItem): TemplateResult => {
        const progressPercent: number =
          book.duration > 0 ? Math.min(100, (book.progress / book.duration) * 100) : 0;
        const isActive: boolean = currentItem?.id === book.id;
        return html`
          <div
            class="media-card ${isActive ? 'active' : ''}"
            @click=${(): void => {
              void onSelectItem(book);
            }}
          >
            <div class="card-cover">
              <div class="placeholder">${audiobookIcon}</div>
              <img
                src="/api/abstp_controller/cover/${book.id}"
                alt=""
                loading="lazy"
                @error=${(e: Event): void => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              ${
                book.is_finished
                  ? html`
                    <div class="progress-bar-bg">
                      <div class="progress-bar-fill finished"></div>
                    </div>
                  `
                  : progressPercent > 0
                    ? html`
                      <div class="progress-bar-bg">
                        <div
                          class="progress-bar-fill"
                          style="width: ${progressPercent}%"
                        ></div>
                      </div>
                    `
                    : html``
              }
            </div>
            <div class="card-info">
              <div class="card-author" title="${book.author}">${book.author}</div>
              <div class="card-title" title="${book.title}">${book.title}</div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export function renderPodcastEpisodesGrid(
  episodesList: PodcastEpisode[],
  podcastId: string,
  currentItem: InProgressItem | MediaItem | PodcastEpisode | null | undefined,
  onSelectItem: (item: PodcastEpisode) => void | Promise<void>,
): TemplateResult {
  return html`
    <div class="library-grid">
      ${episodesList.map((ep: PodcastEpisode): TemplateResult => {
        const isActive: boolean = currentItem?.id === ep.id;
        const progressPercent: number =
          ep.duration > 0 ? Math.min(100, (ep.progress / ep.duration) * 100) : 0;
        return html`
          <div
            class="media-card ${isActive ? 'active' : ''}"
            @click=${(): void => {
              void onSelectItem(ep);
            }}
          >
            <div class="card-cover">
              <div class="placeholder">${podcastIcon}</div>
              <img
                src="/api/abstp_controller/cover/${podcastId}"
                alt=""
                loading="lazy"
                @error=${(e: Event): void => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              ${
                ep.is_finished
                  ? html`
                    <div class="progress-bar-bg">
                      <div class="progress-bar-fill finished"></div>
                    </div>
                  `
                  : progressPercent > 0
                    ? html`
                      <div class="progress-bar-bg">
                        <div
                          class="progress-bar-fill"
                          style="width: ${progressPercent}%"
                        ></div>
                      </div>
                    `
                    : html``
              }
            </div>
            <div class="card-info">
              <div class="card-title" title="${ep.title}">${ep.title}</div>
              <div class="card-author">${formatTime(ep.duration)}</div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export function renderPodcastsView(context: PodcastsViewContext): TemplateResult {
  if (context.selectedPodcastId) {
    const podcastId: string = context.selectedPodcastId;
    const episodesList: PodcastEpisode[] = context.episodes[podcastId] ?? [];
    const currentPodcast: MediaItem | undefined = (context.allPodcasts ?? context.podcasts).find(
      (p: MediaItem): boolean => p.id === podcastId,
    );
    const podcastTitle: string = currentPodcast
      ? currentPodcast.title
      : localize('card.podcasts', context.lang);

    return html`
      <div class="podcast-header">
        <button
          class="ctrl-btn icon-btn"
          @click=${(): void => context.onBackToPodcasts()}
        >
          ←
        </button>
        <span class="podcast-header-title">${podcastTitle}</span>
      </div>
      ${
        context.isRefreshing && episodesList.length === 0
          ? html`<div class="empty-state">${localize('card.loading', context.lang)}</div>`
          : episodesList.length === 0
            ? html`<div class="empty-state">${localize('card.no_items', context.lang)}</div>`
            : renderPodcastEpisodesGrid(
                episodesList,
                podcastId,
                context.currentItem,
                context.onSelectItem,
              )
      }
    `;
  }

  if (context.podcasts.length === 0) {
    return html`<div class="empty-state">${localize('card.no_items', context.lang)}</div>`;
  }

  return html`
    <div class="library-grid">
      ${context.podcasts.map((podcast: MediaItem): TemplateResult => {
        const isActive: boolean = context.currentItem?.id === podcast.id;
        return html`
          <div
            class="media-card ${isActive ? 'active' : ''}"
            @click=${(): void => {
              void context.onSelectPodcast(podcast.id);
            }}
          >
            <div class="card-cover">
              <div class="placeholder">${podcastIcon}</div>
              <img
                src="/api/abstp_controller/cover/${podcast.id}"
                alt=""
                loading="lazy"
                @error=${(e: Event): void => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            </div>
            <div class="card-info">
              <div class="card-author" title="${podcast.author}">
                ${podcast.author}
              </div>
              <div class="card-title" title="${podcast.title}">
                ${podcast.title}
              </div>
            </div>
          </div>
        `;
      })}
    </div>
  `;
}

export function renderLibraryContent(context: LibrarySectionContext): TemplateResult {
  if (context.isRefreshing && !context.selectedPodcastId) {
    return html`<div class="empty-state">${localize('card.loading', context.lang)}</div>`;
  }
  if (context.activeTab === 'in_progress') {
    return renderInProgressGrid(
      context.filteredInProgress,
      context.currentItem,
      context.lang,
      context.onSelectItem,
    );
  }
  if (context.activeTab === 'books') {
    return renderBooksGrid(
      context.filteredBooks,
      context.currentItem,
      context.lang,
      context.onSelectItem,
    );
  }
  return renderPodcastsView({
    allPodcasts: context.podcasts,
    currentItem: context.currentItem,
    episodes: context.episodes,
    isRefreshing: context.isRefreshing,
    lang: context.lang,
    onBackToPodcasts: context.onBackToPodcasts,
    onSelectItem: context.onSelectItem,
    onSelectPodcast: context.onSelectPodcast,
    podcasts: context.filteredPodcasts,
    selectedPodcastId: context.selectedPodcastId,
  });
}

export function renderLibrarySection(context: LibrarySectionContext): TemplateResult {
  return html`
    <div class="library-section">
      <div class="search-row">
        <div class="search-input-wrapper">
          <input
            type="text"
            class="search-input"
            placeholder="${localize('card.search', context.lang)}"
            .value=${context.searchQuery}
            @input=${(e: Event): void => context.onSearchInput(e)}
          />
          ${
            context.searchQuery
              ? html`
                <button
                  type="button"
                  class="search-clear-btn"
                  title="${localize('card.clear_search', context.lang)}"
                  aria-label="${localize('card.clear_search', context.lang)}"
                  @click=${(): void => context.onClearSearch()}
                >
                  ${clearIcon}
                </button>
              `
              : html``
          }
        </div>
      </div>

      ${renderTabsBar({
        activeTab: context.activeTab,
        config: context.config,
        filteredBooksCount: context.filteredBooks.length,
        filteredInProgressCount: context.filteredInProgress.length,
        filteredPodcastsCount: context.filteredPodcasts.length,
        hasInProgressItems: context.hasInProgressItems,
        isRefreshing: context.isRefreshing,
        lang: context.lang,
        onRefresh: context.onRefresh,
        onTabBooks: context.onTabBooks,
        onTabInProgress: context.onTabInProgress,
        onTabPodcasts: context.onTabPodcasts,
      })}
      ${renderLibraryContent(context)}
    </div>
  `;
}
