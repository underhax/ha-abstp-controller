export interface MediaItem {
  author: string;
  cover_url: string;
  duration: number;
  id: string;
  media_type: 'book' | 'podcast';
  progress: number;
  title: string;
}

export interface PodcastEpisode {
  duration: number;
  episode?: string;
  id: string;
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
  default_speed?: number;
  hide_books?: boolean;
  hide_podcasts?: boolean;
  player_entities?: string[];
  player_entity?: string;
  skip_seconds?: number;
  title?: string;
  type: 'custom:abstp-player-card';
}

export interface HassEntity {
  attributes: {
    friendly_name?: string;
    is_volume_muted?: boolean;
    media_artist?: string;
    media_duration?: number;
    media_position?: number;
    media_title?: string;
    volume_level?: number;
    [key: string]: unknown;
  };
  entity_id: string;
  state: string;
}

export interface HomeAssistant {
  callService: (
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
  ) => Promise<unknown>;
  callWS: <T>(message: Record<string, unknown>) => Promise<T>;
  language: string;
  states: Record<string, HassEntity>;
}
