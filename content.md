好的，我们现在开始实施“开辟前后端空间与工程初始化”的杂活改造。

我将生成一个包含后端服务化（FastAPI、路由、启动入口及依赖声明）与前端脚手架（Vite + Preact + Preact Signals + Tailwind + Biome）落盘的完整执行计划。

## [WIP] feat: 初始化前后端物理隔离空间与工程脚手架配置

### 用户需求
落实规划中的“杂活”任务：开辟前端和后端工程空间，配置前端构建与质量工具链（`Vite` + `TypeScript` + `Preact` + `@preact/signals` + `TailwindCSS` + `Biome`），并为后端引入 `FastAPI` / `uvicorn` 提供 REST API 服务，升级 `pyproject.toml` 与入口 `main.py`。

### 评论
当前分析库的核心算法与本地 SQLite 增量存储已经稳健。进行前后端物理分层是系统向“认知与交互审计看板”演进的关键一步。前端保持类似 FormSight 的单体 SPA 架构，后端保留独立无缝的计算能力与 CLI 入口，不引入多包 Monorepo 的繁琐开销，架构清晰且维护心智成本低。

### 目标
1. 在后端新增 `src/server/` 模块，封装轻量 FastAPI 服务（提供 `/api/metrics`、`/api/sessions`、`/api/sync` 等离线与后台同步接口）。
2. 更新根目录 `pyproject.toml`，声明项目元信息与 `fastapi`、`uvicorn` 等依赖。
3. 扩展 `main.py` 入口，新增 `serve` 子命令，一键启动 FastAPI 后端服务。
4. 搭建 `frontend/` 目录，落盘 `package.json`、`biome.json`、`tsconfig.json`、`vite.config.ts`、`tailwind.config.js`、`postcss.config.js`。
5. 提供前端初始骨架代码（`index.html`、`src/main.tsx`、`src/app.tsx`、`src/index.css`），内置 Preact Signals 状态驱动的数据抓取与指标卡片示例。

### 基本原理
- **分工隔离**：前端专职视觉渲染与交互探索；Python 专职数据计算、SQLite WAL 存储和 Google Drive 网络调度。
- **开发体验**：Vite 本地开发服务器通过自带的反向代理 (`/api -> 127.0.0.1:8000`) 解决跨域；Biome 统一接管格式化与 Lint。

### 标签
#intent/build #flow/ready #priority/high #comp/build #comp/cli #concept/ui #concept/config #scope/dx #scope/core #ai/instruct #task/domain/ui #task/object/frontend-backend-scaffold #task/action/implementation #task/state/begin

---

### Script

#### Acts 1: 升级后端配置与 API 服务层

首先更新根目录 `pyproject.toml`，并创建 `src/server/api.py` 与 `src/server/app.py`，然后在 `main.py` 中接入 `serve` 子命令。

~~~~~act
write_file
pyproject.toml
~~~~~
~~~~~toml
[project]
name = "ai-studio-analyzer"
version = "0.1.0"
description = "Personal cognitive and interaction auditor based on Google AI Studio"
readme = "README.md"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn>=0.32.0",
    "requests>=2.32.0",
    "google-auth>=2.35.0",
    "google-auth-oauthlib>=1.2.0",
    "pandas>=2.2.0",
    "tqdm>=4.66.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
~~~~~

~~~~~act
write_file
src/server/__init__.py
~~~~~
~~~~~python
"""AI Studio Analyzer - FastAPI 后端服务包"""
~~~~~

~~~~~act
write_file
src/server/api.py
~~~~~
~~~~~python
from typing import Optional
from fastapi import APIRouter, BackgroundTasks
from src.analyzer.cache import SQLiteCache
from src.analyzer.loader import load_cached_sessions
from src.analyzer.metrics import calculate_session_metrics
from src.analyzer.drive import DriveClient, PROXY_URL
from src.analyzer.sync import fetch_remote_files

router = APIRouter(prefix="/api")
cache = SQLiteCache(cache_dir=".cache")

