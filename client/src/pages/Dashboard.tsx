import { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Upload, LogOut, X } from 'lucide-react'

interface User { id: number; email: string; name: string; role: string; company: string }
interface Opp {
  id: number; customer_name: string; customer_url: string; solution_url: string
  partner_company: string; estimated_value: number; lead_source: string; status: string
  manager_name: string; rep_name: string | null; rep_email: string | null
  chosen_strategy_title: string | null; created_at: string; assigned_at: string | null
  last_accessed_at: string | null; view_count: number; tools_used_count: number; notes: string | null
}
interface Stats { [status: string]: { count: number; value: number } }

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  processing: { bg: 'bg-drix-yellow/15', text: 'text-drix-yellow', label: 'Processing' },
  ready:      { bg: 'bg-drix-cyan/15',   text: 'text-drix-cyan',   label: 'Ready' },
  assigned:   { bg: 'bg-drix-accent/15',  text: 'text-drix-accent', label: 'Assigned' },
  reviewing:  { bg: 'bg-drix-purple/15',  text: 'text-drix-purple', label: 'Reviewing' },
  active:     { bg: 'bg-drix-green/15',   text: 'text-drix-green',  label: 'Active' },
  won:        { bg: 'bg-drix-green/25',   text: 'text-drix-green',  label: 'Won' },
  lost:       { bg: 'bg-drix-red/15',     text: 'text-drix-red',    label: 'Lost' },
}

const fmtMoney = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${(v / 1_000).toFixed(0)}K` : `$${v}`
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'
const ago = (d: string | null) => {
  if (!d) return '—'
  const ms = Date.now() - new Date(d).getTime()
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`
  if (ms < 86400000) return `${Math.floor(ms / 3600000)}h ago`
  return `${Math.floor(ms / 86400000)}d ago`
}

