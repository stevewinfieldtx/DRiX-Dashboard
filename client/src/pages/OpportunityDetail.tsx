import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, DollarSign, Target, Clock, CheckCircle, XCircle, Zap } from 'lucide-react'

const esc = (s: any) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c] || c))
const short = (s: any) => { if (!s) return '—'; return String(s).split(/[\/,.]/)[0].split(' ').slice(0, 2).join(' ') }

const STATUS_LABELS: Record<string, string> = {
  processing: 'Processing', ready: 'Ready', assigned: 'Assigned',
  reviewing: 'Reviewing', active: 'Active', won: 'Won', lost: 'Lost',
}

export default function OpportunityDetail() {
  const { id } = useParams()
  const nav = useNavigate()
  const [opp, setOpp] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null)
  const [hydrating, setHydrating] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [user, setUser] = useState<any>(null)
  const [reassign, setReassign] = useState(false)
  const [partnerUrl, setPartnerUrl] = useState('')
  const [managerEmail, setManagerEmail] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch('/api/dashboard/me')
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then(d => setUser(d.user))
      .catch(() => nav('/login'))
  }, [nav])

  useEffect(() => {
    if (!id || !user) return
    setLoading(true)
    fetch(`/api/dashboard/opp/${id}`)
      .then(r => { if (!r.ok) throw new Error('Not found'); return r.json() })
      .then(d => { setOpp(d.opportunity); setSelectedStrategy(d.opportunity?.chosen_strategy_id || null) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [id, user])

  const selectStrategy = async () => {
    if (hydrating || !selectedStrategy) return
    setHydrating(true)
    try {
      const res = await fetch(`/api/dashboard/opp/${id}/select-strategy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy_id: selectedStrategy }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      // Reload opp to get updated data
      const oppRes = await fetch(`/api/dashboard/opp/${id}`)
      const oppData = await oppRes.json()
      setOpp(oppData.opportunity)
    } catch (e: any) {
      setError(e.message)
      setSelectedStrategy(opp?.chosen_strategy_id || null)
    } finally {
      setHydrating(false)
    }
  }

  const doReassign = async () => {
    if (!partnerUrl.trim() || !managerEmail.trim()) return
    setReassigning(true)
    try {
      const res = await fetch(`/api/dashboard/opp/${id}/reassign-partner`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner_url: partnerUrl.trim(), manager_email: managerEmail.trim() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      const oppRes = await fetch(`/api/dashboard/opp/${id}`)
      const oppData = await oppRes.json()
      setOpp(oppData.opportunity)
      setReassign(false)
    } catch (e: any) {
      alert(e.message)
    } finally {
      setReassigning(false)
    }
  }

  const updateStatus = async (status: string) => {
    setStatusUpdating(true)
    try {
      const res = await fetch(`/api/dashboard/opp/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      setOpp((prev: any) => ({ ...prev, status }))
    } catch (e: any) {
      alert(e.message)
    } finally {
      setStatusUpdating(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-drix-bg flex items-center justify-center text-drix-dim text-sm">Loading opportunity...</div>
  )
  if (error || !opp) return (
    <div className="min-h-screen bg-drix-bg flex items-center justify-center text-drix-red text-sm">{error || 'Opportunity not found'}</div>
  )

  const drix = opp.drix_result || {}
  const strategies = drix.strategies?.strategies || []
  const painGroups = drix.pain_groups || {}
  const hydration = opp.hydration_result
  const hasStrategies = strategies.length > 0
  const hasHydration = !!hydration

  return (
    <div className="min-h-screen bg-drix-bg text-drix-text">
      {/* Header bar */}
      <div className="border-b border-drix-border bg-drix-surface/80 backdrop-blur-sm sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
          <button onClick={() => nav('/')} className="flex items-center gap-2 text-xs text-drix-dim hover:text-drix-text transition-colors">
            <ArrowLeft size={14} /> Back to Dashboard
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => { navigator.clipboard.writeText(window.location.href); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-drix-surface2 text-drix-dim border border-drix-border hover:text-drix-text transition-all">
              {copied ? 'Link copied!' : 'Copy link'}
            </button>
            {opp.status !== 'won' && opp.status !== 'lost' && hasHydration && (
              <>
                <button
                  onClick={() => updateStatus('won')}
                  disabled={statusUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-drix-green/15 text-drix-green border border-drix-green/30 hover:bg-drix-green/25 transition-all disabled:opacity-40"
                >
                  <CheckCircle size={13} /> Won
                </button>
                <button
                  onClick={() => updateStatus('lost')}
                  disabled={statusUpdating}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold bg-drix-red/15 text-drix-red border border-drix-red/30 hover:bg-drix-red/25 transition-all disabled:opacity-40"
                >
                  <XCircle size={13} /> Lost
                </button>
              </>
            )}
            {(opp.status === 'won' || opp.status === 'lost') && (
              <span className={`px-3 py-1.5 rounded-lg text-xs font-bold ${opp.status === 'won' ? 'bg-drix-green/20 text-drix-green' : 'bg-drix-red/20 text-drix-red'}`}>
                {opp.status === 'won' ? 'Won' : 'Lost'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Opp Header */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-2xl font-black tracking-tight mb-1">{opp.customer_name}</h1>
              <div className="flex items-center gap-3 text-xs text-drix-dim flex-wrap">
                <span className="flex items-center gap-1"><DollarSign size={12} />${(opp.estimated_value || 0).toLocaleString()}</span>
                <span className="text-drix-border">·</span>
                <span>{opp.partner_company}</span>
                <span className="text-drix-border">·</span>
                <span>{opp.lead_source}</span>
                {opp.rep_name && <><span className="text-drix-border">·</span><span>Rep: {opp.rep_name}</span></>}
              </div>
            </div>
            <span className={`px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide uppercase ${
              opp.status === 'active' ? 'bg-drix-green/15 text-drix-green' :
              opp.status === 'won' ? 'bg-drix-green/25 text-drix-green' :
              opp.status === 'lost' ? 'bg-drix-red/15 text-drix-red' :
              opp.status === 'reviewing' ? 'bg-drix-purple/15 text-drix-purple' :
              'bg-drix-accent/15 text-drix-accent'
            }`}>
              {STATUS_LABELS[opp.status] || opp.status}
            </span>
          </div>
          {opp.notes && <div className="mt-3 text-xs text-drix-dim bg-drix-surface border border-drix-border rounded-lg px-3 py-2">{opp.notes}</div>}
          {user?.role === 'vendor' && (
            <div className="mt-3">
              {!reassign ? (
                <button onClick={() => { setReassign(true); setPartnerUrl(opp.partner_url || ''); setManagerEmail(opp.manager_email || '') }}
                  className="text-xs text-drix-accent font-bold hover:underline">Change partner</button>
              ) : (
                <div className="bg-drix-surface border border-drix-border rounded-xl p-3 flex flex-col gap-2 max-w-md">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-drix-muted">Reassign partner</div>
                  <input value={partnerUrl} onChange={e => setPartnerUrl(e.target.value)} placeholder="Partner URL"
                    className="bg-drix-surface2 border border-drix-border rounded-lg px-3 py-2 text-xs text-drix-text outline-none focus:border-drix-accent" />
                  <input value={managerEmail} onChange={e => setManagerEmail(e.target.value)} placeholder="Partner manager email"
                    className="bg-drix-surface2 border border-drix-border rounded-lg px-3 py-2 text-xs text-drix-text outline-none focus:border-drix-accent" />
                  <div className="flex items-center gap-2">
                    <button onClick={doReassign} disabled={reassigning || !partnerUrl.trim() || !managerEmail.trim()}
                      className="bg-drix-accent text-white rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-50">{reassigning ? 'Saving...' : 'Save'}</button>
                    <button onClick={() => setReassign(false)} className="text-xs text-drix-dim hover:text-drix-text">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>

        {/* Processing state */}
        {opp.status === 'processing' && (
          <div className="bg-drix-surface border border-drix-border rounded-2xl p-12 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-drix-yellow/15 mb-4">
              <Zap size={24} className="text-drix-yellow animate-pulse" />
            </div>
            <div className="text-lg font-bold mb-2">DRiX Lead is processing this opportunity</div>
            <div className="text-sm text-drix-dim">Ingesting customer and solution data, extracting pain points, and generating strategies. This usually takes 30-90 seconds.</div>
          </div>
        )}

        {/* Error state */}
        {drix.error && (
          <div className="bg-drix-red/10 border border-drix-red/30 rounded-2xl p-6 text-center mb-6">
            <div className="text-sm text-drix-red font-bold mb-1">DRiX Lead processing failed</div>
            <div className="text-xs text-drix-dim">{drix.error}</div>
          </div>
        )}

        {/* ═══ PAIN POINTS ═══ */}
        {hasStrategies && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="bg-drix-surface border border-drix-border rounded-2xl p-6 mb-6">
            <div className="text-[11px] font-extrabold tracking-[2px] uppercase text-drix-muted mb-4 flex items-center gap-2">
              <span className="w-3 h-0.5 bg-drix-red rounded-full" />
              Pain Points
            </div>
            {['company_pain', 'subindustry_pain', 'industry_pain'].map(group => {
              const items = painGroups[group] || []
              if (!items.length) return null
              const label = group === 'company_pain' ? 'Company-specific' : group === 'subindustry_pain' ? 'Sub-industry' : 'Industry-wide'
              const borderColor = group === 'company_pain' ? 'border-l-drix-red' : group === 'subindustry_pain' ? 'border-l-drix-orange' : 'border-l-drix-cyan'
              return (
                <div key={group} className="mb-4">
                  <div className="text-[10px] font-bold tracking-wider uppercase text-drix-muted mb-2">{label} ({items.length})</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {items.map((p: any, i: number) => (
                      <div key={i} className={`bg-drix-bg border border-drix-border/50 ${borderColor} border-l-[3px] rounded-r-lg p-3`}>
                        <div className="font-bold text-sm text-drix-text mb-1">{p.title}</div>
                        <div className="text-xs text-drix-dim leading-relaxed">{p.description}</div>
                        {p.persona_primary && (
                          <div className="mt-2 text-[10px] text-drix-accent font-semibold">{p.persona_primary.title}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </motion.div>
        )}

        {/* ═══ STRATEGIES ═══ */}
        {hasStrategies && !hasHydration && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="bg-drix-surface border border-drix-border rounded-2xl p-6 mb-6">
            <div className="text-[11px] font-extrabold tracking-[2px] uppercase text-drix-muted mb-2 flex items-center gap-2">
              <span className="w-3 h-0.5 bg-drix-accent rounded-full" />
              Sales Strategies — {strategies.length}
            </div>
            <div className="text-xs text-drix-dim mb-4">Select a strategy to generate discovery questions and email campaign.</div>
            <div className="flex flex-col gap-3">
              {strategies.map((s: any) => {
                const isSelected = selectedStrategy === s.id
                const confPct = Math.max(0, Math.min(100, parseInt(s.confidence) || 0))
                return (
                  <div
                    key={s.id}
                    onClick={() => { if (!hydrating) setSelectedStrategy(s.id) }}
                    className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${
                      isSelected ? 'border-drix-green bg-drix-green/5' : 'border-drix-border hover:border-drix-accent/50'
                    } ${hydrating ? 'opacity-50 cursor-wait' : ''}`}
                  >
                    <div className="flex items-start gap-3">
                      <div className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 text-[11px] font-black transition-all ${
                        isSelected ? 'border-drix-green bg-drix-green text-drix-bg' : 'border-drix-border'
                      }`}>
                        {isSelected ? '✓' : ''}
                      </div>
                      <div className="flex-1">
                        <div className="font-bold text-sm text-drix-text mb-1">{s.title}</div>
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <span className="text-[10px] font-bold bg-drix-accent/12 text-drix-accent px-2 py-0.5 rounded-md">{s.target_persona || 'General'}</span>
                          <span className="text-[10px] font-bold bg-drix-red/12 text-[#ff9a9a] px-2 py-0.5 rounded-md">{s.pain_anchor || '—'}</span>
                          <span className="text-[10px] text-drix-muted">{confPct}% confidence</span>
                        </div>
                        <div className="text-xs text-drix-dim leading-relaxed">{s.explanation}</div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-5 flex items-center gap-3">
              <button onClick={selectStrategy} disabled={!selectedStrategy || hydrating}
                className="bg-gradient-to-r from-drix-accent to-drix-purple text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:shadow-glow transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2">
                {hydrating && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {hydrating ? 'Generating...' : selectedStrategy ? 'Generate questions & email campaign' : 'Select a strategy first'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ═══ SELECTED STRATEGY + HYDRATION ═══ */}
        {hasHydration && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}
            className="bg-drix-surface border border-drix-border rounded-2xl p-6 mb-6">

            {/* Selected strategy banner */}
            {opp.chosen_strategy_title && (
              <div className="bg-drix-green/8 border border-drix-green/20 rounded-xl p-4 mb-6">
                <div className="text-[10px] font-bold tracking-wider uppercase text-drix-green mb-1">Selected Strategy</div>
                <div className="font-bold text-drix-text">{opp.chosen_strategy_title}</div>
              </div>
            )}

            {/* Fit score */}
            {hydration.score && (
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-drix-border">
                <div className={`border-2 rounded-xl px-4 py-2 text-center ${
                  hydration.score >= 80 ? 'border-drix-green text-drix-green' :
                  hydration.score >= 60 ? 'border-drix-accent text-drix-accent' :
                  'border-drix-yellow text-drix-yellow'
                }`}>
                  <div className="text-2xl font-black">{hydration.score}</div>
                  <div className="text-[9px] font-bold tracking-widest uppercase text-drix-muted">Fit</div>
                </div>
                {hydration.whoIsThis && <div className="text-sm text-drix-dim flex-1 leading-relaxed">{hydration.whoIsThis}</div>}
              </div>
            )}

            {/* Discovery Questions */}
            {hydration.questions?.length > 0 && (
              <div className="mb-6">
                <div className="text-[11px] font-extrabold tracking-[2px] uppercase text-drix-muted mb-4 flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-drix-green rounded-full" />
                  Discovery Questions — {hydration.questions.length}
                </div>
                <div className="flex flex-col gap-3">
                  {hydration.questions.map((q: any, i: number) => (
                    <div key={i} className="bg-drix-surface2 border border-drix-border rounded-xl p-4">
                      <div className="text-[10px] font-bold tracking-wider uppercase text-drix-accent mb-1">{q.stage || 'Question'}</div>
                      <div className="font-semibold text-sm text-drix-text mb-2">{q.question}</div>
                      {q.purpose && <div className="text-xs text-drix-dim mb-2"><span className="text-drix-muted font-bold uppercase text-[9px] tracking-wider">Why: </span>{q.purpose}</div>}
                      {q.tone_guidance && (
                        <div className="text-[11px] text-drix-dim italic bg-drix-accent/5 border-l-2 border-drix-accent px-3 py-2 rounded-r-md mb-2">{q.tone_guidance}</div>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mt-2">
                        {(q.positive_responses || []).map((r: any, j: number) => (
                          <div key={`p${j}`} className="border border-drix-border/50 bg-drix-green/4 border-l-2 border-l-drix-green rounded-r-lg p-2.5">
                            <div className="text-[9px] font-bold tracking-wider uppercase text-drix-green mb-1">If they say (positive)</div>
                            <div className="text-[11px] text-drix-text italic mb-1">"{r.response}"</div>
                            {r.next_step && <div className="text-[11px] text-drix-dim"><span className="font-bold text-drix-text">Next:</span> {r.next_step}</div>}
                          </div>
                        ))}
                        {(q.neutral_negative_responses || q.negative_responses || []).map((r: any, j: number) => (
                          <div key={`n${j}`} className="border border-drix-border/50 bg-drix-red/4 border-l-2 border-l-drix-red rounded-r-lg p-2.5">
                            <div className="text-[9px] font-bold tracking-wider uppercase text-drix-red mb-1">If they say (pivot)</div>
                            <div className="text-[11px] text-drix-text italic mb-1">"{r.response}"</div>
                            {(r.pivot || r.next_step) && <div className="text-[11px] text-drix-dim"><span className="font-bold">Pivot:</span> {r.pivot || r.next_step}</div>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Email Campaign */}
            {(hydration.emailCampaign || hydration.emailSequence || []).length > 0 && (
              <div>
                <div className="text-[11px] font-extrabold tracking-[2px] uppercase text-drix-muted mb-4 flex items-center gap-2">
                  <span className="w-3 h-0.5 bg-drix-cyan rounded-full" />
                  Email Campaign — {(hydration.emailCampaign || hydration.emailSequence).length} steps
                </div>
                <div className="flex flex-col gap-2">
                  {(hydration.emailCampaign || hydration.emailSequence || []).map((em: any, i: number) => (
                    <div key={i} className="bg-drix-surface2 border border-drix-border border-l-[3px] border-l-drix-cyan rounded-r-xl p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold tracking-wider uppercase text-drix-cyan">{em.label || `Email ${em.step || i + 1}`}</span>
                        {em.sendDay && <span className="text-[10px] text-drix-muted bg-drix-surface3 px-2 py-0.5 rounded-md">{em.sendDay}</span>}
                      </div>
                      <div className="text-sm text-drix-text mb-2"><span className="text-drix-dim font-semibold">Subject:</span> {em.subject || em.subject_line}</div>
                      <div className="text-xs text-drix-dim leading-relaxed whitespace-pre-wrap">{em.body || em.content}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* Strategies (read-only, after hydration) */}
        {hasHydration && strategies.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="bg-drix-surface border border-drix-border rounded-2xl p-6 mb-6">
            <details>
              <summary className="text-[11px] font-extrabold tracking-[2px] uppercase text-drix-muted cursor-pointer hover:text-drix-dim transition-colors">
                All {strategies.length} Strategies (expand)
              </summary>
              <div className="mt-4 flex flex-col gap-2">
                {strategies.map((s: any) => (
                  <div key={s.id} className={`border rounded-xl p-3 ${s.id === opp.chosen_strategy_id ? 'border-drix-green/50 bg-drix-green/5' : 'border-drix-border'}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-sm text-drix-text">{s.title}</span>
                      {s.id === opp.chosen_strategy_id && <span className="text-[9px] font-bold bg-drix-green/20 text-drix-green px-2 py-0.5 rounded-md">SELECTED</span>}
                    </div>
                    <div className="text-xs text-drix-dim">{s.explanation}</div>
                  </div>
                ))}
              </div>
            </details>
          </motion.div>
        )}
      </div>
    </div>
  )
}
