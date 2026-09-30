import { Cpu } from 'lucide-preact';
import type { SystemConfig } from '../../state/settings';

interface Props {
  form: SystemConfig;
  setForm: (cfg: SystemConfig) => void;
}

export function MetricsTab({ form, setForm }: Props) {
  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
          <Cpu size={15} className="text-indigo-400" />
          <span>人机心智活跃时长估算模型 (Cognitive Model Hyperparameters)</span>
        </h2>
        <p className="text-xs text-zinc-500 mt-1">
          调整认知审计模型中关于用户构思打字、模型阅读消化以及跨日闲置截断的计算超参数
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="space-y-1.5">
          <label htmlFor="typing-speed-input" className="text-xs text-zinc-400">
            用户键入构思基线 (字符/秒)
          </label>
          <input
            id="typing-speed-input"
            type="number"
            step="0.5"
            value={form.typing_chars_per_sec}
            onInput={(e) =>
              setForm({
                ...form,
                typing_chars_per_sec: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
          />
          <p className="text-[11px] text-zinc-500">
            默认 5.0 字符/秒（约 150 汉字/分钟），用于评估用户在输入框中推敲提示词的时间。
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reading-speed-input" className="text-xs text-zinc-400">
            模型回答阅读基线 (Tokens/秒)
          </label>
          <input
            id="reading-speed-input"
            type="number"
            step="0.5"
            value={form.reading_tokens_per_sec}
            onInput={(e) =>
              setForm({
                ...form,
                reading_tokens_per_sec: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
          />
          <p className="text-[11px] text-zinc-500">
            默认 8.0 tokens/秒（约 480 tokens/分钟），评估吸收和理解模型长回复的心智消耗。
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="base-chunk-input" className="text-xs text-zinc-400">
            单块往返交互基线 (秒)
          </label>
          <input
            id="base-chunk-input"
            type="number"
            value={form.base_chunk_seconds}
            onInput={(e) =>
              setForm({
                ...form,
                base_chunk_seconds: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
          />
          <p className="text-[11px] text-zinc-500">
            每轮往返的上下文切换最小基准耗时（默认 15 秒）。
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="idle-timeout-input" className="text-xs text-zinc-400">
            会话空闲截断阈值 (分钟)
          </label>
          <input
            id="idle-timeout-input"
            type="number"
            value={form.idle_timeout_minutes}
            onInput={(e) =>
              setForm({
                ...form,
                idle_timeout_minutes: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
          />
          <p className="text-[11px] text-zinc-500">
            交互间隔超过此阈值视作中断搁置，不计入连续生命周期，防止将隔夜闲置误判为耗时。
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="deep-turns-input" className="text-xs text-zinc-400">
            长线深度攻坚判定阈值 (Chunks 数量)
          </label>
          <input
            id="deep-turns-input"
            type="number"
            min="3"
            max="30"
            value={form.deep_threshold_turns ?? 7}
            onInput={(e) =>
              setForm({
                ...form,
                deep_threshold_turns: Number((e.target as HTMLInputElement).value),
              })
            }
            className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded px-3 py-1.5 text-xs font-mono text-zinc-200 outline-none"
          />
          <p className="text-[11px] text-zinc-500">
            会话包含的数据块（Chunks）达到或超过此阈值即被归类为“深度攻坚”长线会话。
          </p>
        </div>
      </div>
    </div>
  );
}
