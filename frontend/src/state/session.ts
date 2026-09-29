import { computed, signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type DurationTierFilter = 'all' | 'flash' | 'focus' | 'deep' | 'epic';
export type SortOption = 'relevance' | 'modified' | 'tokens' | 'chunks';
export type SearchScope = 'range' | 'all';

// 基础源数据状态
export const sessionsSignal = signal<SessionItem[]>([]);
export const selectedSessionSignal = signal<SessionItem | null>(null);
export const sessionsLoadingSignal = signal<boolean>(true);
export const sidebarCollapsedSignal = signal<boolean>(false);

// 视图与检索增强状态
export const isExpandedViewSignal = signal<boolean>(true); // 全屏/灯箱大画幅会话检索长廊 (常态开启)
export const isMultiLineSearchSignal = signal<boolean>(true); // 多行搜索编辑器开关 (常态开启)
export const searchScopeSignal = signal<SearchScope>('range'); // 'range' 在时间区间内筛选, 'all' 全库穿透

// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const filterDateSignal = signal<string | null>(null); // 显式下钻/自选日期
export const selectedModelSignal = signal<string>('all');
export const selectedTierSignal = signal<DurationTierFilter>('all'); // 心智时长梯队筛选
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
    selectedTierSignal.value !== 'all' ||
    depthFilterSignal.value !== 'all' ||
    sortBySignal.value !== 'modified' ||
    searchScopeSignal.value !== 'range'
  );
});

// 核心多维复合过滤计算管道 (响应式原子派生：支持标题即时命中与 FTS 全文并集融合)
export const filteredSessionsSignal = computed(() => {
  const term = searchKeywordSignal.value.trim().toLowerCase();
  const explicitDate = filterDateSignal.value;
  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const tier = selectedTierSignal.value;
  const sort = sortBySignal.value;

  const baseList = Array.isArray(sessionsSignal.value) ? sessionsSignal.value : [];
  const isFtsActive = term.length >= 3 && ftsResultsSignal.value !== null;
  const ftsList =
    isFtsActive && Array.isArray(ftsResultsSignal.value) ? ftsResultsSignal.value : [];

  // 并集融合集合 (使用 Map 保障按 file_id 严格去重)
  const combinedMap = new Map<string, SessionItem>();

  // 1. 如果存在搜索词：优先将本地底表中标题或首轮提问命中的会话置顶存入 Map
  if (term) {
    for (const s of baseList) {
      const matchName = s.name.toLowerCase().includes(term);
      const matchPrompt = (s.first_prompt || '').toLowerCase().includes(term);
      if (matchName || matchPrompt) {
        combinedMap.set(s.file_id, s);
      }
    }
  }

  // 2. 将 FTS 全文检索返回的深度匹配结果追加并集 (若已在标题命中中，则保留并丰富 search_matches 上下文)
  if (isFtsActive) {
    for (const fs of ftsList) {
      const existing = combinedMap.get(fs.file_id);
      if (existing) {
        // 合并高亮片段元数据
        combinedMap.set(fs.file_id, {
          ...existing,
          snippet: fs.snippet || existing.snippet,
          search_matches: fs.search_matches || existing.search_matches,
        });
      } else {
        combinedMap.set(fs.file_id, fs);
      }
    }
  }

  // 3. 若未开启 FTS 且无搜索词，采用全量底表；若有搜索词则采用并集去重结果
  const rawCandidateList = term ? Array.from(combinedMap.values()) : baseList;

  return rawCandidateList
    .filter((s) => {
      const chunks = s.chunk_count ?? s.turn_count;

      // 显式下钻/自选日期过滤
      if (explicitDate) {
        const mDate = s.modified_time ? s.modified_time.slice(0, 10) : '';
        const cDate = s.created_time ? s.created_time.slice(0, 10) : '';
        if (mDate !== explicitDate && cDate !== explicitDate) return false;
      }

      // 心智时长梯队筛选
      if (tier !== 'all' && !matchDurationTier(s.duration_seconds, tier)) {
        return false;
      }

      // 模型维度筛选
      if (model !== 'all') {
        const rawModel = s.model.replace('models/', '');
        if (rawModel !== model) return false;
      }

      // Chunk 梯队胶囊与摩擦力筛选
      if (depth === 'single' && chunks > 2) return false;
      if (depth === 'few' && (chunks < 3 || chunks > 6)) return false;
      if (depth === 'many' && chunks < 7) return false;
      if (depth === 'branch' && !s.has_branching) return false;

      return true;
    })
    .sort((a, b) => {
      // 若处于相关度排序且有搜索词，标题直接命中的优先置顶
      if (term && (sort === 'relevance' || isFtsActive)) {
        const aTitleHit = a.name.toLowerCase().includes(term);
        const bTitleHit = b.name.toLowerCase().includes(term);
        if (aTitleHit && !bTitleHit) return -1;
        if (!aTitleHit && bTitleHit) return 1;
      }

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
  const isAllScope = searchScopeSignal.value === 'all';
  const effectiveRange = isAllScope ? 'all' : range;
  const effectiveStart = isAllScope ? null : start;
  const effectiveEnd = isAllScope ? null : end;

  refreshFtsSearch(effectiveRange);
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    let url = `/api/sessions?range=${effectiveRange}`;
    if (effectiveStart) url += `&start=${encodeURIComponent(effectiveStart)}`;
    if (effectiveEnd) url += `&end=${encodeURIComponent(effectiveEnd)}`;
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

export function toggleSearchScope() {
  searchScopeSignal.value = searchScopeSignal.value === 'range' ? 'all' : 'range';
  fetchSessions();
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
  tier,
  depth,
}: {
  model?: string;
  date?: string;
  tier?: DurationTierFilter;
  depth?: DepthFilter;
}) {
  resetFilters();
  if (model) selectedModelSignal.value = model;
  if (depth) depthFilterSignal.value = depth;
  if (date) filterDateSignal.value = date;
  if (tier) selectedTierSignal.value = tier;
}

export function executeFtsSearch(keyword: string, range = timeRangeSignal.value) {
  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
    activeSearchAbortController = null;
  }

  const cleanTerm = keyword.trim();
  // 严格守护：小于 3 个字符属于标题/速查范畴，不发起 FTS 请求以防抹杀本地命中
  if (cleanTerm.length < 3) {
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

  const payload = {
    q: cleanTerm,
    range,
    scope,
    limit: 100,
    start: scope === 'range' ? start : null,
    end: scope === 'range' ? end : null,
    model: model !== 'all' ? model : null,
    depth: depth !== 'all' ? depth : null,
  };

  fetch('/api/sessions/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === cleanTerm) {
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
          if (sortBySignal.value === 'modified') {
            sortBySignal.value = 'relevance';
          }
        }
      } else {
        // 请求非 200 响应时立即清空滞留结果，杜绝幽灵旧结果呈现
        if (searchKeywordSignal.value.trim() === cleanTerm) {
          ftsResultsSignal.value = [];
        }
      }
    })
    .catch((err: unknown) => {
      if ((err as Error)?.name !== 'AbortError') {
        console.error('FTS 全文检索异常:', err);
        if (searchKeywordSignal.value.trim() === cleanTerm) {
          ftsResultsSignal.value = [];
        }
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
  if (currentKeyword.length >= 3) {
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

  // 小于 3 个字符（如“扩展”、“ui”）由前端纯内存完成 0 毫秒即时标题速查
  if (cleanTerm.length < 3) {
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
  selectedTierSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
  searchScopeSignal.value = 'range';
}
