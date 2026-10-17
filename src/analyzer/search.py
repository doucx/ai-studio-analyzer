"""
AI Studio Analyzer - 基于 Tantivy 的两阶段短语与内存微重排搜索引擎
(TantivyRescore Search Service)
"""

import html
import logging
import os
import re
from pathlib import Path
from typing import Any

from .models import PromptSession

logger = logging.getLogger(__name__)

try:
    import tantivy
except ImportError:
    tantivy = None

SCHEMA_VERSION = "3.2"

CJK_PUNCTUATION_PATTERN = re.compile(
    r"[。？！，、；：“”‘’（）《》【】…—～\s\t\r\n;,:'\"`()\[\]{}*#<>=_+\-|\\]+"
)
HAN_REGEX = re.compile(r"([\u4e00-\u9fa5]+)")
DIFF_NOISE_PATTERN = re.compile(r"^(\+{3}|\-{3}|@{2}|#{1,6}|`{3,})")
CAMEL_CASE_PATTERN = re.compile(r"[A-Z]?[a-z]+|[A-Z]+(?=[A-Z][a-z]|\d|\W|$)")
PATH_PATTERN = re.compile(
    r"[a-zA-Z0-9_\u4e00-\u9fa5\.\-]+/[a-zA-Z0-9_\u4e00-\u9fa5\.\-\/]+\.[a-zA-Z0-9]+"
)


def cjk_bigram_tokenize(text: str) -> str:
    """对包含中文的文本进行 2-Gram 字符切分，以适配 Tantivy 原生 Tokenizer"""
    if not text:
        return ""

    def replace_han(match):
        han_str = match.group(1)
        if len(han_str) <= 1:
            return f" {han_str} "
        bigrams = [han_str[i : i + 2] for i in range(len(han_str) - 1)]
        return " " + " ".join(bigrams) + " "

    expanded = HAN_REGEX.sub(replace_han, text)
    return " ".join(expanded.split())


