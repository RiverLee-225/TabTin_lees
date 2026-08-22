"""#11413 LLM 快照 HTTP 压测（打本机 Daphne，不走 Django test client）。

复跑：
  cd apps/tabtin_django && ./venv/bin/python manage.py shell -c \\
    \"exec(open('../../scripts/llm-snapshot-http-stress.py').read())\"

夹具前缀 ``11413-stress-``，结束必清理。不要把 token 打进日志。
"""
from __future__ import annotations

import json
import statistics
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import timedelta
from typing import Any

import urllib.error
import urllib.request

from django.contrib.auth import get_user_model
from django.utils import timezone

from apps.chat.conversation.models import ChatLLMSnapshot, ChatMessage, ChatSession
from apps.services.common.ws.handlers.relay_message_writer import _sync_write_critical_events
from apps.tabtinspace.tests.fixtures import (
    cleanup_test_organization,
    create_test_organization_with_agent,
)
from apps.users.auth.invite_gate_middleware import clear_invite_gate_cache
from apps.users.auth.models import RegistrationInviteCode, RegistrationInviteRedemption, UserSession
from apps.users.auth.session_manager import SessionManager
from apps.users.auth.utils import generate_jwt_token

PREFIX = "11413-stress-"
API_BASE = "http://127.0.0.1:6060"
SMALL_PREVIEW_CHARS = 2_000
FAT_PREVIEW_CHARS = 400_000
BASELINE_SAMPLES = 10
UNIQUE_SMALL_COUNT = 64
UNIQUE_SMALL_WORKERS = 16
UNIQUE_FAT_COUNT = 24
UNIQUE_FAT_WORKERS = 8
SAME_KEY_RACE_COUNT = 24
SAME_KEY_RACE_WORKERS = 12
UPDATE_PAIR_COUNT = 32
UPDATE_PAIR_WORKERS = 16
CANARY_INTERVAL_S = 0.08
HTTP_TIMEOUT_S = 30

User = get_user_model()


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((q / 100) * (len(ordered) - 1)))))
    return ordered[index]


def summarize(label: str, samples: list[dict[str, Any]]) -> dict[str, Any]:
    ok = [item for item in samples if item.get("ok")]
    elapsed = [float(item["elapsed_ms"]) for item in samples]
    statuses = {}
    for item in samples:
        key = str(item.get("status"))
        statuses[key] = statuses.get(key, 0) + 1
    summary = {
        "label": label,
        "n": len(samples),
        "ok": len(ok),
        "errors": len(samples) - len(ok),
        "statuses": statuses,
        "min_ms": round(min(elapsed), 1) if elapsed else 0,
        "p50_ms": round(percentile(elapsed, 50), 1) if elapsed else 0,
        "p95_ms": round(percentile(elapsed, 95), 1) if elapsed else 0,
        "p99_ms": round(percentile(elapsed, 99), 1) if elapsed else 0,
        "max_ms": round(max(elapsed), 1) if elapsed else 0,
        "mean_ms": round(statistics.fmean(elapsed), 1) if elapsed else 0,
    }
    print(
        f"[{label}] n={summary['n']} ok={summary['ok']} err={summary['errors']} "
        f"p50={summary['p50_ms']} p95={summary['p95_ms']} p99={summary['p99_ms']} "
        f"max={summary['max_ms']} statuses={statuses}"
    )
    return summary


def snapshot_body(run_id: str, *, iteration: int = 0, phase: str = "request", extra_chars: int) -> dict[str, Any]:
    return {
        "snapshot": {
            "runId": run_id,
            "iteration": iteration,
            "model": "stress-model",
            "phase": phase,
            "messages": [
                {
                    "role": "user",
                    "contentPreview": ("x" * extra_chars),
                    "charCount": extra_chars,
                }
            ],
            "messageCount": 1,
            "tools": [],
            "toolCount": 0,
            "system": {"sections": [], "charCount": 0},
            **(
                {
                    "response": {
                        "format": "text",
                        "contentPreview": "ok",
                        "charCount": 2,
                        "stopReason": "end_turn",
                    }
                }
                if phase == "response"
                else {}
            ),
        }
    }


def http_json(method: str, url: str, token: str, organization_id: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
            "X-Client-Type": "electron",
            "X-Organization-Id": organization_id,
        },
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT_S) as response:
            raw = response.read()
            elapsed_ms = (time.perf_counter() - started) * 1000
            return {
                "ok": 200 <= response.status < 300,
                "status": response.status,
                "elapsed_ms": elapsed_ms,
                "bytes": len(raw),
            }
    except urllib.error.HTTPError as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return {
            "ok": False,
            "status": exc.code,
            "elapsed_ms": elapsed_ms,
            "bytes": 0,
        }
    except Exception as exc:
        elapsed_ms = (time.perf_counter() - started) * 1000
        return {
            "ok": False,
            "status": type(exc).__name__,
            "elapsed_ms": elapsed_ms,
            "bytes": 0,
        }


