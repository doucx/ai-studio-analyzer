这是一个非常敏锐且关键的修正。

在 Google AI Studio 的原生数据协议中，底层数据结构由平铺的 `chunkedPrompt.chunks` 组成（涵盖 User 提示、Model 回复、内联文件、思维块与分叉节点等）。此前系统采用的 `len([t for t in self.turns if not t.is_thought])` 算法将非思考 chunk 简单视为“轮次”，导致大量正常的单轮问答（由 1 个 User chunk + 1 个 Model chunk 构成，计算值为 2）无法命中“快问 (1轮)”过滤，同时也造成了轮次语义失真。

将指标与检索口径直接下沉到客观、无歧义的 **Chunk（数据块）** 数量，不仅在工程实现上消除了状态机推导的边缘缺陷，还能在检索层支持按块数范围与语法（如 `chunk:2`、`c:>5`）进行精确筛选。

我将生成一个计划来实施此项重构。

## [WIP] fix(metrics): 将轮次统计重构为按 Chunk 数量度量与检索

### 错误分析

1. **轮次语义歧义与计算缺陷**: 原 `PromptSession.turn_count` 属性使用 `len([t for t in self.turns if not t.is_thought])` 计算轮次。对于标准的一次性问答（1 个用户输入块 + 1 个模型回复块），计算出的 `turn_count` 为 2，导致前端单轮筛选器（`s.turn_count === 1`）无法正确匹配绝大多数轻量快问会话。
2. **多模态与多 Chunk 场景失真**: 当用户同时附带文本与附件时会产生多个 User Chunk，模型分片流式输出或分支重试也会追加 Chunk，硬编码的“排除思考块计为轮次”无法反映真实的人机心智交互形态。
3. **检索维度受限**: 会话列表与过滤管道此前仅支持静态的枚举过滤，缺乏针对特定 Chunk 数量或区间的检索能力。

### 用户需求

1. 废除不准确的“多少轮”概念，全面转为按会话包含的 **Chunk 数量** 进行度量。
2. 在前端支持按 Chunk 数量进行检索（包括输入语法如 `chunk:2`、`c:>5` 以及分段区间胶囊切换）。
3. 同步修正卡片、详情面板与排序中的“轮次”文案，统一以 `Chunks` 块数呈现。

### 评论

以 Google AI Studio 原生数据块（Chunk）作为基本统计单位是极为合理且符合数据本质的决策。它完全消除了复杂状态推导的不可预测性，使过滤和排序逻辑变得清爽、健壮且易于索引。

### 目标

1. **后端模型重构**: 在 `models.py` 中将核心指标定义为 `chunk_count`（即 `len(self.turns)`），并保持 `turn_count` 兼容别名。
2. **接口字段对齐**: 在 `/api/sessions` 与 `/api/sessions/{file_id}` 中输出 `chunk_count` 字段。
3. **前端状态管道强化**: 在 `session.ts` 中增强过滤逻辑，支持在搜索框内直接解析 `chunk:N`、`chunks:>N`、`c:<=N` 语法，并更新胶囊分段逻辑（`1~2 Chunks`、`3~6 Chunks`、`≥7 Chunks`）。
4. **UI 视觉规范更新**: 在 `VirtualSessionList.tsx` 和 `SessionDetailPanel.tsx` 中将相关文案及排序改为 Chunk 数量展示。

### 基本原理

1. **数据一致性保持**: 由于既有数据库 `session_index` 中的 `turn_count` 字段在重建索引时直接写入 `s.turn_count`，通过让 `s.turn_count` 和 `s.chunk_count` 均返回 `len(self.turns)`，现有数据库结构与 API 既能实现平滑无缝过渡，又不需要重命名 SQLite 底层字段。
2. **复合语法解析**: 在前端计算属性 `filteredSessionsSignal` 中加入轻量正则，动态提取输入词中的 Chunk 条件，分离出常规文本搜索词，实现“无感知”的强大搜索体验。

### 标签

#intent/fix #flow/ready #priority/high #comp/runtime #comp/cli #comp/interfaces #concept/parser #concept/ui #scope/ux #scope/dx #ai/instruct #task/domain/metrics #task/object/chunk-counter #task/action/refactor #task/state/begin

---

### Script

#### Acts 1: 更新后端数据模型与 API 输出中的 Chunk 计数

~~~~~act
patch_file
src/analyzer/models.py
~~~~~
~~~~~python.old
    @property
    def turn_count(self) -> int:
        """对话轮次总数 (排除纯思考块)"""
        return len([t for t in self.turns if not t.is_thought])
