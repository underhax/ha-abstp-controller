import type {
  ChapterItem,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
  SeriesGroup,
} from '../types.ts';

export function isPodcastItem(
  item: MediaItem | PodcastEpisode | InProgressItem | null | undefined,
): boolean {
  if (!item) {
    return false;
  }
  if ('podcast_id' in item && item.podcast_id) {
    return true;
  }
  if ('media_type' in item && item.media_type === 'podcast') {
    return true;
  }
  if ('episode_id' in item && item.episode_id) {
    return true;
  }
  return false;
}

export function resolveItemIds(item: MediaItem | PodcastEpisode | InProgressItem): {
  episodeId?: string | undefined;
  itemId: string;
} {
  if ('podcast_id' in item && item.podcast_id) {
    return { episodeId: item.id, itemId: item.podcast_id };
  }
  if ('episode_id' in item && item.episode_id) {
    return { episodeId: item.episode_id, itemId: item.id };
  }
  return { itemId: item.id };
}

export function resolveHeroCoverAndAuthor(
  item: MediaItem | PodcastEpisode | InProgressItem | null | undefined,
): {
  author: string;
  coverId: string;
  narrator: string;
} {
  if (!item) {
    return { author: '', coverId: '', narrator: '' };
  }
  const coverId: string = 'podcast_id' in item && item.podcast_id ? item.podcast_id : item.id;
  const author: string =
    'episode_title' in item && item.episode_title
      ? item.title
      : 'author' in item && item.author
        ? item.author
        : 'podcast_title' in item && item.podcast_title
          ? (item.podcast_title as string)
          : '';
  const narrator: string = 'narrator' in item && item.narrator ? item.narrator : '';
  return { author, coverId, narrator };
}

export function resolveInitialPosition(
  item: MediaItem | PodcastEpisode | InProgressItem,
  startTime?: number,
): number {
  if (startTime !== undefined && Number.isFinite(startTime) && startTime >= 0) {
    return startTime;
  }
  if ('current_time' in item && typeof item.current_time === 'number') {
    return Math.max(0, item.current_time);
  }
  return Math.max(0, item.progress || 0);
}

export function isItemActive(
  currentItem: MediaItem | PodcastEpisode | InProgressItem | null | undefined,
  item: InProgressItem,
): boolean {
  if (!currentItem) {
    return false;
  }
  if ('episode_id' in currentItem && currentItem.episode_id) {
    return currentItem.id === item.id && currentItem.episode_id === item.episode_id;
  }
  return currentItem.id === item.id;
}

export function hasNoNavigableChapters(
  currentItem: MediaItem | PodcastEpisode | InProgressItem | null,
  chapters: ChapterItem[],
): boolean {
  return !currentItem || isPodcastItem(currentItem) || chapters.length <= 1;
}

export function getCurrentChapter(
  chapters: ChapterItem[],
  playbackPosition: number,
  currentItem: MediaItem | PodcastEpisode | InProgressItem | null,
): ChapterItem | null {
  if (hasNoNavigableChapters(currentItem, chapters)) {
    return null;
  }
  const pos: number = playbackPosition;
  for (let i = 0; i < chapters.length; i++) {
    const ch: ChapterItem | undefined = chapters[i];
    if (!ch) {
      continue;
    }
    if (pos >= ch.start && pos < ch.end) {
      return ch;
    }
  }
  const lastChapter: ChapterItem | undefined = chapters[chapters.length - 1];
  if (lastChapter && pos >= lastChapter.start) {
    return lastChapter;
  }
  return chapters[0] ?? null;
}

export function findSavedItem(
  itemId: string,
  inProgress: InProgressItem[],
  books: MediaItem[],
  podcasts: MediaItem[],
  episodeId?: string | null,
): MediaItem | InProgressItem | undefined {
  const inProgressItem: InProgressItem | undefined = inProgress.find(
    (item: InProgressItem): boolean =>
      item.id === itemId && (episodeId === undefined || (item.episode_id ?? null) === episodeId),
  );
  if (inProgressItem) {
    return inProgressItem;
  }
  if (episodeId) {
    return undefined;
  }
  return (
    books.find((book: MediaItem): boolean => book.id === itemId) ||
    podcasts.find((podcast: MediaItem): boolean => podcast.id === itemId)
  );
}

