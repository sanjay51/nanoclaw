export interface StatusData {
  assistant: string;
  channels: ChannelInfo[];
  groups: GroupSummary[];
  tasks: TaskSummary[];
  chats: ChatSummary[];
}

export interface ChannelInfo {
  name: string;
  connected: boolean;
  groups: GroupSummary[];
}

export interface GroupSummary {
  jid: string;
  name: string;
  folder: string;
  isMain: boolean;
  trigger: string;
  requiresTrigger: boolean;
}

export interface GroupDetail extends GroupSummary {
  containerConfig: { timeout?: number; additionalMounts?: unknown[] } | null;
  added_at: string;
}

export interface TaskSummary {
  id: string;
  prompt: string;
  group: string;
  chatJid: string;
  type: string;
  value: string;
  contextMode: string;
  status: string;
  nextRun: string | null;
  lastRun: string | null;
  lastResult: string | null;
}

export interface TaskDetail {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script?: string;
  schedule_type: string;
  schedule_value: string;
  context_mode: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
}

export interface TaskRunLog {
  id: number;
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: string;
  result: string | null;
  error: string | null;
}

export interface ChatSummary {
  jid: string;
  name: string;
  last_message_time: string;
  channel: string;
  is_group: number;
  lastActivity?: string; // from /api/status
}

export interface SessionInfo {
  folder: string;
  sessionId: string;
}

export interface MessageItem {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me: number;
  is_bot_message: number;
}

export interface SseEvent {
  type: 'message' | 'typing';
  chatJid?: string;
  text?: string;
  timestamp?: string;
  isTyping?: boolean;
}
