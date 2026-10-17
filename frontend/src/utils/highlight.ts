/**
 * 类 Google 模糊词元解耦、无损 DOM Range 搜寻与 CSS.highlights 驱动服务
 */

// 过滤常见代码结构与极短单字
const STOP_WORDS = new Set([
  'key',
  'turn',
  'idx',
  'index',
  'for',
  'let',
  'const',
  'var',
  'function',
  'return',
  'true',
  'false',
  'null',
  'import',
  'from',
  'export',
  'class',
  'div',
  'span',
]);

/**
 * 提取搜索短语与特征词元：
 * 1. 若为多行代码：提取每一个非空行作为独立完整子短语（忽略首尾缩进）；
 * 2. 提取长度 >= 4 且非通用停用词的专有特征标识符。
 */
export function extractSearchTokens(rawQuery: string): {
  fullPhrase: string;
  linePhrases: string[];
  terms: string[];
} {
  const clean = rawQuery.trim();
  if (!clean) return { fullPhrase: '', linePhrases: [], terms: [] };

  const rawLines = clean.split('\n');
  const linePhrases: string[] = [];
  const terms: string[] = [];

  for (const rawLine of rawLines) {
    const trimmedLine = rawLine.trim();
    if (trimmedLine.length >= 3) {
      linePhrases.push(trimmedLine);
    }

    // 提取行内专有标识符 (长度 >= 4)
    const tokens = trimmedLine.split(/[^\w\u4e00-\u9fa5]+/);
    for (const t of tokens) {
      const term = t.trim();
      if (term.length >= 4 && !STOP_WORDS.has(term.toLowerCase()) && !terms.includes(term)) {
        terms.push(term);
      }
    }
  }

  return { fullPhrase: clean, linePhrases, terms };
}

/**
 * 在目标容器内使用 TreeWalker 安全扫描所有文本节点，生成匹配的 Range 集合并注册到 CSS.highlights
 */
export function applyCustomHighlight(
  rootEl: HTMLElement | null,
  rawQuery: string,
  targetScopeEl: HTMLElement | null = null,
): { ranges: Range[]; targetMatchedElement: HTMLElement | null } {
  if (!rootEl || !rawQuery || rawQuery.trim().length < 2) {
    clearCustomHighlight();
    return { ranges: [], targetMatchedElement: null };
  }

  const { fullPhrase, linePhrases, terms } = extractSearchTokens(rawQuery);
  const normalizedFull = fullPhrase.toLowerCase();
  const searchLines = linePhrases.map((l) => l.toLowerCase());
  const searchTerms = terms.map((t) => t.toLowerCase());

  const ranges: Range[] = [];
  let targetEl: HTMLElement | null = null;
  const isMultiLine = rawQuery.includes('\n') && searchLines.length > 1;

  const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
  let currentNode = walker.nextNode();

  while (currentNode) {
    const textNode = currentNode as Text;
    const textVal = (textNode.textContent || '').toLowerCase();
    const parent = textNode.parentElement;
    const isInsideTargetScope = targetScopeEl ? targetScopeEl.contains(textNode) : true;

    // 模式 A：单行连续全字命中
    if (!isMultiLine && normalizedFull.length >= 3 && textVal.includes(normalizedFull)) {
      let startIndex = textVal.indexOf(normalizedFull, 0);
      while (startIndex !== -1) {
        const range = new Range();
        range.setStart(textNode, startIndex);
        range.setEnd(textNode, startIndex + normalizedFull.length);
        ranges.push(range);
        if (!targetEl && isInsideTargetScope && parent) {
          targetEl = parent;
        }
        startIndex = textVal.indexOf(normalizedFull, startIndex + normalizedFull.length);
      }
    } else if (isMultiLine) {
      // 模式 B：多行代码搜索时，按每一行代码独立匹配（杜绝拆分成单个短词）
      for (const linePhrase of searchLines) {
        if (textVal.includes(linePhrase)) {
          let startIndex = textVal.indexOf(linePhrase, 0);
          while (startIndex !== -1) {
            const range = new Range();
            range.setStart(textNode, startIndex);
            range.setEnd(textNode, startIndex + linePhrase.length);
            ranges.push(range);
            if (!targetEl && isInsideTargetScope && parent) {
              targetEl = parent;
            }
            startIndex = textVal.indexOf(linePhrase, startIndex + linePhrase.length);
          }
        }
      }
    } else if (searchTerms.length > 0) {
      // 模式 C：过滤掉停用词后的长词元并集匹配
      for (const term of searchTerms) {
        let startIndex = textVal.indexOf(term, 0);
        while (startIndex !== -1) {
          const range = new Range();
          range.setStart(textNode, startIndex);
          range.setEnd(textNode, startIndex + term.length);
          ranges.push(range);
          if (!targetEl && isInsideTargetScope && parent) {
            targetEl = parent;
          }
          startIndex = textVal.indexOf(term, startIndex + term.length);
        }
      }
    }

    currentNode = walker.nextNode();
  }

  // 注册到 CSS Custom Highlight API
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
    try {
      CSS.highlights.set('search-result', new Highlight(...ranges));
    } catch (err) {
      console.debug('注册 CSS.highlights 异常:', err);
    }
  }

  return { ranges, targetMatchedElement: targetEl };
}

/**
 * 清除当前注册的高亮选区
 */
export function clearCustomHighlight() {
  if (typeof CSS !== 'undefined' && 'highlights' in CSS) {
    try {
      CSS.highlights.delete('search-result');
      CSS.highlights.delete('search-target-active');
    } catch {
      // 忽略清理异常
    }
  }
}

/**
 * 触发平滑居中滚动并附加脉冲闪烁动效
 */
export function flashAndScrollToElement(el: HTMLElement | null) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('search-target-flash');
  setTimeout(() => {
    el.classList.remove('search-target-flash');
  }, 2200);
}
