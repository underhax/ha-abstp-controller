import { html, type TemplateResult } from 'lit-html';
import {
  audiobookIcon,
  authorIcon,
  chaptersIcon,
  libraryIcon,
  microphoneIcon,
  minusIcon,
  playIcon,
  plusIcon,
  podcastIcon,
  redoIcon,
  soundMuteIcon,
  soundOnIcon,
  stopIcon,
  timerIcon,
  undoIcon,
  waitIcon,
} from '../../icons.ts';
import { localize } from '../../localize.ts';
import type { ChapterItem, InProgressItem, MediaItem, PodcastEpisode } from '../../types.ts';
import {
  MAX_PLAYBACK_SPEED,
  MIN_PLAYBACK_SPEED,
  PLAYBACK_SPEED_STEP,
  SPEED_PRESETS,
} from '../constants.ts';
import { isPodcastItem, resolveHeroCoverAndAuthor } from '../media.ts';
import { calculateTimelineMetrics, formatTime } from '../timeline.ts';

export interface PlaybackControlsContext {
  isBuffering: boolean;
  isPlaying: boolean;
  lang: string;
  skipSec: number;
  onSkip: (seconds: number) => void | Promise<void>;
  onTogglePlayPause: () => void | Promise<void>;
}

export interface SpeedControlsContext {
  currentSpeed: number;
  lang: string;
  showSpeedPopover: boolean;
  onSpeedAdjust: (speed: number) => void;
  onStartSpeedHold: (step: number) => void;
  onStopSpeedHold: () => void;
  onToggleSpeedPopover: () => void;
}

export interface VolumeControlsContext {
  isMuted: boolean;
  lang: string;
  showVolumePopover: boolean;
  volumeLevel: number;
  onToggleMute: () => void | Promise<void>;
  onToggleVolumePopover: () => void;
  onVolumeChange: (volume: number) => void | Promise<void>;
}

export interface ControlsBarContext {
  currentSpeed: number;
  hasNoChapters: boolean;
  isBuffering: boolean;
  isMuted: boolean;
  isPlaying: boolean;
  lang: string;
  showChapters: boolean;
  showLibrary: boolean;
  showSpeedPopover: boolean;
  showVolumePopover: boolean;
  skipSec: number;
  volumeLevel: number;
  onSkip: (seconds: number) => void | Promise<void>;
  onSpeedAdjust: (speed: number) => void;
  onStartSpeedHold: (step: number) => void;
  onStopSpeedHold: () => void;
  onToggleChapters: () => void;
  onToggleLibrary: () => void;
  onToggleMute: () => void | Promise<void>;
  onTogglePlayPause: () => void | Promise<void>;
  onToggleSpeedPopover: () => void;
  onToggleVolumePopover: () => void;
  onVolumeChange: (volume: number) => void | Promise<void>;
}

export interface TimelineContainerContext {
  currentChapter?: ChapterItem | null | undefined;
  currentItem?: MediaItem | PodcastEpisode | InProgressItem | null | undefined;
  currentSpeed: number;
  lang: string;
  playbackDuration: number;
  playbackPosition: number;
  onSeekChange: (position: number) => void | Promise<void>;
  onSeekInput: (position: number) => void;
}

export interface HeroPlayerContext extends ControlsBarContext, TimelineContainerContext {
  devicePicker: TemplateResult;
}

export function renderPlaybackControls(context: PlaybackControlsContext): TemplateResult {
  return html`
    <div class="playback-group">
      <button
        class="ctrl-btn ctrl-btn-rewind skip-btn"
        @click=${(): void => {
          void context.onSkip(-context.skipSec);
        }}
        title="${localize('card.skip_backward', context.lang, { s: context.skipSec })}"
      >
        ${undoIcon}
        <span class="skip-value">${context.skipSec}</span>
      </button>

      <button
        class="ctrl-btn ctrl-btn-play play-main"
        @click=${(): void => {
          void context.onTogglePlayPause();
        }}
        title="${
          context.isBuffering
            ? localize('card.buffering', context.lang)
            : context.isPlaying
              ? localize('card.stop', context.lang)
              : localize('card.play', context.lang)
        }"
      >
        ${
          context.isBuffering
            ? html`<span class="icon-spin">${waitIcon}</span>`
            : context.isPlaying
              ? stopIcon
              : playIcon
        }
      </button>

      <button
        class="ctrl-btn ctrl-btn-forward skip-btn"
        @click=${(): void => {
          void context.onSkip(context.skipSec);
        }}
        title="${localize('card.skip_forward', context.lang, { s: context.skipSec })}"
      >
        ${redoIcon}
        <span class="skip-value">${context.skipSec}</span>
      </button>
    </div>
  `;
}

