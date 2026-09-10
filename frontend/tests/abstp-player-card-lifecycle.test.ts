import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import type { CardPreferenceEvent, LibraryUpdateEvent } from '../src/card/api.ts';
import * as api from '../src/card/api.ts';
import type {
  AbstpCardConfig,
  HassEntity,
  HomeAssistant,
  HomeAssistantConnection,
  InProgressItem,
  MediaItem,
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

function livingEntity(state: string = 'idle'): HassEntity {
  return {
    attributes: { friendly_name: 'Living Room' },
    entity_id: LIVING,
    state,
  };
}

function kitchenEntity(state: string = 'idle'): HassEntity {
  return {
    attributes: {},
    entity_id: KITCHEN,
    state,
  };
}

function createConnection(
  subscribeMessage: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(vi.fn()),
): HomeAssistantConnection {
  return { subscribeMessage } as unknown as HomeAssistantConnection;
}

function createHass(connection?: HomeAssistantConnection): HomeAssistant {
  const hass: HomeAssistant = {
    callService: vi.fn().mockResolvedValue(undefined),
    callWS: vi.fn(),
    language: 'en',
    states: {
      [LIVING]: livingEntity(),
      [KITCHEN]: kitchenEntity(),
    },
  };
  if (connection !== undefined) {
    (hass as HomeAssistant & { connection: HomeAssistantConnection }).connection = connection;
  }
  return hass;
}

type CardAccess = {
  cardPlayerOrder: string[];
  cardPreferenceConnection: HomeAssistantConnection | undefined;
  cardPreferenceId: string;
  cardPreferenceReady: boolean;
  cardPreferenceRepairing: boolean;
  cardPreferenceSelectedPlayer: string | null;
  cardPreferenceUnsubscribe: (() => void) | null;
  ensureCardPreferenceSubscription: () => Promise<void>;
  ensureLibraryUpdateSubscription: () => Promise<void>;
  handleCardPreferenceEvent: (message: CardPreferenceEvent) => void;
  handleVisibilityChange: () => void;
  initializeCardState: () => Promise<void>;
  libraryRefreshInterval: number | null;
  libraryUpdateConnection: HomeAssistantConnection | undefined;
  libraryUpdateUnsubscribe: (() => void) | null;
  reconcileCardPreference: () => Promise<void>;
  refreshLibraryInBackground: () => void;
  saveCardPreference: (selectedPlayer: string | null) => Promise<void>;
  selectPlayerAndSave: (playerId: string) => Promise<void>;
};

function asCard(card: AbstpPlayerCard): CardAccess {
  return card as unknown as CardAccess;
}

function config(cardId?: string): AbstpCardConfig {
  const base: AbstpCardConfig = {
    player_entities: [LIVING, KITCHEN],
    type: 'custom:abstp-player-card',
  };
  return cardId === undefined
    ? base
    : { ...base, card_id: cardId };
}

const realSetTimeout: typeof globalThis.setTimeout = globalThis.setTimeout;

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve): void => {
    realSetTimeout(resolve, 0);
  });
}

async function mountCard(
  cardAccess: CardAccess,
  hass: HomeAssistant,
  cardConfig: AbstpCardConfig,
): Promise<AbstpPlayerCard> {
  const card = cardAccess as unknown as AbstpPlayerCard;
  card.setConfig(cardConfig);
  card.hass = hass;
  document.body.append(card);
  await card.updateComplete;
  await flushAsync();
  return card;
}

