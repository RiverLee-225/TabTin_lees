"""LLM 调用快照落库（#5430）。

本地 `snapshots.jsonl` 的云端副本。WS relay 与 HTTP 入口共用本模块，
避免观测数据再占对话落库通道时出现两套写入逻辑。
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)

# 单条快照落库上限（JSON 序列化后估算）。WS 整帧上限 1MB；HTTP 入口沿用同一
# 兜底，超限时丢明细留计数，避免异常客户端把超大行写进 PG。
LLM_SNAPSHOT_MAX_JSON_BYTES = 900_000
# HTTP 整包上限（含 {"snapshot": ...} 信封），与 WS 1MB 帧对齐；中间件按
# Content-Length 在入解析前拒绝。
LLM_SNAPSHOT_HTTP_MAX_BODY_BYTES = 1_000_000
HTTP_STATUS_PAYLOAD_TOO_LARGE = 413


def persist_llm_snapshot(
    session_id: str,
    thread_id: str,
    payload: dict[str, Any],
) -> tuple[str, int] | None:
    """幂等写入 ``chat_llm_snapshot``。缺 runId 则跳过并返回 None。"""
    from apps.chat.conversation.models import ChatLLMSnapshot

    run_id = str(payload.get("runId") or payload.get("run_id") or "").strip()
    if not run_id:
        logger.warning(
            "[LlmSnapshot] drop snapshot without runId: session=%s", session_id,
        )
        return None
    iteration_raw = payload.get("iteration")
    iteration = iteration_raw if isinstance(iteration_raw, int) else 0
    model = str(payload.get("model") or "")[:128]

    snapshot = cap_snapshot_size(payload)

    ChatLLMSnapshot.objects.update_or_create(
        session_id=session_id,
        run_id=run_id[:64],
        iteration=iteration,
        defaults={
            "thread_id": str(thread_id or "")[:128],
            "model": model,
            "snapshot_json": snapshot,
        },
    )
    return run_id[:64], iteration


def cap_snapshot_size(payload: dict[str, Any]) -> dict[str, Any]:
    """超限兜底：正常快照原样入库；异常超大快照丢明细留摘要。"""
    try:
        size = len(json.dumps(payload, ensure_ascii=False))
    except (TypeError, ValueError):
        return {"truncated_in_server": True, "reason": "unserializable"}
    if size <= LLM_SNAPSHOT_MAX_JSON_BYTES:
        return payload
    capped = dict(payload)
    capped.pop("messages", None)
    capped.pop("tools", None)
    capped.pop("system", None)
    capped["truncated_in_server"] = True
    capped["original_json_bytes"] = size
    return capped
