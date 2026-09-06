import { describe, expect, it, vi } from 'vitest';
import { AbstpPlayerCard } from '../src/abstp-player-card.ts';
import { AbstpPlayerCardEditor } from '../src/abstp-player-card-editor.ts';
import type { AbstpCardConfig, HomeAssistant } from '../src/types.ts';

describe('AbstpPlayerCard', (): void => {
  it('creates stub configuration with default values', (): void => {
    const stub = AbstpPlayerCard.getStubConfig() as unknown as AbstpCardConfig;
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
    expect(card.getCardSize()).toBe(5);
  });

  it('provides the custom card editor element', async (): Promise<void> => {
    const editor: HTMLElement = await AbstpPlayerCard.getConfigElement();
    expect(editor.tagName.toLowerCase()).toBe('abstp-player-card-editor');
  });

  it('scrolls chapters list to previous chapter before active chapter', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockList: HTMLDivElement = document.createElement('div');
    mockList.className = 'chapters-list';
    mockList.scrollTop = 0;

    const mockFirst: HTMLDivElement = document.createElement('div');
    mockFirst.className = 'chapter-item';
    Object.defineProperty(mockFirst, 'offsetTop', { value: 0 });
    Object.defineProperty(mockFirst, 'offsetParent', { value: mockList });

    const mockPrev: HTMLDivElement = document.createElement('div');
    mockPrev.className = 'chapter-item';
    Object.defineProperty(mockPrev, 'offsetTop', { value: 150 });
    Object.defineProperty(mockPrev, 'offsetParent', { value: mockList });

    const mockItem: HTMLDivElement = document.createElement('div');
    mockItem.className = 'chapter-item active';
    Object.defineProperty(mockItem, 'offsetTop', { value: 200 });
    Object.defineProperty(mockItem, 'offsetParent', { value: mockList });

    mockList.appendChild(mockFirst);
    mockList.appendChild(mockPrev);
    mockList.appendChild(mockItem);
    document.body.appendChild(mockList);

    Object.defineProperty(card, 'renderRoot', {
      value: {
        querySelector: (sel: string): HTMLElement | null => {
          if (sel === '.chapters-list') {
            return mockList;
          }
          if (sel === '.chapter-item.active') {
            return mockItem;
          }
          return null;
        },
      },
    });

    card.scrollToActiveChapter();
    expect(mockList.scrollTop).toBe(150);

    document.body.removeChild(mockList);
  });

  it('scrolls chapters list to top when active chapter is first', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const mockList: HTMLDivElement = document.createElement('div');
    mockList.className = 'chapters-list';
    mockList.scrollTop = 100;

    const mockItem: HTMLDivElement = document.createElement('div');
    mockItem.className = 'chapter-item active';
    Object.defineProperty(mockItem, 'offsetTop', { value: 0 });
    Object.defineProperty(mockItem, 'offsetParent', { value: mockList });

    mockList.appendChild(mockItem);
    document.body.appendChild(mockList);

    Object.defineProperty(card, 'renderRoot', {
      value: {
        querySelector: (sel: string): HTMLElement | null => {
          if (sel === '.chapters-list') {
            return mockList;
          }
          if (sel === '.chapter-item.active') {
            return mockItem;
          }
          return null;
        },
      },
    });

    card.scrollToActiveChapter();
    expect(mockList.scrollTop).toBe(0);

    document.body.removeChild(mockList);
  });

  it('renders hero player and card brand icon', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig({ type: 'custom:abstp-player-card' });

    const rendered = (card as unknown as { render: () => { strings: readonly string[] } }).render();
    expect(rendered).toBeDefined();
  });

  it('renders library section when showLibrary is true', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig({ type: 'custom:abstp-player-card' });
    card.ui.showLibrary = true;

    const rendered = (card as unknown as { render: () => { strings: readonly string[] } }).render();
    expect(rendered).toBeDefined();
  });

  it('renders chapters section when showChapters is true', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    card.setConfig({ type: 'custom:abstp-player-card' });
    card.ui.showChapters = true;

    const rendered = (card as unknown as { render: () => { strings: readonly string[] } }).render();
    expect(rendered).toBeDefined();
  });

  it('triggers library fetch on hass update when library is not loaded', (): void => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    const fetchSpy = vi.spyOn(card.library, 'fetchLibrary').mockResolvedValue(undefined);

    const mockHass = {
      callWS: vi.fn(),
      language: 'en',
      states: {},
    } as unknown as HomeAssistant;

    card.hass = mockHass;
    const changedProps = new Map<string, unknown>();
    changedProps.set('hass', undefined);

    (
      card as unknown as {
        updated: (changed: Map<string, unknown>) => void;
      }
    ).updated(changedProps);

    expect(fetchSpy).toHaveBeenCalled();
  });

  it('triggers scrollToActiveChapter when chapters are opened in ui', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    Object.defineProperty(card, 'updateComplete', {
      value: Promise.resolve(true),
      writable: true,
    });
    const scrollSpy = vi.spyOn(card, 'scrollToActiveChapter').mockImplementation((): void => {});
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback): number => {
        cb(0);
        return 0;
      });
    card.ui.showChapters = true;

    (
      card as unknown as {
        updated: (changed: Map<string, unknown>) => void;
      }
    ).updated(new Map());

    await Promise.resolve();
    expect(scrollSpy).toHaveBeenCalled();
    rafSpy.mockRestore();
  });

  it('does not trigger scrollToActiveChapter when chapters are already open and chapter changes', async (): Promise<void> => {
    const card: AbstpPlayerCard = new AbstpPlayerCard();
    Object.defineProperty(card, 'updateComplete', {
      value: Promise.resolve(true),
      writable: true,
    });
    card.ui.showChapters = true;
    card.library.chapters = [
      { duration: 100, end: 100, id: 1, start: 0, title: 'Chapter 1' },
      { duration: 100, end: 200, id: 2, start: 100, title: 'Chapter 2' },
    ];
    (
      card as unknown as {
        updated: (changed: Map<string, unknown>) => void;
      }
    ).updated(new Map());

    const scrollSpy = vi.spyOn(card, 'scrollToActiveChapter').mockImplementation((): void => {});
    card.playback.playbackPosition = 150;

    (
      card as unknown as {
        updated: (changed: Map<string, unknown>) => void;
      }
    ).updated(new Map());

    await Promise.resolve();
    expect(scrollSpy).not.toHaveBeenCalled();
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