def post_snapshot(session_id: str, token: str, organization_id: str, body: dict[str, Any]) -> dict[str, Any]:
    url = f"{API_BASE}/api/chat/sessions/{session_id}/llm-snapshots"
    return http_json("POST", url, token, organization_id, body)


def get_session(session_id: str, token: str, organization_id: str) -> dict[str, Any]:
    url = f"{API_BASE}/api/chat/sessions/{session_id}"
    return http_json("GET", url, token, organization_id)


def persist_once(session_id: str, user_id: str) -> dict[str, Any]:
    message_id = str(uuid.uuid4())
    events = [
        {
            "type": "agent.stream.persist_message",
            "payload": {
                "message_id": message_id,
                "role": "assistant",
                "blocks_json": [{"type": "text", "text": f"{PREFIX} persist canary"}],
            },
        }
    ]
    started = time.perf_counter()
    result = _sync_write_critical_events(
        session_id=session_id,
        thread_id=f"chat-session-{session_id}",
        user_id=user_id,
        critical_events=events,
    )
    elapsed_ms = (time.perf_counter() - started) * 1000
    return {
        "ok": bool(result.success),
        "status": "persist_ok" if result.success else "persist_fail",
        "elapsed_ms": elapsed_ms,
        "bytes": 0,
    }


def run_pool(items: list[Any], workers: int, fn) -> list[dict[str, Any]]:
    samples: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fn, item) for item in items]
        for future in as_completed(futures):
            samples.append(future.result())
    return samples


def grant_invite(user) -> None:
    invite, _ = RegistrationInviteCode.objects.get_or_create(
        code=f"{PREFIX}invite",
        defaults={"description": "11413 snapshot stress", "channel": "stress", "campaign": "11413"},
    )
    RegistrationInviteRedemption.objects.get_or_create(invite_code=invite, user=user)
    clear_invite_gate_cache(user.id)


print("== 11413 llm-snapshot HTTP stress ==")
ctx = create_test_organization_with_agent(prefix=PREFIX)
user = ctx["user"]
organization = ctx["organization"]
space = ctx["space"]
agent = ctx["agent"]
organization_id = str(organization.id)
grant_invite(user)

raw_key = f"{PREFIX}session-key-{uuid.uuid4().hex[:16]}"
UserSession.objects.create(
    user=user,
    session_key=SessionManager.hash_session_key(raw_key),
    session_type="web",
    ip_address="127.0.0.1",
    user_agent="11413-stress",
    device_info={},
    expires_at=timezone.now() + timedelta(hours=2),
    is_active=True,
)
token = generate_jwt_token(user, expire_hours=1, token_type="access", session_key=raw_key)
session = ChatSession.objects.create(
    id=uuid.uuid4(),
    user=user,
    organization_id=organization_id,
    workspace=space,
    agent=agent,
    title=f"{PREFIX}session",
    status="active",
)
session_id = str(session.id)
user_id = str(user.id)
print(f"fixture session={session_id}")

reports: list[dict[str, Any]] = []