describe('AbstpPlayerCard controller wiring', (): void => {
  beforeEach((): void => {
    vi.spyOn(window, 'setInterval').mockReturnValue(123 as never);
    vi.spyOn(window, 'setTimeout').mockReturnValue(456 as never);
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('fetches chapters when a book item starts playing', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const fetchSpy = vi.spyOn(card.library, 'fetchChapters').mockResolvedValue(undefined);
    const clearSpy = vi.spyOn(card.library, 'clearChapters').mockImplementation((): void => {});

    void card.playback.selectItem(bookItem);

    expect(clearSpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledWith('book-1');
  });

  it('reuses cached chapters when the same book plays again', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.library.chaptersBookId = 'book-1';
    const fetchSpy = vi.spyOn(card.library, 'fetchChapters').mockResolvedValue(undefined);
    const clearSpy = vi.spyOn(card.library, 'clearChapters').mockImplementation((): void => {});

    void card.playback.selectItem(bookItem);

    expect(clearSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('clears chapters when a podcast item is selected', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.ui.showChapters = true;
    const clearSpy = vi.spyOn(card.library, 'clearChapters').mockImplementation((): void => {});

    void card.playback.selectItem(podcastItem);

    expect(clearSpy).toHaveBeenCalled();
    expect(card.ui.showChapters).toBe(false);
  });

  it('restores the active session item onto the selected player', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    card.playback.selectedPlayer = LIVING;
    card.library.inProgress = [inProgressItem];

    card.library.applyLibraryUpdate({
      active_sessions: {
        [LIVING]: {
          current_time: 42,
          entity_id: LIVING,
          episode_id: null,
          item_id: 'ip-1',
          session_id: 's1',
          speed: 1.5,
        },
      },
      books: [bookItem],
      in_progress: [inProgressItem],
      podcasts: [],
    });

    expect(card.playback.currentItem).toEqual(inProgressItem);
    expect(card.playback.playbackPosition).toBe(42);
    expect(card.playback.isPlaying).toBe(true);
  });

  it('selects the allowed player when an active session uses an unknown one', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({ ...config('card-1'), player_entities: [KITCHEN] });
    card.playback.selectedPlayer = '';

    card.library.applyLibraryUpdate({
      active_sessions: {
        [KITCHEN]: {
          current_time: 10,
          entity_id: KITCHEN,
          episode_id: null,
          item_id: 'ip-1',
          session_id: 's2',
          speed: 1.0,
        },
      },
      books: [bookItem],
      in_progress: [inProgressItem],
      podcasts: [],
    });

    expect(card.playback.selectedPlayer).toBe(KITCHEN);
  });

  it('restores a saved library item when the player is idle', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    card.playback.selectedPlayer = LIVING;
    card.playback.currentItem = inProgressItem;
    card.library.inProgress = [inProgressItem];
    const restoreSpy = vi.spyOn(card.playback, 'restoreItem').mockImplementation((): void => {});
    const fetchChaptersSpy = vi.spyOn(card.library, 'fetchChapters').mockResolvedValue(undefined);

    card.library.restoreActiveOrSavedItem({});

    expect(restoreSpy).toHaveBeenCalledTimes(1);
    expect(fetchChaptersSpy).toHaveBeenCalledWith('ip-1');
  });

  it('applies the opening speed when the speed popover closes', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig(config('card-1'));
    card.playback.currentItem = bookItem;
    card.playback.isPlaying = true;
    card.ui.showSpeedPopover = true;
    card.ui.speedOnOpen = 1.25;

    await card.ui.closeSpeedPopover();

    expect(card.ui.showSpeedPopover).toBe(false);
  });

  it('fetches chapters when the chapters panel opens for a new book', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig(config('card-1'));
    card.playback.currentItem = bookItem;
    const fetchSpy = vi.spyOn(card.library, 'fetchChapters').mockResolvedValue(undefined);

    card.ui.toggleChapters(false);
    await flushAsync();

    expect(card.ui.showChapters).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('book-1');
  });

  it('emits a pagehide signal to the page hide handler', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    card.hass = createHass();
    document.body.append(card);
    await card.updateComplete;

    window.dispatchEvent(new Event('pagehide'));

    expect(document.querySelector('abstp-player-card')).toBe(card);
  });
});