export function filterInProgress(
  inProgress: InProgressItem[],
  searchQuery: string,
): InProgressItem[] {
  const query: string = searchQuery.trim().toLowerCase();
  if (!query) {
    return inProgress;
  }
  return inProgress.filter((item: InProgressItem): boolean => {
    const title: string = item.title || '';
    const author: string = item.author || '';
    const epTitle: string = item.episode_title ?? '';
    const series: string = item.series ?? '';
    return (
      title.toLowerCase().includes(query) ||
      author.toLowerCase().includes(query) ||
      epTitle.toLowerCase().includes(query) ||
      series.toLowerCase().includes(query)
    );
  });
}

export function filterBooks(
  books: MediaItem[],
  searchQuery: string,
  filterProgress: 'all' | 'in_progress' | 'finished',
): MediaItem[] {
  const query: string = searchQuery.trim().toLowerCase();
  return books.filter((b: MediaItem): boolean => {
    const title: string = b.title || '';
    const author: string = b.author || '';
    const series: string = b.series ?? '';
    const matchQuery: boolean =
      !query ||
      title.toLowerCase().includes(query) ||
      author.toLowerCase().includes(query) ||
      series.toLowerCase().includes(query);
    if (!matchQuery) {
      return false;
    }
    if (filterProgress === 'in_progress') {
      return !b.is_finished && b.progress > 0 && b.progress < b.duration;
    }
    if (filterProgress === 'finished') {
      return Boolean(b.is_finished) || (b.progress >= b.duration && b.duration > 0);
    }
    return true;
  });
}

export function compareBooksBySequence(a: MediaItem, b: MediaItem): number {
  const aNum: number = a.sequence_num ?? Number.POSITIVE_INFINITY;
  const bNum: number = b.sequence_num ?? Number.POSITIVE_INFINITY;
  if (aNum !== bNum) {
    return aNum - bNum;
  }
  return (a.title || '').localeCompare(b.title || '');
}

export function sortBooksBySequence(books: MediaItem[]): MediaItem[] {
  return books.sort(compareBooksBySequence);
}

export function matchesSeries(book: MediaItem, seriesIdOrTitle: string): boolean {
  return (book.series_id?.trim() || book.series?.trim()) === seriesIdOrTitle;
}

export function groupBooksBySeries(books: MediaItem[]): Array<MediaItem | SeriesGroup> {
  const seriesMap = new Map<string, { group: SeriesGroup; index: number }>();
  const result: Array<MediaItem | SeriesGroup> = [];

  for (const book of books) {
    const seriesName: string = book.series?.trim() ?? '';
    const seriesKey: string = book.series_id?.trim() || seriesName;

    if (!seriesKey || !seriesName) {
      result.push(book);
      continue;
    }

    const existing = seriesMap.get(seriesKey);
    if (existing) {
      existing.group.books.push(book);
      existing.group.count++;
    } else {
      const newGroup: SeriesGroup = {
        author: book.author || '',
        books: [book],
        count: 1,
        id: seriesKey,
        title: seriesName,
      };
      const index: number = result.length;
      result.push(newGroup);
      seriesMap.set(seriesKey, { group: newGroup, index });
    }
  }

  for (const { group, index } of seriesMap.values()) {
    if (group.books.length < 2) {
      result[index] = group.books[0] as MediaItem;
    } else {
      sortBooksBySequence(group.books);
      group.author = group.books[0]?.author || group.author;
    }
  }

  return result;
}

export function formatSequenceBadge(sequence?: string | null, sequenceNum?: number | null): string {
  if (sequence && sequence.trim().length > 0) {
    const trimmed: string = sequence.trim();
    return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
  }
  if (sequenceNum !== null && sequenceNum !== undefined) {
    return `#${sequenceNum}`;
  }
  return '';
}

export function formatEpisodeBadge(
  season?: string | null,
  episode?: string | null,
  episodeNum?: number | null,
): string {
  const cleanSeason: string = season?.trim() ?? '';
  const cleanEpisode: string = episode?.trim() ?? '';

  if (cleanSeason.length > 0 && cleanEpisode.length > 0) {
    return `S${cleanSeason}E${cleanEpisode}`;
  }
  if (cleanEpisode.length > 0) {
    return cleanEpisode.startsWith('E') || cleanEpisode.startsWith('#')
      ? cleanEpisode
      : `E${cleanEpisode}`;
  }
  if (episodeNum !== null && episodeNum !== undefined) {
    return `#${episodeNum}`;
  }
  return '';
}

export function filterPodcasts(podcasts: MediaItem[], searchQuery: string): MediaItem[] {
  const query: string = searchQuery.toLowerCase();
  return podcasts.filter((p: MediaItem): boolean => {
    const title: string = p.title || '';
    const author: string = p.author || '';
    return title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
  });
}
