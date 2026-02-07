from rest_framework.permissions import BasePermission


class IsDoctor(BasePermission):
    message = "仅医生用户可以执行此操作"

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.is_doctor)

