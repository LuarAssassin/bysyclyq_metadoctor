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


class DoctorVoiceProfile(SoftDeleteModel):
    """医生数字人音色档案"""

    STATUS_CHOICES = [
        ("ready", "可用"),
        ("failed", "失败"),
    ]

    doctor = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="voice_profiles",
        limit_choices_to={"is_doctor": True},
        verbose_name="医生",
    )
    name = models.CharField(max_length=100, verbose_name="音色名称")
    preferred_name = models.CharField(max_length=100, verbose_name="音色偏好名称")
    target_model = models.CharField(max_length=100, verbose_name="目标模型")
    qwen_voice_id = models.CharField(
        max_length=255, unique=True, verbose_name="Qwen 音色ID"
    )
    sample_file_name = models.CharField(max_length=255, verbose_name="样本文件名")
    sample_object_key = models.CharField(
        max_length=500, unique=True, verbose_name="样本 OSS 对象Key"
    )
    sample_oss_url = models.URLField(max_length=1000, verbose_name="样本 OSS 地址")
    sample_content_type = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="样本 MIME 类型"
    )
    sample_size_bytes = models.BigIntegerField(default=0, verbose_name="样本大小（字节）")
    sample_etag = models.CharField(
        max_length=128, null=True, blank=True, verbose_name="样本 OSS ETag"
    )
    is_active = models.BooleanField(default=True, db_index=True, verbose_name="是否当前生效")
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default="ready",
        db_index=True,
        verbose_name="状态",
    )
    error_message = models.TextField(null=True, blank=True, verbose_name="错误信息")
    notes = models.TextField(null=True, blank=True, verbose_name="备注")

    class Meta:
        verbose_name = "医生音色档案"
        verbose_name_plural = "医生音色档案"
        ordering = ["-created_at"]

    def clean(self):
        super().clean()
        if self.doctor_id and not self.doctor.is_doctor:
            raise ValidationError({"doctor": "仅医生用户可绑定音色档案"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.doctor.username} - {self.name}"


class DoctorAvatarVideo(SoftDeleteModel):
    """医生数字人图生视频任务"""

    TASK_STATUS_CHOICES = [
        ("submitted", "已提交"),
        ("running", "生成中"),
        ("succeeded", "已完成"),
        ("failed", "失败"),
    ]

    doctor = models.ForeignKey(
        CustomUser,
        on_delete=models.CASCADE,
        related_name="avatar_videos",
        limit_choices_to={"is_doctor": True},
        verbose_name="医生",
    )
    image_file_name = models.CharField(max_length=255, verbose_name="首帧图片文件名")
    image_object_key = models.CharField(max_length=500, verbose_name="首帧图片 OSS 对象Key")
    image_oss_url = models.URLField(max_length=1000, verbose_name="首帧图片 OSS 地址")
    image_content_type = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="首帧 MIME 类型"
    )
    image_size_bytes = models.BigIntegerField(default=0, verbose_name="首帧大小（字节）")
    image_etag = models.CharField(
        max_length=128, null=True, blank=True, verbose_name="首帧 OSS ETag"
    )

    video_model = models.CharField(max_length=100, verbose_name="视频生成模型")
    scene_key = models.CharField(
        max_length=64,
        null=True,
        blank=True,
        db_index=True,
        verbose_name="场景标识",
    )
    scene_name = models.CharField(
        max_length=128,
        null=True,
        blank=True,
        verbose_name="场景名称",
    )
    prompt = models.TextField(verbose_name="正向提示词")
    negative_prompt = models.TextField(null=True, blank=True, verbose_name="负向提示词")
    resolution = models.CharField(max_length=20, default="720P", verbose_name="分辨率")
    duration_seconds = models.PositiveIntegerField(default=5, verbose_name="时长（秒）")
    prompt_extend = models.BooleanField(default=True, verbose_name="是否启用提示词扩展")
    watermark = models.BooleanField(default=True, verbose_name="是否加水印")
    audio_enabled = models.BooleanField(default=False, verbose_name="是否输出音频")

    task_request_id = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="任务请求ID"
    )
    task_id = models.CharField(max_length=255, db_index=True, verbose_name="任务ID")
    task_status = models.CharField(
        max_length=20,
        choices=TASK_STATUS_CHOICES,
        default="submitted",
        db_index=True,
        verbose_name="任务状态",
    )
    video_url_external = models.URLField(
        max_length=2000, null=True, blank=True, verbose_name="DashScope 视频URL"
    )
    video_file_name = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="视频文件名"
    )
    video_object_key = models.CharField(
        max_length=500, unique=True, null=True, blank=True, verbose_name="视频 OSS 对象Key"
    )
    video_oss_url = models.URLField(
        max_length=1000, null=True, blank=True, verbose_name="视频 OSS 地址"
    )
    video_content_type = models.CharField(
        max_length=255, null=True, blank=True, verbose_name="视频 MIME 类型"
    )
    video_size_bytes = models.BigIntegerField(
        default=0, verbose_name="视频大小（字节）"
    )
    video_etag = models.CharField(
        max_length=128, null=True, blank=True, verbose_name="视频 OSS ETag"
    )
    error_message = models.TextField(null=True, blank=True, verbose_name="错误信息")
    completed_at = models.DateTimeField(
        null=True, blank=True, verbose_name="任务完成时间"
    )
    last_synced_at = models.DateTimeField(
        null=True, blank=True, verbose_name="最近同步时间"
    )

    class Meta:
        verbose_name = "医生数字人视频任务"
        verbose_name_plural = "医生数字人视频任务"
        ordering = ["-created_at"]

    def clean(self):
        super().clean()
        if self.doctor_id and not self.doctor.is_doctor:
            raise ValidationError({"doctor": "仅医生用户可绑定数字人视频任务"})

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.doctor.username} - {self.image_file_name}"
