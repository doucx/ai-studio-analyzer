import { computed, signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export type DepthFilter = 'all' | 'single' | 'deep' | 'branch';
export type SortOption = 'modified' | 'tokens' | 'turns';

// 基础源数据状态
export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const selectedModelSignal = signal<string>('all');
export const depthFilterSignal = signal<DepthFilter>('all');
export const sortBySignal = signal<SortOption>('modified');

// FTS5 全文检索专属状态
export const ftsResultsSignal = signal<SessionItem[] | null>(null);
export const isSearchingFtsSignal = signal<boolean>(false);

// 动态提取当前数据集中所有模型列表及其会话计数 (降序)
export const availableModelsSignal = computed(() => {
  const counts = new Map<string, number>();
  for (const s of sessionsSignal.value) {
    const m = s.model.replace('models/', '');
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
});

// 计算是否处于非默认筛选状态
export const isFilterActiveSignal = computed(() => {
  return (
    searchKeywordSignal.value.trim() !== '' ||
    selectedModelSignal.value !== 'all' ||
    depthFilterSignal.value !== 'all' ||
    sortBySignal.value !== 'modified'
  );
});

// 核心多维复合过滤计算管道 (响应式原子派生)
export const filteredSessionsSignal = computed(() => {
  const term = searchKeywordSignal.value.trim().toLowerCase();
  // 当开启 FTS 全文搜索且命中结果集时，直接接入 FTS 倒排结果
  const list =
    term.length >= 2 && ftsResultsSignal.value !== null
      ? ftsResultsSignal.value
      : sessionsSignal.value;

  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const sort = sortBySignal.value;

  return list
    .filter((s) => {
      // 1. 模型筛选
      if (model !== 'all') {
        const rawModel = s.model.replace('models/', '');
        if (rawModel !== model) return false;
      }

      // 2. 轮次深度与摩擦力筛选
      if (depth === 'single' && s.turn_count !== 1) return false;
      if (depth === 'deep' && s.turn_count < 5) return false;
      if (depth === 'branch' && !s.has_branching) return false;

      // 3. 非 FTS 检索状态下的首轮轻量模糊过滤
      if (term && ftsResultsSignal.value === null) {
        const matchName = s.name.toLowerCase().includes(term);
        const matchPrompt = (s.first_prompt || '').toLowerCase().includes(term);
        const matchModel = s.model.toLowerCase().includes(term);
        if (!matchName && !matchPrompt && !matchModel) return false;
      }

      return true;
    })
    .sort((a, b) => {
      // FTS 模式下默认保持 BM25 相关度排序
      if (term.length >= 2 && ftsResultsSignal.value !== null && sort === 'modified') {
        return 0;
      }
      if (sort === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
      if (sort === 'turns') {
        return b.turn_count - a.turn_count;
      }
      const timeA = a.modified_time ? new Date(a.modified_time).getTime() : 0;
      const timeB = b.modified_time ? new Date(b.modified_time).getTime() : 0;
      return timeB - timeA;
    });
});

export async function fetchSessions(range = timeRangeSignal.value) {
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/sessions?range=${range}`);
    const data = await res.json();
    sessionsSignal.value = data;
  } catch (err) {
    console.error('加载会话列表失败:', err);
  } finally {
    sessionsLoadingSignal.value = false;
  }
}

export function selectSession(session: SessionItem | null) {
  selectedSessionSignal.value = session;
}

export function toggleSidebar() {
  sidebarCollapsedSignal.value = !sidebarCollapsedSignal.value;
}

let activeSearchAbortController: AbortController | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function handleSearchInput(keyword: string) {
  searchKeywordSignal.value = keyword;
  const term = keyword.trim();

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
    activeSearchAbortController = null;
  }

  if (term.length < 2) {
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    return;
  }

  isSearchingFtsSignal.value = true;
  searchDebounceTimer = setTimeout(async () => {
    const controller = new AbortController();
    activeSearchAbortController = controller;

    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = data;
        }
      }
    } catch (err: unknown) {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('FTS 全文检索异常:', err);
      }
    } finally {
      if (activeSearchAbortController === controller) {
        isSearchingFtsSignal.value = false;
        activeSearchAbortController = null;
      }
    }
  }, 300);
}

export function resetFilters() {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
    activeSearchAbortController = null;
  }
  searchKeywordSignal.value = '';
  ftsResultsSignal.value = null;
  isSearchingFtsSignal.value = false;
  selectedModelSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
}
