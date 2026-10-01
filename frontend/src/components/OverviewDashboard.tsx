import { Bot, Clock, FileCode, Layers, LineChart, Sparkles, User } from 'lucide-preact';
import { useLocation } from 'preact-iso';
import { useCallback, useState } from 'preact/hooks';
import { hourlyStatsSignal } from '../state/metrics';
import { drillDownToSessions } from '../state/session';
import type { MetricsSummary } from '../types/metrics';
import { DurationTiersChart } from './charts/DurationTiersChart';
import { HourlyActivityChart } from './charts/HourlyActivityChart';
import { ModelDistributionChart } from './charts/ModelDistributionChart';
import { TokenTrendChart, type TrendMode } from './charts/TokenTrendChart';

interface Props {
  metrics: MetricsSummary;
  activeRangeLabel: string;
}

export function OverviewDashboard({ metrics, activeRangeLabel }: Props) {
  const { route } = useLocation();
  const [trendMode, setTrendMode] = useState<TrendMode>('tokens');

  const handleModelDrillDown = useCallback(
    (model: string) => {
      drillDownToSessions({ model });
      route('/sessions');
    },
    [route],
  );

  const handleDateDrillDown = useCallback(
    (date: string) => {
      const targetDate = metrics.trend_granularity === 'hour' ? metrics.single_date || date : date;
      drillDownToSessions({ date: targetDate });
      route('/sessions');
    },
    [route, metrics.trend_granularity, metrics.single_date],
  );

  const handleTierDrillDown = useCallback(
    (tier: 'flash' | 'focus' | 'deep' | 'epic') => {
      drillDownToSessions({ tier });
      route('/sessions');
    },
    [route],
  );

  const handleBranchDrillDown = useCallback(() => {
    drillDownToSessions({ depth: 'branch' });
    route('/sessions');
  }, [route]);

  return (
    <div className="space-y-6">
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
            <span>用户纯意图 Token</span>
            <span className="text-[10px] text-indigo-400 font-mono">
              [P50: {metrics.breakdown_quantiles?.user_net.p50 ?? 0} tok]
            </span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-indigo-400 tracking-tight flex items-baseline gap-2">
            <span>{(metrics.token_breakdown?.user_net_tokens || 0).toLocaleString()}</span>
            <span className="text-xs font-normal text-zinc-400">
              (
              {metrics.tok_stats?.total
                ? (
                    ((metrics.token_breakdown?.user_net_tokens || 0) / metrics.tok_stats.total) *
                    100
                  ).toFixed(1)
                : 0}
              %)
            </span>
          </div>
          <div
            className="mt-1 text-[11px] text-zinc-400 truncate"
            title="纯提问Prompt与推敲字数，剥离了所有外部工程文件"
          >
            纯打字输入:{' '}
            <strong className="text-zinc-200">
              {(metrics.total_user_chars || 0).toLocaleString()}
            </strong>{' '}
            字
          </div>
        </div>

        <button
          type="button"
          onClick={handleBranchDrillDown}
          className="w-full text-left bg-zinc-900/70 hover:bg-zinc-900/90 border border-zinc-800 hover:border-amber-500/50 rounded-lg p-4 cursor-pointer transition group outline-none focus:ring-1 focus:ring-amber-500/50"
          title="点击下钻查看所有分叉与重试会话"
        >
          <div className="text-xs font-medium text-zinc-400 group-hover:text-amber-400 uppercase tracking-wider flex items-center justify-between">
            <span>思维摩擦力</span>
            <span className="text-[10px] text-zinc-500 font-mono">[{activeRangeLabel}] ↗</span>
          </div>
          <div className="mt-1.5 text-2xl font-bold text-amber-400 tracking-tight">
            {metrics.friction_stats?.branch_ratio ?? '0%'}
          </div>
          <div className="mt-1 text-[11px] text-zinc-500 truncate">
            {metrics.friction_stats?.branch_sessions ?? 0} 场分叉 (
            {metrics.friction_stats?.total_retries ?? 0} 次重试)
          </div>
        </button>
      </section>

      {/* 全局资产解构与 Token 构成色谱分析栏 */}
      {metrics.token_breakdown && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <Layers size={15} className="text-indigo-400" />
                <span>认知资产构成与真实意图解构 (Cognitive Asset Breakdown)</span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                解耦【{activeRangeLabel}】周期内静态沉淀的 Token：分离纯净 Prompt、外挂代码库与 AI
                产出
              </p>
            </div>
            <div className="text-xs font-mono text-zinc-400 bg-zinc-950 px-2.5 py-1 rounded border border-zinc-800/80 shrink-0">
              静态总和:{' '}
              <strong className="text-zinc-200">
                {metrics.tok_stats?.total?.toLocaleString()}
              </strong>{' '}
              tokens
            </div>
          </div>

          {/* 五彩资产构成色谱条 */}
          {(() => {
            const tot = metrics.tok_stats?.total || 1;
            const b = metrics.token_breakdown;
            const pUser = (b.user_net_tokens / tot) * 100;
            const pFiles = (b.context_file_tokens / tot) * 100;
            const pSys = (b.sys_instruction_tokens / tot) * 100;
            const pModel = (b.model_net_tokens / tot) * 100;
            const pThought = (b.thought_tokens / tot) * 100;

            return (
              <div className="space-y-2">
                <div className="w-full h-3 rounded-full bg-zinc-950 overflow-hidden flex border border-zinc-800/80 shadow-inner">
                  <div
                    style={{ width: `${pUser}%` }}
                    className="bg-indigo-500 transition-all duration-300"
                    title={`用户纯意图: ${b.user_net_tokens.toLocaleString()} (${pUser.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${pFiles}%` }}
                    className="bg-sky-500 transition-all duration-300"
                    title={`挂载附件/代码: ${b.context_file_tokens.toLocaleString()} (${pFiles.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${pSys}%` }}
                    className="bg-amber-600/90 transition-all duration-300"
                    title={`系统提示词: ${b.sys_instruction_tokens.toLocaleString()} (${pSys.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${pModel}%` }}
                    className="bg-emerald-500 transition-all duration-300"
                    title={`模型生成净正文: ${b.model_net_tokens.toLocaleString()} (${pModel.toFixed(1)}%)`}
                  />
                  <div
                    style={{ width: `${pThought}%` }}
                    className="bg-emerald-300/80 transition-all duration-300"
                    title={`思考链算力: ${b.thought_tokens.toLocaleString()} (${pThought.toFixed(1)}%)`}
                  />
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1 text-[11px] font-mono">
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-indigo-500 shrink-0" />
                    <span>
                      纯意图: <strong className="text-indigo-400">{pUser.toFixed(1)}%</strong> (
                      {Math.round(b.user_net_tokens / 1000).toLocaleString()}k)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-sky-500 shrink-0" />
                    <span>
                      代码库: <strong className="text-sky-400">{pFiles.toFixed(1)}%</strong> (
                      {Math.round(b.context_file_tokens / 1000).toLocaleString()}k)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-600 shrink-0" />
                    <span>
                      系统设定: <strong className="text-amber-400">{pSys.toFixed(1)}%</strong> (
                      {Math.round(b.sys_instruction_tokens / 1000).toLocaleString()}k)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" />
                    <span>
                      模型产出: <strong className="text-emerald-400">{pModel.toFixed(1)}%</strong> (
                      {Math.round(b.model_net_tokens / 1000).toLocaleString()}k)
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-zinc-300">
                    <span className="w-2.5 h-2.5 rounded-sm bg-emerald-300 shrink-0" />
                    <span>
                      思考链: <strong className="text-emerald-300">{pThought.toFixed(1)}%</strong> (
                      {Math.round(b.thought_tokens / 1000).toLocaleString()}k)
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* 真实意图 vs 外部代码库 分位数透视网格 */}
          {metrics.breakdown_quantiles && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <User size={12} className="text-indigo-400" />
                    <span>用户净 Prompt 中位数 (P50)</span>
                  </span>
                  <span className="font-mono text-indigo-400 font-bold">
                    {metrics.breakdown_quantiles.user_net.p50} tok
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1 flex justify-between">
                  <span>P10: {metrics.breakdown_quantiles.user_net.p10}</span>
                  <span>P75: {metrics.breakdown_quantiles.user_net.p75}</span>
                  <span>P90: {metrics.breakdown_quantiles.user_net.p90}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <FileCode size={12} className="text-sky-400" />
                    <span>外挂工程附件 P75 / P90</span>
                  </span>
                  <span className="font-mono text-sky-400 font-bold">
                    {metrics.breakdown_quantiles.context_files.p90.toLocaleString()} tok
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1 flex justify-between">
                  <span>P50: {metrics.breakdown_quantiles.context_files.p50}</span>
                  <span>P75: {metrics.breakdown_quantiles.context_files.p75.toLocaleString()}</span>
                  <span>P99: {metrics.breakdown_quantiles.context_files.p99.toLocaleString()}</span>
                </div>
              </div>

              <div className="p-3 bg-zinc-950/60 rounded-lg border border-zinc-800/80">
                <div className="text-[11px] text-zinc-400 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Sparkles size={12} className="text-emerald-400" />
                    <span>模型回答正文 P50 / P90</span>
                  </span>
                  <span className="font-mono text-emerald-400 font-bold">
                    {metrics.breakdown_quantiles.model_net.p50.toLocaleString()} tok
                  </span>
                </div>
                <div className="text-[10px] text-zinc-500 font-mono mt-1 flex justify-between">
                  <span>P10: {metrics.breakdown_quantiles.model_net.p10}</span>
                  <span>P75: {metrics.breakdown_quantiles.model_net.p75.toLocaleString()}</span>
                  <span>P90: {metrics.breakdown_quantiles.model_net.p90.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 每日时序趋势综合图 */}
      {metrics.daily_trends && metrics.daily_trends.length > 0 && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <LineChart size={15} className="text-indigo-400" />
                <span>
                  {trendMode === 'tokens' &&
                    (metrics.trend_granularity === 'hour'
                      ? `分时上下文 Token 规模趋势 (${metrics.single_date || ''} 24小时分布)`
                      : '每日上下文 Token 规模趋势 (按时间序列)')}
                  {trendMode === 'chunks' &&
                    (metrics.trend_granularity === 'hour'
                      ? `分时 Chunk 推进量趋势 (${metrics.single_date || ''} 24小时分布)`
                      : '每日 Chunk 交互推进量趋势 (按时间序列)')}
                  {trendMode === 'sessions' &&
                    (metrics.trend_granularity === 'hour'
                      ? `分时会话活跃度趋势 (${metrics.single_date || ''} 24小时分布)`
                      : '每日会话场次活跃度趋势 (按时间序列)')}
                </span>
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {metrics.trend_granularity === 'hour'
                  ? `展示【${activeRangeLabel}】内 00:00 ~ 23:00 的心智活跃分布`
                  : trendMode === 'tokens'
                    ? `展示【${activeRangeLabel}】周期内的上下文 Token 规模与思考链沉淀`
                    : trendMode === 'chunks'
                      ? `展示【${activeRangeLabel}】周期内与模型往返交互的数据块推进总量`
                      : `展示【${activeRangeLabel}】周期内每日活跃的独立对话场次`}
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
                {metrics.trend_granularity === 'hour'
                  ? '24 小时槽位'
                  : `${metrics.daily_trends.length} 活跃天`}
              </span>
            </div>
          </div>
          <TokenTrendChart
            data={metrics.daily_trends}
            mode={trendMode}
            onSelectDate={handleDateDrillDown}
          />
        </section>
      )}

      {/* 24 小时 Chunk 精确心智精力直方图 (Anki 时段分布) */}
      {hourlyStatsSignal.value && hourlyStatsSignal.value.total_chunks > 0 && (
        <HourlyActivityChart data={hourlyStatsSignal.value} activeRangeLabel={activeRangeLabel} />
      )}

      {/* 时长梯队与模型偏好双图并排 */}
      {metrics.total_sessions > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
          {metrics.duration_tiers && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Clock size={15} className="text-sky-400" />
                <span>会话时长分布</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                单次任务从首轮交互到最后收尾的时间窗口跨度 (点击切片下钻)
              </p>
              <DurationTiersChart
                tiers={metrics.duration_tiers}
                onSelectTier={handleTierDrillDown}
              />
            </section>
          )}

          {metrics.model_distribution && Object.keys(metrics.model_distribution).length > 0 && (
            <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Bot size={15} className="text-indigo-400" />
                <span>模型调用分布</span>
              </h2>
              <p className="text-xs text-zinc-500 mb-3">
                各 Gemini 模型在所选周期内的调用场次 (点击柱体下钻)
              </p>
              <ModelDistributionChart
                distribution={metrics.model_distribution}
                onSelectModel={handleModelDrillDown}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}