~~~~~
~~~~~python.new
    @property
    def chunk_count(self) -> int:
        """会话包含的 Chunk (数据块) 总数"""
        return len(self.turns)

    @property
    def turn_count(self) -> int:
        """为向后兼容保留，直接返回 Chunk 总数"""
        return self.chunk_count
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
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
~~~~~
~~~~~python.new
    return [
        {
            "file_id": idx["file_id"],
            "name": idx["name"],
            "model": idx["model"],
            "turn_count": idx["turn_count"],
            "chunk_count": idx["turn_count"],
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
~~~~~

~~~~~act
patch_file
src/server/api.py
~~~~~
~~~~~python.old
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "total_tokens": target.total_tokens,
~~~~~
~~~~~python.new
        "duration_human": target.duration_human,
        "duration_seconds": target.duration_seconds,
        "turn_count": target.turn_count,
        "chunk_count": target.chunk_count,
        "total_tokens": target.total_tokens,
~~~~~

#### Acts 2: 更新前端类型定义与状态管理支持 Chunk 语法检索与过滤

~~~~~act
patch_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript.old
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
~~~~~typescript.new
export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  chunk_count?: number;
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

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript.old
export type DepthFilter = 'all' | 'single' | 'deep' | 'branch';
export type SortOption = 'modified' | 'tokens' | 'turns';

// 基础源数据状态
~~~~~
~~~~~typescript.new
export type DepthFilter = 'all' | 'single' | 'few' | 'many' | 'branch';
export type SortOption = 'modified' | 'tokens' | 'chunks';

// 基础源数据状态
~~~~~

~~~~~act
patch_file
frontend/src/state/session.ts
~~~~~
~~~~~typescript.old
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
~~~~~typescript.new
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
      // FTS 模式下默认保持 BM25 相关度排序
      if (cleanTerm.length >= 2 && ftsResultsSignal.value !== null && sort === 'modified') {
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
~~~~~

#### Acts 3: 更新前端会话列表与详情面板的 Chunk 视觉呈现

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
const DEPTH_OPTIONS: { key: DepthFilter; label: string; tip: string }[] = [
  { key: 'all', label: '全部', tip: '全量轮次' },
  { key: 'single', label: '快问 (1轮)', tip: '仅 1 轮轻量交互' },
  { key: 'deep', label: '攻坚 (≥5轮)', tip: '5 轮以上深度攻坚' },
  { key: 'branch', label: '分叉', tip: '发生过分支或编辑重试' },
];
~~~~~
~~~~~typescript.new
const DEPTH_OPTIONS: { key: DepthFilter; label: string; tip: string }[] = [
  { key: 'all', label: '全部', tip: '全量会话' },
  { key: 'single', label: '≤2 Chunks', tip: '轻量快速问答 (1~2 个数据块)' },
  { key: 'few', label: '3~6 Chunks', tip: '标准交互推进 (3~6 个数据块)' },
  { key: 'many', label: '≥7 Chunks', tip: '长线深度交互 (≥7 个数据块)' },
  { key: 'branch', label: '分叉', tip: '发生过分支或编辑重试' },
];
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="turns">轮次深度</option>
          </select>
        </div>

        {/* 第二行：FTS 全文检索输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="全文检索会话正文、思考链、代码..."
            value={currentKeyword}
~~~~~
~~~~~typescript.new
          <select
            value={currentSort}
            onChange={(e) => {
              sortBySignal.value = (e.target as HTMLSelectElement).value as SortOption;
            }}
            className="bg-zinc-950 border border-zinc-700 text-zinc-300 text-[11px] rounded px-1.5 py-0.5 outline-none focus:border-indigo-500"
          >
            <option value="modified">最近修改</option>
            <option value="tokens">Token 能耗</option>
            <option value="chunks">Chunk 数量</option>
          </select>
        </div>

        {/* 第二行：FTS 全文检索输入 */}
        <div className="relative">
          <input
            type="text"
            placeholder="全文检索，或输入 chunk:2、c:>5 按块搜索..."
            value={currentKeyword}
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
        {/* 第四行：轮次深度与摩擦力胶囊切换 */}
        <div className="grid grid-cols-4 gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
          {DEPTH_OPTIONS.map(({ key, label, tip }) => (
~~~~~
~~~~~typescript.new
        {/* 第四行：Chunk 数量梯队与摩擦力胶囊切换 */}
        <div className="grid grid-cols-5 gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
          {DEPTH_OPTIONS.map(({ key, label, tip }) => (
~~~~~

~~~~~act
patch_file
frontend/src/components/VirtualSessionList.tsx
~~~~~
~~~~~typescript.old
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono w-full">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[130px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.turn_count} 轮
                      </span>
                    </div>
~~~~~
~~~~~typescript.new
                    <div className="flex items-center justify-between text-[10px] text-zinc-500 font-mono w-full">
                      <span className="bg-zinc-800/80 px-1 py-0.2 rounded text-zinc-400 max-w-[130px] truncate">
                        {s.model.replace('models/', '')}
                      </span>
                      <span>
                        {s.total_tokens.toLocaleString()} tok · {s.chunk_count ?? s.turn_count} chunks
                      </span>
                    </div>
~~~~~

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">有效交互轮次</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {session.turn_count} 轮
            </div>
            <div className="text-[10px] text-zinc-500">
              {session.turn_count >= 5 ? '深度多轮' : '轻量快问'}
            </div>
          </div>
~~~~~
~~~~~typescript.new
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">交互 Chunks 总数</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {detail?.turns?.length ?? session.chunk_count ?? session.turn_count} 块
            </div>
            <div className="text-[10px] text-zinc-500">
              {(detail?.turns?.length ?? session.chunk_count ?? session.turn_count) >= 7 ? '深度攻坚' : '轻量快问'}
            </div>
          </div>
~~~~~

### 下一步建议

1. **重建本地索引**: 修改已在代码层将 `turn_count` 和 `chunk_count` 映射为真实 Chunk 总数。建议运行 `python reindex_cli.py` 刷新本地 SQLite `session_index` 表，使数据库内的旧数据全部更新为真实的 Chunk 数量。
2. **前端校验与测试**: 运行 `npm run check` 校验 Preact 前端代码的类型与代码风格。
3. **验证检索指令**: 启动前端服务，尝试在搜索框中键入 `c:1`、`c:2` 或 `chunk:>6`，测试动态语法解析与胶囊筛选器是否如预期精准联动。
