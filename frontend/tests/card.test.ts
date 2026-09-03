import { describe, expect, it } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import { AbstpPlayerCardEditor } from '../src/abstp-player-card-editor.ts';

describe('AbstpPlayerCard', (): void => {
  it('creates stub configuration with default values', (): void => {
    const stub = AbstpPlayerCard.getStubConfig();
    expect(stub.type).toBe('custom:abstp-player-card');
    expect(stub.default_speed).toBe(1.0);
    expect(stub.skip_seconds).toBe(10);
  });

  it('instantiates the card element and updates config properties', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig({
      default_speed: 1.5,
      player_entity: 'media_player.living_room_speaker',
      skip_seconds: 15,
      title: 'Custom Title',
      type: 'custom:abstp-player-card',
    });
    expect(card).toBeDefined();
  });

  it('provides the custom card editor element', async (): Promise<void> => {
    const editor: HTMLElement = await AbstpPlayerCard.getConfigElement();
    expect(editor.tagName.toLowerCase()).toBe('abstp-player-card-editor');
  });

  it('closes open popovers on Escape keydown', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.connectedCallback();
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;
    (card as unknown as { showVolumePopover: boolean }).showVolumePopover = true;
    (card as unknown as { showDeviceMenu: boolean }).showDeviceMenu = true;

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect((card as unknown as { showSpeedPopover: boolean }).showSpeedPopover).toBe(false);
    expect((card as unknown as { showVolumePopover: boolean }).showVolumePopover).toBe(false);
    expect((card as unknown as { showDeviceMenu: boolean }).showDeviceMenu).toBe(false);
    card.disconnectedCallback();
  });

  it('closes open popovers when clicking outside the card element', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.connectedCallback();
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;

    const outsideTarget: HTMLDivElement = document.createElement('div');
    document.body.appendChild(outsideTarget);
    outsideTarget.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));

    expect((card as unknown as { showSpeedPopover: boolean }).showSpeedPopover).toBe(false);
    card.disconnectedCallback();
    document.body.removeChild(outsideTarget);
  });

  it('applies changed speed and triggers buffering on popover close', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { currentSpeed: number }).currentSpeed = 1.0;
    (card as unknown as { speedOnOpen: number }).speedOnOpen = 1.0;
    (card as unknown as { showSpeedPopover: boolean }).showSpeedPopover = true;
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'test_book' };

    (card as unknown as { handleSpeedAdjust: (spd: number) => void }).handleSpeedAdjust(1.5);
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(false);

    await (card as unknown as { closeSpeedPopover: () => Promise<void> }).closeSpeedPopover();
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(true);
  });

  it('scopes selected player and storage keys per card configuration', (): void => {
    const card1: AbstpPlayerCard = new AbstpPlayerCard();
    card1.setConfig({
      player_entities: ['media_player.bedroom_mini'],
      title: 'Bedroom Card',
      type: 'custom:abstp-player-card',
    });
    expect((card1 as unknown as { selectedPlayer: string }).selectedPlayer).toBe(
      'media_player.bedroom_mini',
    );

    const card2: AbstpPlayerCard = new AbstpPlayerCard();
    card2.setConfig({
      player_entities: ['media_player.kitchen_mini'],
      title: 'Kitchen Card',
      type: 'custom:abstp-player-card',
    });
    expect((card2 as unknown as { selectedPlayer: string }).selectedPlayer).toBe(
      'media_player.kitchen_mini',
    );
  });

  it('handles browser audio progress calculation and ignores non-finite duration', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { selectedPlayer: string }).selectedPlayer = '';
    (card as unknown as { browserStreamStartPos: number }).browserStreamStartPos = 120;
    (card as unknown as { currentSpeed: number }).currentSpeed = 1.5;
    (card as unknown as { playbackDuration: number }).playbackDuration = 3600;

    (
      card as unknown as { handleBrowserTimeUpdate: (pos: number, dur: number) => void }
    ).handleBrowserTimeUpdate(10, Number.POSITIVE_INFINITY);

    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(135);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(3600);
  });

  it('selects an item without automatically starting playback', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (
      card as unknown as {
        handleSelectItem: (item: { id: string; progress: number; duration: number }) => void;
      }
    ).handleSelectItem({
      duration: 7200,
      id: 'selected_book_1',
      progress: 300,
    });

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { isBuffering: boolean }).isBuffering).toBe(false);
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(300);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(7200);
  });

  it('stops current playback when selecting a new item', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { isPlaying: boolean }).isPlaying = true;
    (card as unknown as { currentItem: { id: string } }).currentItem = { id: 'old_book' };

    await (
      card as unknown as {
        handleSelectItem: (item: {
          duration: number;
          id: string;
          progress: number;
        }) => Promise<void>;
      }
    ).handleSelectItem({
      duration: 3600,
      id: 'new_book',
      progress: 0,
    });

    expect((card as unknown as { isPlaying: boolean }).isPlaying).toBe(false);
    expect((card as unknown as { currentItem: { id: string } }).currentItem.id).toBe('new_book');
  });
});

describe('AbstpPlayerCardEditor', (): void => {
  it('sets config correctly without errors', (): void => {
    const editor: AbstpPlayerCardEditor = new AbstpPlayerCardEditor();
    editor.setConfig({
      default_speed: 1.25,
      player_entities: ['media_player.living_room_speaker'],
      title: 'Test Editor',
      type: 'custom:abstp-player-card',
    });
    expect(editor).toBeDefined();
  });
});
