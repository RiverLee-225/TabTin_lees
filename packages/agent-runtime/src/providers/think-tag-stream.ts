/**
 * MiniMax OpenAI 兼容口把思考写在 content 里的 `<think>...</think>`，
 * 而不是 delta.reasoning_content。流式 chunk 会把标签拆开，所以要跨
 * chunk 做状态机，才能拆成 thinking / text 两块。
 */

export const THINK_OPEN_TAG = '<think>';
export const THINK_CLOSE_TAG = '</think>';

export type ThinkTagMode = 'text' | 'thinking';

export interface ThinkTagScanState {
  mode: ThinkTagMode;
  hold: string;
}

export interface ThinkTagSegment {
  kind: ThinkTagMode;
  text: string;
}

export function createThinkTagScanState(): ThinkTagScanState {
  return { mode: 'text', hold: '' };
}

/** MiniMax OpenAI 兼容口才把思考嵌在 content 标签里；其它渠道字面量 `<think>` 当正文。 */
export function isMiniMaxOpenAIThinkTagModel(model: string | undefined): boolean {
  return /minimax/i.test(model ?? '');
}

function suffixTagPrefixLength(value: string, tag: string): number {
  const max = Math.min(value.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (tag.startsWith(value.slice(-length))) return length;
  }
  return 0;
}

export function pushThinkTagScan(
  state: ThinkTagScanState,
  incoming: string,
): ThinkTagSegment[] {
  if (!incoming) return [];
  state.hold += incoming;
  const segments: ThinkTagSegment[] = [];

  for (;;) {
    const tag = state.mode === 'text' ? THINK_OPEN_TAG : THINK_CLOSE_TAG;
    const tagIndex = state.hold.indexOf(tag);
    if (tagIndex >= 0) {
      const before = state.hold.slice(0, tagIndex);
      if (before) segments.push({ kind: state.mode, text: before });
      state.hold = state.hold.slice(tagIndex + tag.length);
      state.mode = state.mode === 'text' ? 'thinking' : 'text';
      continue;
    }

    const keep = suffixTagPrefixLength(state.hold, tag);
    const emit = state.hold.slice(0, state.hold.length - keep);
    if (emit) segments.push({ kind: state.mode, text: emit });
    state.hold = keep > 0 ? state.hold.slice(-keep) : '';
    break;
  }

  return segments;
}

export function flushThinkTagScan(state: ThinkTagScanState): ThinkTagSegment[] {
  if (!state.hold) return [];
  const tag = state.mode === 'text' ? THINK_OPEN_TAG : THINK_CLOSE_TAG;
  const keep = suffixTagPrefixLength(state.hold, tag);
  const text = state.hold.slice(0, state.hold.length - keep);
  state.hold = '';
  return text ? [{ kind: state.mode, text }] : [];
}
