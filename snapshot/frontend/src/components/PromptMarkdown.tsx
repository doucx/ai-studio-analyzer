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