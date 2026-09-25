已定位到该严重异常的根本原因。这是一个由**后端 FastAPI 路由贪婪匹配遮蔽**与**前端响应式数据类型缺乏防御**共同引发的连锁故障：

1. **后端路由劫持与遮蔽（核心元凶）**：在 `src/server/api.py` 中，`@router.get("/sessions/{file_id}")` 定义在 `@router.get("/sessions/search")` **之前**。在 FastAPI/Starlette 的路由解析中，`{file_id}` 是贪婪匹配，它将 `/api/sessions/search` 的 `"search"` 当作了 `file_id`，进而触发了 `get_session_detail(file_id="search")`。
2. **HTTP 状态码与响应体语义失真**：后端未找到 `"search"` 时直接返回了 `{"error": "未找到指定的会话记录"}`，且状态码为 **HTTP 200 OK**。前端 `res.ok` 为 `true`，将这个字典对象赋值给了 `ftsResultsSignal.value`。
3. **前端缺少类型防御导致运行时崩溃**：前端 `session.ts` 假定 `ftsResultsSignal.value` 一定是数组，直接执行 `list.filter(...)`。当读取到字典对象时抛出 `TypeError: list.filter is not a function`，未捕获异常导致 Preact 的 Signal 响应式依赖图崩溃冻结，后续任何点击与事件更新全部失效。
4. **会话详情匹配范围缺失**：`SessionsRoute.tsx` 中仅在本地初始的 `sessionsSignal` 中查找 `selectedId`，而 FTS 倒排索引检索出的会话可能超出当前时间切片，导致找不到会话实体（为 `null`），右侧面板无法正常跳转渲染。

我们将对后端路由顺序、异常处理，以及前端状态防御、会话匹配逻辑进行完整修复。

## [WIP] fix: 修复后端搜索路由冲突及前端 FTS 结果类型安全

### 错误分析

1. **路由定义顺序倒置**：FastAPI 会优先匹配先声明的路由。`@router.get("/sessions/{file_id}")` 优先捕获了 `/api/sessions/search` 请求，并返回了 JSON 格式的字典错误信息 `{ error: ... }`，其 HTTP 状态码为 200。
2. **Signal 响应式图污染与崩溃**：前端 `handleSearchInput` 收到该 200 响应后直接解析并存入 `ftsResultsSignal.value`。在计算派生属性 `filteredSessionsSignal` 时，`list` 为对象而非数组，调用 `.filter` 触发 `TypeError: list.filter is not a function`。该未捕获异常破坏了 Preact 的组件重绘管道，导致后续即便清空搜索框也无法再响应点击跳转。
3. **单向列表查找盲区**：`SessionsRoute` 仅在 `sessionsSignal` 中检索 `selectedId`。FTS 检索出来的历史跨度会话不在当前列表时，`currentSession` 为 `null`，右侧退回到空面板状态。

### 用户需求

1. 修复在搜索内容时点击会话出现的 `TypeError: list.filter is not a function` 报错。
2. 确保在搜索结果或常规列表中点击任意会话均能正确跳转并渲染详情。
3. 彻底消除异常后界面事件响应冻结、清除搜索仍无法跳转的问题。

### 评论

这是一个非常隐蔽但破坏力极大的前后端契约与路由声明顺序问题。修复不仅需要调整后端路由优先级和 404 状态码规范，前端也必须坚决奉行防御性编程（Defensive Programming），永远不无条件假设远端响应的数据形态。

### 目标

1. 将后端 `/api/sessions/search` 路由移至动态参数路由 `/api/sessions/{file_id}` 之前，并将不存在的资源统一为标准的 `HTTPException(status_code=404)`。
2. 在前端 `session.ts` 中对 `ftsResultsSignal`、`sessionsSignal` 及 `filteredSessionsSignal` 增加 `Array.isArray` 防御，确保哪怕出现网络错误或非数组响应也绝不抛出运行时异常。
3. 优化 `SessionsRoute.tsx` 的会话匹配通道，支持跨 FTS 结果集定位并在缺失时提供占位 fallback，结合 `key={currentSession.file_id}` 实现平滑加载。

### 基本原理

