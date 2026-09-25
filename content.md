用户的定位非常准确。

当前系统在修改时间范围（如从“全部”切换为“7天”或“30天”）时，仅刷新了概览统计 (`fetchMetrics`) 与非搜索状态下的全量会话列表 (`fetchSessions`)。如果搜索框中已输入搜索词（长度 ≥2），页面依然绑定在先前的 `ftsResultsSignal` 上，且后端的 `/api/sessions/search` 接口未接收或支持 `range` 时间过滤条件，导致搜索结果不会自动重新检索，且搜索范围未能对齐所选的时间切片。

我已规划全链路修复方案：在后端使全文检索支持时间范围参数过滤，在前端实现修改时间范围时自动联动重新发起 FTS 搜索。

## [WIP] fix: 修复切换时间范围时未联动重新触发全文检索的问题

### 错误分析

该问题的产生包含两个维度的脱节：
1. **前端触发层脱节**：`handleSearchInput` 仅在用户于输入框中键入文本时触发防抖请求。当用户在顶部导航栏切换时间范围胶囊时，调用的 `handleTimeRangeChange` -> `loadAllData` 仅重新执行了 `fetchMetrics` 与 `fetchSessions`，未检测当前搜索词状态，未联动重新发起 FTS 请求。并且 `filteredSessionsSignal` 计算属性在 `ftsResultsSignal` 非空时优先消费该旧结果集，导致界面显示旧的搜索结果。
2. **后端检索层缺失时间约束**：后端的 `search_fts` 及 `/api/sessions/search` 端点未接收 `range` 参数，在执行 FTS5 查询时仅按 `session_fts MATCH ?` 过滤，未关联 `session_index` 的时间戳条件 `(s.modified_time >= ? OR s.created_time >= ?)`。即使重新发起请求，之前也会返回全生命周期的搜索结果，而非当前时间切片范围内的结果。

### 用户需求

当用户在搜索框中存在有效搜索关键词的情况下修改时间范围（7天、30天、90天、今年、全部）时，系统应自动携带最新的时间范围参数重新发起检索，确保搜索结果与时间切片精确对齐。

### 评论

这是一个关键的交互一致性与数据可用性缺陷。时间切片是工作台全局生效的上下文维度，无论是普通浏览还是关键词深搜，都应当遵循相同的时间边界约束，并保持联动响应。

### 目标

1. 后端：为 `SQLiteCache.search_fts` 增加 `range_start_iso` 参数支持，在 FTS 检索与 `session_index` 进行关联时追加时间切片过滤条件；
2. 后端：更新 `/api/sessions/search` 接口，接收 `range: str = "all"` 查询参数并将其转化为 ISO 起始时间传递给缓存层；
3. 前端：在 `session.ts` 中抽取通用的 `executeFtsSearch` 与 `refreshFtsSearch` 逻辑，在请求 URL 中追加 `range` 参数；
4. 前端：在 `fetchSessions` 调用链路中联动触发 `refreshFtsSearch`，使得时间范围变更或增量同步完成时，若搜索框有内容均能自动发起最新搜索。

### 基本原理

通过在 `fetchSessions(range)` 执行时检测当前搜索框是否包含有效关键词（提取去除 chunk 语法后的 `cleanTerm`），如果有效，则立即并行发起带最新 `range` 参数的 FTS 搜索请求，并将结果更新至 `ftsResultsSignal`。后端在执行 SQL 时，在 `JOIN session_index s` 的 `WHERE` 子句中追加 `AND (s.modified_time >= ? OR s.created_time >= ?)`，使 FTS 结果在数据库层面就被严格限制在当前时间切片内，兼顾高性能与语义一致性。

### 标签

#intent/fix #flow/ready #priority/high #comp/cli #comp/interfaces #concept/parser #scope/core #scope/ux #ai/instruct #task/domain/cli #task/object/search-range-sync #task/action/bug-fix #task/state/begin

---

### Script

#### Acts 1: 后端 SQLiteCache 支持时间范围过滤全文检索

