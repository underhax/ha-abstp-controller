import type { ReactiveControllerHost } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPEAKER_TIMER_INTERVAL_MS } from '../src/card/constants.ts';
import { AudioController } from '../src/card/controllers/audio-controller.ts';
import { PlaybackController } from '../src/card/controllers/playback-controller.ts';
import type {
  AbstpCardConfig,
  HassEntity,
  HomeAssistant,
  MediaItem,
  PodcastEpisode,
} from '../src/types.ts';

interface StorageMock {
  clear: () => void;
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const storageMock: StorageMock = ((): StorageMock => {
  let store: Record<string, string> = {};
  return {
    clear: (): void => {
      store = {};
    },
    getItem: (key: string): string | null => store[key] ?? null,
    setItem: (key: string, value: string): void => {
      store[key] = value;
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: storageMock,
  writable: true,
});

describe('PlaybackController', (): void => {
  let host: ReactiveControllerHost;
  let mockConfig: AbstpCardConfig;
  let mockHass: HomeAssistant;
  let audio: AudioController;
  let playback: PlaybackController;

  beforeEach((): void => {
    storageMock.clear();
    host = {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    mockConfig = {
      default_speed: 1.0,
      player_entities: [
        'media_player.abstp_bedroom_speaker',
        'media_player.abstp_living_room',
        'media_player.abstp_speaker_no_speed',
      ],
      type: 'custom:abstp-player-card',
    };
    mockHass = {
      callService: vi.fn().mockResolvedValue(undefined),
      callWS: vi.fn().mockResolvedValue({
        current_time: 0,
        duration: 3600,
        session_id: 'session_123',
        stream_url: 'http://example.com/audio.mp3',
      }),
      states: {
        'media_player.abstp_bedroom_speaker': {
          attributes: {
            is_volume_muted: false,
            playback_speed: 1.6,
            volume_level: 0.5,
          },
          entity_id: 'media_player.abstp_bedroom_speaker',
          state: 'idle',
        },
        'media_player.abstp_living_room': {
          attributes: {
            is_volume_muted: false,
            playback_speed: 1.0,
            volume_level: 0.8,
          },
          entity_id: 'media_player.abstp_living_room',
          state: 'idle',
        },
        'media_player.abstp_speaker_no_speed': {
          attributes: {
            is_volume_muted: false,
            volume_level: 0.8,
          },
          entity_id: 'media_player.abstp_speaker_no_speed',
          state: 'idle',
        },
      },
    } as unknown as HomeAssistant;

    audio = new AudioController(host, {
      getConfig: (): AbstpCardConfig => mockConfig,
    });

    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
    });
  });

  afterEach((): void => {
    vi.useRealTimers();
  });

  it('initializes selected player from configuration', (): void => {
    playback.initSettings();
    expect(playback.selectedPlayer).toBe('media_player.abstp_bedroom_speaker');
  });

  it('restores player speed from virtual player attributes', (): void => {
    playback.initSettings();
    playback.syncPlayerState();

    expect(audio.currentSpeed).toBe(1.6);
    expect(audio.volumeLevel).toBe(0.5);
  });

  it('selects an item without automatically starting playback', async (): Promise<void> => {
    const item: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 7200,
      id: 'book_item',
      media_type: 'book',
      progress: 300,
      title: 'Book Title',
    };

    await playback.selectItem(item);

    expect(playback.currentItem).toEqual(item);
    expect(playback.playbackPosition).toBe(300);
    expect(playback.playbackDuration).toBe(7200);
    expect(playback.isPlaying).toBe(false);
    expect(playback.isBuffering).toBe(false);
  });

  it('stops current playback when selecting a new item', async (): Promise<void> => {
    playback.isPlaying = true;
    playback.currentItem = {
      author: 'Old Author',
      cover_url: '',
      duration: 3600,
      id: 'old_item',
      media_type: 'book',
      progress: 100,
      title: 'Old Title',
    };

    const newItem: MediaItem = {
      author: 'New Author',
      cover_url: '',
      duration: 4000,
      id: 'new_item',
      media_type: 'book',
      progress: 0,
      title: 'New Title',
    };

    await playback.selectItem(newItem);

    expect(playback.isPlaying).toBe(false);
    expect(playback.currentItem?.id).toBe('new_item');
  });

  it('plays item on speaker when selectedPlayer is configured', async (): Promise<void> => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const item: MediaItem = {
      author: 'Speaker Author',
      cover_url: '',
      duration: 3600,
      id: 'speaker_book',
      media_type: 'book',
      progress: 50,
      title: 'Speaker Book',
    };

    await playback.playItem(item, 50);

    expect(mockHass.callService).toHaveBeenCalledWith('abstp_controller', 'play', {
      current_time: 50,
      entity_id: 'media_player.abstp_bedroom_speaker',
      episode_id: undefined,
      item_id: 'speaker_book',
      speed: 1.0,
    });
    expect(playback.isBuffering).toBe(true);
  });

  it('toggles play/pause correctly', (): void => {
    const item: MediaItem = {
      author: 'Toggle Author',
      cover_url: '',
      duration: 3600,
      id: 'toggle_book',
      media_type: 'book',
      progress: 120,
      title: 'Toggle Book',
    };
    playback.currentItem = item;
    playback.isPlaying = false;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';

    playback.togglePlayPause();
    expect(mockHass.callService).toHaveBeenCalled();

    playback.isPlaying = true;
    playback.togglePlayPause();
    expect(playback.isPlaying).toBe(false);
  });

  it('seeks to new position without playing when playback is inactive', async (): Promise<void> => {
    const item: MediaItem = {
      author: 'Seek Author',
      cover_url: '',
      duration: 3600,
      id: 'seek_book',
      media_type: 'book',
      progress: 0,
      title: 'Seek Book',
    };
    playback.currentItem = item;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    playback.isPlaying = false;
    playback.isBuffering = false;
    vi.clearAllMocks();

    await playback.seek(500);

    expect(playback.playbackPosition).toBe(500);
    expect(playback.currentItem.progress).toBe(500);
    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('restarts playback when seeking during active playback', async (): Promise<void> => {
    const item: MediaItem = {
      author: 'Seek Author',
      cover_url: '',
      duration: 3600,
      id: 'seek_book',
      media_type: 'book',
      progress: 0,
      title: 'Seek Book',
    };
    playback.currentItem = item;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    playback.isPlaying = true;
    vi.clearAllMocks();

    await playback.seek(500);

    expect(playback.playbackPosition).toBe(500);
    expect(mockHass.callService).toHaveBeenCalled();
  });

  it('skips forward and backward within duration boundaries', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Skip Author',
      cover_url: '',
      duration: 1000,
      id: 'skip_book',
      media_type: 'book',
      progress: 0,
      title: 'Skip Book',
    };
    playback.playbackPosition = 100;
    playback.playbackDuration = 1000;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';

    await playback.skip(30);
    expect(playback.playbackPosition).toBe(130);

    await playback.skip(-50);
    expect(playback.playbackPosition).toBe(80);
  });

  it('switches player target and updates state', async (): Promise<void> => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';

    await playback.selectPlayer('');
    expect(playback.selectedPlayer).toBe('');

    await playback.selectPlayer('media_player.abstp_bedroom_speaker');
    expect(playback.selectedPlayer).toBe('media_player.abstp_bedroom_speaker');
  });

