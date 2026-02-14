import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth'
import { toErrorMessage } from '@/lib/http'
import { userApi } from '@/lib/api'
import type { UserProfile } from '@/types/api'
import { ImagePlus, Loader2, LogOut, Save, Upload, UserCircle } from 'lucide-react'

type ProfileForm = {
  nickname: string
  gender: string
  birthday: string
  address: string
}

const toForm = (profile: UserProfile): ProfileForm => ({
  nickname: profile.nickname || '',
  gender: profile.gender || 'U',
  birthday: profile.birthday || '',
  address: profile.address || '',
})

export default function ProfilePage() {
  const { logout } = useAuthStore()
  const nav = useNavigate()
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ProfileForm>({
    nickname: '',
    gender: 'U',
    birthday: '',
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

  const handleLogout = () => {
    logout()
    nav('/auth/login', { replace: true })
  }

  return (
    <div className="h-full min-h-0 overflow-y-auto px-4 pt-6 pb-[calc(var(--safe-bottom)+16px)] space-y-4">
      <h1 className="text-xl font-bold text-slate-800">我的</h1>

      {loading || !profile ? (
        <div className="glass p-8 text-center">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-slate-400" />
        </div>
      ) : (
        <>
          <div className="glass p-5 flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl overflow-hidden border border-white/60 bg-gradient-to-br from-frost-400 to-aurora-400 flex items-center justify-center">
              {profile.avatar ? (
                <img src={profile.avatar} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <UserCircle className="w-7 h-7 text-white" />
              )}
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-800 truncate">{profile.nickname || profile.username}</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                登录标识：{profile.phone || profile.email || profile.username}
              </p>
            </div>
          </div>

          <div className="glass p-4 space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => avatarRef.current?.click()}
                className="flex-1 h-11 rounded-xl border border-dashed border-slate-200 px-4 text-sm text-slate-500 hover:border-frost-300 hover:text-frost-600 flex items-center justify-center gap-2 transition-all"
              >
                <ImagePlus className="w-4 h-4" />
                {avatarFile ? avatarFile.name : '选择头像图片'}
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
                className="h-11 px-4 rounded-xl bg-frost-500 hover:bg-frost-600 text-white text-sm font-medium disabled:opacity-50 flex items-center justify-center gap-2 transition-all"
              >
                {avatarUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {avatarUploading ? '上传中…' : '上传头像'}
              </button>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">昵称</label>
              <input
                value={form.nickname}
                onChange={(e) => updateField('nickname', e.target.value)}
                className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/90 transition-all"
                placeholder="请输入昵称"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">手机号（登录标识，不可修改）</label>
              <input
                value={profile.phone || ''}
                readOnly
                className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm bg-slate-50 text-slate-500"
                placeholder="未绑定"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">邮箱（登录标识，不可修改）</label>
              <input
                value={profile.email || ''}
                readOnly
                className="w-full h-11 rounded-xl border border-slate-200 px-4 text-sm bg-slate-50 text-slate-500"
                placeholder="未绑定"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">性别</label>
                <select
                  value={form.gender}
                  onChange={(e) => updateField('gender', e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm bg-white/90 focus:outline-none focus:ring-2 focus:ring-frost-300"
                >
                  <option value="U">未知</option>
                  <option value="M">男</option>
                  <option value="F">女</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">生日</label>
                <input
                  type="date"
                  value={form.birthday}
                  onChange={(e) => updateField('birthday', e.target.value)}
                  className="w-full h-11 rounded-xl border border-slate-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/90"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">地址</label>
              <textarea
                value={form.address}
                onChange={(e) => updateField('address', e.target.value)}
                rows={3}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-frost-300 bg-white/90 resize-y"
                placeholder="请输入联系地址"
              />
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="btn-primary w-full h-11 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? '保存中…' : '保存资料'}
            </button>
          </div>
        </>
      )}

      <button
        onClick={handleLogout}
        className="w-full h-12 rounded-2xl border border-petal-200 text-petal-500 font-medium text-sm flex items-center justify-center gap-2 active:scale-[0.97] transition-all hover:bg-petal-50"
      >
        <LogOut className="w-4 h-4" /> 退出登录
      </button>
    </div>
  )
}
