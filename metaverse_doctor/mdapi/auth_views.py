from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from mdapi.auth_serializers import (
    DoctorApplicationReviewSerializer,
    DoctorApplicationSerializer,
    DoctorRegisterSerializer,
    DoctorTokenObtainPairSerializer,
)
from mdapi.models import CustomUser
from mdapi.utils.api_response import APIResponse
from mdapi.utils.pagnition import StandardResultsSetPagination


class DoctorRegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorRegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        data = DoctorApplicationSerializer(user).data
        return APIResponse.created(data=data, message="医生注册申请已提交，审核通过后可登录")


class DoctorTokenObtainPairView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = DoctorTokenObtainPairSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return APIResponse.success(data=serializer.validated_data, message="登录成功")


class DoctorApplicationListView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def get(self, request):
        status_value = request.query_params.get("status", "pending")
        queryset = CustomUser.objects.filter(is_doctor=True).order_by("-doctor_applied_at")

        if status_value != "all":
            queryset = queryset.filter(doctor_apply_status=status_value)

        paginator = StandardResultsSetPagination()
        page = paginator.paginate_queryset(queryset, request, view=self)
        serializer = DoctorApplicationSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)


class DoctorApplicationReviewView(APIView):
    permission_classes = [IsAuthenticated, IsAdminUser]

    def patch(self, request, user_id):
        doctor = CustomUser.objects.filter(id=user_id, is_doctor=True).first()
        if not doctor:
            return APIResponse.not_found(message="医生申请记录不存在")

        serializer = DoctorApplicationReviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        review_status = serializer.validated_data["status"]
        review_note = serializer.validated_data.get("review_note")

        doctor.doctor_apply_status = review_status
        doctor.doctor_review_note = review_note
        doctor.doctor_reviewed_at = timezone.now()
        doctor.is_active = review_status == "approved"
        doctor.save(
            update_fields=[
                "doctor_apply_status",
                "doctor_review_note",
                "doctor_reviewed_at",
                "is_active",
                "updated_at",
            ]
        )

        data = DoctorApplicationSerializer(doctor).data
        return APIResponse.success(data=data, message="医生申请审核完成")


class CustomTokenRefreshView(TokenRefreshView):
    permission_classes = [AllowAny]

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200:
            return APIResponse.success(data=response.data, message="刷新成功")
        return response

