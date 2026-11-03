"""Offline voice upload and active-profile regressions; upstream calls are mocked."""
import io
import wave
from unittest.mock import Mock, patch

from django.conf import settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from mdapi.models import CustomUser, DoctorVoiceProfile
from mdapi.services.digital_human import DigitalHumanServiceError
from mdapi.views import DoctorDigitalVoiceView, _resolve_latest_doctor_voice


def wav_file(seconds=6, rate=24000, channels=1, width=2):
    output = io.BytesIO()
    with wave.open(output, 'wb') as writer:
        writer.setnchannels(channels)
        writer.setsampwidth(width)
        writer.setframerate(rate)
        writer.writeframes(b'\x00' * (int(seconds * rate) * channels * width))
    return SimpleUploadedFile('sample.wav', output.getvalue(), content_type='audio/wav')


class VoiceWorkflowTests(TestCase):
    def setUp(self):
        self.doctor = CustomUser.objects.create_user(username='voice_workflow_doctor', password=None,
                                                     is_doctor=True, is_active=True, doctor_apply_status='approved')
        self.previous = self.profile('previous', active=True)
        self.factory = APIRequestFactory()
        self.oss = Mock()
        self.oss.upload_file.return_value = {
            'object_key': 'doctor-digital-human/voice-samples/test/new.wav',
            'oss_url': 'https://example.invalid/new.wav',
            'content_type': 'audio/wav', 'size_bytes': 288044, 'etag': 'test',
        }
        self.oss.build_signed_get_url.return_value = 'https://example.invalid/new.wav?signed=temporary'
        self.service = Mock()
        self.service.create_voice.return_value = {'voice_id': 'voice-new'}
        self.addCleanup(patch.stopall)
        patch('mdapi.views.get_oss_client', return_value=self.oss).start()
        patch('mdapi.views.get_digital_human_service', return_value=self.service).start()

    def profile(self, suffix, active):
        return DoctorVoiceProfile.objects.create(
            doctor=self.doctor, name=suffix, preferred_name='voice',
            target_model=settings.DIGITAL_HUMAN_TTS_TARGET_MODEL,
            qwen_voice_id='voice-' + suffix, sample_file_name=suffix + '.wav',
            sample_object_key='samples/' + suffix + '.wav',
            sample_oss_url='https://example.invalid/' + suffix + '.wav',
            sample_content_type='audio/wav', sample_size_bytes=288044,
            is_active=active, status='ready')

    def post(self, file, **extra):
        request = self.factory.post('/api/doctor/digital-human/voice/', {'audio': file, **extra}, format='multipart')
        force_authenticate(request, self.doctor)
        return DoctorDigitalVoiceView.as_view()(request)

    def test_active_voice_wins_over_newer_inactive_voice(self):
        self.profile('newer-inactive', active=False)
        self.assertEqual(_resolve_latest_doctor_voice(self.doctor)[0], self.previous.qwen_voice_id)

    def test_no_active_voice_uses_configured_default(self):
        self.previous.is_active = False
        self.previous.save(update_fields=['is_active', 'updated_at'])
        self.assertEqual(_resolve_latest_doctor_voice(self.doctor)[:2],
                         (settings.DIGITAL_HUMAN_DEFAULT_VOICE, settings.DIGITAL_HUMAN_TTS_TARGET_MODEL))

    def test_oversize_file_is_rejected_before_external_calls(self):
        response = self.post(SimpleUploadedFile('large.wav', b'0' * (11 * 1024 * 1024), content_type='audio/wav'))
        self.assertEqual(response.status_code, 400)
        self.oss.upload_file.assert_not_called()
        self.service.create_voice.assert_not_called()

    def test_unsupported_container_is_rejected_before_external_calls(self):
        response = self.post(SimpleUploadedFile('sample.webm', b'webm', content_type='audio/webm'))
        self.assertEqual(response.status_code, 400)
        self.oss.upload_file.assert_not_called()

    def test_empty_audio_is_rejected(self):
        response = self.post(SimpleUploadedFile('empty.wav', b'', content_type='audio/wav'))
        self.assertEqual(response.status_code, 400)
        self.service.create_voice.assert_not_called()

    def test_wav_over_sixty_seconds_is_rejected(self):
        self.assertEqual(self.post(wav_file(seconds=61)).status_code, 400)
        self.oss.upload_file.assert_not_called()

    def test_wav_below_sixteen_khz_is_rejected(self):
        self.assertEqual(self.post(wav_file(rate=8000)).status_code, 400)
        self.oss.upload_file.assert_not_called()

    def test_wav_requires_sixteen_bit_pcm(self):
        self.assertEqual(self.post(wav_file(width=1)).status_code, 400)
        self.oss.upload_file.assert_not_called()

    def test_valid_upload_uses_current_model_and_replaces_active_voice(self):
        response = self.post(wav_file())
        self.assertEqual(response.status_code, 201, response.data)
        profile = DoctorVoiceProfile.objects.get(qwen_voice_id='voice-new')
        self.assertEqual(profile.target_model, settings.DIGITAL_HUMAN_TTS_TARGET_MODEL)
        self.service.create_voice.assert_called_once_with(
            sample_url='https://example.invalid/new.wav?signed=temporary',
            preferred_name=profile.preferred_name, target_model=settings.DIGITAL_HUMAN_TTS_TARGET_MODEL)
        self.previous.refresh_from_db()
        self.assertFalse(self.previous.is_active)
        self.assertEqual(_resolve_latest_doctor_voice(self.doctor)[0], 'voice-new')

    def test_inactive_upload_does_not_change_selected_voice(self):
        response = self.post(wav_file(), set_active='false')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(_resolve_latest_doctor_voice(self.doctor)[0], self.previous.qwen_voice_id)

    def test_provider_failure_keeps_existing_voice_active(self):
        self.service.create_voice.side_effect = DigitalHumanServiceError('upstream failed')
        self.assertEqual(self.post(wav_file()).status_code, 500)
        self.previous.refresh_from_db()
        self.assertTrue(self.previous.is_active)

    def test_database_insert_failure_rolls_back_active_replacement(self):
        with patch('mdapi.views.DoctorVoiceProfile.objects.create', side_effect=RuntimeError('insert failed')):
            self.assertEqual(self.post(wav_file()).status_code, 500)
        self.previous.refresh_from_db()
        self.assertTrue(self.previous.is_active)
