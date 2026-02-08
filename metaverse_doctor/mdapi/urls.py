from django.urls import path

from mdapi.auth_views import (
    CustomTokenRefreshView,
    DoctorApplicationListView,
    DoctorApplicationReviewView,
    DoctorRegisterView,
    DoctorTokenObtainPairView,
)
from mdapi.views import (
    DoctorAvatarVideoRefreshView,
    DoctorAvatarVideoView,
    DoctorDigitalVoiceView,
    DoctorKnowledgeDetailView,
    DoctorKnowledgeExtractView,
    DoctorKnowledgeIndexView,
    DoctorKnowledgeTagView,
    DoctorKnowledgeView,
)


urlpatterns = [
    path("auth/login/", DoctorTokenObtainPairView.as_view(), name="auth-login"),
    path("auth/token/refresh/", CustomTokenRefreshView.as_view(), name="auth-refresh"),
    path("auth/doctor/register/", DoctorRegisterView.as_view(), name="doctor-register"),
    path(
        "auth/doctor/applications/",
        DoctorApplicationListView.as_view(),
        name="doctor-application-list",
    ),
    path(
        "auth/doctor/applications/<int:user_id>/review/",
        DoctorApplicationReviewView.as_view(),
        name="doctor-application-review",
    ),
    path("doctor/knowledge/", DoctorKnowledgeView.as_view(), name="doctor-knowledge"),
    path(
        "doctor/knowledge/indexes/",
        DoctorKnowledgeIndexView.as_view(),
        name="doctor-knowledge-indexes",
    ),
    path(
        "doctor/knowledge/tags/",
        DoctorKnowledgeTagView.as_view(),
        name="doctor-knowledge-tags",
    ),
    path(
        "doctor/knowledge/<int:knowledge_id>/",
        DoctorKnowledgeDetailView.as_view(),
        name="doctor-knowledge-detail",
    ),
    path(
        "doctor/knowledge/<int:knowledge_id>/extract/",
        DoctorKnowledgeExtractView.as_view(),
        name="doctor-knowledge-extract",
    ),
    path(
        "doctor/digital-human/voice/",
        DoctorDigitalVoiceView.as_view(),
        name="doctor-digital-human-voice",
    ),
    path(
        "doctor/digital-human/videos/",
        DoctorAvatarVideoView.as_view(),
        name="doctor-digital-human-videos",
    ),
    path(
        "doctor/digital-human/videos/<int:video_id>/refresh/",
        DoctorAvatarVideoRefreshView.as_view(),
        name="doctor-digital-human-video-refresh",
    ),
]
