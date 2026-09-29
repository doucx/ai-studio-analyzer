import { computed, signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type SortOption = 'relevance' | 'modified' | 'tokens' | 'chunks';
export type SearchScope = 'range' | 'all';

// 基础源数据状态
export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

// 视图与检索增强状态
export const isExpandedViewSignal = signal<boolean>(true); // 全屏/灯箱大画幅会话检索长廊 (常态开启)
export const isMultiLineSearchSignal = signal<boolean>(false); // 多行搜索编辑器开关
export const searchScopeSignal = signal<SearchScope>('range'); // 'range' 在时间区间内筛选, 'all' 全库穿透

// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const filterDateSignal = signal<string | null>(null); // 显式下钻日期，不再污染 searchKeyword
export const selectedModelSignal = signal<string>('all');
export const depthFilterSignal = signal<DepthFilter>('all');
export const sortBySignal = signal<SortOption>('modified');

// FTS5 全文检索专属状态
export const ftsResultsSignal = signal<SessionItem[] | null>(null);
export const isSearchingFtsSignal = signal<boolean>(false);

// 判定时长梯队辅助函数
function matchDurationTier(durationSec: number | null | undefined, tier: string): boolean {
  if (durationSec === null || durationSec === undefined || durationSec < 10) {
    return tier === 'flash';
  }
  const minutes = durationSec / 60;
  if (tier === 'flash') return minutes < 10;
  if (tier === 'focus') return minutes >= 10 && minutes < 60;
  if (tier === 'deep') return minutes >= 60 && minutes < 360;
  if (tier === 'epic') return minutes >= 360;
  return true;
}

// 动态提取当前数据集中所有模型列表及其会话计数 (降序)
export const availableModelsSignal = computed(() => {
  const counts = new Map<string, number>();
  const list = Array.isArray(sessionsSignal.value) ? sessionsSignal.value : [];
  for (const s of list) {
    const m = s.model.replace('models/', '');
    counts.set(m, (counts.get(m) || 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
});

// 计算是否处于非默认筛选状态
export const isFilterActiveSignal = computed(() => {
  return (
    searchKeywordSignal.value.trim() !== '' ||
    filterDateSignal.value !== null ||
    selectedModelSignal.value !== 'all' ||
    depthFilterSignal.value !== 'all' ||
    sortBySignal.value !== 'modified' ||
    searchScopeSignal.value !== 'range'
  );
});

// 核心多维复合过滤计算管道 (响应式原子派生)
export const filteredSessionsSignal = computed(() => {
  const term = searchKeywordSignal.value.trim().toLowerCase();
  const explicitDate = filterDateSignal.value;

  // 当开启 FTS 全文搜索且命中结果集时，已在后端完成模型/深度下推，直接复用
  const rawList =
    term.length >= 2 && ftsResultsSignal.value !== null
      ? ftsResultsSignal.value
      : sessionsSignal.value;

  const list = Array.isArray(rawList) ? rawList : [];

  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const sort = sortBySignal.value;
  const isFtsActive = term.length >= 2 && ftsResultsSignal.value !== null;

  return list
    .filter((s) => {
      const chunks = s.chunk_count ?? s.turn_count;

      // 1. 显式下钻日期过滤
      if (explicitDate) {
        const mDate = s.modified_time ? s.modified_time.slice(0, 10) : '';
        const cDate = s.created_time ? s.created_time.slice(0, 10) : '';
        if (mDate !== explicitDate && cDate !== explicitDate) return false;
      }

      // 如果来自 FTS 结果，后端已下推 model 与 depth 过滤，无需在此再次截断
      if (!isFtsActive) {
        // 模型筛选
        if (model !== 'all') {
          const rawModel = s.model.replace('models/', '');
          if (rawModel !== model) return false;
        }

        // Chunk 梯队胶囊与摩擦力筛选
        if (depth === 'single' && chunks > 2) return false;
        if (depth === 'few' && (chunks < 3 || chunks > 6)) return false;
        if (depth === 'many' && chunks < 7) return false;
        if (depth === 'branch' && !s.has_branching) return false;

        // 本地纯文本模糊过滤 (用于 1 个字以内的快速匹配)
        if (term) {
          const matchName = s.name.toLowerCase().includes(term);
          const matchPrompt = (s.first_prompt || '').toLowerCase().includes(term);
          const matchModel = s.model.toLowerCase().includes(term);
          if (!matchName && !matchPrompt && !matchModel) return false;
        }
      }

      return true;
    })
    .sort((a, b) => {
      if (sort === 'relevance') {
        return 0;
      }
      if (sort === 'tokens') {
        return b.total_tokens - a.total_tokens;
      }
      if (sort === 'chunks' || (sort as string) === 'turns') {
        const chunksA = a.chunk_count ?? a.turn_count;
        const chunksB = b.chunk_count ?? b.turn_count;
        return chunksB - chunksA;
      }
      const timeA = a.modified_time ? new Date(a.modified_time).getTime() : 0;
      const timeB = b.modified_time ? new Date(b.modified_time).getTime() : 0;
      return timeB - timeA;
    });
});

import { customEndDateSignal, customStartDateSignal } from './metrics';

export async function fetchSessions(
  range = timeRangeSignal.value,
  start = customStartDateSignal.value,
  end = customEndDateSignal.value,
) {
  refreshFtsSearch(range);
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    let url = `/api/sessions?range=${range}`;
    if (start) url += `&start=${encodeURIComponent(start)}`;
    if (end) url += `&end=${encodeURIComponent(end)}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      sessionsSignal.value = Array.isArray(data) ? data : [];
    }
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

export function toggleExpandedView() {
  isExpandedViewSignal.value = !isExpandedViewSignal.value;
}

let activeSearchAbortController: AbortController | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function drillDownToSessions({
  model,
  date,
  depth,
}: {
  model?: string;
  date?: string;
  tier?: 'flash' | 'focus' | 'deep' | 'epic';
  depth?: DepthFilter;
}) {
  resetFilters();
  if (model) selectedModelSignal.value = model;
  if (depth) depthFilterSignal.value = depth;
  if (date) filterDateSignal.value = date;
}

export function executeFtsSearch(keyword: string, range = timeRangeSignal.value) {
  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
    activeSearchAbortController = null;
  }

  const cleanTerm = keyword.trim();
  if (cleanTerm.length < 2) {
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    if (sortBySignal.value === 'relevance') {
      sortBySignal.value = 'modified';
    }
    return;
  }

  isSearchingFtsSignal.value = true;
  const controller = new AbortController();
  activeSearchAbortController = controller;

  const start = customStartDateSignal.value;
  const end = customEndDateSignal.value;
  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const scope = searchScopeSignal.value;

  let url = `/api/sessions/search?q=${encodeURIComponent(cleanTerm)}&range=${range}&scope=${scope}&limit=100`;
  if (scope === 'range') {
    if (start) url += `&start=${encodeURIComponent(start)}`;
    if (end) url += `&end=${encodeURIComponent(end)}`;
  }
  if (model !== 'all') url += `&model=${encodeURIComponent(model)}`;
  if (depth !== 'all') url += `&depth=${encodeURIComponent(depth)}`;

  fetch(url, { signal: controller.signal })
    .then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === cleanTerm) {
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
          if (sortBySignal.value === 'modified') {
            sortBySignal.value = 'relevance';
          }
        }
      }
    })
    .catch((err: unknown) => {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('FTS 全文检索异常:', err);
      }
    })
    .finally(() => {
      if (activeSearchAbortController === controller) {
        isSearchingFtsSignal.value = false;
        activeSearchAbortController = null;
      }
    });
}

export function refreshFtsSearch(range = timeRangeSignal.value) {
  const currentKeyword = searchKeywordSignal.value.trim();
  if (currentKeyword.length >= 2) {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    executeFtsSearch(currentKeyword, range);
  }
}

export function handleSearchInput(keyword: string) {
  searchKeywordSignal.value = keyword;
  const cleanTerm = keyword.trim();

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }

  if (cleanTerm.length < 2) {
    if (activeSearchAbortController) {
      activeSearchAbortController.abort();
      activeSearchAbortController = null;
    }
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    if (sortBySignal.value === 'relevance') {
      sortBySignal.value = 'modified';
    }
    return;
  }

  isSearchingFtsSignal.value = true;
  searchDebounceTimer = setTimeout(() => {
    executeFtsSearch(keyword, timeRangeSignal.value);
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
  filterDateSignal.value = null;
  ftsResultsSignal.value = null;
  isSearchingFtsSignal.value = false;
  selectedModelSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
  searchScopeSignal.value = 'range';
}
