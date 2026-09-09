import { describe, expect, it, vi } from 'vitest';
import {
  fetchChapters,
  fetchEpisodes,
  fetchLibrary,
  playOnSpeaker,
  setSpeakerMute,
  setSpeakerVolume,
  stopSpeaker,
  subscribeLibraryUpdates,
} from '../src/card/api.ts';
import type { HomeAssistant, HomeAssistantConnection } from '../src/types.ts';

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

describe('subscribeLibraryUpdates()', (): void => {
  it('subscribes to coordinator library updates', async (): Promise<void> => {
    const unsubscribe = vi.fn();
    const connection: HomeAssistantConnection = {
      subscribeMessage: vi.fn().mockResolvedValue(unsubscribe),
    };
    const mockHass = { connection } as unknown as HomeAssistant;
    const callback = vi.fn();

    const result = await subscribeLibraryUpdates(mockHass, callback);

    expect(connection.subscribeMessage).toHaveBeenCalledWith(callback, {
      type: 'abstp_controller/subscribe_library_updates',
    });
    expect(result).toBe(unsubscribe);
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