try:
    baseline_small = [
        post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(f"{PREFIX}base-small-{i}", extra_chars=SMALL_PREVIEW_CHARS),
        )
        for i in range(BASELINE_SAMPLES)
    ]
    reports.append(summarize("baseline_small_post", baseline_small))

    baseline_get = [get_session(session_id, token, organization_id) for _ in range(BASELINE_SAMPLES)]
    reports.append(summarize("baseline_session_get", baseline_get))

    baseline_persist = [persist_once(session_id, user_id) for _ in range(BASELINE_SAMPLES)]
    reports.append(summarize("baseline_persist", baseline_persist))

    unique_small_items = [f"{PREFIX}small-{i}" for i in range(UNIQUE_SMALL_COUNT)]
    unique_small = run_pool(
        unique_small_items,
        UNIQUE_SMALL_WORKERS,
        lambda run_id: post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(run_id, extra_chars=SMALL_PREVIEW_CHARS),
        ),
    )
    reports.append(summarize("concurrent_unique_small", unique_small))

    race_run = f"{PREFIX}race-same-key"
    same_key_race = run_pool(
        list(range(SAME_KEY_RACE_COUNT)),
        SAME_KEY_RACE_WORKERS,
        lambda _i: post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(race_run, extra_chars=SMALL_PREVIEW_CHARS),
        ),
    )
    reports.append(summarize("concurrent_same_key_insert_race", same_key_race))
    race_rows = ChatLLMSnapshot.objects.filter(session_id=session_id, run_id=race_run).count()
    print(f"[concurrent_same_key_insert_race] leftover_rows={race_rows}")

    def update_pair(index: int) -> dict[str, Any]:
        run_id = f"{PREFIX}upd-{index}"
        first = post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(run_id, extra_chars=SMALL_PREVIEW_CHARS, phase="request"),
        )
        second = post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(run_id, extra_chars=SMALL_PREVIEW_CHARS, phase="response"),
        )
        return {
            "ok": first.get("ok") and second.get("ok"),
            "status": f"{first.get('status')}/{second.get('status')}",
            "elapsed_ms": float(first["elapsed_ms"]) + float(second["elapsed_ms"]),
            "bytes": int(first.get("bytes") or 0) + int(second.get("bytes") or 0),
        }

    update_pairs = run_pool(list(range(UPDATE_PAIR_COUNT)), UPDATE_PAIR_WORKERS, update_pair)
    reports.append(summarize("concurrent_request_then_response_update", update_pairs))
    updated = ChatLLMSnapshot.objects.filter(
        session_id=session_id,
        run_id__startswith=f"{PREFIX}upd-",
        snapshot_json__phase="response",
    ).count()
    print(f"[concurrent_request_then_response_update] response_rows={updated}")

    canary_gets: list[dict[str, Any]] = []
    canary_persists: list[dict[str, Any]] = []
    stop_canary = threading.Event()

    def canary_loop() -> None:
        while not stop_canary.is_set():
            canary_gets.append(get_session(session_id, token, organization_id))
            canary_persists.append(persist_once(session_id, user_id))
            stop_canary.wait(CANARY_INTERVAL_S)

    canary_thread = threading.Thread(target=canary_loop, name="11413-canary", daemon=True)
    canary_thread.start()
    fat_items = [f"{PREFIX}fat-{i}" for i in range(UNIQUE_FAT_COUNT)]
    fat_samples = run_pool(
        fat_items,
        UNIQUE_FAT_WORKERS,
        lambda run_id: post_snapshot(
            session_id,
            token,
            organization_id,
            snapshot_body(run_id, extra_chars=FAT_PREVIEW_CHARS),
        ),
    )
    stop_canary.set()
    canary_thread.join(timeout=10)
    reports.append(summarize("concurrent_unique_fat", fat_samples))
    reports.append(summarize("canary_session_get_during_fat", canary_gets))
    reports.append(summarize("canary_persist_during_fat", canary_persists))

    snapshot_rows = ChatLLMSnapshot.objects.filter(session_id=session_id).count()
    persist_rows = ChatMessage.objects.filter(session_id=session.id).count()
    print(f"[inventory] snapshot_rows={snapshot_rows} persist_rows={persist_rows}")

    verdicts = []
    fat = next(item for item in reports if item["label"] == "concurrent_unique_fat")
    get_base = next(item for item in reports if item["label"] == "baseline_session_get")
    get_load = next(item for item in reports if item["label"] == "canary_session_get_during_fat")
    persist_base = next(item for item in reports if item["label"] == "baseline_persist")
    persist_load = next(item for item in reports if item["label"] == "canary_persist_during_fat")
    race = next(item for item in reports if item["label"] == "concurrent_same_key_insert_race")
    updates = next(item for item in reports if item["label"] == "concurrent_request_then_response_update")

    if fat["errors"] == 0:
        verdicts.append("fat_unique_ok")
    else:
        verdicts.append("fat_unique_errors")
    if get_load["p95_ms"] <= max(get_base["p95_ms"] * 5, 250):
        verdicts.append("session_get_p95_ok")
    else:
        verdicts.append("session_get_p95_regressed")
    if persist_load["p95_ms"] <= max(persist_base["p95_ms"] * 5, 500):
        verdicts.append("persist_p95_ok")
    else:
        verdicts.append("persist_p95_regressed")
    if race["errors"] == 0 and race_rows == 1:
        verdicts.append("same_key_race_ok")
    else:
        verdicts.append("same_key_race_contention")
    if updates["errors"] == 0 and updated == UPDATE_PAIR_COUNT:
        verdicts.append("request_response_update_ok")
    else:
        verdicts.append("request_response_update_incomplete")

    print("VERDICT " + " ".join(verdicts))
    print("REPORT " + json.dumps({"reports": reports, "verdicts": verdicts}, ensure_ascii=False))
finally:
    from apps.tabtinspace.models import Device

    ChatLLMSnapshot.objects.filter(session_id=session_id).delete()
    ChatMessage.objects.filter(session_id=session.id).delete()
    session.delete()
    Device.objects.filter(user=user).delete()
    RegistrationInviteRedemption.objects.filter(user=user).delete()
    RegistrationInviteCode.objects.filter(code=f"{PREFIX}invite").delete()
    cleanup_test_organization(organization, delete_user=True)
    leftover = ChatLLMSnapshot.objects.filter(session_id=session_id).count()
    leftover_users = User.objects.filter(email__contains=PREFIX).count()
    print(f"cleanup leftover_snapshots={leftover} leftover_users={leftover_users}")
