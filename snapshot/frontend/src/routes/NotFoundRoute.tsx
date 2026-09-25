import { useLocation } from 'preact-iso';

export function NotFoundRoute() {
  const { route } = useLocation();

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-16 text-center">
      <div className="text-5xl mb-4">🔍</div>
      <h2 className="text-lg font-bold text-zinc-200">页面不存在</h2>
      <p className="text-xs text-zinc-500 mt-1 mb-6">您访问的路由或会话路径未找到</p>
      <button
        type="button"
        onClick={() => route('/')}
        className="px-4 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white rounded transition shadow-sm"
      >
        返回全景大盘
      </button>
    </div>
  );
}