# 全局后台增量同步状态
sync_status = {
    "is_syncing": False,
    "last_result": None,
    "error": None
}


def _run_sync_task(limit: Optional[int], all_files: bool):
    sync_status["is_syncing"] = True
    sync_status["error"] = None
    try:
        client = DriveClient(proxy_url=PROXY_URL)
        total, hits, downloaded = fetch_remote_files(
            client=client,
            cache=cache,
            limit=limit,
            all_files=all_files
        )
        sync_status["last_result"] = {
            "total_scanned": total,
            "cache_hits": hits,
            "downloaded": downloaded,
            "cache_total": cache.count()
        }
    except Exception as exc:
        sync_status["error"] = str(exc)
    finally:
        sync_status["is_syncing"] = False


@router.get("/metrics")
def get_metrics():
    """纯离线全量指标审计接口"""
    sessions = load_cached_sessions(cache, limit=0, show_progress=False)
    if not sessions:
        return {"total_sessions": 0, "message": "暂无已缓存会话，请先执行同步"}
    return calculate_session_metrics(sessions)


@router.get("/sessions")
def list_sessions(limit: int = 50):
    """获取按修改时间排序的会话列表摘要"""
    sessions = load_cached_sessions(cache, limit=limit, show_progress=False)
    return [
        {
            "file_id": s.file_id,
            "name": s.name,
            "model": s.model,
            "turn_count": s.turn_count,
            "total_tokens": s.total_tokens,
            "thought_tokens": s.thought_tokens,
            "duration_human": s.duration_human,
            "duration_seconds": s.duration_seconds,
            "has_branching": s.has_branching,
            "branch_count": s.branch_count,
            "first_prompt": s.user_prompts[0] if s.user_prompts else "",
            "modified_time": s.modified_time.isoformat() if s.modified_time else None,
            "created_time": s.created_time.isoformat() if s.created_time else None,
        }
        for s in sessions
    ]


@router.post("/sync")
def trigger_sync(background_tasks: BackgroundTasks, limit: int = 50, all_files: bool = False):
    """异步触发云端增量同步任务"""
    if sync_status["is_syncing"]:
        return {"status": "busy", "message": "增量同步正在进行中，请勿重复触发"}

    background_tasks.add_task(_run_sync_task, limit=limit, all_files=all_files)
    mode_text = "全量" if all_files else f"最近 {limit} 条"
    return {"status": "started", "message": f"后台已启动云盘增量拉取 ({mode_text})"}


@router.get("/sync/status")
def get_sync_status():
    """查询后台同步进度状态"""
    return sync_status
~~~~~

~~~~~act
write_file
src/server/app.py
~~~~~
~~~~~python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from src.server.api import router

