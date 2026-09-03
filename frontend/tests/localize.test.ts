import { describe, expect, it } from 'vitest';
import { type LocaleCode, localize } from '../src/localize.ts';

describe('localize()', (): void => {
  it('translates known keys across all supported locales', (): void => {
    const locales: LocaleCode[] = ['en', 'ru', 'de', 'es', 'fr', 'uk'];
    for (const loc of locales) {
      const translated: string = localize('card.name', loc);
      expect(translated).toBeDefined();
      expect(translated.length).toBeGreaterThan(0);
    }
  });

  it('falls back to English when language is unsupported', (): void => {
    const translated: string = localize('card.name', 'unknown-LANG');
    expect(translated).toBe('Audiobookshelf Player');
  });

  it('returns key string when key does not exist', (): void => {
    const translated: string = localize('non.existent.key', 'en');
    expect(translated).toBe('non.existent.key');
  });

  it('interpolates parameters into localized strings', (): void => {
    const translatedRu: string = localize('card.skip_backward', 'ru', { s: 15 });
    expect(translatedRu).toBe('Назад на 15 с');
    const translatedEn: string = localize('card.skip_forward', 'en', { s: 30 });
    expect(translatedEn).toBe('Forward 30s');
  });
});
