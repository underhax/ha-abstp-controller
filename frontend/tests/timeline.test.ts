import { describe, expect, it } from 'vitest';
import { calculateTimelineMetrics, formatTime } from '../src/card/timeline.ts';

describe('formatTime()', (): void => {
  it('formats zero seconds as 0:00', (): void => {
    expect(formatTime(0)).toBe('0:00');
  });

  it('formats seconds under one minute as 0:SS', (): void => {
    expect(formatTime(9)).toBe('0:09');
    expect(formatTime(45)).toBe('0:45');
  });

  it('formats minutes and seconds as M:SS and MM:SS', (): void => {
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(3599)).toBe('59:59');
  });

  it('formats hours, minutes and seconds as H:MM:SS', (): void => {
    expect(formatTime(3600)).toBe('1:00:00');
    expect(formatTime(3665)).toBe('1:01:05');
    expect(formatTime(36000)).toBe('10:00:00');
  });

  it('returns 0:00 for negative values', (): void => {
    expect(formatTime(-1)).toBe('0:00');
    expect(formatTime(-100)).toBe('0:00');
  });

  it('returns 0:00 for non-finite values and NaN', (): void => {
    expect(formatTime(Number.NaN)).toBe('0:00');
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00');
    expect(formatTime(Number.NEGATIVE_INFINITY)).toBe('0:00');
  });
});

describe('calculateTimelineMetrics()', (): void => {
  it('calculates metrics for zero position and duration', (): void => {
    const metrics = calculateTimelineMetrics(0, 0, 1.0);
    expect(metrics.effectivePosition).toBe(0);
    expect(metrics.effectiveDuration).toBe(0);
    expect(metrics.effectiveSpeed).toBe(1.0);
    expect(metrics.progressPercent).toBe(0);
    expect(metrics.remainingSeconds).toBe(0);
    expect(metrics.speedAdjustedDuration).toBe(0);
    expect(metrics.speedAdjustedPosition).toBe(0);
  });

  it('calculates metrics at standard speed', (): void => {
    const metrics = calculateTimelineMetrics(300, 1200, 1.0);
    expect(metrics.effectivePosition).toBe(300);
    expect(metrics.effectiveDuration).toBe(1200);
    expect(metrics.effectiveSpeed).toBe(1.0);
    expect(metrics.progressPercent).toBe(25);
    expect(metrics.speedAdjustedDuration).toBe(1200);
    expect(metrics.speedAdjustedPosition).toBe(300);
    expect(metrics.remainingSeconds).toBe(900);
  });

  it('calculates speed adjusted values for accelerated playback', (): void => {
    const metrics = calculateTimelineMetrics(600, 3600, 2.0);
    expect(metrics.effectiveSpeed).toBe(2.0);
    expect(metrics.speedAdjustedDuration).toBe(1800);
    expect(metrics.speedAdjustedPosition).toBe(300);
    expect(metrics.remainingSeconds).toBe(1500);
    expect(metrics.progressPercent).toBe(17);
  });

  it('clamps progress percent between 0 and 100', (): void => {
    const overProgress = calculateTimelineMetrics(4000, 3600, 1.0);
    expect(overProgress.progressPercent).toBe(100);

    const negativePosition = calculateTimelineMetrics(-50, 3600, 1.0);
    expect(negativePosition.progressPercent).toBe(0);
  });

  it('uses default speed when speed is zero or negative', (): void => {
    const zeroSpeed = calculateTimelineMetrics(100, 1000, 0);
    expect(zeroSpeed.effectiveSpeed).toBe(1.0);

    const negativeSpeed = calculateTimelineMetrics(100, 1000, -1.5);
    expect(negativeSpeed.effectiveSpeed).toBe(1.0);
  });

  it('handles non-finite values safely', (): void => {
    const nanMetrics = calculateTimelineMetrics(Number.NaN, Number.POSITIVE_INFINITY, 1.0);
    expect(nanMetrics.effectivePosition).toBe(0);
    expect(nanMetrics.effectiveDuration).toBe(0);
    expect(nanMetrics.progressPercent).toBe(0);
  });
});
