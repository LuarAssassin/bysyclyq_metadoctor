from django.db import models
from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from mdapi.utils.models import SoftDeleteModel, CustomUserManager

# Create your models here.

# 自定义用户表
class CustomUser(AbstractUser, SoftDeleteModel):
    """自定义用户模型"""
    DOCTOR_APPLY_STATUS_CHOICES = [
        ("pending", "待审核"),
        ("approved", "审核通过"),
        ("rejected", "审核拒绝"),
    ]

    nickname = models.CharField(
        max_length=50, verbose_name="昵称", null=True, blank=True)
    avatar = models.URLField(
        max_length=1000, verbose_name="头像URL", null=True, blank=True)
    gender = models.CharField(
        max_length=1, 
        choices=[
            ('M', '男'),
            ('F', '女'),
            ('U', '未知'),
        ], default="U", verbose_name="性别")
    birthday = models.DateField(
        null=True, blank=True, verbose_name="生日")
    age = models.IntegerField(
        null=True, blank=True, verbose_name="年龄")
    institution = models.CharField(
        max_length=100, verbose_name="所属机构", null=True, blank=True)
    profession = models.CharField(
        max_length=50, verbose_name="职业", null=True, blank=True)
    phone = models.CharField(
        max_length=15, verbose_name="手机号", null=True, blank=True)
    address = models.CharField(
        max_length=255, verbose_name="地址", null=True, blank=True)
    is_doctor = models.BooleanField(default=False, verbose_name="是否为医生")
    doctor_apply_status = models.CharField(
        max_length=20,
        choices=DOCTOR_APPLY_STATUS_CHOICES,
        default="approved",
        db_index=True,
        verbose_name="医生审核状态",
    )
    doctor_applied_at = models.DateTimeField(
        null=True, blank=True, verbose_name="医生申请时间"
    )
    doctor_reviewed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="医生审核时间"
    )
    doctor_review_note = models.TextField(
        null=True, blank=True, verbose_name="医生审核备注"
    )

    objects = CustomUserManager()

    class Meta:
        verbose_name = '用户'
        verbose_name_plural = '用户'
        ordering = ['-date_joined']
    
    # 自动计算年龄
    def save(self, *args, **kwargs):
        if self.birthday:
            from datetime import date
            today = date.today()
            self.age = today.year - self.birthday.year - (
                (today.month, today.day) < (self.birthday.month, self.birthday.day)
            )
        super().save(*args, **kwargs)
  
    def __str__(self):
        return self.username


class KnowledgeTag(SoftDeleteModel):
    """医生知识标签（用于可视化和聚合）"""

    name = models.CharField(max_length=64, unique=True, db_index=True, verbose_name="标签名")

    class Meta:
        verbose_name = "知识标签"
        verbose_name_plural = "知识标签"
        ordering = ["name"]

    def clean(self):
        super().clean()
        if self.name:
            self.name = self.name.strip()
        if not self.name:
            raise ValidationError({"name": "标签名不能为空"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name

# 当用户类型是医生时关联 OSS 存储的医生知识库资料索引
class DoctorKnowledge(SoftDeleteModel):
    """医生知识库模型"""
    UPLOAD_STATUS_CHOICES = [
        ("uploaded", "上传成功"),
        ("failed", "上传失败"),
    ]
    KNOWLEDGE_STATUS_CHOICES = [
        ("pending", "待入库"),
        ("synced", "已入库"),
        ("failed", "入库失败"),
    ]
    EXTRACT_STATUS_CHOICES = [
        ("pending", "待抽取"),
        ("queued", "排队中"),
        ("running", "抽取中"),
        ("success", "抽取成功"),
        ("failed", "抽取失败"),
    ]

    doctor = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        verbose_name="医生",
        related_name="knowledge_items",
        limit_choices_to={"is_doctor": True},
    )
    file_name = models.CharField(max_length=255, verbose_name="文件名")
    object_key = models.CharField(max_length=500, unique=True, verbose_name="OSS对象Key")
    oss_url = models.URLField(max_length=1000, verbose_name="OSS访问地址")
    content_type = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="文件类型"
    )
    size_bytes = models.BigIntegerField(default=0, verbose_name="文件大小（字节）")
    etag = models.CharField(
        max_length=128, null=True, blank=True, verbose_name="OSS ETag"
    )
    upload_status = models.CharField(
        max_length=20,
        choices=UPLOAD_STATUS_CHOICES,
        default="uploaded",
        db_index=True,
        verbose_name="上传状态",
    )
    knowledge_status = models.CharField(
        max_length=20,
        choices=KNOWLEDGE_STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="知识库状态",
    )
    qwen_file_id = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="Qwen 文件ID"
    )
    qwen_knowledge_base_id = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="Qwen 知识库ID"
    )
    extract_status = models.CharField(
        max_length=20,
        choices=EXTRACT_STATUS_CHOICES,
        default="pending",
        db_index=True,
        verbose_name="抽取状态",
    )
    knowledge_description = models.TextField(
        null=True, blank=True, verbose_name="知识描述"
    )
    extract_raw_output = models.TextField(
        null=True, blank=True, verbose_name="抽取原始输出"
    )
    extract_error = models.TextField(
        null=True, blank=True, verbose_name="抽取错误"
    )
    extracted_at = models.DateTimeField(
        null=True, blank=True, verbose_name="抽取完成时间"
    )
    extract_retry_count = models.PositiveIntegerField(
        default=0, verbose_name="抽取重试次数"
    )
    tags = models.ManyToManyField(
        KnowledgeTag,
        blank=True,
        related_name="knowledge_items",
        verbose_name="标签",
    )
    notes = models.TextField(null=True, blank=True, verbose_name="备注")

    class Meta:
        verbose_name = "医生知识库"
        verbose_name_plural = "医生知识库"
        ordering = ['-created_at']

    def clean(self):
        super().clean()
        if self.doctor_id and not self.doctor.is_doctor:
            raise ValidationError({"doctor": "仅医生用户可绑定医生知识库资料"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.doctor.username} - {self.file_name}"
