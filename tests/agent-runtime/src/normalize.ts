/**
 * 归一化模块（Replay harness）。
 *
 * 导出器（生成 baseline）和 runner（断言）共用同一份规则，避免两边漂移。
 * 归一化的目的不是掩盖差异，而是把"每次运行必变"的字段移出断言。
 */

import { createHash } from 'node:crypto';

// 顺序有意义：先替换更具体的模式（本地 ID 先于 epoch，ISO 先于纯数字）。
const REPLACEMENTS: Array<[RegExp, string]> = [
  // UUID
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<uuid>'],
  // ISO 8601 时间戳
  [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})/g, '<iso-timestamp>'],
  // 常见日期时间（2026-06-27 17:07:54 / 2026/06/27）
  [/\d{4}[-/]\d{2}[-/]\d{2}[ T]\d{2}:\d{2}(?::\d{2})?/g, '<datetime>'],
  // 运行时生成的本地 ID（message_id / block_id 等）——须在 epoch 替换之前
  [/local-blk-\d+-[A-Za-z0-9]+/g, '<local-block-id>'],
  [/local-[A-Za-z0-9]+-\d+-[A-Za-z0-9]+/g, '<local-id>'],
  // 浏览器 tab / view 等带时间戳后缀的 ID
  [/view-[A-Za-z0-9-]*\d{10,}/g, '<view-id>'],
  // epoch 毫秒（13 位）与秒（10 位），词边界防止误伤长数字串中段
  [/\b1[6-9]\d{11}\b/g, '<epoch-ms>'],
  [/\b1[6-9]\d{8}\b/g, '<epoch-s>'],
  // 耗时字段（"duration_ms": 1234 / durationMs=1234 / 约 1.9 秒）
  [/("duration(?:_ms|Ms)?"\s*:\s*)\d+(\.\d+)?/g, '$1"<duration>"'],
  [/\d+(\.\d+)?\s*(毫秒|秒|ms|s)\b/g, '<duration>'],
  // 临时输出文件路径
  [/\/(?:tmp|var\/folders)\/[^\s"']+/g, '<tmp-path>'],
  // 用户 home 下的绝对路径（machine 相关）
  [/\/Users\/[A-Za-z0-9._-]+/g, '<home>'],
  // arrival_seq / _seq
  [/("(?:arrival_seq|_seq)"\s*:\s*)\d+/g, '$1"<seq>"'],
];

export function normalizeText(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * 深度归一化任意 JSON 值：所有字符串走 normalizeText；对象键排序，
 * 保证序列化结果稳定可 hash。
 */
export function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeText(value);
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      out[key] = normalizeValue(src[key]);
    }
    return out;
  }
  return value;
}

/** 归一化后序列化再取 sha256 前 16 位——fixture 里所有 hash 字段的算法。 */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(normalizeValue(value));
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}