describe('AbstpPlayerCard subscriptions', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('subscribes to library updates once per connection', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const unsubscribeOne = vi.fn();
    const connOne = createConnection(vi.fn().mockResolvedValue(unsubscribeOne));
    const connTwo = createConnection(vi.fn().mockResolvedValue(vi.fn()));
    card.hass = createHass(connOne);

    await asCard(card).ensureLibraryUpdateSubscription();
    card.hass = createHass(connTwo);
    await asCard(card).ensureLibraryUpdateSubscription();

    expect(connOne.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(connTwo.subscribeMessage).toHaveBeenCalledTimes(1);
    expect(unsubscribeOne).toHaveBeenCalled();
  });

  it('skips library subscription without a connection', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    card.hass = createHass();

    await asCard(card).ensureLibraryUpdateSubscription();

    expect(asCard(card).libraryUpdateUnsubscribe).toBeNull();
  });

  it('forwards a received library update message to the controller', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    let forwardMessage: ((message: LibraryUpdateEvent) => void) | undefined;
    const conn = createConnection(
      vi.fn(
        (callback: (message: LibraryUpdateEvent) => void): Promise<() => void> =>
          new Promise<() => void>((resolve): void => {
            forwardMessage = callback;
            resolve((): void => {});
          }),
      ),
    );
    card.hass = createHass(conn);
    const applySpy = vi
      .spyOn(card.library, 'applyLibraryUpdate')
      .mockImplementation((): void => {});

    await asCard(card).ensureLibraryUpdateSubscription();
    const message: LibraryUpdateEvent = {
      active_sessions: {},
      books: [bookItem],
      in_progress: [],
      podcasts: [],
    };
    forwardMessage?.(message);

    expect(applySpy).toHaveBeenCalledWith(message);
  });

  it('discards a library subscription when the connection changes mid-flight', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    let resolveSubscribe: ((unsubscribe: () => void) => void) | undefined;
    const unsubscribeMid = vi.fn();
    const connOne = createConnection(
      vi.fn(
        (): Promise<() => void> =>
          new Promise<() => void>((resolve): void => {
            resolveSubscribe = resolve;
          }),
      ),
    );
    const connTwo = createConnection();
    card.hass = createHass(connOne);

    const pending = asCard(card).ensureLibraryUpdateSubscription();
    card.hass = createHass(connTwo);
    resolveSubscribe?.(unsubscribeMid);
    await pending;

    expect(unsubscribeMid).toHaveBeenCalled();
    expect(asCard(card).libraryUpdateUnsubscribe).toBeNull();
  });

  it('clears the library subscription connection on failure', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const conn = createConnection(vi.fn().mockRejectedValue(new Error('Connection lost')));
    card.hass = createHass(conn);

    await asCard(card).ensureLibraryUpdateSubscription();

    expect(asCard(card).libraryUpdateConnection).toBeUndefined();
  });

  it('subscribes to card preference per card id', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const unsubscribeOne = vi.fn();
    const conn = createConnection(vi.fn().mockResolvedValue(unsubscribeOne));
    card.hass = createHass(conn);

    card.setConfig(config('card-1'));
    await asCard(card).ensureCardPreferenceSubscription();
    card.setConfig(config('card-2'));
    await asCard(card).ensureCardPreferenceSubscription();

    expect(conn.subscribeMessage).toHaveBeenCalledTimes(2);
    expect(unsubscribeOne).toHaveBeenCalled();
    const lastCall = (conn.subscribeMessage as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(lastCall).toBeDefined();
    expect((lastCall as unknown[])[1]).toMatchObject({ card_id: 'card-2' });
  });

  it('skips preference subscription without a card id', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const conn = createConnection();
    card.hass = createHass(conn);
    card.setConfig({ type: 'custom:abstp-player-card' });

    await asCard(card).ensureCardPreferenceSubscription();

    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('handles a preference event delivered through the subscription', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    let forwardMessage: ((message: CardPreferenceEvent) => void) | undefined;
    const conn = createConnection(
      vi.fn(
        (callback: (message: CardPreferenceEvent) => void): Promise<() => void> =>
          new Promise<() => void>((resolve): void => {
            forwardMessage = callback;
            resolve((): void => {});
          }),
      ),
    );
    card.hass = createHass(conn);
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    card.playback.selectedPlayer = '';
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    await asCard(card).ensureCardPreferenceSubscription();
    forwardMessage?.({
      available_players: [LIVING],
      available_players_known: true,
      card_id: 'card-1',
      selected_player: LIVING,
    });
    await flushAsync();

    expect(card.playback.selectedPlayer).toBe(LIVING);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('discards a preference subscription when the connection changes mid-flight', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    let resolveSubscribe: ((unsubscribe: () => void) => void) | undefined;
    const unsubscribeMid = vi.fn();
    const connOne = createConnection(
      vi.fn(
        (): Promise<() => void> =>
          new Promise<() => void>((resolve): void => {
            resolveSubscribe = resolve;
          }),
      ),
    );
    const connTwo = createConnection();
    card.hass = createHass(connOne);

    const pending = asCard(card).ensureCardPreferenceSubscription();
    card.hass = createHass(connTwo);
    resolveSubscribe?.(unsubscribeMid);
    await pending;

    expect(unsubscribeMid).toHaveBeenCalled();
    expect(asCard(card).cardPreferenceUnsubscribe).toBeNull();
  });

  it('clears preference state when the subscription fails', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const conn = createConnection(vi.fn().mockRejectedValue(new Error('Connection lost')));
    card.hass = createHass(conn);

    await asCard(card).ensureCardPreferenceSubscription();

    expect(asCard(card).cardPreferenceConnection).toBeUndefined();
    expect(asCard(card).cardPreferenceId).toBe('');
  });
});

