import { useState } from 'react'
import { COMPANIES, COMPANY_COLORS, COMPANY_ICONS } from '../../lib/constants'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'

// Company -> employee picker -> PIN entry. The employee list here is intentionally the
// public directory (name/company/job title only, no email/phone) — see the RLS notes
// in 0002_hrms_schema.sql for what's deliberately not exposed pre-login.
export function LoginScreen({ directory, employeeLogin, onLoggedIn, onShowAdminLogin }) {
  const [step, setStep] = useState(1)
  const [company, setCompany] = useState('')
  const [search, setSearch] = useState('')
  const [selectedEmp, setSelectedEmp] = useState(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [busy, setBusy] = useState(false)

  const activeEmps = directory.filter(e => e.active)
  const companyEmps = company ? activeEmps.filter(e => e.company === company) : []
  const q = search.toLowerCase()
  const filtered = companyEmps.filter(e => !q || e.name.toLowerCase().includes(q) || (e.empNum || '').toLowerCase().includes(q))

  async function doLogin() {
    if (!selectedEmp || busy) return
    setBusy(true)
    const result = await employeeLogin(selectedEmp.id, pin)
    setBusy(false)
    if (!result.token) {
      if (result.error === 'locked') {
        const until = result.lockedUntil ? new Date(result.lockedUntil).toLocaleTimeString() : 'a few minutes'
        setError(`Too many incorrect attempts. Try again after ${until}.`)
      } else if (result.error === 'network') {
        setError('Could not reach the server. Check your connection and try again.')
      } else {
        setError('Incorrect PIN. Please try again.')
      }
      return
    }
    setError('')
    onLoggedIn(result.token, selectedEmp, rememberMe)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-indigo-500/30">
            <span className="text-white font-bold text-3xl">AL</span>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">HRMS</h1>
          <p className="text-white/30 text-sm mt-2">Select your company to get started</p>
        </div>

        {step === 1 && (
          <div className="space-y-3">
            {COMPANIES.map((c, i) => (
              <button
                key={c}
                onClick={() => { setCompany(c); setStep(2) }}
                className="w-full p-4 rounded-2xl border border-white/10 hover:border-white/20 text-left transition-all group hover:scale-[1.01] active:scale-[0.99]"
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${COMPANY_COLORS[i]} flex items-center justify-center shadow-lg`}>
                    <span className="text-white font-bold text-lg">{COMPANY_ICONS[i]}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold">{c}</p>
                    <p className="text-white/40 text-xs mt-0.5">{activeEmps.filter(e => e.company === c).length} active employees</p>
                  </div>
                  <span className="text-white/30 group-hover:text-white/60 text-xl transition-colors">&rsaquo;</span>
                </div>
              </button>
            ))}
          </div>
        )}

        {step === 2 && (
          <Card>
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
              <button
                onClick={() => { setStep(1); setSelectedEmp(null); setSearch('') }}
                className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all text-lg"
              >
                &lsaquo;
              </button>
              <div>
                <p className="text-white font-semibold text-sm">{company}</p>
                <p className="text-white/40 text-xs">Select your name</p>
              </div>
            </div>

            {!selectedEmp ? (
              companyEmps.length === 0 ? (
                <div className="text-center py-10">
                  <p className="text-white/40">No employees registered</p>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mb-3">
                    <Input className="flex-1 text-xs" placeholder="Search by name or employee number..." value={search} onChange={e => setSearch(e.target.value)} autoComplete="off" />
                    {search && <button className="text-white/40 hover:text-white/70 text-sm px-2" onClick={() => setSearch('')}>x</button>}
                  </div>
                  <p className="text-white/30 text-xs mb-2">{filtered.length} employee{filtered.length !== 1 ? 's' : ''} found</p>
                  <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                    {filtered.map(e => (
                      <button key={e.id} onClick={() => setSelectedEmp(e)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-500/40 text-left transition-all">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center text-sm font-bold text-white mb-2">
                          {(e.name || '?')[0].toUpperCase()}
                        </div>
                        <p className="text-white text-xs font-medium truncate">{e.name}</p>
                        <p className="text-white/30 text-xs truncate">{e.jobTitle || e.dept || 'Employee'}</p>
                        {e.empNum && <p className="text-white/20 text-xs truncate">{e.empNum}</p>}
                      </button>
                    ))}
                    {filtered.length === 0 && <div className="col-span-2 text-center py-6 text-white/30 text-sm">No employees match your search</div>}
                  </div>
                </>
              )
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white">
                    {(selectedEmp.name || '?')[0].toUpperCase()}
                  </div>
                  <div>
                    <p className="text-white font-semibold">{selectedEmp.name}</p>
                    <p className="text-white/40 text-xs">{selectedEmp.jobTitle || selectedEmp.dept}</p>
                  </div>
                </div>
                <Label>Enter PIN</Label>
                <Input
                  type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                  className="mb-2 text-center tracking-widest text-lg" value={pin}
                  onChange={e => setPin(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && doLogin()}
                  placeholder="----"
                />
                {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 text-red-300 text-xs text-center">{error}</div>}
                <label className="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)} className="w-4 h-4 rounded accent-indigo-500" />
                  <span className="text-white/50 text-xs">Remember me on this device</span>
                </label>
                <div className="flex gap-2">
                  <Button className="flex-1" disabled={busy} onClick={doLogin}>Login</Button>
                  <Button variant="secondary" onClick={() => { setSelectedEmp(null); setPin(''); setError(''); setSearch('') }}>Back</Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="text-center mt-6">
          <button className="text-indigo-400/60 hover:text-indigo-400 text-sm transition-colors" onClick={onShowAdminLogin}>Admin Panel Login</button>
        </div>
      </div>
    </div>
  )
}
