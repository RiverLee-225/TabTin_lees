from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from apps.services.llm.providers.zhipu.service import ZhipuService
from apps.services.llm.services.proxy_service import ProxyContext, apply_provider_request_policy


class ZhipuPrepareProxyRequestTests(SimpleTestCase):
    def test_stream_plus_tools_enables_tool_stream(self):
        body = ZhipuService.prepare_proxy_request(
            {
                "model": "glm-5.2",
                "messages": [],
                "stream": True,
                "tools": [{"type": "function", "function": {"name": "read_file"}}],
            },
        )
        self.assertTrue(body["tool_stream"])

    def test_no_tools_does_not_set_tool_stream(self):
        body = ZhipuService.prepare_proxy_request(
            {"model": "glm-5.2", "messages": [], "stream": True},
        )
        self.assertNotIn("tool_stream", body)

    @patch(
        "apps.services.llm.registry.ProviderRegistry.get_service_class",
        return_value=ZhipuService,
    )
    def test_proxy_policy_injects_tool_stream(self, get_service_class):
        ctx = ProxyContext(
            session_id="s1",
            provider=SimpleNamespace(provider_key="zhipu", name="zhipu"),
        )
        body = apply_provider_request_policy(
            {
                "model": "glm-5.2",
                "messages": [],
                "stream": True,
                "tools": [{"type": "function", "function": {"name": "read_file"}}],
            },
            ctx,
        )
        self.assertTrue(body["tool_stream"])
        get_service_class.assert_called_once_with("zhipu")

    def test_coding_plan_provider_key_uses_zhipu_service(self):
        # BYOK preset provider_key=zhipu_coding_plan；不能只认 registry 主名 zhipu。
        import apps.services.llm.providers.zhipu.register  # noqa: F401

        ctx = ProxyContext(
            session_id="s1",
            provider=SimpleNamespace(
                provider_key="zhipu_coding_plan",
                name="zhipu_coding_plan",
            ),
        )
        body = apply_provider_request_policy(
            {
                "model": "glm-5.3",
                "messages": [],
                "stream": True,
                "tools": [{"type": "function", "function": {"name": "read_file"}}],
            },
            ctx,
        )
        self.assertTrue(body["tool_stream"])
