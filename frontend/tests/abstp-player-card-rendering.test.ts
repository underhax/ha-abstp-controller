import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import { PLAYBACK_SPEED_STEP, SPEED_PRESETS } from '../src/card/constants.ts';
import type {
  AbstpCardConfig,
  ChapterItem,
  HassEntity,
  HomeAssistant,
  InProgressItem,
  MediaItem,
  PodcastEpisode,
} from '../src/types.ts';

const LIVING: string = 'media_player.abstp_living';
const KITCHEN: string = 'media_player.abstp_kitchen';

const bookItem: MediaItem = {
  author: 'Author One',
  cover_url: '',
  duration: 3600,
  id: 'book-1',
  media_type: 'book',
  progress: 100,
  title: 'Book One',
};

const podcastItem: MediaItem = {
  author: 'Author Pod',
  cover_url: '',
  duration: 3600,
  id: 'pod-1',
  media_type: 'podcast',
  progress: 0,
  title: 'Podcast One',
};

const inProgressItem: InProgressItem = {
  author: 'Author One',
  cover_url: '',
  current_time: 120,
  duration: 3600,
  episode_id: null,
  id: 'ip-1',
  media_type: 'book',
  progress: 120,
  title: 'In Progress',
};

const episodeItem: PodcastEpisode = {
  duration: 1800,
  id: 'ep-1',
  progress: 0,
  title: 'Episode One',
};

const chaptersList: ChapterItem[] = [
  { duration: 100, end: 100, id: 1, start: 0, title: 'Chapter 1' },
  { duration: 100, end: 200, id: 2, start: 100, title: 'Chapter 2' },
  { duration: 100, end: 300, id: 3, start: 200, title: 'Chapter 3' },
];

function livingEntity(): HassEntity {
  return {
    attributes: { friendly_name: 'Living Room' },
    entity_id: LIVING,
    state: 'idle',
  };
}

function kitchenEntity(): HassEntity {
  return {
    attributes: {},
    entity_id: KITCHEN,
    state: 'idle',
  };
}

function createHass(): HomeAssistant {
  return {
    callService: vi.fn().mockResolvedValue(undefined),
    callWS: vi.fn().mockResolvedValue(undefined),
    language: 'en',
    states: {
      [LIVING]: livingEntity(),
      [KITCHEN]: kitchenEntity(),
    },
  };
}

function cardConfig(): AbstpCardConfig {
  return {
    card_id: 'card-1',
    player_entities: [LIVING, KITCHEN],
    type: 'custom:abstp-player-card',
  };
}

type CardAccess = {
  cardPreferenceReady: boolean;
};

function asCard(card: AbstpPlayerCard): CardAccess {
  return card as unknown as CardAccess;
}

async function mountCard(
  prepare: (card: AbstpPlayerCard) => void = (): void => {},
): Promise<AbstpPlayerCard> {
  const card: AbstpPlayerCard = new AbstpPlayerCard();
  asCard(card).cardPreferenceReady = true;
  card.library.libraryLoaded = true;
  prepare(card);
  card.setConfig(cardConfig());
  card.hass = createHass();
  document.body.append(card);
  await card.updateComplete;
  return card;
}

function fireClick(root: ShadowRoot, selector: string): void {
  const element: HTMLElement | null = root.querySelector(selector);
  expect(element).not.toBeNull();
  element?.dispatchEvent(new Event('click', { bubbles: true }));
}

