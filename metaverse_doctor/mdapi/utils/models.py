from django.db import models
from django.utils import timezone
from django.contrib.auth.models import AbstractUser, UserManager
import uuid

"""
# 软删除
user.delete()  # 只是标记为删除，不会从数据库删除

# 硬删除（真正删除）
user.hard_delete()

# 恢复已删除的用户
user.restore()

# 查询
CustomUser.objects.all()  # 只返回未删除的用户
CustomUser.all_objects.all()  # 返回所有用户（包括已删除的）
CustomUser.objects.deleted_only()  # 只返回已删除的用户
"""

class SoftDeleteManager(models.Manager):
    """软删除管理器 - 默认只返回未删除的对象"""
    
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)
    
    def all_with_deleted(self):
        """获取包含已删除记录的所有对象"""
        return super().get_queryset()
    
    def deleted_only(self):
        """只获取已删除的对象"""
        return super().get_queryset().filter(is_deleted=True)
    
class CustomUserManager(UserManager):
    def get_queryset(self):
        return super().get_queryset().filter(is_deleted=False)
    
    def create_user(self, username, email=None, password=None, **extra_fields):
        # 确保is_deleted字段为False
        extra_fields.setdefault('is_deleted', False)
        return super().create_user(username, email, password, **extra_fields)
    
    def create_superuser(self, username, email=None, password=None, **extra_fields):
        # 确保is_deleted字段为False
        extra_fields.setdefault('is_deleted', False)
        return super().create_superuser(username, email, password, **extra_fields)


class SoftDeleteModel(models.Model):
    """软删除基础模型"""
    uuid = models.UUIDField(
        default=uuid.uuid4, editable=False, verbose_name="UUID"
    )
    is_deleted = models.BooleanField(default=False, verbose_name="是否删除")
    deleted_at = models.DateTimeField(null=True, blank=True, verbose_name="删除时间")

    created_at = models.DateTimeField(
        auto_now_add=True, verbose_name="创建时间")
    
    updated_at = models.DateTimeField(
        auto_now=True, verbose_name="更新时间")
    
    objects = SoftDeleteManager()
    all_objects = models.Manager()  # 包含已删除记录的管理器
    
    class Meta:
        abstract = True
    
    def delete(self, using=None, keep_parents=False):
        """软删除 - 标记为删除而不是真正删除"""
        self.is_deleted = True
        self.deleted_at = timezone.now()
        self.save(using=using)
    
    def hard_delete(self, using=None, keep_parents=False):
        """硬删除 - 真正从数据库删除"""
        super().delete(using=using, keep_parents=keep_parents)
    
    def restore(self):
        """恢复已删除的记录"""
        self.is_deleted = False
        self.deleted_at = None
        self.save()