app = FastAPI(
    title="AI Studio Analyzer API",
    version="0.1.0",
    description="个人认知与交互审计系统 - 后端数据与计算引擎"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
def root():
    return {
        "status": "online",
        "service": "AI Studio Analyzer API",
        "docs_url": "/docs"
    }
~~~~~

~~~~~act
patch_file
main.py
~~~~~
~~~~~python.old
    parser_pull.add_argument("--export", action="store_true", help="分析完成后显式导出 CSV 与 JSONL 文件 (默认不导出)")

    return parser


def main():
~~~~~
~~~~~python.new
    parser_pull.add_argument("--export", action="store_true", help="分析完成后显式导出 CSV 与 JSONL 文件 (默认不导出)")

    # 4. serve 子命令
    parser_serve = subparsers.add_parser("serve", help="[服务] 启动 FastAPI 本地数据后端服务")
    parser_serve.add_argument("--host", type=str, default="127.0.0.1", help="绑定监听地址 (默认: 127.0.0.1)")
    parser_serve.add_argument("-p", "--port", type=int, default=8000, help="监听端口 (默认: 8000)")
    parser_serve.add_argument("--reload", action="store_true", help="代码热重载模式")

    return parser


def cmd_serve(args):
    """启动 FastAPI 服务"""
    import uvicorn
    print("=" * 60)
    print(f"🚀 启动 AI Studio Analyzer 后端服务: http://{args.host}:{args.port}")
    print(f"📖 Swagger 交互式文档地址:   http://{args.host}:{args.port}/docs")
    print("=" * 60)
    uvicorn.run("src.server.app:app", host=args.host, port=args.port, reload=args.reload)


def main():
~~~~~

~~~~~act
patch_file
main.py
~~~~~
~~~~~python.old
    elif args.command == "pull":
        cmd_pull(args)
    else:
        print("💡 未指定子命令，默认执行 `analyze` 查看本地指标看板。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
~~~~~
~~~~~python.new
    elif args.command == "pull":
        cmd_pull(args)
    elif args.command == "serve":
        cmd_serve(args)
    else:
        print("💡 未指定子命令，默认执行 `analyze` 查看本地指标看板。")
        print("   可用子命令: `fetch` (仅同步), `analyze` (仅本地分析), `pull` (同步并分析), `serve` (启动API服务)")
        print("   运行 `python main.py -h` 可查看完整指令选项。\n")
~~~~~

#### Acts 2: 初始化前端工具链与构建配置

在 `frontend/` 下创建工程化规范与构建工具配置文件。

~~~~~act
write_file
frontend/package.json
~~~~~
~~~~~json
{
  "name": "ai-studio-analyzer-ui",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "check": "biome check src",
    "format": "biome format --write src"
  },
  "dependencies": {
    "@preact/signals": "^2.0.1",
    "clsx": "^2.1.1",
    "lucide-preact": "^0.460.0",
    "preact": "^10.25.4",
    "tailwind-merge": "^2.5.5"
  },
  "devDependencies": {
    "@biomejs/biome": "1.9.4",
    "@preact/preset-vite": "^2.9.3",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.16",
    "typescript": "^5.7.2",
    "vite": "^6.0.3"
  }
}
~~~~~

~~~~~act
write_file
frontend/biome.json
~~~~~
~~~~~json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "vcs": {
    "enabled": true,
    "clientKind": "git",
    "useIgnoreFile": true
  },
  "files": {
    "ignoreUnknown": false,
    "ignore": ["dist", "node_modules"]
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "correctness": {
        "noUnusedVariables": "warn"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "semicolons": "always"
    }
  }
}
~~~~~

~~~~~act
write_file
frontend/tsconfig.json
~~~~~
~~~~~json
{
  "compilerOptions": {
    "target": "ESNext",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
    "skipLibCheck": true
  },
  "include": ["src"]
}
~~~~~

~~~~~act
write_file
frontend/vite.config.ts
~~~~~
~~~~~typescript
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
});
~~~~~

~~~~~act
write_file
frontend/postcss.config.js
~~~~~
~~~~~javascript
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
~~~~~

~~~~~act
write_file
frontend/tailwind.config.js
~~~~~
~~~~~javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {},
  },
  plugins: [],
};
~~~~~

#### Acts 3: 编写前端初始页面与 Signals 状态骨架

创建 `index.html`、`src/index.css`、`src/main.tsx`、类型定义以及基于 Preact Signals 的主视图。

~~~~~act
write_file
frontend/index.html
~~~~~
~~~~~html
<!doctype html>
<html lang="zh-CN" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🧠</text></svg>" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>AI Studio Analyzer - 认知与交互审计</title>
  </head>
  <body class="bg-zinc-950 text-zinc-100 antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
    <div id="app"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
~~~~~

~~~~~act
write_file
frontend/src/index.css
~~~~~
~~~~~css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  min-height: 100vh;
  font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';
}
~~~~~

~~~~~act
write_file
frontend/src/types/metrics.ts
~~~~~
~~~~~typescript
export interface TurnStats {
  mean: number;
  median: number;
  p75: number;
  p90: number;
  deep_count: number;
  deep_ratio: string;
}

export interface DurStats {
  mean: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  valid_count: number;
}

export interface TokStats {
  total: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  total_thought: number;
  thought_ratio: string;
}

export interface FrictionStats {
  branch_sessions: number;
  branch_ratio: string;
  total_retries: number;
}

