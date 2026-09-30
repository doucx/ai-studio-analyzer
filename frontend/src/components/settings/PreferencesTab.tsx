import { Monitor, Search } from 'lucide-preact';
import type { SystemConfig } from '../../state/settings';

interface Props {
  form: SystemConfig;
  setForm: (cfg: SystemConfig) => void;
}

export function PreferencesTab({ form, setForm }: Props) {
  return (
    <div className="space-y-6">
      {/* 搜索与 FTS 索引响应参数 */}
      <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
          <Search size={15} className="text-indigo-400" />
          <span>FTS 全文检索与输入交互参数</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor="debounce-input" className="text-xs text-zinc-400">
              搜索输入防抖延时 (毫秒)
            </label>
            <input
              id="debounce-input"
              type="number"
              step="50"
              min="100"
              max="1500"
              value={form.search_debounce_ms ?? 300}
              onInput={(e) =>
                setForm({
                  ...form,
                  search_debounce_ms: Number((e.target as HTMLInputElement).value),
                })
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
            />
            <p className="text-[11px] text-zinc-500">
              输入长篇 Prompt、调用栈或代码块后的等待静默时长。桌面端推荐 200~300ms，低算力环境（如
              Termux）推荐 500ms。
            </p>
          </div>
        </div>
      </section>

      {/* 界面呈现与阅读默认偏好 */}
      <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
          <Monitor size={15} className="text-indigo-400" />
          <span>界面呈现与阅读偏好</span>
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label htmlFor="time-range-select" className="text-xs text-zinc-400">
              初始默认时间切片跨度
            </label>
            <select
              id="time-range-select"
              value={form.default_time_range || 'all'}
              onChange={(e) =>
                setForm({
                  ...form,
                  default_time_range: (e.target as HTMLSelectElement)
                    .value as SystemConfig['default_time_range'],
                })
              }
              className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 text-zinc-300 text-xs rounded px-3 py-2 outline-none"
            >
              <option value="all">全量历史 (全部)</option>
              <option value="1d">最近 24 小时 (1天)</option>
              <option value="7d">最近 7 天</option>
              <option value="30d">最近 30 天</option>
              <option value="90d">最近 90 天</option>
              <option value="this_year">自然年度 (今年)</option>
            </select>
            <p className="text-[11px] text-zinc-500">
              打开看板全景大盘或工作台时的默认初筛时间窗口。
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <span className="text-xs text-zinc-400 block">会话工作台详情呈现初始状态</span>
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.default_show_metadata ?? true}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_show_metadata: (e.target as HTMLInputElement).checked,
                  })
                }
                className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-xs text-zinc-300">默认展开会话顶部的统计指标卡片</span>
            </label>

            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={form.default_render_markdown ?? true}
                onChange={(e) =>
                  setForm({
                    ...form,
                    default_render_markdown: (e.target as HTMLInputElement).checked,
                  })
                }
                className="w-4 h-4 rounded bg-zinc-950 border-zinc-700 text-indigo-600 focus:ring-0 cursor-pointer"
              />
              <span className="text-xs text-zinc-300">
                默认开启富文本 Markdown 排版渲染 (关闭则为紧凑纯文本)
              </span>
            </label>
          </div>
        </div>
      </section>
    </div>
  );
}
