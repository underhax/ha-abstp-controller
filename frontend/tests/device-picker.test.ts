import { render, type TemplateResult } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import {
  type DevicePickerContext,
  filterAvailablePlayers,
  renderDevicePicker,
  renderPlayerIcon,
  renderSpeakerMenuItem,
  resolveDeviceSubtitle,
} from '../src/card/templates/device-picker.ts';
import type { HassEntity, HomeAssistant } from '../src/types.ts';

describe('renderPlayerIcon()', (): void => {
  it('renders speaker icon when entity and entityId are absent', (): void => {
    const result: TemplateResult = renderPlayerIcon(undefined, undefined);
    expect(result).toBeDefined();
  });

  it('falls back to empty id when entity lacks entity_id', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'speaker' },
      state: 'idle',
    } as unknown as HassEntity;
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:speaker');
  });

  it('renders custom icon when icon attribute is provided', (): void => {
    const entity: HassEntity = {
      attributes: { icon: 'mdi:custom-speaker' },
      entity_id: 'media_player.custom',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('icon-device');
  });

  it('renders cast icon for chromecast devices', (): void => {
    const entity: HassEntity = {
      attributes: { friendly_name: 'Living Room Cast' },
      entity_id: 'media_player.living_room_chromecast',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:cast');
  });

  it('renders speaker icon for yandex station devices', (): void => {
    const entity: HassEntity = {
      attributes: { friendly_name: 'Alice Station' },
      entity_id: 'media_player.yandex_station_123',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result).toBeDefined();
  });

  it('renders device class tv icon when device_class is tv', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'tv' },
      entity_id: 'media_player.samsung_tv',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:television');
  });

  it('renders device class speaker icon when device_class is speaker', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'speaker' },
      entity_id: 'media_player.kitchen_audio',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:speaker');
  });

  it('renders receiver icon when device_class is receiver', (): void => {
    const entity: HassEntity = {
      attributes: { device_class: 'receiver' },
      entity_id: 'media_player.denon_avr',
      state: 'idle',
    };
    const result: TemplateResult = renderPlayerIcon(entity);
    expect(result.strings.join('')).toContain('mdi:audio-video');
  });
});

describe('resolveDeviceSubtitle()', (): void => {
  it('returns unavailable string when entity state is unavailable', (): void => {
    const entity: HassEntity = {
      attributes: {},
      entity_id: 'media_player.speaker',
      state: 'unavailable',
    };
    expect(resolveDeviceSubtitle('media_player.speaker', entity, 'en')).toBe('Unavailable');
  });

  it('returns Chromecast subtitle for cast identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.chromecast_ultra', undefined, 'en')).toBe(
      'Chromecast',
    );
  });

  it('returns Yandex Station subtitle for yandex identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.yandex_station_hall', undefined, 'en')).toBe(
      'Yandex Station',
    );
  });

  it('strips domain prefix for standard media player identifiers', (): void => {
    expect(resolveDeviceSubtitle('media_player.kitchen_sound', undefined, 'en')).toBe(
      'kitchen_sound',
    );
  });
});