class TantivySearchService:
    """Tantivy 两阶段微重排检索单例服务门面"""

    def __init__(self, index_dir: str = ".cache/tantivy_index"):
        self.index_dir = index_dir
        self._index = None
        self._searcher = None
        self._writer = None

    def is_available(self) -> bool:
        return tantivy is not None

    def _ensure_dependency(self):
        if not self.is_available():
            raise ImportError(
                "未检测到 tantivy 依赖，请先安装: pip install tantivy>=0.22.0"
            )

    def _build_schema(self) -> Any:
        self._ensure_dependency()
        sb = tantivy.SchemaBuilder()
        sb.add_text_field("file_id", stored=True)
        sb.add_text_field("title", stored=True, tokenizer_name="default")
        sb.add_text_field("intent_content", stored=False, tokenizer_name="default")
        sb.add_text_field("raw_intent", stored=True, tokenizer_name="raw")
        sb.add_text_field("symbol_exact", stored=True, tokenizer_name="raw")
        sb.add_text_field("symbol_text", stored=False, tokenizer_name="default")
        return sb.build()

    def _check_version_match(self) -> bool:
        ver_file = os.path.join(self.index_dir, "schema_version.txt")
        if not os.path.exists(ver_file):
            return False
        try:
            with open(ver_file, "r", encoding="utf-8") as f:
                return f.read().strip() == SCHEMA_VERSION
        except OSError:
            return False

    def init_index(self):
        """初始化或打开已有索引"""
        if not self.is_available():
            logger.warning("Tantivy 库不可用，全文检索将自动降级至 SQLite FTS5。")
            return

        index_meta_file = os.path.join(self.index_dir, "meta.json")
        if os.path.exists(index_meta_file) and self._check_version_match():
            schema = self._build_schema()
            self._index = tantivy.Index(schema, path=self.index_dir)
            self._searcher = self._index.searcher()
            return

        self.clear_index()

    def clear_index(self):
        """清空并重构索引目录结构"""
        self._ensure_dependency()
        os.makedirs(self.index_dir, exist_ok=True)
        for f in Path(self.index_dir).glob("*"):
            if f.is_file():
                try:
                    f.unlink()
                except OSError:
                    pass

        schema = self._build_schema()
        self._index = tantivy.Index(schema, path=self.index_dir)
        writer = self._index.writer(heap_size=64 * 1024 * 1024)
        writer.commit()

        ver_file = os.path.join(self.index_dir, "schema_version.txt")
        with open(ver_file, "w", encoding="utf-8") as f:
            f.write(SCHEMA_VERSION)

        self._index.reload()
        self._searcher = self._index.searcher()

    def get_writer(self, heap_size_mb: int = 128):
        """获取或创建 IndexWriter"""
        self._ensure_dependency()
        if self._index is None:
            self.init_index()
        return self._index.writer(heap_size=heap_size_mb * 1024 * 1024)

    def extract_document_features(self, s: PromptSession) -> dict[str, Any]:
        """从 PromptSession 中分层提取核心意图与符号资产"""
        turn_lines = []
        unique_symbols = set()

        for idx, t in enumerate(s.turns, start=1):
            p_type = t.payload_type
            text = (t.text or "").strip()

            if t.is_thought:
                snippet = text[:1200] if len(text) > 1200 else text
                if snippet:
                    turn_lines.append(f"[Thinking #{idx}]: {snippet}")
            elif p_type == "text" and text:
                role_label = "User" if t.role == "user" else "Model"
                turn_lines.append(f"[{role_label} #{idx}]: {text}")
                for p in PATH_PATTERN.findall(text):
                    if not p.startswith("http") and "/" in p:
                        unique_symbols.add(p.strip())
            elif p_type == "inlineFile":
                dname = t.extra_metadata.get("display_name", "") or ""
                mime = t.extra_metadata.get("mime_type", "") or ""
                label = dname or mime or "inlineFile"
                turn_lines.append(f"[附件: {label}]")
                if dname:
                    unique_symbols.add(dname.strip())
            elif p_type == "driveDocument":
                turn_lines.append(f"[挂载云盘: {text[:160]}]")

        raw_intent = "\n".join(turn_lines)
        cjk_intent = cjk_bigram_tokenize(raw_intent)
        cjk_title = cjk_bigram_tokenize(s.name or "")

        return {
            "file_id": s.file_id,
            "title": cjk_title,
            "intent_content": cjk_intent,
            "raw_intent": raw_intent[:85000],  # 满足超长文档深轮次子串定位
            "unique_symbols": list(unique_symbols),
        }

    def index_session(self, s: PromptSession, writer=None):
        """写入单个会话到 Tantivy 索引"""
        if not self.is_available():
            return

        should_close_writer = False
        if writer is None:
            writer = self.get_writer()
            should_close_writer = True

        feats = self.extract_document_features(s)
        doc = tantivy.Document()
        doc.add_text("file_id", feats["file_id"])
        doc.add_text("title", feats["title"])
        doc.add_text("intent_content", feats["intent_content"])
        doc.add_text("raw_intent", feats["raw_intent"])

        for sym in feats["unique_symbols"]:
            doc.add_text("symbol_exact", sym)
            if "/" in sym:
                basename = sym.split("/")[-1]
                if len(basename) >= 3:
                    doc.add_text("symbol_exact", basename)
            doc.add_text("symbol_text", sym.replace("/", " ").replace(".", " "))

        writer.add_document(doc)

        if should_close_writer:
            writer.commit()
            if self._index:
                self._index.reload()
                self._searcher = self._index.searcher()

    def commit_changes(self, writer=None):
        """显式提交写入并刷新检索视口"""
        if writer:
            writer.commit()
        if self._index:
            self._index.reload()
            self._searcher = self._index.searcher()

    @classmethod
    def extract_safe_terms(cls, raw_query: str) -> list[str]:
        if not raw_query:
            return []

        lines = [l.strip() for l in raw_query.splitlines() if l.strip()]
        if not lines:
            return []

        clean_words = []
        for line_str in lines:
            if DIFF_NOISE_PATTERN.match(line_str) and len(line_str) <= 8:
                continue
            cjk_line = cjk_bigram_tokenize(line_str)
            words = CJK_PUNCTUATION_PATTERN.split(cjk_line)
            for w in words:
                w_str = w.strip()
                if len(w_str) >= 2:
                    sanitized = re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fa5]", "", w_str)
                    if len(sanitized) >= 2 and sanitized not in clean_words:
                        clean_words.append(sanitized)
                if len(clean_words) >= 45:
                    break
            if len(clean_words) >= 45:
                break

        return clean_words

    @classmethod
    def build_phrase_expression(cls, raw_query: str) -> str | None:
        lines = [l.strip() for l in raw_query.splitlines() if l.strip()]
        if not lines:
            return None

        candidate_lines = []
        for l in lines:
            cleaned_l = re.sub(r"^(?:#{1,6}|[-*+>]|\d+\.)\s*", "", l).strip()
            cleaned_l = re.sub(r"(\*\*|__|\*|_|`)(.*?)\1", r"\2", cleaned_l).strip()
            if len(cleaned_l) >= 12 and not cleaned_l.startswith(("---", "+++", "@@")):
                candidate_lines.append(cleaned_l)

        if not candidate_lines:
            candidate_lines = [lines[0]]

        target_line = candidate_lines[0]
        for cl in candidate_lines:
            if re.search(r"[\u4e00-\u9fa5]", cl) and len(cl) >= 16:
                target_line = cl
                break

        clean_line = CJK_PUNCTUATION_PATTERN.sub(" ", target_line).strip()
        if not clean_line:
            return None

        cjk_expanded = cjk_bigram_tokenize(clean_line)
        tokens = cjk_expanded.split()
        if len(tokens) >= 2:
            safe = [re.sub(r"[^a-zA-Z0-9_\u4e00-\u9fa5]", "", t) for t in tokens[:16]]
            safe = [t for t in safe if t]
            if len(safe) >= 2:
                return " ".join(safe)
        return None

    def search(
        self,
        query: str,
        limit: int = 50,
        allowed_file_ids: set[str] | None = None,
    ) -> list[dict[str, Any]]:
        """
        执行两阶段微重排检索
        :param query: 搜索词或多行代码
        :param limit: 最终返回条数
        :param allowed_file_ids: 可选的元数据过滤 ID 白名单
        :return: 包含 file_id, score, raw_rank, snippet 等的结构化结果列表
        """
        self._ensure_dependency()
        if not self._searcher:
            if self._index is None:
                self.init_index()
            if self._index:
                self._searcher = self._index.searcher()
            else:
                return []

        clean_q = query.strip()
        if not clean_q:
            return []

        # =========================================================================
        # 通道 1: 路径与工程特征符号专用探测
        # =========================================================================
        has_cjk_chars = bool(re.search(r"[\u4e00-\u9fa5]", clean_q))
        has_cjk_punct = bool(
            re.search(r"[。？！，、；：“”‘’（）《》【】…—～]", clean_q)
        )

        is_path_query = (
            not has_cjk_chars
            and not has_cjk_punct
            and not ("\n" in clean_q)
            and ("/" in clean_q or clean_q.startswith("."))
            and len(clean_q.split()) <= 2
            and (
                bool(re.search(r"\.[a-zA-Z0-9_\-]+$", clean_q))
                or clean_q.endswith("/")
                or clean_q.startswith(("./", "../", "/"))
            )
        )

        if is_path_query:
            escaped_path = clean_q.replace('"', '\\"')
            basename = clean_q.split("/")[-1]
            stem_name = basename.split(".")[0]
            escaped_base = basename.replace('"', '\\"')

            camel_tokens = CAMEL_CASE_PATTERN.findall(stem_name)
            if not camel_tokens:
                camel_tokens = [stem_name]
            camel_expr = " ".join(camel_tokens)

            path_query_str = (
                f'symbol_exact:"{escaped_path}"^35.0 '
                f'OR symbol_exact:"{escaped_base}"^20.0 '
                f"OR title:({camel_expr})^15.0 "
                f"OR symbol_text:({clean_q.replace('/', ' ').replace('.', ' ')})^3.0"
            )
            try:
                parsed_path_q = self._index.parse_query(
                    path_query_str,
                    default_field_names=["symbol_exact", "title", "symbol_text"],
                )
                res = self._searcher.search(parsed_path_q, max(30, limit * 2))
                scored = []
                for score, doc_address in res.hits:
                    doc = self._searcher.doc(doc_address)
                    fid = doc.get_first("file_id")
                    if allowed_file_ids is not None and fid not in allowed_file_ids:
                        continue
                    title = doc.get_first("title") or "Untitled"
                    raw_preview = doc.get_first("raw_intent") or ""

                    title_boost = 0.0
                    title_lower = title.lower()
                    camel_hits = sum(
                        1
                        for tok in camel_tokens
                        if len(tok) >= 3 and tok.lower() in title_lower
                    )
                    title_boost += camel_hits * 25.0

                    is_core = any(
                        k in title_lower
                        for k in [
                            "设计",
                            "方案",
                            "架构",
                            "实现",
                            "规范",
                            "spec",
                            "design",
                        ]
                    )
                    if is_core and (
                        camel_hits >= 1
                        or stem_name.lower() in raw_preview[:600].lower()
                    ):
                        title_boost += 60.0

                    final_score = float(score) + title_boost
                    preview = raw_preview[:220].replace("\n", " ").strip()
                    scored.append(
                        {
                            "file_id": fid,
                            "title": title,
                            "final_score": round(final_score, 2),
                            "raw_rank": -final_score,
                            "snippet": html.escape(preview),
                        }
                    )
                scored.sort(key=lambda x: x["final_score"], reverse=True)
                return scored[:limit]
            except (ValueError, RuntimeError, OSError) as err:
                logger.debug("路径专用检索异常: %s", err)

        # =========================================================================
        # 通道 2: 阶段 1 - 多级倒排粗召回 (Top 50)
        # =========================================================================
        terms = self.extract_safe_terms(clean_q)
        if not terms:
            return []

        phrase = self.build_phrase_expression(clean_q)
        query_terms_str = " ".join(terms[:36])

        query_clauses = []
        if phrase:
            query_clauses.append(f'intent_content:"{phrase}"^25.0')
        query_clauses.append(f"intent_content:({query_terms_str})^6.0")
        query_clauses.append(f"title:({query_terms_str})^4.0")
        query_clauses.append(f"symbol_text:({query_terms_str})^2.0")

        full_query_str = " OR ".join(query_clauses)
        try:
            parsed_query = self._index.parse_query(
                full_query_str,
                default_field_names=["intent_content", "title", "symbol_text"],
            )
        except (ValueError, RuntimeError) as err:
            logger.debug("复合 DSL 解析失败，降级为普通词项查询: %s", err)
            parsed_query = self._index.parse_query(
                query_terms_str, default_field_names=["intent_content", "title"]
            )

        fetch_limit = max(50, limit * 2)
        search_result = self._searcher.search(parsed_query, fetch_limit)
        if not search_result.hits:
            return []

        # =========================================================================
        # 通道 2: 阶段 2 - 内存极速微重排 (子串完全包含 + 代码保真度加权)
        # =========================================================================
        normalized_q = re.sub(r"\s+", " ", clean_q).strip().lower()
        q_lines = [
            l.strip().lower() for l in clean_q.splitlines() if len(l.strip()) >= 4
        ]
        distinct_terms = [t.lower() for t in set(terms) if len(t) >= 2]
        total_terms = max(1, len(distinct_terms))

        scored_candidates = []

        for score, doc_address in search_result.hits:
            doc = self._searcher.doc(doc_address)
            fid = doc.get_first("file_id")
            if allowed_file_ids is not None and fid not in allowed_file_ids:
                continue

            title = doc.get_first("title") or "Untitled"
            raw_text = doc.get_first("raw_intent") or ""
            raw_lower = raw_text.lower()
            title_lower = title.lower()

            base_score = float(score)

            # A. 原生子串完全包含
            exact_matched = False
            if len(normalized_q) >= 12 and (
                normalized_q in raw_lower or normalized_q in title_lower
            ):
                exact_matched = True
            elif q_lines:
                substantive_line = None
                for l in q_lines:
                    cleaned_line = re.sub(r"^(?:#{1,6}|[-*+>]|\d+\.)\s*", "", l).strip()
                    cleaned_line = re.sub(
                        r"(\*\*|__|\*|_|`)(.*?)\1", r"\2", cleaned_line
                    ).strip()
                    is_generic = bool(
                        re.search(
                            r"^(第\s*\d+\s*章|motivation|background|overview)",
                            cleaned_line,
                        )
                    )
                    if not is_generic and len(cleaned_line) >= 16:
                        substantive_line = cleaned_line
                        break
                if substantive_line and substantive_line in raw_lower:
                    exact_matched = True

            exact_boost = 70.0 if exact_matched else 0.0

            # B. 词项覆盖率门槛
            hit_terms = sum(
                1 for t in distinct_terms if (t in raw_lower or t in title_lower)
            )
            coverage_ratio = hit_terms / total_terms

            if total_terms >= 4 and coverage_ratio < 0.35 and not exact_matched:
                coverage_multiplier = 0.2
            elif coverage_ratio >= 0.75:
                coverage_multiplier = 1.35
            else:
                coverage_multiplier = max(0.5, coverage_ratio)

            # C. 代码块结构保真度加权
            code_line_hits = 0
            total_matched_chars = 0
            if len(q_lines) >= 2:
                for line in q_lines:
                    core_code = line.strip(" ;{}()")
                    if len(core_code) >= 4 and core_code in raw_lower:
                        code_line_hits += 1
                        total_matched_chars += len(core_code)
                code_boost = (code_line_hits * 12.0) + (total_matched_chars * 0.5)
            else:
                code_boost = 0.0

            # D. 标题主题词匹配
            title_alignment = sum(
                5.0 for t in distinct_terms if len(t) >= 3 and t in title_lower
            )

            final_score = (
                (base_score * coverage_multiplier)
                + exact_boost
                + code_boost
                + title_alignment
            )
            preview = raw_text[:240].replace("\n", " ").strip()

            scored_candidates.append(
                {
                    "file_id": fid,
                    "title": title,
                    "final_score": round(final_score, 2),
                    "raw_rank": -final_score,
                    "snippet": html.escape(preview),
                }
            )

        scored_candidates.sort(key=lambda x: x["final_score"], reverse=True)
        return scored_candidates[:limit]

    def get_index_size_mb(self) -> float:
        if not os.path.exists(self.index_dir):
            return 0.0
        total_bytes = sum(
            f.stat().st_size for f in Path(self.index_dir).glob("*") if f.is_file()
        )
        return round(total_bytes / (1024 * 1024), 2)


# 全局检索服务单例
search_service = TantivySearchService()
