"""对话与测试连接必须打同一条 OpenAI 兼容上游 path。"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from apps.services.llm.services.proxy_service import (
    UPSTREAM_CHAT_COMPLETIONS_PATH,
    compose_upstream_chat_url,
    probe_upstream_chat,
)


class ProxyProbeAlignmentTests(SimpleTestCase):
    def test_compose_url_matches_conversation_path(self):
        self.assertEqual(
            compose_upstream_chat_url("https://api.minimaxi.com/v1"),
            "https://api.minimaxi.com/v1/chat/completions",
        )
        self.assertEqual(UPSTREAM_CHAT_COMPLETIONS_PATH, "/chat/completions")

    @patch("apps.services.llm.services.proxy_service.build_upstream_config")
    @patch("apps.services.llm.services.proxy_service._get_upstream_client")
    def test_minimax_token_plan_probe_posts_chat_completions_without_generation(
        self,
        get_client,
        build_config,
    ):
        build_config.return_value = {
            "api_key": "sk-cp-test",
            "api_base": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-M2.7",
            "key_obj": None,
        }
        response = MagicMock()
        response.status_code = 400
        response.text = "messages is required"
        client = MagicMock()
        client.post.return_value = response
        get_client.return_value = client

        model = SimpleNamespace(id="model-minimax", model_name="MiniMax-M2.7")
        result = probe_upstream_chat(model, level=1)

        self.assertTrue(result["valid"])
        self.assertEqual(result["details"]["probe_mode"], "no_generation")
        client.post.assert_called_once()
        posted_url = client.post.call_args.args[0]
        posted_body = client.post.call_args.kwargs["json"]
        self.assertEqual(posted_url, "https://api.minimaxi.com/v1/chat/completions")
        self.assertNotIn("/v1/messages", posted_url)
        self.assertEqual(posted_body["messages"], [])
        self.assertEqual(posted_body["max_tokens"], 0)

    @patch("apps.services.llm.services.proxy_service.build_upstream_config")
    @patch("apps.services.llm.services.proxy_service._get_upstream_client")
    def test_probe_surfaces_upstream_http_error(self, get_client, build_config):
        build_config.return_value = {
            "api_key": "sk-cp-test",
            "api_base": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-M2.7",
            "key_obj": None,
        }
        response = MagicMock()
        response.status_code = 404
        response.text = "404 page not found"
        client = MagicMock()
        client.post.return_value = response
        get_client.return_value = client

        result = probe_upstream_chat(SimpleNamespace(id="model-minimax"), level=1)

        self.assertFalse(result["valid"])
        self.assertEqual(result["status_code"], 404)
        self.assertEqual(result["error_code"], "upstream_error")

    @patch("apps.services.llm.services.proxy_service.build_upstream_config")
    @patch("apps.services.llm.services.proxy_service._get_upstream_client")
    def test_probe_surfaces_auth_error(self, get_client, build_config):
        build_config.return_value = {
            "api_key": "sk-cp-bad",
            "api_base": "https://api.minimaxi.com/v1",
            "model_name": "MiniMax-M2.7",
            "key_obj": None,
        }
        response = MagicMock()
        response.status_code = 401
        response.text = "login fail"
        client = MagicMock()
        client.post.return_value = response
        get_client.return_value = client

        result = probe_upstream_chat(SimpleNamespace(id="model-minimax"), level=1)

        self.assertFalse(result["valid"])
        self.assertEqual(result["status_code"], 401)
        self.assertEqual(result["error_code"], "upstream_auth_error")
