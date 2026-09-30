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
  cumulative_total?: number;
  expansion_factor?: string;
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

export interface TokenBreakdown {
  user_net_tokens: number;
  context_file_tokens: number;
  sys_instruction_tokens: number;
  model_net_tokens: number;
  thought_tokens: number;
  user_chars: number;
}

export interface QuantileLadder {
  min: number;
  p10: number;
  p50: number;
  p75: number;
  p90: number;
  p99: number;
  max: number;
}

export interface BreakdownQuantiles {
  user_net: QuantileLadder;
  context_files: QuantileLadder;
  model_net: QuantileLadder;
  thought: QuantileLadder;
  user_chars: QuantileLadder;
}

export interface DailyTrendItem {
  date: string;
  total_tokens: number;
  cumulative_tokens?: number;
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
  token_breakdown?: TokenBreakdown;
  breakdown_quantiles?: BreakdownQuantiles;
  friction_stats: FrictionStats;
  sys_instruction_count: number;
  model_distribution: Record<string, number>;
  daily_trends?: DailyTrendItem[];
  trend_granularity?: 'day' | 'hour';
  single_date?: string;
  message?: string;
}

export interface SearchLineItem {
  line_no: number;
  is_hit: boolean;
  text: string;
}

export interface SearchSiblingPreview {
  role: 'user' | 'model' | 'thinking' | string;
  text: string;
}

export interface SearchMatchItem {
  turn_index: number;
  role: 'user' | 'model' | 'thinking' | string;
  lines: SearchLineItem[];
  sibling?: SearchSiblingPreview | null;
}

export interface SessionItem {
  file_id: string;
  name: string;
  model: string;
  turn_count: number;
  chunk_count?: number;
  total_tokens: number;
  cumulative_tokens?: number;
  thought_tokens: number;
  duration_human: string;
  duration_seconds: number | null;
  has_branching: boolean;
  branch_count: number;
  first_prompt: string;
  modified_time: string | null;
  created_time: string | null;
  snippet?: string;
  search_matches?: SearchMatchItem[];
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
    data?: string;
    [key: string]: unknown;
  };
}

export interface SessionDetail extends SessionItem {
  total_user_chars: number;
  system_instruction: string;
  turns: ConversationTurnItem[];
}

export interface DailySessionBrief {
  file_id: string;
  name: string;
  model: string;
  duration: string;
  duration_seconds: number | null;
  tokens: number;
  thought_tokens: number;
  first_prompt: string;
  time_local: string;
}

export interface DailyTimelineItem {
  date: string;
  total_duration_seconds: number;
  total_duration_human: string;
  total_tokens: number;
  thought_tokens: number;
  session_count: number;
  sessions: DailySessionBrief[];
}

export interface HourlySlotItem {
  hour: number;
  label: string;
  tokens: number;
  thought_tokens: number;
  chunks: number;
  sessions: number;
}

export interface PunchcardCellItem {
  weekday: number; // 0=周一, 6=周日
  hour: number; // 0~23
  tokens: number;
  thought_tokens: number;
  chunks: number;
}

export interface HourlyStatsSummary {
  hourly_slots: HourlySlotItem[];
  peak_hour: number;
  peak_tokens: number;
  total_chunks: number;
  punchcard_matrix?: PunchcardCellItem[];
  max_cell_tokens?: number;
  max_cell_chunks?: number;
  max_cell_thought?: number;
}
