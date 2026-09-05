import { render, type TemplateResult } from 'lit-html';
import { describe, expect, it, vi } from 'vitest';
import {
  type ChaptersSectionContext,
  renderChapterItem,
  renderChaptersSection,
  scrollToActiveChapter,
} from '../src/card/templates/chapters.ts';
import type { ChapterItem } from '../src/types.ts';

const mockChapter1: ChapterItem = {
  duration: 600,
  end: 600,
  id: 1,
  start: 0,
  title: 'Chapter 1',
};
const mockChapter2: ChapterItem = {
  duration: 900,
  end: 1500,
  id: 2,
  start: 600,
  title: 'Chapter 2',
};
const mockChapter3: ChapterItem = {
  duration: 1200,
  end: 2700,
  id: 3,
  start: 1500,
  title: 'Chapter 3',
};
const mockChapters: ChapterItem[] = [mockChapter1, mockChapter2, mockChapter3];

describe('renderChapterItem()', (): void => {
  it('renders chapter index, title, and formatted duration', (): void => {
    const clickFn = vi.fn();
    const result: TemplateResult = renderChapterItem(mockChapter1, 0, false, clickFn);
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.chapter-item-index')?.textContent).toBe('1');
    expect(container.querySelector('.chapter-item-title')?.textContent?.trim()).toBe('Chapter 1');
    expect(container.querySelector('.chapter-item-duration')?.textContent).toContain('10:00');
    expect(container.querySelector('.chapter-item.active')).toBeNull();

    (container.querySelector('.chapter-item') as HTMLElement)?.click();
    expect(clickFn).toHaveBeenCalledWith(mockChapter1);
  });

  it('adds active class when chapter matches current active chapter', (): void => {
    const result: TemplateResult = renderChapterItem(mockChapter2, 1, true, vi.fn());
    const container: HTMLDivElement = document.createElement('div');
    render(result, container);

    expect(container.querySelector('.chapter-item.active')).not.toBeNull();
  });
});

describe('renderChaptersSection()', (): void => {
  it('renders loading state when isLoadingChapters is true', (): void => {
    const context: ChaptersSectionContext = {
      chapters: [],
      currentChapter: null,
      isLoadingChapters: true,
      lang: 'en',
      onChapterClick: vi.fn(),
    };
    const container: HTMLDivElement = document.createElement('div');
    render(renderChaptersSection(context), container);

    expect(container.querySelector('.empty-state')?.textContent).toBe('Loading catalog...');
  });

  it('renders no chapters state when chapters count is one or zero', (): void => {
    const context: ChaptersSectionContext = {
      chapters: [mockChapter1],
      currentChapter: null,
      isLoadingChapters: false,
      lang: 'en',
      onChapterClick: vi.fn(),
    };
    const container: HTMLDivElement = document.createElement('div');
    render(renderChaptersSection(context), container);

    expect(container.querySelector('.empty-state')?.textContent).toBe('No chapters available');
  });

  it('renders complete list of chapters when multiple chapters exist', (): void => {
    const clickFn = vi.fn();
    const context: ChaptersSectionContext = {
      chapters: mockChapters,
      currentChapter: mockChapter2,
      isLoadingChapters: false,
      lang: 'en',
      onChapterClick: clickFn,
    };
    const container: HTMLDivElement = document.createElement('div');
    render(renderChaptersSection(context), container);

    const items: NodeListOf<HTMLElement> = container.querySelectorAll('.chapter-item');
    expect(items.length).toBe(3);
    expect(items[1]?.classList.contains('active')).toBe(true);

    items[2]?.click();
    expect(clickFn).toHaveBeenCalledWith(mockChapter3);
  });
});

describe('scrollToActiveChapter()', (): void => {
  it('handles null root without throwing', (): void => {
    expect((): void => scrollToActiveChapter(null)).not.toThrow();
  });

  it('does not scroll when active item or list is missing', (): void => {
    const container: HTMLDivElement = document.createElement('div');
    expect((): void => scrollToActiveChapter(container)).not.toThrow();
  });

  it('scrolls list to zero when target is first child', (): void => {
    const list: HTMLDivElement = document.createElement('div');
    list.className = 'chapters-list';
    const firstItem: HTMLDivElement = document.createElement('div');
    firstItem.className = 'chapter-item active';
    list.appendChild(firstItem);

    let scrollPos = 100;
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: (): number => scrollPos,
      set: (val: number): void => {
        scrollPos = val;
      },
    });

    scrollToActiveChapter(list);
    expect(list.scrollTop).toBe(0);
  });

  it('scrolls list using target offset for later items', (): void => {
    const list: HTMLDivElement = document.createElement('div');
    list.className = 'chapters-list';

    const item1: HTMLDivElement = document.createElement('div');
    item1.className = 'chapter-item';
    const item2: HTMLDivElement = document.createElement('div');
    item2.className = 'chapter-item';
    const item3: HTMLDivElement = document.createElement('div');
    item3.className = 'chapter-item active';

    list.appendChild(item1);
    list.appendChild(item2);
    list.appendChild(item3);

    let scrollPos = 0;
    Object.defineProperty(list, 'scrollTop', {
      configurable: true,
      get: (): number => scrollPos,
      set: (val: number): void => {
        scrollPos = val;
      },
    });
    Object.defineProperty(item2, 'offsetTop', { value: 50, writable: true });
    Object.defineProperty(item2, 'offsetParent', { value: list, writable: true });

    scrollToActiveChapter(list);
    expect(list.scrollTop).toBe(50);
  });
});
