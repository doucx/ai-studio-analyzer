/**
 * 本地时区格式化工具函数：基于浏览器原生时区能力安全转换 ISO-8601 时间串。
 */
export function formatLocalTime(isoStr: string | null | undefined, includeTime = true): string {
  if (!isoStr) return '未知';
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    if (!includeTime) {
      return d.toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    }
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    return isoStr;
  }
}
