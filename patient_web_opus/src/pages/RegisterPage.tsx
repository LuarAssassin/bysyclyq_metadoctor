import { Link } from 'react-router-dom'

export default function RegisterPage() {
  return (
    <div className="space-y-5 text-center">
      <div>
        <h2 className="text-lg font-bold text-slate-800">已切换为接码登录</h2>
        <p className="text-xs text-slate-400 mt-2">患者端不再使用用户名密码注册，请使用短信或邮件验证码直接登录。</p>
      </div>
      <Link
        to="/auth/login"
        className="inline-flex items-center justify-center h-11 px-5 rounded-xl bg-frost-500 hover:bg-frost-600 text-white text-sm font-medium transition-colors"
      >
        去接码登录
      </Link>
    </div>
  )
}
