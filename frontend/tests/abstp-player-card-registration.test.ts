import { afterEach, describe, expect, it } from 'vitest';

type WindowWithCards = Window & {
  customCards?: Array<{
    description: string;
    name: string;
    type: string;
  }>;
};

describe('AbstpPlayerCard registration', (): void => {
  afterEach((): void => {
    delete (window as WindowWithCards).customCards;
  });

  it('appends its type when another custom card is already registered', async (): Promise<void> => {
    (window as WindowWithCards).customCards = [
      { description: 'Legacy', name: 'Legacy Card', type: 'custom:legacy' },
    ];

    await import('../src/abstp-player-card.ts');

    const cards = (window as WindowWithCards).customCards ?? [];
    expect(cards).toHaveLength(2);
    expect(cards.some((card): boolean => card.type === 'abstp-player-card')).toBe(true);
  });
});
