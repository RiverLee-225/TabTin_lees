import { describe, expect, it } from 'vitest';
import { shouldSwitchStallRetry } from '../src/engine/core/model-stream.js';

describe('shouldSwitchStallRetry', () => {
  it('stall pending 时 thinking 也切新 message，避免随后 text 把思考清掉', () => {
    const stallRetryRef = { current: true };
    expect(shouldSwitchStallRetry(stallRetryRef, { type: 'thinking', text: 'plan' })).toBe(true);
    expect(shouldSwitchStallRetry(stallRetryRef, { type: 'text_delta', text: 'ok' })).toBe(true);
    expect(shouldSwitchStallRetry(stallRetryRef, {
      type: 'tool_use',
      toolUse: { id: 'tu_1', name: 'web_search', input: {} },
    })).toBe(true);
    expect(shouldSwitchStallRetry(stallRetryRef, {
      type: 'tool_use_delta',
      toolUseDelta: { id: 'tu_1', name: 'web_search', argDelta: '{"q":' },
    })).toBe(true);
  });

  it('未 pending 或非成功 chunk 不切', () => {
    expect(shouldSwitchStallRetry({ current: false }, { type: 'thinking', text: 'plan' })).toBe(false);
    expect(shouldSwitchStallRetry({ current: true }, { type: 'stop', stopReason: 'end_turn' })).toBe(false);
    expect(shouldSwitchStallRetry({ current: true }, {
      type: 'timing',
      timing: { phase: 'proxy_http_response', elapsed_ms: 1, source: 'proxy_provider' },
    })).toBe(false);
  });
});
