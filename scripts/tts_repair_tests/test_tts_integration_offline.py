"""Offline contracts for the repaired enrollment call and real SSE generator body.

The generator is extracted from views.py so Django and a database are not needed;
only its external collaborators are substituted. These tests execute the actual
failure/persistence control flow, including merging SDK stats into message meta.
"""
import ast
from datetime import datetime
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2] / 'metaverse_doctor'


def load_digital_human():
    dashscope = types.ModuleType('dashscope')
    dashscope.VideoSynthesis = object()
    django = types.ModuleType('django')
    conf = types.ModuleType('django.conf')
    conf.settings = types.SimpleNamespace()
    spec = importlib.util.spec_from_file_location(
        'enrollment_under_test', ROOT / 'mdapi/services/digital_human.py')
    module = importlib.util.module_from_spec(spec)
    with patch.dict(sys.modules, {'dashscope': dashscope, 'django': django,
                                 'django.conf': conf}):
        spec.loader.exec_module(module)
    return module


class EnrollmentContractTests(unittest.TestCase):
    def setUp(self):
        self.module = load_digital_human()
        self.service = self.module.QwenDigitalHumanService.__new__(
            self.module.QwenDigitalHumanService)
        self.service.tts_target_model = 'qwen-audio-3.1-tts-flash'
        self.service.voice_enroll_url = 'https://example.invalid/customization'
        self.service._post_json = Mock(return_value={'output': {'voice_id': 'new-voice'}})

    def test_enrollment_uses_signed_sample_and_new_api_contract(self):
        result = self.service.create_voice(
            sample_url='https://private.invalid/sample.mp3?Expires=123&Signature=test',
            preferred_name='yangyp1234')
        self.assertEqual(result['voice_id'], 'new-voice')
        url, payload = self.service._post_json.call_args.args
        self.assertEqual(url, self.service.voice_enroll_url)
        self.assertEqual(payload, {'model': 'voice-enrollment', 'input': {
            'action': 'create_voice', 'target_model': 'qwen-audio-3.1-tts-flash',
            'prefix': 'yangyp1234',
            'url': 'https://private.invalid/sample.mp3?Expires=123&Signature=test',
            'language_hints': ['zh']}})

    def test_old_output_voice_does_not_silently_pass_new_contract(self):
        self.service._post_json.return_value = {'output': {'voice': 'legacy-voice'}}
        with self.assertRaisesRegex(self.module.DigitalHumanServiceError, 'voice_id'):
            self.service.create_voice('https://example.invalid/sample.mp3', 'yangyp1234')

    def test_missing_sample_does_not_make_external_request(self):
        with self.assertRaises(self.module.DigitalHumanServiceError):
            self.service.create_voice('', 'yangyp1234')
        self.service._post_json.assert_not_called()


class SpeechError(Exception):
    pass


class FakeBridge:
    fail_at = 'start'

    def __init__(self, **kwargs):
        self.error = ''

    def start(self):
        if self.fail_at == 'start':
            raise SpeechError('Model not exist. request_id=diagnostic-123')

    def append_text(self, text):
        if self.fail_at == 'append':
            raise SpeechError('Upstream append failed request_id=diagnostic-456')

    def drain_events(self):
        return []

    def finish(self):
        if self.fail_at == 'finish':
            raise SpeechError('Upstream finish failed request_id=diagnostic-789')

    def drain_until_done(self, **kwargs):
        return []

    def close(self):
        pass

    def get_stats(self):
        # Reproduces the old bug trigger: SDK statistics report empty error even
        # when the public bridge call raised a useful initialization exception.
        return {'error': '', 'audio_chunk_count': 0}


def run_patient_generator(fail_at, view_name="PatientConsultAskStreamView"):
    tree = ast.parse((ROOT / 'mdapi/views.py').read_text())
    view = next(node for node in tree.body if isinstance(node, ast.ClassDef)
                and node.name == view_name)
    post = next(node for node in view.body if isinstance(node, ast.FunctionDef)
                and node.name == 'post')
    event_stream = next(node for node in post.body if isinstance(node, ast.FunctionDef)
                        and node.name == 'event_stream')
    message = types.SimpleNamespace(id=100, meta={}, content='[生成中]', save=Mock())
    session = types.SimpleNamespace(id=12, doctor=object(), doctor_id=3, save=Mock())
    FakeBridge.fail_at = fail_at
    env = {
        'DoctorRehearsalRealtimeTTS': FakeBridge,
        'RehearsalRealtimeTTSError': SpeechError,
        'RehearsalServiceError': type('RehearsalError', (Exception,), {}),
        'settings': types.SimpleNamespace(DASHSCOPE_API_KEY='test-key'),
        'enable_audio': True,
        'request': types.SimpleNamespace(user=object()),
        '_resolve_latest_doctor_voice': lambda doctor: ('new-voice', 'new-model', 'yangyuping'),
        '_to_sse_event': lambda event, payload: (event, payload),
        'session': session,
        'assistant_msg': message,
        'user_msg': types.SimpleNamespace(id=99),
        'selected_file_ids': [], 'selected_meta': [],
        'grounding_result': {'sources': [], 'answer': ''},
        'message_attachments': [], 'final_messages': [], 'forced_search': False,
        'rehearsal': types.SimpleNamespace(
            answer_model='test-llm',
            stream_final_answer=lambda **kwargs: iter([
                {'type': 'delta', 'delta': '您好。'},
                {'type': 'done', 'content': '您好。', 'usage': {}}])),
        '_is_patient_stream_cancelled': lambda message_id: False,
        '_strip_non_clickable_footnotes': lambda text, **kwargs: text,
        'selected': {'reason': ''},
        'timezone': types.SimpleNamespace(now=datetime.now),
        '_clear_patient_stream_cancel_flag': Mock(),
    }
    exec(compile(ast.fix_missing_locations(ast.Module(
        body=[event_stream], type_ignores=[])), str(ROOT / 'mdapi/views.py'), 'exec'), env)
    events = list(env['event_stream']())
    return message, events


class PatientErrorPersistenceTests(unittest.TestCase):
    view_name = 'PatientConsultAskStreamView'

    def assert_failure_persisted(self, phase, text):
        message, events = run_patient_generator(phase, self.view_name)
        self.assertEqual(message.generation_status, 'succeeded')
        self.assertEqual(message.content, '您好。')
        self.assertEqual(message.meta['audio']['status'], 'failed')
        self.assertIn(text, message.meta['audio']['error'])
        message.save.assert_called_once()
        errors = [payload for event, payload in events if event == 'audio_error']
        self.assertEqual(len(errors), 1)
        done = [payload for event, payload in events if event == 'done']
        self.assertEqual(len(done), 1)
        self.assertEqual(done[0]['audio']['error'], message.meta['audio']['error'])

    def test_initialization_error_survives_empty_sdk_error_in_stats(self):
        self.assert_failure_persisted('start', 'Model not exist.')

    def test_append_error_survives_empty_sdk_error_in_stats(self):
        self.assert_failure_persisted('append', 'Upstream append failed')

    def test_finish_error_survives_empty_sdk_error_in_stats(self):
        self.assert_failure_persisted('finish', 'Upstream finish failed')


class DoctorErrorPersistenceTests(PatientErrorPersistenceTests):
    view_name = 'DoctorRehearsalAskStreamView'


if __name__ == '__main__':
    unittest.main()