export interface MetricsSummary {
  total_sessions: number;
  total_turns: number;
  total_user_chars: number;
  turn_stats: TurnStats;
  dur_stats: DurStats;
  multi_dur_stats: {
    mean: number;
    median: number;
    p75: number;
    p90: number;
  };
  duration_tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
  tok_stats: TokStats;
  friction_stats: FrictionStats;
  sys_instruction_count: number;
  model_distribution: Record<string, number>;
  message?: string;
}

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

~~~~~act
write_file
frontend/src/app.tsx
~~~~~
~~~~~tsx
import { signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import type { MetricsSummary, SessionItem } from './types/metrics';

const metricsSignal = signal<MetricsSummary | null>(null);
const sessionsSignal = signal<SessionItem[]>([]);
const loadingSignal = signal<boolean>(true);
const syncInProgressSignal = signal<boolean>(false);

async function loadDashboardData() {
  loadingSignal.value = true;
  try {
    const [metricsRes, sessionsRes] = await Promise.all([
      fetch('/api/metrics').then((r) => r.json()),
      fetch('/api/sessions?limit=30').then((r) => r.json()),
    ]);
    metricsSignal.value = metricsRes;
    sessionsSignal.value = sessionsRes;
  } catch (err) {
    console.error('加载审计数据失败:', err);
  } finally {
    loadingSignal.value = false;
  }
}

async function handleTriggerSync() {
  syncInProgressSignal.value = true;
  try {
    await fetch('/api/sync?limit=50', { method: 'POST' });
    setTimeout(loadDashboardData, 3000);
  } catch (err) {
    console.error('触发同步失败:', err);
  } finally {
    syncInProgressSignal.value = false;
  }
}

export function App() {
  useEffect(() => {
    loadDashboardData();
  }, []);

  const m = metricsSignal.value;
  const sessions = sessionsSignal.value;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 max-w-7xl mx-auto font-sans">
      {/* 顶部标题与控制条 */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-zinc-800 pb-6 gap-4">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧠</span>
            <h1 className="text-2xl font-bold tracking-tight text-white">AI Studio Analyzer</h1>
            <span className="text-xs font-mono uppercase bg-indigo-950/80 text-indigo-400 border border-indigo-800/60 px-2 py-0.5 rounded">
              Auditor v0.1
            </span>
          </div>
          <p className="text-xs text-zinc-400 mt-1">
            个人认知与交互审计系统 · 纯离线高性能分析与元工作流沉淀
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadDashboardData}
            className="px-3 py-1.5 text-xs font-medium bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded transition"
          >
            刷新指标
          </button>
          <button
            type="button"
            onClick={handleTriggerSync}
            disabled={syncInProgressSignal.value}
            className="px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm"
          >
            {syncInProgressSignal.value ? '云端同步中...' : '增量同步 (Fetch 50)'}
          </button>
        </div>
      </header>

      {/* 加载状态 */}
      {loadingSignal.value && (
        <div className="py-20 text-center text-zinc-500 text-sm animate-pulse">
          正在从本地 SQLite WAL 对象库加载全景认知指标...
        </div>
      )}

      {/* 核心指标概览 */}
      {!loadingSignal.value && m && (
        <main className="mt-8 space-y-8">
          {/* 四大关键能耗卡片 */}
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                全量交互会话
              </div>
              <div className="mt-2 text-2xl font-bold text-white tracking-tight">
                {m.total_sessions} <span className="text-sm font-normal text-zinc-500">场</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                总字数: {(m.total_user_chars || 0).toLocaleString()} 字符
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                生命周期中位数 (P50)
              </div>
              <div className="mt-2 text-2xl font-bold text-indigo-400 tracking-tight">
                {m.dur_stats?.median ?? 0} <span className="text-sm font-normal text-zinc-500">min</span>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                多轮攻坚 P50: {m.multi_dur_stats?.median ?? 0} min | Max: {m.dur_stats?.max ?? 0} min
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                总 Token 能耗
              </div>
              <div className="mt-2 text-2xl font-bold text-emerald-400 tracking-tight">
                {(m.tok_stats?.total || 0).toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                思考链 (Thinking): {m.tok_stats?.thought_ratio ?? '0%'}
              </div>
            </div>

            <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-5">
              <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
                思维摩擦力 (重试/分叉)
              </div>
              <div className="mt-2 text-2xl font-bold text-amber-400 tracking-tight">
                {m.friction_stats?.branch_ratio ?? '0%'}
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {m.friction_stats?.branch_sessions ?? 0} 场出现分叉 (累计 {m.friction_stats?.total_retries ?? 0} 次重试)
              </div>
            </div>
          </section>

          {/* 心智时长梯队分布 */}
          {m.duration_tiers && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-4">⏱️ 心智时长梯队切片</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">⚡ 即时快问 (&lt;10m)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.flash[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.flash[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🎯 聚焦推进 (10~60m)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.focus[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.focus[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🔨 深度攻坚 (1~6h)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.deep[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.deep[1]})
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-zinc-900 border border-zinc-800/80 rounded">
                  <div className="text-xs text-zinc-400">🏔️ 跨日长线 (&gt;6h)</div>
                  <div className="text-lg font-bold text-zinc-100 mt-1">
                    {m.duration_tiers.epic[0]} 场{' '}
                    <span className="text-xs font-normal text-zinc-500">
                      ({m.duration_tiers.epic[1]})
                    </span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 最近会话列表预览 */}
          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-zinc-200">
                📋 最近交互会话预览 (采样 {sessions.length} 场)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-zinc-300">
                <thead className="bg-zinc-900/80 text-zinc-400 uppercase text-[10px] tracking-wider border-b border-zinc-800">
                  <tr>
                    <th className="py-2.5 px-3">会话标题</th>
                    <th className="py-2.5 px-3">模型</th>
                    <th className="py-2.5 px-3">轮次</th>
                    <th className="py-2.5 px-3">时长</th>
                    <th className="py-2.5 px-3">Token 消耗</th>
                    <th className="py-2.5 px-3">首轮提问预览</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/50 font-mono">
                  {sessions.map((s) => (
                    <tr key={s.file_id} className="hover:bg-zinc-800/40 transition">
                      <td className="py-2.5 px-3 font-sans font-medium text-white max-w-[200px] truncate">
                        {s.name}
                        {s.has_branching && (
                          <span className="ml-1.5 px-1 py-0.2 bg-amber-950/80 text-amber-400 border border-amber-800/50 text-[10px] rounded">
                            分叉
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400">{s.model.replace('models/', '')}</td>
                      <td className="py-2.5 px-3">{s.turn_count} 轮</td>
                      <td className="py-2.5 px-3">{s.duration_human}</td>
                      <td className="py-2.5 px-3">{s.total_tokens.toLocaleString()}</td>
                      <td className="py-2.5 px-3 font-sans text-zinc-400 max-w-xs truncate">
                        {s.first_prompt || '(无文本提问)'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
~~~~~

~~~~~act
write_file
frontend/src/main.tsx
~~~~~
~~~~~tsx
import { render } from 'preact';
import { App } from './app';
import './index.css';

const rootEl = document.getElementById('app');
if (rootEl) {
  render(<App />, rootEl);
}
~~~~~

### 下一步建议
1. **安装依赖并验证运行**：
   - 后端安装与启动测试：
     ```bash
     uv run python main.py serve
     ```
     访问 `http://127.0.0.1:8000/docs` 验证 API 是否正常。
   - 前端依赖安装与启动测试：
     ```bash
     cd frontend && npm install && npm run dev
     ```
     访问 `http://127.0.0.1:5173` 检查指标卡片与会话列表是否成功渲染。
2. **后续指标深化**：
   - 可以在前端引入折线图/热力图（如基于 Canvas 或原生 SVG 绘制“每日 Token 消耗趋势”与“心智晴雨表”）。
   - 实现 FTS5 虚表检索与“提问反模式 / Prompt Smell 建议”面板。
