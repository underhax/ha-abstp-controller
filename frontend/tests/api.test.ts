import { describe, expect, it, vi } from 'vitest';
import {
  fetchChapters,
  fetchEpisodes,
  fetchLibrary,
  playOnSpeaker,
  setSpeakerMute,
  setSpeakerVolume,
  startBrowserSession,
  stopBrowserSession,
  stopSpeaker,
} from '../src/card/api.ts';
import type { HomeAssistant, PlaySession } from '../src/types.ts';

describe('fetchLibrary()', (): void => {
  it('requests library data via websocket', async (): Promise<void> => {
    const mockHass = {
      callWS: vi.fn().mockResolvedValue({
        books: [],
        podcasts: [],
      }),
    } as unknown as HomeAssistant;

    const result = await fetchLibrary(mockHass);
    expect(mockHass.callWS).toHaveBeenCalledWith({
      type: 'abstp_controller/get_library',
    });
    expect(result.books).toEqual([]);
  });
});

describe('fetchEpisodes()', (): void => {
  it('requests podcast episodes for specified podcast id', async (): Promise<void> => {
    const mockHass = {
      callWS: vi.fn().mockResolvedValue({
        episodes: [],
      }),
    } as unknown as HomeAssistant;

    const result = await fetchEpisodes(mockHass, 'podcast_abc');
    expect(mockHass.callWS).toHaveBeenCalledWith({
      podcast_id: 'podcast_abc',
      type: 'abstp_controller/get_episodes',
    });
    expect(result.episodes).toEqual([]);
  });
});

describe('fetchChapters()', (): void => {
  it('requests book chapters for specified book id', async (): Promise<void> => {
    const mockHass = {
      callWS: vi.fn().mockResolvedValue({
        chapters: [],
      }),
    } as unknown as HomeAssistant;

    const result = await fetchChapters(mockHass, 'book_xyz');
    expect(mockHass.callWS).toHaveBeenCalledWith({
      book_id: 'book_xyz',
      type: 'abstp_controller/get_chapters',
    });
    expect(result.chapters).toEqual([]);
  });
});

describe('startBrowserSession() and stopBrowserSession()', (): void => {
  it('initiates browser session with parameters', async (): Promise<void> => {
    const mockSession: PlaySession = {
      current_time: 120,
      duration: 3600,
      session_id: 'session_1',
      stream_url: '/stream/test',
    };
    const mockHass = {
      callWS: vi.fn().mockResolvedValue(mockSession),
    } as unknown as HomeAssistant;

    const session = await startBrowserSession(mockHass, 'item_1', 'ep_1', 1.5, 120);
    expect(mockHass.callWS).toHaveBeenCalledWith({
      current_time: 120,
      episode_id: 'ep_1',
      item_id: 'item_1',
      speed: 1.5,
      type: 'abstp_controller/start_session',
    });
    expect(session.session_id).toBe('session_1');
  });

  it('stops browser session by id', async (): Promise<void> => {
    const mockHass = {
      callWS: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await stopBrowserSession(mockHass, 'session_1');
    expect(mockHass.callWS).toHaveBeenCalledWith({
      session_id: 'session_1',
      type: 'abstp_controller/stop_session',
    });
  });
});

describe('playOnSpeaker() and stopSpeaker()', (): void => {
  it('calls abstp_controller.play service with correct parameters', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await playOnSpeaker(mockHass, 'media_player.living_room', 'item_1', undefined, 1.25, 300);
    expect(mockHass.callService).toHaveBeenCalledWith('abstp_controller', 'play', {
      current_time: 300,
      entity_id: 'media_player.living_room',
      episode_id: undefined,
      item_id: 'item_1',
      speed: 1.25,
    });
  });

  it('calls abstp_controller.stop service with entity id', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await stopSpeaker(mockHass, 'media_player.living_room');
    expect(mockHass.callService).toHaveBeenCalledWith('abstp_controller', 'stop', {
      entity_id: 'media_player.living_room',
    });
  });
});

describe('setSpeakerVolume() and setSpeakerMute()', (): void => {
  it('calls media_player.volume_set service', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await setSpeakerVolume(mockHass, 'media_player.living_room', 0.6);
    expect(mockHass.callService).toHaveBeenCalledWith('media_player', 'volume_set', {
      entity_id: 'media_player.living_room',
      volume_level: 0.6,
    });
  });

  it('calls media_player.volume_mute service', async (): Promise<void> => {
    const mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
    } as unknown as HomeAssistant;

    await setSpeakerMute(mockHass, 'media_player.living_room', true);
    expect(mockHass.callService).toHaveBeenCalledWith('media_player', 'volume_mute', {
      entity_id: 'media_player.living_room',
      is_volume_muted: true,
    });
  });
});
