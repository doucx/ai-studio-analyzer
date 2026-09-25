好的，这个分析切中了问题的核心。当前 `reindex` 耗时达 8 分钟以及数据库膨胀至 2.7 GB 的直接原因正是 FTS5 Trigram 分词器对长文本与未截断附件的组合爆炸。

我将为 `cache.py` 中的 `upsert_session_fts` 建立多层防御护栏（单轮截断、附件过滤、整会话首尾截断硬上限），随后通过 `reindex_cli.py` 重新生成索引并执行 VACUUM 瘦身。

## [WIP] fix(cache): 建立 FTS5 Trigram 截断护栏以解决索引膨胀与重建卡顿

### 错误分析

1. **Trigram 分词爆炸**: `session_fts` 使用了 `tokenize = 'trigram'`，当用户单条会话存在几十万乃至百万字符时，Trigram 需生成与字符量同级的倒排记录。极端样本（如 90MB JSON、100 万字符文本）导致单条插入耗时从几毫秒飙升至数秒。
2. **巨型附件渗透**: 尽管此前对 `inlineFile` 做了简单处理，但如果含有超大文本文件或 Base64 解码后的巨型 Dump，其内容被完整或过长地喂入了 FTS 索引表。
3. **物理存储膨胀**: 倒排索引吞噬了超过 2 GB 的数据库页面，直接导致 B-Tree 索引页面缓存命中率骤降，加剧了 I/O 负担与 `quick_check` 校验延迟。

### 用户需求

1. 在 `src/analyzer/cache.py` 中为 `upsert_session_fts` 增设安全护栏：
   - 过滤与限制 `inlineFile` 附件内容，禁止将大文本 Dump 喂入分词器。
   - 对单轮对话内容设置合理长度截断。
   - 对单条会话供全文检索的总内容建立首尾截断硬上限（30,000 ~ 50,000 字符）。
2. 执行索引重建与 VACUUM 压缩，使数据库体积显著下降，大幅提升重建吞吐。

### 评论

这是典型的全文检索边界保护问题。对于本地个人审计工作台，会话的检索关键词（如意图、首轮 Prompt、错误提示、末轮总结）绝大部分分布在首尾部分。引入字符护栏既能保留 99% 以上的有效检索精度，又能彻底斩断长尾“毒丸”会话引发的计算与存储灾难。

### 目标

1. 精确修改 `src/analyzer/cache.py` 的 `upsert_session_fts` 方法，增加单轮截断（3,000 ~ 6,000 字符）、附件元数据化（最多保留 200 字符预览）以及总长首尾硬截断（40,000 字符，保留前 25,000 与后 15,000 字符）。
2. 运行 `reindex_cli.py` 重建全量索引，并执行 `VACUUM` 回收释放磁盘空间。

### 基本原理

1. **分层防爆**:
   - **附件层**: 将 `inlineFile` 限制为仅索引其文件名、MIME 类型和最多 200 字符预览。
   - **轮次层**: 单轮 Model/User 输出截断为最多 6,000 字符，Thinking 思考链截断为 3,000 字符。
   - **会话层**: 总长度超过 40,000 字符时，保留前 25,000 字符（核心初始上下文与首轮意图）和后 15,000 字符（最新迭代进展与收尾输出），中间插入截断提示。
2. **存储瘦身**: 重建后 SQLite 丢弃了海量无用的 Trigram 索引条目，随后触发 `VACUUM` 整理空闲页（Freelist），将数据库文件缩减回轻量级别。

### 标签

#intent/fix #flow/ready #priority/high #comp/engine #concept/state #scope/core #ai/instruct #task/domain/storage #task/object/fts-indexer #task/action/optimization #task/state/begin

---

### Script

#### Acts 1: 为 FTS5 建立内容截断与巨型附件防护护栏

修改 `src/analyzer/cache.py`，强化 `upsert_session_fts` 的边界防护。

