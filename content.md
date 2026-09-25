我已准确定位导致该卡死与雪崩问题的根因，现在为你生成修复计划。本计划将在前端检索层、会话详情加载层全面引入 `AbortController` 请求生命周期管理与竞态防护，同时优化后端 SQLite FTS5 的 `snippet` 运算范围与并发忙等待超时机制。

## [WIP] fix: 修复全文检索请求竞争挂起与 FTS5 性能阻塞问题

### 错误分析

1. **请求竞态与加载状态泄漏**：在 `frontend/src/state/session.ts` 中，`handleSearchInput` 仅在触发时 `clearTimeout`，但未中止（abort）前一个已经发出的 HTTP 请求。当用户清空搜索词时，虽然重置了 `isSearchingFtsSignal`，但随后迟迟返回的旧请求在 `finally` 块中与新状态产生闭包竞态；若旧请求仍在处理，后续请求被浏览器同域并发限制阻滞，导致 Spinner 持续显示且新搜索无法返回结果。
2. **FTS5 Trigram 与 Snippet 性能瓶颈**：在 `src/analyzer/cache.py` 中，`snippet(session_fts, -1, ...)` 对 2.68GB 数据库中的所有列（包含 90MB、10MB 级怪兽会话的长文本）进行回溯扫描，引发长时间磁盘 I/O 阻塞；缺少 SQLite `busy_timeout` 与并发限制，进而拖慢了后续的会话详情与单项检索。
3. **会话详情切换阻塞**：`SessionDetailPanel.tsx` 在用户快速切换会话时，未取消前序会话详情的 `fetch`，使大量大型 JSON 解析任务在主线程排队积压，导致前端界面冻结。
4. **布尔类型不一致影响过滤**：FTS 检索直接返回原生 SQLite 整数 `has_branching: 0/1`，导致前端部分依赖布尔判定的深度与分支过滤表现反常。

### 用户需求

彻底消除搜索输入删除后的挂死现象，确保搜索响应轻快无残留请求阻塞，使会话切换即时响应，并确保模型、轮次深度胶囊过滤在搜索状态下能够准确生效。

### 评论

这是一个典型的全栈级并发控制与大型倒排索引性能问题。随着本地数据库规模膨胀至 2.68GB 并存在极端长文本样本，前端必须具备主动中断作废请求（Request Cancellation）的能力，后端必须将全文 Snippet 探测收敛到具体正文列，双向保障高频交互的流畅度。

### 目标

1. 在 `frontend/src/state/session.ts` 中引入 `AbortController`，在搜索内容变更或清空时即时中止旧请求，重置加载状态。
2. 在 `frontend/src/components/SessionDetailPanel.tsx` 中为详情请求添加中止信号支持，快速切换会话时中断旧加载。
3. 在 `src/analyzer/cache.py` 中优化 `search_fts` 查询，限定 `snippet` 只探测正文列（列索引 3），配置 `busy_timeout`，并将 `has_branching` 统一转为标准布尔值。

### 基本原理

1. 浏览器 `fetch` API 结合 `AbortController` 可以在客户端主动断开与服务端的连接，避免响应排队积压并精确控制 `finally` 状态复位。
2. SQLite FTS5 的 `snippet` 函数若指定具体列索引（3 代表 `content`），无需遍历其它列，性能开销可降低数倍以上。
3. 对返回项数据结构做标准化清洗，确保前端状态机运算不出现类型隐式转换异常。

### 标签

#intent/fix #flow/ready #priority/high #comp/runtime #concept/executor #scope/core #ai/instruct #task/domain/search #task/object/fts-engine #task/action/bug-fix #task/state/begin #task/status/active

---

### Script

#### Acts 1: 前端检索状态机引入 AbortController 并完善重置逻辑

我们将在 `frontend/src/state/session.ts` 中管理活跃请求控制器，在防抖重置或清空内容时立即中断旧请求，彻底避免 Spinner 挂死。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript.old
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

export function handleSearchInput(keyword: string) {
  searchKeywordSignal.value = keyword;
  const term = keyword.trim();

  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer);
  }

  if (term.length < 2) {
    ftsResultsSignal.value = null;
    isSearchingFtsSignal.value = false;
    return;
  }

  isSearchingFtsSignal.value = true;
  searchDebounceTimer = setTimeout(async () => {
    try {
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`);
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = data;
        }
      }
    } catch (err) {
      console.error('FTS 全文检索异常:', err);
    } finally {
      isSearchingFtsSignal.value = false;
    }
  }, 250);
}

export function resetFilters() {
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
~~~~~

#### Acts 2: 详情加载流支持可中止信号

在 `frontend/src/components/SessionDetailPanel.tsx` 中为 `fetchSessionDetail` 传入生命周期信号，当用户快速点击切到其它会话时及时废弃旧会话加载任务。

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
  const fetchSessionDetail = useCallback(
    async (isSilent = false) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/sessions/${session.file_id}`);
        const data = await res.json();
        setDetail(data);
      } catch (err) {
        console.error('获取会话详情失败:', err);
      } finally {
        if (!isSilent) {
          setLoading(false);
        } else {
          setRefreshing(false);
        }
      }
    },
    [session.file_id],
  );

  // 初次进入或切换会话时全屏加载；增量同步完成触发 syncVersionSignal 时静默刷新
  useEffect(() => {
    const isInitialLoad = !detail || detail.file_id !== session.file_id;
    fetchSessionDetail(!isInitialLoad);
  }, [session.file_id, syncVersionSignal.value, fetchSessionDetail]);
~~~~~
~~~~~typescript.new
  const fetchSessionDetail = useCallback(
    async (isSilent = false, signal?: AbortSignal) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/sessions/${session.file_id}`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        setDetail(data);
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('获取会话详情失败:', err);
        }
      } finally {
        if (!signal?.aborted) {
          if (!isSilent) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [session.file_id],
  );

  // 初次进入或切换会话时全屏加载；增量同步完成触发 syncVersionSignal 时静默刷新
  useEffect(() => {
    const controller = new AbortController();
    const isInitialLoad = !detail || detail.file_id !== session.file_id;
    fetchSessionDetail(!isInitialLoad, controller.signal);
    return () => {
      controller.abort();
    };
  }, [session.file_id, syncVersionSignal.value, fetchSessionDetail]);
~~~~~

#### Acts 3: 后端 FTS5 Snippet 列优化与 busy_timeout 保障

优化 `src/analyzer/cache.py` 中 `search_fts` 的 SQL 语句，将全局列扫描收敛至正文列，设置 3000ms 超时并统一类型转换。

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
        sql = """
            SELECT 
                f.file_id,
                bm25(session_fts) AS rank,
                snippet(session_fts, -1, '<mark class="bg-indigo-500/30 text-indigo-300 font-semibold px-0.5 rounded">', '</mark>', '...', 22) AS snippet,
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
                cursor.execute(sql, (fts_match_expr, limit, offset))
                rows = cursor.fetchall()
                return [dict(r) for r in rows]
            except sqlite3.OperationalError:
                return []
~~~~~
~~~~~python.new
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

### 下一步建议

1. **前端类型校验与构建检查**：执行 `npm --prefix frontend run check` 验证 TypeScript 类型与 Biome 规范无误。
2. **实际交互验证**：在前端快速输入并连续删除关键词，验证 Spinner 能否在删除后瞬间消失；在搜索状态下切换不同模型和轮次深度胶囊，验证筛选响应。
3. **提交更动**：确认效果良好后，可进入 `[COMMIT]` 流程将本批修复提交至版本控制。
