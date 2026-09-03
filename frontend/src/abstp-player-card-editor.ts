import { customElement, property, state } from 'lit/decorators.js';
import { type CSSResult, css, LitElement } from 'lit-element/lit-element.js';
import { html, type TemplateResult } from 'lit-html';
import { localize } from './localize.ts';
import type { AbstpCardConfig, HomeAssistant } from './types.ts';

@customElement('abstp-player-card-editor')
export class AbstpPlayerCardEditor extends LitElement {
  @property({ attribute: false }) public hass?: HomeAssistant;
  @state() private config?: AbstpCardConfig;

  public setConfig(config: AbstpCardConfig): void {
    this.config = config;
  }

  private fireConfigChanged(newConfig: AbstpCardConfig): void {
    this.config = newConfig;
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        bubbles: true,
        composed: true,
        detail: { config: newConfig },
      }),
    );
  }

  private handleTitleChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    this.fireConfigChanged({
      ...this.config,
      title: target.value,
    });
  }

  private handlePlayerChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLSelectElement = ev.target as HTMLSelectElement;
    this.fireConfigChanged({
      ...this.config,
      player_entity: target.value,
    });
  }

  private handleSpeedChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    const speedVal: number = Number.parseFloat(target.value);
    const clampedSpeed: number = Math.min(
      3.0,
      Math.max(0.5, Number.isNaN(speedVal) ? 1.0 : speedVal),
    );
    this.fireConfigChanged({
      ...this.config,
      default_speed: clampedSpeed,
    });
  }

  private handleSkipSecondsChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    const skipVal: number = Number.parseInt(target.value, 10);
    const clampedSkip: number = Math.min(60, Math.max(5, Number.isNaN(skipVal) ? 10 : skipVal));
    this.fireConfigChanged({
      ...this.config,
      skip_seconds: clampedSkip,
    });
  }

  private handlePlayerToggle(playerId: string, checked: boolean, allPlayers: string[]): void {
    if (!this.config) {
      return;
    }
    const currentList: string[] = this.config.player_entities ?? [...allPlayers];
    let updatedList: string[];
    if (checked) {
      updatedList = currentList.includes(playerId) ? currentList : [...currentList, playerId];
    } else {
      updatedList = currentList.filter((id: string): boolean => id !== playerId);
    }
    this.fireConfigChanged({
      ...this.config,
      player_entities: updatedList,
    });
  }

  private handleHideBooksChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    this.fireConfigChanged({
      ...this.config,
      hide_books: target.checked,
    });
  }

  private handleHidePodcastsChange(ev: Event): void {
    if (!this.config) {
      return;
    }
    const target: HTMLInputElement = ev.target as HTMLInputElement;
    this.fireConfigChanged({
      ...this.config,
      hide_podcasts: target.checked,
    });
  }

  private getMediaPlayers(): string[] {
    if (!this.hass) {
      return [];
    }
    return Object.keys(this.hass.states).filter((id: string): boolean => {
      if (!id.startsWith('media_player.')) {
        return false;
      }
      const lowerId: string = id.toLowerCase();
      if (lowerId.includes('intent') || lowerId.includes('yandex_station_intents')) {
        return false;
      }
      const entity = this.hass?.states[id];
      if (!entity) {
        return false;
      }
      const entityAttrs = entity.attributes as {
        device_class?: string;
        supported_features?: number;
      };
      const devClass: string = (entityAttrs.device_class ?? '').toLowerCase();
      if (devClass === 'intent' || devClass === 'intents') {
        return false;
      }
      const features: number = entityAttrs.supported_features ?? 0;
      return (features & 512) !== 0;
    });
  }

  protected override render(): TemplateResult {
    if (!this.hass || !this.config) {
      return html``;
    }

    const lang: string = this.hass.language;
    const mediaPlayers: string[] = this.getMediaPlayers();
    const allOptions: Array<{ id: string; name: string }> = [
      { id: '', name: localize('card.browser', lang) },
      ...mediaPlayers.map((id: string) => ({
        id,
        name: this.hass?.states[id]?.attributes.friendly_name ?? id,
      })),
    ];
    const allOptionIds: string[] = allOptions.map((opt) => opt.id);

    return html`
      <div class="card-config">
        <div class="form-row">
          <label class="label">${localize('editor.title', lang)}</label>
          <input
            type="text"
            class="input"
            .value=${this.config.title ?? ''}
            @input=${(e: Event): void => this.handleTitleChange(e)}
          />
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.default_player', lang)}</label>
          <select
            class="input"
            .value=${this.config.player_entity ?? ''}
            @change=${(e: Event): void => this.handlePlayerChange(e)}
          >
            <option value="">${localize('card.browser', lang)}</option>
            ${mediaPlayers.map((id: string): TemplateResult => {
              const friendlyName: string = this.hass?.states[id]?.attributes.friendly_name ?? id;
              const shortId: string = id.replace('media_player.', '');
              const displayName: string = friendlyName !== id ? `${friendlyName} (${shortId})` : id;
              return html`
                <option
                  value=${id}
                  ?selected=${this.config?.player_entity === id}
                >
                  ${displayName}
                </option>
              `;
            })}
          </select>
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.default_speed', lang)} (0.5 - 3.0)</label>
          <input
            type="number"
            step="0.05"
            min="0.5"
            max="3.0"
            class="input"
            .value=${String(this.config.default_speed ?? 1.0)}
            @input=${(e: Event): void => this.handleSpeedChange(e)}
          />
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.skip_seconds', lang)} (5 - 60)</label>
          <input
            type="number"
            step="5"
            min="5"
            max="60"
            class="input"
            .value=${String(this.config.skip_seconds ?? 10)}
            @input=${(e: Event): void => this.handleSkipSecondsChange(e)}
          />
        </div>

        <div class="form-row">
          <label class="label">${localize('editor.allowed_players', lang)}</label>
          <div class="player-checkboxes">
            ${allOptions.map((opt): TemplateResult => {
              const isChecked: boolean =
                this.config?.player_entities === undefined ||
                this.config.player_entities.includes(opt.id);
              const inputId: string = opt.id === '' ? 'player_browser' : `player_${opt.id}`;
              const shortId: string = opt.id.replace('media_player.', '');
              return html`
                <div class="checkbox-row device-checkbox-row">
                  <input
                    type="checkbox"
                    id="${inputId}"
                    ?checked=${isChecked}
                    @change=${(e: Event): void => {
                      const chk: boolean = (e.target as HTMLInputElement).checked;
                      this.handlePlayerToggle(opt.id, chk, allOptionIds);
                    }}
                  />
                  <label for="${inputId}" class="device-checkbox-label">
                    <span class="device-primary-name">${opt.name}</span>
                    ${opt.id ? html`<span class="device-entity-id">${shortId}</span>` : html``}
                  </label>
                </div>
              `;
            })}
          </div>
        </div>

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="hide_books"
            ?checked=${Boolean(this.config.hide_books)}
            @change=${(e: Event): void => this.handleHideBooksChange(e)}
          />
          <label for="hide_books">${localize('editor.hide_books', lang)}</label>
        </div>

        <div class="checkbox-row">
          <input
            type="checkbox"
            id="hide_podcasts"
            ?checked=${Boolean(this.config.hide_podcasts)}
            @change=${(e: Event): void => this.handleHidePodcastsChange(e)}
          />
          <label for="hide_podcasts"
            >${localize('editor.hide_podcasts', lang)}</label
          >
        </div>
      </div>
    `;
  }

  public static override styles: CSSResult = css`
    .card-config {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 0;
    }

    .form-row {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .label {
      font-size: 0.9rem;
      font-weight: 500;
      color: var(--primary-text-color);
    }

    .input {
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, #ccc);
      background: var(--card-background-color, #fff);
      color: var(--primary-text-color);
      font-size: 0.9rem;
    }

    .player-checkboxes {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 160px;
      overflow-y: auto;
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid var(--divider-color, rgba(255, 255, 255, 0.1));
      background: var(--secondary-background-color, rgba(0, 0, 0, 0.1));
    }

    .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      color: var(--primary-text-color);
    }

    .device-checkbox-row {
      align-items: flex-start;
      padding: 2px 0;
    }

    .device-checkbox-label {
      display: flex;
      flex-direction: column;
      cursor: pointer;
      line-height: 1.25;
    }

    .device-primary-name {
      font-size: 0.9rem;
    }

    .device-entity-id {
      font-size: 0.75rem;
      color: var(--secondary-text-color, rgba(255, 255, 255, 0.5));
    }
  `;
}
