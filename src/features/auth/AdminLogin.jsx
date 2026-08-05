import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'

export function AdminLogin({ adminLogin, onBack }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function doLogin() {
    if (busy) return
    setBusy(true)
    const token = await adminLogin(pin)
    setBusy(false)
    if (!token) {
      setError('Incorrect PIN, or too many attempts — please wait a few minutes and try again.')
      return
    }
    setPin('')
    setError('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Admin Login</h1>
          <p className="text-white/40 text-sm mt-1">HRMS</p>
        </div>
        <Card>
          <Label>Admin PIN</Label>
          <Input
            type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            className="mb-3 tracking-widest text-center text-lg" value={pin}
            onChange={e => setPin(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && doLogin()}
            placeholder="----"
          />
          {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 text-red-300 text-xs text-center">{error}</div>}
          <Button className="w-full" disabled={busy} onClick={doLogin}>Login to Admin Panel</Button>
          <button className="w-full mt-3 text-white/40 hover:text-white/60 text-sm transition-colors" onClick={onBack}>
            Back to Employee Login
          </button>
        </Card>
      </div>
    </div>
  )
}
