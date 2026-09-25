import { MessagesSquare } from 'lucide-preact';
import { useLocation, useRoute } from 'preact-iso';
import { useMemo } from 'preact/hooks';
import { SessionDetailPanel } from '../components/SessionDetailPanel';
import { VirtualSessionList } from '../components/VirtualSessionList';
import { sessionsLoadingSignal, sessionsSignal, sidebarCollapsedSignal } from '../state/session';
import type { SessionItem } from '../types/metrics';

export function SessionsRoute() {
  const { params } = useRoute();
  const { route } = useLocation();

  const sessions = sessionsSignal.value;
  const isLoading = sessionsLoadingSignal.value;
  const isSidebarCollapsed = sidebarCollapsedSignal.value;
  const selectedId = params.id || null;

  // 根据 URL 的 :id 参数匹配当前会话实体
  const currentSession = useMemo<SessionItem | null>(() => {
    if (!selectedId || sessions.length === 0) return null;
    return sessions.find((s) => s.file_id === selectedId) || null;
  }, [selectedId, sessions]);

  const handleSelectSession = (s: SessionItem) => {
    route(`/sessions/${s.file_id}`);
  };

  const handleCloseDetail = () => {
    route('/sessions');
  };

  return (
    <div
      className={`flex-1 flex flex-col lg:flex-row overflow-hidden p-4 md:p-6 gap-6 w-full mx-auto transition-all duration-300 ${
        isSidebarCollapsed ? 'max-w-full px-6' : 'max-w-7xl'
      }`}
    >
      {/* 左侧：5000+ 虚拟列表会话检索器 */}
      {!isSidebarCollapsed && (
        <aside className="w-full lg:w-[380px] h-[520px] lg:h-[calc(100vh-120px)] flex-shrink-0">
          <VirtualSessionList
            sessions={sessions}
            selectedId={selectedId}
            onSelect={handleSelectSession}
          />
        </aside>
      )}

      {/* 右侧：单会话详情 或 空状态引导 */}
      <main className="flex-1 overflow-y-auto lg:h-[calc(100vh-120px)] pr-1 w-full flex flex-col">
        {isLoading && sessions.length === 0 ? (
          <div className="py-24 text-center text-zinc-500 text-sm animate-pulse">
            正在载入会话工作台索引...
          </div>
        ) : currentSession ? (
          <SessionDetailPanel session={currentSession} onClose={handleCloseDetail} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-zinc-800/80 bg-zinc-900/30 rounded-lg">
            <div className="p-3.5 rounded-full bg-zinc-900 border border-zinc-800 text-indigo-400 mb-3">
              <MessagesSquare size={28} />
            </div>
            <h3 className="text-base font-semibold text-zinc-300">会话工作台已就绪</h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-sm leading-relaxed">
              请在左侧列表中选择任意会话，查看包含完整 Markdown
              呈现、内联附件、思考链与分支追踪的详细对话流。
            </p>
          </div>
        )}
      </main>
    </div>
  );
}