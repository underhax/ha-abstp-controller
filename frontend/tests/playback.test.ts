import { describe, expect, it } from 'vitest';
import {
  calculateBrowserPosition,
  calculateNextSpeed,
  calculateSkipPosition,
  calculateSpeakerProgress,
  clampVolume,
  isSpeedOutOfRange,
  normalizeSeekPosition,
  resolvePlayPosition,
  SEEK_ZERO_SAFE_OFFSET,
} from '../src/card/playback.ts';

describe('normalizeSeekPosition()', (): void => {
  it('returns safe offset when position is zero', (): void => {
    expect(normalizeSeekPosition(0)).toBe(SEEK_ZERO_SAFE_OFFSET);
  });

  it('returns safe offset when position is negative', (): void => {
    expect(normalizeSeekPosition(-10)).toBe(SEEK_ZERO_SAFE_OFFSET);
  });

  it('returns safe offset when position is non-finite', (): void => {
    expect(normalizeSeekPosition(Number.NaN)).toBe(SEEK_ZERO_SAFE_OFFSET);
    expect(normalizeSeekPosition(Number.POSITIVE_INFINITY)).toBe(SEEK_ZERO_SAFE_OFFSET);
  });

  it('preserves positive seek positions unmodified', (): void => {
    expect(normalizeSeekPosition(125.5)).toBe(125.5);
    expect(normalizeSeekPosition(0.5)).toBe(0.5);
  });
});

describe('resolvePlayPosition()', (): void => {
  it('preserves zero position without falling back to progress', (): void => {
    expect(resolvePlayPosition(0, 1500)).toBe(0);
  });

  it('returns valid positive position directly', (): void => {
    expect(resolvePlayPosition(350, 1500)).toBe(350);
  });

  it('falls back to progress when position is negative', (): void => {
    expect(resolvePlayPosition(-1, 800)).toBe(800);
  });

  it('falls back to progress when position is NaN', (): void => {
    expect(resolvePlayPosition(Number.NaN, 900)).toBe(900);
  });

  it('defaults to zero when both position and fallback are invalid', (): void => {
    expect(resolvePlayPosition(Number.NaN, undefined)).toBe(0);
    expect(resolvePlayPosition(-5, -100)).toBe(0);
  });
});

describe('calculateSkipPosition()', (): void => {
  it('skips forward within duration limits', (): void => {
    expect(calculateSkipPosition(100, 3600, 30)).toBe(130);
  });

  it('clamps to duration when skipping beyond track end', (): void => {
    expect(calculateSkipPosition(3590, 3600, 30)).toBe(3600);
  });

  it('skips backward correctly', (): void => {
    expect(calculateSkipPosition(100, 3600, -30)).toBe(70);
  });

  it('clamps to zero when skipping before beginning', (): void => {
    expect(calculateSkipPosition(15, 3600, -30)).toBe(0);
  });

  it('handles zero duration without negative results', (): void => {
    expect(calculateSkipPosition(0, 0, -10)).toBe(0);
  });
});

describe('calculateNextSpeed()', (): void => {
  it('increments speed by delta and rounds to two decimal places', (): void => {
    expect(calculateNextSpeed(1.0, 0.05)).toBe(1.05);
  });

  it('decrements speed by delta and rounds to two decimal places', (): void => {
    expect(calculateNextSpeed(1.25, -0.1)).toBe(1.15);
  });

  it('clamps speed to minimum boundary', (): void => {
    expect(calculateNextSpeed(0.5, -0.1)).toBe(0.5);
  });

  it('clamps speed to maximum boundary', (): void => {
    expect(calculateNextSpeed(3.0, 0.2)).toBe(3.0);
  });
});

describe('isSpeedOutOfRange()', (): void => {
  it('identifies speed within range as valid', (): void => {
    expect(isSpeedOutOfRange(1.0)).toBe(false);
    expect(isSpeedOutOfRange(0.5)).toBe(false);
    expect(isSpeedOutOfRange(3.0)).toBe(false);
  });

  it('identifies speed below minimum as out of range', (): void => {
    expect(isSpeedOutOfRange(0.45)).toBe(true);
  });

  it('identifies speed above maximum as out of range', (): void => {
    expect(isSpeedOutOfRange(3.05)).toBe(true);
  });
});

describe('calculateSpeakerProgress()', (): void => {
  it('advances position by playback speed', (): void => {
    expect(calculateSpeakerProgress(100, 3600, 1.5)).toBe(101.5);
  });

  it('uses default speed when speed is zero or negative', (): void => {
    expect(calculateSpeakerProgress(100, 3600, 0)).toBe(101);
  });

  it('clamps to duration when reaching end', (): void => {
    expect(calculateSpeakerProgress(3599.5, 3600, 1.0)).toBe(3600);
  });
});

describe('calculateBrowserPosition()', (): void => {
  it('calculates position based on stream start and audio position with speed', (): void => {
    expect(calculateBrowserPosition(300, 10, 1.5, 3600)).toBe(315);
  });

  it('clamps browser position to duration', (): void => {
    expect(calculateBrowserPosition(3590, 20, 1.0, 3600)).toBe(3600);
  });

  it('allows unbounded progress when duration is zero', (): void => {
    expect(calculateBrowserPosition(50, 10, 1.0, 0)).toBe(60);
  });
});

describe('clampVolume()', (): void => {
  it('rounds volume to one decimal place', (): void => {
    expect(clampVolume(0.65)).toBe(0.7);
    expect(clampVolume(0.64)).toBe(0.6);
  });

  it('clamps volume below zero to zero', (): void => {
    expect(clampVolume(-0.2)).toBe(0.0);
  });

  it('clamps volume above one to one', (): void => {
    expect(clampVolume(1.5)).toBe(1.0);
  });
});
