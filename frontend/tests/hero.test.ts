import { html, render } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import {
  type ControlsBarContext,
  type HeroPlayerContext,
  type PlaybackControlsContext,
  renderControlsBar,
  renderHeroPlayer,
  renderNowPlayingBody,
  renderPlaybackControls,
  renderSpeedControls,
  renderTimelineContainer,
  renderVolumeControls,
  type SpeedControlsContext,
  type TimelineContainerContext,
  type VolumeControlsContext,
} from '../src/card/templates/hero.ts';
import type { ChapterItem, MediaItem, PodcastEpisode } from '../src/types.ts';

const mockChapter: ChapterItem = {
  duration: 600,
  end: 600,
  id: 1,
  start: 0,
  title: 'Chapter 1: The Beginning',
};

const mockBook: MediaItem = {
  author: 'Author Name',
  cover_url: '',
  duration: 3600,
  id: 'book-1',
  media_type: 'book',
  narrator: 'Narrator Name',
  progress: 1800,
  title: 'Epic Adventure',
};

const mockPodcast: PodcastEpisode = {
  duration: 2400,
  episode_title: 'Episode 42: Deep Thought',
  id: 'ep-1',
  media_type: 'podcast',
  podcast_id: 'pod-1',
  progress: 1200,
  title: 'Podcast Show Title',
} as unknown as PodcastEpisode;

