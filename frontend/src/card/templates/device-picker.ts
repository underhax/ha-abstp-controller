import { html, type TemplateResult } from 'lit-html';
import { browserIcon, chevronDownIcon, speakerIcon } from '../../icons.ts';
import { localize } from '../../localize.ts';
import type { AbstpCardConfig, HassEntity, HomeAssistant } from '../../types.ts';

export interface DevicePickerContext {
  allowedPlayers: string[];
  config?: AbstpCardConfig | undefined;
  hass?: HomeAssistant | undefined;
  lang: string;
  selectedPlayer: string;
  showDeviceMenu: boolean;
  onSelectPlayer: (id: string) => void | Promise<void>;
  onToggleDeviceMenu: () => void;
}

export function renderPlayerIcon(
  entity: HassEntity | undefined,
  entityId?: string,
): TemplateResult {
  if (!entity && !entityId) {
    return browserIcon;
  }
  const id: string = (entityId ?? entity?.entity_id ?? '').toLowerCase();
  const entityAttrs = entity?.attributes as
    | { icon?: string; device_class?: string; app_name?: string }
    | undefined;
  const iconAttr: string | undefined = entityAttrs?.icon;
  if (iconAttr) {
    return html`<ha-icon class="icon icon-device" .icon=${iconAttr}></ha-icon>`;
  }

  if (id.includes('chromecast') || id.includes('_cast') || entityAttrs?.app_name === 'Cast') {
    return html`<ha-icon class="icon icon-device" icon="mdi:cast"></ha-icon>`;
  }

  if (id.includes('yandex') || id.includes('station') || id.includes('alice')) {
    return speakerIcon;
  }

  const deviceClass: string | undefined = entityAttrs?.device_class;
  if (deviceClass === 'tv') {
    return html`<ha-icon class="icon icon-device" icon="mdi:television"></ha-icon>`;
  }
  if (deviceClass === 'speaker') {
    return html`<ha-icon class="icon icon-device" icon="mdi:speaker"></ha-icon>`;
  }
  if (deviceClass === 'receiver') {
    return html`<ha-icon class="icon icon-device" icon="mdi:audio-video"></ha-icon>`;
  }
  return speakerIcon;
}

export function resolveDeviceSubtitle(
  id: string,
  entity: HassEntity | undefined,
  lang: string,
): string {
  if (
    entity &&
    (entity.state === 'unavailable' ||
      entity.state === 'unknown' ||
      entity.attributes.target_available === false)
  ) {
    return localize('card.unavailable', lang);
  }
  if (id === '') {
    return 'HTML5 Audio';
  }
  const targetPlayer: string | undefined = entity?.attributes.target_player as string | undefined;
  const targetId: string = targetPlayer ?? id;
  const lowerId: string = targetId.toLowerCase();
  if (lowerId.includes('chromecast') || lowerId.includes('_cast')) {
    return 'Chromecast';
  }

  if (lowerId.includes('yandex') || lowerId.includes('station')) {
    return 'Yandex Station';
  }
  return targetId.replace('media_player.', '');
}

export function renderSpeakerMenuItem(
  id: string,
  lang: string,
  hass: HomeAssistant | undefined,
  selectedPlayer: string,
  onSelectPlayer: (id: string) => void | Promise<void>,
): TemplateResult {
  const isBrowser: boolean = id === '';
  const entity: HassEntity | undefined = isBrowser ? undefined : hass?.states[id];
  const friendlyName: string = isBrowser
    ? localize('card.browser', lang)
    : (entity?.attributes.friendly_name ?? id);
  const isUnavailable: boolean =
    !isBrowser &&
    Boolean(
      entity &&
        (entity.state === 'unavailable' ||
          entity.state === 'unknown' ||
          entity.attributes.target_available === false),
    );
  const isSelected: boolean = selectedPlayer === id;
  const subtitle: string = resolveDeviceSubtitle(id, entity, lang);

  return html`
    <div
      class="device-menu-item ${isSelected ? 'active' : ''} ${isUnavailable ? 'disabled' : ''}"
      @click=${(): void => {
        if (!isUnavailable) {
          void onSelectPlayer(id);
        }
      }}
    >
      ${isBrowser ? browserIcon : renderPlayerIcon(entity, id)}
      <div class="device-item-info">
        <span class="device-item-name">${friendlyName}</span>
        ${subtitle ? html`<span class="device-item-area">${subtitle}</span>` : html``}
      </div>
    </div>
  `;
}

export function renderDeviceMenuPopover(
  lang: string,
  allowedSpeakers: string[],
  hass: HomeAssistant | undefined,
  selectedPlayer: string,
  onSelectPlayer: (id: string) => void | Promise<void>,
): TemplateResult {
  return html`
    <div class="device-menu-popover">
      ${allowedSpeakers.map(
        (id: string): TemplateResult =>
          renderSpeakerMenuItem(id, lang, hass, selectedPlayer, onSelectPlayer),
      )}
    </div>
  `;
}

export function renderDevicePicker(context: DevicePickerContext): TemplateResult {
  const allowedSpeakers: string[] = context.allowedPlayers;
  if (allowedSpeakers.length === 0) {
    return html``;
  }
  const isSingleConfigured: boolean = allowedSpeakers.length <= 1;
  const isBrowser: boolean = context.selectedPlayer === '';
  const currentEntity: HassEntity | undefined = isBrowser
    ? undefined
    : context.hass?.states[context.selectedPlayer];
  const currentName: string = isBrowser
    ? localize('card.browser', context.lang)
    : (currentEntity?.attributes.friendly_name ?? context.selectedPlayer);

  if (isSingleConfigured) {
    return html`
      <div class="device-picker-row">
        <div class="device-badge device-badge-btn" title="${currentName}">
          ${isBrowser ? browserIcon : renderPlayerIcon(currentEntity, context.selectedPlayer)}
          <span class="device-name">${currentName}</span>
        </div>
      </div>
    `;
  }

  return html`
    <div class="device-picker-row">
      <div
        class="device-badge device-badge-btn clickable"
        @click=${(): void => context.onToggleDeviceMenu()}
        title="${localize('card.target_device', context.lang)}"
      >
        ${isBrowser ? browserIcon : renderPlayerIcon(currentEntity, context.selectedPlayer)}
        <span class="device-name">${currentName}</span>
        ${chevronDownIcon}
      </div>

      ${
        context.showDeviceMenu
          ? renderDeviceMenuPopover(
              context.lang,
              allowedSpeakers,
              context.hass,
              context.selectedPlayer,
              context.onSelectPlayer,
            )
          : html``
      }
    </div>
  `;
}

export function filterAvailablePlayers(
  hass: HomeAssistant | undefined,
  config?: AbstpCardConfig,
  playerOrder: string[] = [],
): string[] {
  const states = hass?.states ?? {};
  const allPlayers: string[] = Object.keys(states).filter((id: string): boolean =>
    id.startsWith('media_player.abstp_'),
  );
  if (config?.player_entities && config.player_entities.length > 0) {
    const allowed: string[] = config.player_entities.filter(
      (id: string): boolean => id === '' || id.startsWith('media_player.abstp_'),
    );
    return [...new Set(allowed)];
  }

  if (playerOrder.length > 0) {
    const playerSet: Set<string> = new Set(playerOrder);
    const extraPlayers: string[] = allPlayers.filter((id: string): boolean => !playerSet.has(id));
    return [...playerOrder, ...extraPlayers];
  }

  return ['', ...allPlayers];
}
