export function relTime(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return 'in ' + humanDur(-diff);
  if (diff < 60000) return 'just now';
  return humanDur(diff) + ' ago';
}

export function humanDur(ms: number): string {
  if (ms < 60000) return Math.floor(ms / 1000) + 's';
  if (ms < 3600000) return Math.floor(ms / 60000) + 'm';
  if (ms < 86400000) return Math.floor(ms / 3600000) + 'h';
  return Math.floor(ms / 86400000) + 'd';
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '-';
  return new Date(iso).toLocaleString();
}

export function renderMarkdown(text: string): string {
  let s = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  return s;
}
