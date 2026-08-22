import { describe, expect, it } from 'vitest';
import {
  INITIAL_STALL_TIMEOUT_MS,
  MIDSTREAM_STALL_TIMEOUT_MS,
  resolveStallTimeoutMs,
} from '../src/providers/proxy-provider.js';

describe('resolveStallTimeoutMs', () => {
  it('首字节前用 30s，避免空连接干等到 2 分钟', () => {
    expect(resolveStallTimeoutMs(false)).toBe(INITIAL_STALL_TIMEOUT_MS);
    expect(INITIAL_STALL_TIMEOUT_MS).toBe(30_000);
  });

  it('已出流后放宽到 120s，避免 glm 思考/工具间隙被当成断流', () => {
    expect(resolveStallTimeoutMs(true)).toBe(MIDSTREAM_STALL_TIMEOUT_MS);
    expect(MIDSTREAM_STALL_TIMEOUT_MS).toBe(120_000);
  });
});