describe('AbstpPlayerCard card preference handling', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('ignores preference events for another card', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig(config('card-1'));
    card.playback.selectedPlayer = LIVING;
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    asCard(card).handleCardPreferenceEvent({
      available_players: [KITCHEN],
      available_players_known: true,
      card_id: 'card-other',
      selected_player: KITCHEN,
    });

    expect(card.playback.selectedPlayer).toBe(LIVING);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('repairs an invalid selected player and saves the fallback', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    (hass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({});
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    card.playback.selectedPlayer = '';
    asCard(card).handleCardPreferenceEvent({
      available_players: ['', LIVING],
      available_players_known: true,
      card_id: 'card-1',
      selected_player: 'media_player.abstp_unknown',
    });
    await flushAsync();

    expect(card.playback.selectedPlayer).toBe(LIVING);
    expect(fetchSpy).toHaveBeenCalled();
    expect(hass.callWS).toHaveBeenCalledWith({
      card_id: 'card-1',
      selected_player: LIVING,
      type: 'abstp_controller/set_card_preference',
    });
  });

  it('applies a valid preference and starts library loading', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);
    card.playback.selectedPlayer = '';

    asCard(card).handleCardPreferenceEvent({
      available_players: [LIVING, KITCHEN],
      available_players_known: true,
      card_id: 'card-1',
      selected_player: LIVING,
    });
    await flushAsync();

    expect(card.playback.selectedPlayer).toBe(LIVING);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('falls back to an empty player when none is available', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    (hass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({});
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    asCard(card).handleCardPreferenceEvent({
      available_players: [],
      available_players_known: true,
      card_id: 'card-1',
      selected_player: 'media_player.abstp_unlisted',
    });
    await flushAsync();

    expect(card.playback.selectedPlayer).toBe('');
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe('AbstpPlayerCard preference reconciliation', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('skips reconciliation before the preference is ready', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig(config('card-1'));
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('skips reconciliation while a repair is in progress', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig(config('card-1'));
    asCard(card).cardPreferenceReady = true;
    asCard(card).cardPreferenceRepairing = true;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('skips reconciliation without hass', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    asCard(card).cardPreferenceReady = true;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('keeps the current player when it matches the preference', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    asCard(card).cardPreferenceReady = true;
    asCard(card).cardPreferenceSelectedPlayer = LIVING;
    card.playback.selectedPlayer = LIVING;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('keeps the current player when the preferred entity is missing', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    delete hass.states[KITCHEN];
    card.hass = hass;
    card.setConfig(config('card-1'));
    asCard(card).cardPreferenceReady = true;
    asCard(card).cardPreferenceSelectedPlayer = KITCHEN;
    card.playback.selectedPlayer = LIVING;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('selects the preferred player when it becomes available', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig(config('card-1'));
    asCard(card).cardPreferenceReady = true;
    asCard(card).cardPreferenceSelectedPlayer = KITCHEN;
    card.playback.selectedPlayer = LIVING;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).toHaveBeenCalledWith(KITCHEN);
    expect(asCard(card).cardPreferenceRepairing).toBe(false);
  });

  it('keeps a valid selected player when no preference exists', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    asCard(card).cardPreferenceReady = true;
    card.playback.selectedPlayer = LIVING;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('keeps an empty selected player as the computed next preference', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    hass.states = {};
    card.hass = hass;
    card.setConfig({ ...config('card-1'), player_entities: [] });
    asCard(card).cardPreferenceReady = true;
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).not.toHaveBeenCalled();
  });

  it('repairs an invalid selected player and saves the preference', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    (hass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({});
    card.setConfig({ ...config('card-1'), player_entities: [LIVING] });
    asCard(card).cardPreferenceReady = true;
    card.playback.selectedPlayer = '';
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).reconcileCardPreference();

    expect(selectSpy).toHaveBeenCalledWith(LIVING);
    expect(hass.callWS).toHaveBeenCalledWith({
      card_id: 'card-1',
      selected_player: LIVING,
      type: 'abstp_controller/set_card_preference',
    });
    expect(asCard(card).cardPreferenceRepairing).toBe(false);
  });
});

describe('AbstpPlayerCard preference persistence', (): void => {
  afterEach((): void => {
    vi.restoreAllMocks();
  });

  it('skips saving without hass', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const setPreferenceSpy = vi.spyOn(api, 'setCardPreference');

    await asCard(card).saveCardPreference(LIVING);

    expect(setPreferenceSpy).not.toHaveBeenCalled();
  });

  it('skips saving without a card id', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    card.setConfig({ type: 'custom:abstp-player-card' });

    await asCard(card).saveCardPreference(LIVING);

    expect(hass.callWS).not.toHaveBeenCalled();
  });

  it('selects a player and persists the preference', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    (hass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({});
    card.setConfig(config('card-1'));
    const selectSpy = vi.spyOn(card.playback, 'selectPlayer').mockResolvedValue(undefined);

    await asCard(card).selectPlayerAndSave(KITCHEN);

    expect(asCard(card).cardPreferenceSelectedPlayer).toBe(KITCHEN);
    expect(selectSpy).toHaveBeenCalledWith(KITCHEN);
    expect(hass.callWS).toHaveBeenCalledWith({
      card_id: 'card-1',
      selected_player: KITCHEN,
      type: 'abstp_controller/set_card_preference',
    });
  });

  it('ignores preference persistence failures', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass();
    card.hass = hass;
    (hass.callWS as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Request failed'));
    card.setConfig(config('card-1'));

    await expect(asCard(card).saveCardPreference(LIVING)).resolves.toBeUndefined();
  });
});

describe('AbstpPlayerCard update lifecycle', (): void => {
  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('preserves the previously selected player on config updates', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.hass = createHass();
    card.setConfig({
      card_id: 'card-1',
      player_entities: [LIVING],
      type: 'custom:abstp-player-card',
    });
    expect(card.playback.selectedPlayer).toBe(LIVING);

    card.playback.selectedPlayer = KITCHEN;
    card.setConfig({
      card_id: 'card-1',
      player_entities: [KITCHEN],
      type: 'custom:abstp-player-card',
    });

    expect(card.playback.selectedPlayer).toBe(KITCHEN);
  });

  it('initializes card state on first hass load', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass(createConnection());
    card.hass = hass;
    card.setConfig(config('card-1'));
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    await asCard(card).initializeCardState();

    expect(fetchSpy).toHaveBeenCalled();
    expect((hass.connection as HomeAssistantConnection).subscribeMessage).toHaveBeenCalledTimes(2);
  });

  it('reconciles preference and subscriptions when hass updates', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass(createConnection());
    card.setConfig(config('card-1'));
    card.library.libraryLoaded = true;
    card.hass = hass;
    const ensurePreferenceSpy = vi
      .spyOn(asCard(card), 'ensureCardPreferenceSubscription')
      .mockResolvedValue(undefined);
    const ensureLibrarySpy = vi
      .spyOn(asCard(card), 'ensureLibraryUpdateSubscription')
      .mockResolvedValue(undefined);
    const syncSpy = vi.spyOn(card.playback, 'syncPlayerState');
    const reconcileSpy = vi
      .spyOn(asCard(card), 'reconcileCardPreference')
      .mockResolvedValue(undefined);

    void (card as unknown as { updated: (changed: Map<string, unknown>) => void }).updated(
      new Map([['hass', undefined]]),
    );

    expect(card.library.libraryLoaded).toBe(true);
    expect(ensurePreferenceSpy).toHaveBeenCalled();
    expect(ensureLibrarySpy).toHaveBeenCalled();
    expect(syncSpy).toHaveBeenCalled();
    expect(reconcileSpy).toHaveBeenCalled();
  });

  it('subscribes again when hass updates while the library is loading', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const hass = createHass(createConnection());
    card.hass = hass;
    card.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });
    const ensureLibrarySpy = vi
      .spyOn(asCard(card), 'ensureLibraryUpdateSubscription')
      .mockResolvedValue(undefined);
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    void (card as unknown as { updated: (changed: Map<string, unknown>) => void }).updated(
      new Map([['hass', undefined]]),
    );

    expect(card.library.libraryLoaded).toBe(true);
    expect(ensureLibrarySpy).toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('returns early from updated without hass', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const ensureSpy = vi
      .spyOn(asCard(card), 'ensureCardPreferenceSubscription')
      .mockResolvedValue(undefined);

    void (card as unknown as { updated: (changed: Map<string, unknown>) => void }).updated(
      new Map([['hass', undefined]]),
    );

    expect(ensureSpy).not.toHaveBeenCalled();
  });
});

