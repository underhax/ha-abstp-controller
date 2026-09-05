import type {
  ActiveSessionInfo,
  ChapterItem,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PlaySession,
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

export async function startBrowserSession(
  hass: HomeAssistant,
  itemId: string,
  episodeId: string | undefined,
  speed: number,
  currentTime: number,
): Promise<PlaySession> {
  return hass.callWS<PlaySession>({
    current_time: currentTime,
    episode_id: episodeId,
    item_id: itemId,
    speed,
    type: 'abstp_controller/start_session',
  });
}

export async function stopBrowserSession(hass: HomeAssistant, sessionId: string): Promise<void> {
  await hass.callWS({
    session_id: sessionId,
    type: 'abstp_controller/stop_session',
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
