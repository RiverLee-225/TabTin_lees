/**
 * ReplayLLMProvider——实现真实 runtime 的 LLMProvider 接口。
 *
 * 每次 createStream：
 *   1. 按调用序号取录制 turn；
 *   2. 对真实 LLMRequest 计算 request summary，与录制值比对；
 *   3. 漂移 → 抛 RequestDriftError（分类：prompt / tool schema / history）；
 *   4. 通过 → 依次 yield 录制的 responseChunks。
 *
 * 同时保留每轮收到的真实请求（capturedRequests），runner 用最后一轮的
 * messages 重建完整 transcript 做不变量断言——不依赖事件协议细节。
 */

import type { LLMProvider, LLMRequest, LLMResponseChunk } from './runtime-adapter.js';
import type { ReplayLLMTurn } from './fixture-types.js';
import { assertNoDrift, buildRequestSummary, type DriftCheckOptions } from './request-summary.js';

export class ReplayExhaustedError extends Error {
  constructor(callIndex: number, turnCount: number) {
    super(
      `[replay] Runtime 发起了第 ${callIndex + 1} 次 LLM 调用，但 fixture 只录制了 ${turnCount} 轮 —— ` +
        `当前代码比录制时多跑了迭代（可能是 ReAct 推进逻辑变化）`,
    );
    this.name = 'ReplayExhaustedError';
  }
}

export class ReplayLLMProvider implements LLMProvider {
  private callIndex = 0;
  readonly warnings: string[] = [];
  readonly capturedRequests: LLMRequest[] = [];

  constructor(
    private readonly turns: ReplayLLMTurn[],
    private readonly options: DriftCheckOptions = {},
  ) {}

  /** 回放结束后校验：录制的每一轮都被消费（少跑迭代也是回归）。 */
  get consumedAllTurns(): boolean {
    return this.callIndex === this.turns.length;
  }

  get consumedTurnCount(): number {
    return this.callIndex;
  }

  createStream(request: LLMRequest): AsyncIterable<LLMResponseChunk> {
    const index = this.callIndex++;
    const turn = this.turns[index];
    if (!turn) {
      throw new ReplayExhaustedError(index, this.turns.length);
    }
    this.capturedRequests.push(request);

    const actual = buildRequestSummary(request);
    const { warnings } = assertNoDrift(actual, turn.requestSummary, turn.iteration, this.options);
    for (const w of warnings) {
      this.warnings.push(`[iteration ${turn.iteration}] ${w}`);
    }

    const chunks = turn.responseChunks;
    return (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })();
  }
}
