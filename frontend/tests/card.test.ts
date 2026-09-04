import { describe, expect, it } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import { AbstpPlayerCardEditor } from '../src/abstp-player-card-editor.ts';
import type { InProgressItem } from '../src/types.ts';

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

  it('initializes with activeTab set to in_progress', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    expect((card as unknown as { activeTab: string }).activeTab).toBe('in_progress');
  });

  it('switches to in_progress tab and marks tab as user selected', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { activeTab: string }).activeTab = 'books';
    (card as unknown as { selectedPodcastId: string | null }).selectedPodcastId = 'pod_1';
    (card as unknown as { handleTabInProgress: () => void }).handleTabInProgress();

    expect((card as unknown as { activeTab: string }).activeTab).toBe('in_progress');
    expect((card as unknown as { selectedPodcastId: string | null }).selectedPodcastId).toBeNull();
    expect((card as unknown as { userSelectedTab: boolean }).userSelectedTab).toBe(true);
  });

  it('filters in_progress items by title, author, or episode title', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { inProgress: InProgressItem[] }).inProgress = [
      {
        author: 'Author One',
        cover_url: 'https://example.com/cover1.jpg',
        current_time: 120,
        duration: 3600,
        id: 'item_1',
        media_type: 'book',
        progress: 120,
        title: 'Book One',
      },
      {
        author: 'Author Two',
        cover_url: 'https://example.com/cover2.jpg',
        current_time: 300,
        duration: 1800,
        episode_id: 'ep_1',
        episode_title: 'Special Episode',
        id: 'item_2',
        media_type: 'podcast',
        progress: 300,
        title: 'Podcast Two',
      },
    ];

    (card as unknown as { searchQuery: string }).searchQuery = 'special';
    let filtered: InProgressItem[] = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('item_2');

    (card as unknown as { searchQuery: string }).searchQuery = 'author one';
    filtered = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.id).toBe('item_1');

    (card as unknown as { searchQuery: string }).searchQuery = 'nonexistent';
    filtered = (
      card as unknown as { getFilteredInProgress: () => InProgressItem[] }
    ).getFilteredInProgress();
    expect(filtered).toHaveLength(0);
  });

  it('selects an in_progress item and sets playback position from progress', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const inProgressItem: InProgressItem = {
      author: 'Test Author',
      cover_url: 'https://example.com/cover.jpg',
      current_time: 450,
      duration: 3600,
      id: 'in_progress_book',
      media_type: 'book',
      progress: 450,
      title: 'In Progress Book',
    };

    await (
      card as unknown as {
        handleSelectItem: (item: InProgressItem) => Promise<void>;
      }
    ).handleSelectItem(inProgressItem);

    expect((card as unknown as { currentItem: InProgressItem | null }).currentItem?.id).toBe(
      'in_progress_book',
    );
    expect((card as unknown as { playbackPosition: number }).playbackPosition).toBe(450);
    expect((card as unknown as { playbackDuration: number }).playbackDuration).toBe(3600);
  });

  it('resolves item IDs correctly for podcast episodes and in_progress podcast items', (): void => {
    const resolveIds = (
      AbstpPlayerCard as unknown as {
        resolveItemIds: (item: unknown) => { episodeId?: string; itemId: string };
      }
    ).resolveItemIds;

    const bookItem = { id: 'book_123' };
    expect(resolveIds(bookItem)).toEqual({ itemId: 'book_123' });

    const podcastEpisode = { id: 'ep_456', podcast_id: 'pod_789' };
    expect(resolveIds(podcastEpisode)).toEqual({ episodeId: 'ep_456', itemId: 'pod_789' });

    const inProgressPodcast = { episode_id: 'ep_456', id: 'pod_789' };
    expect(resolveIds(inProgressPodcast)).toEqual({ episodeId: 'ep_456', itemId: 'pod_789' });
  });

  it('resolves initial position from current_time for in_progress items', (): void => {
    const resolvePos = (
      AbstpPlayerCard as unknown as {
        resolveInitialPosition: (item: unknown, startTime?: number) => number;
      }
    ).resolveInitialPosition;

    const inProgressItem: InProgressItem = {
      author: 'Author',
      cover_url: 'https://example.com/cover.jpg',
      current_time: 500,
      duration: 3600,
      id: 'in_prog_1',
      media_type: 'book',
      progress: 500,
      title: 'Book',
    };

    expect(resolvePos(inProgressItem)).toBe(500);
    expect(resolvePos(inProgressItem, 120)).toBe(120);
  });

  it('filters finished and in-progress books based on is_finished', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    (card as unknown as { books: unknown[] }).books = [
      {
        author: 'A1',
        duration: 1000,
        id: 'b1',
        is_finished: false,
        progress: 200,
        title: 'Active Book',
      },
      {
        author: 'A2',
        duration: 1000,
        id: 'b2',
        is_finished: true,
        progress: 1000,
        title: 'Finished Book',
      },
    ];

    (card as unknown as { filterProgress: string }).filterProgress = 'finished';
    let filtered: unknown[] = (
      card as unknown as { getFilteredBooks: () => unknown[] }
    ).getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as { id: string }).id).toBe('b2');

    (card as unknown as { filterProgress: string }).filterProgress = 'in_progress';
    filtered = (card as unknown as { getFilteredBooks: () => unknown[] }).getFilteredBooks();
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as { id: string }).id).toBe('b1');
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
