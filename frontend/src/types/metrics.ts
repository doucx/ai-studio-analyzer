export interface TurnStats {
  mean: number;
  median: number;
  p75: number;
  p90: number;
  deep_count: number;
  deep_ratio: string;
}

export interface DurStats {
  mean: number;
  median: number;
  p75: number;
  p90: number;
  max: number;
  valid_count: number;
}

export interface TokStats {
  total: number;
  mean: number;
  median: number;
  p75: number;
  p90: number;
  total_thought: number;
  thought_ratio: string;
}

export interface FrictionStats {
  branch_sessions: number;
  branch_ratio: string;
  total_retries: number;
}

export interface DailyTrendItem {
  date: string;
  total_tokens: number;
  thought_tokens: number;
  sessions: number;
  turns: number;
}

export interface MetricsSummary {
  total_sessions: number;
  total_turns: number;
  total_user_chars: number;
  turn_stats: TurnStats;
  dur_stats: DurStats;
  multi_dur_stats: {
    mean: number;
    median: number;
    p75: number;
    p90: number;
  };
  duration_tiers: {
    flash: [number, string];
    focus: [number, string];
    deep: [number, string];
    epic: [number, string];
  };
  tok_stats: TokStats;
  friction_stats: FrictionStats;
  sys_instruction_count: number;
  model_distribution: Record<string, number>;
  daily_trends?: DailyTrendItem[];
  message?: string;
}

export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
  snippet?: string;
}

export interface ConversationTurnItem {
  role: 'user' | 'model' | 'system';
  text: string;
  token_count: number;
  is_thought: boolean;
  payload_type: string;
  timestamp: string | null;
  is_edited: boolean;
  extra_metadata?: {
    mime_type?: string;
    byte_size?: number;
    display_name?: string;
    doc_id?: string;
    [key: string]: unknown;
  };
}

export interface SessionDetail extends SessionItem {
  total_user_chars: number;
  system_instruction: string;
  turns: ConversationTurnItem[];
}
