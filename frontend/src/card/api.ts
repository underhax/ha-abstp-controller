import type {
  ActiveSessionInfo,
  ChapterItem,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from '../types.ts';

export interface LibraryResponse {
  active_sessions?: Record<string, ActiveSessionInfo>;
  books: MediaItem[];
  in_progress?: InProgressItem[];
  podcasts: MediaItem[];
}

export interface EpisodesResponse {
  episodes: PodcastEpisode[];
}

export interface ChaptersResponse {
  chapters: ChapterItem[];
}

export type LibraryUpdateEvent = LibraryResponse;

export interface CardPreferenceEvent {
  available_players: string[];
  available_players_known: boolean;
  card_id: string;
  selected_player: string | null;
}

export interface CardPreferenceResponse {
  available_players: string[];
  available_players_known: boolean;
  card_id: string;
  selected_player: string | null;
}

export async function subscribeLibraryUpdates(
  hass: HomeAssistant,
  callback: (message: LibraryUpdateEvent) => void,
): Promise<() => void> {
  if (!hass.connection) {
    return (): void => {};
  }
  return hass.connection.subscribeMessage<LibraryUpdateEvent>(callback, {
    type: 'abstp_controller/subscribe_library_updates',
  });
}

export async function subscribeCardPreference(
  hass: HomeAssistant,
  cardId: string,
  callback: (message: CardPreferenceEvent) => void,
): Promise<() => void> {
  if (!hass.connection) {
    return (): void => {};
  }
  return hass.connection.subscribeMessage<CardPreferenceEvent>(callback, {
    card_id: cardId,
    type: 'abstp_controller/subscribe_card_preference',
  });
}

export async function setCardPreference(
  hass: HomeAssistant,
  cardId: string,
  selectedPlayer: string | null,
): Promise<CardPreferenceResponse> {
  return hass.callWS<CardPreferenceResponse>({
    card_id: cardId,
    selected_player: selectedPlayer,
    type: 'abstp_controller/set_card_preference',
  });
}

export async function fetchLibrary(hass: HomeAssistant): Promise<LibraryResponse> {
  return hass.callWS<LibraryResponse>({
    type: 'abstp_controller/get_library',
  });
}

export async function fetchEpisodes(
  hass: HomeAssistant,
  podcastId: string,
): Promise<EpisodesResponse> {
  return hass.callWS<EpisodesResponse>({
    podcast_id: podcastId,
    type: 'abstp_controller/get_episodes',
  });
}

export async function fetchChapters(
  hass: HomeAssistant,
  bookId: string,
): Promise<ChaptersResponse> {
  return hass.callWS<ChaptersResponse>({
    book_id: bookId,
    type: 'abstp_controller/get_chapters',
  });
}

export async function playOnSpeaker(
  hass: HomeAssistant,
  entityId: string,
  itemId: string,
  episodeId: string | undefined,
  speed: number,
  currentTime: number,
): Promise<void> {
  await hass.callService('abstp_controller', 'play', {
    current_time: currentTime,
    entity_id: entityId,
    episode_id: episodeId,
    item_id: itemId,
    speed,
  });
}

export async function stopSpeaker(hass: HomeAssistant, entityId: string): Promise<void> {
  await hass.callService('abstp_controller', 'stop', {
    entity_id: entityId,
  });
}

export async function setSpeakerVolume(
  hass: HomeAssistant,
  entityId: string,
  volumeLevel: number,
): Promise<void> {
  await hass.callService('media_player', 'volume_set', {
    entity_id: entityId,
    volume_level: volumeLevel,
  });
}

export async function setSpeakerMute(
  hass: HomeAssistant,
  entityId: string,
  isMuted: boolean,
): Promise<void> {
  await hass.callService('media_player', 'volume_mute', {
    entity_id: entityId,
    is_volume_muted: isMuted,
  });
}
