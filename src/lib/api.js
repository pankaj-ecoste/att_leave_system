import { supabase } from './supabase'

// ---------------------------------------------------------------------------
// Shape mappers — the database uses snake_case columns; the app (ported from
// the original window.storage version) uses these exact camelCase field
// names throughout its rendering logic. Keeping the mapping in one place
// means the rest of the app never has to think about snake_case at all.
// ---------------------------------------------------------------------------

export function rowToEmployee(row) {
  if (!row) return null
  return {
    id: row.id,
    empNum: row.emp_num,
    name: row.name,
    pin: row.pin,
    company: row.company,
    jobTitle: row.job_title,
    bu: row.bu || row.business_unit,
    dept: row.dept || row.department,
    subDept: row.sub_dept || row.sub_department,
    locationInfo: row.location_info,
    costCenter: row.cost_center,
    manager: row.manager,
    managerEmpId: row.manager_emp_id || null,
    email: row.email,
    phone: row.phone,
    joiningDate: row.joining_date,
    active: row.active,
    shiftType: row.shift_type || 'none',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function employeeToPayload(emp) {
  return {
    name: emp.name,
    pin: emp.pin,
    company: emp.company,
    empNum: emp.empNum || null,
    jobTitle: emp.jobTitle || null,
    bu: emp.bu || null,
    dept: emp.dept || null,
    subDept: emp.subDept || null,
    locationInfo: emp.locationInfo || null,
    costCenter: emp.costCenter || null,
    manager: emp.manager || null,
    managerEmpId: emp.managerEmpId || null,
    email: emp.email || null,
    phone: emp.phone || null,
    joiningDate: emp.joiningDate || null,
    shiftType: emp.shiftType || 'none',
  }
}

export function rowToAttendance(row) {
  if (!row) return null
  return {
    empId: row.emp_id,
    date: row.date,
    inTime: row.in_time ? row.in_time.slice(0, 5) : null,
    outTime: row.out_time ? row.out_time.slice(0, 5) : null,
    inLocation: row.in_location,
    outLocation: row.out_location,
    leaveType: row.leave_type,
    leaveReason: row.leave_reason,
    wfh: !!row.wfh,
    onDuty: !!row.on_duty,
    status: row.status,
    lateHrs: row.late_hrs,
    earlyHrs: row.early_hrs,
    bioWrkHrs: row.bio_wrk_hrs,
    bioOT: row.bio_ot,
    shift: row.shift,
    shiftStart: row.shift_start,
    inTemp: row.in_temp,
    outTemp: row.out_temp,
    remark: row.remark,
    cardNo: row.card_no,
    designation: row.designation,
    bioStatusRaw: row.bio_status_raw,
    bioSource: row.bio_source,
    monthlySource: row.monthly_source,
    weekOff: !!row.week_off,
    source: row.source,
  }
}

export function attendanceToRow(record) {
  return {
    emp_id: record.empId,
    date: record.date,
    in_time: record.inTime || null,
    out_time: record.outTime || null,
    in_location: record.inLocation || null,
    out_location: record.outLocation || null,
    leave_type: record.leaveType || null,
    leave_reason: record.leaveReason || null,
    wfh: !!record.wfh,
    on_duty: !!record.onDuty,
    status: record.status || null,
    late_hrs: record.lateHrs || null,
    early_hrs: record.earlyHrs || null,
    bio_wrk_hrs: record.bioWrkHrs || null,
    bio_ot: record.bioOT || null,
    shift: record.shift || null,
    shift_start: record.shiftStart || null,
    in_temp: record.inTemp || null,
    out_temp: record.outTemp || null,
    remark: record.remark || null,
    card_no: record.cardNo || null,
    designation: record.designation || null,
    bio_status_raw: record.bioStatusRaw || null,
    bio_source: record.bioSource || null,
    monthly_source: record.monthlySource || null,
    week_off: !!record.weekOff,
    source: record.source || null,
  }
}

// Same shape as attendanceToRow, but keyed for the bulk-upsert RPC, which
// expects emp_id inside each element of a JSON array rather than as a
// separate function argument.
export function attendanceToBulkRow(record) {
  return attendanceToRow(record)
}

export function rowToLeave(row) {
  if (!row) return null
  return {
    id: row.id,
    empId: row.emp_id,
    empName: row.emp_name,
    company: row.company,
    leaveType: row.leave_type,
    date: row.date,
    reason: row.reason,
    location: row.location,
    status: row.status,
    appliedAt: row.applied_at,
  }
}

export function rowToAuditLog(row) {
  if (!row) return null
  return {
    id: row.id,
    ts: row.ts,
    action: row.action,
    detail: row.detail,
    by: row.by_name,
  }
}

// Key used internally to look up a single day's attendance for one employee.
// Both halves are safe to join with "_" — dates are always 10 chars
// (YYYY-MM-DD) and employee ids are UUIDs, neither contains an underscore.
export function attnKey(empId, date) {
  return `${empId}_${date}`
}
export function parseAttnKey(key) {
  const idx = key.lastIndexOf('_')
  return [key.slice(0, idx), key.slice(idx + 1)]
}

// ---------------------------------------------------------------------------
// Public reads (no login required) — these power the login screen and the
// employee-side dashboard. They only touch tables/views anon is allowed to
// read directly, per the RLS policies set up in Supabase.
// ---------------------------------------------------------------------------

export async function fetchDirectory() {
  const { data, error } = await supabase.rpc('fetch_directory')
  if (error) {
    // fallback to view if RPC fails
    const { data: d2, error: e2 } = await supabase.from('employees_directory').select('*')
    if (e2) throw e2
    return (d2 || []).map(rowToEmployee)
  }
  return (data || []).map(rowToEmployee)
}

export async function fetchStdHours() {
  const { data, error } = await supabase.from('app_settings_public').select('std_hours').single()
  if (error) {
    console.error(error)
    return 9
  }
  return Number(data.std_hours) || 9
}

// ---------------------------------------------------------------------------
// Employee login & session-scoped data — every read/write below requires a
// valid token from employeeLogin() and is re-checked on the database side.
// Replaces the old verifyEmployeePin() + open-table-access approach.
// ---------------------------------------------------------------------------

export async function employeeLogin(employeeId, pin) {
  const { data, error } = await supabase.rpc('employee_login', {
    p_employee_id: employeeId,
    p_pin: pin,
  })
  if (error) {
    console.error(error)
    return { token: null, error: 'network' }
  }
  return { token: data?.token || null, error: data?.error || null, lockedUntil: data?.locked_until || null }
}

export async function employeeLogout(token) {
  if (!token) return
  const { error } = await supabase.rpc('employee_logout', { p_token: token })
  if (error) console.error(error)
}

export async function employeeFetchAttendance(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_attendance', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const rec = rowToAttendance(row)
    map[attnKey(rec.empId, rec.date)] = rec
  }
  return map
}

export async function employeePunch(token, empId, record) {
  const { data, error } = await supabase.rpc('employee_punch', {
    p_token: token,
    p_emp_id: empId,
    p_data: attendanceToRow(record),
  })
  if (error) throw error
  return rowToAttendance(data)
}

export async function employeeFetchLeaves(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_leaves', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  return (data || []).map(rowToLeave)
}

export async function employeeApplyLeave(token, empId, leave) {
  const { data, error } = await supabase.rpc('employee_apply_leave', {
    p_token: token,
    p_emp_id: empId,
    p_data: {
      emp_name: leave.empName,
      company: leave.company,
      leave_type: leave.leaveType,
      date: leave.date,
      reason: leave.reason,
      location: leave.location || null,
    },
  })
  if (error) throw error
  return rowToLeave(data)
}

export async function employeeFetchLeaveBalances(token, empId) {
  const { data, error } = await supabase.rpc('employee_get_leave_balances', {
    p_token: token,
    p_emp_id: empId,
  })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    if (!map[row.emp_id]) map[row.emp_id] = {}
    map[row.emp_id][row.leave_type] = {
      accrued: Number(row.accrued),
      consumed: Number(row.consumed),
      balance: Number(row.balance),
      quota: Number(row.quota),
      unit: row.unit,
    }
  }
  return map
}

