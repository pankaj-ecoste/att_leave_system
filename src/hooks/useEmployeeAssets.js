import { useState, useEffect } from 'react'
import { employeeFetchOwnAssets } from '../api/assets'

// VA-10 (plan.md §11) — read-only, staff can see their own assigned assets.
export function useEmployeeAssets(token, empId) {
  const [assets, setAssets] = useState([])

  useEffect(() => {
    if (!token || !empId) { setAssets([]); return }
    employeeFetchOwnAssets(token, empId).then(setAssets).catch(console.error)
  }, [token, empId])

  return assets
}
