export interface ChapterItem {
  duration: number;
  end: number;
  id: number;
  start: number;
  title: string;
}

export interface MediaItem {
  author: string;
  cover_url: string;
  duration: number;
  id: string;
  is_finished?: boolean;
  media_type: 'book' | 'podcast';
  narrator?: string | null;
  progress: number;
  series?: string | null;
  series_id?: string | null;
  sequence?: string | null;
  sequence_num?: number | null;
  title: string;
}

export interface SeriesGroup {
  author: string;
  books: MediaItem[];
  count: number;
  id: string;
  title: string;
}

export type LibraryBookItem = MediaItem | SeriesGroup;

export function isSeriesGroup(item: unknown): item is SeriesGroup {
  return (
    typeof item === 'object' &&
    item !== null &&
    'books' in item &&
    Array.isArray((item as SeriesGroup).books)
  );
}

export interface InProgressItem {
  author: string;
  cover_url: string;
  current_time: number;
  duration: number;
  episode?: string | null;
  episode_id?: string | null;
  episode_num?: number | null;
  episode_title?: string | null;
  id: string;
  media_type: 'book' | 'podcast';
  narrator?: string | null;
  progress: number;
  season?: string | null;
  series?: string | null;
  series_id?: string | null;
  sequence?: string | null;
  sequence_num?: number | null;
  title: string;
}

export interface PodcastEpisode {
  duration: number;
  episode?: string;
  episode_num?: number | null;
  id: string;
  is_finished?: boolean;
  podcast_id?: string;
  podcast_title?: string;
  progress: number;
  published_at?: string;
  season?: string;
  title: string;
}

export interface PlaySession {
  current_time: number;
  duration: number;
  session_id: string;
  stream_url: string;
}

export interface ActiveSessionInfo {
  current_time: number;
  entity_id: string;
  episode_id: string | null;
  item_id: string;
  session_id: string;
  speed: number;
}

export interface AbstpCardConfig {
  card_id?: string;
  default_speed?: number;
  hide_books?: boolean;
  hide_podcasts?: boolean;
  player_entities?: string[];
  skip_seconds?: number;
  type: 'custom:abstp-player-card';
}

export interface HassEntity {
  attributes: {
    friendly_name?: string;
    is_volume_muted?: boolean;
    media_artist?: string;
    media_duration?: number;
    media_position?: number;
    media_position_updated_at?: string;
    media_title?: string;
    playback_speed?: number;
    volume_level?: number;
    current_time?: number;
    episode_id?: string | null;
    item_id?: string;
    target_available?: boolean;
    target_player?: string;
    [key: string]: unknown;
  };
  entity_id: string;
  state: string;
}

export interface HomeAssistantConnection {
  subscribeMessage: <T>(
    callback: (message: T) => void,
    message: Record<string, unknown>,
  ) => Promise<() => void>;
}

export interface HomeAssistant {
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
  ) => Promise<unknown>;
  callWS: <T>(message: Record<string, unknown>) => Promise<T>;
  connection?: HomeAssistantConnection;
  language: string;
  states: Record<string, HassEntity>;
}