describe('renderPlaybackControls()', (): void => {
  it('renders skip backward and forward buttons with values and handles click', (): void => {
    const onSkip = vi.fn();
    const onToggle = vi.fn();
    const context: PlaybackControlsContext = {
      isBuffering: false,
      isPlaying: false,
      lang: 'en',
      onSkip,
      onTogglePlayPause: onToggle,
      skipSec: 15,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPlaybackControls(context), container);

    const rewindBtn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-rewind');
    rewindBtn?.click();
    expect(onSkip).toHaveBeenCalledWith(-15);

    const forwardBtn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-forward');
    forwardBtn?.click();
    expect(onSkip).toHaveBeenCalledWith(15);

    const playBtn: HTMLButtonElement | null = container.querySelector('.play-main');
    playBtn?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('renders buffering spinner when isBuffering is true', (): void => {
    const context: PlaybackControlsContext = {
      isBuffering: true,
      isPlaying: false,
      lang: 'en',
      onSkip: vi.fn(),
      onTogglePlayPause: vi.fn(),
      skipSec: 10,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPlaybackControls(context), container);

    expect(container.querySelector('.icon-spin')).not.toBeNull();
  });

  it('renders stop icon when isPlaying is true', (): void => {
    const context: PlaybackControlsContext = {
      isBuffering: false,
      isPlaying: true,
      lang: 'en',
      onSkip: vi.fn(),
      onTogglePlayPause: vi.fn(),
      skipSec: 10,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderPlaybackControls(context), container);

    expect(container.querySelector('.play-main svg')).not.toBeNull();
    expect(container.querySelector('.icon-spin')).toBeNull();
  });
});

describe('renderSpeedControls()', (): void => {
  it('renders speed pill button and responds to click', (): void => {
    const onToggle = vi.fn();
    const context: SpeedControlsContext = {
      currentSpeed: 1.25,
      lang: 'en',
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleSpeedPopover: onToggle,
      showSpeedPopover: false,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderSpeedControls(context), container);

    const pill: HTMLButtonElement | null = container.querySelector('.speed-pill-btn');
    expect(pill?.textContent?.trim()).toBe('1.25x');
    pill?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.speed-popover')).toBeNull();
  });

  it('renders speed presets and step controls when popover is open', (): void => {
    const onAdjust = vi.fn();
    const onStartHold = vi.fn();
    const onStopHold = vi.fn();
    const context: SpeedControlsContext = {
      currentSpeed: 1,
      lang: 'en',
      onSpeedAdjust: onAdjust,
      onStartSpeedHold: onStartHold,
      onStopSpeedHold: onStopHold,
      onToggleSpeedPopover: vi.fn(),
      showSpeedPopover: true,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderSpeedControls(context), container);

    const presets: NodeListOf<HTMLButtonElement> = container.querySelectorAll('.speed-preset-btn');
    expect(presets.length).toBeGreaterThan(0);
    presets[0]?.click();
    expect(onAdjust).toHaveBeenCalled();

    const minusBtn: HTMLButtonElement | null = container.querySelector('.speed-btn-minus');
    minusBtn?.dispatchEvent(new PointerEvent('pointerdown'));
    expect(onStartHold).toHaveBeenCalledWith(-0.05);

    minusBtn?.dispatchEvent(new PointerEvent('pointerup'));
    minusBtn?.dispatchEvent(new PointerEvent('pointercancel'));
    minusBtn?.dispatchEvent(new PointerEvent('pointerleave'));
    expect(onStopHold).toHaveBeenCalledTimes(3);

    const plusBtn: HTMLButtonElement | null = container.querySelector('.speed-btn-plus');
    plusBtn?.dispatchEvent(new PointerEvent('pointerdown'));
    expect(onStartHold).toHaveBeenCalledWith(0.05);

    plusBtn?.dispatchEvent(new PointerEvent('pointerup'));
    plusBtn?.dispatchEvent(new PointerEvent('pointercancel'));
    plusBtn?.dispatchEvent(new PointerEvent('pointerleave'));
    expect(onStopHold).toHaveBeenCalledTimes(6);
  });

  it('disables minus button when speed is at minimum and plus button at maximum', (): void => {
    const contextMin: SpeedControlsContext = {
      currentSpeed: 0.5,
      lang: 'en',
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleSpeedPopover: vi.fn(),
      showSpeedPopover: true,
    };

    const containerMin: HTMLDivElement = document.createElement('div');
    render(renderSpeedControls(contextMin), containerMin);
    expect(containerMin.querySelector('.speed-btn-minus')?.hasAttribute('disabled')).toBe(true);

    const contextMax: SpeedControlsContext = {
      currentSpeed: 3,
      lang: 'en',
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleSpeedPopover: vi.fn(),
      showSpeedPopover: true,
    };

    const containerMax: HTMLDivElement = document.createElement('div');
    render(renderSpeedControls(contextMax), containerMax);
    expect(containerMax.querySelector('.speed-btn-plus')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('renderVolumeControls()', (): void => {
  it('renders volume button and responds to click', (): void => {
    const onToggle = vi.fn();
    const context: VolumeControlsContext = {
      isMuted: false,
      lang: 'en',
      onToggleMute: vi.fn(),
      onToggleVolumePopover: onToggle,
      onVolumeChange: vi.fn(),
      showVolumePopover: false,
      volumeLevel: 0.8,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderVolumeControls(context), container);

    const btn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-volume');
    btn?.click();
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.volume-popover')).toBeNull();
  });

  it('renders volume popover with slider and mute toggle when open', (): void => {
    const onChange = vi.fn();
    const onMute = vi.fn();
    const context: VolumeControlsContext = {
      isMuted: true,
      lang: 'en',
      onToggleMute: onMute,
      onToggleVolumePopover: vi.fn(),
      onVolumeChange: onChange,
      showVolumePopover: true,
      volumeLevel: 0.5,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderVolumeControls(context), container);

    expect(container.querySelector('.volume-percent-label')?.textContent?.trim()).toBe('50%');

    const slider: HTMLInputElement =
      container.querySelector('.volume-slider-vertical') ?? document.createElement('input');
    slider.value = '0.7';
    slider.dispatchEvent(new Event('input'));
    expect(onChange).toHaveBeenCalledWith(0.7);

    const muteBtn: HTMLButtonElement | null = container.querySelector('.volume-popover .ctrl-btn');
    muteBtn?.click();
    expect(onMute).toHaveBeenCalledTimes(1);
  });
});

describe('renderControlsBar()', (): void => {
  it('renders full controls bar and handles chapters and library toggles', (): void => {
    const onChapters = vi.fn();
    const onLibrary = vi.fn();
    const context: ControlsBarContext = {
      currentSpeed: 1,
      hasNoChapters: false,
      isBuffering: false,
      isMuted: false,
      isPlaying: false,
      lang: 'en',
      onSkip: vi.fn(),
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleChapters: onChapters,
      onToggleLibrary: onLibrary,
      onToggleMute: vi.fn(),
      onTogglePlayPause: vi.fn(),
      onToggleSpeedPopover: vi.fn(),
      onToggleVolumePopover: vi.fn(),
      onVolumeChange: vi.fn(),
      showChapters: true,
      showLibrary: false,
      showSpeedPopover: false,
      showVolumePopover: false,
      skipSec: 10,
      volumeLevel: 1,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderControlsBar(context), container);

    const chaptersBtn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-chapters');
    expect(chaptersBtn?.classList.contains('active')).toBe(true);
    expect(chaptersBtn?.hasAttribute('disabled')).toBe(false);
    chaptersBtn?.click();
    expect(onChapters).toHaveBeenCalledTimes(1);

    const libraryBtn: HTMLButtonElement | null = container.querySelector('.ctrl-btn-library');
    expect(libraryBtn?.classList.contains('active')).toBe(false);
    libraryBtn?.click();
    expect(onLibrary).toHaveBeenCalledTimes(1);
  });

  it('disables chapters button when hasNoChapters is true', (): void => {
    const context: ControlsBarContext = {
      currentSpeed: 1,
      hasNoChapters: true,
      isBuffering: false,
      isMuted: false,
      isPlaying: false,
      lang: 'en',
      onSkip: vi.fn(),
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleChapters: vi.fn(),
      onToggleLibrary: vi.fn(),
      onToggleMute: vi.fn(),
      onTogglePlayPause: vi.fn(),
      onToggleSpeedPopover: vi.fn(),
      onToggleVolumePopover: vi.fn(),
      onVolumeChange: vi.fn(),
      showChapters: false,
      showLibrary: false,
      showSpeedPopover: false,
      showVolumePopover: false,
      skipSec: 10,
      volumeLevel: 1,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderControlsBar(context), container);

    expect(container.querySelector('.ctrl-btn-chapters')?.hasAttribute('disabled')).toBe(true);
  });
});

describe('renderNowPlayingBody()', (): void => {
  it('renders audiobook metadata, cover image, and handles image error', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderNowPlayingBody(mockBook, 'en', 3600), container);

    expect(container.querySelector('.player-title')?.textContent).toBe('Epic Adventure');
    expect(container.querySelector('.player-author')?.textContent).toContain('Author Name');
    expect(container.querySelector('.player-narrator')?.textContent).toContain('Narrator Name');
    expect(container.querySelector('.player-duration')?.textContent).toContain('1:00:00');

    const img: HTMLImageElement | null = container.querySelector('.player-cover img');
    expect(img).not.toBeNull();
    img?.dispatchEvent(new Event('error'));
    expect(img?.style.display).toBe('none');
  });

  it('renders podcast metadata with episode title and podcast author', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderNowPlayingBody(mockPodcast, 'en', 2400), container);

    expect(container.querySelector('.player-title')?.textContent).toBe('Episode 42: Deep Thought');
  });

  it('renders localized no active track fallback when item is null', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    render(renderNowPlayingBody(null, 'en', 0), container);

    expect(container.querySelector('.player-title')?.textContent).toBe(
      'Select an audiobook or podcast to start playback',
    );
    expect(container.querySelector('.player-cover img')).toBeNull();
  });
});

describe('renderTimelineContainer()', (): void => {
  it('renders chapter label with icon and title when active chapter exists', (): void => {
    const onSeekInput = vi.fn();
    const onSeekChange = vi.fn();
    const context: TimelineContainerContext = {
      currentChapter: mockChapter,
      currentItem: mockBook,
      currentSpeed: 1,
      lang: 'en',
      onSeekChange,
      onSeekInput,
      playbackDuration: 3600,
      playbackPosition: 300,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTimelineContainer(context), container);

    const chapterLabel: HTMLElement | null = container.querySelector('.chapter-label');
    expect(chapterLabel).not.toBeNull();
    expect(chapterLabel?.getAttribute('title')).toBe('Chapter 1: The Beginning');
    expect(chapterLabel?.querySelector('.chapter-label-icon')).not.toBeNull();
    expect(chapterLabel?.querySelector('.chapter-label-text')?.textContent).toBe(
      'Chapter 1: The Beginning',
    );

    const slider: HTMLInputElement =
      container.querySelector('.time-slider') ?? document.createElement('input');
    slider.value = '500';
    slider.dispatchEvent(new Event('input'));
    expect(onSeekInput).toHaveBeenCalledWith(500);

    slider.dispatchEvent(new Event('change'));
    expect(onSeekChange).toHaveBeenCalledWith(500);
  });

  it('renders chapter label without icon displaying book title when chapter is null (fix for card jumping)', (): void => {
    const context: TimelineContainerContext = {
      currentChapter: null,
      currentItem: mockBook,
      currentSpeed: 1,
      lang: 'en',
      onSeekChange: vi.fn(),
      onSeekInput: vi.fn(),
      playbackDuration: 3600,
      playbackPosition: 300,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTimelineContainer(context), container);

    const chapterLabel: HTMLElement | null = container.querySelector('.chapter-label');
    expect(chapterLabel).not.toBeNull();
    expect(chapterLabel?.getAttribute('title')).toBe('Epic Adventure');
    expect(chapterLabel?.querySelector('.chapter-label-icon')).toBeNull();
    expect(chapterLabel?.querySelector('.chapter-label-text')?.textContent).toBe('Epic Adventure');
  });

  it('renders chapter label without icon displaying episode title for podcast episode without chapters', (): void => {
    const context: TimelineContainerContext = {
      currentChapter: null,
      currentItem: mockPodcast,
      currentSpeed: 1,
      lang: 'en',
      onSeekChange: vi.fn(),
      onSeekInput: vi.fn(),
      playbackDuration: 2400,
      playbackPosition: 100,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderTimelineContainer(context), container);

    const chapterLabel: HTMLElement | null = container.querySelector('.chapter-label');
    expect(chapterLabel).not.toBeNull();
    expect(chapterLabel?.getAttribute('title')).toBe('Episode 42: Deep Thought');
    expect(chapterLabel?.querySelector('.chapter-label-icon')).toBeNull();
    expect(chapterLabel?.querySelector('.chapter-label-text')?.textContent).toBe(
      'Episode 42: Deep Thought',
    );
  });
});

describe('renderHeroPlayer()', (): void => {
  it('assembles device picker, now playing body, timeline, and controls bar into hero widget', (): void => {
    const context: HeroPlayerContext = {
      currentChapter: mockChapter,
      currentItem: mockBook,
      currentSpeed: 1,
      devicePicker: html`<div class="mock-device-picker">Device Badge</div>`,
      hasNoChapters: false,
      isBuffering: false,
      isMuted: false,
      isPlaying: false,
      lang: 'en',
      onSeekChange: vi.fn(),
      onSeekInput: vi.fn(),
      onSkip: vi.fn(),
      onSpeedAdjust: vi.fn(),
      onStartSpeedHold: vi.fn(),
      onStopSpeedHold: vi.fn(),
      onToggleChapters: vi.fn(),
      onToggleLibrary: vi.fn(),
      onToggleMute: vi.fn(),
      onTogglePlayPause: vi.fn(),
      onToggleSpeedPopover: vi.fn(),
      onToggleVolumePopover: vi.fn(),
      onVolumeChange: vi.fn(),
      playbackDuration: 3600,
      playbackPosition: 300,
      showChapters: false,
      showLibrary: false,
      showSpeedPopover: false,
      showVolumePopover: false,
      skipSec: 15,
      volumeLevel: 1,
    };

    const container: HTMLDivElement = document.createElement('div');
    render(renderHeroPlayer(context), container);

    expect(container.querySelector('.player-hero')).not.toBeNull();
    expect(container.querySelector('.mock-device-picker')).not.toBeNull();
    expect(container.querySelector('.now-playing-body')).not.toBeNull();
    expect(container.querySelector('.timeline-container')).not.toBeNull();
    expect(container.querySelector('.controls-bar')).not.toBeNull();
  });
});