修改 `src/analyzer/cache.py`，使 `search_fts` 支持 `range_start_iso` 参数并在 SQL 中追加时间过滤条件。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
    def search_fts(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """基于 FTS5 Trigram 与 BM25 进行全文检索，并提取上下文命中片段 (Snippet)"""
        clean_query = query.strip().replace('"', '""')
        if not clean_query:
            return []

        fts_match_expr = f'"{clean_query}"'
        # snippet 第二个参数限定为 3 (即 session_fts 的 content 列，避免遍历整表其他列产生极大 I/O)
        sql = """
            SELECT 
                f.file_id,
                bm25(session_fts) AS rank,
                snippet(session_fts, 3, '<mark class="bg-indigo-500/30 text-indigo-300 font-semibold px-0.5 rounded">', '</mark>', '...', 22) AS snippet,
                s.name,
                s.model,
                s.turn_count,
                s.total_tokens,
                s.thought_tokens,
                s.duration_human,
                s.duration_seconds,
                s.has_branching,
                s.branch_count,
                s.first_prompt,
                s.modified_time,
                s.created_time
            FROM session_fts f
            JOIN session_index s ON f.file_id = s.file_id
            WHERE session_fts MATCH ?
            ORDER BY rank
            LIMIT ? OFFSET ?;
        """
        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("PRAGMA busy_timeout = 3000;")
                cursor.execute(sql, (fts_match_expr, limit, offset))
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["has_branching"] = bool(item.get("has_branching", 0))
                    results.append(item)
                return results
            except sqlite3.OperationalError:
                return []
~~~~~
~~~~~python.new
    def search_fts(
        self,
        query: str,
        limit: int = 50,
        offset: int = 0,
        range_start_iso: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """基于 FTS5 Trigram 与 BM25 进行全文检索，并提取上下文命中片段 (Snippet)"""
        clean_query = query.strip().replace('"', '""')
        if not clean_query:
            return []

        fts_match_expr = f'"{clean_query}"'
        where_conditions = ["session_fts MATCH ?"]
        params: List[Any] = [fts_match_expr]

        if range_start_iso:
            where_conditions.append("(s.modified_time >= ? OR s.created_time >= ?)")
            params.extend([range_start_iso, range_start_iso])

        where_sql = " AND ".join(where_conditions)

        # snippet 第二个参数限定为 3 (即 session_fts 的 content 列，避免遍历整表其他列产生极大 I/O)
        sql = f"""
            SELECT 
                f.file_id,
                bm25(session_fts) AS rank,
                snippet(session_fts, 3, '<mark class="bg-indigo-500/30 text-indigo-300 font-semibold px-0.5 rounded">', '</mark>', '...', 22) AS snippet,
                s.name,
                s.model,
                s.turn_count,
                s.total_tokens,
                s.thought_tokens,
                s.duration_human,
                s.duration_seconds,
                s.has_branching,
                s.branch_count,
                s.first_prompt,
                s.modified_time,
                s.created_time
            FROM session_fts f
            JOIN session_index s ON f.file_id = s.file_id
            WHERE {where_sql}
            ORDER BY rank
            LIMIT ? OFFSET ?;
        """
        params.extend([limit, offset])

        with self._get_connection() as conn:
            cursor = conn.cursor()
            try:
                cursor.execute("PRAGMA busy_timeout = 3000;")
                cursor.execute(sql, tuple(params))
                rows = cursor.fetchall()
                results = []
                for r in rows:
                    item = dict(r)
                    item["has_branching"] = bool(item.get("has_branching", 0))
                    results.append(item)
                return results
            except sqlite3.OperationalError:
                return []
~~~~~

#### Acts 2: 后端 API 接口接收并透传 range 参数

修改 `src/server/api.py`，让 `/api/sessions/search` 接收 `range` 参数并转化为 `range_start_iso`。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
@router.get("/sessions/search")
def search_sessions(q: str, limit: int = 50, offset: int = 0):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (声明于 /sessions/{file_id} 前避免被拦截)"""
    return cache.search_fts(query=q, limit=limit, offset=offset)
~~~~~
~~~~~python.new
@router.get("/sessions/search")
def search_sessions(
    q: str, range: str = "all", limit: int = 50, offset: int = 0
):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (声明于 /sessions/{file_id} 前避免被拦截)"""
    range_start = _get_range_start_iso(range)
    return cache.search_fts(
        query=q, limit=limit, offset=offset, range_start_iso=range_start
    )
~~~~~

#### Acts 3: 前端状态联动重新发起搜索

修改 `frontend/src/state/session.ts`，实现 cleanTerm 提取、支持带 `range` 发起搜索，并在 `fetchSessions` 与时间范围变更时联动执行 `refreshFtsSearch`。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript.old
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
    if (sortBySignal.value === 'relevance') {
      sortBySignal.value = 'modified';
    }
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
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
          if (sortBySignal.value === 'modified') {
            sortBySignal.value = 'relevance';
          }
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
~~~~~
~~~~~typescript.new
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
~~~~~

#### Acts 4: 在加载会话时联动触发搜索刷新

修改 `frontend/src/state/session.ts` 中的 `fetchSessions` 函数，使其在接收到新的时间范围时立即联动 `refreshFtsSearch`。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript.old
export async function fetchSessions(range = timeRangeSignal.value) {
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
~~~~~
~~~~~typescript.new
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
~~~~~

### 下一步建议

1. **前端类型与格式检查**：可以在 `frontend` 目录运行 `npm run check` 确保 Biome linter 与 TypeScript 编译通过。
2. **端到端体验验证**：在启动状态下，在搜索框中输入特定检索词（例如某个高频项目名），然后在顶部切换时间切片（例如从“全部”切换到“7天”），观察会话列表是否即时刷新且结果数量按时间切片正确收敛。