export function renderSpeedControls(context: SpeedControlsContext): TemplateResult {
  return html`
    <div class="popover-anchor">
      <button
        class="ctrl-btn ctrl-btn-speed speed-pill-btn ${context.showSpeedPopover ? 'active' : ''}"
        @click=${(): void => context.onToggleSpeedPopover()}
        title="${localize('card.speed_settings', context.lang)}"
      >
        ${context.currentSpeed}x
      </button>

      ${
        context.showSpeedPopover
          ? html`
            <div class="speed-popover">
              <div class="speed-popover-presets">
                ${SPEED_PRESETS.map(
                  (spd: number): TemplateResult => html`
                    <button
                      class="speed-preset-btn ${context.currentSpeed === spd ? 'active' : ''}"
                      @click=${(): void => {
                        context.onSpeedAdjust(spd);
                      }}
                    >
                      ${spd}x
                    </button>
                  `,
                )}
              </div>
              <div class="speed-popover-adjust">
                <button
                  class="speed-adjust-btn speed-btn-minus"
                  ?disabled=${context.currentSpeed <= MIN_PLAYBACK_SPEED}
                  @pointerdown=${(e: PointerEvent): void => {
                    e.preventDefault();
                    context.onStartSpeedHold(-PLAYBACK_SPEED_STEP);
                  }}
                  @pointerup=${(): void => context.onStopSpeedHold()}
                  @pointercancel=${(): void => context.onStopSpeedHold()}
                  @pointerleave=${(): void => context.onStopSpeedHold()}
                  title="${localize('card.decrease_speed', context.lang)}"
                >
                  ${minusIcon}
                </button>
                <span class="speed-current-display">${context.currentSpeed}x</span>
                <button
                  class="speed-adjust-btn speed-btn-plus"
                  ?disabled=${context.currentSpeed >= MAX_PLAYBACK_SPEED}
                  @pointerdown=${(e: PointerEvent): void => {
                    e.preventDefault();
                    context.onStartSpeedHold(PLAYBACK_SPEED_STEP);
                  }}
                  @pointerup=${(): void => context.onStopSpeedHold()}
                  @pointercancel=${(): void => context.onStopSpeedHold()}
                  @pointerleave=${(): void => context.onStopSpeedHold()}
                  title="${localize('card.increase_speed', context.lang)}"
                >
                  ${plusIcon}
                </button>
              </div>
            </div>
          `
          : html``
      }
    </div>
  `;
}

export function renderVolumeControls(context: VolumeControlsContext): TemplateResult {
  const isMutedState: boolean = context.isMuted || context.volumeLevel === 0;
  const volumePercent: number = Math.round(context.volumeLevel * 100);

  return html`
    <div class="popover-anchor">
      <button
        class="ctrl-btn ctrl-btn-volume icon-btn ${context.showVolumePopover ? 'active' : ''}"
        @click=${(): void => context.onToggleVolumePopover()}
        title="${localize('card.volume', context.lang)}"
      >
        ${isMutedState ? soundMuteIcon : soundOnIcon}
      </button>

      ${
        context.showVolumePopover
          ? html`
            <div class="volume-popover">
              <span class="volume-percent-label">
                ${volumePercent}%
              </span>
              <div class="volume-vertical-track">
                <input
                  type="range"
                  class="volume-slider-vertical"
                  style="--volume-percent: ${volumePercent}%;"
                  min="0"
                  max="1"
                  step="0.1"
                  .value="${String(context.volumeLevel)}"
                  @input=${(e: Event): void => {
                    const val: number = Number((e.target as HTMLInputElement).value);
                    void context.onVolumeChange(val);
                  }}
                />
              </div>
              <button
                class="ctrl-btn"
                @click=${(): void => {
                  void context.onToggleMute();
                }}
                title="${
                  isMutedState
                    ? localize('card.unmute', context.lang)
                    : localize('card.mute', context.lang)
                }"
              >
                ${isMutedState ? soundMuteIcon : soundOnIcon}
              </button>
            </div>
          `
          : html``
      }
    </div>
  `;
}

export function renderControlsBar(context: ControlsBarContext): TemplateResult {
  return html`
    <div class="controls-bar">
      <div class="controls-left-placeholder"></div>
      ${renderPlaybackControls({
        isBuffering: context.isBuffering,
        isPlaying: context.isPlaying,
        lang: context.lang,
        onSkip: context.onSkip,
        onTogglePlayPause: context.onTogglePlayPause,
        skipSec: context.skipSec,
      })}
      <div class="controls-right-group">
        ${renderSpeedControls({
          currentSpeed: context.currentSpeed,
          lang: context.lang,
          onSpeedAdjust: context.onSpeedAdjust,
          onStartSpeedHold: context.onStartSpeedHold,
          onStopSpeedHold: context.onStopSpeedHold,
          onToggleSpeedPopover: context.onToggleSpeedPopover,
          showSpeedPopover: context.showSpeedPopover,
        })}
        ${renderVolumeControls({
          isMuted: context.isMuted,
          lang: context.lang,
          onToggleMute: context.onToggleMute,
          onToggleVolumePopover: context.onToggleVolumePopover,
          onVolumeChange: context.onVolumeChange,
          showVolumePopover: context.showVolumePopover,
          volumeLevel: context.volumeLevel,
        })}

        <button
          class="ctrl-btn ctrl-btn-chapters icon-btn ${context.showChapters ? 'active' : ''}"
          @click=${(): void => context.onToggleChapters()}
          ?disabled=${context.hasNoChapters}
          title="${context.hasNoChapters ? '' : localize('card.chapters', context.lang)}"
        >
          ${chaptersIcon}
        </button>

        <button
          class="ctrl-btn ctrl-btn-library icon-btn ${context.showLibrary ? 'active' : ''}"
          @click=${(): void => context.onToggleLibrary()}
          title="${localize('card.library_toggle', context.lang)}"
        >
          ${libraryIcon}
        </button>
      </div>
    </div>
  `;
}

