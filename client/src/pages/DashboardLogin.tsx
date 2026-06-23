import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Zap, AlertCircle } from 'lucide-react'

export default function DashboardLogin() {
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setError('')
    if (!email || !password) { setError('Enter email and password.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      nav('/')
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-drix-bg flex items-center justify-center px-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-drix-accent/10 border border-drix-accent/20 mb-4">
            <Zap size={14} className="text-drix-accent" />
            <span className="text-xs font-semibold tracking-widest uppercase text-drix-accent">Dashboard</span>
          </div>
          <h1 className="text-2xl font-black text-drix-text mb-1 tracking-tight">
            DR<span className="text-drix-cyan">i</span>X
          </h1>
          <p className="text-sm text-drix-dim">Sign in to your dashboard</p>
        </div>
        <div className="bg-drix-surface border border-drix-border rounded-2xl p-6 space-y-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold tracking-widest uppercase text-drix-muted">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()} autoFocus
              className="bg-drix-surface2 border border-drix-border rounded-xl px-4 py-3 text-sm text-drix-text outline-none focus:border-drix-accent transition-all"
              placeholder="you@company.com" />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-extrabold tracking-widest uppercase text-drix-muted">Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submit()}
              className="bg-drix-surface2 border border-drix-border rounded-xl px-4 py-3 text-sm text-drix-text outline-none focus:border-drix-accent transition-all"
              placeholder="••••••••" />
          </div>
          {error && (
            <div className="bg-drix-red/10 border border-drix-red/30 text-[#ff9a9a] px-4 py-2.5 rounded-xl text-xs flex items-center gap-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <button onClick={submit} disabled={loading || !email || !password}
            className="w-full bg-gradient-to-r from-drix-accent to-drix-purple text-white rounded-xl py-3.5 text-sm font-bold hover:shadow-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </div>
        <div className="text-center mt-6">
          <div className="text-[10px] text-drix-border tracking-[2px] uppercase">
            DRiX · Data Reimagined Experience · by WinTech Partners
          </div>
        </div>
      </motion.div>
    </div>
  )
}