describe('renderSpeakerMenuItem()', (): void => {
  const mockUnavailableHass: HomeAssistant = {
    states: {
      'media_player.broken': {
        attributes: { friendly_name: 'Broken Speaker' },
        entity_id: 'media_player.broken',
        state: 'unavailable',
      },
    },
  } as unknown as HomeAssistant;

  it('applies disabled state and ignores clicks for unavailable speaker', (): void => {
    const onSelect = vi.fn();
    const result: TemplateResult = renderSpeakerMenuItem(
      'media_player.broken',
      'en',
      mockUnavailableHass,
      'media_player.other',
      onSelect,
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    const item: HTMLElement | null = container.querySelector('.device-menu-item');
    expect(item?.classList.contains('disabled')).toBe(true);
    expect(item?.classList.contains('active')).toBe(false);
    item?.click();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('omits area label when subtitle resolves to empty string', (): void => {
    const mockEdgeHass: HomeAssistant = {
      states: {
        'media_player.': {
          attributes: {},
          entity_id: 'media_player.',
          state: 'idle',
        },
      },
    } as unknown as HomeAssistant;

    const result: TemplateResult = renderSpeakerMenuItem(
      'media_player.',
      'en',
      mockEdgeHass,
      'media_player.other',
      vi.fn(),
    );
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.device-item-area')).toBeNull();
    expect(container.querySelector('.device-item-name')?.textContent).toBe('media_player.');
  });
});

describe('filterAvailablePlayers()', (): void => {
  it('preserves integration order when the card player list is empty', (): void => {
    const mockHass = {
      states: Object.fromEntries([
        [
          'media_player.abstp_z',
          { attributes: {}, entity_id: 'media_player.abstp_z', state: 'idle' },
        ],
        [
          'media_player.abstp_a',
          { attributes: {}, entity_id: 'media_player.abstp_a', state: 'idle' },
        ],
      ]),
    } as unknown as HomeAssistant;

    expect(
      filterAvailablePlayers(mockHass, { player_entities: [], type: 'custom:abstp-player-card' }),
    ).toEqual(['media_player.abstp_z', 'media_player.abstp_a']);
  });

  it('preserves explicit card player order', (): void => {
    const mockHass = {
      states: Object.fromEntries([
        [
          'media_player.abstp_z',
          { attributes: {}, entity_id: 'media_player.abstp_z', state: 'idle' },
        ],
        [
          'media_player.abstp_a',
          { attributes: {}, entity_id: 'media_player.abstp_a', state: 'idle' },
        ],
      ]),
    } as unknown as HomeAssistant;

    expect(
      filterAvailablePlayers(mockHass, {
        player_entities: ['media_player.abstp_a', 'media_player.abstp_z'],
        type: 'custom:abstp-player-card',
      }),
    ).toEqual(['media_player.abstp_a', 'media_player.abstp_z']);
  });

  it('respects playerOrder when browser is excluded from integration', (): void => {
    const mockHass = {
      states: Object.fromEntries([
        [
          'media_player.abstp_z',
          { attributes: {}, entity_id: 'media_player.abstp_z', state: 'idle' },
        ],
        [
          'media_player.abstp_a',
          { attributes: {}, entity_id: 'media_player.abstp_a', state: 'idle' },
        ],
      ]),
    } as unknown as HomeAssistant;

    expect(
      filterAvailablePlayers(mockHass, undefined, ['media_player.abstp_a', 'media_player.abstp_z']),
    ).toEqual(['media_player.abstp_a', 'media_player.abstp_z']);
  });
});

describe('renderDevicePicker()', (): void => {
  it('renders single badge when only one device option exists', (): void => {
    const context: DevicePickerContext = {
      allowedPlayers: ['media_player.hall'],
      config: { player_entities: ['media_player.hall'], type: 'custom:abstp-player-card' },
      lang: 'en',
      onSelectPlayer: vi.fn(),
      onToggleDeviceMenu: vi.fn(),
      selectedPlayer: 'media_player.hall',
      showDeviceMenu: false,
    };
    const container: HTMLDivElement = document.createElement('div');
    render(renderDevicePicker(context), container);
    expect(container.querySelector('.device-picker-row')).not.toBeNull();
    expect(container.querySelector('.clickable')).toBeNull();
  });

  it('renders clickable badge and menu popover when multiple options exist and menu is open', (): void => {
    const mockHass = {
      states: {
        'media_player.hall': {
          attributes: { friendly_name: 'Hall Speaker' },
          entity_id: 'media_player.hall',
          state: 'idle',
        },
      },
    } as unknown as HomeAssistant;

    const toggleFn = vi.fn();
    const selectFn = vi.fn();

    const context: DevicePickerContext = {
      allowedPlayers: ['media_player.kitchen', 'media_player.hall'],
      config: {
        player_entities: ['media_player.kitchen', 'media_player.hall'],
        type: 'custom:abstp-player-card',
      },
      hass: mockHass,
      lang: 'en',
      onSelectPlayer: selectFn,
      onToggleDeviceMenu: toggleFn,
      selectedPlayer: 'media_player.kitchen',
      showDeviceMenu: true,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderDevicePicker(context), container);
    const badge: HTMLElement | null = container.querySelector('.clickable');
    expect(badge).not.toBeNull();
    badge?.click();
    expect(toggleFn).toHaveBeenCalled();

    const popover: HTMLElement | null = container.querySelector('.device-menu-popover');
    expect(popover).not.toBeNull();

    const items: NodeListOf<HTMLElement> = container.querySelectorAll('.device-menu-item');
    expect(items.length).toBe(2);
    items[1]?.click();
    expect(selectFn).toHaveBeenCalledWith('media_player.hall');
  });

  it('renders clickable badge without popover when menu is closed', (): void => {
    const context: DevicePickerContext = {
      allowedPlayers: ['media_player.kitchen', 'media_player.hall'],
      config: {
        player_entities: ['media_player.kitchen', 'media_player.hall'],
        type: 'custom:abstp-player-card',
      },
      lang: 'en',
      onSelectPlayer: vi.fn(),
      onToggleDeviceMenu: vi.fn(),
      selectedPlayer: 'media_player.kitchen',
      showDeviceMenu: false,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderDevicePicker(context), container);

    expect(container.querySelector('.clickable')).not.toBeNull();
    expect(container.querySelector('.device-menu-popover')).toBeNull();
  });
});
