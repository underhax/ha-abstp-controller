import { afterEach, describe, expect, it } from 'vitest';

type WindowWithCards = Window & {
  customCards?: Array<{
    description: string;
    name: string;
    type: string;
  }>;
};

describe('AbstpPlayerCard', (): void => {
  afterEach((): void => {
    delete (window as WindowWithCards).customCards;
  });

  it('preserves existing card registrations without duplicates', async (): Promise<void> => {
    (window as WindowWithCards).customCards = [
      {
        description: 'Audiobookshelf Player',
        name: 'Audiobookshelf Player',
        type: 'abstp-player-card',
      },
    ];

    await import('../src/abstp-player-card.ts');

    const cards = (window as WindowWithCards).customCards ?? [];
    expect(cards).toHaveLength(1);
    expect(cards[0]?.type).toBe('abstp-player-card');
  });
});
