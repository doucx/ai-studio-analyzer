import { computed, signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { timeRangeSignal } from './metrics';

export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type SortOption = 'relevance' | 'modified' | 'tokens' | 'chunks';

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
    selectedModelSignal.value !== 'all' ||
    depthFilterSignal.value !== 'all' ||
    sortBySignal.value !== 'modified'
  );
});

// 核心多维复合过滤计算管道 (响应式原子派生)
export const filteredSessionsSignal = computed(() => {
  const fullTerm = searchKeywordSignal.value.trim().toLowerCase();

  // 提取关键词中可能携带的 Chunk 语法指令 (如: "chunk:2", "chunks:>5", "c:<=3", "c:1")
  const chunkSyntaxMatch = fullTerm.match(/(?:chunks?|c)\s*(:|>=|<=|>|<|=)\s*(\d+)/i);
  let targetChunkOp: string | null = null;
  let targetChunkNum: number | null = null;
  let cleanTerm = fullTerm;

  if (chunkSyntaxMatch) {
    targetChunkOp = chunkSyntaxMatch[1];
    targetChunkNum = Number.parseInt(chunkSyntaxMatch[2], 10);
    cleanTerm = cleanTerm.replace(chunkSyntaxMatch[0], '').trim();
  }

  // 当开启 FTS 全文搜索且命中结果集时，直接接入 FTS 倒排结果
  const rawList =
    cleanTerm.length >= 2 && ftsResultsSignal.value !== null
      ? ftsResultsSignal.value
      : sessionsSignal.value;

  const list = Array.isArray(rawList) ? rawList : [];

  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const sort = sortBySignal.value;

  return list
    .filter((s) => {
      const chunks = s.chunk_count ?? s.turn_count;

      // 1. Chunk 显式语法过滤
      if (targetChunkOp && targetChunkNum !== null) {
        if (targetChunkOp === ':' || targetChunkOp === '=') {
          if (chunks !== targetChunkNum) return false;
        } else if (targetChunkOp === '>') {
          if (chunks <= targetChunkNum) return false;
        } else if (targetChunkOp === '>=') {
          if (chunks < targetChunkNum) return false;
        } else if (targetChunkOp === '<') {
          if (chunks >= targetChunkNum) return false;
        } else if (targetChunkOp === '<=') {
          if (chunks > targetChunkNum) return false;
        }
      }

      // 2. 模型筛选
      if (model !== 'all') {
        const rawModel = s.model.replace('models/', '');
        if (rawModel !== model) return false;
      }

      // 3. Chunk 梯队胶囊与摩擦力筛选
      if (depth === 'single' && chunks > 2) return false;
      if (depth === 'few' && (chunks < 3 || chunks > 6)) return false;
      if (depth === 'many' && chunks < 7) return false;
      if (depth === 'branch' && !s.has_branching) return false;

      // 4. 文本模糊过滤
      if (cleanTerm && ftsResultsSignal.value === null) {
        const matchName = s.name.toLowerCase().includes(cleanTerm);
        const matchPrompt = (s.first_prompt || '').toLowerCase().includes(cleanTerm);
        const matchModel = s.model.toLowerCase().includes(cleanTerm);
        if (!matchName && !matchPrompt && !matchModel) return false;
      }

      return true;
    })
    .sort((a, b) => {
      // 保持 FTS 默认的 BM25 相关度排序
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

export async function fetchSessions(range = timeRangeSignal.value) {
  refreshFtsSearch(range);
  if (sessionsSignal.value.length === 0) {
    sessionsLoadingSignal.value = true;
  }
  try {
    const res = await fetch(`/api/sessions?range=${range}`);
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

let activeSearchAbortController: AbortController | null = null;
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

function extractCleanTerm(keyword: string): string {
  const fullTerm = keyword.trim().toLowerCase();
  const chunkSyntaxMatch = fullTerm.match(/(?:chunks?|c)\s*(:|>=|<=|>|<|=)\s*(\d+)/i);
  let cleanTerm = fullTerm;
  if (chunkSyntaxMatch) {
    cleanTerm = cleanTerm.replace(chunkSyntaxMatch[0], '').trim();
  }
  return cleanTerm;
}

export function executeFtsSearch(keyword: string, range = timeRangeSignal.value) {
  if (activeSearchAbortController) {
    activeSearchAbortController.abort();
    activeSearchAbortController = null;
  }

  const cleanTerm = extractCleanTerm(keyword);
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

  fetch(
    `/api/sessions/search?q=${encodeURIComponent(cleanTerm)}&range=${range}&limit=100`,
    {
      signal: controller.signal,
    },
  )
    .then(async (res) => {
      if (res.ok) {
        const data = await res.json();
        if (extractCleanTerm(searchKeywordSignal.value) === cleanTerm) {
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
  const currentKeyword = searchKeywordSignal.value;
  const cleanTerm = extractCleanTerm(currentKeyword);
  if (cleanTerm.length >= 2) {
    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = null;
    }
    executeFtsSearch(currentKeyword, range);
  }
}

export function handleSearchInput(keyword: string) {
  searchKeywordSignal.value = keyword;
  const cleanTerm = extractCleanTerm(keyword);

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
  ftsResultsSignal.value = null;
  isSearchingFtsSignal.value = false;
  selectedModelSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
}
