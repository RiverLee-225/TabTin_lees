"""relay LLM 快照写入器——`agent.stream.llm_snapshot` → `chat_llm_snapshot`。

旧客户端仍可能经 WS 上云；新客户端改走 HTTP
``POST /chat/sessions/{id}/llm-snapshots``。两边共用
``conversation.services.llm_snapshot.persist_llm_snapshot``。

设计：
  - **detail 级 fire-and-forget**：不阻塞 relay ACK、失败不 NAK。
  - **不进 TraceEvent / 不广播**。
  - **幂等**：`(session_id, run_id, iteration)` upsert。
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from channels.db import database_sync_to_async

from apps.chat.conversation.services.llm_snapshot import (
    cap_snapshot_size,
    persist_llm_snapshot,
)

logger = logging.getLogger(__name__)

# 旧测试与内部调用仍用私有别名。
_persist_llm_snapshot = persist_llm_snapshot
_cap_snapshot_size = cap_snapshot_size

_async_persist_llm_snapshot = database_sync_to_async(
    persist_llm_snapshot, thread_sensitive=False,
)


_BACKGROUND_SNAPSHOT_TASKS: set[asyncio.Task] = set()
_MAX_BACKGROUND_SNAPSHOT_TASKS = 200


def spawn_llm_snapshot_writes(
    session_id: str,
    thread_id: str,
    snapshot_events: list[dict[str, Any]],
) -> int:
    """fire-and-forget 异步写一批 llm_snapshot 事件。返回实际启动的 task 数。"""
    started = 0
    for evt in snapshot_events:
        if not isinstance(evt, dict):
            continue
        payload = evt.get("payload") or {}
        if not isinstance(payload, dict):
            continue

        if len(_BACKGROUND_SNAPSHOT_TASKS) >= _MAX_BACKGROUND_SNAPSHOT_TASKS:
            logger.warning(
                "[RelayLLMSnapshotWriter] task pool full: capacity=%d dropped session=%s",
                _MAX_BACKGROUND_SNAPSHOT_TASKS, session_id,
            )
            continue

        coro = _async_persist_llm_snapshot(session_id, thread_id, payload)

        async def _run(c=coro, sid=session_id):
            try:
                await c
            except Exception:
                logger.warning(
                    "[RelayLLMSnapshotWriter] background persist exception: session=%s",
                    sid, exc_info=True,
                )

        task = asyncio.create_task(_run(), name=f"llm_snapshot_{session_id[:8]}")
        _BACKGROUND_SNAPSHOT_TASKS.add(task)
        task.add_done_callback(_BACKGROUND_SNAPSHOT_TASKS.discard)
        started += 1
    return started


__all__ = ["spawn_llm_snapshot_writes"]