function fireEvent(root: ShadowRoot, selector: string, eventName: string): void {
  const element: HTMLElement | null = root.querySelector(selector);
  expect(element).not.toBeNull();
  element?.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function setFieldValue(root: ShadowRoot, selector: string, value: string, eventName: string): void {
  const element: HTMLInputElement | null = root.querySelector(selector);
  expect(element).not.toBeNull();
  if (element) {
    element.value = value;
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  }
}

describe('AbstpPlayerCard device picker rendering', (): void => {
  beforeEach((): void => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('selects a device from the picker menu', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard((prepared: AbstpPlayerCard): void => {
      prepared.playback.selectedPlayer = LIVING;
    });

    fireClick(card.renderRoot as ShadowRoot, '.device-badge-btn.clickable');
    await card.updateComplete;
    fireClick(card.renderRoot as ShadowRoot, '.device-menu-item:nth-of-type(2)');
    await card.updateComplete;

    expect(card.ui.showDeviceMenu).toBe(false);
    expect(card.playback.selectedPlayer).toBe(KITCHEN);
    const callWS = vi.mocked(card.hass?.callWS ?? ((): void => {}));
    expect(callWS).toHaveBeenCalledWith({
      card_id: 'card-1',
      selected_player: KITCHEN,
      type: 'abstp_controller/set_card_preference',
    });
  });
});

describe('AbstpPlayerCard hero rendering', (): void => {
  beforeEach((): void => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('commits a timeline seek on the change event', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const seekSpy = vi.spyOn(card.playback, 'seek').mockResolvedValue(undefined);

    setFieldValue(card.renderRoot as ShadowRoot, '.time-slider', '50', 'change');

    expect(seekSpy).toHaveBeenCalledWith(50);
  });

  it('updates the playback position while scrubbing', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const positionSpy = vi
      .spyOn(card.playback, 'setPlaybackPosition')
      .mockImplementation((): void => {});

    setFieldValue(card.renderRoot as ShadowRoot, '.time-slider', '50', 'input');

    expect(positionSpy).toHaveBeenCalledWith(50);
  });

  it('skips forward from the transport controls', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const skipSpy = vi.spyOn(card.playback, 'skip').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-forward');

    expect(skipSpy).toHaveBeenCalledWith(10);
  });

  it('toggles play pause from the main button', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const toggleSpy = vi.spyOn(card.playback, 'togglePlayPause').mockImplementation((): void => {});

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-play');

    expect(toggleSpy).toHaveBeenCalled();
  });

  it('opens and adjusts the speed from the presets', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const adjustSpy = vi.spyOn(card.audio, 'adjustSpeed').mockImplementation((): void => {});

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-speed');
    await card.updateComplete;
    fireClick(card.renderRoot as ShadowRoot, '.speed-preset-btn');

    expect(adjustSpy).toHaveBeenCalledWith(SPEED_PRESETS[0]);
  });

  it('holds and releases the speed step buttons', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const startSpy = vi.spyOn(card.audio, 'startSpeedHold').mockImplementation((): void => {});
    const stopSpy = vi.spyOn(card.audio, 'stopSpeedHold').mockImplementation((): void => {});

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-speed');
    await card.updateComplete;
    fireEvent(card.renderRoot as ShadowRoot, '.speed-btn-plus', 'pointerdown');
    fireEvent(card.renderRoot as ShadowRoot, '.speed-btn-plus', 'pointerup');

    expect(startSpy).toHaveBeenCalledWith(PLAYBACK_SPEED_STEP);
    expect(stopSpy).toHaveBeenCalled();
  });

  it('toggles volume popover and mutes the player', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    const muteSpy = vi.spyOn(card.audio, 'toggleMute').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-volume');
    await card.updateComplete;
    fireClick(card.renderRoot as ShadowRoot, '.volume-popover .ctrl-btn');

    expect(card.ui.showVolumePopover).toBe(true);
    expect(muteSpy).toHaveBeenCalledWith(LIVING, card.hass);
  });

  it('changes the volume through the popover slider', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();
    card.ui.toggleVolumePopover();
    await card.updateComplete;
    const volumeSpy = vi.spyOn(card.audio, 'setVolume').mockResolvedValue(undefined);

    setFieldValue(card.renderRoot as ShadowRoot, '.volume-slider-vertical', '0.5', 'input');

    expect(volumeSpy).toHaveBeenCalledWith(0.5, LIVING, card.hass);
  });

  it('opens the chapters panel from the controls bar', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard((prepared: AbstpPlayerCard): void => {
      prepared.playback.currentItem = bookItem;
      prepared.library.chapters = chaptersList;
    });

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-chapters');

    expect(card.ui.showChapters).toBe(true);
  });

  it('opens the library from the controls bar', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard();

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-library');

    expect(card.ui.showLibrary).toBe(true);
  });
});

