import { Bot, Clock, LineChart, Sparkles } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { todayMetricsSignal } from '../state/metrics';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart, type TrendMode } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  const [trendMode, setTrendMode] = useState<TrendMode>('tokens');
  const today = todayMetricsSignal.value;

  return (
    <div className="space-y-6">
      {/* 今日心智耗时状态条 */}
      {today && (
        <section className="bg-gradient-to-r from-indigo-950/40 via-zinc-900/60 to-zinc-900/40 border border-indigo-900/30 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Sparkles size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-zinc-100">今日人机心智活跃</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  {today.date}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                今天已沉浸交互 <strong className="text-indigo-400">{today.session_count}</strong> 场
                {today.sessions.length > 0 && ` · 最近会话: ${today.sessions[0].name}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-6 sm:gap-8 self-end sm:self-auto text-xs font-mono">
            <div className="text-right">
              <div className="text-[10px] text-zinc-500 uppercase">活跃总时长</div>
              <div className="text-lg font-bold text-indigo-400">{today.total_duration_human}</div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-zinc-500 uppercase">总 Token 消耗</div>
              <div className="text-lg font-bold text-emerald-400">
                {today.total_tokens.toLocaleString()}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 四大关键能耗卡片 */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>交互总场次</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-white tracking-tight">
            {metrics.total_sessions} <span className="text-xs font-normal text-zinc-500">场</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            输入: {(metrics.total_user_chars || 0).toLocaleString()} 字符
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>时长中位数 (P50)</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-indigo-400 tracking-tight">
            {metrics.dur_stats?.median ?? 0}{' '}
            <span className="text-xs font-normal text-zinc-500">min</span>
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            多轮 P50: {metrics.multi_dur_stats?.median ?? 0}m | Max: {metrics.dur_stats?.max ?? 0}m
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>总 Token 规模</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-emerald-400 tracking-tight">
            {(metrics.tok_stats?.total || 0).toLocaleString()}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate" title="会话最终上下文规模，含思考链占比">
            上下文规模 · 思考: {metrics.tok_stats?.thought_ratio ?? '0%'}
          </div>
        </div>

        <div className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-4">
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider flex items-center justify-between">
            <span>思维摩擦力</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}]</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-amber-400 tracking-tight">
            {metrics.friction_stats?.branch_ratio ?? '0%'}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {metrics.friction_stats?.branch_sessions ?? 0} 场分叉 (
            {metrics.friction_stats?.total_retries ?? 0} 次重试)
          </div>
        </div>
      </section>

      {/* 每日时序趋势综合图 */}
      {metrics.daily_trends && metrics.daily_trends.length > 0 && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <LineChart size={15} className="text-indigo-400" />
                <span>
                  {trendMode === 'tokens' && '每日上下文 Token 规模趋势 (按时间序列)'}
                  {trendMode === 'chunks' && '每日 Chunk 交互推进量趋势 (按时间序列)'}
                  {trendMode === 'sessions' && '每日会话场次活跃度趋势 (按时间序列)'}
                </span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {trendMode === 'tokens' && `展示【${activeRangeLabel}】周期内的上下文 Token 规模与思考链沉淀`}
                {trendMode === 'chunks' && `展示【${activeRangeLabel}】周期内与模型往返交互的数据块推进总量`}
                {trendMode === 'sessions' && `展示【${activeRangeLabel}】周期内每日活跃的独立对话场次`}
              </p>
            </div>

            <div className="flex items-center gap-3">
              {/* 趋势图维度切换胶囊 */}
              <div className="flex items-center gap-1 p-0.5 bg-zinc-950 border border-zinc-800 rounded-md">
                <button
                  type="button"
                  onClick={() => setTrendMode('tokens')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'tokens'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日总 Token 与思考链上下文规模"
                >
                  上下文 Token
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode('chunks')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'chunks'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日与模型交互推进的数据块总量"
                >
                  Chunk 推进数
                </button>
                <button
                  type="button"
                  onClick={() => setTrendMode('sessions')}
                  className={`text-[11px] px-2.5 py-1 rounded font-medium transition cursor-pointer ${
                    trendMode === 'sessions'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                  }`}
                  title="展示每日发生交互的独立会话场次"
                >
                  交互场次
                </button>
              </div>

              <span className="text-xs font-mono text-zinc-400 bg-zinc-800/60 px-2 py-1 rounded shrink-0">
                {metrics.daily_trends.length} 活跃天
              </span>
            </div>
          </div>
          <TokenTrendChart data={metrics.daily_trends} mode={trendMode} />
        </section>
      )}

      {/* 时长梯队与模型偏好双图并排 */}
      {metrics.total_sessions > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {metrics.duration_tiers && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Clock size={15} className="text-sky-400" />
                <span>心智时长梯队切片</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                单次任务从首轮交互到最后收尾的时间窗口跨度
              </p>
              <DurationTiersChart tiers={metrics.duration_tiers} />
            </section>
          )}

          {metrics.model_distribution && Object.keys(metrics.model_distribution).length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Bot size={15} className="text-indigo-400" />
                <span>模型偏好分布</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">各 Gemini 模型在所选周期内的调用场次</p>
              <ModelDistributionChart distribution={metrics.model_distribution} />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
