import { DEFAULT_PLAYBACK_SPEED } from './constants.ts';

export interface TimelineMetrics {
  effectiveDuration: number;
  effectivePosition: number;
  effectiveSpeed: number;
  progressPercent: number;
  remainingSeconds: number;
  speedAdjustedDuration: number;
  speedAdjustedPosition: number;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || Number.isNaN(seconds) || seconds < 0) {
    return '0:00';
  }
  const s: number = Math.floor(seconds);
  const hrs: number = Math.floor(s / 3600);
  const mins: number = Math.floor((s % 3600) / 60);
  const secs: number = s % 60;
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function calculateTimelineMetrics(
  playbackPosition: number,
  playbackDuration: number,
  currentSpeed: number,
): TimelineMetrics {
  const effectiveSpeed: number = currentSpeed > 0 ? currentSpeed : DEFAULT_PLAYBACK_SPEED;
  const effectivePosition: number = Number.isFinite(playbackPosition) ? playbackPosition : 0;
  const effectiveDuration: number =
    playbackDuration > 0 && Number.isFinite(playbackDuration) ? playbackDuration : 0;
  const speedAdjustedDuration: number =
    effectiveDuration > 0 ? Math.round(effectiveDuration / effectiveSpeed) : 0;
  const speedAdjustedPosition: number =
    effectivePosition > 0 ? Math.round(effectivePosition / effectiveSpeed) : 0;
  const remainingSeconds: number = Math.max(0, speedAdjustedDuration - speedAdjustedPosition);
  const progressPercent: number =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, Math.round((effectivePosition / effectiveDuration) * 100)))
      : 0;
  return {
    effectiveDuration,
    effectivePosition,
    effectiveSpeed,
    progressPercent,
    remainingSeconds,
    speedAdjustedDuration,
    speedAdjustedPosition,
  };
}
