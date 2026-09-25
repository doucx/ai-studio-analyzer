我现在为你实施 **SQLite FTS5 全文检索方案**。通过在 SQLite 中建立基于 `trigram` 分词器的 FTS5 虚表，将对话全轮次（包含用户提问、模型回复与思考链）建立倒排索引，并打通前后端联动与高亮摘要呈现。

## [WIP] feat(fts): 引入 SQLite FTS5 全文检索引擎与前后端深度搜索

### 用户需求
在 SQLite 本地缓存中引入全文检索（FTS5），突破前端纯内存只能针对几千条首轮 Prompt 进行过滤的瓶颈，实现对数万条对话正文、思考链及历史轮次的长文本深度检索与高亮定位。

### 评论
这是系统处理高密度长上下文的核心能力演进。采用 SQLite 原生内置的 `trigram` 分词器无需任何第三方 C 扩展与重量级检索引擎，在保证零依赖的前提下能够以毫秒级响应中文、英文和代码片段的子串检索与 BM25 相关度排序。

### 目标
1. **数据库层**：在 `cache.py` 中初始化 `session_fts` (FTS5 + Trigram) 虚表，实现 `upsert_session_fts` 与带有 `snippet` 高亮片段的 `search_fts` 检索方法。
2. **增量层与重建**：在 `sync.py` 增量拉取和 `api.py` 的 `/reindex` 接口中挂载全文索引写入，使历史与新增会话均具备全文检索能力。
3. **API 服务层**：在 `api.py` 中新增 `GET /api/sessions/search` 接口，支持毫秒级全文检索与分页。
4. **前端检索流**：在 `session.ts` 与 `VirtualSessionList.tsx` 中增加防抖全文检索流，支持高亮展示命中轮次及 Snippet 预览。

### 基本原理
1. 利用 SQLite 3.34+ 内置的 `trigram` 分词器，对中文字符序列和编程语言符号天然友好，无需维护分词词典。
2. 使用 `snippet(session_fts, -1, '<mark ...>', '</mark>', '...', 20)` 自动挑选最相关的文本列生成上下文切片。
3. 前端当搜索关键字长度大于等于 2 字符时，自动触发 250ms 防抖请求后端 FTS 接口，无搜索词时回退到本地高频索引流，兼顾性能与全量深度。

### 标签
#intent/build #flow/ready #priority/high #comp/engine #comp/runtime #comp/cli #concept/state #concept/ui #scope/core #scope/ux #ai/instruct #task/domain/storage #task/object/fts5-fulltext-search #task/action/integration #task/state/begin #task/status/active

---

### Script

#### Acts 1: 扩展 `cache.py` 表结构与全文检索方法