export default function Dashboard() {
  const nav = useNavigate()
  const [user, setUser] = useState<User | null>(null)
  const [opps, setOpps] = useState<Opp[]>([])
  const [stats, setStats] = useState<Stats>({})
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', partner: '', source: '' })
  const [showUpload, setShowUpload] = useState(false)
  const [uploadStatus, setUploadStatus] = useState('')
  const [assignModal, setAssignModal] = useState<Opp | null>(null)
  const [assignName, setAssignName] = useState('')
  const [assignEmail, setAssignEmail] = useState('')
  const [assignLoading, setAssignLoading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/dashboard/me')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setUser(d.user))
      .catch(() => nav('/login'))
  }, [nav])

  const loadData = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      const [oppRes, statRes] = await Promise.all([
        fetch('/api/dashboard/opportunities').then(r => r.json()),
        fetch('/api/dashboard/stats').then(r => r.json()),
      ])
      setOpps(oppRes.opportunities || [])
      setStats(statRes.stats || {})
    } catch {} finally { setLoading(false) }
  }, [user])

  useEffect(() => { loadData() }, [loadData])
  useEffect(() => {
    if (!user) return
    const iv = setInterval(loadData, 30000)
    return () => clearInterval(iv)
  }, [user, loadData])

  const logout = async () => {
    await fetch('/api/dashboard/logout', { method: 'POST' })
    nav('/login')
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadStatus('Uploading...')
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/dashboard/upload-csv', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Upload failed')
      setUploadStatus(`Created ${data.created} opportunities${data.managers_created ? `, ${data.managers_created} new manager accounts` : ''}. Processing in background.`)
      setShowUpload(false)
      loadData()
    } catch (err: any) {
      setUploadStatus(`Error: ${err.message}`)
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleAssign = async () => {
    if (!assignModal || !assignName.trim() || !assignEmail.trim()) return
    setAssignLoading(true)
    try {
      const res = await fetch(`/api/dashboard/opp/${assignModal.id}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rep_name: assignName.trim(), rep_email: assignEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setAssignModal(null); setAssignName(''); setAssignEmail('')
      loadData()
    } catch (err: any) { alert(err.message) }
    finally { setAssignLoading(false) }
  }

  const partners = [...new Set(opps.map(o => o.partner_company))].sort()
  const sources = [...new Set(opps.map(o => o.lead_source))].sort()
  const filtered = opps.filter(o => {
    if (filter.status && o.status !== filter.status) return false
    if (filter.partner && o.partner_company !== filter.partner) return false
    if (filter.source && o.lead_source !== filter.source) return false
    return true
  })

  if (!user) return null
  const statOrder = ['processing', 'ready', 'assigned', 'reviewing', 'active', 'won', 'lost']

  return (
    <div className="min-h-screen bg-drix-bg text-drix-text">
      {/* Header */}
      <div className="border-b border-drix-border bg-drix-surface/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black tracking-tight">DR<span className="text-drix-cyan">i</span>X</span>
            <span className="text-[10px] font-bold tracking-widest uppercase text-drix-muted bg-drix-surface2 px-2 py-0.5 rounded-md border border-drix-border">{user.role}</span>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-xs text-drix-dim">
              <span className="font-semibold text-drix-text">{user.name}</span>
              <span className="mx-1.5 text-drix-border">·</span>{user.company}
            </div>
            <button onClick={logout} className="text-drix-muted hover:text-drix-text transition-colors"><LogOut size={16} /></button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Stats */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-4 sm:grid-cols-8 gap-2 mb-6">
          {statOrder.map(s => {
            const st = stats[s] || { count: 0, value: 0 }
            const sc = STATUS_COLORS[s]
            return (
              <button key={s} onClick={() => setFilter(f => ({ ...f, status: f.status === s ? '' : s }))}
                className={`rounded-xl border p-3 text-center transition-all cursor-pointer hover:border-drix-accent/40 ${filter.status === s ? 'border-drix-accent bg-drix-accent/5' : 'border-drix-border bg-drix-surface'}`}>
                <div className={`text-lg font-black ${sc.text}`}>{st.count}</div>
                <div className="text-[9px] font-bold tracking-wider uppercase text-drix-muted">{sc.label}</div>
                {st.value > 0 && <div className="text-[10px] font-semibold text-drix-dim mt-0.5">{fmtMoney(st.value)}</div>}
              </button>
            )
          })}
          <div className="rounded-xl border border-drix-border bg-drix-surface p-3 text-center">
            <div className="text-lg font-black text-drix-text">{stats.total?.count || 0}</div>
            <div className="text-[9px] font-bold tracking-wider uppercase text-drix-muted">Total</div>
            {(stats.total?.value || 0) > 0 && <div className="text-[10px] font-semibold text-drix-accent mt-0.5">{fmtMoney(stats.total?.value || 0)}</div>}
          </div>
        </motion.div>

        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            {partners.length > 1 && (
              <select value={filter.partner} onChange={e => setFilter(f => ({ ...f, partner: e.target.value }))}
                className="bg-drix-surface2 border border-drix-border rounded-lg px-3 py-1.5 text-xs text-drix-text outline-none appearance-none cursor-pointer">
                <option value="">All partners</option>
                {partners.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            )}
            {sources.length > 1 && (
              <select value={filter.source} onChange={e => setFilter(f => ({ ...f, source: e.target.value }))}
                className="bg-drix-surface2 border border-drix-border rounded-lg px-3 py-1.5 text-xs text-drix-text outline-none appearance-none cursor-pointer">
                <option value="">All sources</option>
                {sources.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
            {(filter.status || filter.partner || filter.source) && (
              <button onClick={() => setFilter({ status: '', partner: '', source: '' })} className="text-[10px] text-drix-accent hover:underline font-bold">Clear filters</button>
            )}
          </div>
          {(user.role === 'vendor' || user.role === 'manager') && (
            <button onClick={() => setShowUpload(true)}
              className="flex items-center gap-2 bg-gradient-to-r from-drix-accent to-drix-purple text-white rounded-lg px-4 py-2 text-xs font-bold hover:shadow-glow transition-all">
              <Upload size={14} /> Upload CSV
            </button>
          )}
        </div>

        {uploadStatus && (
          <div className={`mb-4 px-4 py-2.5 rounded-xl text-xs font-medium border ${uploadStatus.includes('Error') ? 'bg-drix-red/10 border-drix-red/30 text-[#ff9a9a]' : 'bg-drix-green/10 border-drix-green/30 text-drix-green'}`}>
            {uploadStatus}
          </div>
        )}

        {/* Table */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="bg-drix-surface border border-drix-border rounded-2xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-drix-dim text-sm">Loading opportunities...</div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <div className="text-drix-dim text-sm mb-2">{opps.length === 0 ? 'No opportunities yet.' : 'No matches.'}</div>
              {opps.length === 0 && (user.role === 'vendor' || user.role === 'manager') && (
                <button onClick={() => setShowUpload(true)} className="text-drix-accent text-xs font-bold hover:underline">Upload your first CSV</button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-drix-border bg-drix-surface2/50">
                    {['Customer','Partner','Solution','Rep','Value','Source','Status','Views','Last Seen','Created'].map(h => (
                      <th key={h} className={`${h === 'Views' ? 'text-center' : 'text-left'} px-3 py-3 font-extrabold tracking-wider uppercase text-drix-muted text-[10px] ${h === 'Customer' ? 'pl-4' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(opp => {
                    const sc = STATUS_COLORS[opp.status] || STATUS_COLORS.processing
                    const canAssign = (user.role === 'manager' || user.role === 'vendor') && !opp.rep_name && !['processing'].includes(opp.status)
                    const canClick = !['processing'].includes(opp.status)
                    return (
                      <tr key={opp.id}
                        className={`border-b border-drix-border/50 transition-colors ${canClick ? 'hover:bg-drix-accent/5 cursor-pointer' : 'opacity-60'}`}
                        onClick={() => { if (canClick) nav(`/opp/${opp.id}`) }}>
                        <td className="pl-4 pr-3 py-3">
                          <div className="font-bold text-drix-text text-sm">{opp.customer_name}</div>
                          <div className="text-drix-muted truncate max-w-[180px]">{opp.customer_url}</div>
                        </td>
                        <td className="px-3 py-3 text-drix-dim">{opp.partner_company}</td>
                        <td className="px-3 py-3 text-drix-dim"><div className="truncate max-w-[160px]">{opp.solution_url}</div></td>
                        <td className="px-3 py-3">
                          {opp.rep_name ? <span className="text-drix-text">{opp.rep_name}</span>
                            : canAssign ? <button className="text-drix-accent font-bold hover:underline" onClick={e => { e.stopPropagation(); setAssignModal(opp) }}>Assign</button>
                            : <span className="text-drix-muted">—</span>}
                        </td>
                        <td className="px-3 py-3 font-semibold text-drix-text">{fmtMoney(opp.estimated_value)}</td>
                        <td className="px-3 py-3"><span className="bg-drix-surface2 border border-drix-border/50 px-2 py-0.5 rounded-md text-drix-dim">{opp.lead_source}</span></td>
                        <td className="px-3 py-3"><span className={`${sc.bg} ${sc.text} px-2.5 py-1 rounded-lg font-bold text-[10px] tracking-wide uppercase`}>{sc.label}</span></td>
                        <td className="px-3 py-3 text-center font-semibold">{opp.view_count}</td>
                        <td className="px-3 py-3 text-drix-muted">{ago(opp.last_accessed_at)}</td>
                        <td className="px-3 py-3 text-drix-muted">{fmtDate(opp.created_at)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      {/* Upload Modal */}
      <AnimatePresence>
        {showUpload && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setShowUpload(false)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-drix-surface border border-drix-border rounded-2xl p-6 max-w-lg w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-drix-text">Upload Opportunities</h2>
                <button onClick={() => setShowUpload(false)} className="text-drix-dim hover:text-drix-text"><X size={18} /></button>
              </div>
              <div className="bg-drix-surface2 border border-drix-border rounded-xl p-4 mb-4">
                <div className="text-[10px] font-bold tracking-wider uppercase text-drix-muted mb-2">Required CSV columns</div>
                <div className="grid grid-cols-2 gap-1 text-xs text-drix-dim">
                  <span>customer_url</span><span>solution_url</span>
                  <span>partner_url</span><span>manager_email</span>
                  <span className="text-drix-muted italic">estimated_value (optional)</span>
                  <span className="text-drix-muted italic">(customer &amp; partner names are detected from the URLs)</span>
                </div>
              </div>
              <label className="flex flex-col items-center justify-center gap-2 cursor-pointer bg-drix-bg border-2 border-dashed border-drix-border rounded-xl p-8 hover:border-drix-accent/50 transition-all">
                <Upload size={28} className="text-drix-accent" />
                <span className="text-sm font-bold text-drix-text">Drop your CSV here or click to browse</span>
                <span className="text-xs text-drix-dim">Max 5MB</span>
                <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleUpload} />
              </label>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Assign Modal */}
      <AnimatePresence>
        {assignModal && (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setAssignModal(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-drix-surface border border-drix-border rounded-2xl p-6 max-w-md w-full" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-black text-drix-text">Assign Rep</h2>
                <button onClick={() => setAssignModal(null)} className="text-drix-dim hover:text-drix-text"><X size={18} /></button>
              </div>
              <div className="bg-drix-surface2 border border-drix-border rounded-xl p-3 mb-4">
                <div className="font-bold text-drix-text">{assignModal.customer_name}</div>
                <div className="text-xs text-drix-dim mt-0.5">{fmtMoney(assignModal.estimated_value)} · {assignModal.lead_source}</div>
              </div>
              <div className="space-y-3 mb-5">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold tracking-widest uppercase text-drix-muted">Rep Name</label>
                  <input value={assignName} onChange={e => setAssignName(e.target.value)} autoFocus
                    className="bg-drix-surface2 border border-drix-border rounded-xl px-4 py-2.5 text-sm text-drix-text outline-none focus:border-drix-green transition-all" placeholder="Jane Smith" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-extrabold tracking-widest uppercase text-drix-muted">Rep Email</label>
                  <input value={assignEmail} onChange={e => setAssignEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAssign()}
                    className="bg-drix-surface2 border border-drix-border rounded-xl px-4 py-2.5 text-sm text-drix-text outline-none focus:border-drix-green transition-all" placeholder="jane@partner.com" />
                </div>
              </div>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setAssignModal(null)} className="px-4 py-2.5 rounded-lg text-xs font-bold border border-drix-border text-drix-dim hover:text-drix-text transition-all">Cancel</button>
                <button onClick={handleAssign} disabled={assignLoading || !assignName.trim() || !assignEmail.trim()}
                  className="px-5 py-2.5 rounded-lg text-xs font-bold bg-drix-green text-drix-bg hover:shadow-glow transition-all disabled:opacity-50 flex items-center gap-2">
                  {assignLoading && <span className="w-3 h-3 border-2 border-drix-bg/30 border-t-drix-bg rounded-full animate-spin" />}
                  Assign
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