export async function insertAuditLog(action, detail, byName) {
  const { error } = await supabase
    .from('audit_logs')
    .insert({ action, detail, by_name: byName || 'system' })
  if (error) console.error(error)
}

// ---------------------------------------------------------------------------
// Admin login
// ---------------------------------------------------------------------------

export async function adminLogin(pin) {
  const { data, error } = await supabase.rpc('admin_login', { p_pin: pin })
  if (error) {
    console.error(error)
    return null
  }
  return data || null // a uuid token, or null if the PIN was wrong
}

export async function adminLogout(token) {
  if (!token) return
  const { error } = await supabase.rpc('admin_logout', { p_token: token })
  if (error) console.error(error)
}

// ---------------------------------------------------------------------------
// Admin-only operations — every one of these requires a valid token from
// adminLogin() and is checked again on the database side, not just here.
// ---------------------------------------------------------------------------

export async function adminFetchAllAttendance(token) {
  const { data, error } = await supabase.rpc('admin_get_all_attendance', { p_token: token })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    const rec = rowToAttendance(row)
    map[attnKey(rec.empId, rec.date)] = rec
  }
  return map
}

export async function adminFetchAllLeaves(token) {
  const { data, error } = await supabase.rpc('admin_get_all_leaves', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToLeave)
}