~~~~~act
patch_file
src/analyzer/cache.py
~~~~~
~~~~~python.old
    def upsert_session_fts(self, s: Any):
        """将单个会话的全部对话正文物化写入 FTS5 虚拟表"""
        turn_texts = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            if getattr(t, "is_thought", False):
                turn_texts.append(f"[Thinking #{idx}]: {t.text}")
            elif getattr(t, "payload_type", "text") == "text" and t.text:
                role_label = "User" if t.role == "user" else "Model"
                turn_texts.append(f"[{role_label} #{idx}]: {t.text}")
            elif getattr(t, "payload_type", "text") == "inlineFile":
                dname = (
                    t.extra_metadata.get("display_name", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                turn_texts.append(f"[附件: {dname}] {t.text[:500]}")
            elif getattr(t, "payload_type", "text") == "driveDocument":
                turn_texts.append(f"[挂载云盘: {t.text}]")

        full_content = "\n".join(turn_texts)
        sys_inst = getattr(s, "system_instruction", "") or ""

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM session_fts WHERE file_id = ?;", (s.file_id,))
            cursor.execute(
                """
                INSERT INTO session_fts (file_id, title, system_instruction, content)
                VALUES (?, ?, ?, ?);
                """,
                (s.file_id, s.name, sys_inst, full_content),
            )
            conn.commit()
~~~~~
~~~~~python.new
    def upsert_session_fts(
        self,
        s: Any,
        max_total_chars: int = 40_000,
        head_chars: int = 25_000,
        tail_chars: int = 15_000,
    ):
        """
        将单个会话的全部对话正文物化写入 FTS5 虚拟表。
        配置安全护栏：
        1. 排除二进制与巨型附件全文，严格截取短元数据预览；
        2. 单轮消息截断限制，防止单轮巨型日志/代码击穿分词器；
        3. 单会话总字符硬上限截断 (默认 40,000 字符，取首尾保留关键上下文)，阻断 Trigram 倒排膨胀。
        """
        turn_texts = []
        for idx, t in enumerate(getattr(s, "turns", []), start=1):
            p_type = getattr(t, "payload_type", "text")
            text = (getattr(t, "text", "") or "").strip()

            if getattr(t, "is_thought", False):
                snippet = text[:3000] if len(text) > 3000 else text
                if snippet:
                    turn_texts.append(f"[Thinking #{idx}]: {snippet}")
            elif p_type == "text" and text:
                role_label = "User" if t.role == "user" else "Model"
                snippet = text[:6000] if len(text) > 6000 else text
                turn_texts.append(f"[{role_label} #{idx}]: {snippet}")
            elif p_type == "inlineFile":
                dname = (
                    t.extra_metadata.get("display_name", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                mime = (
                    t.extra_metadata.get("mime_type", "")
                    if getattr(t, "extra_metadata", None)
                    else ""
                )
                label = dname or mime or "inlineFile"
                preview = text[:200].replace("\n", " ").strip() if text else ""
                turn_texts.append(f"[附件: {label}] {preview}")
            elif p_type == "driveDocument":
                turn_texts.append(f"[挂载云盘: {text[:200]}]")

        full_content = "\n".join(turn_texts)
        if len(full_content) > max_total_chars:
            full_content = (
                full_content[:head_chars]
                + f"\n...[已截断 {len(full_content) - max_total_chars} 字符以保护 FTS 索引]...\n"
                + full_content[-tail_chars:]
            )

        sys_inst = (getattr(s, "system_instruction", "") or "").strip()
        if len(sys_inst) > 10_000:
            sys_inst = sys_inst[:10_000]

        with self._get_connection() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM session_fts WHERE file_id = ?;", (s.file_id,))
            cursor.execute(
                """
                INSERT INTO session_fts (file_id, title, system_instruction, content)
                VALUES (?, ?, ?, ?);
                """,
                (s.file_id, s.name, sys_inst, full_content),
            )
            conn.commit()
~~~~~

### 下一步建议

1. **健康度复检**: 运行 `python inspect_health.py` 验证数据库体积（预期从 2.7 GB 降至数百 MB 级别）以及 `PRAGMA quick_check` 耗时是否降至 1~2 秒内。
2. **检索回归验证**: 在前端搜索栏输入常见关键词与代码片段，验证 FTS5 搜索召回率与 Snippet 命中高亮是否正常。
3. **提交变更**: 验证无误后，创建 `[COMMIT]` 计划将此次性能防御护栏提交至 Git 版本库。
