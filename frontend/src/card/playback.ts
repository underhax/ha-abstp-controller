import { DEFAULT_PLAYBACK_SPEED, MAX_PLAYBACK_SPEED, MIN_PLAYBACK_SPEED } from './constants.ts';

export const SEEK_ZERO_SAFE_OFFSET: number = 0.1;

export function normalizeSeekPosition(position: number): number {
  if (!Number.isFinite(position) || position <= 0) {
    return SEEK_ZERO_SAFE_OFFSET;
  }
  return position;
}

export function resolvePlayPosition(playbackPosition: number, fallbackProgress?: number): number {
  if (Number.isFinite(playbackPosition) && playbackPosition >= 0) {
    return playbackPosition;
  }
  return Math.max(0, fallbackProgress ?? 0);
}

export function calculateSkipPosition(
  currentPosition: number,
  duration: number,
  deltaSeconds: number,
): number {
  const target: number = currentPosition + deltaSeconds;
  return Math.max(0, Math.min(duration > 0 ? duration : target, target));
}

export function calculateNextSpeed(currentSpeed: number, delta: number): number {
  const nextSpeed: number = Math.round((currentSpeed + delta) * 100) / 100;
  return Math.max(MIN_PLAYBACK_SPEED, Math.min(MAX_PLAYBACK_SPEED, nextSpeed));
}

export function isSpeedOutOfRange(speed: number): boolean {
  return speed < MIN_PLAYBACK_SPEED || speed > MAX_PLAYBACK_SPEED;
}

export function calculateSpeakerProgress(
  currentPosition: number,
  duration: number,
  speed: number,
): number {
  const step: number = speed > 0 ? speed : DEFAULT_PLAYBACK_SPEED;
  return Math.min(duration > 0 ? duration : currentPosition + step, currentPosition + step);
}

export function calculateBrowserPosition(
  streamStartPos: number,
  currentAudioPos: number,
  speed: number,
  duration: number,
): number {
  const effectiveSpeed: number = speed > 0 ? speed : DEFAULT_PLAYBACK_SPEED;
  const calculatedPos: number = streamStartPos + currentAudioPos * effectiveSpeed;
  return Math.min(duration > 0 ? duration : calculatedPos, calculatedPos);
}

export function clampVolume(volume: number): number {
  return Math.round(Math.min(1.0, Math.max(0.0, volume)) * 10) / 10;
}
