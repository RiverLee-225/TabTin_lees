import { describe, expect, it } from 'vitest';
import {
  createThinkTagScanState,
  flushThinkTagScan,
  isMiniMaxOpenAIThinkTagModel,
  pushThinkTagScan,
} from '../src/providers/think-tag-stream.js';

function collect(chunks: string[]): { kind: string; text: string }[] {
  const state = createThinkTagScanState();
  const out: { kind: string; text: string }[] = [];
  for (const chunk of chunks) out.push(...pushThinkTagScan(state, chunk));
  out.push(...flushThinkTagScan(state));
  return out;
}

describe('think-tag-stream', () => {
  it('把 MiniMax 整段 content 拆成 thinking + text', () => {
    const segments = collect([
      '<think>用户想做一个网站</think>\n\n我来帮你做一个网站。',
    ]);
    expect(segments).toEqual([
      { kind: 'thinking', text: '用户想做一个网站' },
      { kind: 'text', text: '\n\n我来帮你做一个网站。' },
    ]);
  });

  it('跨 chunk 拼开标签', () => {
    const segments = collect(['<th', 'ink>先想', '一下</thi', 'nk>回答']);
    expect(segments.filter((s) => s.kind === 'thinking').map((s) => s.text).join('')).toBe('先想一下');
    expect(segments.filter((s) => s.kind === 'text').map((s) => s.text).join('')).toBe('回答');
  });

  it('未闭合的 think 在 flush 时仍算思考', () => {
    const state = createThinkTagScanState();
    expect(pushThinkTagScan(state, '<think>还在想')).toEqual([
      { kind: 'thinking', text: '还在想' },
    ]);
    expect(flushThinkTagScan(state)).toEqual([]);
  });

  it('flush 丢掉半截标签，不把残片算进思考', () => {
    const state = createThinkTagScanState();
    expect(pushThinkTagScan(state, '<think>还在想</thi')).toEqual([
      { kind: 'thinking', text: '还在想' },
    ]);
    expect(flushThinkTagScan(state)).toEqual([]);
  });

  it('只认 MiniMax 模型名才扫标签', () => {
    expect(isMiniMaxOpenAIThinkTagModel('MiniMax-M3')).toBe(true);
    expect(isMiniMaxOpenAIThinkTagModel('minimax-m2.7')).toBe(true);
    expect(isMiniMaxOpenAIThinkTagModel('kimi-k2.5')).toBe(false);
    expect(isMiniMaxOpenAIThinkTagModel(undefined)).toBe(false);
  });
});