在 SQLite 缓存器中创建 `session_fts` 虚表，并添加文本物化写入与全文检索方法。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_date 
                ON session_index(date);
            """)
            conn.commit()
~~~~~
~~~~~python
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sidx_date 
                ON session_index(date);
            """)
            # 全文检索虚表：采用 trigram 分词器支持中文、英文及代码子串匹配
            cursor.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS session_fts USING fts5(
                    file_id UNINDEXED,
                    title,
                    system_instruction,
                    content,
                    tokenize = 'trigram'
                );
            """)
            conn.commit()
~~~~~

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            return [dict(r) for r in rows]


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
~~~~~
~~~~~python
        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(sql, params)
            rows = cursor.fetchall()
            return [dict(r) for r in rows]

    def upsert_session_fts(self, s: Any):
        """将单个会话的全部对话正文物化写入 FTS5 虚拟表"""
        turn_texts = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            if getattr(t, "is_thought", False):
                turn_texts.append(f"[Thinking #{idx}]: {t.text}")
            elif getattr(t, "payload_type", "text") == "text" and t.text:
                role_label = "User" if t.role == "user" else "Model"
                turn_texts.append(f"[{role_label} #{idx}]: {t.text}")
            elif getattr(t, "payload_type", "text") == "inlineFile":
                dname = (
                    t.extra_metadata.get("display_name", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                turn_texts.append(f"[附件: {dname}] {t.text[:500]}")
            elif getattr(t, "payload_type", "text") == "driveDocument":
                turn_texts.append(f"[挂载云盘: {t.text}]")

        full_content = "\n".join(turn_texts)
        sys_inst = getattr(s, "system_instruction", "") or ""

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM session_fts WHERE file_id = ?;", (s.file_id,))
            cursor.execute(
                """
                INSERT INTO session_fts (file_id, title, system_instruction, content)
                VALUES (?, ?, ?, ?);
                """,
                (s.file_id, s.name, sys_inst, full_content),
            )
            conn.commit()

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


# 保持别名映射，保证上层调用无缝兼容
LocalCache = SQLiteCache
~~~~~

#### Acts 2: 在同步模块 `sync.py` 中挂载 FTS 索引写入

在拉取并解析会话时，同步写入 FTS 全文索引表。

~~~~~act
patch_file
src/analyzer/sync.py
~~~~~
~~~~~python
                    # 仅解析这一个更新的文件对象，并直接写入二级索引表
                    session = parse_prompt_json(fmeta, raw_data)
                    if session:
                        cache.upsert_session_index(session)
                        updated_sessions.append(session)
~~~~~
~~~~~python
                    # 仅解析这一个更新的文件对象，并直接写入二级索引表与 FTS 索引
                    session = parse_prompt_json(fmeta, raw_data)
                    if session:
                        cache.upsert_session_index(session)
                        cache.upsert_session_fts(session)
                        updated_sessions.append(session)
~~~~~

#### Acts 3: 在 `api.py` 中升级 `/reindex` 并提供全文检索端点

升级 `/reindex` 接口支持存量全量 FTS 构建，并增加 `GET /api/sessions/search` 接口。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 增量重新生成并同步 session_index（耗时 <1s）"""
    count = 0
    for file_id, mtime, raw_data in cache.iter_all_data():
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            count += 1
    return {"status": "success", "reindexed_count": count}
~~~~~
~~~~~python
@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 增量重新生成并同步 session_index 及 session_fts（耗时 <2s）"""
    count = 0
    for file_id, mtime, raw_data in cache.iter_all_data():
        file_meta = {
            "id": file_id,
            "modifiedTime": mtime,
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1
    return {"status": "success", "reindexed_count": count}


@router.get("/sessions/search")
def search_sessions(q: str, limit: int = 50, offset: int = 0):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (返回带高亮 Snippet)"""
    return cache.search_fts(query=q, limit=limit, offset=offset)
~~~~~

#### Acts 4: 扩展前端类型定义 `metrics.ts`

为 `SessionItem` 补充 `snippet` 可选字段。

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~python
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
}
~~~~~
~~~~~python
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
  snippet?: string;
}
~~~~~

#### Acts 5: 在 `session.ts` 中实现防抖全文搜索状态管线

当搜索词满足条件时触发后端 FTS 全文检索，无搜索词时平滑回退到本地高性能列表。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~python
// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const selectedModelSignal = signal<string>('all');
export const depthFilterSignal = signal<DepthFilter>('all');
export const sortBySignal = signal<SortOption>('modified');

// 动态提取当前数据集中所有模型列表及其会话计数 (降序)
~~~~~
~~~~~python
// 复合筛选器状态
export const searchKeywordSignal = signal<string>('');
export const selectedModelSignal = signal<string>('all');
export const depthFilterSignal = signal<DepthFilter>('all');
export const sortBySignal = signal<SortOption>('modified');

// FTS5 全文检索专属状态
export const ftsResultsSignal = signal<SessionItem[] | null>(null);
export const isSearchingFtsSignal = signal<boolean>(false);

