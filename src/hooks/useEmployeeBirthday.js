import { useState, useEffect } from 'react'
import { employeeGetBirthdayToday } from '../api/birthday'

// VA-5 (plan.md §11) — checked once per login/dashboard mount, live off today's date.
export function useEmployeeBirthday(token, empId) {
  const [isBirthdayToday, setIsBirthdayToday] = useState(false)

  useEffect(() => {
    if (!token || !empId) { setIsBirthdayToday(false); return }
    employeeGetBirthdayToday(token, empId).then(setIsBirthdayToday).catch(console.error)
  }, [token, empId])

  return isBirthdayToday
}
