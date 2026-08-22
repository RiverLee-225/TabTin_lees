#!/usr/bin/env node
/**
 * tabtin-web 的 workspace 依赖构建入口。
 *
 * 依赖闭包由 predev-build.mjs 从 workspace manifest 实时计算，避免手写包列表
 * 漏掉 chat/doc host runtime 等新增依赖。锁由统一入口持有。
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..', '..')
const lockRunner = path.join(root, 'scripts', 'electron', 'run-predev-build-with-lock.mjs')

// Keep one source of truth for the dependency graph. This intentionally
// excludes tabtin-web itself, so its prebuild hook cannot recurse. The runner
// owns the shared lock because this script is itself called from tabtin-web's
// prebuild hook.
execFileSync(
  process.execPath,
  [path.join(root, 'scripts/electron/run-predev-build-with-lock.mjs'), '--seed', 'tabtin-web'],
  { cwd: root, stdio: 'inherit', env: process.env },
)
