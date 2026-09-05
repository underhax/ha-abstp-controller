import { html, type TemplateResult } from 'lit-html';
import { unsafeSVG } from 'lit-html/directives/unsafe-svg.js';

const iconSources: Record<string, string> = import.meta.glob<string>('./icons/*.svg', {
  eager: true,
  import: 'default',
  query: '?raw',
});

const createIcon = (name: string): TemplateResult => {
  const source: string = iconSources[`./icons/${name}.svg`] ?? '';
  return html`${unsafeSVG(source)}`;
};

export const audiobookIcon: TemplateResult = createIcon('audiobook');
export const audiobookshelfIcon: TemplateResult = createIcon('audiobookshelf');
export const authorIcon: TemplateResult = createIcon('author');
export const browserIcon: TemplateResult = createIcon('browser');
export const chaptersIcon: TemplateResult = createIcon('chapters');
export const chevronDownIcon: TemplateResult = createIcon('chevron-down');
export const libraryIcon: TemplateResult = createIcon('library');
export const microphoneIcon: TemplateResult = createIcon('microphone');
export const minusIcon: TemplateResult = createIcon('minus');
export const playIcon: TemplateResult = createIcon('play');
export const plusIcon: TemplateResult = createIcon('plus');
export const podcastIcon: TemplateResult = createIcon('podcast');
export const redoIcon: TemplateResult = createIcon('redo');
export const soundMuteIcon: TemplateResult = createIcon('sound-mute');
export const soundOnIcon: TemplateResult = createIcon('sound-on');
export const speakerIcon: TemplateResult = createIcon('speaker');
export const stopIcon: TemplateResult = createIcon('stop');
export const timerIcon: TemplateResult = createIcon('timer');
export const undoIcon: TemplateResult = createIcon('undo');
export const waitIcon: TemplateResult = createIcon('wait');
