import { useRef, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

function StatusLine({ text }) {
  if (!text) return null
  const tone = text.startsWith('Imported') || text.startsWith('Synced') ? 'text-emerald-400'
    : text.startsWith('Loading') || text.startsWith('Reading') || text.startsWith('Parsed') ? 'text-blue-400'
    : 'text-red-400'
  return <p className={`text-xs mb-2 ${tone}`}>{text}</p>
}

export function Imports({ leaveBalanceImport }) {
  const sheetRef = useRef(null)
  const [sheetSearch, setSheetSearch] = useState('')
  const [editCell, setEditCell] = useState(null)
  const [editVal, setEditVal] = useState('')

  const { sheet, status: sheetStatus, handleImport: handleSheetImport, removeSheet, exportSheet, editCell: editSheetCell, deleteRow } = leaveBalanceImport

  return (
    <div className="grid grid-cols-1 max-w-xl gap-4 items-start">
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
    </div>
  )
}
