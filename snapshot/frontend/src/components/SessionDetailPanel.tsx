import { useEffect, useState } from 'preact/hooks';
import type { SessionDetail, SessionItem } from '../types/metrics';

interface Props {
  session: SessionItem;
  onClose: () => void;
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  useEffect(() => {
    setLoading(true);
    fetch(`/api/sessions/${session.file_id}`)
      .then((res) => res.json())
      .then((data) => {
        setDetail(data);
      })
      .catch((err) => {
        console.error('获取会话详情失败:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [session.file_id]);

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 flex flex-col space-y-5">
      {/* 头部导航与操作条 */}
      <div className="flex items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight">{session.name}</h2>
            {session.has_branching && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono">
                分叉重试 {session.branch_count} 次
              </span>
            )}
          </div>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            ID: {session.file_id} · 模型: {session.model.replace('models/', '')}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <span>🚀</span> 在 AI Studio 打开
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition"
          >
            返回看板
          </button>
        </div>
      </div>

      {/* 单会话微观指标卡片 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">生命周期时长</div>
          <div className="text-lg font-bold text-indigo-400 font-mono mt-0.5">
            {session.duration_human}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">{session.duration_seconds} 秒</div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">总 Token 消耗</div>
          <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
            {session.total_tokens.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            思考链: {session.thought_tokens.toLocaleString()}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">有效交互轮次</div>
          <div className="text-lg font-bold text-white font-mono mt-0.5">{session.turn_count} 轮</div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {session.turn_count >= 5 ? '深度多轮会话' : '轻量快问'}
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800/80 rounded p-3">
          <div className="text-[11px] text-zinc-400">最后修改时间</div>
          <div className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate">
            {session.modified_time ? session.modified_time.replace('T', ' ').slice(0, 16) : '未知'}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            创建: {session.created_time ? session.created_time.slice(0, 10) : '未知'}
          </div>
        </div>
      </div>

      {/* 首轮核心提问预览 */}
      <div className="bg-zinc-900 border border-zinc-800 rounded p-4">
        <div className="text-xs font-semibold text-zinc-300 mb-2 flex items-center justify-between">
          <span>💬 首轮 Prompt 提问全文</span>
          <span className="text-[10px] text-zinc-500 font-mono">
            {session.first_prompt.length} 字符
          </span>
        </div>
        <div className="bg-zinc-950 p-3 rounded text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto leading-relaxed border border-zinc-800/60">
          {session.first_prompt || '(无文本提问)'}
        </div>
      </div>

      {/* 预留自研渲染器插槽与详细轮次预览 */}
      <div className="bg-zinc-900/60 border border-zinc-800 rounded p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-zinc-200">
            📜 交互轮次流 ({detail?.turns?.length ?? 0} 个 Chunks)
          </h3>
          <span className="text-[10px] text-indigo-400 bg-indigo-950/60 px-2 py-0.5 rounded border border-indigo-800/40">
            完整 Markdown 渲染器插槽已就绪
          </span>
        </div>

        {loading ? (
          <div className="py-6 text-center text-xs text-zinc-500 animate-pulse">
            正在从 SQLite 数据库装载详细轮次流...
          </div>
        ) : (
          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {detail?.turns?.map((turn, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded text-xs border ${
                  turn.role === 'user'
                    ? 'bg-zinc-950 border-zinc-800 text-zinc-200'
                    : turn.is_thought
                      ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300'
                      : 'bg-zinc-900/90 border-zinc-800/80 text-zinc-300'
                }`}
              >
                <div className="flex items-center justify-between text-[10px] text-zinc-500 mb-1 font-mono">
                  <span className="font-semibold uppercase text-zinc-400">
                    {turn.is_thought ? '🧠 思考链 (Thinking)' : turn.role}
                  </span>
                  <span>{turn.token_count > 0 ? `${turn.token_count} tokens` : ''}</span>
                </div>
                <div className="font-sans line-clamp-3 whitespace-pre-wrap">{turn.text}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}