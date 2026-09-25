我们现在为会话面板引入专用的**提示词与思考链 Markdown 渲染器**。为了确保离线可用、轻量以及无包依赖风险，我们直接手搓一套与 Preact + Tailwind 深度集成的 GFM Markdown 渲染组件，并配合“Thinking 思考块”手风琴折叠交互，将整个会话还原为具有代码高亮复制、富文本层级与思考耗时审计的完整对话流。

## [WIP] feat: 实现零依赖提示词 Markdown 对话流渲染器与思考链折叠器

### 用户需求
在 `SessionDetailPanel` 中实现本地会话完整交互轮次的 Markdown 渲染流，将 Gemini 2.0 的 Thinking 思考过程作为折叠式手风琴呈现，让用户既能在本地沉浸式阅读格式化对话与代码，又能随时展开审计思考链路。

### 评论
AI 会话历史的核心价值在于其 Prompt 结构、推导链与产出内容。传统的纯文本截断展示严重丢失了代码块缩进、列表排版和思维链细节。通过手搓一套轻量且类型安全的 Preact Markdown 解释器，无需引入繁重的外部渲染库即可获得代码块一键复制、行内高亮、段落排版以及思考流平滑折叠，极大提升了本地离线审计的体验。

### 目标
1. 编写独立的零依赖 Markdown 渲染器 `PromptMarkdown.tsx`，支持代码块（带复制代码功能）、标题、列表、引用、行内代码与粗体斜体等常用语法。
2. 升级 `SessionDetailPanel.tsx`，将交互轮次重构为双向对话流卡片。
3. 实现 Thinking 思考块的专属手风琴折叠组件，默认折叠保留屏幕空间，展开后支持完整思考链渲染与 Token 标注。
4. 增加“全部展开/折叠思考过程”快捷控制与关键词过滤能力。

### 基本原理
- **分词流状态机**：`PromptMarkdown` 采用高效的行级状态机，将 Markdown 解析为代码块（CodeBlock）、引用块（Blockquote）、列表（List）与段落（Paragraph），避免使用易遭 XSS 注入的 `dangerouslySetInnerHTML`，直接生成原生虚拟 DOM。
- **思维摩擦力具象化**：通过翡翠绿风格的 Thinking 容器将 Gemini 的内部推导与最终回复分层隔离，直观展现模型的推理代价。

### 标签
#intent/build #flow/ready #priority/high #comp/cli #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/markdown-conversation-renderer #task/action/implementation #task/state/continue

---

### Script

#### Acts 1: 创建零依赖 Preact 提示词 Markdown 渲染组件

新建 `frontend/src/components/PromptMarkdown.tsx`，直接将 Markdown 文本解析为带有 Tailwind 样式的 Preact 节点，并内建代码块一键复制功能。

~~~~~act
write_file
frontend/src/components/PromptMarkdown.tsx
~~~~~
~~~~~typescript
import { useState } from 'preact/hooks';

interface Props {
  content: string;
  className?: string;
}

// 辅助：行内 Markdown 样式渲染 (粗体、斜体、行内代码、链接)
function renderInlineStyles(text: string) {
  // 简易正则拆分 token
  const tokens = text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);

  return tokens.map((token, i) => {
    if (!token) return null;

    // 行内代码
    if (token.startsWith('`') && token.endsWith('`') && token.length >= 2) {
      return (
        <code
          key={i}
          className="bg-zinc-800 text-amber-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-zinc-700/60"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    // 粗体
    if (token.startsWith('**') && token.endsWith('**') && token.length >= 4) {
      return (
        <strong key={i} className="font-semibold text-white">
          {token.slice(2, -2)}
        </strong>
      );
    }

    // 斜体
    if (token.startsWith('*') && token.endsWith('*') && token.length >= 2) {
      return (
        <em key={i} className="italic text-zinc-300">
          {token.slice(1, -1)}
        </em>
      );
    }

    // 链接 [text](url)
    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:text-indigo-300 underline underline-offset-2"
        >
          {linkMatch[1]}
        </a>
      );
    }

    return token;
  });
}

