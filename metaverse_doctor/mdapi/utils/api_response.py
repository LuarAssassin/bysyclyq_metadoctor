from rest_framework.response import Response
from rest_framework import status
from rest_framework.views import exception_handler
from django.http import Http404
from rest_framework.exceptions import (
    AuthenticationFailed, NotAuthenticated, PermissionDenied, 
    ValidationError, NotFound, MethodNotAllowed
)


class APIResponse:
    """统一API响应格式"""
    # 静态方法只是放在类的命名空间下，用于组织代码，使代码更具逻辑性。
    @staticmethod
    def success(data=None, message="操作成功", code=200):
        """成功响应"""
        return Response({
            "code": code,
            "message": message,
            "data": data
        }, status=status.HTTP_200_OK)
    
    @staticmethod
    def created(data=None, message="创建成功", code=201, headers=None):
        """创建成功响应"""
        return Response({
            "code": code,
            "message": message,
            "data": data
        }, status=status.HTTP_201_CREATED, headers=headers)
    
    @staticmethod
    def error(message="操作失败", code=400, status_code=status.HTTP_400_BAD_REQUEST):
        """错误响应"""
        return Response({
            "code": code,
            "message": message,
            "data": None
        }, status=status_code)
    
    @staticmethod
    def unauthorized(message="未授权", code=401):
        """未授权响应"""
        return Response({
            "code": code,
            "message": message,
            "data": None
        }, status=status.HTTP_401_UNAUTHORIZED)
    
    @staticmethod
    def forbidden(message="禁止访问", code=403):
        """禁止访问响应"""
        return Response({
            "code": code,
            "message": message,
            "data": None
        }, status=status.HTTP_403_FORBIDDEN)
    
    @staticmethod
    def not_found(message="资源不存在", code=404):
        """资源不存在响应"""
        return Response({
            "code": code,
            "message": message,
            "data": None
        }, status=status.HTTP_404_NOT_FOUND)
    
    @staticmethod
    def server_error(message="服务器错误", code=500):
        """服务器错误响应"""
        return Response({
            "code": code,
            "message": message,
            "data": None
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


def custom_exception_handler(exc, context):
    """自定义异常处理器"""
    # 先调用REST framework默认的异常处理
    response = exception_handler(exc, context)
    
    # 如果是REST framework的异常，自定义响应格式
    if response is not None:
        # 清空原有响应内容
        response.data = {}
        
        # 根据异常类型设置响应内容
        if isinstance(exc, ValidationError):
            # 验证错误，提取错误信息
            error_message = ""
            detail = exc.detail
            if isinstance(detail, dict):
                iter_items = detail.items()
            elif isinstance(detail, list):
                iter_items = enumerate(detail)
            else:
                iter_items = [('detail', detail)]
            for field, errors in iter_items:
                if isinstance(errors, (list, tuple)):
                    error_message += f"{field}: {errors[0]} "
                else:
                    error_message += f"{field}: {errors} "
            
            response.data = {
                "code": 400,
                "message": error_message.strip(),
                "data": None
            }
        elif isinstance(exc, (NotAuthenticated, AuthenticationFailed)):
            # 认证错误
            response.data = {
                "code": 401,
                "message": str(exc),
                "data": None
            }
        elif isinstance(exc, PermissionDenied):
            # 权限错误
            response.data = {
                "code": 403,
                "message": str(exc),
                "data": None
            }
        elif isinstance(exc, (Http404, NotFound)):
            # 资源不存在
            response.data = {
                "code": 404,
                "message": "资源不存在",
                "data": None
            }
        elif isinstance(exc, MethodNotAllowed):
            # 方法不允许
            response.data = {
                "code": 405,
                "message": f"方法 {exc.args[0]} 不允许",
                "data": None
            }
        else:
            # 其他错误
            response.data = {
                "code": response.status_code,
                "message": str(exc),
                "data": None
            }
    
    # 如果不是REST framework的异常，返回500错误
    else:
        response = Response({
            "code": 500,
            "message": str(exc) if str(exc) else "服务器内部错误",
            "data": None
        }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    return response 