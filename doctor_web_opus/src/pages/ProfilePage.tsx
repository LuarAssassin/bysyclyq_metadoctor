import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ImagePlus, Loader2, Save, Upload, UserRound } from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import GlassCard from '@/components/GlassCard'
import { toErrorMessage } from '@/lib/http'
import { userApi } from '@/lib/api'
import type { UserProfile } from '@/types/api'

type ProfileForm = {
  nickname: string
  gender: string
  birthday: string
  institution: string
  profession: string
  address: string
}

const toForm = (profile: UserProfile): ProfileForm => ({
  nickname: profile.nickname || '',
  gender: profile.gender || 'U',
  birthday: profile.birthday || '',
  institution: profile.institution || '',
  profession: profile.profession || '',
  address: profile.address || '',
})

export default function ProfilePage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ProfileForm>({
    nickname: '',
    gender: 'U',
    birthday: '',
    institution: '',
    profession: '',
    address: '',
  })
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const loadProfile = async () => {
    setLoading(true)
    try {
      const data = await userApi.getMe()
      setProfile(data)
      setForm(toForm(data))
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadProfile()
  }, [])

  const updateField = (key: keyof ProfileForm, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async () => {
    if (!profile) return
    setSaving(true)
    try {
      const payload = {
        nickname: form.nickname.trim(),
        gender: form.gender || 'U',
        birthday: form.birthday || null,
        institution: form.institution.trim(),
        profession: form.profession.trim(),
        address: form.address.trim(),
      }
      const res = await userApi.updateMe(payload)
      setProfile(res.data)
      setForm(toForm(res.data))
      toast.success(res.message || '保存成功')
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleUploadAvatar = async () => {
    if (!avatarFile) {
      toast.warning('请先选择头像图片')
      return
    }
    setAvatarUploading(true)
    try {
      const res = await userApi.uploadAvatar(avatarFile)
      setProfile(res.data)
      setForm(toForm(res.data))
      setAvatarFile(null)
      if (avatarRef.current) avatarRef.current.value = ''
      toast.success(res.message || '头像上传成功')
    } catch (e) {
      toast.error(toErrorMessage(e))
    } finally {
      setAvatarUploading(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="个人资料"
        subtitle="查看与编辑当前账号信息，保存后即时生效"
      />

      <GlassCard title="账号信息">
        {loading || !profile ? (
          <div className="py-10 text-center">
            <Loader2 className="w-5 h-5 animate-spin mx-auto text-alpine-300" />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl border border-alpine-100 bg-snow-50 px-4 py-3 flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl border border-alpine-100 bg-white text-ice-600 flex items-center justify-center overflow-hidden flex-shrink-0">
                {profile.avatar ? (
                  <img src={profile.avatar} alt="avatar" className="w-full h-full object-cover" />
                ) : (
                  <UserRound className="w-6 h-6" />
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-alpine-800 truncate">{profile.username}</p>
                <p className="text-xs text-alpine-400">
                  {profile.is_doctor ? '医生账号' : '普通账号'} · 状态 {profile.doctor_apply_status || 'approved'}
                </p>
                <p className="text-xs text-alpine-400">
                  登录标识：{profile.phone || profile.email || profile.username}
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row gap-2">
              <button
                onClick={() => avatarRef.current?.click()}
                className="flex-1 h-10 rounded-xl border border-dashed border-alpine-200 hover:border-ice-300 text-sm text-alpine-500 flex items-center justify-center gap-2 transition-colors"
              >
                <ImagePlus className="w-4 h-4" />
                {avatarFile ? avatarFile.name : '选择头像图片（JPG/PNG/WebP）'}
              </button>
              <input
                ref={avatarRef}
                type="file"
                accept=".jpg,.jpeg,.png,.webp,.bmp,image/*"
                className="hidden"
                onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
              />
              <button
                onClick={handleUploadAvatar}
                disabled={avatarUploading || !avatarFile}
                className="h-10 px-4 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
              >
                {avatarUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {avatarUploading ? '上传中...' : '上传头像'}
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">昵称</label>
                <input
                  value={form.nickname}
                  onChange={(e) => updateField('nickname', e.target.value)}
                  className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                  placeholder="请输入昵称"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">手机号（登录标识，不可修改）</label>
                <input
                  value={profile.phone || ''}
                  readOnly
                  className="w-full h-10 rounded-lg border border-alpine-100 bg-alpine-50 px-3 text-sm text-alpine-500"
                  placeholder="未绑定"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">邮箱（登录标识，不可修改）</label>
                <input
                  value={profile.email || ''}
                  readOnly
                  className="w-full h-10 rounded-lg border border-alpine-100 bg-alpine-50 px-3 text-sm text-alpine-500"
                  placeholder="未绑定"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">性别</label>
                <select
                  value={form.gender}
                  onChange={(e) => updateField('gender', e.target.value)}
                  className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-ice-300"
                >
                  <option value="U">未知</option>
                  <option value="M">男</option>
                  <option value="F">女</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">生日</label>
                <input
                  type="date"
                  value={form.birthday}
                  onChange={(e) => updateField('birthday', e.target.value)}
                  className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">年龄（自动计算）</label>
                <input
                  value={profile.age ?? ''}
                  disabled
                  className="w-full h-10 rounded-lg border border-alpine-100 bg-alpine-50 px-3 text-sm text-alpine-500"
                  placeholder="-"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">所属机构</label>
                <input
                  value={form.institution}
                  onChange={(e) => updateField('institution', e.target.value)}
                  className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                  placeholder="请输入所属机构"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-alpine-500 mb-1">职业/科室</label>
                <input
                  value={form.profession}
                  onChange={(e) => updateField('profession', e.target.value)}
                  className="w-full h-10 rounded-lg border border-alpine-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300"
                  placeholder="请输入职业或科室"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-alpine-500 mb-1">地址</label>
              <textarea
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-alpine-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ice-300 resize-y"
                placeholder="请输入联系地址"
              />
            </div>

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full md:w-auto h-10 px-5 rounded-xl bg-ice-500 hover:bg-ice-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? '保存中...' : '保存资料'}
            </button>
          </div>
        )}
      </GlassCard>
    </div>
  )
}
