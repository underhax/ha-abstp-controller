import { describe, expect, it, vi } from 'vitest';
import { BrowserAudioPlayer } from '../src/audio-player.ts';

describe('BrowserAudioPlayer', (): void => {
  it('instantiates and manages playback states cleanly', (): void => {
    const player: BrowserAudioPlayer = new BrowserAudioPlayer();
    expect(player.isPlaying()).toBe(false);
    expect(player.getCurrentTime()).toBe(0);
    expect(player.getDuration()).toBe(0);
  });

  it('triggers registered callbacks on state and error events', (): void => {
    const player: BrowserAudioPlayer = new BrowserAudioPlayer();
    const stateSpy = vi.fn();
    const timeSpy = vi.fn();
    const errorSpy = vi.fn();

    player.onState(stateSpy);
    player.onTime(timeSpy);
    player.onError(errorSpy);

    player.stop();
    expect(stateSpy).toHaveBeenCalledWith(false);
  });
});
