import { useRef, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { bioSheetCellColor } from '../../lib/format'

function StatusLine({ text }) {
  if (!text) return null
  const tone = text.startsWith('Imported') || text.startsWith('Synced') ? 'text-emerald-400'
    : text.startsWith('Loading') || text.startsWith('Reading') || text.startsWith('Parsed') ? 'text-blue-400'
    : 'text-red-400'
  return <p className={`text-xs mb-2 ${tone}`}>{text}</p>
}

export function Imports({ leaveBalanceImport, dailyBioImport, monthlyBioImport }) {
  const sheetRef = useRef(null)
  const bioRef = useRef(null)
  const monthlyRef = useRef(null)
  const [sheetSearch, setSheetSearch] = useState('')
  const [bioSearch, setBioSearch] = useState('')
  const [showBioLog, setShowBioLog] = useState(false)
  const [showMonthlyLog, setShowMonthlyLog] = useState(false)
  const [editCell, setEditCell] = useState(null)
  const [editVal, setEditVal] = useState('')

  const { sheet, status: sheetStatus, handleImport: handleSheetImport, removeSheet, exportSheet, editCell: editSheetCell, deleteRow } = leaveBalanceImport
  const { sheet: bioSheet, status: bioStatus, syncLog: bioSyncLog, handleImport: handleBio, removeSheet: removeBio, exportSheet: exportBio } = dailyBioImport
  const { sheet: monthlySheet, status: monthlyStatus, syncLog: monthlySyncLog, handleImport: handleMonthly, removeSheet: removeMonthly } = monthlyBioImport

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
      <Card className="flex flex-col min-h-0" style={{ height: '480px', overflow: 'hidden' }}>
        <div className="flex items-center gap-2 mb-1">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">1</span>
          <h3 className="text-white font-semibold text-sm">Import Leave Balance Data</h3>
        </div>
        <p className="text-white/30 text-xs mb-3 flex-shrink-0">Required: Employee Number, Employee Name, Job Title, Business Unit, Department, Sub Department, Location, Cost Center, Reporting Manager + [Leave Type] - Accrued/Consumed/Balance/AnnualQuota/Unit</p>
        <input ref={sheetRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files[0] && handleSheetImport(e.target.files[0]).finally(() => { e.target.value = '' })} />
        <div className="flex-shrink-0">
          {sheet ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
              <div><p className="text-emerald-300 text-sm font-medium truncate">{sheet.filename}</p><p className="text-white/30 text-xs">{sheet.rows?.length} rows · {new Date(sheet.importedAt).toLocaleDateString()}</p></div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => sheetRef.current?.click()}>Re-import</Button>
                <Button variant="danger" className="py-1 px-2" onClick={removeSheet}>Remove</Button>
              </div>
            </div>
          ) : <Button className="text-xs mb-2 w-full" onClick={() => sheetRef.current?.click()}>Choose Excel File</Button>}
          <StatusLine text={sheetStatus} />
        </div>
        {sheet?.rows?.length > 0 && (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap flex-shrink-0">
              <Input className="flex-1 text-xs" placeholder="Search sheet..." value={sheetSearch} onChange={e => setSheetSearch(e.target.value)} />
              <Button variant="secondary" className="text-xs" onClick={exportSheet}>Export</Button>
            </div>
            <div className="overflow-auto flex-1 border border-white/10 rounded-xl">
              <table className="text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-900"><tr>{sheet.cols.map(c => <th key={c} className="px-3 py-2 text-white/30 text-left border-b border-white/10 whitespace-nowrap">{c}</th>)}<th className="px-3 py-2 border-b border-white/10" /></tr></thead>
                <tbody>
                  {sheet.rows.filter(r => !sheetSearch || Object.values(r).some(v => String(v).toLowerCase().includes(sheetSearch.toLowerCase()))).map((r, ri) => (
                    <tr key={ri} className="border-b border-white/5 hover:bg-white/5">
                      {sheet.cols.map(c => {
                        const cid = `${ri}_${c}`
                        return (
                          <td key={c} className="px-3 py-1.5 whitespace-nowrap cursor-pointer" onClick={() => { setEditCell(cid); setEditVal(String(r[c] || '')) }}>
                            {editCell === cid
                              ? <input autoFocus className="bg-white/10 border border-indigo-400 rounded px-1 text-white text-xs w-24" value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') editSheetCell(ri, c, editVal); setEditCell(null) }}
                                  onBlur={() => setEditCell(null)} />
                              : String(r[c] || '')}
                          </td>
                        )
                      })}
                      <td className="px-3 py-1.5"><button className="text-red-400 hover:text-red-300 text-xs" onClick={() => deleteRow(ri)}>x</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col min-h-0" style={{ height: '480px', overflow: 'hidden' }}>
        <div className="flex items-center gap-2 mb-1 flex-shrink-0">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">2</span>
          <h3 className="text-white font-semibold text-sm">Import Daily Bio Data</h3>
        </div>
        <p className="text-white/30 text-xs mb-3 flex-shrink-0">Export from a biometric attendance device for a single day — arrival/departure times, late hours, shift, temperature checks, etc.</p>
        <input ref={bioRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files[0] && handleBio(e.target.files[0]).finally(() => { e.target.value = '' })} />
        <div className="flex-shrink-0">
          {bioSheet ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
              <div><p className="text-emerald-300 text-sm font-medium truncate">{bioSheet.filename}</p><p className="text-white/30 text-xs">{bioSheet.rows?.length || 0} rows {bioSheet.synced !== undefined ? `· ${bioSheet.synced} synced · ${bioSheet.skipped} skipped` : ''}</p></div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => bioRef.current?.click()}>Re-import</Button>
                <Button variant="secondary" className="text-xs py-1 px-2" onClick={exportBio}>Export</Button>
                <Button variant="danger" className="py-1 px-2" onClick={removeBio}>Remove</Button>
              </div>
            </div>
          ) : <Button className="text-xs mb-2 w-full" onClick={() => bioRef.current?.click()}>Choose Excel File</Button>}
          <StatusLine text={bioStatus} />
          {bioSyncLog.length > 0 && <Button variant="secondary" className="text-xs py-1 px-2 mb-2" onClick={() => setShowBioLog(s => !s)}>{showBioLog ? 'Hide' : 'Show'} Log ({bioSyncLog.length})</Button>}
          {showBioLog && bioSyncLog.length > 0 && (
            <div className="max-h-24 overflow-y-auto border border-white/10 rounded-xl p-2 mb-2 space-y-0.5 flex-shrink-0">
              {bioSyncLog.map((l, i) => <p key={i} className={`text-xs font-mono py-0.5 ${l.type === 'ok' ? 'text-emerald-400/80' : 'text-red-400/80'}`}>{l.type === 'ok' ? 'OK ' : 'SKIP '}{l.msg}</p>)}
            </div>
          )}
        </div>
        {bioSheet?.rows?.length > 0 && (
          <div className="flex flex-col flex-1 min-h-0">
            <Input className="text-xs mb-1 flex-shrink-0" placeholder="Search..." value={bioSearch} onChange={e => setBioSearch(e.target.value)} />
            <div className="overflow-auto flex-1 border border-white/10 rounded-xl">
              <table className="text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-900"><tr>{(bioSheet.cols || []).map(c => <th key={c} className="px-2 py-1.5 text-white/30 text-left border-b border-white/10 whitespace-nowrap">{c}</th>)}</tr></thead>
                <tbody>
                  {bioSheet.rows.filter(r => !bioSearch || Object.values(r).some(v => String(v).toLowerCase().includes(bioSearch.toLowerCase()))).slice(0, 200).map((r, ri) => (
                    <tr key={ri} className="border-b border-white/5 hover:bg-white/5">
                      {(bioSheet.cols || []).map(c => <td key={c} className={`px-2 py-1 whitespace-nowrap ${bioSheetCellColor(c, r[c])}`}>{String(r[c] || '')}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      <Card className="flex flex-col min-h-0" style={{ height: '480px', overflow: 'hidden' }}>
        <div className="flex items-center gap-2 mb-1 flex-shrink-0">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">3</span>
          <h3 className="text-white font-semibold text-sm">Import Monthly Bio Data</h3>
        </div>
        <p className="text-white/30 text-xs mb-3 flex-shrink-0">A whole month's attendance grid per employee — each employee spans several rows, one per metric, with a column per day.</p>
        <input ref={monthlyRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e => e.target.files[0] && handleMonthly(e.target.files[0]).finally(() => { e.target.value = '' })} />
        <div className="flex-shrink-0">
          {monthlySheet ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
              <div><p className="text-emerald-300 text-sm font-medium truncate">{monthlySheet.filename}</p><p className="text-white/30 text-xs">{monthlySheet.synced !== undefined ? `${monthlySheet.synced} day-records · ${monthlySheet.skipped} skipped` : ''}</p></div>
              <div className="flex flex-col gap-1 shrink-0">
                <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => monthlyRef.current?.click()}>Re-import</Button>
                <Button variant="danger" className="py-1 px-2" onClick={removeMonthly}>Remove</Button>
              </div>
            </div>
          ) : <Button className="text-xs mb-2 w-full" onClick={() => monthlyRef.current?.click()}>Choose Excel File</Button>}
          <StatusLine text={monthlyStatus} />
          {monthlySyncLog.length > 0 && <Button variant="secondary" className="text-xs py-1 px-2" onClick={() => setShowMonthlyLog(s => !s)}>{showMonthlyLog ? 'Hide' : 'Show'} Log ({monthlySyncLog.length})</Button>}
          {showMonthlyLog && monthlySyncLog.length > 0 && (
            <div className="max-h-24 overflow-y-auto border border-white/10 rounded-xl p-2 mt-2 space-y-0.5">
              {monthlySyncLog.map((l, i) => <p key={i} className={`text-xs font-mono py-0.5 ${l.type === 'ok' ? 'text-emerald-400/80' : 'text-red-400/80'}`}>{l.type === 'ok' ? 'OK ' : 'SKIP '}{l.msg}</p>)}
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
