import { Copy, ExternalLink, FileCode, MessagesSquare, X } from 'lucide-preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { configSignal } from '../state/settings';
import { syncVersionSignal } from '../state/sync';
import { addToast } from '../state/toast';
import type { SessionDetail, SessionItem } from '../types/metrics';
import { formatLocalTime } from '../utils/date';
import {
  applyCustomHighlight,
  clearCustomHighlight,
  flashAndScrollToElement,
} from '../utils/highlight';
import { SystemInstructionCard } from './session/SystemInstructionCard';
import { TurnMessage } from './session/TurnMessage';

interface Props {
  session: SessionItem;
  onClose: () => void;
}

export function SessionDetailPanel({ session, onClose }: Props) {
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [_refreshing, setRefreshing] = useState<boolean>(false);
  const [showMetadata, setShowMetadata] = useState<boolean>(
    configSignal.value.default_show_metadata ?? true,
  );
  const [renderMarkdown, setRenderMarkdown] = useState<boolean>(
    configSignal.value.default_render_markdown ?? true,
  );
  const [isCopyingSkeleton, setIsCopyingSkeleton] = useState<boolean>(false);
  const hasScrolledRef = useRef<string | null>(null);
  const turnsContainerRef = useRef<HTMLDivElement | null>(null);

  const aiStudioUrl = `https://aistudio.google.com/prompts/${session.file_id}`;

  // 解析当前页面 Query 中的高亮词与目标行
  const searchParams = new URLSearchParams(window.location.search);
  const activeKeyword = searchParams.get('q') || '';
  const hash = window.location.hash;
  const targetTurnNumber = hash?.startsWith('#turn-') ? Number(hash.replace('#turn-', '')) : null;

  const handleCopySkeleton = async () => {
    setIsCopyingSkeleton(true);
    try {
      const res = await fetch(`/api/sessions/${session.file_id}/skeleton`);
      if (!res.ok) {
        addToast('获取数据骨架失败', 'error');
        return;
      }
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      addToast('已复制纯净 JSON 骨架到剪贴板', 'success', 3000);
    } catch (err) {
      console.error('复制骨架失败:', err);
      addToast(`复制骨架异常: ${String(err)}`, 'error');
    } finally {
      setIsCopyingSkeleton(false);
    }
  };

  const fetchSessionDetail = useCallback(
    async (isSilent = false, signal?: AbortSignal) => {
      if (!isSilent) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/sessions/${session.file_id}`, { signal });
        if (!res.ok) return;
        const data = await res.json();
        setDetail(data);
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('获取会话详情失败:', err);
        }
      } finally {
        if (!signal?.aborted) {
          if (!isSilent) {
            setLoading(false);
          } else {
            setRefreshing(false);
          }
        }
      }
    },
    [session.file_id],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    hasScrolledRef.current = null;
    fetchSessionDetail(false, controller.signal);
    return () => {
      controller.abort();
    };
  }, [fetchSessionDetail]);

  const syncVersion = syncVersionSignal.value;
  const isInitialMountRef = useRef(true);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      return;
    }
    if (syncVersion > 0) {
      const controller = new AbortController();
      fetchSessionDetail(true, controller.signal);
      return () => {
        controller.abort();
      };
    }
  }, [syncVersion, fetchSessionDetail]);

  // 类 Google 模糊高亮与精确定位闪烁机制
  // biome-ignore lint/correctness/useExhaustiveDependencies: 在会话数据加载完毕或关键词变更时触发高亮与滚动
  useEffect(() => {
    if (loading || !detail?.turns || detail.turns.length === 0) return;

    const timer = setTimeout(() => {
      if (!turnsContainerRef.current) return;

      if (activeKeyword) {
        const turnEl = targetTurnNumber
          ? document.getElementById(`turn-${targetTurnNumber}`)
          : null;

        // 优先将目标范围约束在指定的 targetTurn 内扫描
        const { targetMatchedElement } = applyCustomHighlight(
          turnsContainerRef.current,
          activeKeyword,
          turnEl,
        );

        const currentAnchor = `${window.location.hash}_${window.location.search}`;
        if (hasScrolledRef.current !== currentAnchor) {
          hasScrolledRef.current = currentAnchor;

          // 绝对优先以目标 Turn 内部命中为准；若无细粒度子节点则直接定位到该 Turn
          let targetEl: HTMLElement | null = null;
          if (turnEl) {
            targetEl = targetMatchedElement || turnEl;
          } else {
            targetEl = targetMatchedElement;
          }

          if (targetEl) {
            flashAndScrollToElement(targetEl);
          }
        }
      } else {
        clearCustomHighlight();
        // 无关键词时回退到原生 Turn 锚点滚动
        const curHash = window.location.hash;
        if (curHash?.startsWith('#turn-') && hasScrolledRef.current !== curHash) {
          hasScrolledRef.current = curHash;
          const turnEl = document.querySelector(curHash) as HTMLElement;
          if (turnEl) {
            flashAndScrollToElement(turnEl);
          }
        }
      }
    }, 180);

    return () => {
      clearTimeout(timer);
      clearCustomHighlight();
    };
  }, [loading, detail?.file_id, activeKeyword, targetTurnNumber, renderMarkdown]);

  return (
    <div className="bg-zinc-900/40 border border-zinc-800 rounded-lg flex flex-col h-full min-h-[calc(100vh-140px)]">
      {/* 头部导航与操作条 */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-3.5 bg-zinc-900/90 backdrop-blur sticky top-0 z-10 rounded-t-lg">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-white tracking-tight truncate max-w-md">
              {session.name}
            </h2>
            {session.has_branching && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-400 border border-amber-800/60 font-mono shrink-0">
                分叉 {session.branch_count} 次
              </span>
            )}
          </div>
          <p className="text-[11px] text-zinc-400 font-mono truncate">
            模型: {session.model.replace('models/', '')}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowMetadata(!showMetadata)}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition cursor-pointer"
            title="切换元数据卡片可见性"
          >
            {showMetadata ? '隐藏统计' : '显示统计'}
          </button>
          <button
            type="button"
            onClick={() => setRenderMarkdown(!renderMarkdown)}
            className={`px-2.5 py-1 text-xs font-medium rounded border transition cursor-pointer ${
              renderMarkdown
                ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border-zinc-700/80'
                : 'bg-indigo-950/80 hover:bg-indigo-900 text-indigo-300 border-indigo-700/80 font-semibold shadow-sm'
            }`}
            title="切换对话流展示模式：富文本 Markdown 渲染 vs 原生纯文本/源码"
          >
            {renderMarkdown ? '纯文本' : '渲染 Markdown'}
          </button>
          <a
            href={aiStudioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm flex items-center gap-1.5"
            title="在 Google AI Studio 原生工作台打开"
          >
            <ExternalLink size={13} />
            <span className="hidden sm:inline">在 AI Studio 打开</span>
          </a>
          <button
            type="button"
            onClick={handleCopySkeleton}
            disabled={isCopyingSkeleton}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1.5 cursor-pointer"
            title="提取剔除文本与Base64正文后的纯净数据骨架，并复制到剪贴板"
          >
            <Copy size={13} className={isCopyingSkeleton ? 'animate-pulse text-indigo-400' : ''} />
            <span className="hidden sm:inline">
              {isCopyingSkeleton ? '正在提取...' : '复制骨架'}
            </span>
          </button>
          <a
            href={`/api/sessions/${session.file_id}/raw`}
            download={`session_${session.file_id}.json`}
            className="px-2.5 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700/80 transition flex items-center gap-1.5"
            title="下载原始会话 JSON"
          >
            <FileCode size={13} />
            <span className="hidden sm:inline">下载原始 JSON</span>
          </a>
          <button
            type="button"
            onClick={onClose}
            className="px-2 py-1 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded transition border border-zinc-700/80 flex items-center gap-1"
            title="关闭详情"
          >
            <X size={13} />
            <span className="hidden sm:inline">关闭</span>
          </button>
        </div>
      </div>

      {/* 紧凑统计指标卡片 */}
      {showMetadata && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 border-b border-zinc-800/80 bg-zinc-950/40">
          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">生命周期时长</div>
            <div className="text-base font-bold text-indigo-400 font-mono mt-0.5">
              {session.duration_human}
            </div>
            <div className="text-[10px] text-zinc-500">
              {session.duration_seconds !== null && session.duration_seconds !== undefined
                ? `${session.duration_seconds} 秒`
                : '持续时间未记录'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">上下文规模 / API消耗</div>
            <div className="text-base font-bold text-emerald-400 font-mono mt-0.5">
              {session.total_tokens.toLocaleString()}
            </div>
            <div className="text-[10px] text-zinc-500" title="估算实际 API 累计算力消耗">
              累计推理:{' '}
              {(
                detail?.cumulative_tokens ??
                session.cumulative_tokens ??
                session.total_tokens
              ).toLocaleString()}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">交互 Chunks 总数</div>
            <div className="text-base font-bold text-white font-mono mt-0.5">
              {detail?.turns?.length ?? session.chunk_count ?? session.turn_count} 块
            </div>
            <div className="text-[10px] text-zinc-500">
              {(detail?.turns?.length ?? session.chunk_count ?? session.turn_count) >= 7
                ? '深度攻坚'
                : '轻量快问'}
            </div>
          </div>

          <div className="bg-zinc-900/80 border border-zinc-800/60 rounded p-2.5">
            <div className="text-[10px] text-zinc-400">最后修改时间</div>
            <div
              className="text-xs font-medium text-zinc-300 font-mono mt-1 truncate"
              title={session.modified_time || ''}
            >
              {formatLocalTime(session.modified_time)}
            </div>
            <div className="text-[10px] text-zinc-500 truncate" title={session.created_time || ''}>
              创建: {formatLocalTime(session.created_time, false)}
            </div>
          </div>
        </div>
      )}

      {/* 交互轮次流视口 */}
      <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
              <MessagesSquare size={15} className="text-indigo-400" />
              <span>交互轮次流</span>
            </h3>
            <span className="text-xs font-mono text-zinc-400 bg-zinc-800 px-2 py-0.5 rounded">
              {detail?.turns?.length ?? session.turn_count} 个 Chunks
            </span>
          </div>
        </div>

        <div ref={turnsContainerRef} className="flex-1 overflow-y-auto space-y-4 pr-1">
          {detail?.system_instruction ? (
            <SystemInstructionCard instruction={detail.system_instruction} />
          ) : null}
          {detail?.turns && detail.turns.length > 0 ? (
            detail.turns.map((turn, idx) => (
              <TurnMessage
                // biome-ignore lint/suspicious/noArrayIndexKey: 对话轮次流按时间严格保序，无需进行动态重排
                key={`turn-${idx}`}
                turn={turn}
                index={idx}
                renderMarkdown={renderMarkdown}
                isTargetTurn={targetTurnNumber === idx + 1}
              />
            ))
          ) : !detail && loading ? null : (
            <div className="py-16 text-center text-zinc-500 text-xs">暂无对话内容或数据未同步</div>
          )}
        </div>
      </div>
    </div>
  );
}
