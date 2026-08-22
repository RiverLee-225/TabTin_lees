"""智谱 GLM 直连代理策略。

复用 OpenAI 兼容 Chat Completions；只补官方要求的流式工具参数。
https://docs.bigmodel.cn/cn/guide/capabilities/stream-tool
"""

from __future__ import annotations

from typing import Any

from apps.services.llm.providers.openai.service import OpenAIService


class ZhipuService(OpenAIService):
    """OpenAI 兼容层 + GLM `tool_stream`。"""

    @classmethod
    def prepare_proxy_request(
        cls,
        body: dict[str, Any],
        *,
        session_id: str = "",
        incoming_body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = super().prepare_proxy_request(
            body,
            session_id=session_id,
            incoming_body=incoming_body,
        )
        # 默认 tool_stream=false：arguments 攒完才给一个 chunk。
        # GLM 规划长工具时上游可静默一两分钟，客户端会当 stall 整段重拉。
        if payload.get("stream") and payload.get("tools"):
            payload["tool_stream"] = True
        return payload