// 动态提取当前数据集中所有模型列表及其会话计数 (降序)
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~python
// 核心多维复合过滤计算管道 (响应式原子派生)
export const filteredSessionsSignal = computed(() => {
  const list = sessionsSignal.value;
  const term = searchKeywordSignal.value.trim().toLowerCase();
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

      // 3. 关键字模糊搜索 (标题、首轮 Prompt、模型)
      if (term) {
        const matchName = s.name.toLowerCase().includes(term);
        const matchPrompt = (s.first_prompt || '').toLowerCase().includes(term);
        const matchModel = s.model.toLowerCase().includes(term);
        if (!matchName && !matchPrompt && !matchModel) return false;
      }

      return true;
    })
    .sort((a, b) => {
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
~~~~~
~~~~~python
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
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~python
export function resetFilters() {
  searchKeywordSignal.value = '';
  selectedModelSignal.value = 'all';
  depthFilterSignal.value = 'all';
  sortBySignal.value = 'modified';
}
~~~~~
~~~~~python
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

#### Acts 6: 更新 `VirtualSessionList.tsx` 支持高亮 Snippet 呈现

在列表卡片中展示高亮 Snippet，并在搜索栏增加搜索加载指示。

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~python
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  isFilterActiveSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
import type { SessionItem } from '../types/metrics';
~~~~~
~~~~~python
import { Loader2 } from 'lucide-preact';
import { useRef, useState } from 'preact/hooks';
import {
  type DepthFilter,
  type SortOption,
  availableModelsSignal,
  depthFilterSignal,
  filteredSessionsSignal,
  handleSearchInput,
  isFilterActiveSignal,
  isSearchingFtsSignal,
  resetFilters,
  searchKeywordSignal,
  selectedModelSignal,
  sessionsSignal,
  sortBySignal,
} from '../state/session';
import type { SessionItem } from '../types/metrics';
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~python
        {/* 第二行：关键字模糊输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="搜索会话标题、首轮 Prompt、模型..."
            value={currentKeyword}
            onInput={(e) => {
              searchKeywordSignal.value = (e.target as HTMLInputElement).value;
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {currentKeyword && (
            <button
              type="button"
              onClick={() => {
                searchKeywordSignal.value = '';
              }}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
            >
              ✕
            </button>
          )}
        </div>
~~~~~
~~~~~python
        {/* 第二行：FTS 全文检索输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="全文检索会话正文、思考链、代码..."
            value={currentKeyword}
            onInput={(e) => {
              handleSearchInput((e.target as HTMLInputElement).value);
              setScrollTop(0);
              if (containerRef.current) containerRef.current.scrollTop = 0;
            }}
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-2.5 py-1 text-xs text-zinc-200 placeholder-zinc-500 outline-none transition"
          />
          {isSearchingFtsSignal.value ? (
            <Loader2
              size={13}
              className="absolute right-2.5 top-2 text-indigo-400 animate-spin pointer-events-none"
            />
          ) : currentKeyword ? (
            <button
              type="button"
              onClick={() => {
                handleSearchInput('');
              }}
              className="absolute right-2 top-1 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
            >
              ✕
            </button>
          ) : null}
        </div>
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~python
                    <p className="text-[11px] text-zinc-400 truncate font-sans w-full">
                      {s.first_prompt || '(无首轮文本提示)'}
                    </p>
~~~~~
~~~~~python
                    {s.snippet ? (
                      <p
                        className="text-[11px] text-zinc-300 truncate font-mono w-full bg-black/20 px-1 py-0.5 rounded border border-zinc-800/40"
                        // biome-ignore lint/security/noDangerouslySetInnerHtml: 用于呈现 FTS 高亮标记 (<mark>)
                        dangerouslySetInnerHTML={{ __html: s.snippet }}
                      />
                    ) : (
                      <p className="text-[11px] text-zinc-400 truncate font-sans w-full">
                        {s.first_prompt || '(无首轮文本提示)'}
                      </p>
                    )}
~~~~~

### 下一步建议

1. **执行历史数据重建索引**：
   在终端启动服务或通过以下命令触发一次 `/api/reindex`，将已有的 SQLite 历史会话全部物化灌入 `session_fts` 虚表：
   ```bash
   curl -X POST http://127.0.0.1:8000/api/reindex
   ```
2. **运行前端格式化与类型检查**：
   ```bash
   cd frontend && npm run check
   ```
3. **验证检索体验**：
   在搜索框中尝试搜索某段长代码片段、Thinking 内部推演词或模型特定长文本回复，确认高亮片段与 BM25 排序表现。