1. 静态子路径路由（如 `/sessions/search`）必须严格声明在通配路径参数路由（如 `/sessions/{file_id}`）之前。
2. 业务状态流转中对外部异步 I/O 数据引入断言守卫 `Array.isArray(rawList) ? rawList : []`，切断异常在响应式计算图中的传播链路。
3. 多级寻找会话：全量列表 -> 过滤与搜索结果集 -> 异步占位对象，保证单条详情面板总能依据 URL 中的 `:id` 发起独立查询并正确展示。

### 标签

#intent/fix #flow/ready #priority/critical #comp/runtime #comp/ui #concept/executor #concept/ui #scope/core #scope/ux #ai/refine #task/domain/ui #task/object/search-routing-and-state #task/action/bug-fix #task/state/continue #task/status/active

---

### Script

#### Acts 1: 调整后端 `src/server/api.py` 路由声明顺序与 404 语义

我们将 `/api/sessions/search` 路由前置到 `/api/sessions/{file_id}` 之上，防止路径参数贪婪匹配拦截；并将 404 场景改为标准的 `HTTPException`。

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
~~~~~
~~~~~python
from typing import Optional, List, Set
from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python
@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
            "duration_seconds": idx["duration_seconds"],
            "has_branching": bool(idx["has_branching"]),
            "branch_count": idx["branch_count"],
            "first_prompt": idx["first_prompt"] or "",
            "modified_time": idx["modified_time"],
            "created_time": idx["created_time"],
        }
        for idx in indices
    ]


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """
    按需从 file_cache 仅读取并解析单个会话的详细对话轮次（耗时 <1ms）
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        return {"error": "未找到指定的会话记录"}

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        return {"error": "解析会话数据失败"}

    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat()
        if target.created_time
        else None,
        "modified_time": target.modified_time.isoformat()
        if target.modified_time
        else None,
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "total_tokens": target.total_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
        "has_branching": target.has_branching,
        "branch_count": target.branch_count,
        "system_instruction": target.system_instruction,
        "turns": [
            {
                "role": t.role,
                "text": t.text,
                "token_count": t.token_count,
                "is_thought": t.is_thought,
                "payload_type": t.payload_type,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                "is_edited": t.is_edited,
                "extra_metadata": t.extra_metadata,
            }
            for t in target.turns
        ],
    }


@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 极速重建 session_index 及 session_fts"""
    # 1. 一次性获取所有 file_id 并立即释放读锁，保证后续 WAL 可被截断
    file_ids = []
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM file_cache;")
        file_ids = [row["file_id"] for row in cursor.fetchall()]

    # 2. 清空旧索引表与 FTS 虚表，避免循环中触发单条全表扫描与巨量 DELETE 操作
    cache.clear_indices()

    count = 0
    for file_id in file_ids:
        raw_data = cache.get(file_id)
        if not raw_data:
            continue

        file_meta = {
            "id": file_id,
            "modifiedTime": raw_data.get("modifiedTime"),
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1

            # 3. 每处理 500 条主动触发一次 Checkpoint，平抑 WAL 体积
            if count % 500 == 0:
                try:
                    cache.checkpoint(truncate=False)
                except Exception:
                    pass

    # 4. 彻底合并 WAL 并进行磁盘空间整理
    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except Exception as exc:
        print(f"⚠️ Reindex Checkpoint/Vacuum 异常: {exc}")

    return {"status": "success", "reindexed_count": count}


@router.get("/sessions/search")
def search_sessions(q: str, limit: int = 50, offset: int = 0):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (返回带高亮 Snippet)"""
    return cache.search_fts(query=q, limit=limit, offset=offset)
~~~~~
~~~~~python
@router.get("/sessions")
def list_sessions(range: str = "all", limit: Optional[int] = None):
    """
    基于 session_index 极速返回会话列表，供前端 5000+ 虚拟滚动使用（耗时 <15ms）。
    """
    range_start = _get_range_start_iso(range)
    indices = cache.query_indices(range_start_iso=range_start, limit=limit)
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "total_tokens": idx["total_tokens"],
            "thought_tokens": idx["thought_tokens"],
            "duration_human": idx["duration_human"],
            "duration_seconds": idx["duration_seconds"],
            "has_branching": bool(idx["has_branching"]),
            "branch_count": idx["branch_count"],
            "first_prompt": idx["first_prompt"] or "",
            "modified_time": idx["modified_time"],
            "created_time": idx["created_time"],
        }
        for idx in indices
    ]


@router.get("/sessions/search")
def search_sessions(q: str, limit: int = 50, offset: int = 0):
    """基于 SQLite FTS5 全文索引的高性能深度检索接口 (声明于 /sessions/{file_id} 前避免被拦截)"""
    return cache.search_fts(query=q, limit=limit, offset=offset)


@router.get("/sessions/{file_id}")
def get_session_detail(file_id: str):
    """
    按需从 file_cache 仅读取并解析单个会话的详细对话轮次（耗时 <1ms）
    """
    raw_data = cache.get(file_id)
    if not raw_data:
        raise HTTPException(status_code=404, detail="未找到指定的会话记录")

    file_meta = {"id": file_id, "name": raw_data.get("name", "Untitled")}
    target = parse_prompt_json(file_meta, raw_data)
    if not target:
        raise HTTPException(status_code=500, detail="解析会话数据失败")

    return {
        "file_id": target.file_id,
        "name": target.name,
        "model": target.model,
        "created_time": target.created_time.isoformat()
        if target.created_time
        else None,
        "modified_time": target.modified_time.isoformat()
        if target.modified_time
        else None,
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "total_tokens": target.total_tokens,
        "thought_tokens": target.thought_tokens,
        "total_user_chars": target.total_user_chars,
        "has_branching": target.has_branching,
        "branch_count": target.branch_count,
        "system_instruction": target.system_instruction,
        "turns": [
            {
                "role": t.role,
                "text": t.text,
                "token_count": t.token_count,
                "is_thought": t.is_thought,
                "payload_type": t.payload_type,
                "timestamp": t.timestamp.isoformat() if t.timestamp else None,
                "is_edited": t.is_edited,
                "extra_metadata": t.extra_metadata,
            }
            for t in target.turns
        ],
    }


@router.post("/reindex")
def reindex_cache():
    """基于本地 SQLite file_cache 极速重建 session_index 及 session_fts"""
    # 1. 一次性获取所有 file_id 并立即释放读锁，保证后续 WAL 可被截断
    file_ids = []
    with cache._get_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT file_id FROM file_cache;")
        file_ids = [row["file_id"] for row in cursor.fetchall()]

    # 2. 清空旧索引表与 FTS 虚表，避免循环中触发单条全表扫描与巨量 DELETE 操作
    cache.clear_indices()

    count = 0
    for file_id in file_ids:
        raw_data = cache.get(file_id)
        if not raw_data:
            continue

        file_meta = {
            "id": file_id,
            "modifiedTime": raw_data.get("modifiedTime"),
            "name": raw_data.get("name", "Untitled"),
        }
        session = parse_prompt_json(file_meta, raw_data)
        if session:
            cache.upsert_session_index(session)
            cache.upsert_session_fts(session)
            count += 1

            # 3. 每处理 500 条主动触发一次 Checkpoint，平抑 WAL 体积
            if count % 500 == 0:
                try:
                    cache.checkpoint(truncate=False)
                except Exception:
                    pass

    # 4. 彻底合并 WAL 并进行磁盘空间整理
    try:
        cache.checkpoint(truncate=True)
        cache.vacuum()
    except Exception as exc:
        print(f"⚠️ Reindex Checkpoint/Vacuum 异常: {exc}")

    return {"status": "success", "reindexed_count": count}
~~~~~

#### Acts 2: 在 `frontend/src/state/session.ts` 中增强数据类型防御

针对 `sessionsSignal`、`ftsResultsSignal` 以及 `filteredSessionsSignal` 计算管道加入 `Array.isArray` 守卫，避免任何非数组响应破坏整个 Signal 图。

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
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
~~~~~
~~~~~typescript
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
  const term = searchKeywordSignal.value.trim().toLowerCase();
  // 当开启 FTS 全文搜索且命中结果集时，直接接入 FTS 倒排结果
  const rawList =
    term.length >= 2 && ftsResultsSignal.value !== null
      ? ftsResultsSignal.value
      : sessionsSignal.value;

  const list = Array.isArray(rawList) ? rawList : [];

  const model = selectedModelSignal.value;
  const depth = depthFilterSignal.value;
  const sort = sortBySignal.value;

  return list
    .filter((s) => {
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
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
~~~~~
~~~~~typescript
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

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = data;
        }
      }
~~~~~
~~~~~typescript
      const res = await fetch(`/api/sessions/search?q=${encodeURIComponent(term)}&limit=100`, {
        signal: controller.signal,
      });
      if (res.ok) {
        const data = await res.json();
        if (searchKeywordSignal.value.trim() === term) {
          ftsResultsSignal.value = Array.isArray(data) ? data : [];
        }
      }
~~~~~

#### Acts 3: 优化 `SessionsRoute.tsx` 会话选取查找通道与组件实例隔离

支持在常规列表与 FTS 过滤结果集中同时定位会话实体，并在缺失时提供基础占位，同时添加 `key` 以确保各会话面板生命周期与状态完全独立。

~~~~~act
patch_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import { sessionsLoadingSignal, sessionsSignal, sidebarCollapsedSignal } from '../state/session';
import type { SessionItem } from '../types/metrics';

export function SessionsRoute() {
  const { params } = useRoute();
  const { route } = useLocation();

  const sessions = sessionsSignal.value;
  const isLoading = sessionsLoadingSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const selectedId = params.id || null;

  // 根据 URL 的 :id 参数匹配当前会话实体
  const currentSession = useMemo<SessionItem | null>(() => {
    if (!selectedId || sessions.length === 0) return null;
    return sessions.find((s) => s.file_id === selectedId) || null;
  }, [selectedId, sessions]);
~~~~~
~~~~~typescript
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import {
  filteredSessionsSignal,
  sessionsLoadingSignal,
  sessionsSignal,
  sidebarCollapsedSignal,
} from '../state/session';
import type { SessionItem } from '../types/metrics';

export function SessionsRoute() {
  const { params } = useRoute();
  const { route } = useLocation();

  const sessions = sessionsSignal.value;
  const isLoading = sessionsLoadingSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const selectedId = params.id || null;

  // 根据 URL 的 :id 参数跨全量与 FTS 倒排结果匹配当前会话实体
  const currentSession = useMemo<SessionItem | null>(() => {
    if (!selectedId) return null;
    // 1. 优先在当前加载的 sessions 中匹配
    const foundInSessions = sessions.find((s) => s.file_id === selectedId);
    if (foundInSessions) return foundInSessions;

    // 2. 其次在当前过滤或 FTS 全文搜索命中的结果集中匹配
    const foundInFiltered = filteredSessionsSignal.value.find((s) => s.file_id === selectedId);
    if (foundInFiltered) return foundInFiltered;

    // 3. 若列表未预加载该项（如外部直连），构造最小上下文驱动详情面板完成异步读取
    return {
      file_id: selectedId,
      name: '加载会话中...',
      model: 'unknown',
      turn_count: 0,
      total_tokens: 0,
      thought_tokens: 0,
      duration_human: '',
      duration_seconds: 0,
      has_branching: false,
      branch_count: 0,
      first_prompt: '',
      modified_time: null,
      created_time: null,
    };
  }, [selectedId, sessions]);
~~~~~

~~~~~act
patch_file
frontend/src/routes/SessionsRoute.tsx
~~~~~
~~~~~typescript
        ) : currentSession ? (
          <SessionDetailPanel session={currentSession} onClose={handleCloseDetail} />
        ) : (
~~~~~
~~~~~typescript
        ) : currentSession ? (
          <SessionDetailPanel
            key={currentSession.file_id}
            session={currentSession}
            onClose={handleCloseDetail}
          />
        ) : (
~~~~~

### 下一步建议

1. **类型与格式检查**：在 `frontend` 目录下执行 `npm run check`，确认前端代码检查与 TypeScript 类型检查全部通过。
2. **端到端验证**：
   - 重启后端服务 `python main.py`（使路由声明顺序更新生效）；
   - 在前端搜索框中输入任意关键词（如中文关键词或特定代码片段），观察是否能正确高亮展示并返回搜索结果；
   - 点击搜索结果中的任意会话，验证右侧面板是否即时跳转并展示完整对话轮次，且控制台零报错；
   - 清除搜索框，测试切换其他会话是否顺畅无阻。
