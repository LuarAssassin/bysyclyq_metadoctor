"""Offline regressions for the streaming TTS adapter; no Django or SDK needed."""
import base64
import importlib.util
import json
from pathlib import Path
import sys
import threading
import types
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[2] / 'metaverse_doctor/mdapi/services/rehearsal_tts.py'
spec = importlib.util.spec_from_file_location('tts_bridge_under_test', MODULE_PATH)
bridge_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge_module)
Bridge = bridge_module.DoctorRehearsalRealtimeTTS
BridgeError = bridge_module.RehearsalRealtimeTTSError


class FakeSynthesizer:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.callback = kwargs['callback']
        self.start_event = threading.Event()
        self.complete_event = threading.Event()
        self.ws = None
        self.texts = []
        self.finish_timeout = None
        self.close_count = 0

    def streaming_call(self, text):
        if self.ws is None:
            self.ws = object()
            self.callback.on_open()
        self.texts.append(text)

    def async_streaming_complete(self, complete_timeout_millis):
        self.finish_timeout = complete_timeout_millis

    def close(self):
        self.close_count += 1
        self.on_close(None, 1000, 'closed by client')


class TTSAdapterTests(unittest.TestCase):
    def setUp(self):
        dashscope = types.ModuleType('dashscope')
        audio = types.ModuleType('dashscope.audio')
        tts = types.ModuleType('dashscope.audio.tts_v2')
        tts.SpeechSynthesizer = FakeSynthesizer
        tts.ResultCallback = type('ResultCallback', (), {})
        tts.AudioFormat = types.SimpleNamespace(PCM_24000HZ_MONO_16BIT='pcm24k')
        self.modules = patch.dict(sys.modules, {
            'dashscope': dashscope,
            'dashscope.audio': audio,
            'dashscope.audio.tts_v2': tts,
        })
        self.modules.start()
        self.addCleanup(self.modules.stop)
        self.bridge = Bridge(api_key='secret-test-key', model='qwen-audio-3.1-tts-flash',
                             voice_id='doctor-voice', ws_url='wss://example.invalid/inference')
        self.addCleanup(self.bridge.close)

    def test_streaming_pcm_preserves_format_and_finishes_asynchronously(self):
        self.bridge.start()
        client = self.bridge._client
        self.assertEqual(client.kwargs['format'], 'pcm24k')
        self.assertEqual(client.kwargs['voice'], 'doctor-voice')
        self.bridge.append_text('第一句。')
        self.bridge.append_text('**第二句。**')
        self.assertEqual(client.texts, ['第一句。', '第二句。'])
        self.bridge.finish()
        self.assertEqual(client.finish_timeout, 0)
        self.assertFalse(self.bridge._finished_event.is_set())
        pcm = b'\x00\x00\xff\x7f'
        client.callback.on_data(pcm)
        client.callback.on_data(pcm)
        client.callback.on_complete()
        client.callback.on_close()
        events = list(self.bridge.drain_until_done(max_wait_seconds=0.1))
        self.assertEqual(b''.join(base64.b64decode(e['delta']) for e in events
                                  if e['type'] == 'audio_delta'), pcm + pcm)
        self.assertIn('finished', [e['type'] for e in events])
        self.assertNotIn('error', [e['type'] for e in events])
        stats = self.bridge.get_stats()
        self.assertEqual((stats['audio_format'], stats['sample_rate'], stats['channels']),
                         ('pcm16', 24000, 1))
        self.assertEqual(stats['audio_chunk_count'], 2)
        self.assertEqual(stats['error'], '')

    def test_upstream_failure_retains_code_message_and_request_id(self):
        self.bridge.start()
        self.bridge.append_text('测试。')
        self.bridge._client.callback.on_error(json.dumps({'header': {
            'error_code': 'ModelNotFound', 'error_message': 'Model not exist.',
            'task_id': 'upstream-request-123'}}))
        self.bridge._client.callback.on_close()
        # Error must be visible before the caller drains callback events.
        error = self.bridge.get_stats()['error']
        self.assertIn('ModelNotFound', error)
        self.assertIn('Model not exist.', error)
        self.assertIn('upstream-request-123', error)
        events = list(self.bridge.drain_until_done(max_wait_seconds=0.1))
        self.assertEqual(len([e for e in events if e['type'] == 'error']), 1)
        self.assertNotIn('finished', [e['type'] for e in events])
        with self.assertRaises(BridgeError):
            self.bridge.append_text('不应继续发送。')

    def test_websocket_error_is_not_silently_swallowed_by_sdk(self):
        self.bridge.start()
        client = self.bridge._client
        client.on_error(None, RuntimeError('Model not exist.'))
        self.assertIn('Model not exist.', self.bridge.get_stats()['error'])
        self.assertTrue(client.start_event.is_set())
        self.assertTrue(client.complete_event.is_set())

    def test_unexpected_websocket_close_fails_before_server_completion(self):
        self.bridge.start()
        self.bridge.append_text('测试。')
        self.bridge._client.callback.on_data(b'\x00\x00')
        self.bridge._client.on_close(None, 1007, 'Model not exist.')
        events = list(self.bridge.drain_until_done(max_wait_seconds=0.1))
        self.assertEqual(len([e for e in events if e['type'] == 'error']), 1)
        self.assertIn('1007', self.bridge.get_stats()['error'])
        self.assertNotIn('finished', [e['type'] for e in events])

    def test_task_complete_without_audio_is_failure(self):
        self.bridge.start()
        self.bridge.append_text('测试。')
        self.bridge.finish()
        self.bridge._client.callback.on_complete()
        self.bridge._client.callback.on_close()
        events = list(self.bridge.drain_until_done(max_wait_seconds=0.1))
        self.assertIn('error', [e['type'] for e in events])
        self.assertNotIn('finished', [e['type'] for e in events])
        self.assertIn('未返回音频', self.bridge.get_stats()['error'])

    def test_missing_completion_times_out_even_after_audio_arrives(self):
        self.bridge.start()
        self.bridge.append_text('测试。')
        self.bridge.finish()
        self.bridge._client.callback.on_data(b'\x00\x00')
        events = list(self.bridge.drain_until_done(max_wait_seconds=0.1, poll_interval=0.01))
        self.assertIn('error', [e['type'] for e in events])
        self.assertIn('超时', self.bridge.get_stats()['error'])

    def test_continuous_audio_can_exceed_one_idle_window_without_truncation(self):
        clock = [0.0]
        delivered = [0]

        def sleep_and_deliver_audio(seconds):
            clock[0] += seconds
            if delivered[0] < 4:
                self.bridge._client.callback.on_data(b"\x00\x00")
                delivered[0] += 1
            else:
                self.bridge._client.callback.on_complete()
                self.bridge._client.callback.on_close()

        with patch.object(bridge_module.time, "monotonic", side_effect=lambda: clock[0]), \
                patch.object(bridge_module.time, "sleep", side_effect=sleep_and_deliver_audio):
            self.bridge.start()
            self.bridge.append_text("这段语音会持续超过一个空闲等待窗口。")
            self.bridge.finish()
            events = list(self.bridge.drain_until_done(max_wait_seconds=0.1, poll_interval=0.05))

        self.assertGreater(clock[0], 0.1)
        self.assertEqual(len([e for e in events if e["type"] == "audio_delta"]), 4)
        self.assertIn("finished", [e["type"] for e in events])
        self.assertNotIn("error", [e["type"] for e in events])
        self.assertEqual(self.bridge.get_stats()["error"], "")

    def test_intentional_close_is_idempotent_and_releases_sdk_waiter(self):
        self.bridge.start()
        self.bridge.append_text('测试。')
        client = self.bridge._client
        self.bridge.finish()
        self.bridge.close()
        self.bridge.close()
        self.assertEqual(client.close_count, 1)
        self.assertTrue(client.complete_event.is_set())
        self.assertEqual(self.bridge.get_stats()['error'], '')

    def test_no_text_does_not_start_an_empty_task_or_report_success(self):
        self.bridge.start()
        self.bridge.append_text('')
        self.bridge.finish()
        self.assertEqual(self.bridge._client.texts, [])
        self.assertIn('未收到可合成文本', self.bridge.get_stats()['error'])

    def test_error_redacts_api_key(self):
        self.bridge.start()
        self.bridge._client.on_error(None, 'bad key secret-test-key')
        self.assertNotIn('secret-test-key', self.bridge.get_stats()['error'])
        self.assertIn('[REDACTED]', self.bridge.get_stats()['error'])

    def test_missing_configuration_fails_without_connecting(self):
        self.bridge.api_key = ''
        with self.assertRaisesRegex(BridgeError, 'DASHSCOPE_API_KEY'):
            self.bridge.start()
        self.assertIsNone(self.bridge._client)


if __name__ == '__main__':
    unittest.main()
