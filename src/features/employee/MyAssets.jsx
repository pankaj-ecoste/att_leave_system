import { Card } from '../../components/ui/Card'

// VA-10 (plan.md §11) — read-only; admin/HR manage assets from the Employees screen.
export function MyAssets({ assets }) {
  return (
    <Card>
      <h2 className="text-white font-semibold mb-4">My Assets</h2>
      {assets.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-4">No assets assigned</p>
      ) : (
        <div className="space-y-2">
          {assets.map(a => (
            <div key={a.id} className="bg-white/5 rounded-xl p-3 border border-white/5">
              <p className="text-white text-sm font-medium">{a.assetType}{a.serialNumber && <span className="text-white/40 font-normal"> · {a.serialNumber}</span>}</p>
              <p className="text-white/30 text-xs">{[a.assignedDate, a.status].filter(Boolean).join(' · ') || '—'}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