export async function adminFetchAllLeaveBalances(token) {
  const { data, error } = await supabase.rpc('admin_get_all_leave_balances', { p_token: token })
  if (error) throw error
  const map = {}
  for (const row of data || []) {
    if (!map[row.emp_id]) map[row.emp_id] = {}
    map[row.emp_id][row.leave_type] = {
      accrued: Number(row.accrued),
      consumed: Number(row.consumed),
      balance: Number(row.balance),
      quota: Number(row.quota),
      unit: row.unit,
    }
  }
  return map
}

export async function adminUpsertAttendance(token, empId, record) {
  const { data, error } = await supabase.rpc('admin_upsert_attendance', {
    p_token: token,
    p_emp_id: empId,
    p_data: attendanceToRow(record),
  })
  if (error) throw error
  return rowToAttendance(data)
}

export async function adminFetchEmployees(token) {
  const { data, error } = await supabase.rpc('admin_get_employees', { p_token: token })
  if (error) throw error
  return (data || []).map(rowToEmployee)
}

export async function adminCreateEmployee(token, emp) {
  const { data, error } = await supabase.rpc('admin_create_employee', {
    p_token: token,
    p_data: employeeToPayload(emp),
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminUpdateEmployee(token, id, emp) {
  const { data, error } = await supabase.rpc('admin_update_employee', {
    p_token: token,
    p_id: id,
    p_data: employeeToPayload(emp),
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminToggleEmployeeStatus(token, id) {
  const { data, error } = await supabase.rpc('admin_toggle_employee_status', {
    p_token: token,
    p_id: id,
  })
  if (error) throw error
  return rowToEmployee(data)
}

export async function adminDeleteEmployee(token, id) {
  const { error } = await supabase.rpc('admin_delete_employee', { p_token: token, p_id: id })
  if (error) throw error
}

export async function adminFetchAuditLogs(token, limit = 500) {
  const { data, error } = await supabase.rpc('admin_get_audit_logs', {
    p_token: token,
    p_limit: limit,
  })
  if (error) throw error
  return (data || []).map(rowToAuditLog)
}

export async function adminUpdateSettings(token, stdHours, newAdminPin) {
  const { error } = await supabase.rpc('admin_update_settings', {
    p_token: token,
    p_std_hours: stdHours,
    p_new_admin_pin: newAdminPin || null,
  })
  if (error) throw error
}

export async function adminDecideLeave(token, leaveId, decision) {
  const { data, error } = await supabase.rpc('admin_decide_leave', {
    p_token: token,
    p_leave_id: leaveId,
    p_decision: decision,
  })
  if (error) throw error
  return rowToLeave(data)
}

export async function adminUpsertLeaveBalance(token, empId, leaveType, values) {
  const { error } = await supabase.rpc('admin_upsert_leave_balance', {
    p_token: token,
    p_emp_id: empId,
    p_leave_type: leaveType,
    p_accrued: values.accrued,
    p_consumed: values.consumed,
    p_balance: values.balance,
    p_quota: values.quota,
    p_unit: values.unit,
  })
  if (error) throw error
}

export async function adminFetchImportedSheet(token) {
  const { data, error } = await supabase.rpc('admin_get_imported_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return {
    filename: data.filename,
    cols: data.cols || [],
    rows: data.rows || [],
    importedAt: data.imported_at,
  }
}

export async function adminSetImportedSheet(token, filename, cols, rows) {
  const { data, error } = await supabase.rpc('admin_set_imported_sheet', {
    p_token: token,
    p_filename: filename,
    p_cols: cols,
    p_rows: rows,
  })
  if (error) throw error
  return {
    filename: data.filename,
    cols: data.cols || [],
    rows: data.rows || [],
    importedAt: data.imported_at,
  }
}

export async function adminClearImportedSheet(token) {
  const { error } = await supabase.rpc('admin_clear_imported_sheet', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Bulk operations — used by the Daily Bio and Monthly Bio imports, which can
// touch hundreds or thousands of attendance rows in one go. Sending them all
// in a single RPC call avoids hundreds of slow, sequential round trips.
// ---------------------------------------------------------------------------

export async function adminBulkUpsertAttendance(token, records) {
  const payload = records.map(attendanceToBulkRow)
  const { data, error } = await supabase.rpc('admin_bulk_upsert_attendance', {
    p_token: token,
    p_records: payload,
  })
  if (error) throw error
  return data // number of rows written
}

export async function adminBulkUpsertLeaveBalances(token, records) {
  // records: [{ empId, leaveType, accrued, consumed, balance, quota, unit }, ...]
  const payload = records.map(r => ({
    emp_id: r.empId,
    leave_type: r.leaveType,
    accrued: r.accrued,
    consumed: r.consumed,
    balance: r.balance,
    quota: r.quota,
    unit: r.unit,
  }))
  const { data, error } = await supabase.rpc('admin_bulk_upsert_leave_balances', {
    p_token: token,
    p_records: payload,
  })
  if (error) throw error
  return data // number of rows written
}

// ---------------------------------------------------------------------------
// Daily Bio sheet cache (the editable preview grid for biometric daily imports)
// ---------------------------------------------------------------------------

export async function adminFetchBioSheet(token) {
  const { data, error } = await supabase.rpc('admin_get_bio_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return {
    filename: data.filename,
    cols: data.cols || [],
    rows: data.rows || [],
    reportDate: data.report_date,
    synced: data.synced,
    skipped: data.skipped,
    importedAt: data.imported_at,
  }
}

export async function adminSetBioSheet(token, filename, cols, rows, reportDate, synced, skipped) {
  const { data, error } = await supabase.rpc('admin_set_bio_sheet', {
    p_token: token,
    p_filename: filename,
    p_cols: cols,
    p_rows: rows,
    p_report_date: reportDate,
    p_synced: synced,
    p_skipped: skipped,
  })
  if (error) throw error
  return {
    filename: data.filename,
    cols: data.cols || [],
    rows: data.rows || [],
    reportDate: data.report_date,
    synced: data.synced,
    skipped: data.skipped,
    importedAt: data.imported_at,
  }
}

export async function adminClearBioSheet(token) {
  const { error } = await supabase.rpc('admin_clear_bio_sheet', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Monthly Bio sheet cache (metadata only — the monthly grid format is too
// large/irregular to cache row-by-row, so only summary info is stored)
// ---------------------------------------------------------------------------

export async function adminFetchMonthlySheet(token) {
  const { data, error } = await supabase.rpc('admin_get_monthly_sheet', { p_token: token })
  if (error) throw error
  if (!data || !data.filename) return null
  return {
    filename: data.filename,
    reportMonth: data.report_month,
    reportYear: data.report_year,
    synced: data.synced,
    skipped: data.skipped,
    importedAt: data.imported_at,
  }
}

export async function adminSetMonthlySheet(token, filename, reportMonth, reportYear, synced, skipped) {
  const { data, error } = await supabase.rpc('admin_set_monthly_sheet', {
    p_token: token,
    p_filename: filename,
    p_report_month: reportMonth,
    p_report_year: reportYear,
    p_synced: synced,
    p_skipped: skipped,
  })
  if (error) throw error
  return {
    filename: data.filename,
    reportMonth: data.report_month,
    reportYear: data.report_year,
    synced: data.synced,
    skipped: data.skipped,
    importedAt: data.imported_at,
  }
}

export async function adminClearMonthlySheet(token) {
  const { error } = await supabase.rpc('admin_clear_monthly_sheet', { p_token: token })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

export async function fetchHolidays() {
  const { data, error } = await supabase.from('holidays').select('*').order('date')
  if (error) throw error
  return (data || []).map(h => ({ id: h.id, date: h.date, name: h.name, type: h.type }))
}

export async function adminAddHoliday(token, date, name, type) {
  const { data, error } = await supabase.rpc('admin_add_holiday', {
    p_token: token, p_date: date, p_name: name, p_type: type,
  })
  if (error) throw error
  return { id: data.id, date: data.date, name: data.name, type: data.type }
}

export async function adminDeleteHoliday(token, id) {
  const { error } = await supabase.rpc('admin_delete_holiday', { p_token: token, p_id: id })
  if (error) throw error
}

// ---------------------------------------------------------------------------
// OD GPS Tracking
// ---------------------------------------------------------------------------

export async function employeeLogOdLocation(token, empId, latLon, date) {
  const { data, error } = await supabase.rpc('employee_log_od_location', {
    p_token: token, p_emp_id: empId, p_lat_lon: latLon, p_date: date,
  })
  if (error) throw error
  return data
}

export async function employeeGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('employee_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts }))
}

export async function adminGetOdLogs(token, empId, date) {
  const { data, error } = await supabase.rpc('admin_get_od_logs', {
    p_token: token, p_emp_id: empId, p_date: date,
  })
  if (error) throw error
  return (data || []).map(r => ({ id: r.id, latLon: r.lat_lon, ts: r.ts }))
}

