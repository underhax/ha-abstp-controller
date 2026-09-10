import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AbstpPlayerCardEditor } from '../src/abstp-player-card-editor.ts';
import type { AbstpCardConfig, HomeAssistant } from '../src/types.ts';

interface MediaPlayerOption {
  id: string;
  name: string;
}

type EditorPrivate = {
  cardIdError: string | null;
  draggedPlayer: string | null;
  fireConfigChanged: (config: AbstpCardConfig) => void;
  getConfiguredPlayerIds: () => string[];
  getMediaPlayers: () => string[];
  getPlayerOption: (id: string, lang: string) => MediaPlayerOption;
  handleAddPlayer: () => void;
  handleHideBooksChange: (ev: Event) => void;
  handleHidePodcastsChange: (ev: Event) => void;
  handlePlayerDragEnd: () => void;
  handlePlayerDragStart: (playerId: string, ev: DragEvent) => void;
  handlePlayerDrop: (targetId: string, ev: DragEvent) => void;
  handlePlayerSelection: (ev: Event) => void;
  handleRemovePlayer: (playerId: string) => void;
  handleSkipSecondsChange: (ev: Event) => void;
  handleSpeedChange: (ev: Event) => void;
  playerToAdd: string;
  validateCardId: (cardId: string | undefined) => Promise<boolean>;
};

type EditorStatic = {
  countCardId: (value: unknown, cardId: string) => number;
  formatPlayerName: (option: MediaPlayerOption) => string;
  getDashboardPath: () => string;
  handlePlayerDragOver: (ev: DragEvent) => void;
};

const baseConfig: AbstpCardConfig = { type: 'custom:abstp-player-card' };

function asPrivate(editor: AbstpPlayerCardEditor): EditorPrivate {
  return editor as unknown as EditorPrivate;
}

function renderTemplate(
  editor: AbstpPlayerCardEditor,
): ReturnType<AbstpPlayerCardEditor['render']> {
  return (
    editor as unknown as { render: () => ReturnType<AbstpPlayerCardEditor['render']> }
  ).render();
}

function asStatic(): EditorStatic {
  return AbstpPlayerCardEditor as unknown as EditorStatic;
}

function createHass(states: Record<string, unknown>): HomeAssistant {
  return {
    callService: vi.fn(),
    callWS: vi.fn(),
    language: 'en',
    states: states as HomeAssistant['states'],
  };
}

function createEditor(hass?: HomeAssistant): AbstpPlayerCardEditor {
  const editor: AbstpPlayerCardEditor = new AbstpPlayerCardEditor();
  if (hass !== undefined) {
    editor.hass = hass;
  }
  return editor;
}

function captureChanges(editor: AbstpPlayerCardEditor): AbstpCardConfig[] {
  const changes: AbstpCardConfig[] = [];
  editor.addEventListener('config-changed', ((ev: Event): void => {
    const detail = (ev as CustomEvent<{ config: AbstpCardConfig }>).detail;
    changes.push(detail.config);
  }) as EventListener);
  return changes;
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve): void => {
    setTimeout(resolve, 0);
  });
}

function inputEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

function checkedEvent(checked: boolean): Event {
  return { target: { checked } } as unknown as Event;
}

function selectionEvent(value: string): Event {
  return { target: { value } } as unknown as Event;
}