export function renderNowPlayingBody(
  item: MediaItem | PodcastEpisode | InProgressItem | null | undefined,
  lang: string,
  playbackDuration: number,
): TemplateResult {
  const isPodcast: boolean = isPodcastItem(item);
  const title: string = item
    ? 'episode_title' in item && item.episode_title
      ? item.episode_title
      : item.title
    : localize('card.no_active_track', lang);
  const { coverId, author, narrator } = resolveHeroCoverAndAuthor(item);

  return html`
    <div class="now-playing-body">
      <div class="player-cover">
        <div class="placeholder">${isPodcast ? podcastIcon : audiobookIcon}</div>
        ${
          coverId
            ? html`
              <img
                src="/api/abstp_controller/cover/${coverId}"
                alt=""
                loading="lazy"
                @error=${(e: Event): void => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
            `
            : html``
        }
      </div>
      <div class="player-meta">
        <div class="player-title" title="${title}">${title}</div>
        ${
          author
            ? html`
              <div class="player-author" title="${author}">
                <span class="meta-icon author-icon" aria-hidden="true">${isPodcast ? microphoneIcon : authorIcon}</span>
                <span>${author}</span>
              </div>
            `
            : html``
        }
        ${
          narrator
            ? html`
              <div class="player-narrator" title="${narrator}">
                <span class="meta-icon narrator-icon" aria-hidden="true">${microphoneIcon}</span>
                <span>${narrator}</span>
              </div>
            `
            : html``
        }
        ${
          playbackDuration > 0
            ? html`
              <div class="player-duration">
                <span class="meta-icon timer-icon" aria-hidden="true">${timerIcon}</span>
                <span>${formatTime(playbackDuration)}</span>
              </div>
            `
            : html``
        }
      </div>
    </div>
  `;
}

export function renderTimelineContainer(context: TimelineContainerContext): TemplateResult {
  const item: MediaItem | PodcastEpisode | InProgressItem | null | undefined = context.currentItem;
  const title: string = item
    ? 'episode_title' in item && item.episode_title
      ? item.episode_title
      : item.title
    : localize('card.no_active_track', context.lang);
  const currentChapter: ChapterItem | null = context.currentChapter ?? null;
  const {
    effectiveDuration,
    effectivePosition,
    progressPercent,
    remainingSeconds,
    speedAdjustedDuration,
    speedAdjustedPosition,
  } = calculateTimelineMetrics(
    context.playbackPosition,
    context.playbackDuration,
    context.currentSpeed,
  );

  return html`
    <div class="timeline-container">
      <input
        type="range"
        class="time-slider"
        style="--slider-progress: ${progressPercent}%;"
        min="0"
        max="${effectiveDuration > 0 ? effectiveDuration : 100}"
        .value="${String(effectivePosition)}"
        @input=${(e: Event): void => {
          const targetPos: number = Number((e.target as HTMLInputElement).value);
          context.onSeekInput(targetPos);
        }}
        @change=${(e: Event): void => {
          const targetPos: number = Number((e.target as HTMLInputElement).value);
          void context.onSeekChange(targetPos);
        }}
      />
      <div class="time-labels">
        <span>
          ${
            speedAdjustedDuration > 0
              ? `${formatTime(speedAdjustedDuration)} / ${formatTime(speedAdjustedPosition)} / ${progressPercent}%`
              : `${formatTime(speedAdjustedPosition)}`
          }
        </span>
        <span>-${formatTime(remainingSeconds)}</span>
      </div>
      <div
        class="chapter-label"
        title="${currentChapter ? currentChapter.title : title}"
      >
        ${
          currentChapter
            ? html`
              <span class="chapter-label-icon" aria-hidden="true">${chaptersIcon}</span>
              <span class="chapter-label-text">${currentChapter.title}</span>
            `
            : html`<span class="chapter-label-text">${title}</span>`
        }
      </div>
    </div>
  `;
}

export function renderHeroPlayer(context: HeroPlayerContext): TemplateResult {
  return html`
    <div class="player-hero">
      ${context.devicePicker}
      ${renderNowPlayingBody(context.currentItem, context.lang, context.playbackDuration)}
      ${renderTimelineContainer(context)}
      ${renderControlsBar(context)}
    </div>
  `;
}