describe('AbstpPlayerCard visibility refresh', (): void => {
  beforeEach((): void => {
    vi.spyOn(window, 'setInterval').mockReturnValue(123 as never);
    vi.spyOn(window, 'setTimeout').mockReturnValue(456 as never);
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    vi.restoreAllMocks();
  });

  it('refreshes the library when the page becomes visible', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    await mountCard(asCard(card), createHass(createConnection()), config('card-1'));
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });

    asCard(card).handleVisibilityChange();

    expect(fetchSpy).toHaveBeenCalledWith(true);
  });

  it('skips the background refresh during playback', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);
    card.playback.isPlaying = true;

    asCard(card).refreshLibraryInBackground();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips the background refresh while the library is fetching', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);
    card.library.isFetchingLibrary = true;

    asCard(card).refreshLibraryInBackground();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes the library on the interval tick', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    document.body.append(card);
    const intervalCallback = vi.mocked(window.setInterval).mock.calls[0]?.[0] as () => void;
    intervalCallback();

    expect(fetchSpy).toHaveBeenCalledWith(true);
    card.remove();
  });
});

describe('AbstpPlayerCard connection cleanup', (): void => {
  beforeEach((): void => {
    vi.spyOn(window, 'setInterval').mockReturnValue(123 as never);
    vi.spyOn(window, 'setTimeout').mockReturnValue(456 as never);
  });

  afterEach((): void => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('clears timers and subscriptions on disconnect', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig(config('card-1'));
    card.hass = createHass(createConnection());
    document.body.append(card);
    await card.updateComplete;
    const preferenceUnsubscribe = vi.fn();
    const libraryUnsubscribe = vi.fn();
    asCard(card).cardPreferenceUnsubscribe = preferenceUnsubscribe;
    asCard(card).libraryUpdateUnsubscribe = libraryUnsubscribe;
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    const removeListenerSpy = vi.spyOn(document, 'removeEventListener');

    card.remove();

    expect(preferenceUnsubscribe).toHaveBeenCalled();
    expect(libraryUnsubscribe).toHaveBeenCalled();
    expect(clearIntervalSpy).toHaveBeenCalled();
    expect(removeListenerSpy).toHaveBeenCalled();
    expect(asCard(card).cardPreferenceId).toBe('');
    expect(asCard(card).cardPreferenceReady).toBe(false);
    expect(asCard(card).cardPlayerOrder).toEqual([]);
  });
});
