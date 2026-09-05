import { html, type TemplateResult } from 'lit-html';
import { timerIcon } from '../../icons.ts';
import { localize } from '../../localize.ts';
import type { ChapterItem } from '../../types.ts';
import { formatTime } from '../timeline.ts';

export interface ChaptersSectionContext {
  chapters: ChapterItem[];
  currentChapter: ChapterItem | null;
  isLoadingChapters: boolean;
  lang: string;
  onChapterClick: (chapter: ChapterItem) => void | Promise<void>;
}

export function scrollToActiveChapter(
  root: HTMLElement | DocumentFragment | null | undefined,
): void {
  const list: HTMLElement | null =
    (root instanceof HTMLElement && root.classList.contains('chapters-list')
      ? root
      : root?.querySelector('.chapters-list')) ?? null;
  const activeItem: HTMLElement | null = list?.querySelector('.chapter-item.active') ?? null;
  if (!list || !activeItem) {
    return;
  }
  const targetItem: HTMLElement =
    (activeItem.previousElementSibling as HTMLElement | null) ?? activeItem;

  if (targetItem === list.firstElementChild) {
    list.scrollTop = 0;
    return;
  }

  let targetOffset: number;
  if (targetItem.offsetParent === list) {
    targetOffset = targetItem.offsetTop;
  } else {
    const listRect: DOMRect = list.getBoundingClientRect();
    const targetRect: DOMRect = targetItem.getBoundingClientRect();
    if (listRect.height > 0 || targetRect.height > 0) {
      targetOffset = targetRect.top - listRect.top - list.clientTop + list.scrollTop;
    } else {
      targetOffset = targetItem.offsetTop - list.offsetTop;
    }
  }

  list.scrollTop = Math.max(0, targetOffset);
}

export function renderChapterItem(
  chapter: ChapterItem,
  index: number,
  isActive: boolean,
  onChapterClick: (chapter: ChapterItem) => void | Promise<void>,
): TemplateResult {
  return html`
    <div
      class="chapter-item ${isActive ? 'active' : ''}"
      @click=${(): void => {
        void onChapterClick(chapter);
      }}
    >
      <div class="chapter-item-left">
        <span class="chapter-item-index">${index + 1}</span>
        <span class="chapter-item-title" title="${chapter.title}">
          ${chapter.title}
        </span>
      </div>
      <div class="chapter-item-right">
        <span class="chapter-item-duration">
          <span class="meta-icon timer-icon" aria-hidden="true">${timerIcon}</span>
          <span>${formatTime(chapter.duration)}</span>
        </span>
      </div>
    </div>
  `;
}

export function renderChaptersSection(context: ChaptersSectionContext): TemplateResult {
  return html`
    <div class="chapters-section">
      <div class="chapters-header">
        <span class="chapters-header-title">
          ${localize('card.chapters', context.lang)} (${context.chapters.length})
        </span>
      </div>

      ${
        context.isLoadingChapters
          ? html`<div class="empty-state">${localize('card.loading', context.lang)}</div>`
          : context.chapters.length <= 1
            ? html`<div class="empty-state">${localize('card.no_chapters', context.lang)}</div>`
            : html`
              <div class="chapters-list">
                ${context.chapters.map(
                  (ch: ChapterItem, index: number): TemplateResult =>
                    renderChapterItem(
                      ch,
                      index,
                      context.currentChapter?.id === ch.id,
                      context.onChapterClick,
                    ),
                )}
              </div>
            `
      }
    </div>
  `;
}
