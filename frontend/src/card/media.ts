import type { ChapterItem, InProgressItem, MediaItem, PodcastEpisode } from '../types.ts';
import { getItemPositionStorageKey, getStorageItem } from './storage.ts';

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
  if ('current_time' in item && typeof item.current_time === 'number' && item.current_time > 0) {
    return item.current_time;
  }
  const savedPos: string | null = getStorageItem(getItemPositionStorageKey(item.id));
  if (savedPos !== null) {
    const parsed: number = Number.parseFloat(savedPos);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
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
): MediaItem | InProgressItem | undefined {
  return (
    inProgress.find((i: InProgressItem): boolean => i.id === itemId) ||
    books.find((b: MediaItem): boolean => b.id === itemId) ||
    podcasts.find((p: MediaItem): boolean => p.id === itemId)
  );
}

export function filterInProgress(
  inProgress: InProgressItem[],
  searchQuery: string,
): InProgressItem[] {
  const query: string = searchQuery.toLowerCase();
  return inProgress.filter((item: InProgressItem): boolean => {
    const title: string = item.title || '';
    const author: string = item.author || '';
    const epTitle: string = item.episode_title ?? '';
    return (
      title.toLowerCase().includes(query) ||
      author.toLowerCase().includes(query) ||
      epTitle.toLowerCase().includes(query)
    );
  });
}

export function filterBooks(
  books: MediaItem[],
  searchQuery: string,
  filterProgress: 'all' | 'in_progress' | 'finished',
): MediaItem[] {
  const query: string = searchQuery.toLowerCase();
  return books.filter((b: MediaItem): boolean => {
    const title: string = b.title || '';
    const author: string = b.author || '';
    const matchQuery: boolean =
      title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
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

export function filterPodcasts(podcasts: MediaItem[], searchQuery: string): MediaItem[] {
  const query: string = searchQuery.toLowerCase();
  return podcasts.filter((p: MediaItem): boolean => {
    const title: string = p.title || '';
    const author: string = p.author || '';
    return title.toLowerCase().includes(query) || author.toLowerCase().includes(query);
  });
}