describe('AbstpPlayerCard library rendering', (): void => {
  beforeEach((): void => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function mountLibraryCard(
    prepare: (card: AbstpPlayerCard) => void = (): void => {},
  ): Promise<AbstpPlayerCard> {
    return mountCard((card: AbstpPlayerCard): void => {
      card.ui.showLibrary = true;
      card.library.books = [bookItem];
      card.library.podcasts = [podcastItem];
      card.library.inProgress = [inProgressItem];
      prepare(card);
    });
  }

  it('refreshes the library from the refresh button', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.ctrl-btn-refresh');

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('updates the search query on text input', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();

    setFieldValue(card.renderRoot as ShadowRoot, '.search-input', 'abc', 'input');

    expect(card.library.searchQuery).toBe('abc');
  });

  it('clears the search query from the clear button', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard((prepared: AbstpPlayerCard): void => {
      prepared.library.searchQuery = 'abc';
    });
    const clearSpy = vi.spyOn(card.library, 'clearSearch').mockImplementation((): void => {});

    fireClick(card.renderRoot as ShadowRoot, '.search-clear-btn');

    expect(clearSpy).toHaveBeenCalled();
  });

  it('selects a book from the books grid', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard((prepared: AbstpPlayerCard): void => {
      prepared.library.activeTab = 'books';
    });
    const selectSpy = vi.spyOn(card.playback, 'selectItem').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.media-card');

    expect(selectSpy).toHaveBeenCalledWith(bookItem);
  });

  it('switches to the in progress tab', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();

    fireClick(card.renderRoot as ShadowRoot, '.tab-btn:nth-of-type(1)');

    expect(card.library.activeTab).toBe('in_progress');
  });

  it('switches to the podcasts tab', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();

    fireClick(card.renderRoot as ShadowRoot, '.tab-btn:nth-of-type(3)');

    expect(card.library.activeTab).toBe('podcasts');
  });

  it('switches to the books tab', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();

    fireClick(card.renderRoot as ShadowRoot, '.tab-btn:nth-of-type(2)');

    expect(card.library.activeTab).toBe('books');
  });

  it('opens a podcast from the podcasts grid', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();
    card.library.setActiveTab('podcasts');
    await card.updateComplete;
    const episodesSpy = vi.spyOn(card.library, 'fetchEpisodes').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.media-card');

    expect(episodesSpy).toHaveBeenCalledWith('pod-1');
  });

  it('returns from a podcast to the full list', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard((prepared: AbstpPlayerCard): void => {
      prepared.library.activeTab = 'podcasts';
      prepared.library.selectedPodcastId = 'pod-1';
      prepared.library.episodes = { 'pod-1': [episodeItem] };
    });
    const backSpy = vi.spyOn(card.library, 'backToPodcasts').mockImplementation((): void => {});

    fireClick(card.renderRoot as ShadowRoot, '.podcast-header .ctrl-btn');

    expect(backSpy).toHaveBeenCalled();
  });

  it('starts the selected in progress item from the grid', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountLibraryCard();
    card.library.activeTab = 'in_progress';
    await card.updateComplete;
    const selectSpy = vi.spyOn(card.playback, 'selectItem').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.media-card');

    expect(selectSpy).toHaveBeenCalledWith(inProgressItem);
  });
});

describe('AbstpPlayerCard chapters rendering', (): void => {
  beforeEach((): void => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
      callback(0);
      return 0;
    });
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('seeks to the chapter start on click', async (): Promise<void> => {
    const card: AbstpPlayerCard = await mountCard((prepared: AbstpPlayerCard): void => {
      prepared.ui.showChapters = true;
      prepared.library.chapters = chaptersList;
      prepared.playback.currentItem = bookItem;
    });
    const seekSpy = vi.spyOn(card.playback, 'seek').mockResolvedValue(undefined);

    fireClick(card.renderRoot as ShadowRoot, '.chapter-item');

    expect(seekSpy).toHaveBeenCalledWith(0);
  });
});
