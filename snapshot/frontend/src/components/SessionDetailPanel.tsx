import { useEffect, useState } from 'preact/hooks';
import type { ConversationTurnItem, SessionDetail, SessionItem } from '../types/metrics';
import { PromptMarkdown } from './PromptMarkdown';

interface Props {
  session: SessionItem;
  onClose: () => void;
}

// 独立思考链折叠组件
function ThinkingAccordion({
  turn,
  defaultExpanded = false,
}: {
  turn: ConversationTurnItem;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 overflow-hidden my-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3.5 py-2 flex items-center justify-between text-left hover:bg-emerald-900/20 transition cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">🧠</span>
          <span className="text-xs font-semibold text-emerald-400">
            思考过程 (Thinking Process)
          </span>
          <span className="text-[10px] font-mono bg-emerald-900/60 text-emerald-300 px-1.5 py-0.5 rounded border border-emerald-700/50">
            {turn.token_count > 0 ? `${turn.token_count.toLocaleString()} tokens` : 'Thought Chunk'}
          </span>
        </div>
        <span className="text-xs text-emerald-400 font-mono">
          {expanded ? '▲ 折叠思考' : '▼ 展开审计'}
        </span>
      </button>

      {expanded && (
        <div className="p-3.5 pt-2 border-t border-emerald-900/30 text-emerald-200/90 text-xs bg-emerald-950/30 leading-relaxed font-sans">
          <PromptMarkdown content={turn.text} />
        </div>
      )}
    </div>
  );
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [expandAllThoughts, setExpandAllThoughts] = useState<boolean>(false);
  const [filterRole, setFilterRole] = useState<'all' | 'user' | 'model'>('all');

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

  const turns = detail?.turns || [];
  const filteredTurns = turns.filter((t) => {
    if (filterRole === 'all') return true;
    if (filterRole === 'user') return t.role === 'user';
    if (filterRole === 'model') return t.role === 'model' || t.is_thought;
    return true;
  });

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 flex flex-col space-y-6">
      {/* 头部导航与关键动作 */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
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

      {/* 单会话核心指标微观仪表盘 */}
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
          <div className="text-lg font-bold text-white font-mono mt-0.5">
            {session.turn_count} 轮
          </div>
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

      {/* 系统指令 (System Instruction) 审计条（若存在） */}
      {detail?.system_instruction && (
        <div className="bg-zinc-950 border border-indigo-900/40 rounded-lg p-3.5">
          <div className="text-xs font-semibold text-indigo-400 mb-1 flex items-center gap-1.5">
            <span>🛡️ 系统前置指令 (System Instruction)</span>
          </div>
          <div className="text-xs text-zinc-300 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
            {detail.system_instruction}
          </div>
        </div>
      )}

      {/* 完整交互轮次 Markdown 对话流 */}
      <div className="space-y-3">
        {/* 对话流控制工具栏 */}
        <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
              💬 完整交互流 ({filteredTurns.length} 个视窗)
            </h3>
            <div className="inline-flex rounded bg-zinc-950 border border-zinc-800 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setFilterRole('all')}
                className={`px-2 py-0.5 rounded transition ${
                  filterRole === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                全部
              </button>
              <button
                type="button"
                onClick={() => setFilterRole('user')}
                className={`px-2 py-0.5 rounded transition ${
                  filterRole === 'user' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                仅提问
              </button>
              <button
                type="button"
                onClick={() => setFilterRole('model')}
                className={`px-2 py-0.5 rounded transition ${
                  filterRole === 'model' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                仅回复+思考
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setExpandAllThoughts(!expandAllThoughts)}
            className="text-[11px] text-zinc-400 hover:text-indigo-400 transition"
          >
            {expandAllThoughts ? '收起所有思考链' : '展开所有思考链'}
          </button>
        </div>

        {loading ? (
          <div className="py-16 text-center text-xs text-zinc-500 animate-pulse">
            正在从 SQLite 缓存还原完整 Prompt 对话流与 Markdown 格式化排版...
          </div>
        ) : filteredTurns.length === 0 ? (
          <div className="p-8 text-center text-xs text-zinc-500 bg-zinc-950 rounded-lg">
            该筛选条件下无轮次内容
          </div>
        ) : (
          <div className="space-y-4">
            {filteredTurns.map((turn, idx) => {
              if (turn.is_thought) {
                return (
                  <ThinkingAccordion
                    key={`turn-${idx}`}
                    turn={turn}
                    defaultExpanded={expandAllThoughts}
                  />
                );
              }

              const isUser = turn.role === 'user';

              return (
                <div
                  key={`turn-${idx}`}
                  className={`rounded-lg border p-4 transition ${
                    isUser
                      ? 'bg-zinc-950/90 border-indigo-950/60 shadow-sm ml-0 md:mr-10'
                      : 'bg-zinc-900/90 border-zinc-800 ml-0 md:ml-6'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-zinc-800/60 text-[11px] font-mono">
                    <div className="flex items-center gap-2">
                      <span
                        className={`font-semibold uppercase px-1.5 py-0.5 rounded text-[10px] ${
                          isUser
                            ? 'bg-indigo-950 text-indigo-300 border border-indigo-800/60'
                            : 'bg-zinc-800 text-zinc-300'
                        }`}
                      >
                        {isUser ? '👤 User Prompt' : '🤖 Gemini Response'}
                      </span>
                      {turn.payload_type !== 'text' && (
                        <span className="text-[10px] text-amber-400 bg-amber-950/60 px-1 py-0.2 rounded border border-amber-800/50">
                          {turn.payload_type}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-zinc-500 text-[10px]">
                      {turn.token_count > 0 && <span>{turn.token_count.toLocaleString()} tok</span>}
                      {turn.timestamp && (
                        <span>{turn.timestamp.replace('T', ' ').slice(11, 19)}</span>
                      )}
                    </div>
                  </div>

                  <PromptMarkdown content={turn.text} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}