function dragEvent(dataTransfer?: Pick<DataTransfer, 'getData'>): DragEvent {
  return { dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent;
}

describe('AbstpPlayerCardEditor', (): void => {
  const originalLocation: Location = window.location;
  const playersHass: HomeAssistant = createHass({
    'media_player.abstp_kitchen': {
      attributes: {},
      entity_id: 'media_player.abstp_kitchen',
      state: 'idle',
    },
    'media_player.abstp_living': {
      attributes: { friendly_name: 'Living Room' },
      entity_id: 'media_player.abstp_living',
      state: 'idle',
    },
  });

  afterEach((): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
      writable: true,
    });
  });

  it('assigns a generated card id and dispatches on microtask', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    editor.setConfig(baseConfig);
    await flushAsync();

    expect(changes).toHaveLength(1);
    expect(changes[0]?.card_id).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('keeps the provided card id without dispatching during setConfig', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    editor.setConfig({ card_id: 'manual-id', type: 'custom:abstp-player-card' });
    await flushAsync();

    expect(changes).toHaveLength(0);
    expect(asPrivate(editor).cardIdError).toBeNull();
  });

  it('skips the generated id dispatch when config is replaced first', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    editor.setConfig(baseConfig);
    editor.setConfig({ card_id: 'manual-id', type: 'custom:abstp-player-card' });
    await flushAsync();

    expect(changes).toHaveLength(0);
  });

  it('dispatches a config change for a valid card id', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).fireConfigChanged({
      card_id: 'card-1',
      default_speed: 1.5,
      type: 'custom:abstp-player-card',
    });
    await flushAsync();

    expect(changes).toHaveLength(1);
    expect(changes[0]?.default_speed).toBe(1.5);
  });

  it('keeps previous config when the card id validation fails', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({ card_id: 'card-dupe', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);
    (playersHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      views: [
        {
          cards: [
            { card_id: 'card-dupe', type: 'custom:abstp-player-card' },
            { card_id: 'card-dupe', type: 'custom:abstp-player-card' },
          ],
        },
      ],
    });

    asPrivate(editor).fireConfigChanged({ card_id: 'card-dupe', type: 'custom:abstp-player-card' });
    await flushAsync();

    expect(asPrivate(editor).cardIdError).toBe('Card ID must be unique.');
    expect(changes).toHaveLength(0);
  });

  it('accepts a validated card id appearing once in the dashboard', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({ card_id: 'card-solo', type: 'custom:abstp-player-card' });
    (playersHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      views: [
        {
          cards: [{ card_id: 'card-solo', type: 'custom:abstp-player-card' }],
        },
      ],
    });

    const isValid: boolean = await asPrivate(editor).validateCardId('card-solo');

    expect(isValid).toBe(true);
    expect(asPrivate(editor).cardIdError).toBeNull();
  });

  it('rejects a card id already used by another card', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({ card_id: 'card-current', type: 'custom:abstp-player-card' });
    (playersHass.callWS as ReturnType<typeof vi.fn>).mockResolvedValue({
      views: [
        {
          cards: [{ card_id: 'card-other', type: 'custom:abstp-player-card' }],
        },
      ],
    });

    const isValid: boolean = await asPrivate(editor).validateCardId('card-other');

    expect(isValid).toBe(false);
    expect(asPrivate(editor).cardIdError).toBe('Card ID must be unique.');
  });

  it('restores validation state when the dashboard request fails', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({ card_id: 'card-fail', type: 'custom:abstp-player-card' });
    (playersHass.callWS as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Network error'));

    const isValid: boolean = await asPrivate(editor).validateCardId('card-fail');

    expect(isValid).toBe(true);
    expect(asPrivate(editor).cardIdError).toBeNull();
  });

  it('validates immediately without a card id', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();

    await expect(asPrivate(editor).validateCardId(undefined)).resolves.toBe(true);
  });

  it('validates immediately when hass is unavailable', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();

    await expect(asPrivate(editor).validateCardId('card-nohass')).resolves.toBe(true);
  });

  it('deduplicates configured player ids removing empty entries', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.a', 'media_player.a', ''],
      type: 'custom:abstp-player-card',
    });

    expect(asPrivate(editor).getConfiguredPlayerIds()).toEqual(['media_player.a']);
  });

  it('returns an empty configured list by default', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig(baseConfig);

    expect(asPrivate(editor).getConfiguredPlayerIds()).toEqual([]);
  });

  it('lists media player entities from hass state', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);

    expect(asPrivate(editor).getMediaPlayers()).toEqual([
      'media_player.abstp_kitchen',
      'media_player.abstp_living',
    ]);
  });

  it('returns an empty player list without hass', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();

    expect(asPrivate(editor).getMediaPlayers()).toEqual([]);
  });

  it('resolves player friendly names from state attributes', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);

    expect(asPrivate(editor).getPlayerOption('media_player.abstp_living', 'en')).toEqual({
      id: 'media_player.abstp_living',
      name: 'Living Room',
    });
    expect(asPrivate(editor).getPlayerOption('media_player.abstp_kitchen', 'en')).toEqual({
      id: 'media_player.abstp_kitchen',
      name: 'media_player.abstp_kitchen',
    });
  });

  it('formats player names including the short entity id', (): void => {
    const named: MediaPlayerOption = {
      id: 'media_player.abstp_living',
      name: 'Living Room',
    };
    const bare: MediaPlayerOption = {
      id: 'media_player.abstp_kitchen',
      name: 'media_player.abstp_kitchen',
    };

    expect(asStatic().formatPlayerName(named)).toBe('Living Room (abstp_living)');
    expect(asStatic().formatPlayerName(bare)).toBe('media_player.abstp_kitchen');
  });

  it.each([
    { expected: 2.5, input: '2.5' },
    { expected: 1.0, input: 'not-a-number' },
    { expected: 0.5, input: '0.1' },
    { expected: 3.0, input: '9' },
  ])('clamps speed input $input to $expected', async ({ input, expected }): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-speed', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleSpeedChange(inputEvent(input));
    await flushAsync();

    expect(changes[0]?.default_speed).toBe(expected);
  });

  it.each([
    { expected: 20, input: '20' },
    { expected: 10, input: 'not-a-number' },
    { expected: 5, input: '2' },
    { expected: 60, input: '99' },
  ])('clamps skip input $input to $expected', async ({ input, expected }): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-skip', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleSkipSecondsChange(inputEvent(input));
    await flushAsync();

    expect(changes[0]?.skip_seconds).toBe(expected);
  });

  it('ignores speed changes without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleSpeedChange(inputEvent('2.0'));

    expect(changes).toHaveLength(0);
  });

  it('ignores skip changes without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleSkipSecondsChange(inputEvent('20'));

    expect(changes).toHaveLength(0);
  });

  it('adds a selected player to the configured list', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living'],
      type: 'custom:abstp-player-card',
    });
    asPrivate(editor).playerToAdd = 'media_player.abstp_kitchen';
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleAddPlayer();
    await flushAsync();

    expect(changes[0]?.player_entities).toEqual([
      'media_player.abstp_living',
      'media_player.abstp_kitchen',
    ]);
    expect(asPrivate(editor).playerToAdd).toBe('__none__');
  });

  it('does not add the placeholder player', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleAddPlayer();

    expect(changes).toHaveLength(0);
  });

  it('does not add a player already in the configured list', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living'],
      type: 'custom:abstp-player-card',
    });
    asPrivate(editor).playerToAdd = 'media_player.abstp_living';
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleAddPlayer();

    expect(changes).toHaveLength(0);
  });

  it('ignores player addition without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleAddPlayer();

    expect(changes).toHaveLength(0);
  });

  it('removes a configured player from the list', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living', 'media_player.abstp_kitchen'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleRemovePlayer('media_player.abstp_living');
    await flushAsync();

    expect(changes[0]?.player_entities).toEqual(['media_player.abstp_kitchen']);
  });

  it('ignores player removal without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleRemovePlayer('media_player.abstp_living');

    expect(changes).toHaveLength(0);
  });

  it('starts a player drag storing the source id', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const dataTransfer: Pick<DataTransfer, 'effectAllowed' | 'setData'> = {
      effectAllowed: 'move',
      setData: vi.fn(),
    };

    asPrivate(editor).handlePlayerDragStart('media_player.abstp_living', {
      dataTransfer,
    } as unknown as DragEvent);

    expect(asPrivate(editor).draggedPlayer).toBe('media_player.abstp_living');
    expect(dataTransfer.setData).toHaveBeenCalled();
  });

  it('starts a player drag without a data transfer target', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();

    asPrivate(editor).handlePlayerDragStart('media_player.abstp_kitchen', dragEvent());

    expect(asPrivate(editor).draggedPlayer).toBe('media_player.abstp_kitchen');
  });

  it('allows the drop over a player item', (): void => {
    const dataTransfer: Pick<DataTransfer, 'dropEffect'> = { dropEffect: 'none' };
    const ev = { dataTransfer, preventDefault: vi.fn() } as unknown as DragEvent;

    asStatic().handlePlayerDragOver(ev);

    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('allows the drop without a data transfer target', (): void => {
    const ev: DragEvent = dragEvent();

    asStatic().handlePlayerDragOver(ev);

    expect(ev.preventDefault).toHaveBeenCalled();
  });

  it('reorders players when dropped onto another item', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living', 'media_player.abstp_kitchen'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop(
      'media_player.abstp_living',
      dragEvent({ getData: (): string => 'media_player.abstp_kitchen' }),
    );
    await flushAsync();

    expect(changes[0]?.player_entities).toEqual([
      'media_player.abstp_kitchen',
      'media_player.abstp_living',
    ]);
  });

  it('reorders players using the tracked dragged id', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living', 'media_player.abstp_kitchen'],
      type: 'custom:abstp-player-card',
    });
    asPrivate(editor).handlePlayerDragStart('media_player.abstp_kitchen', dragEvent());
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop('media_player.abstp_living', dragEvent());
    await flushAsync();

    expect(changes[0]?.player_entities).toEqual([
      'media_player.abstp_kitchen',
      'media_player.abstp_living',
    ]);
  });

  it('ignores a drop onto the same player', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop(
      'media_player.abstp_living',
      dragEvent({ getData: (): string => 'media_player.abstp_living' }),
    );

    expect(changes).toHaveLength(0);
  });

  it('ignores a drop of an unknown player id', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop(
      'media_player.abstp_living',
      dragEvent({ getData: (): string => 'media_player.unknown' }),
    );

    expect(changes).toHaveLength(0);
  });

  it('ignores a drop without a source id', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop('media_player.abstp_living', dragEvent());

    expect(changes).toHaveLength(0);
  });

  it('ignores a drop without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handlePlayerDrop('media_player.abstp_living', dragEvent());

    expect(changes).toHaveLength(0);
  });

  it('clears the dragged player on drag end', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    asPrivate(editor).draggedPlayer = 'media_player.abstp_living';

    asPrivate(editor).handlePlayerDragEnd();

    expect(asPrivate(editor).draggedPlayer).toBeNull();
  });

  it('stores the selected player from the dropdown', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();

    asPrivate(editor).handlePlayerSelection(selectionEvent('media_player.abstp_kitchen'));

    expect(asPrivate(editor).playerToAdd).toBe('media_player.abstp_kitchen');
  });

  it('toggles the hide books checkbox into the config', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleHideBooksChange(checkedEvent(true));
    await flushAsync();

    expect(changes[0]?.hide_books).toBe(true);
  });

  it('ignores hide books changes without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleHideBooksChange(checkedEvent(true));

    expect(changes).toHaveLength(0);
  });

  it('toggles the hide podcasts checkbox into the config', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleHidePodcastsChange(checkedEvent(false));
    await flushAsync();

    expect(changes[0]?.hide_podcasts).toBe(false);
  });

  it('ignores hide podcasts changes without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    const changes: AbstpCardConfig[] = captureChanges(editor);

    asPrivate(editor).handleHidePodcastsChange(checkedEvent(true));

    expect(changes).toHaveLength(0);
  });

  it('extracts the dashboard path from a lovelace url', (): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/lovelace/0' },
      writable: true,
    });

    expect(asStatic().getDashboardPath()).toBe('0');
  });

  it('falls back to the default dashboard for a bare lovelace url', (): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/lovelace' },
      writable: true,
    });

    expect(asStatic().getDashboardPath()).toBe('0');
  });

  it('extracts the dashboard path from a custom dashboard url', (): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/house/dashboard' },
      writable: true,
    });

    expect(asStatic().getDashboardPath()).toBe('house');
  });

  it('falls back to lovelace when the path has no segments', (): void => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { pathname: '/' },
      writable: true,
    });

    expect(asStatic().getDashboardPath()).toBe('lovelace');
  });

  it('counts card ids across nested arrays and objects', (): void => {
    const dashboard: unknown = {
      views: [
        {
          cards: [
            { card_id: 'card-x', type: 'custom:abstp-player-card' },
            { card_id: 'card-other', type: 'custom:abstp-player-card' },
          ],
        },
      ],
    };

    expect(asStatic().countCardId(dashboard, 'card-x')).toBe(1);
    expect(asStatic().countCardId(dashboard, 'card-missing')).toBe(0);
  });

  it('counts zero card ids for primitive values', (): void => {
    expect(asStatic().countCardId(null, 'card-x')).toBe(0);
    expect(asStatic().countCardId('text', 'card-x')).toBe(0);
    expect(asStatic().countCardId(42, 'card-x')).toBe(0);
  });

  it('counts a direct matching card object', (): void => {
    const card: unknown = { card_id: 'card-direct', type: 'custom:abstp-player-card' };

    expect(asStatic().countCardId(card, 'card-direct')).toBe(1);
    expect(asStatic().countCardId([card, card], 'card-direct')).toBe(2);
  });

  it('renders nothing without hass', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor();
    editor.setConfig(baseConfig);

    expect(renderTemplate(editor).values).toHaveLength(0);
  });

  it('renders nothing without a config', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);

    expect(renderTemplate(editor).values).toHaveLength(0);
  });

  it('renders the full editor with all players configured', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living', 'media_player.abstp_kitchen'],
      type: 'custom:abstp-player-card',
    });
    asPrivate(editor).cardIdError = 'Card ID must be unique.';
    asPrivate(editor).handlePlayerDragStart('media_player.abstp_living', dragEvent());

    const result = renderTemplate(editor);

    expect(result.values.length).toBeGreaterThan(0);
  });

  it('handles interactions in the rendered editor', async (): Promise<void> => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({
      card_id: 'card-1',
      player_entities: ['media_player.abstp_living', 'media_player.abstp_kitchen'],
      type: 'custom:abstp-player-card',
    });
    const changes: AbstpCardConfig[] = captureChanges(editor);
    const container: HTMLDivElement = document.createElement('div');
    document.body.append(container);
    const root: ShadowRoot = editor.attachShadow({ mode: 'open' });
    render(renderTemplate(editor), root);
    container.append(editor);
    await flushAsync();

    const items: NodeListOf<HTMLElement> = root.querySelectorAll('.player-list-item');
    const itemsList: HTMLElement[] = [...items];
    itemsList[0]?.dispatchEvent(new Event('dragstart', { bubbles: true }));
    await flushAsync();
    itemsList[1]?.dispatchEvent(new Event('dragover', { bubbles: true }));
    await flushAsync();
    itemsList[1]?.dispatchEvent(new Event('drop', { bubbles: true }));
    await flushAsync();
    itemsList[0]?.dispatchEvent(new Event('dragend', { bubbles: true }));
    await flushAsync();

    const remove: HTMLButtonElement = root.querySelector(
      '.remove-player-button',
    ) as HTMLButtonElement;
    remove.click();
    await flushAsync();
    const add: HTMLButtonElement = root.querySelector('.add-player-button') as HTMLButtonElement;
    add.disabled = false;
    add.click();
    await flushAsync();

    const numberInputs: NodeListOf<HTMLInputElement> =
      root.querySelectorAll('input[type="number"]');
    const inputList: HTMLInputElement[] = [...numberInputs];
    const speedInput: HTMLInputElement = inputList[0] as HTMLInputElement;
    speedInput.value = '2.0';
    speedInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();
    const skipInput: HTMLInputElement = inputList[1] as HTMLInputElement;
    skipInput.value = '30';
    skipInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flushAsync();

    const books: HTMLInputElement = root.querySelector('#hide_books') as HTMLInputElement;
    books.checked = true;
    books.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();
    const podcasts: HTMLInputElement = root.querySelector('#hide_podcasts') as HTMLInputElement;
    podcasts.checked = false;
    podcasts.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    const select: HTMLSelectElement = root.querySelector('.add-player-select') as HTMLSelectElement;
    select.value = '__none__';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flushAsync();

    expect(changes.length).toBeGreaterThan(0);
    container.remove();
  });

  it('renders the fallback and no-player helpers without media players', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(createHass({}));
    editor.setConfig({ card_id: 'card-1', type: 'custom:abstp-player-card' });

    const result = renderTemplate(editor);

    expect(result.values.length).toBeGreaterThan(0);
  });

  it('renders empty helpers when players remain unconfigured', (): void => {
    const editor: AbstpPlayerCardEditor = createEditor(playersHass);
    editor.setConfig({
      card_id: 'card-1',
      default_speed: 1.5,
      player_entities: ['media_player.abstp_living'],
      skip_seconds: 20,
      type: 'custom:abstp-player-card',
    });
    asPrivate(editor).playerToAdd = 'media_player.abstp_kitchen';

    const result = renderTemplate(editor);

    expect(result.values.length).toBeGreaterThan(0);
  });
});
