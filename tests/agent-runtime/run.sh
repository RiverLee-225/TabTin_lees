#!/usr/bin/env bash
# Replay 回归入口。
#
#   ./run.sh                     跑全部 Replay Case
#   REPLAY_RECORD=1 ./run.sh     重录 expected.json baseline
#   ./run.sh -t "回放 BASE_001"  只跑某条 case
#
# vitest 二进制借用 packages/agent-runtime 的安装（本目录不引入独立依赖）。
set -euo pipefail
cd "$(dirname "$0")"

exec ../../packages/agent-runtime/node_modules/.bin/vitest run \
  --config ./vitest.config.ts "$@"
