// The database uses snake_case columns; the app uses these exact camelCase field names
// throughout. All shape conversion happens here and nowhere else (plan.md §8C rule 3 —
// "one name for one thing" — this file is that one place).

export function rowToEmployee(row) {
  if (!row) return null
  return {
    id: row.id,
    empNum: row.emp_num,
    name: row.name,
    company: row.company,
    jobTitle: row.job_title,
    bu: row.bu ?? row.business_unit,
    dept: row.dept ?? row.department,
    subDept: row.sub_dept ?? row.sub_department,
    locationInfo: row.location_info,
    costCenter: row.cost_center,
    manager: row.manager,
    managerEmpId: row.manager_emp_id || null,
    email: row.email,
    phone: row.phone,
    joiningDate: row.joining_date,
    active: row.active,
    shiftType: row.shift_type || 'none',
    workMode: row.work_mode || 'office',
    employmentStatus: row.employment_status || 'Probation',
    probationEndDate: row.probation_end_date,
    confirmedOn: row.confirmed_on,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Note: no `pin` field. Pins are write-only (hashed server-side on create/update) and
// never come back from the database in readable form — fixes plan.md §4.3 #2.
export function employeeToPayload(emp) {
  return {
    name: emp.name,
    pin: emp.pin || undefined, // omit on update unless the admin is deliberately changing it
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
    workMode: emp.workMode || 'office',
  }
}

export function rowToAttendance(row) {
  if (!row) return null
  return {
    empId: row.emp_id,
    date: row.date,
    dayType: row.day_type || 'working',
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
    source: row.source,
    fieldNote: row.field_note,
  }
}

export function attendanceToRow(record) {
  return {
    emp_id: record.empId,
    date: record.date,
    day_type: record.dayType || 'working',
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
    source: record.source || null,
    field_note: record.fieldNote || null,
    // Not a DB column — read only by employee_punch's duplicate-tap cooldown check
    // (0005_field_staff_and_geo.sql), ignored harmlessly by every other RPC that
    // takes a full attendance payload (admin upsert, bulk upserts).
    punch_type: record.punchType || null,
  }
}

// Same shape as attendanceToRow, but keyed for the bulk-upsert RPC, which expects
// emp_id inside each element of a JSON array rather than as a separate function arg.
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
    updatedAt: row.updated_at,
  }
}

export function rowToLeaveBalance(row) {
  return {
    empId: row.emp_id,
    leaveType: row.leave_type,
    accrued: Number(row.accrued),
    consumed: Number(row.consumed),
    balance: Number(row.balance),
    quota: Number(row.quota),
    unit: row.unit,
    financialYear: row.financial_year,
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

export function rowToRegularization(row) {
  if (!row) return null
  return {
    id: row.id,
    empId: row.emp_id,
    empName: row.emp_name,
    empNum: row.emp_num,
    date: row.date,
    requestedIn: row.requested_in ? row.requested_in.slice(0, 5) : null,
    requestedOut: row.requested_out ? row.requested_out.slice(0, 5) : null,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
  }
}

// Key used internally to look up a single day's attendance for one employee. Both
// halves are safe to join with "_" — dates are always 10 chars (YYYY-MM-DD) and
// employee ids are UUIDs, neither contains an underscore.
export function attnKey(empId, date) {
  return `${empId}_${date}`
}
export function parseAttnKey(key) {
  const idx = key.lastIndexOf('_')
  return [key.slice(0, idx), key.slice(idx + 1)]
}
