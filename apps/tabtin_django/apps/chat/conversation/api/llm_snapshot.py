"""LLM 调用快照 HTTP 入口。

观测旁路：把本机 snapshots.jsonl 的云端副本写入 chat_llm_snapshot，
不进对话时间线、不广播。与 WS relay 共用 persist_llm_snapshot，
旧客户端仍可走 relay_events。
"""

from __future__ import annotations

from apps.i18n import _
from apps.i18n.response import error_response_with_status, success_response

from ..schemas import UpsertLlmSnapshotRequest
from ..services.llm_snapshot import persist_llm_snapshot
from ._common import jwt_auth, logger, router, _get_session_with_shared_access


@router.post("/sessions/{session_id}/llm-snapshots", auth=jwt_auth, tags=["会话观测"])
def upsert_llm_snapshot(request, session_id: str, data: UpsertLlmSnapshotRequest):
    session, is_shared = _get_session_with_shared_access(session_id, request.auth)
    if session is None or is_shared:
        return error_response_with_status(
            "NOT_FOUND",
            message=_("chat.session_not_found"),
            status_code=404,
        )

    snapshot = data.snapshot
    if not isinstance(snapshot, dict):
        return error_response_with_status(
            "VALIDATION_ERROR",
            message="snapshot must be an object",
            status_code=400,
        )

    thread_id = (data.thread_id or "").strip() or f"chat-session-{session.id}"
    written = persist_llm_snapshot(str(session.id), thread_id, snapshot)
    if written is None:
        return error_response_with_status(
            "VALIDATION_ERROR",
            message="snapshot runId is required",
            status_code=400,
        )

    run_id, iteration = written
    logger.debug(
        "llm snapshot upserted via HTTP: session=%s run_id=%s iteration=%s",
        session.id,
        run_id,
        iteration,
    )
    return success_response(data={"run_id": run_id, "iteration": iteration})
