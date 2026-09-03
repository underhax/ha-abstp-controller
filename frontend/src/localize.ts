import { de } from './locales/de.ts';
import { en } from './locales/en.ts';
import { es } from './locales/es.ts';
import { fr } from './locales/fr.ts';
import { ru } from './locales/ru.ts';
import { uk } from './locales/uk.ts';

export type LocaleCode = 'de' | 'en' | 'es' | 'fr' | 'ru' | 'uk';

const translations: Record<LocaleCode, Record<string, string>> = {
  de,
  en,
  es,
  fr,
  ru,
  uk,
};

export function localize(
  key: string,
  language: string = 'en',
  params?: Record<string, string | number>,
): string {
  const lang: string = language.split('-')[0] || 'en';
  const enDictionary: Record<string, string> = translations.en as Record<string, string>;
  const dictionary: Record<string, string> = translations[lang as LocaleCode] || enDictionary;
  let text: string = dictionary[key] || enDictionary[key] || key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(String(v));
    }
  }
  return text;
}
