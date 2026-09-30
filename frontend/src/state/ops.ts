import { signal } from '@preact/signals';
import type { SessionItem } from '../types/metrics';
import { addToast } from './toast';

export interface TerminalLogItem {
  id: string;
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export interface OpsProgress {
  current: number;
  total: number;
  percent: number;
  speed?: string;
  wal_human?: string;
  wal_bytes?: number;
  success?: number;
  failed?: number;
  hits?: number;
  downloaded?: number;
}

export interface HealthDiagnostics {
  physical: {
    db_size: number;
    db_size_human: string;
    wal_size: number;
    wal_size_human: string;
    freelist_bytes: number;
    freelist_human: string;
    frag_ratio: number;
    integrity_check: string;
    check_time_seconds: number;
    page_count: number;
    page_size: number;
  };
  schema_counts: {
    file_cache: number;
    session_index: number;
    session_fts: number;
    is_aligned: boolean;
  };
  quantiles: {
    turns: Record<string, number>;
    tokens: Record<string, number>;
    thought: Record<string, number>;
    duration: Record<string, number>;
    chars: Record<string, number>;
  };
  cognitive_buckets: {
    context_buckets: {
      under_8k: number;
      '8k_32k': number;
      '32k_128k': number;
      over_128k: number;
    };
    turn_buckets: {
      single: number;
      light: number;
      deep: number;
      epic: number;
    };
    thinking: {
      sessions: number;
      ratio: number;
      sum_thought_tokens: number;
    };
    friction: {
      branch_sessions: number;
      total_retries: number;
    };
    total_sessions: number;
  };
  outliers: {
    largest_files: {
      file_id: string;
      name: string;
      byte_len: number;
      byte_len_human: string;
      turn_count: number;
      total_tokens: number;
    }[];
    top_tokens: {
      file_id: string;
      name: string;
      total_tokens: number;
      thought_tokens: number;
      turn_count: number;
    }[];
    top_turns: {
      file_id: string;
      name: string;
      turn_count: number;
      duration_human: string;
      total_tokens: number;
    }[];
  };
}

export interface SchemaDiagnostics {
  total_records: number;
  sampled_records: number;
  top_level_keys: { key: string; count: number; ratio: number }[];
  payload_types: { type: string; count: number }[];
  shapes: { id: number; sample_file_ids: string[]; shape: unknown }[];
}

export const activeJobIdSignal = signal<string | null>(null);
export const activeTaskNameSignal = signal<string | null>(null);
export const isJobRunningSignal = signal<boolean>(false);
export const terminalLogsSignal = signal<TerminalLogItem[]>([]);
export const terminalProgressSignal = signal<OpsProgress | null>(null);
export const terminalOpenSignal = signal<boolean>(false);

export const healthDiagnosticsSignal = signal<HealthDiagnostics | null>(null);
export const healthLoadingSignal = signal<boolean>(false);

export const schemaDiagnosticsSignal = signal<SchemaDiagnostics | null>(null);
export const schemaLoadingSignal = signal<boolean>(false);

export const outlierDrawerSessionSignal = signal<SessionItem | null>(null);
export const vacuumResultSignal = signal<{ freed_human: string; duration_seconds: number } | null>(
  null,
);

let activeEventSource: EventSource | null = null;

export function addTerminalLog(
  message: string,
  level: 'info' | 'warn' | 'error' | 'success' = 'info',
) {
  const item: TerminalLogItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: new Date().toLocaleTimeString(),
    level,
    message,
  };
  terminalLogsSignal.value = [...terminalLogsSignal.value, item];
}

export function clearTerminalLogs() {
  terminalLogsSignal.value = [];
  terminalProgressSignal.value = null;
}

export function connectOpsStream(jobId: string, taskLabel: string) {
  if (activeEventSource) {
    activeEventSource.close();
    activeEventSource = null;
  }

  activeJobIdSignal.value = jobId;
  activeTaskNameSignal.value = taskLabel;
  isJobRunningSignal.value = true;
  terminalOpenSignal.value = true;

  const es = new EventSource(`/api/ops/stream/${jobId}`);
  activeEventSource = es;

  es.addEventListener('log', (e) => {
    try {
      const data = JSON.parse(e.data);
      addTerminalLog(data.message, data.level || 'info');
    } catch {
      addTerminalLog(e.data, 'info');
    }
  });

  es.addEventListener('progress', (e) => {
    try {
      terminalProgressSignal.value = JSON.parse(e.data);
    } catch {
      // 忽略
    }
  });

  es.addEventListener('done', (_e) => {
    isJobRunningSignal.value = false;
    addTerminalLog('任务执行成功完成！', 'success');
    addToast(`${taskLabel} 已成功执行完毕`, 'success');
    es.close();
    activeEventSource = null;
  });

  es.addEventListener('aborted', (_e) => {
    isJobRunningSignal.value = false;
    addTerminalLog('任务已安全中止并截断保存！', 'warn');
    addToast(`${taskLabel} 已中止`, 'warning');
    es.close();
    activeEventSource = null;
  });

  es.addEventListener('error', (e) => {
    if (isJobRunningSignal.value) {
      addTerminalLog(`通道异常或任务失败: ${e.type}`, 'error');
    }
    isJobRunningSignal.value = false;
    es.close();
    activeEventSource = null;
  });
}