  it('restores item state from session restore parameters', (): void => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const item: MediaItem = {
      author: 'Restore Author',
      cover_url: '',
      duration: 5000,
      id: 'restore_book',
      media_type: 'book',
      progress: 0,
      title: 'Restore Book',
    };

    playback.restoreItem(item, 1500, 5000, true, 1.5);

    expect(playback.currentItem).toEqual(item);
    expect(playback.playbackPosition).toBe(1500);
    expect(playback.playbackDuration).toBe(5000);
    expect(playback.isPlaying).toBe(true);
    expect(audio.currentSpeed).toBe(1.5);
  });

  it('updates position via setPlaybackPosition', (): void => {
    playback.setPlaybackPosition(250);
    expect(playback.playbackPosition).toBe(250);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('restarts playback on speaker entering buffering state and transitions to playing once speaker plays', async (): Promise<void> => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    playback.currentItem = {
      author: 'Author',
      cover_url: '',
      duration: 3600,
      id: 'book_1',
      media_type: 'book',
      progress: 0,
      title: 'Title',
    };

    await playback.restartPlayback(1200);

    expect(playback.playbackPosition).toBe(1200);
    expect(playback.isPlaying).toBe(false);
    expect(playback.isBuffering).toBe(true);
    expect(playback.awaitingPlaybackStart).toBe(true);

    playback.syncPlaybackState('buffering');
    expect(playback.isBuffering).toBe(true);
    expect(playback.isPlaying).toBe(false);
    expect(playback.speakerSawNonPlaying).toBe(true);

    playback.syncPlaybackState('playing');
    expect(playback.isPlaying).toBe(true);
    expect(playback.isBuffering).toBe(false);
    expect(playback.awaitingPlaybackStart).toBe(false);
  });

  it('restores item position and duration when player is already active on external speaker', (): void => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    playback.isPlaying = true;
    playback.playbackPosition = 0;
    playback.playbackDuration = 0;

    const item: MediaItem = {
      author: 'Author',
      cover_url: '',
      duration: 53319,
      id: 'book_reload',
      media_type: 'book',
      progress: 0,
      title: 'Title',
    };

    playback.restoreItem(item, 35546, 53319, false);

    expect(playback.currentItem).toEqual(item);
    expect(playback.playbackPosition).toBe(35546);
    expect(playback.playbackDuration).toBe(53319);
    expect(playback.isPlaying).toBe(true);
  });

  it('stops playback when selecting item during active playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Old Author',
      cover_url: '',
      duration: 1000,
      id: 'old_book',
      media_type: 'book',
      progress: 200,
      title: 'Old Book',
    };
    playback.isPlaying = true;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';

    const newItem: MediaItem = {
      author: 'New Author',
      cover_url: '',
      duration: 2000,
      id: 'new_book',
      media_type: 'book',
      progress: 0,
      title: 'New Book',
    };

    await playback.selectItem(newItem);

    expect(playback.isPlaying).toBe(false);
    expect(playback.currentItem).toEqual(newItem);
    expect(playback.playbackPosition).toBe(0);
    expect(mockHass.callService).toHaveBeenCalledWith(
      'abstp_controller',
      'stop',
      expect.objectContaining({ entity_id: 'media_player.abstp_bedroom_speaker' }),
    );
  });

  it('loads item without calling stop service when selecting item during inactive playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Old Author',
      cover_url: '',
      duration: 1000,
      id: 'old_book',
      media_type: 'book',
      progress: 200,
      title: 'Old Book',
    };
    playback.isPlaying = false;
    playback.isBuffering = false;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    vi.clearAllMocks();

    const newItem: MediaItem = {
      author: 'New Author',
      cover_url: '',
      duration: 2000,
      id: 'new_book',
      media_type: 'book',
      progress: 0,
      title: 'New Book',
    };

    await playback.selectItem(newItem);

    expect(playback.isPlaying).toBe(false);
    expect(playback.currentItem).toEqual(newItem);
    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('restarts playback when applying changed speed during active playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Speed Author',
      cover_url: '',
      duration: 1000,
      id: 'speed_book',
      media_type: 'book',
      progress: 100,
      title: 'Speed Book',
    };
    playback.isPlaying = true;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    audio.currentSpeed = 1.5;
    vi.clearAllMocks();

    await playback.applySpeedIfChanged(1.0);

    expect(mockHass.callService).toHaveBeenCalled();
  });

  it('keeps speed change without restarting when applying speed during inactive playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Speed Author',
      cover_url: '',
      duration: 1000,
      id: 'speed_book',
      media_type: 'book',
      progress: 100,
      title: 'Speed Book',
    };
    playback.isPlaying = false;
    playback.isBuffering = false;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    audio.currentSpeed = 1.5;
    vi.clearAllMocks();

    await playback.applySpeedIfChanged(1.0);

    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('stops current playback before switching player during active playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Switch Author',
      cover_url: '',
      duration: 2000,
      id: 'switch_book',
      media_type: 'book',
      progress: 300,
      title: 'Switch Book',
    };
    playback.playbackPosition = 300;
    playback.isPlaying = true;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    vi.clearAllMocks();

    await playback.selectPlayer('media_player.abstp_living_room');

    expect(playback.selectedPlayer).toBe('media_player.abstp_living_room');
    expect(mockHass.callService).toHaveBeenCalledWith(
      'abstp_controller',
      'stop',
      expect.objectContaining({ entity_id: 'media_player.abstp_bedroom_speaker' }),
    );
    expect(mockHass.callService).toHaveBeenCalledWith(
      'abstp_controller',
      'play',
      expect.objectContaining({ entity_id: 'media_player.abstp_living_room' }),
    );
  });

  it('retains active speed and passes it to speaker service when switching speakers during active playback', async (): Promise<void> => {
    playback.currentItem = {
      author: 'Speed Author',
      cover_url: '',
      duration: 3600,
      id: 'speed_book',
      media_type: 'book',
      progress: 500,
      title: 'Speed Book',
    };
    playback.playbackPosition = 500;
    playback.isPlaying = true;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    audio.currentSpeed = 1.4;
    vi.clearAllMocks();

    await playback.selectPlayer('media_player.abstp_living_room');

    expect(playback.selectedPlayer).toBe('media_player.abstp_living_room');
    expect(audio.currentSpeed).toBe(1.4);
    expect(mockHass.callService).toHaveBeenCalledWith(
      'abstp_controller',
      'play',
      expect.objectContaining({
        entity_id: 'media_player.abstp_living_room',
        speed: 1.4,
      }),
    );
  });

  it('synchronizes speed to target speaker attribute when switching players while inactive', async (): Promise<void> => {
    playback.isPlaying = false;
    playback.isBuffering = false;
    playback.selectedPlayer = 'media_player.abstp_living_room';
    audio.currentSpeed = 1.0;
    vi.clearAllMocks();

    await playback.selectPlayer('media_player.abstp_bedroom_speaker');

    expect(playback.selectedPlayer).toBe('media_player.abstp_bedroom_speaker');
    expect(audio.currentSpeed).toBe(1.6);
    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('falls back to default speed when switching while inactive and target speaker has no speed attribute', async (): Promise<void> => {
    playback.isPlaying = false;
    playback.isBuffering = false;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    audio.currentSpeed = 1.5;
    vi.clearAllMocks();

    await playback.selectPlayer('media_player.abstp_speaker_no_speed');

    expect(playback.selectedPlayer).toBe('media_player.abstp_speaker_no_speed');
    expect(audio.currentSpeed).toBe(1.0);
    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('initializes settings when the controller connects to the host', (): void => {
    playback.hostConnected();

    expect(playback.selectedPlayer).toBe('media_player.abstp_bedroom_speaker');
  });

  it('clears pending stop timeouts and stops the speaker timer when disconnected', (): void => {
    playback.playbackStopTimeout = 1;
    const stopTimerSpy = vi.spyOn(playback.speaker, 'stopTimer');

    playback.hostDisconnected();

    expect(playback.playbackStopTimeout).toBeNull();
    expect(playback.awaitingPlaybackStop).toBe(false);
    expect(stopTimerSpy).toHaveBeenCalled();
  });

  it('advances the playback position while the speaker timer ticks during active playback', (): void => {
    vi.useFakeTimers();
    playback.currentItem = {
      author: 'Tick Author',
      cover_url: '',
      duration: 1000,
      id: 'tick_book',
      media_type: 'book',
      progress: 0,
      title: 'Tick Book',
    };
    playback.isPlaying = true;
    playback.playbackPosition = 100;
    playback.playbackDuration = 1000;
    audio.currentSpeed = 2.0;

    playback.startSpeakerTimer();
    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS);

    expect(playback.playbackPosition).toBeGreaterThan(100);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('keeps the playback position unchanged when the speaker timer ticks while not playing', (): void => {
    vi.useFakeTimers();
    playback.currentItem = {
      author: 'Stall Author',
      cover_url: '',
      duration: 1000,
      id: 'stall_book',
      media_type: 'book',
      progress: 0,
      title: 'Stall Book',
    };
    playback.isPlaying = false;
    playback.playbackPosition = 100;
    playback.playbackDuration = 1000;

    playback.startSpeakerTimer();
    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS);

    expect(playback.playbackPosition).toBe(100);
  });

  it('keeps the playback position unchanged when the speaker timer ticks without a current item', (): void => {
    vi.useFakeTimers();
    playback.isPlaying = true;
    playback.currentItem = null;
    playback.playbackPosition = 100;

    playback.startSpeakerTimer();
    vi.advanceTimersByTime(SPEAKER_TIMER_INTERVAL_MS);

    expect(playback.playbackPosition).toBe(100);
  });

  it('marks playback as playing when the speaker reports playing without pending requests', (): void => {
    playback.currentItem = {
      author: 'Direct Author',
      cover_url: '',
      duration: 1000,
      id: 'direct_book',
      media_type: 'book',
      progress: 0,
      title: 'Direct Book',
    };
    playback.isPlaying = false;
    playback.isBuffering = true;

    playback.syncPlaybackState('playing');

    expect(playback.isPlaying).toBe(true);
    expect(playback.isBuffering).toBe(false);
  });

  it('keeps awaiting playback when the speaker is still not seen as playing', (): void => {
    playback.awaitingPlaybackStart = true;
    playback.speakerSawNonPlaying = false;
    playback.isPlaying = false;
    playback.isBuffering = false;

    playback.syncPlaybackState('playing');

    expect(playback.awaitingPlaybackStart).toBe(true);
    expect(playback.isPlaying).toBe(false);
    expect(playback.isBuffering).toBe(false);
  });

  it('transitions to playing once the speaker is seen playing during playback start', (): void => {
    playback.currentItem = {
      author: 'Await Author',
      cover_url: '',
      duration: 1000,
      id: 'await_book',
      media_type: 'book',
      progress: 0,
      title: 'Await Book',
    };
    playback.awaitingPlaybackStart = true;
    playback.speakerSawNonPlaying = true;
    playback.isBuffering = true;
    playback.isPlaying = false;

    playback.syncPlaybackState('playing');

    expect(playback.awaitingPlaybackStart).toBe(false);
    expect(playback.isPlaying).toBe(true);
    expect(playback.isBuffering).toBe(false);
  });

  it.each(['off', 'unavailable'])(
    'stops playback when the speaker reports the %s state',
    (state: string): void => {
      playback.isPlaying = true;
      playback.isBuffering = true;
      playback.currentItem = {
        author: 'Off Author',
        cover_url: '',
        duration: 1000,
        id: 'off_book',
        media_type: 'book',
        progress: 0,
        title: 'Off Book',
      };
      const stopTimerSpy = vi.spyOn(playback.speaker, 'stopTimer');

      playback.syncPlaybackState(state);

      expect(playback.isPlaying).toBe(false);
      expect(playback.isBuffering).toBe(false);
      expect(stopTimerSpy).toHaveBeenCalled();
    },
  );

  it('stops playback when the speaker reports an idle state', (): void => {
    playback.isPlaying = true;
    playback.currentItem = {
      author: 'Idle Author',
      cover_url: '',
      duration: 1000,
      id: 'idle_book',
      media_type: 'book',
      progress: 0,
      title: 'Idle Book',
    };

    playback.syncPlaybackState('idle');

    expect(playback.isPlaying).toBe(false);
  });

  it('returns early when hass is unavailable during item playback', async (): Promise<void> => {
    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): undefined => undefined,
    });
    const item: MediaItem = {
      author: 'NoHass Author',
      cover_url: '',
      duration: 1000,
      id: 'nohass_book',
      media_type: 'book',
      progress: 0,
      title: 'NoHass Book',
    };

    await playback.playItem(item);

    expect(playback.currentItem).toBeNull();
  });

  it('clears chapters when playing a podcast episode', async (): Promise<void> => {
    const onClearChapters = vi.fn();
    const onChaptersRequired = vi.fn();
    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      onChaptersRequired,
      onClearChapters,
    });
    const episode: PodcastEpisode = {
      duration: 600,
      id: 'ep_1',
      podcast_id: 'pod_1',
      progress: 0,
      title: 'Episode One',
    };

    await playback.playItem(episode);

    expect(onClearChapters).toHaveBeenCalled();
    expect(onChaptersRequired).not.toHaveBeenCalled();
  });

  it('resets buffering state when the speaker play service fails', async (): Promise<void> => {
    mockHass.callService = vi.fn().mockRejectedValue(new Error('boom'));
    const item: MediaItem = {
      author: 'Fail Author',
      cover_url: '',
      duration: 1000,
      id: 'fail_book',
      media_type: 'book',
      progress: 0,
      title: 'Fail Book',
    };

    await playback.playItem(item);

    expect(playback.isBuffering).toBe(false);
    expect(playback.isPlaying).toBe(false);
    expect(playback.awaitingPlaybackStart).toBe(false);
  });

  it('starts playback when the delayed check sees the speaker playing', async (): Promise<void> => {
    vi.useFakeTimers();
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const item: MediaItem = {
      author: 'Delay Author',
      cover_url: '',
      duration: 1000,
      id: 'delay_book',
      media_type: 'book',
      progress: 0,
      title: 'Delay Book',
    };

    await playback.playItem(item);
    (mockHass.states['media_player.abstp_bedroom_speaker'] as HassEntity).state = 'playing';

    vi.advanceTimersByTime(2000);

    expect(playback.awaitingPlaybackStart).toBe(false);
    expect(playback.isPlaying).toBe(true);
  });

  it('keeps awaiting playback state when the delayed check sees a non-playing speaker', async (): Promise<void> => {
    vi.useFakeTimers();
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const item: MediaItem = {
      author: 'Delay Author',
      cover_url: '',
      duration: 1000,
      id: 'delay_book_2',
      media_type: 'book',
      progress: 0,
      title: 'Delay Book Two',
    };

    await playback.playItem(item);

    vi.advanceTimersByTime(2000);

    expect(playback.awaitingPlaybackStart).toBe(false);
    expect(playback.isPlaying).toBe(false);
  });

  it('clears a pending stop timeout before scheduling a new one', async (): Promise<void> => {
    vi.useFakeTimers();
    playback.playbackStopTimeout = 1;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';

    await playback.stop();

    expect(playback.awaitingPlaybackStop).toBe(true);

    vi.advanceTimersByTime(5000);

    expect(playback.awaitingPlaybackStop).toBe(false);
    expect(playback.playbackStopTimeout).toBeNull();
  });

  it('does nothing when toggling play without a current item', (): void => {
    playback.currentItem = null;

    playback.togglePlayPause();

    expect(playback.isPlaying).toBe(false);
    expect(mockHass.callService).not.toHaveBeenCalled();
  });

  it('returns early when restarting playback without a current item', async (): Promise<void> => {
    playback.currentItem = null;
    playback.playbackPosition = 150;

    await playback.restartPlayback(700);

    expect(playback.playbackPosition).toBe(700);
  });

  it('updates the current time on in-progress items during seek', async (): Promise<void> => {
    playback.currentItem = {
      author: 'IP Author',
      cover_url: '',
      current_time: 10,
      duration: 1000,
      id: 'ip_book',
      media_type: 'book',
      progress: 10,
      title: 'IP Book',
    };

    await playback.seek(50);

    expect(playback.playbackPosition).toBe(50);
    expect(playback.currentItem?.current_time).toBe(50);
    expect(playback.currentItem?.progress).toBe(50);
  });

  it('clears chapters when selecting a podcast episode', async (): Promise<void> => {
    const onClearChapters = vi.fn();
    const onChaptersRequired = vi.fn();
    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      onChaptersRequired,
      onClearChapters,
    });
    const episode: PodcastEpisode = {
      duration: 600,
      id: 'ep_2',
      podcast_id: 'pod_2',
      progress: 0,
      title: 'Episode Two',
    };

    await playback.selectItem(episode);

    expect(onClearChapters).toHaveBeenCalled();
    expect(onChaptersRequired).not.toHaveBeenCalled();
  });

  it('returns early when selecting the currently active player', async (): Promise<void> => {
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const syncSpy = vi.spyOn(playback, 'syncPlayerState');

    await playback.selectPlayer('media_player.abstp_bedroom_speaker');

    expect(syncSpy).not.toHaveBeenCalled();
  });

  it('keeps its source position when seeking without a current item', async (): Promise<void> => {
    playback.currentItem = null;

    await playback.seek(50);

    expect(playback.playbackPosition).toBe(50);
    expect(host.requestUpdate).toHaveBeenCalled();
  });

  it('falls back to zero duration for items without a meaningful duration', async (): Promise<void> => {
    const item: MediaItem = {
      author: 'Zero Author',
      cover_url: '',
      duration: 0,
      id: 'zero_book',
      media_type: 'book',
      progress: 0,
      title: 'Zero Book',
    };

    await playback.selectItem(item);

    expect(playback.playbackDuration).toBe(0);
  });

  it('starts the speaker timer when restoring an item into running playback', (): void => {
    const startSpy = vi.spyOn(playback, 'startSpeakerTimer');
    playback.isPlaying = true;
    const item: MediaItem = {
      author: 'Restore Author',
      cover_url: '',
      duration: 1000,
      id: 'restore_book',
      media_type: 'book',
      progress: 0,
      title: 'Restore Book',
    };

    playback.restoreItem(item, 100, 1000, false);

    expect(playback.isPlaying).toBe(true);
    expect(startSpy).toHaveBeenCalled();
  });

  it('does not start the speaker timer when restoring an idle item', (): void => {
    const startSpy = vi.spyOn(playback, 'startSpeakerTimer');
    playback.isPlaying = false;
    const item: MediaItem = {
      author: 'Restore Author',
      cover_url: '',
      duration: 1000,
      id: 'restore_book_2',
      media_type: 'book',
      progress: 0,
      title: 'Restore Book Two',
    };

    playback.restoreItem(item, 100, 1000, false);

    expect(playback.isPlaying).toBe(false);
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('prefers the configured player order when initializing settings', (): void => {
    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): HomeAssistant => mockHass,
      getPlayerOrder: (): string[] => [
        'media_player.abstp_bedroom_speaker',
        'media_player.abstp_living_room',
      ],
    });

    playback.hostConnected();

    expect(playback.selectedPlayer).toBe('media_player.abstp_bedroom_speaker');
  });

  it('stops without speaker service when hass is unavailable', async (): Promise<void> => {
    vi.useFakeTimers();
    playback = new PlaybackController(host, {
      audio,
      getConfig: (): AbstpCardConfig => mockConfig,
      getHass: (): undefined => undefined,
    });

    await playback.stop();

    expect(playback.awaitingPlaybackStop).toBe(true);

    vi.advanceTimersByTime(5000);

    expect(playback.awaitingPlaybackStop).toBe(false);
    expect(playback.playbackStopTimeout).toBeNull();
  });

  it('restarts playback from the stored position when no target is given', async (): Promise<void> => {
    playback.currentItem = {
      author: 'NoTarget Author',
      cover_url: '',
      duration: 1000,
      id: 'notarget_book',
      media_type: 'book',
      progress: 0,
      title: 'NoTarget Book',
    };
    playback.playbackPosition = 400;

    await playback.restartPlayback();

    expect(playback.playbackPosition).toBe(400);
    expect(playback.awaitingPlaybackStart).toBe(true);
  });

  it('ignores a stale delayed check once awaiting playback is cleared', async (): Promise<void> => {
    vi.useFakeTimers();
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const item: MediaItem = {
      author: 'Stale Author',
      cover_url: '',
      duration: 1000,
      id: 'stale_book',
      media_type: 'book',
      progress: 0,
      title: 'Stale Book',
    };

    await playback.playItem(item);
    playback.awaitingPlaybackStart = false;

    vi.advanceTimersByTime(2000);

    expect(playback.isPlaying).toBe(false);
  });

  it('marks playback as playing without channels when no current item is set', (): void => {
    playback.currentItem = null;
    playback.isPlaying = false;

    playback.syncPlaybackState('playing');

    expect(playback.isPlaying).toBe(true);
  });

  it.each(['paused', 'standby', 'buffering'])(
    'handles playback when the speaker reports the %s state',
    (state: string): void => {
      playback.isPlaying = true;
      playback.currentItem = {
        author: 'Half Author',
        cover_url: '',
        duration: 1000,
        id: 'half_book',
        media_type: 'book',
        progress: 0,
        title: 'Half Book',
      };

      playback.syncPlaybackState(state);

      expect(playback.isPlaying).toBe(false);
    },
  );

  it('leaves playback untouched for unrecognized speaker states', (): void => {
    playback.isPlaying = true;

    playback.syncPlaybackState('stopped');

    expect(playback.isPlaying).toBe(true);
  });

  it('reads speaker speed when volume attributes are absent', (): void => {
    mockHass.states['media_player.abstp_bedroom_speaker'] = {
      attributes: { playback_speed: 1.2 },
      entity_id: 'media_player.abstp_bedroom_speaker',
      state: 'idle',
    } as HassEntity;
    playback.selectedPlayer = 'media_player.abstp_bedroom_speaker';
    const volumeSpy = vi.spyOn(audio, 'syncSpeakerVolume');

    playback.syncPlayerState();

    expect(volumeSpy).toHaveBeenCalledWith(undefined, undefined);
  });

  it('keeps playing state when the speaker reports playing repeatedly', (): void => {
    playback.currentItem = null;
    playback.isPlaying = true;

    playback.syncPlaybackState('playing');

    expect(playback.isPlaying).toBe(true);
    expect(playback.isBuffering).toBe(false);
  });
});
