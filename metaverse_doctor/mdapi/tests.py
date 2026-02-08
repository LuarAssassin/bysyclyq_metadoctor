from django.test import SimpleTestCase

from mdapi.services.digital_human import (
    DigitalHumanServiceError,
    QwenDigitalHumanService,
    _obj_get,
    _to_plain_dict,
)


class DashScopeLikeResponse(dict):
    """Simulate dashscope DictMixin: missing attr raises KeyError instead of AttributeError."""

    def __getattr__(self, attr):
        return self[attr]


class DigitalHumanServiceHelperTests(SimpleTestCase):
    def test_to_plain_dict_handles_dashscope_style_response(self):
        response = DashScopeLikeResponse(
            status_code=200,
            request_id="req-1",
            output={"task_id": "task-1"},
        )
        data = _to_plain_dict(response)
        self.assertEqual(data["status_code"], 200)
        self.assertEqual(data["output"]["task_id"], "task-1")

    def test_obj_get_returns_default_when_key_missing(self):
        response = DashScopeLikeResponse(status_code=200)
        self.assertEqual(_obj_get(response, "missing", "fallback"), "fallback")

    def test_parse_video_response_with_dashscope_style_response(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        response = DashScopeLikeResponse(
            status_code=200,
            request_id="req-2",
            output=DashScopeLikeResponse(
                task_id="task-2",
                task_status="SUCCEEDED",
                video_url="https://example.com/video.mp4",
            ),
        )
        result = service._parse_video_response(response, "图生视频任务提交失败")
        self.assertEqual(result["task_id"], "task-2")
        self.assertEqual(result["task_status"], "succeeded")
        self.assertEqual(result["video_url"], "https://example.com/video.mp4")
        self.assertEqual(result["raw"]["request_id"], "req-2")

    def test_parse_video_response_raises_on_non_200(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        response = DashScopeLikeResponse(
            status_code=400,
            code="InvalidParameter",
            message="bad request",
        )
        with self.assertRaises(DigitalHumanServiceError):
            service._parse_video_response(response, "图生视频任务提交失败")

    def test_build_i2v_prompt_variants_with_custom_prompt(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        service.i2v_prompt_template = "默认提示词"
        service.i2v_prompt_variants = [
            {"key": "talking_explain", "name": "健康讲解", "prompt": "讲解场景"},
            {"key": "idle_standby", "name": "待机轻动", "prompt": "待机场景"},
        ]
        variants = service.build_i2v_prompt_variants(
            custom_prompt="语速慢一些",
            count=2,
        )
        self.assertEqual(len(variants), 2)
        self.assertEqual(variants[0]["scene_key"], "talking_explain")
        self.assertEqual(variants[1]["scene_name"], "待机轻动")
        self.assertIn("补充要求：语速慢一些", variants[0]["prompt"])

    def test_build_i2v_prompt_variants_clamps_count(self):
        service = QwenDigitalHumanService.__new__(QwenDigitalHumanService)
        service.i2v_prompt_template = "默认提示词"
        service.i2v_prompt_variants = [
            {"key": "a", "name": "A", "prompt": "A场景"},
            {"key": "b", "name": "B", "prompt": "B场景"},
        ]
        variants = service.build_i2v_prompt_variants(count=10)
        self.assertEqual(len(variants), 2)