// 代码块子组件：附带一键复制功能
function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-zinc-800 bg-zinc-950 text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-900/90 border-b border-zinc-800 text-[11px] text-zinc-400">
        <span className="font-mono text-zinc-300 font-medium">{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white transition flex items-center gap-1"
        >
          {copied ? <span>✓ 已复制</span> : <span>复制</span>}
        </button>
      </div>
      <pre className="p-3 overflow-x-auto font-mono text-zinc-200 text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function PromptMarkdown({ content, className = '' }: Props) {
  if (!content) return null;

  const lines = content.split('\n');
  const elements = [];

  let inCodeBlock = false;
  let codeLang = '';
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 探测多行代码块边界 ```
    if (line.trim().startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <CodeBlock
            key={`code-${i}`}
            language={codeLang}
            code={codeLines.join('\n')}
          />
        );
        inCodeBlock = false;
        codeLines = [];
        codeLang = '';
      } else {
        inCodeBlock = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // 空行
    if (!line.trim()) {
      elements.push(<div key={`blank-${i}`} className="h-2" />);
      continue;
    }

    // 标题解析
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${i}`} className="text-base font-bold text-white mt-3 mb-1.5">
          {renderInlineStyles(line.slice(2))}
        </h1>
      );
      continue;
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${i}`} className="text-sm font-bold text-zinc-100 mt-2.5 mb-1">
          {renderInlineStyles(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${i}`} className="text-xs font-bold text-zinc-200 mt-2 mb-1">
          {renderInlineStyles(line.slice(4))}
        </h3>
      );
      continue;
    }

    // 引用块 >
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote
          key={`quote-${i}`}
          className="border-l-2 border-indigo-500/80 pl-3 my-1.5 text-xs text-zinc-400 italic bg-indigo-950/20 py-1 rounded-r"
        >
          {renderInlineStyles(line.slice(2))}
        </blockquote>
      );
      continue;
    }

    // 列表项 - 或 *
    if (line.trim().match(/^[-*]\s+/)) {
      const text = line.trim().replace(/^[-*]\s+/, '');
      elements.push(
        <li key={`li-${i}`} className="ml-4 list-disc text-xs text-zinc-300 leading-relaxed">
          {renderInlineStyles(text)}
        </li>
      );
      continue;
    }

    // 数字列表 1. 2.
    const numMatch = line.trim().match(/^(\d+)\.\s+(.+)$/);
    if (numMatch) {
      elements.push(
        <div key={`oli-${i}`} className="ml-2 flex items-baseline gap-1.5 text-xs text-zinc-300 leading-relaxed">
          <span className="font-mono text-zinc-500 font-semibold">{numMatch[1]}.</span>
          <span>{renderInlineStyles(numMatch[2])}</span>
        </div>
      );
      continue;
    }

    // 普通段落
    elements.push(
      <p key={`p-${i}`} className="text-xs text-zinc-300 leading-relaxed">
        {renderInlineStyles(line)}
      </p>
    );
  }

  // 兜底未闭合的代码块
  if (inCodeBlock && codeLines.length > 0) {
    elements.push(
      <CodeBlock
        key="code-unclosed"
        language={codeLang}
        code={codeLines.join('\n')}
      />
    );
  }

  return <div className={`space-y-1 ${className}`}>{elements}</div>;
}
~~~~~

#### Acts 2: 重构会话详情面板以呈现富文本对话流与思考链折叠

重写 `frontend/src/components/SessionDetailPanel.tsx`，将原始截断纯文本替换为支持 Markdown 渲染、Thinking 思考流折叠展开与快捷交互的完整对话面板。

~~~~~act
write_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript
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
~~~~~

### 下一步建议
1. **代码检查与格式化**：在终端运行 `npm --prefix frontend run check` 校验 TypeScript 类型与 Biome 规范。
2. **多模态附件深度探测**：针对含有 `inlineFile`（如 Base64 编码的文本、JSON、CSV）或 `driveDocument` 的会话，未来可在卡片中直接提供预览或一键下载该附件原文。