export async function abortCurrentJob(): Promise<boolean> {
  const jobId = activeJobIdSignal.value;
  if (!jobId) return false;

  addTerminalLog('正在向后端发送优雅中断指令...', 'warn');
  try {
    const res = await fetch(`/api/ops/${jobId}/abort`, { method: 'POST' });
    if (res.ok) {
      addTerminalLog('中断信号已成功接收，正在等待安全刷盘...', 'warn');
      return true;
    }
    addTerminalLog('任务中断失败或任务已提早结束', 'error');
    return false;
  } catch (err) {
    addTerminalLog(`中断网络异常: ${String(err)}`, 'error');
    return false;
  }
}

export async function triggerOpsReindex(batchSize = 300, vacuum = true) {
  if (isJobRunningSignal.value) {
    addToast('当前已有运维任务正在执行中，请先等待或中止', 'warning');
    return;
  }

  addTerminalLog(`提交重建索引任务 (Batch Checkpoint: ${batchSize}, Vacuum: ${vacuum})...`);
  try {
    const res = await fetch(`/api/ops/reindex?batch_size=${batchSize}&vacuum=${vacuum}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      addToast(err.detail || '启动重建任务失败', 'error');
      return;
    }
    const data = await res.json();
    connectOpsStream(data.job_id, '索引与全文重整');
  } catch (err) {
    addToast(`请求失败: ${String(err)}`, 'error');
  }
}

export async function triggerOpsSync(limit = 50, allFiles = false) {
  if (isJobRunningSignal.value) {
    addToast('当前已有运维任务正在执行中，请先等待或中止', 'warning');
    return;
  }

  const label = allFiles ? '全量全库拉取' : `增量同步(${limit}篇)`;
  addTerminalLog(`提交云端同步请求: ${label}...`);
  try {
    const res = await fetch(`/api/ops/sync?limit=${limit}&all_files=${allFiles}`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json();
      addToast(err.detail || '启动同步任务失败', 'error');
      return;
    }
    const data = await res.json();
    connectOpsStream(data.job_id, `云端同步 (${label})`);
  } catch (err) {
    addToast(`请求失败: ${String(err)}`, 'error');
  }
}

export async function triggerOpsCheckpoint() {
  try {
    const res = await fetch('/api/ops/wal-checkpoint?truncate=true', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      addToast(`WAL Checkpoint 完成 (已写入 ${data.checkpointed_pages} 页)`, 'success');
      return true;
    }
    const err = await res.json();
    addToast(`WAL 截断失败: ${err.detail || '未知原因'}`, 'error');
    return false;
  } catch (err) {
    addToast(`请求异常: ${String(err)}`, 'error');
    return false;
  }
}

export async function triggerOpsVacuum() {
  try {
    const res = await fetch('/api/ops/vacuum', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      vacuumResultSignal.value = {
        freed_human: data.freed_human,
        duration_seconds: data.duration_seconds,
      };
      addToast(`VACUUM 整理成功！释放磁盘空间 ${data.freed_human}`, 'success');
      return true;
    }
    const err = await res.json();
    addToast(`VACUUM 失败: ${err.detail || '未知原因'}`, 'error');
    return false;
  } catch (err) {
    addToast(`请求异常: ${String(err)}`, 'error');
    return false;
  }
}

export async function runHealthDiagnostic() {
  healthLoadingSignal.value = true;
  try {
    const res = await fetch('/api/ops/diagnostics/health', { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      healthDiagnosticsSignal.value = data;
      addToast('健康度全景诊断完成', 'success');
    } else {
      const err = await res.json();
      addToast(`诊断失败: ${err.detail || '服务器异常'}`, 'error');
    }
  } catch (err) {
    addToast(`诊断网络异常: ${String(err)}`, 'error');
  } finally {
    healthLoadingSignal.value = false;
  }
}

export async function runSchemaDiagnostic(sampleLimit?: number) {
  schemaLoadingSignal.value = true;
  try {
    const url = sampleLimit
      ? `/api/ops/diagnostics/schema?sample_limit=${sampleLimit}`
      : '/api/ops/diagnostics/schema';
    const res = await fetch(url, { method: 'POST' });
    if (res.ok) {
      const data = await res.json();
      schemaDiagnosticsSignal.value = data;
      addToast('Schema 拓扑采样完成', 'success');
    } else {
      const err = await res.json();
      addToast(`采样失败: ${err.detail || '服务器异常'}`, 'error');
    }
  } catch (err) {
    addToast(`采样网络异常: ${String(err)}`, 'error');
  } finally {
    schemaLoadingSignal.value = false;
  }
}

export function openOutlierSession(fileId: string, name: string) {
  outlierDrawerSessionSignal.value = {
    file_id: fileId,
    name: name || '离群样本',
    model: 'unknown',
    turn_count: 0,
    total_tokens: 0,
    thought_tokens: 0,
    duration_human: '未知',
    duration_seconds: null,
    has_branching: false,
    branch_count: 0,
    first_prompt: '',
    modified_time: null,
    created_time: null,
  };
}

export function closeOutlierSession() {
  outlierDrawerSessionSignal.value = null;
}
