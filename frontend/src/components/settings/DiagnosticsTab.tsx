import { Activity, AlertTriangle, Check, Flame, Layers, LineChart, Loader2 } from 'lucide-preact';
import {
  healthDiagnosticsSignal,
  healthLoadingSignal,
  openOutlierSession,
  runHealthDiagnostic,
  runSchemaDiagnostic,
  schemaDiagnosticsSignal,
  schemaLoadingSignal,
} from '../../state/ops';

export function DiagnosticsTab() {
  const healthData = healthDiagnosticsSignal.value;
  const isHealthLoading = healthLoadingSignal.value;
  const schemaData = schemaDiagnosticsSignal.value;
  const isSchemaLoading = schemaLoadingSignal.value;

  return (
    <div className="space-y-6">
      <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-300 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={16} className="text-emerald-400 shrink-0" />
          <span>
            为确保日常页面秒开，健康度探针与 Schema 采样已配置为<strong>按需手动触发</strong>。
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isHealthLoading}
            onClick={runHealthDiagnostic}
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded transition shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            {isHealthLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Activity size={12} />
            )}
            <span>{healthData ? '刷新健康检测' : '立即运行全盘检测'}</span>
          </button>
          <button
            type="button"
            disabled={isSchemaLoading}
            onClick={() => runSchemaDiagnostic(300)}
            className="px-3 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700 transition flex items-center gap-1.5 cursor-pointer"
          >
            {isSchemaLoading ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Layers size={12} />
            )}
            <span>采样 Schema 拓扑</span>
          </button>
        </div>
      </div>

      {healthData && (
        <div className="space-y-6 animate-in fade-in duration-300">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
              <div className="text-[11px] text-zinc-400">主库 / WAL 体积</div>
              <div className="text-base font-bold text-white font-mono mt-0.5">
                {healthData.physical.db_size_human}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                WAL: {healthData.physical.wal_size_human}
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
              <div className="text-[11px] text-zinc-400">碎片空闲占比 (Freelist)</div>
              <div
                className={`text-base font-bold font-mono mt-0.5 ${
                  healthData.physical.frag_ratio > 15 ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {healthData.physical.frag_ratio}%
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                碎片空间: {healthData.physical.freelist_human}
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
              <div className="text-[11px] text-zinc-400">索引与数据一致性</div>
              <div className="text-base font-bold text-white font-mono mt-0.5">
                {healthData.schema_counts.is_aligned ? (
                  <span className="text-emerald-400 flex items-center gap-1">
                    <Check size={14} /> 100% 对齐
                  </span>
                ) : (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={14} /> 待对齐
                  </span>
                )}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                缓存 {healthData.schema_counts.file_cache} / 索引{' '}
                {healthData.schema_counts.session_index}
              </div>
            </div>

            <div className="p-3.5 bg-zinc-900/60 border border-zinc-800 rounded-lg">
              <div className="text-[11px] text-zinc-400">SQLite 完整性校验</div>
              <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
                {healthData.physical.integrity_check}
              </div>
              <div className="text-[10px] text-zinc-500 font-mono mt-0.5">
                探测耗时: {healthData.physical.check_time_seconds}s
              </div>
            </div>
          </div>

          {/* 核心指标分位数阶梯表 */}
          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <LineChart size={15} className="text-indigo-400" />
                <span>核心指标分位数阶梯 (Quantile Distributions)</span>
              </h3>
              <span className="text-xs font-mono text-zinc-400">
                样本总量: {healthData.cognitive_buckets.total_sessions} 场
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs font-mono">
                <thead className="text-[11px] text-zinc-400 border-b border-zinc-800 bg-zinc-950/40">
                  <tr>
                    <th className="py-2 px-3">指标项</th>
                    <th className="py-2 px-2 text-right">Min</th>
                    <th className="py-2 px-2 text-right">P10</th>
                    <th className="py-2 px-2 text-right text-indigo-300">P50 (中位)</th>
                    <th className="py-2 px-2 text-right">P75</th>
                    <th className="py-2 px-2 text-right">P90</th>
                    <th className="py-2 px-2 text-right">P99</th>
                    <th className="py-2 px-3 text-right">Max</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/40 text-zinc-300">
                  <tr>
                    <td className="py-2.5 px-3 text-zinc-200 font-medium">对话轮次 (Turns)</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.min}</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p10}</td>
                    <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                      {healthData.quantiles.turns.p50}
                    </td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p75}</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p90}</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.turns.p99}</td>
                    <td className="py-2.5 px-3 text-right">{healthData.quantiles.turns.max}</td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-zinc-200 font-medium">Token 消耗规模</td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.tokens.min.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.tokens.p10.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                      {healthData.quantiles.tokens.p50.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.tokens.p75.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.tokens.p90.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.tokens.p99.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {healthData.quantiles.tokens.max.toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-zinc-200 font-medium">思考链 (Thinking)</td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.thought.min.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.thought.p10.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                      {healthData.quantiles.thought.p50.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.thought.p75.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.thought.p90.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-2 text-right">
                      {healthData.quantiles.thought.p99.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {healthData.quantiles.thought.max.toLocaleString()}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2.5 px-3 text-zinc-200 font-medium">持续时长 (分钟)</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.duration.min}m</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.duration.p10}m</td>
                    <td className="py-2.5 px-2 text-right text-indigo-300 font-bold">
                      {healthData.quantiles.duration.p50}m
                    </td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.duration.p75}m</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.duration.p90}m</td>
                    <td className="py-2.5 px-2 text-right">{healthData.quantiles.duration.p99}m</td>
                    <td className="py-2.5 px-3 text-right">{healthData.quantiles.duration.max}m</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* Top 3 离群极值会话排查 */}
          <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <Flame size={15} className="text-red-400" />
                <span>离群极值会话排查 (Top Outliers)</span>
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                排查单条体积、算力能耗或交互深度异常的极值样本，点击任意卡片可在右侧抽屉展开会话。
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                  <span>📦 单条原始 JSON 体积 Top 3</span>
                </span>
                <div className="space-y-1.5">
                  {healthData.outliers.largest_files.map((item, idx) => (
                    <button
                      type="button"
                      key={item.file_id}
                      onClick={() => openOutlierSession(item.file_id, item.name)}
                      className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                          #{idx + 1} {item.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          {item.turn_count} 轮 · {item.total_tokens.toLocaleString()} tok
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-amber-400 shrink-0">
                        {item.byte_len_human}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                  <span>⚡ Token 能耗最高 Top 3</span>
                </span>
                <div className="space-y-1.5">
                  {healthData.outliers.top_tokens.map((item, idx) => (
                    <button
                      type="button"
                      key={item.file_id}
                      onClick={() => openOutlierSession(item.file_id, item.name)}
                      className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                          #{idx + 1} {item.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          思考链: {item.thought_tokens.toLocaleString()} tok
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-indigo-400 shrink-0">
                        {item.total_tokens.toLocaleString()}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-lg space-y-2.5">
                <span className="text-xs font-semibold text-zinc-300 flex items-center gap-1">
                  <span>🔄 对话轮次最深 Top 3</span>
                </span>
                <div className="space-y-1.5">
                  {healthData.outliers.top_turns.map((item, idx) => (
                    <button
                      type="button"
                      key={item.file_id}
                      onClick={() => openOutlierSession(item.file_id, item.name)}
                      className="w-full text-left p-2 rounded bg-zinc-900/80 hover:bg-zinc-800/80 border border-zinc-800/80 transition flex items-center justify-between cursor-pointer group"
                    >
                      <div className="min-w-0 pr-2">
                        <div className="text-xs font-medium text-zinc-200 truncate group-hover:text-indigo-400">
                          #{idx + 1} {item.name}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          时长: {item.duration_human}
                        </div>
                      </div>
                      <span className="text-xs font-mono font-bold text-emerald-400 shrink-0">
                        {item.turn_count} 轮
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {schemaData && (
        <section className="bg-zinc-900/40 border border-zinc-800 rounded-lg p-5 space-y-4 animate-in fade-in duration-300">
          <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Layers size={15} className="text-cyan-400" />
            <span>数据 Schema 拓扑与载荷形态分布 (采样 {schemaData.sampled_records} 篇)</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-400">Chunk 对话载荷形态分布</div>
              <div className="space-y-1.5">
                {schemaData.payload_types.map((p) => (
                  <div
                    key={p.type}
                    className="flex items-center justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60 text-xs font-mono"
                  >
                    <span className="text-zinc-300">形态: [{p.type}]</span>
                    <span className="text-indigo-400 font-bold">{p.count} 次</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-zinc-400">顶层 Key 覆盖频率</div>
              <div className="space-y-1.5">
                {schemaData.top_level_keys.map((k) => (
                  <div
                    key={k.key}
                    className="flex items-center justify-between p-2 rounded bg-zinc-950/60 border border-zinc-800/60 text-xs font-mono"
                  >
                    <span className="text-zinc-300">{k.key}</span>
                    <span className="text-emerald-400">
                      {k.count} ({k.ratio}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {!healthData && !schemaData && (
        <div className="py-20 text-center text-xs text-zinc-500 space-y-2 border border-dashed border-zinc-800 rounded-lg">
          <div>暂未运行诊断。请点击右上角【立即运行全盘检测】生成最新健康报告。</div>
        </div>
      )}
    </div>
  );
}
