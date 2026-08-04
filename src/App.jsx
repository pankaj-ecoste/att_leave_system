import React, { useState, useEffect, useRef } from "react";
import * as XLSX from "xlsx";
import { supabase } from "./lib/supabase";
import {
  fetchDirectory,
  fetchStdHours,
  employeeLogin,
  employeeLogout as apiEmployeeLogout,
  employeeFetchAttendance,
  employeePunch,
  employeeFetchLeaves,
  employeeApplyLeave,
  employeeFetchLeaveBalances,
  insertAuditLog,
  adminLogin as apiAdminLogin,
  adminLogout as apiAdminLogout,
  adminFetchEmployees,
  adminCreateEmployee,
  adminUpdateEmployee,
  adminToggleEmployeeStatus,
  adminDeleteEmployee,
  adminFetchAuditLogs,
  adminUpdateSettings,
  adminDecideLeave,
  adminFetchImportedSheet,
  adminSetImportedSheet,
  adminClearImportedSheet,
  adminFetchAllAttendance,
  adminFetchAllLeaves,
  adminFetchAllLeaveBalances,
  adminUpsertAttendance,
  adminBulkUpsertAttendance,
  adminBulkUpsertLeaveBalances,
  adminFetchBioSheet,
  adminSetBioSheet,
  adminClearBioSheet,
  adminFetchMonthlySheet,
  adminSetMonthlySheet,
  adminClearMonthlySheet,
  fetchHolidays,
  adminAddHoliday,
  adminDeleteHoliday,
  employeeLogOdLocation,
  employeeGetOdLogs,
  attnKey,
} from "./lib/api";
import {
  parseBioTime,
  parseBioDate,
  mapBioStatus,
  normCode,
  gField,
  buildEmpMaps,
  findEmpInSnap,
} from "./lib/bioImport";

const COMPANIES = ["Asma Traexim Pvt Ltd", "Metamask Design Solutions LLP", "Lamora Buildtech Pvt Ltd"];
const COMPANY_COLORS = ["from-violet-600 to-indigo-600", "from-cyan-600 to-blue-600", "from-emerald-600 to-teal-600"];
const COMPANY_ICONS = ["A", "M", "L"];
const LEAVE_TYPES = [
  { label:"Sick Leave", deduct:0, present:false, max:null, icon:"SL" },
  { label:"Casual Leave", deduct:0, present:false, max:null, icon:"CL" },
  { label:"Earned Leave", deduct:0, present:false, max:null, icon:"EL" },
  { label:"Unpaid Leave", deduct:0, present:false, max:null, icon:"UL" },
  { label:"Bereavement Leave", deduct:0, present:false, max:null, icon:"BL" },
  { label:"Marriage Leave", deduct:0, present:false, max:null, icon:"ML" },
  { label:"Maternity Leave", deduct:0, present:false, max:null, icon:"MT" },
  { label:"Paternity Leave", deduct:0, present:false, max:null, icon:"PT" },
  { label:"Partial Leave - 1 Hour", deduct:1, present:true, max:2, icon:"P1" },
  { label:"Partial Leave - 2 Hours", deduct:2, present:true, max:1, icon:"P2" },
  { label:"Work From Home", deduct:0, present:true, max:null, icon:"WH" },
  { label:"On Duty", deduct:0, present:true, max:null, icon:"OD" },
];
const TODAY = new Date().toISOString().slice(0,10);
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmt2(n) { return String(n).padStart(2,"0"); }
function fmtHrs(h) {
  if (h === null || h === undefined || h === "") return "--";
  const hh = Math.floor(Math.abs(h)), mm = Math.round((Math.abs(h) - hh) * 60);
  return `${hh}h ${fmt2(mm)}m`;
}
function calcRawHrs(inT, outT) {
  if(!inT||!outT) return 0;
  const [ih,im]=inT.split(":").map(Number);
  const [oh,om]=outT.split(":").map(Number);
  return Math.max(0,(oh*60+om - ih*60-im)/60);
}

const SHIFTS = [
  { id:"day",   label:"Day Shift",   start:"09:00", end:"18:00", color:"#f59e0b" },
  { id:"night", label:"Night Shift", start:"21:00", end:"06:00", color:"#818cf8" },
  { id:"both",  label:"Both Shifts", start:"",      end:"",      color:"#10b981" },
  { id:"none",  label:"No Shift",    start:"",      end:"",      color:"#64748b" },
];

function getShiftInfo(rec, emp) {
  if (emp && emp.shiftType && emp.shiftType !== "none") {
    const s = SHIFTS.find(x => x.id === emp.shiftType);
    if (s) return s;
  }
  if (rec && rec.shift) {
    const sl = rec.shift.toLowerCase();
    if (sl.includes("night")||sl.includes("n-")||sl==="n") return SHIFTS[1];
    if (sl.includes("day")||sl.includes("d-")||sl==="d") return SHIFTS[0];
    if (sl.includes("both")||sl.includes("general")) return SHIFTS[2];
  }
  if (rec && rec.inTime) {
    const h = parseInt(rec.inTime.split(":")[0]);
    if (h >= 18 || h < 6) return SHIFTS[1];
    return SHIFTS[0];
  }
  return SHIFTS[3];
}

function ShiftBadge({ shift }) {
  if (!shift || shift.id === "none") return <span className="text-white/30 text-xs">—</span>;
  return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded whitespace-nowrap"
      style={{ background: shift.color + "33", color: shift.color, border: `1px solid ${shift.color}55` }}>
      {shift.label}
    </span>
  );
}
function calcStatus(rec, stdHours) {
  if(rec.leaveType) {
    const lt = LEAVE_TYPES.find(l=>l.label===rec.leaveType);
    if(lt && !lt.present) return "Leave";
    if(lt?.label==="Work From Home") return "WFH";
    if(lt?.label==="On Duty") return "On Duty";
  }
  if(!rec.inTime) {
    // Fall back to mapped bio status if no punch times
    if(rec.bioStatusRaw) {
      const b = String(rec.bioStatusRaw).toUpperCase().trim();
      if(b==="P") return "Present";
      if(b==="A") return "Absent";
      if(b==="H"||b==="HD") return "Half Day";
      if(b==="L") return "Leave";
    }
    return "Absent";
  }
  const raw = calcRawHrs(rec.inTime, rec.outTime);
  const deduct = rec.leaveType ? (LEAVE_TYPES.find(l=>l.label===rec.leaveType)?.deduct||0) : 0;
  const eff = Math.max(0, raw - deduct);
  if(eff < 4.5) return "Absent";
  if(eff < stdHours) return "Half Day";
  return "Present";
}
function statusStyle(s) {
  if(s==="Present") return { bg:"bg-emerald-500/20", text:"text-emerald-300", border:"border-emerald-500/40", dot:"bg-emerald-400" };
  if(s==="Half Day") return { bg:"bg-yellow-500/20", text:"text-yellow-300", border:"border-yellow-500/40", dot:"bg-yellow-400" };
  if(s==="Leave") return { bg:"bg-amber-500/20", text:"text-amber-300", border:"border-amber-500/40", dot:"bg-amber-400" };
  if(s==="Absent") return { bg:"bg-red-500/20", text:"text-red-300", border:"border-red-500/40", dot:"bg-red-400" };
  if(s==="WFH") return { bg:"bg-indigo-500/20", text:"text-indigo-300", border:"border-indigo-500/40", dot:"bg-indigo-400" };
  if(s==="On Duty") return { bg:"bg-purple-500/20", text:"text-purple-300", border:"border-purple-500/40", dot:"bg-purple-400" };
  return { bg:"bg-white/10", text:"text-white/60", border:"border-white/20", dot:"bg-white/40" };
}
// Color-codes cells in the Daily Bio preview table by column meaning:
// status (green=Present, red=Absent, yellow=other), green arrival time,
// red departure time, orange late hours.
function bioSheetCellColor(colName, value) {
  const c = String(colName||"").toLowerCase().replace(/[\s._]/g,"");
  if (c.includes("status")) {
    const v = String(value||"").toLowerCase().trim();
    if (v==="p"||v==="present") return "text-emerald-400";
    if (v==="a"||v==="absent") return "text-red-400";
    if (v) return "text-yellow-400";
    return "";
  }
  if (c.includes("arrtime")||c.includes("arrivaltime")||c==="intime") return "text-emerald-400";
  if (c.includes("depttime")||c.includes("departuretime")||c==="outtime") return "text-red-400";
  if (c.includes("latehrs")||c.includes("late")) return "text-orange-400";
  return "";
}
function Badge({ s }) {
  const st = statusStyle(s);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${st.bg} ${st.text} ${st.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}></span>{s}
    </span>
  );
}
function StatCard({ label, value, color, sub }) {
  const colors = {
    indigo:"from-indigo-600/30 to-indigo-800/10 border-indigo-500/30 text-indigo-300",
    emerald:"from-emerald-600/30 to-emerald-800/10 border-emerald-500/30 text-emerald-300",
    red:"from-red-600/30 to-red-800/10 border-red-500/30 text-red-300",
    amber:"from-amber-600/30 to-amber-800/10 border-amber-500/30 text-amber-300",
    yellow:"from-yellow-600/30 to-yellow-800/10 border-yellow-500/30 text-yellow-300",
    purple:"from-purple-600/30 to-purple-800/10 border-purple-500/30 text-purple-300",
    cyan:"from-cyan-600/30 to-cyan-800/10 border-cyan-500/30 text-cyan-300",
    orange:"from-orange-600/30 to-orange-800/10 border-orange-500/30 text-orange-300",
  };
  const textCol = colors[color]?.split(" ")[3] || "text-white";
  return (
    <div className={`bg-gradient-to-br ${colors[color]} border rounded-2xl p-4 flex flex-col gap-1 hover:scale-[1.02] transition-transform`}>
      <span className="text-white/30 text-xs uppercase tracking-widest">{label}</span>
      <p className={`text-4xl font-bold mt-1 ${textCol}`}>{value}</p>
      {sub && <p className="text-white/30 text-xs">{sub}</p>}
    </div>
  );
}
function Spinner() {
  return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
      <div className="text-center">
        <div className="relative w-20 h-20 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
          <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <div className="absolute inset-3 border-4 border-violet-500 border-b-transparent rounded-full animate-spin" style={{animationDirection:"reverse",animationDuration:"0.8s"}}></div>
        </div>
        <p className="text-white font-semibold text-lg">Loading System...</p>
        <p className="text-white/40 text-sm mt-1">HRMS</p>
      </div>
    </div>
  );
}

export default function App() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("login");
  const [currentUser, setCurrentUser] = useState(null);
  const [directory, setDirectory] = useState([]);   // public picker list (active employees, limited fields)
  const [employees, setEmployees] = useState([]);    // full records, loaded only after admin login
  const [attendance, setAttendance] = useState({});
  const [leaves, setLeaves] = useState([]);
  const [leaveBalances, setLeaveBalances] = useState({});
  const [auditLogs, setAuditLogs] = useState([]);
  const [settings, setSettings] = useState({ stdHours: 9 });
  const [importedSheet, setImportedSheet] = useState(null);
  const [adminToken, setAdminToken] = useState(null);
  const [employeeToken, setEmployeeToken] = useState(null);

  const [loginCompany, setLoginCompany] = useState("");
  const [loginStep, setLoginStep] = useState(1);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [pinInput, setPinInput] = useState("");
  const [loginError, setLoginError] = useState("");
  const [adminPinInput, setAdminPinInput] = useState("");
  const [adminLoginError, setAdminLoginError] = useState("");
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminTab, setAdminTab] = useState("dashboard");
  const [empTab, setEmpTab] = useState("leaves");
  const [myTeam, setMyTeam] = useState([]);
  const [teamLeaves, setTeamLeaves] = useState([]);
  const [teamRegs, setTeamRegs] = useState([]);
  const [teamAttn, setTeamAttn] = useState({});
  const [teamMonthSel, setTeamMonthSel] = useState({ month: new Date().getMonth()+1, year: new Date().getFullYear() });
  const [teamLoading, setTeamLoading] = useState(false);
  const [teamTab, setTeamTab] = useState("requests");
  const [leaveBalEditor, setLeaveBalEditor] = useState(null); // { empId, empName, balances: {...} }
  const [leaveModal, setLeaveModal] = useState(false);
  const [leaveForm, setLeaveForm] = useState({ type:"", date:TODAY, reason:"", location:null });
  const [leaveFormErr, setLeaveFormErr] = useState({});
  const [locationStatus, setLocationStatus] = useState("");
  const [locationBlocked, setLocationBlocked] = useState(false);
  const [attnFilters, setAttnFilters] = useState({ company:"", location:"", month:new Date().getMonth()+1, year:new Date().getFullYear(), empId:"", customRange:false, from:TODAY, to:TODAY, allSummary:false, monthlyDetail:false });
  const [availYears, setAvailYears] = useState([new Date().getFullYear()]);
  const [editingCell, setEditingCell] = useState(null);
  const [editVal, setEditVal] = useState("");
  const [empForm, setEmpForm] = useState(null);
  const [empFilter, setEmpFilter] = useState("");
  const [empSearch, setEmpSearch] = useState("");
  const [dbSubTab, setDbSubTab] = useState("employees");
  const [dbSearch, setDbSearch] = useState("");
  const [settingsMsg, setSettingsMsg] = useState("");
  const [newPin, setNewPin] = useState("");
  const [newStd, setNewStd] = useState("");
  const [importStatus, setImportStatus] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetEditCell, setSheetEditCell] = useState(null);
  const [sheetEditVal, setSheetEditVal] = useState("");
  const [bioSheet, setBioSheet] = useState(null);
  const [monthlySheet, setMonthlySheet] = useState(null);
  const [bioImportStatus, setBioImportStatus] = useState("");
  const [monthlyImportStatus, setMonthlyImportStatus] = useState("");
  const [bioSyncLog, setBioSyncLog] = useState([]);
  const [monthlySyncLog, setMonthlySyncLog] = useState([]);
  const [showBioLog, setShowBioLog] = useState(false);
  const [showMonthlyLog, setShowMonthlyLog] = useState(false);
  const [bioSearch, setBioSearch] = useState("");
  const [monthlySearch, setMonthlySearch] = useState("");
  const [holidays, setHolidays] = useState([]);
  const [holidayForm, setHolidayForm] = useState({ date:"", name:"", type:"Public" });
  const [showHolidayForm, setShowHolidayForm] = useState(false);
  const [holidayMsg, setHolidayMsg] = useState("");
  const [odTrackLog, setOdTrackLog] = useState([]);
  const odIntervalRef = useRef(null);
  const autoLocIntervalRef = useRef(null);
  const [reportMsg, setReportMsg] = useState("");
  const [reportDate, setReportDate] = useState(TODAY);
  const [reportFrom, setReportFrom] = useState(TODAY);
  const [reportTo, setReportTo] = useState(TODAY);
  const [monthSel, setMonthSel] = useState({ month: new Date().getMonth()+1, year: new Date().getFullYear() });
  const [manualLocation, setManualLocation] = useState("");
  const [showManualLoc, setShowManualLoc] = useState(false);
  const [pendingPunchType, setPendingPunchType] = useState(null);
  const restoreRef = useRef();
  const sheetImportRef = useRef();
  const bioImportRef = useRef();
  const monthlyImportRef = useRef();
  const [rememberMe, setRememberMe] = useState(false);
  const [regularizations, setRegularizations] = useState([]);
  const [showRegModal, setShowRegModal] = useState(false);
  const [regForm, setRegForm] = useState({ date: "", inTime: "", outTime: "", reason: "" });
  const [regFormErr, setRegFormErr] = useState({});
  const [adminRegs, setAdminRegs] = useState([]);
  const [locLogs, setLocLogs] = useState([]);
  const [locDate, setLocDate] = useState(TODAY);
  const [locLoading, setLocLoading] = useState(false);
  const [empHistTab, setEmpHistTab] = useState("attendance");

  useEffect(() => {
    (async () => {
      try {
        const [dir, std, hols] = await Promise.all([fetchDirectory(), fetchStdHours(), fetchHolidays()]);
        setDirectory(dir);
        setSettings(s => ({ ...s, stdHours: std }));
        setHolidays(hols);
        // Restore remembered session
        try {
          const saved = localStorage.getItem("hrms_session");
          if (saved) {
            const { token, empId } = JSON.parse(saved);
            if (token && empId && dir.length) {
              const emp = dir.find(e => e.id === empId);
              if (emp) {
                const [att, lvs, lb] = await Promise.all([
                  employeeFetchAttendance(token, empId),
                  employeeFetchLeaves(token, empId),
                  employeeFetchLeaveBalances(token, empId),
                ]);
                setEmployeeToken(token);
                setAttendance(att);
                setLeaves(lvs);
                setLeaveBalances(lb);
                setCurrentUser(emp);
                setView("employee");
                setEmpTab("leaves");
                setTimeout(() => loadMyTeam(token, emp.id), 500);
              }
            }
          }
        } catch(e) { localStorage.removeItem("hrms_session"); }
      } catch (err) {
        console.error(err);
      }
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (dbSubTab === "locations" && adminToken) {
      setLocLoading(true);
      supabase.rpc("admin_get_all_location_logs", { p_token: adminToken, p_date: locDate })
        .then(({ data }) => { setLocLogs(data || []); setLocLoading(false); })
        .catch(() => setLocLoading(false));
    }
  }, [dbSubTab, locDate, adminToken]);

  async function addAudit(action, detail, by) {
    insertAuditLog(action, detail, by);
    setAuditLogs(prev => (prev.length ? [{ id:`local_${Date.now()}`, ts:new Date().toISOString(), action, detail, by: by||"system" }, ...prev].slice(0,500) : prev));
  }

  async function persistAttendance(record) {
    try {
      const saved = view === "admin"
        ? await adminUpsertAttendance(adminToken, record.empId, record)
        : await employeePunch(employeeToken, record.empId, record);
      if (saved) setAttendance(prev => ({ ...prev, [attnKey(saved.empId, saved.date)]: saved }));
      return saved;
    } catch (err) {
      console.error(err);
      alert("Could not save: " + err.message);
      return null;
    }
  }

  async function persistImportedSheet(next) {
    setImportedSheet(next);
    try { await adminSetImportedSheet(adminToken, next.filename, next.cols, next.rows); }
    catch (err) { console.error(err); }
  }

  async function reverseGeocode(lat, lon) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`);
      if(!res.ok) throw new Error("Geocoding request failed");
      const data = await res.json();
      return data?.display_name || null;
    } catch(e) {
      console.error("Reverse geocoding failed:", e);
      return null;
    }
  }

  function getLocation(cb) {
    if(!navigator.geolocation) { cb(null, "Geolocation not supported"); return; }
    const ok = async pos => {
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      const placeName = await reverseGeocode(lat, lon);
      const fallback = lat.toFixed(5)+", "+lon.toFixed(5);
      cb(placeName || fallback, null);
    };
    const fail = (err) => {
      const msgs = { 1:"Permission denied by browser", 2:"Position unavailable", 3:"Timed out" };
      cb(null, msgs[err?.code] || "Location unavailable");
    };
    navigator.geolocation.getCurrentPosition(ok, fail, {enableHighAccuracy:false, timeout:10000, maximumAge:60000});
  }

  async function doLogin() {
    const emp = directory.find(e=>e.id===selectedEmp.id);
    if(!emp) return;
    const result = await employeeLogin(emp.id, pinInput);
    if (!result.token) {
      if (result.error === "locked") {
        const until = result.lockedUntil ? new Date(result.lockedUntil).toLocaleTimeString() : "a few minutes";
        setLoginError(`Too many incorrect attempts. Try again after ${until}.`);
      } else if (result.error === "network") {
        setLoginError("Could not reach the server. Check your connection and try again.");
      } else {
        setLoginError("Incorrect PIN. Please try again.");
      }
      return;
    }
    setEmployeeToken(result.token);
    let lvs = [];
    try {
      const [att, fetchedLvs, lb] = await Promise.all([
        employeeFetchAttendance(result.token, emp.id),
        employeeFetchLeaves(result.token, emp.id),
        employeeFetchLeaveBalances(result.token, emp.id),
      ]);
      lvs = fetchedLvs;
      setAttendance(att);
      setLeaves(lvs);
      setLeaveBalances(lb);
    } catch (err) {
      console.error(err);
    }
    setCurrentUser(emp); setView("employee"); setEmpTab("leaves");
    addAudit("LOGIN",`${emp.name} logged in`,emp.name);
    setPinInput(""); setLoginError("");
    if (rememberMe) {
      try { localStorage.setItem("hrms_session", JSON.stringify({ token: result.token, empId: emp.id })); } catch(e) {}
    }
    // Start OD tracking automatically if employee has approved On Duty leave today
    setTimeout(() => checkAndStartOdTracking(lvs), 500);
    // Load My Team data if this employee is a manager
    setTimeout(() => loadMyTeam(result.token, emp.id), 600);
  }

  async function employeeLogoutHandler() {
    stopOdTracking();
    stopAutoLocTracking();
    if (employeeToken) await apiEmployeeLogout(employeeToken);
    addAudit("LOGOUT",`${currentUser?.name} logged out`,currentUser?.name);
    setEmployeeToken(null); setAttendance({}); setLeaves([]); setLeaveBalances({});
    setView("login"); setCurrentUser(null); setLoginStep(1); setLoginCompany(""); setSelectedEmp(null);
    setRegularizations([]); setMyTeam([]); setTeamLeaves([]); setTeamRegs([]); setTeamAttn({});
    try { localStorage.removeItem("hrms_session"); } catch(e) {}
  }

  async function doAdminLogin() {
    const token = await apiAdminLogin(adminPinInput);
    if(!token) { setAdminLoginError("Incorrect PIN, or too many attempts — please wait a few minutes and try again."); return; }
    setAdminToken(token);
    try {
      const [emps, logs, sheet, bioSh, monthlySh, att, lvs, lb, hols] = await Promise.all([
        adminFetchEmployees(token),
        adminFetchAuditLogs(token, 500),
        adminFetchImportedSheet(token),
        adminFetchBioSheet(token),
        adminFetchMonthlySheet(token),
        adminFetchAllAttendance(token),
        adminFetchAllLeaves(token),
        adminFetchAllLeaveBalances(token),
        fetchHolidays(),
      ]);
      setEmployees(emps);
      setAuditLogs(logs);
      setImportedSheet(sheet);
      setBioSheet(bioSh);
      setMonthlySheet(monthlySh);
      setAttendance(att);
      setLeaves(lvs);
      setLeaveBalances(lb);
      setHolidays(hols);
      // Load regularization requests
      try {
        const { data: regs } = await supabase.rpc("admin_get_regularizations", { p_token: token });
        if (regs) setAdminRegs(regs);
      } catch(e) { console.error("Regs load:", e); }
    } catch (err) {
      console.error(err);
    }
    setView("admin"); addAudit("ADMIN_LOGIN","Admin logged in","admin");
    setAdminPinInput(""); setAdminLoginError(""); setShowAdminLogin(false);
  }

  async function adminLogoutHandler() {
    if (adminToken) await apiAdminLogout(adminToken);
    setAdminToken(null); setEmployees([]); setAuditLogs([]); setImportedSheet(null);
    setBioSheet(null); setMonthlySheet(null);
    setAttendance({}); setLeaves([]); setLeaveBalances({});
    setAdminRegs([]);
    setView("login"); addAudit("LOGOUT","Admin logged out","admin");
  }

  function todayKey(id) { return attnKey(id, TODAY); }
  function todayRec(id) { return attendance[todayKey(id)] || {}; }

  // GPS timeout reduced to 8s per spec
  navigator.geolocation && (navigator.geolocation._timeout = 8000);

  async function punch(type) {
    if (!currentUser) return;
    setLocationStatus("Capturing location... please wait");
    setLocationBlocked(false);
    // GPS is REQUIRED — punch is blocked until location is captured
    return new Promise((resolve) => {
      getLocation(async (loc, err) => {
        if (!loc) {
          setLocationStatus("");
          setLocationBlocked(true);
          resolve();
          return;
        }
        setLocationBlocked(false);
        const key = todayKey(currentUser.id);
        const rec = attendance[key] || { empId: currentUser.id, date: TODAY };
        const next = { ...rec };
        const now = new Date();
        const t = `${fmt2(now.getHours())}:${fmt2(now.getMinutes())}`;
        if (type === "in") { next.inTime = t; next.inLocation = loc; }
        if (type === "out") { next.outTime = t; next.outLocation = loc; stopAutoLocTracking(); stopOdTracking(); }
        next.status = calcStatus(next, settings.stdHours);
        await persistAttendance(next);
        // Log location to location_logs table
        try {
          await supabase.rpc("employee_log_location", {
            p_token: employeeToken, p_emp_id: currentUser.id,
            p_lat_lon: loc, p_date: TODAY,
            p_type: type === "in" ? "punch_in" : "punch_out"
          });
        } catch(e) { console.error("Location log failed:", e); }
        addAudit(type === "in" ? "PUNCH_IN" : "PUNCH_OUT", `${currentUser.name} ${type === "in" ? "in" : "out"} at ${t} — ${loc}`, currentUser.name);
        setLocationStatus(`Located: ${loc}`);
        setTimeout(() => setLocationStatus(""), 5000);
        // Start 2-hour auto tracking after punch-in
        if (type === "in") startAutoLocTracking();
        resolve();
      });
    });
  }

  function stopAutoLocTracking() {
    if (autoLocIntervalRef.current) {
      clearInterval(autoLocIntervalRef.current);
      autoLocIntervalRef.current = null;
    }
  }

  function startAutoLocTracking() {
    stopAutoLocTracking();
    // Capture every 2 hours automatically
    autoLocIntervalRef.current = setInterval(async () => {
      if (!currentUser || !employeeToken) return;
      getLocation(async (loc) => {
        if (!loc) return;
        try {
          await supabase.rpc("employee_log_location", {
            p_token: employeeToken, p_emp_id: currentUser.id,
            p_lat_lon: loc, p_date: TODAY, p_type: "auto"
          });
        } catch(e) { console.error("Auto location log failed:", e); }
      });
    }, 2 * 60 * 60 * 1000); // every 2 hours
  }

  function stopOdTracking() {
    if (odIntervalRef.current) {
      clearInterval(odIntervalRef.current);
      odIntervalRef.current = null;
    }
  }

  async function logOdLocation() {
    if (!currentUser || !employeeToken) return;
    getLocation(async (loc) => {
      if (!loc) return;
      try {
        await employeeLogOdLocation(employeeToken, currentUser.id, loc, TODAY);
        const ts = new Date().toLocaleTimeString();
        setOdTrackLog(prev => [...prev.slice(-49), { ts, loc }]);
      } catch(e) { console.error("OD log failed:", e); }
    });
  }

  function startOdTracking() {
    stopOdTracking();
    logOdLocation();
    odIntervalRef.current = setInterval(logOdLocation, 5 * 60 * 1000);
  }

  function checkAndStartOdTracking(empLeaves) {
    const todayOD = (empLeaves || leaves).find(l =>
      l.empId === currentUser?.id &&
      l.date === TODAY &&
      l.status === "Approved" &&
      l.leaveType === "On Duty"
    );
    if (todayOD && !odIntervalRef.current) startOdTracking();
  }

  async function loadMyTeam(token, empId) {
    try {
      setTeamLoading(true);
      const { data: teamData } = await supabase.rpc("employee_get_my_team", { p_token: token, p_emp_id: empId });
      if (!teamData || teamData.length === 0) { setTeamLoading(false); return; }
      setMyTeam(teamData.map(r => ({
        id: r.id, name: r.name, empNum: r.emp_num, jobTitle: r.job_title,
        dept: r.dept || r.department, company: r.company, shiftType: r.shift_type,
      })));
      const { data: lvData } = await supabase.rpc("manager_get_team_leaves", { p_token: token, p_manager_id: empId });
      setTeamLeaves((lvData || []).map(l => ({
        id: l.id, empId: l.emp_id, empName: teamData.find(e=>e.id===l.emp_id)?.name||"",
        leaveType: l.leave_type, date: l.date, status: l.status,
        reason: l.reason, appliedAt: l.created_at,
      })));
      const { data: regData } = await supabase.rpc("manager_get_team_regularizations", { p_token: token, p_manager_id: empId });
      setTeamRegs((regData || []).map(r => ({
        id: r.id, empId: r.emp_id, empName: teamData.find(e=>e.id===r.emp_id)?.name||"",
        date: r.date, requestedIn: r.requested_in, requestedOut: r.requested_out,
        reason: r.reason, status: r.status, createdAt: r.created_at,
      })));
    } catch(e) { console.error("loadMyTeam:", e); }
    setTeamLoading(false);
  }

  async function loadTeamAttendance(token, empId, month, year) {
    try {
      const { data } = await supabase.rpc("manager_get_team_attendance", {
        p_token: token, p_manager_id: empId, p_month: month, p_year: year,
      });
      const map = {};
      (data||[]).forEach(r => { map[`${r.emp_id}_${r.date}`] = { empId: r.emp_id, date: r.date, inTime: r.in_time?.slice(0,5), outTime: r.out_time?.slice(0,5), status: r.status, leaveType: r.leave_type }; });
      setTeamAttn(map);
    } catch(e) { console.error("loadTeamAttendance:", e); }
  }

  async function managerDecideLeave(leaveId, status) {
    try {
      await supabase.rpc("manager_decide_leave", { p_token: employeeToken, p_manager_id: currentUser.id, p_leave_id: leaveId, p_status: status });
      setTeamLeaves(prev => prev.map(l => l.id===leaveId ? {...l, status} : l));
      addAudit("MANAGER_ACTION", `${status} leave ${leaveId}`, currentUser.name);
    } catch(e) { alert(e.message); }
  }

  async function managerDecideReg(regId, status) {
    try {
      await supabase.rpc("manager_decide_regularization", { p_token: employeeToken, p_manager_id: currentUser.id, p_reg_id: regId, p_status: status });
      setTeamRegs(prev => prev.map(r => r.id===regId ? {...r, status} : r));
      addAudit("MANAGER_ACTION", `${status} regularization ${regId}`, currentUser.name);
    } catch(e) { alert(e.message); }
  }

  function getMonthlyPartial(empId, type, month, year) {
    return leaves.filter(l=>l.empId===empId&&l.leaveType===type&&l.status!=="Rejected"&&new Date(l.date).getMonth()+1===month&&new Date(l.date).getFullYear()===year).length;
  }
  function availableLeaveTypes() {
    const m=new Date().getMonth()+1, y=new Date().getFullYear();
    return LEAVE_TYPES.filter(lt => !lt.max || getMonthlyPartial(currentUser?.id, lt.label, m, y) < lt.max);
  }

  async function applyLeave() {
    const errs = {};
    if(!leaveForm.type) errs.type="Please select a leave type";
    if(!leaveForm.reason.trim()) errs.reason="Reason is mandatory";
    const lt = LEAVE_TYPES.find(l=>l.label===leaveForm.type);
    if(lt?.label==="Work From Home" && !leaveForm.location) errs.location="Location is required for WFH";
    if(lt?.label==="On Duty" && !leaveForm.location) errs.location="Location is required for On Duty";
    setLeaveFormErr(errs);
    if(Object.keys(errs).length) return;

    const saved = await employeeApplyLeave(employeeToken, currentUser.id, {
      empName: currentUser.name,
      company: currentUser.company,
      leaveType: leaveForm.type,
      date: leaveForm.date,
      reason: leaveForm.reason,
      location: leaveForm.location || null,
    });
    if (saved) setLeaves(prev=>[saved,...prev]);

    if(leaveForm.date===TODAY) {
      const key=todayKey(currentUser.id);
      const rec=attendance[key]||{ empId:currentUser.id, date:TODAY };
      const next={ ...rec };
      next.leaveType=leaveForm.type; next.leaveReason=leaveForm.reason;
      if(lt?.label==="Work From Home") next.wfh=true;
      if(lt?.label==="On Duty") next.onDuty=true;
      next.status=calcStatus(next, settings.stdHours);
      await persistAttendance(next);
    }
    addAudit("LEAVE_APPLY",`${currentUser.name} applied ${leaveForm.type} on ${leaveForm.date}`,currentUser.name);
    // If On Duty applied for today, start GPS tracking immediately (leave is pending but track anyway)
    if(leaveForm.type==="On Duty" && leaveForm.date===TODAY) startOdTracking();
    setLeaveModal(false); setLeaveForm({type:"",date:TODAY,reason:"",location:null});
    setLeaveFormErr({}); setLocationStatus("");
  }

  async function submitRegularization() {
    const errs = {};
    if (!regForm.date) errs.date = "Date is required";
    if (!regForm.inTime && !regForm.outTime) errs.inTime = "At least one time is required";
    if (!regForm.reason.trim()) errs.reason = "Reason is mandatory";
    setRegFormErr(errs);
    if (Object.keys(errs).length) return;
    try {
      const { data, error } = await supabase.rpc("employee_submit_regularization", {
        p_token: employeeToken,
        p_emp_id: currentUser.id,
        p_date: regForm.date,
        p_in: regForm.inTime || null,
        p_out: regForm.outTime || null,
        p_reason: regForm.reason,
      });
      if (error) throw error;
      setRegularizations(prev => [data, ...prev]);
      addAudit("REGULARIZATION", `${currentUser.name} requested regularization for ${regForm.date}`, currentUser.name);
      setShowRegModal(false);
      setRegForm({ date: "", inTime: "", outTime: "", reason: "" });
      setRegFormErr({});
    } catch(err) { alert("Error: " + err.message); }
  }

  async function adminDecideReg(id, status) {
    try {
      const { error } = await supabase.rpc("admin_decide_regularization", { p_token: adminToken, p_id: id, p_status: status });
      if (error) throw error;
      setAdminRegs(prev => prev.map(r => r.id === id ? { ...r, status } : r));
      addAudit("REGULARIZATION", `Regularization ${status} for request ${id}`, "admin");
      if (status === "Approved") {
        const updated = await adminFetchAllAttendance(adminToken);
        setAttendance(updated);
      }
    } catch(err) { alert("Error: " + err.message); }
  }

  async function approveLeave(id, action) {
    const decision = action==="approve" ? "Approved" : "Rejected";
    try {
      const updated = await adminDecideLeave(adminToken, id, decision);
      setLeaves(prev=>prev.map(l=>l.id===id?updated:l));
      addAudit(action==="approve"?"LEAVE_APPROVED":"LEAVE_REJECTED",`${updated.empName} ${updated.leaveType} ${action}d`,"admin");
    } catch (err) { alert(err.message); }
  }

  async function saveEmployee(form) {
    if(!form.name||!form.pin||!form.company) return;
    try {
      if(form.id) {
        const updated = await adminUpdateEmployee(adminToken, form.id, form);
        setEmployees(prev=>prev.map(e=>e.id===form.id?updated:e));
        addAudit("EMP_UPDATE",`Updated ${updated.name}`,"admin");
      } else {
        const created = await adminCreateEmployee(adminToken, form);
        setEmployees(prev=>[...prev,created]);
        addAudit("EMP_CREATE",`Created ${created.name}`,"admin");
      }
      setEmpForm(null);
    } catch (err) { alert(err.message); }
  }
  async function toggleEmpStatus(id) {
    try {
      const updated = await adminToggleEmployeeStatus(adminToken, id);
      setEmployees(prev=>prev.map(e=>e.id===id?updated:e));
      addAudit("EMP_STATUS",`Toggled ${updated.name}`,"admin");
    } catch (err) { alert(err.message); }
  }
  async function deleteEmp(id) {
    if(!window.confirm("Delete employee?")) return;
    try {
      await adminDeleteEmployee(adminToken, id);
      setEmployees(prev=>prev.filter(e=>e.id!==id));
      addAudit("EMP_DELETE",`Deleted ${id}`,"admin");
    } catch (err) { alert(err.message); }
  }

  async function editAttnCell(key, field, val) {
    const rec=attendance[key]||{};
    const next={...rec,[field]:val};
    next.status=calcStatus(next, settings.stdHours);
    await persistAttendance(next);
  }

  async function handleImport(e) {
    const file=e.target.files[0]; if(!file) return;
    setImportStatus("Loading...");
    try {
      const ab=await file.arrayBuffer();
      const wb=XLSX.read(ab,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:""});
      const leaveFields=["Sick Leave","Casual Leave","Earned Leave","Unpaid Leave","Bereavement Leave","Marriage Leave","Maternity Leave","Paternity Leave"];
      let created=0, updated=0;
      let currentEmployees=[...employees];
      const balanceRecords=[];
      for (const row of rows) {
        const name = gField(row, "Employee Name", "Name", "EMPLOYEE NAME");
        const empNum = gField(row, "Employee Number", "Emp No", "EMP NO", "Emp Code", "EMP CODE", "Employee Code");
        if(!name && !empNum) continue;
        let emp = findEmpInSnap(empNum, name, currentEmployees);
        const fields = {
          empNum: empNum || (emp?.empNum || ""),
          jobTitle: gField(row, "Job Title", "Designation"),
          bu: gField(row, "Business Unit", "BU"),
          dept: gField(row, "Department", "Dept"),
          subDept: gField(row, "Sub Department", "Sub Dept"),
          locationInfo: gField(row, "Location"),
          costCenter: gField(row, "Cost Center"),
          manager: gField(row, "Reporting Manager", "Manager"),
        };
        try {
          if(!emp) {
            const pin = empNum ? empNum.replace(/^0+/,"").slice(-4).padStart(4,"0") : "0000";
            emp = await adminCreateEmployee(adminToken, { name: name||empNum, pin, company:COMPANIES[0], ...fields });
            currentEmployees=[...currentEmployees, emp];
            created++;
          } else {
            emp = await adminUpdateEmployee(adminToken, emp.id, { ...emp, ...fields });
            currentEmployees=currentEmployees.map(x=>x.id===emp.id?emp:x);
            updated++;
          }
          for (const lt of leaveFields) {
            const bal   = Number(row[`${lt} - Balance`]||row[`${lt} Balance`]||row[`${lt} - balance`]||0)||0;
            const cons  = Number(row[`${lt} - Consumed`]||row[`${lt} Consumed`]||row[`${lt} - consumed`]||0)||0;
            const accr  = Number(row[`${lt} - Accrued`]||row[`${lt} Accrued`]||row[`${lt} - accrued`]||0)||0;
            const quota = Number(row[`${lt} - AnnualQuota`]||row[`${lt} Annual Quota`]||row[`${lt} Quota`]||0)||0;
            // Skip if no data at all for this leave type
            if (bal === 0 && cons === 0 && accr === 0 && quota === 0) continue;
            // If only Balance is provided, derive Quota/Accrued
            const finalQuota = quota || (bal + cons) || bal;
            const finalAccr  = accr  || finalQuota;
            balanceRecords.push({
              empId: emp.id,
              leaveType: lt,
              accrued: finalAccr,
              consumed: cons,
              balance: bal,
              quota: finalQuota,
              unit: String(row[`${lt} - Unit`]||row[`${lt} Unit`]||"Days").trim(),
            });
          }
        } catch (rowErr) {
          console.error("Import row failed:", name, rowErr);
        }
      }
      setEmployees(currentEmployees);
      if (balanceRecords.length) await adminBulkUpsertLeaveBalances(adminToken, balanceRecords);
      const lb = await adminFetchAllLeaveBalances(adminToken);
      setLeaveBalances(lb);
      const sheetData={ filename:file.name, rows, cols:rows.length>0?Object.keys(rows[0]):[], importedAt:new Date().toISOString() };
      await persistImportedSheet(sheetData);
      setImportStatus(`Imported: ${created} created, ${updated} updated (${currentEmployees.length} total)`);
      addAudit("IMPORT",`Leave balance: ${file.name}`,"admin");
    } catch (err) { setImportStatus("Error: "+err.message); }
    if (sheetImportRef.current) sheetImportRef.current.value = "";
  }

  async function removeSheet() {
    try {
      await adminClearImportedSheet(adminToken);
      setImportedSheet(null); setImportStatus("");
    } catch (err) { alert(err.message); }
  }

  // ---------------------------------------------------------------------
  // Daily Bio import — reads an export from a biometric attendance device
  // (one row per employee, covering a single day) and syncs arrival/
  // departure times plus the richer fields it carries (late hours, shift,
  // temperature checks, etc.) into that day's attendance records.
  // ---------------------------------------------------------------------

  async function handleBioImport(e) {
    const file = e.target.files[0]; if (!file) return;
    setBioImportStatus("Reading file..."); setBioSyncLog([]);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1 });

      let reportDate = TODAY;
      for (let i = 0; i < Math.min(8, raw.length); i++) {
        const joined = raw[i].join(" ");
        const m = joined.match(/Report\s*Date\s*[:\-]\s*([\d]{1,2}[-\/][A-Za-z\d]{2,3}[-\/][\d]{2,4})/i) || joined.match(/([\d]{2}[-\/][A-Za-z]{3}[-\/][\d]{4})/);
        if (m) { reportDate = parseBioDate(m[1], TODAY); break; }
      }

      let headerIdx = 0;
      for (let i = 0; i < Math.min(10, raw.length); i++) {
        const cells = raw[i].map(c => String(c).toLowerCase().trim());
        if (cells.some(c => ["emp.code", "empcode", "emp code", "arr.time", "arrtime"].some(k => c.includes(k)))) { headerIdx = i; break; }
      }
      const headers = raw[headerIdx].map(c => String(c).trim());
      const dataRows = [];
      for (let i = headerIdx + 1; i < raw.length; i++) {
        const r = raw[i]; if (!r || r.every(c => !c)) continue;
        const joined = r.map(c => String(c)).join(" ").toLowerCase();
        if (/page no|approved by|total present|total absent/.test(joined)) continue;
        const obj = {}; headers.forEach((h, idx) => { obj[h] = r[idx] ?? ""; });
        dataRows.push(obj);
      }
      if (!dataRows.length) { setBioImportStatus("No data rows found."); return; }
      setBioImportStatus(`Parsed ${dataRows.length} rows · syncing...`);

      const empsSnap = [...employees].map(em => ({ ...em }));
      let { byCode, byName } = buildEmpMaps(empsSnap);
      const log = []; let synced = 0, skipped = 0;
      const records = [];
      const attMap = { ...attendance }; // local working copy, updated as rows are processed

      for (let idx = 0; idx < dataRows.length; idx++) {
        const row = dataRows[idx];
        const g = (...k) => gField(row, ...k);
        const empCodeRaw = normCode(g("empCode","Emp.Code","EmpCode","Emp Code","EmployeeCode","EMP CODE","EMP.CODE"));
        const empNameRaw = g("name","Name","Employee Name","EmployeeName","EMP NAME");
        const arrTime = parseBioTime(g("arrTime","Arr.Time","ArrTime","Arr Time","Arrival","INTIME","IN TIME","In Time"));
        const deptTime = parseBioTime(g("deptTime","Dept Time","DeptTime","DepTime","Departure","OUTTIME","OUT TIME","Out Time"));
        const lateHrs = g("lateHrs","Late Hrs","LateHrs","LATE HRS");
        const earlyHrs = g("earlyHrs","Early Hrs","EarlyHrs");
        const wrkHrs = g("wrkHrs","WrkHrs","Wrk Hrs","Work Hrs","WorkHrs");
        const otHrs = g("otHrs","O.Time","OTime","Overtime","OT","O.T");
        const bioStatusRaw = g("status","Status","STATUS","Att. Status");
        const shift = g("shift","Shift","SHIFT");
        const startTime = g("startTime","Start Time","StartTime","ShiftStart");
        const inTemp = g("inTemp","In Temp","InTemp","IN TEMP");
        const outTemp = g("outTemp","Out Temp","OutTemp","OUT TEMP");
        const remark = g("remark","Remark","Remarks","REMARK");
        const cardNo = g("cardNo","CardNo","Card No","CARDNO");
        const desig = g("desig","Designation","Desig","DESIGNATION");
        const bioStatus = mapBioStatus(bioStatusRaw);

        if (!empCodeRaw && !empNameRaw) { skipped++; continue; }
        let emp = byCode[empCodeRaw] || byCode[String(parseInt(empCodeRaw,10)||0)] || byCode[empCodeRaw.replace(/^0+/,"")||"0"];
        if (!emp && empNameRaw.length > 2) emp = byName[empNameRaw.toLowerCase()];
        if (!emp && empNameRaw.length > 2) {
          const fw = empNameRaw.toLowerCase().split(/\s+/)[0];
          if (fw.length > 2) emp = empsSnap.find(x => x.name && x.name.toLowerCase().startsWith(fw));
        }

        if (emp && empCodeRaw && normCode(emp.empNum) !== empCodeRaw) {
          try {
            const oldCode = emp.empNum || "(none)";
            const updated = await adminUpdateEmployee(adminToken, emp.id, { ...emp, empNum: empCodeRaw });
            const si = empsSnap.findIndex(x => x.id === emp.id);
            if (si >= 0) empsSnap[si] = updated;
            emp = updated;
            const m2 = buildEmpMaps(empsSnap); byCode = m2.byCode; byName = m2.byName;
            log.push({ type:"ok", msg:`Updated emp code: ${oldCode} to ${empCodeRaw} (${emp.name})` });
          } catch (err) { console.error("Could not update emp code:", err); }
        }
        if (!emp && empCodeRaw && empCodeRaw !== "0") {
          try {
            const pin = empCodeRaw.slice(-4).padStart(4,"0");
            const created = await adminCreateEmployee(adminToken, { name: empNameRaw||empCodeRaw, pin, company:COMPANIES[0], empNum: empCodeRaw, jobTitle: desig||"" });
            empsSnap.push(created); emp = created;
            const m2 = buildEmpMaps(empsSnap); byCode = m2.byCode; byName = m2.byName;
            log.push({ type:"ok", msg:`Auto-created: ${emp.name} (${empCodeRaw})` });
          } catch (err) { console.error("Could not auto-create employee:", err); }
        }
        if (!emp) { log.push({ type:"skip", msg:`Row ${idx+1}: no match` }); skipped++; continue; }

        const existing = { ...(attMap[attnKey(emp.id, reportDate)] || { empId: emp.id, date: reportDate }) };
        if (arrTime) existing.inTime = arrTime;
        if (deptTime) existing.outTime = deptTime;
        if (inTemp) existing.inTemp = inTemp;
        if (outTemp) existing.outTemp = outTemp;
        if (remark) existing.remark = remark;
        if (lateHrs) existing.lateHrs = lateHrs;
        if (earlyHrs) existing.earlyHrs = earlyHrs;
        if (wrkHrs) existing.bioWrkHrs = wrkHrs;
        if (otHrs) existing.bioOT = otHrs;
        if (shift) existing.shift = shift;
        if (startTime) existing.shiftStart = startTime;
        if (cardNo) existing.cardNo = cardNo;
        if (desig && !existing.designation) existing.designation = desig;
        existing.bioStatusRaw = bioStatusRaw;
        existing.bioSource = file.name;
        if (existing.leaveType) {
          const lt = LEAVE_TYPES.find(l=>l.label===existing.leaveType);
          existing.status = (lt && !lt.present) ? "Leave" : calcStatus(existing, settings.stdHours);
        } else if (bioStatus) existing.status = bioStatus;
        else existing.status = calcStatus(existing, settings.stdHours);

        attMap[attnKey(emp.id, reportDate)] = existing;
        records.push(existing);
        synced++;
        log.push({ type:"ok", msg:`${emp.name} (${empCodeRaw}) | ${reportDate} | ${existing.status}` });
      }

      if (empsSnap.length !== employees.length || empsSnap.some((em,i)=>employees[i] && em.id===employees[i].id && em.empNum!==employees[i].empNum)) {
        setEmployees(empsSnap);
      }
      if (records.length) {
        await adminBulkUpsertAttendance(adminToken, records);
        setAttendance(prev => {
          const next = { ...prev };
          for (const r of records) next[attnKey(r.empId, r.date)] = r;
          return next;
        });
      }
      const bioData = { filename: file.name, reportDate, rows: dataRows, cols: headers.filter(Boolean), importedAt: new Date().toISOString(), synced, skipped };
      setBioSheet(bioData);
      await adminSetBioSheet(adminToken, file.name, headers.filter(Boolean), dataRows, reportDate, synced, skipped);
      setBioSyncLog(log);
      setBioImportStatus(`Synced ${synced} records · ${skipped} skipped · Date: ${reportDate}`);
      addAudit("IMPORT", `Daily bio: ${file.name} · ${synced} synced`, "admin");
    } catch (err) { setBioImportStatus("Error: "+err.message); console.error(err); }
    if (bioImportRef.current) bioImportRef.current.value = "";
  }

  async function removeBioSheet() {
    try {
      await adminClearBioSheet(adminToken);
      setBioSheet(null); setBioImportStatus(""); setBioSyncLog([]);
    } catch (err) { alert(err.message); }
  }

  async function exportBioSheet() {
    if (!bioSheet) return;
    const ws = XLSX.utils.json_to_sheet(bioSheet.rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "DailyBio");
    XLSX.writeFile(wb, "daily_bio_export.xlsx");
  }

  // ---------------------------------------------------------------------
  // Monthly Bio import — a denser format where each employee's data spans
  // several rows (one row per metric: arrival, departure, work hours,
  // overtime, status, shift) and the columns are the days of the month.
  // ---------------------------------------------------------------------

  async function handleMonthlyImport(e) {
    const file = e.target.files[0]; if (!file) return;
    setMonthlyImportStatus("Reading file..."); setMonthlySyncLog([]);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array", cellDates: false, raw: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawStr = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1, raw: false, blankrows: true });
      const rawNum = XLSX.utils.sheet_to_json(ws, { defval: "", header: 1, raw: true, blankrows: true });
      const raw = rawStr.map((row, ri) => row.map((c, ci) => {
        const num = rawNum[ri] ? rawNum[ri][ci] : undefined;
        return (typeof num === "number") ? num : c;
      }));
      const cs = (c) => String(c || "").trim();

      let reportMonth = new Date().getMonth()+1, reportYear = new Date().getFullYear();
      for (let i = 0; i < Math.min(5, raw.length); i++) {
        const joined = raw[i].map(c=>cs(c)).join(" ");
        const m = joined.match(/(\d{2})-(\d{2})-(\d{4})/);
        if (m) { reportMonth = parseInt(m[2]); reportYear = parseInt(m[3]); break; }
        const m2 = joined.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})/i);
        if (m2) { const mi = MONTHS.findIndex(mn=>mn.toLowerCase()===m2[1].toLowerCase().slice(0,3)); if (mi>=0) { reportMonth=mi+1; reportYear=parseInt(m2[2]); break; } }
      }
      const daysInMonth = new Date(reportYear, reportMonth, 0).getDate();

      const log = []; let synced=0, skipped=0;
      const records = [];
      const attMap = { ...attendance }; // local working copy, updated as rows are processed
      const empsSnap = [...employees].map(em => ({ ...em }));
      let { byCode, byName } = buildEmpMaps(empsSnap);
      function rebuildMaps() { const m = buildEmpMaps(empsSnap); byCode = m.byCode; byName = m.byName; }

      function isEmpRow(row) {
        for (let ci = 0; ci < Math.min(5, row.length); ci++) {
          const v = cs(row[ci]);
          if (!/^\d{4,}$/.test(v)) continue;
          for (let ni = ci+1; ni < Math.min(ci+10, row.length); ni++) {
            const nv = cs(row[ni]);
            if (nv && nv.length > 2 && /[A-Za-z]/.test(nv) && !/^(empcode|name|present|absent|department|company|branch|desig|arrived|dept|working|status|shift|leave|paid)/i.test(nv)) {
              return { empCodeCol: ci, nameCol: ni, empCode: v, name: nv };
            }
          }
        }
        return null;
      }
      function getDayColMap(row) {
        const map = {};
        row.forEach((c, ci) => {
          let n = null;
          if (typeof c === "number" && c >= 1 && c <= 31) n = Math.round(c);
          else { const v = cs(c); const p = parseInt(v); if (!isNaN(p) && p >= 1 && p <= 31 && (v===String(p)||v===fmt2(p))) n = p; }
          if (n !== null && !map[n]) map[n] = ci;
        });
        return Object.keys(map).length >= 15 ? map : null;
      }
      function getRowType(row) {
        const v = cs(row[0]).toLowerCase();
        if (!v) return null;
        if (v.includes("arrived")||v.includes("arr time")||v.includes("in time")) return "arr";
        if (v.includes("dept")||v.includes("out time")||v.includes("dep.")) return "dep";
        if (v.includes("working hrs")||v.includes("work hrs")||v.includes("wrkhrs")) return "wrk";
        if (v.includes("o.time")||v.includes("o.times")||v.includes("ot hrs")||v.includes("overtime")) return "ot";
        if (v.includes("status")) return "status";
        if (v.includes("shift")) return "shift";
        return null;
      }

      log.push({ type:"ok", msg:`File: ${raw.length} rows · ${MONTHS[reportMonth-1]} ${reportYear} (${daysInMonth} days)` });

      let i = 0;
      while (i < raw.length) {
        const empInfo = isEmpRow(raw[i]);
        if (!empInfo) { i++; continue; }

        const empCodeRaw = normCode(empInfo.empCode);
        const empNameRaw = empInfo.name;
        const empRow = raw[i];
        const afterName = empRow.slice(empInfo.nameCol+1).map(c=>cs(c)).filter(c=>c!=="");
        const totalPresent = parseInt(afterName[0])||0;
        const totalWO = parseInt(afterName[2])||0;
        const totalAbsent = parseInt(afterName[3])||0;
        const totalLeave = parseInt(afterName[4])||0;
        const workHrsTotal = afterName[7]||"";
        const ovTimTotal = afterName[8]||"";

        let dayColMap = null;
        let arrRow=null, depRow=null, wrkRow=null, otRow=null, stRow=null, shRow=null;
        const debugRows = [];

        for (let j = i+1; j < Math.min(i+20, raw.length); j++) {
          const row = raw[j];
          if (isEmpRow(row)) break;
          const joined = row.map(c=>cs(c)).join("").trim();
          debugRows.push(`j${j}:[${row.slice(0,6).map(c=>cs(c)).join("|")}]`);
          if (!joined) continue;
          if (!dayColMap) { const dm = getDayColMap(row); if (dm) { dayColMap = dm; continue; } }
          if (dayColMap) {
            const rt = getRowType(row);
            if (rt==="arr" && !arrRow) arrRow=row;
            else if (rt==="dep" && !depRow) depRow=row;
            else if (rt==="wrk" && !wrkRow) wrkRow=row;
            else if (rt==="ot" && !otRow) otRow=row;
            else if (rt==="status" && !stRow) stRow=row;
            else if (rt==="shift" && !shRow) shRow=row;
          }
        }
        i++;

        if (!dayColMap) {
          log.push({ type:"skip", msg:`${empNameRaw} (${empCodeRaw}) · No day-header found. ${debugRows.slice(0,3).join(" || ")}` });
          skipped++; continue;
        }

        let emp = byCode[empCodeRaw] || byCode[String(parseInt(empCodeRaw,10)||0)] || byCode[empCodeRaw.replace(/^0+/,"")||"0"];
        if (!emp && empNameRaw.length>2) emp = byName[empNameRaw.toLowerCase()];
        if (!emp && empNameRaw.length>2) { const fw=empNameRaw.toLowerCase().split(/\s+/)[0]; if (fw.length>2) emp = empsSnap.find(x=>x.name && x.name.toLowerCase().startsWith(fw)); }

        if (emp && empCodeRaw && normCode(emp.empNum) !== empCodeRaw) {
          try {
            const oldCode = emp.empNum || "(none)";
            const updated = await adminUpdateEmployee(adminToken, emp.id, { ...emp, empNum: empCodeRaw });
            const si = empsSnap.findIndex(x=>x.id===emp.id);
            if (si>=0) empsSnap[si]=updated;
            emp = updated; rebuildMaps();
            log.push({ type:"ok", msg:`Updated emp code: ${oldCode} to ${empCodeRaw} (${emp.name})` });
          } catch (err) { console.error("Could not update emp code:", err); }
        }
        if (!emp && empCodeRaw && empCodeRaw !== "0") {
          try {
            const pin = empCodeRaw.slice(-4).padStart(4,"0");
            const created = await adminCreateEmployee(adminToken, { name: empNameRaw||empCodeRaw, pin, company:COMPANIES[0], empNum: empCodeRaw });
            empsSnap.push(created); emp = created; rebuildMaps();
            log.push({ type:"ok", msg:`Auto-created: ${emp.name} (${empCodeRaw})` });
          } catch (err) { console.error("Could not auto-create employee:", err); }
        }
        if (!emp) { log.push({ type:"skip", msg:`No match: ${empNameRaw} (${empCodeRaw})` }); skipped++; continue; }

        let daysSynced = 0;
        for (let d = 1; d <= daysInMonth; d++) {
          const ci = dayColMap[d];
          if (ci === undefined) continue;
          const arrRaw = cs(arrRow ? arrRow[ci] : "");
          const depRaw = cs(depRow ? depRow[ci] : "");
          const wrkRaw = cs(wrkRow ? wrkRow[ci] : "");
          const otRaw = cs(otRow ? otRow[ci] : "");
          const stRaw = cs(stRow ? stRow[ci] : "");
          const shRaw = cs(shRow ? shRow[ci] : "");
          if (!arrRaw && !depRaw && !stRaw) continue;
          const dateStr = `${reportYear}-${fmt2(reportMonth)}-${fmt2(d)}`;
          const existing = { ...(attMap[attnKey(emp.id, dateStr)] || { empId: emp.id, date: dateStr }) };
          const inTime = parseBioTime(arrRaw);
          const outTime = parseBioTime(depRaw);
          if (inTime) existing.inTime = inTime;
          if (outTime) existing.outTime = outTime;
          if (wrkRaw && wrkRaw !== "00:00") existing.bioWrkHrs = wrkRaw;
          if (otRaw && otRaw !== "00:00") existing.bioOT = otRaw;
          if (shRaw) existing.shift = shRaw;
          existing.monthlySource = file.name;
          const stUp = stRaw.toUpperCase();
          if (existing.leaveType) {
            const lt = LEAVE_TYPES.find(l=>l.label===existing.leaveType);
            existing.status = (lt && !lt.present) ? "Leave" : calcStatus(existing, settings.stdHours);
          }
          else if (stUp==="P") existing.status="Present";
          else if (stUp==="A") existing.status="Absent";
          else if (stUp==="HL") existing.status="Half Day";
          else if (stUp==="WO") { existing.status="Absent"; existing.weekOff=true; }
          else if (stUp==="L") existing.status="Leave";
          else if (stUp==="OD") { existing.status="Present"; existing.onDuty=true; }
          else if (stUp==="WFH") { existing.status="Present"; existing.wfh=true; }
          else existing.status = calcStatus(existing, settings.stdHours);
          attMap[attnKey(emp.id, dateStr)] = existing;
          records.push(existing);
          daysSynced++; synced++;
        }
        log.push({ type:"ok", msg:`${emp.name} (${empCodeRaw}) · ${daysSynced}/${daysInMonth} days · P:${totalPresent} WO:${totalWO} A:${totalAbsent} L:${totalLeave} Hrs:${workHrsTotal} OT:${ovTimTotal}` });
      }

      if (empsSnap.length !== employees.length) setEmployees(empsSnap);
      if (records.length) {
        await adminBulkUpsertAttendance(adminToken, records);
        setAttendance(prev => {
          const next = { ...prev };
          for (const r of records) next[attnKey(r.empId, r.date)] = r;
          return next;
        });
      }
      const sd = { filename: file.name, reportMonth, reportYear, importedAt: new Date().toISOString(), synced, skipped };
      setMonthlySheet(sd);
      await adminSetMonthlySheet(adminToken, file.name, reportMonth, reportYear, synced, skipped);
      setMonthlySyncLog(log);
      setMonthlyImportStatus(`Synced ${synced} day-records · ${skipped} skipped · ${MONTHS[reportMonth-1]} ${reportYear}`);
      addAudit("IMPORT", `Monthly bio: ${file.name} · ${synced} day-records`, "admin");
    } catch (err) { setMonthlyImportStatus("Error: "+err.message); console.error(err); }
    if (monthlyImportRef.current) monthlyImportRef.current.value = "";
  }

  async function removeMonthlySheet() {
    try {
      await adminClearMonthlySheet(adminToken);
      setMonthlySheet(null); setMonthlyImportStatus(""); setMonthlySyncLog([]);
    } catch (err) { alert(err.message); }
  }

  async function exportMonthlySheet() {
    // Monthly bio sheets only cache summary metadata, not the raw rows
    // (the grid format is too large/irregular to store verbatim) — so
    // there is nothing to re-export here.
    alert("The monthly bio source file isn't cached for re-export — only its summary is kept. Re-import the original file if you need to export it again.");
  }

  async function exportReport(type, from, to) {
    const rows=Object.entries(attendance).filter(([,v])=>(v.date||"")>=from&&(v.date||"")<=to).map(([,v])=>{
      const emp=employees.find(e=>e.id===v.empId)||{};
      const raw=calcRawHrs(v.inTime,v.outTime);
      const deduct=v.leaveType?(LEAVE_TYPES.find(l=>l.label===v.leaveType)?.deduct||0):0;
      const net=Math.max(0,raw-deduct);
      return { Date:v.date,"Employee ID":emp.empNum||"","Employee Name":emp.name||"",Department:emp.dept||"",Designation:emp.jobTitle||"",Company:emp.company||"","Login Time":v.inTime||"","Logout Time":v.outTime||"","Raw Hours":raw.toFixed(2),"Total Hours":net.toFixed(2),Overtime:Math.max(0,net-settings.stdHours).toFixed(2),Status:v.status||"","Leave Type":v.leaveType||"","Leave Reason":v.leaveReason||"",WFH:v.wfh?"Yes":"No","On Duty":v.onDuty?"Yes":"No",Location:v.inLocation||"",Remarks:"" };
    });
    if(!rows.length) { setReportMsg("No records found."); return; }
    if(type==="xlsx") {
      const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,"Attendance");
      XLSX.writeFile(wb,`attendance_${from}_${to}.xlsx`);
    } else {
      const keys=Object.keys(rows[0]);
      const csv=[keys.join(","),...rows.map(r=>keys.map(k=>`"${r[k]??""}"`).join(","))].join("\n");
      const a=document.createElement("a");
      a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv);
      a.download=`attendance_${from}_${to}.csv`; a.click();
    }
    addAudit("REPORT",`Report ${from} to ${to}`,"admin");
  }

  async function exportDailyRecords(fmtType) {
    const rows = getAttnRows().map(r => {
      const emp = employees.find(e => e.id === r.empId) || {};
      const raw = calcRawHrs(r.inTime, r.outTime);
      const lt = r.leaveType ? LEAVE_TYPES.find(l => l.label === r.leaveType) : null;
      const net = Math.max(0, raw - (lt?.deduct || 0)); const ot = Math.max(0, net - settings.stdHours);
      const bal = leaveBalances[emp.id]; const thisLeaveBal = r.leaveType && bal && bal[r.leaveType];
      return { "Date": r.date, "Emp Code": emp.empNum || "", "Name": emp.name || "", "Department": emp.dept || "", "Designation": r.designation || emp.jobTitle || "", "Reporting Manager": emp.manager || "", "Company": emp.company || "", "Shift": r.shift || "", "Shift Start": r.shiftStart || "", "In Time": r.inTime || "", "Out Time": r.outTime || "", "Late Hrs": r.lateHrs || "", "Early Hrs": r.earlyHrs || "", "Raw Hrs": raw.toFixed(2), "Net Hrs": net.toFixed(2), "Bio WrkHrs": r.bioWrkHrs || "", "OT calc": ot.toFixed(2), "Bio OT": r.bioOT || "", "Status": r.status || "", "Bio Status": r.bioStatusRaw || "", "Leave Type": r.leaveType || "", "Leave Balance": thisLeaveBal ? `${thisLeaveBal.balance}/${thisLeaveBal.quota} ${thisLeaveBal.unit}` : "", "Leave Reason": r.leaveReason || "", "WFH": r.wfh ? "Yes" : "No", "On Duty": r.onDuty ? "Yes" : "No", "In Temp": r.inTemp || "", "Out Temp": r.outTemp || "", "Card No": r.cardNo || "", "Remark": r.remark || "", "Location": r.inLocation || "", "Source": r.bioSource ? "Daily Bio" : r.monthlySource ? "Monthly Bio" : r.source === "manual" ? "Manual" : "" };
    });
    if (!rows.length) { setReportMsg("No records for current filter."); return; }
    const { month, year, customRange, from, to } = attnFilters;
    const label = customRange ? `${from}_to_${to}` : `${year}_${fmt2(month)}`;
    if (fmtType === "xlsx") {
      const ws = XLSX.utils.json_to_sheet(rows); const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Daily Records");
      XLSX.writeFile(wb, `daily_records_${label}.xlsx`);
    } else {
      const keys = Object.keys(rows[0]);
      const csv = [keys.join(","), ...rows.map(r => keys.map(k => `"${r[k] ?? ""}"`).join(","))].join("\n");
      const a = document.createElement("a");
      a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
      a.download = `daily_records_${label}.csv`; a.click();
    }
    addAudit("REPORT", `Daily records exported ${label}`, "admin");
  }

  async function exportDB(col, type) {
    let rows=[];
    if(col==="employees") rows=employees;
    if(col==="attendance") rows=Object.values(attendance).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,200);
    if(col==="leaves") rows=[...leaves].sort((a,b)=>b.date.localeCompare(a.date));
    if(col==="balances") { Object.entries(leaveBalances).forEach(([eid,types])=>{ const emp=employees.find(e=>e.id===eid);
      Object.entries(types).forEach(([lt,v])=>rows.push({"Employee":emp?.name||eid,"Leave Type":lt,...v})); }); }
    if(col==="audit") rows=auditLogs;
    if(!rows.length) return;
    if(type==="xlsx") {
      const ws=XLSX.utils.json_to_sheet(rows); const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,col); XLSX.writeFile(wb,`${col}.xlsx`);
    } else {
      const keys=Object.keys(rows[0]||{});
      const csv=[keys.join(","),...rows.map(r=>keys.map(k=>`"${r[k]??""}"`).join(","))].join("\n");
      const a=document.createElement("a");
      a.href="data:text/csv;charset=utf-8,"+encodeURIComponent(csv); a.download=`${col}.csv`;
      a.click();
    }
  }

  function backupAll() {
    const data = { employees, attendance, leaves, leaveBalances, auditLogs, settings };
    const a=document.createElement("a");
    a.href="data:application/json;charset=utf-8,"+encodeURIComponent(JSON.stringify(data,null,2));
    a.download="hrms_backup_"+TODAY+".json"; a.click();
    addAudit("BACKUP","Full backup","admin");
  }
  function restoreAll(e) {
    alert("Restoring a backup file isn't available yet in this version \u2014 safely writing a backup back into the live database needs a bit more design work first (handling ID conflicts, etc). Backups are still useful as a point-in-time export; if you ever need to restore one, let's do it together so we can check the file first.");
    if (restoreRef.current) restoreRef.current.value = "";
  }
  async function exportSheet() {
    if(!importedSheet) return;
    const ws=XLSX.utils.json_to_sheet(importedSheet.rows);
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,"Sheet1"); XLSX.writeFile(wb,"exported_sheet.xlsx");
  }

  const activeEmps = (view==="admin" ? employees : directory).filter(e=>e.active);
  const companyEmps = loginCompany ? activeEmps.filter(e=>e.company===loginCompany) : [];
  const uniqueLocations = [...new Set(employees.map(e=>e.locationInfo).filter(Boolean))];

  function getAttnRows() {
    const {company,location,month,year,empId,customRange,from,to,allSummary}=attnFilters;
    let filtered=Object.values(attendance);
    if(customRange) filtered=filtered.filter(r=>r.date>=from&&r.date<=to);
    else filtered=filtered.filter(r=>{ const d=new Date(r.date); return d.getMonth()+1===month&&d.getFullYear()===year; });
    if(company) filtered=filtered.filter(r=>employees.find(e=>e.id===r.empId)?.company===company);
    if(location) filtered=filtered.filter(r=>employees.find(e=>e.id===r.empId)?.locationInfo===location);
    if(empId&&!allSummary) filtered=filtered.filter(r=>r.empId===empId);
    return filtered.sort((a,b)=>b.date.localeCompare(a.date));
  }
  function getSummaryRows() {
    const map={};
    getAttnRows().forEach(r=>{
      if(!map[r.empId]) map[r.empId]={empId:r.empId,present:0,halfDay:0,leave:0,absent:0,wfh:0,onDuty:0,hrs:0,ot:0};
      const s=r.status||"Absent";
      if(s==="Present") map[r.empId].present++; if(s==="Half Day") map[r.empId].halfDay++;
      if(s==="Leave") map[r.empId].leave++; if(s==="Absent") map[r.empId].absent++;
      if(r.wfh) map[r.empId].wfh++; if(r.onDuty) map[r.empId].onDuty++;
      const raw=calcRawHrs(r.inTime,r.outTime);
      const deduct=r.leaveType?(LEAVE_TYPES.find(l=>l.label===r.leaveType)?.deduct||0):0;
      const net=Math.max(0,raw-deduct);
      map[r.empId].hrs+=net; map[r.empId].ot+=Math.max(0,net-settings.stdHours);
    });
    return Object.values(map);
  }
  function getMonthlySummary(empId,month,year) {
    const rows=Object.values(attendance).filter(r=>r.empId===empId&&new Date(r.date).getMonth()+1===month&&new Date(r.date).getFullYear()===year);
    const s={present:0,halfDay:0,leave:0,absent:0,wfh:0,onDuty:0,totalHrs:0,otHrs:0};
    rows.forEach(r=>{
      if(r.status==="Present") s.present++; if(r.status==="Half Day") s.halfDay++;
      if(r.status==="Leave") s.leave++; if(r.status==="Absent") s.absent++;
      if(r.wfh) s.wfh++; if(r.onDuty) s.onDuty++;
      const raw=calcRawHrs(r.inTime,r.outTime);
      const deduct=r.leaveType?(LEAVE_TYPES.find(l=>l.label===r.leaveType)?.deduct||0):0;
      const net=Math.max(0,raw-deduct);
      s.totalHrs+=net; s.otHrs+=Math.max(0,net-settings.stdHours);
    });
    return s;
  }
  function getTodayStats() {
    const todayRecs=Object.values(attendance).filter(r=>r.date===TODAY);
    const s={active:activeEmps.length,present:0,absent:0,leave:0,halfDay:0,wfh:0,onDuty:0,pending:leaves.filter(l=>l.status==="Pending").length};
    todayRecs.forEach(r=>{ if(r.status==="Present") s.present++; if(r.status==="Half Day") s.halfDay++; if(r.status==="Leave") s.leave++; if(r.status==="Absent") s.absent++; if(r.wfh) s.wfh++; if(r.onDuty) s.onDuty++; });
    return s;
  }

  if(loading) return <Spinner/>;

  const card = "bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/10 p-5";
  const inp = "w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20";
  const lbl = "text-white/50 text-xs font-medium mb-1.5 block uppercase tracking-wide";
  const btnPri = "px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all shadow-lg shadow-indigo-500/20 active:scale-95";
  const btnSec = "px-4 py-2 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/20 text-white/80 border border-white/10 transition-all active:scale-95";
  const btnDanger = "px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-all";
  const btnWarning = "px-3 py-1.5 rounded-lg text-xs font-medium bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border border-yellow-500/30 transition-all";
  const btnSuccess = "px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all";

  // ===== ADMIN LOGIN =====
  if(showAdminLogin) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-500/30">
            <span className="text-white font-bold text-xl">A</span>
          </div>
          <h1 className="text-2xl font-bold text-white">Admin Login</h1>
          <p className="text-white/40 text-sm mt-1">HRMS</p>
        </div>
        <div className={card}>
          <label className={lbl}>Admin PIN</label>
          <input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            className={inp+" mb-3 tracking-widest text-center text-lg"} value={adminPinInput}
            onChange={e=>setAdminPinInput(e.target.value)}
            onKeyDown={e=>e.key==="Enter"&&doAdminLogin()} placeholder="----" />
          {adminLoginError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 text-red-300 text-xs text-center">{adminLoginError}</div>}
          <button className={btnPri+" w-full"} onClick={doAdminLogin}>Login to Admin Panel</button>
          <button className="w-full mt-3 text-white/40 hover:text-white/60 text-sm transition-colors"
            onClick={()=>{setShowAdminLogin(false);setAdminPinInput("");setAdminLoginError("");}}>Back to Employee Login</button>
        </div>
      </div>
    </div>
  );

  // ===== LOGIN =====
  if(view==="login") return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-3xl flex items-center justify-center mx-auto mb-4 shadow-2xl shadow-indigo-500/30">
            <span className="text-white font-bold text-3xl">AL</span>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 to-violet-400 bg-clip-text text-transparent">HRMS</h1>
          <p className="text-white/30 text-sm mt-2">Select your company to get started</p>
        </div>
        {loginStep===1 && (
          <div className="space-y-3">
            {COMPANIES.map((c,i)=>(
              <button key={c} onClick={()=>{setLoginCompany(c);setLoginStep(2);}}
                className={`w-full p-4 rounded-2xl border border-white/10 hover:border-white/20 text-left transition-all group hover:scale-[1.01] active:scale-[0.99]`}>
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${COMPANY_COLORS[i]} flex items-center justify-center shadow-lg`}>
                    <span className="text-white font-bold text-lg">{COMPANY_ICONS[i]}</span>
                  </div>
                  <div className="flex-1">
                    <p className="text-white font-semibold">{c}</p>
                    <p className="text-white/40 text-xs mt-0.5">{activeEmps.filter(e=>e.company===c).length} active employees</p>
                  </div>
                  <span className="text-white/30 group-hover:text-white/60 text-xl transition-colors">{'\u203A'}</span>
                </div>
              </button>
            ))}
          </div>
        )}
        {loginStep===2 && (
          <div className={card}>
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-white/10">
              <button onClick={()=>{setLoginStep(1);setSelectedEmp(null);setEmpSearch("");}} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white/60 hover:text-white transition-all text-lg">{'\u2039'}</button>
              <div>
                <p className="text-white font-semibold text-sm">{loginCompany}</p>
                <p className="text-white/40 text-xs">Select your name</p>
              </div>
            </div>
            {!selectedEmp ? (
              companyEmps.length===0
                ? <div className="text-center py-10"><div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3"><span className="text-white/30 text-xl font-bold">?</span></div><p className="text-white/40">No employees registered</p></div>
                : <>
                  <div className="flex items-center gap-2 mb-3">
                    <input
                      className={inp+" flex-1 text-xs"}
                      placeholder="Search by name or employee number..."
                      value={empSearch}
                      onChange={e=>setEmpSearch(e.target.value)}
                      autoComplete="off"
                    />
                    {empSearch&&<button className="text-white/40 hover:text-white/70 text-sm px-2" onClick={()=>setEmpSearch("")}>x</button>}
                  </div>
                  {(()=>{
                    const q=empSearch.toLowerCase();
                    const filtered=companyEmps.filter(e=>!q||e.name.toLowerCase().includes(q)||(e.empNum||"").toLowerCase().includes(q));
                    return <>
                      <p className="text-white/30 text-xs mb-2">{filtered.length} employee{filtered.length!==1?"s":""} found</p>
                      <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                        {filtered.map(e=>(
                          <button key={e.id} onClick={()=>setSelectedEmp(e)}
                            className="p-3 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 hover:border-indigo-500/40 text-left transition-all">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center text-sm font-bold text-white mb-2">
                              {(e.name||"?")[0].toUpperCase()}
                            </div>
                            <p className="text-white text-xs font-medium truncate">{e.name}</p>
                            <p className="text-white/30 text-xs truncate">{e.jobTitle||e.dept||"Employee"}</p>
                            {e.empNum&&<p className="text-white/20 text-xs truncate">{e.empNum}</p>}
                          </button>
                        ))}
                        {filtered.length===0&&<div className="col-span-2 text-center py-6 text-white/30 text-sm">No employees match your search</div>}
                      </div>
                    </>;
                  })()}
                </>
            ) : (
              <div>
                <div className="flex items-center gap-3 mb-5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white">{(selectedEmp.name||"?")[0].toUpperCase()}</div>
                  <div><p className="text-white font-semibold">{selectedEmp.name}</p><p className="text-white/40 text-xs">{selectedEmp.jobTitle||selectedEmp.dept}</p></div>
                </div>
                <label className={lbl}>Enter PIN</label>
                <input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
                  className={inp+" mb-2 text-center tracking-widest text-lg"} value={pinInput}
                  onChange={e=>setPinInput(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&doLogin()} placeholder="----" />
                {loginError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2 mb-3 text-red-300 text-xs text-center">{loginError}</div>}
                <label className="flex items-center gap-2 mb-3 cursor-pointer">
                  <input type="checkbox" checked={rememberMe} onChange={e=>setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded accent-indigo-500"/>
                  <span className="text-white/50 text-xs">Remember me on this device</span>
                </label>
                <div className="flex gap-2">
                  <button className={btnPri+" flex-1"} onClick={doLogin}>Login</button>
                  <button className={btnSec} onClick={()=>{setSelectedEmp(null);setPinInput("");setLoginError("");setEmpSearch("");}}>Back</button>
                </div>
              </div>
            )}
          </div>
        )}
        <div className="text-center mt-6">
          <button className="text-indigo-400/60 hover:text-indigo-400 text-sm transition-colors" onClick={()=>setShowAdminLogin(true)}>Admin Panel Login</button>
        </div>
      </div>
    </div>
  );

  // ===== EMPLOYEE DASHBOARD =====
  if(view==="employee") {
    const rec=todayRec(currentUser.id);
    const raw=calcRawHrs(rec.inTime,rec.outTime);
    const lt=rec.leaveType?LEAVE_TYPES.find(l=>l.label===rec.leaveType):null;
    const deduct=lt?.deduct||0;
    const net=Math.max(0,raw-deduct);
    const ot=Math.max(0,net-settings.stdHours);
    const balances=leaveBalances[currentUser.id]||{};
    const myLeaves=leaves.filter(l=>l.empId===currentUser.id);
    const avLT=availableLeaveTypes();
    const {month:m,year:y}=monthSel;
    const summary=getMonthlySummary(currentUser.id,m,y);
    const hasWFHorODToday = leaves.some(l=>
      l.empId===currentUser.id && l.date===TODAY && l.status==="Approved" &&
      (l.leaveType==="Work From Home"||l.leaveType==="On Duty")
    );
    const tabs = [
      {id:"today",label:"Work Status"},
      {id:"leaves",label:"Apply For"},
      {id:"history",label:"History"},
      {id:"summary",label:"Summary"},
      ...(myTeam.length > 0 ? [{id:"team",label:`My Team (${myTeam.length})`}] : []),
    ];
    const activeEmpTab = empTab;
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
        <div className="bg-gradient-to-r from-indigo-900/50 to-violet-900/50 border-b border-white/10 px-4 py-4 sticky top-0 z-40 backdrop-blur-xl">
          <div className="max-w-2xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white text-lg">{currentUser.name.charAt(0).toUpperCase()}</div>
              <div>
                <p className="text-white font-bold">{currentUser.name}</p>
                <p className="text-white/40 text-xs">{currentUser.company?.split(" ").slice(0,2).join(" ")} {'\u00B7'} {TODAY}</p>
              </div>
            </div>
            <button className={btnSec+" text-xs"}
              onClick={employeeLogoutHandler}>Logout</button>
          </div>
        </div>
        <div className="max-w-2xl mx-auto p-4 space-y-4">
          <div className={`rounded-2xl p-4 border ${statusStyle(rec.status||"Absent").bg} ${statusStyle(rec.status||"Absent").border}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Today's Status</p>
                <Badge s={rec.status||"Absent"} />
              </div>
              {rec.inTime && <div className="text-right">
                <p className="text-white/40 text-xs">Net Hours</p>
                <p className="text-white text-2xl font-bold font-mono">{fmtHrs(net)}</p>
              </div>}
            </div>
          </div>
          <div className="flex gap-2 bg-white/5 rounded-2xl p-1 border border-white/10">
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setEmpTab(t.id)}
                className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${activeEmpTab===t.id?"bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg":"text-white/50 hover:text-white/80"}`}>
                {t.label}
              </button>
            ))}
          </div>
          {activeEmpTab==="today"&&<>
            <div className={card}>
              <h2 className="text-white font-semibold mb-4">Punch In / Out</h2>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <button
                  onClick={()=>punch("in")}
                  className="bg-white/5 hover:bg-emerald-500/10 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-5 text-center transition-all active:scale-95 cursor-pointer group">
                  <p className="text-white/40 text-xs uppercase tracking-widest mb-2">IN TIME</p>
                  <p className="text-white font-mono text-2xl font-bold mb-3">{rec.inTime||"--:--"}</p>
                  <p className="text-emerald-400 text-xs font-semibold group-hover:text-emerald-300">Punch In</p>
                </button>
                <button
                  onClick={()=>punch("out")}
                  className="bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/40 rounded-2xl p-5 text-center transition-all active:scale-95 cursor-pointer group">
                  <p className="text-white/40 text-xs uppercase tracking-widest mb-2">OUT TIME</p>
                  <p className="text-white font-mono text-2xl font-bold mb-3">{rec.outTime||"--:--"}</p>
                  <p className="text-red-400 text-xs font-semibold group-hover:text-red-300">Punch Out</p>
                </button>
              </div>
              {locationStatus&&<div className={`rounded-lg p-2 mb-1 text-xs text-center ${locationStatus.startsWith("Located")?"bg-emerald-500/10 text-emerald-400 border border-emerald-500/20":"bg-blue-500/10 text-blue-400 border border-blue-500/20"}`}>{locationStatus}</div>}
              {locationBlocked&&<div className="rounded-lg p-3 mb-1 text-xs text-center bg-red-500/10 text-red-300 border border-red-500/20">
                <p className="font-semibold mb-1">Location access required</p>
                <p className="text-red-300/70">Please allow location access in your browser settings, then try again. Punching is not allowed without location.</p>
              </div>}
              {autoLocIntervalRef.current&&<div className="mt-2 p-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shrink-0"/>
                <p className="text-emerald-400/70 text-xs">Location tracking active — auto-captures every 2 hours</p>
              </div>}
              {(rec.inLocation||rec.outLocation)&&<p className="text-emerald-400/50 text-xs text-center mt-1 truncate">{rec.inLocation||rec.outLocation}</p>}
              {odIntervalRef.current&&<div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                <p className="text-purple-300 text-xs font-medium mb-2">On Duty GPS Tracking Active</p>
                <div className="max-h-24 overflow-y-auto space-y-1">
                  {odTrackLog.slice().reverse().map((entry,i)=>(
                    <p key={i} className="text-purple-400/70 text-xs font-mono">{entry.ts} — {entry.loc}</p>
                  ))}
                  {odTrackLog.length===0&&<p className="text-purple-400/40 text-xs">Waiting for first location ping...</p>}
                </div>
              </div>}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[["Raw Hrs",fmtHrs(raw),"white"],["Net Hrs",fmtHrs(net),"white"],["Overtime",fmtHrs(ot),ot>0?"emerald":""]].map(([k,v,c])=>(
                <div key={k} className="bg-white/5 rounded-2xl p-3 text-center border border-white/10">
                  <p className="text-white/40 text-xs">{k}</p>
                  <p className={`font-bold mt-1 ${c==="emerald"?"text-emerald-400":"text-white"}`}>{v}</p>
                </div>
              ))}
            </div>
            {(()=>{
              const sh = getShiftInfo(rec, currentUser);
              if (!sh || sh.id === "none") return null;
              return <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                <p className="text-white/40 text-xs uppercase tracking-wide mb-2">Your Shift</p>
                <div className="flex items-center gap-3">
                  <ShiftBadge shift={sh}/>
                  {sh.start && sh.end && <p className="text-white/60 text-sm font-mono">{sh.start} — {sh.end}</p>}
                </div>
              </div>;
            })()}
            {(()=>{
              const upcoming = holidays
                .filter(h => h.date >= TODAY)
                .sort((a,b) => a.date < b.date ? -1 : 1)
                .slice(0, 5);
              if (upcoming.length === 0) return null;
              return <div className="bg-amber-500/5 border border-amber-500/20 rounded-2xl p-4">
                <p className="text-amber-300/80 text-xs font-semibold uppercase tracking-wide mb-3">Upcoming Holidays</p>
                <div className="space-y-2">
                  {upcoming.map(h => (
                    <div key={h.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-white text-sm">{h.name}</p>
                        <p className="text-white/30 text-xs">{h.date}</p>
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/20">{h.type||"Public"}</span>
                    </div>
                  ))}
                </div>
              </div>;
            })()}
          </>}
          {activeEmpTab==="history"&&<div className={card}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-white font-semibold">Attendance History</h2>
              <div className="flex gap-2">
                <button onClick={()=>setEmpHistTab("attendance")} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${empHistTab==="attendance"?"bg-indigo-600/30 border-indigo-500/40 text-white":"bg-white/5 border-white/10 text-white/50"}`}>Attendance</button>
                <button onClick={()=>setEmpHistTab("regularization")} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${empHistTab==="regularization"?"bg-indigo-600/30 border-indigo-500/40 text-white":"bg-white/5 border-white/10 text-white/50"}`}>Regularization</button>
              </div>
            </div>
            {empHistTab==="attendance"&&(()=>{
              const empId = currentUser.id;
              const myRecs = Object.entries(attendance)
                .filter(([k]) => {
                  // Supabase keys are empId_date
                  return k.startsWith(String(empId) + "_");
                })
                .map(([k,v]) => ({ date: k.slice(String(empId).length + 1), rec: v }))
                .filter(({date}) => date && /^\d{4}-\d{2}-\d{2}$/.test(date))
                .sort((a,b) => b.date.localeCompare(a.date))
                .slice(0, 90);
              if (myRecs.length === 0) return (
                <div className="text-center py-10">
                  <p className="text-white/30 text-sm">No attendance records found.</p>
                  <p className="text-white/20 text-xs mt-1">Records appear here after your first punch-in.</p>
                </div>
              );
              return <div className="space-y-1.5 max-h-[65vh] overflow-y-auto pr-1">
                {myRecs.map(({date,rec})=>{
                  const raw2 = calcRawHrs(rec.inTime, rec.outTime);
                  const lt2 = rec.leaveType ? LEAVE_TYPES.find(l=>l.label===rec.leaveType) : null;
                  const net2 = Math.max(0, raw2 - (lt2?.deduct||0));
                  const st = rec.status || calcStatus(rec, settings.stdHours);
                  const ss = statusStyle(st);
                  return <div key={date} className={`flex items-center gap-3 p-3 rounded-xl border ${ss.bg} ${ss.border}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{date}</p>
                      <p className="text-white/40 text-xs font-mono mt-0.5">
                        {rec.inTime||"--:--"} — {rec.outTime||"--:--"}
                        {rec.leaveType && <span className="ml-2 text-amber-400/70">{rec.leaveType}</span>}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <Badge s={st}/>
                      {net2 > 0 && <p className="text-white/30 text-xs mt-0.5">{fmtHrs(net2)}</p>}
                    </div>
                  </div>;
                })}
              </div>;
            })()}
            {empHistTab==="regularization"&&<>
              <button className={btnPri+" text-xs mb-4 w-full"} onClick={()=>{setShowRegModal(true);setRegForm({date:"",inTime:"",outTime:"",reason:""});setRegFormErr({});}}>
                + Request Attendance Correction
              </button>
              {regularizations.length===0
                ? <p className="text-white/30 text-sm text-center py-6">No regularization requests yet</p>
                : <div className="space-y-2">
                  {regularizations.map(r=>(
                    <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-white text-sm font-medium">{r.date}</p>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status==="Approved"?"bg-emerald-500/20 text-emerald-300":r.status==="Rejected"?"bg-red-500/20 text-red-300":"bg-yellow-500/20 text-yellow-300"}`}>{r.status}</span>
                      </div>
                      <p className="text-white/40 text-xs font-mono">{r.requested_in||"--:--"} — {r.requested_out||"--:--"}</p>
                      <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                    </div>
                  ))}
                </div>}
            </>}
          </div>}
          {activeEmpTab==="leaves"&&<>
            <div className={card}>
              <h2 className="text-white font-semibold mb-4">Apply For Leave</h2>
              <div className="grid grid-cols-2 gap-2 mb-5">
                {avLT.map(lt=>(
                  <button key={lt.label}
                    onClick={()=>{setLeaveModal(true);setLeaveForm({type:lt.label,date:TODAY,reason:"",location:null});setLeaveFormErr({});setLocationStatus("");}}
                    className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-indigo-500/10 border border-white/10 hover:border-indigo-500/40 text-left transition-all active:scale-95">
                    <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">{lt.icon}</span>
                    <span className="text-white/70 text-xs">Apply for {lt.label}</span>
                  </button>
                ))}
              </div>
              {Object.keys(balances).length>0&&<>
                <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-3">Leave Balances</p>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  {Object.entries(balances).filter(([lt])=>!lt.includes("Partial")).map(([lt,v])=>(
                    <div key={lt} className="bg-white/5 rounded-xl p-3 border border-white/10">
                      <p className="text-white/40 text-xs truncate">{lt}</p>
                      <p className="text-white font-bold text-lg mt-1">{v.balance}<span className="text-white/30 text-sm">/{v.quota}</span></p>
                      <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                        <div className="bg-gradient-to-r from-indigo-500 to-violet-500 h-1.5 rounded-full transition-all" style={{width:`${Math.min(100,(v.balance/Math.max(v.quota,1))*100)}%`}}></div>
                      </div>
                      <p className="text-white/20 text-xs mt-1">{v.consumed} consumed</p>
                    </div>
                  ))}
                </div>
              </>}
              <div className="pt-3 border-t border-white/10">
                <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Partial Leave Tracker (This Month)</p>
                {[{label:"Partial Leave - 1 Hour",max:2},{label:"Partial Leave - 2 Hours",max:1}].map(({label:lt,max})=>{
                  const used=getMonthlyPartial(currentUser.id,lt,new Date().getMonth()+1,new Date().getFullYear());
                  return <div key={lt} className="flex items-center justify-between mb-2">
                    <span className="text-white/50 text-xs">{lt}</span>
                    <div className="flex items-center gap-2">
                      {Array.from({length:max}).map((_,i)=><div key={i} className={`w-3 h-3 rounded-full ${i<used?"bg-red-400":"bg-white/10 border border-white/20"}`}></div>)}
                      <span className={`text-xs ${used>=max?"text-red-400":"text-emerald-400"}`}>{max-used} left</span>
                    </div>
                  </div>;
                })}
              </div>
            </div>
            <div className={card}>
              <h2 className="text-white font-semibold mb-3">Recent Applications</h2>
              {myLeaves.length===0
                ? <p className="text-white/30 text-sm text-center py-4">No applications yet</p>
                : <div className="space-y-2 max-h-64 overflow-y-auto">
                  {myLeaves.slice(0,10).map(l=>(
                    <div key={l.id} className="bg-white/5 rounded-xl p-3 flex items-center justify-between border border-white/5">
                      <div>
                        <p className="text-white text-sm font-medium">{l.leaveType}</p>
                        <p className="text-white/30 text-xs">{l.date} {'\u00B7'} {l.reason?.slice(0,35)}{l.reason?.length>35?"...":""}</p>
                      </div>
                      <span className={`text-xs px-2 py-1 rounded-full border ${l.status==="Approved"?"bg-emerald-500/20 text-emerald-300 border-emerald-500/30":l.status==="Rejected"?"bg-red-500/20 text-red-300 border-red-500/30":"bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>{l.status}</span>
                    </div>
                  ))}
                </div>}
            </div>
          </>}
          {activeEmpTab==="summary"&&<>
            <div className={card}>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <h2 className="text-white font-semibold flex-1">Monthly Attendance</h2>
                <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={m} onChange={e=>setMonthSel(p=>({...p,month:+e.target.value}))}>
                  {MONTHS.map((mn,i)=><option key={i+1} value={i+1}>{mn}</option>)}
                </select>
                <select className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs" value={y} onChange={e=>setMonthSel(p=>({...p,year:+e.target.value}))}>
                  {Array.from({length:5},(_,i)=>new Date().getFullYear()-i).map(yr=><option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-4 text-center text-white/30 text-xs font-medium pb-1 border-b border-white/10">
                {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><span key={d}>{d}</span>)}
              </div>
              {(()=>{
                const daysInMonth = new Date(y,m,0).getDate();
                const firstDay = new Date(y,m-1,1).getDay();
                const cells = [];
                for(let i=0;i<firstDay;i++) cells.push(null);
                for(let d=1;d<=daysInMonth;d++) cells.push(d);
                return <div className="grid grid-cols-7 gap-1 mb-4">
                  {cells.map((d,i)=>{
                    if(!d) return <div key={i}/>;
                    const dateStr=`${y}-${fmt2(m)}-${fmt2(d)}`;
                    const rec=attendance[`${currentUser.id}_${dateStr}`]||{};
                    const st=rec.status||calcStatus(rec,settings.stdHours);
                    const isToday=dateStr===TODAY;
                    const isFuture=dateStr>TODAY;
                    const isWeekend=new Date(y,m-1,d).getDay()===0||new Date(y,m-1,d).getDay()===6;
                    const holiday=holidays.find(h=>h.date===dateStr);
                    let bg="bg-white/5", text="text-white/40", border="border-white/10";
                    if(holiday){bg="bg-amber-500/15";text="text-amber-300";border="border-amber-500/20";}
                    else if(isWeekend&&!rec.inTime){bg="bg-white/3";text="text-white/20";border="border-white/5";}
                    else if(!isFuture){
                      if(st==="Present"){bg="bg-emerald-500/15";text="text-emerald-300";border="border-emerald-500/20";}
                      else if(st==="Half Day"){bg="bg-yellow-500/15";text="text-yellow-300";border="border-yellow-500/20";}
                      else if(st==="Leave"||st==="WFH"||st==="On Duty"){bg="bg-indigo-500/15";text="text-indigo-300";border="border-indigo-500/20";}
                      else if(st==="Absent"&&!isWeekend){bg="bg-red-500/10";text="text-red-400/80";border="border-red-500/15";}
                    }
                    return <div key={d} className={`${bg} border ${border} rounded-lg p-1.5 text-center relative ${isToday?"ring-1 ring-indigo-400":""}`}>
                      <p className={`text-xs font-bold ${text}`}>{d}</p>
                      {holiday&&<p className="text-amber-400/60 text-[8px] leading-tight truncate">{holiday.name.split(" ")[0]}</p>}
                      {!isFuture&&!holiday&&rec.inTime&&<p className="text-white/20 text-[8px] font-mono">{rec.inTime}</p>}
                      {!isFuture&&!holiday&&!isWeekend&&!rec.inTime&&<p className={`text-[8px] ${text}`}>{st==="Leave"?"L":st==="Absent"?"A":""}</p>}
                    </div>;
                  })}
                </div>;
              })()}
              <div className="grid grid-cols-4 gap-2 mb-2">
                {[["Present",summary.present,"emerald"],["Half Day",summary.halfDay,"yellow"],["Leave",summary.leave,"amber"],["Absent",summary.absent,"red"],["WFH",summary.wfh,"indigo"],["On Duty",summary.onDuty,"purple"],["Total Hrs",fmtHrs(summary.totalHrs),"blue"],["Overtime",fmtHrs(summary.otHrs),"green"]].map(([k,v,c])=>(
                  <div key={k} className={`bg-${c}-500/10 border border-${c}-500/20 rounded-xl p-2 text-center`}>
                    <p className={`text-${c}-300 text-lg font-bold`}>{v}</p>
                    <p className={`text-${c}-400/60 text-xs`}>{k}</p>
                  </div>
                ))}
              </div>
            </div>
            <div className={card}>
              <h2 className="text-white font-semibold mb-4">Leave Balances <span className="text-white/30 text-xs font-normal ml-1">(Current Financial Year)</span></h2>
              {Object.keys(balances).length===0
                ? <p className="text-white/30 text-sm text-center py-4">No leave balance data available</p>
                : <div className="space-y-3">
                  {Object.entries(balances).map(([lt,v])=>{
                    const pct = v.quota > 0 ? Math.min(100, (v.balance/v.quota)*100) : 0;
                    const low = v.balance <= 1 && v.quota > 0;
                    return <div key={lt} className={`p-3 rounded-xl border ${low?"bg-red-500/5 border-red-500/20":"bg-white/5 border-white/10"}`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className={`text-sm font-medium ${low?"text-red-300":"text-white"}`}>{lt}</p>
                        <div className="text-right">
                          <span className={`text-lg font-bold ${low?"text-red-300":"text-white"}`}>{v.balance}</span>
                          <span className="text-white/30 text-xs">/{v.quota} {v.unit||"Days"}</span>
                        </div>
                      </div>
                      <div className="w-full bg-white/10 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full transition-all ${low?"bg-red-400":"bg-gradient-to-r from-indigo-500 to-violet-500"}`} style={{width:`${pct}%`}}/>
                      </div>
                      <div className="flex justify-between mt-1">
                        <span className="text-white/30 text-xs">{v.consumed} used</span>
                        <span className={`text-xs ${low?"text-red-400":"text-emerald-400"}`}>{v.balance} remaining</span>
                      </div>
                    </div>;
                  })}
                </div>}
            </div>
          </>}
          {activeEmpTab==="team"&&<div className="space-y-4">
            <div className={card}>
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h2 className="text-white font-semibold">My Team <span className="text-white/30 text-sm font-normal">({myTeam.length} direct reports)</span></h2>
                {teamLoading&&<span className="text-white/30 text-xs">Loading...</span>}
              </div>
              <div className="flex gap-2 mb-4 flex-wrap">
                {[["requests","Requests"],["attendance","Attendance"],["members","Members"]].map(([t,l])=>(
                  <button key={t} onClick={()=>{setTeamTab(t);if(t==="attendance")loadTeamAttendance(employeeToken,currentUser.id,teamMonthSel.month,teamMonthSel.year);}}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${teamTab===t?"bg-indigo-600/30 border-indigo-500/40 text-white":"bg-white/5 border-white/10 text-white/50"}`}>{l}</button>
                ))}
              </div>

              {teamTab==="requests"&&<>
                <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Leave Requests</p>
                {teamLeaves.filter(l=>l.status==="Pending").length===0
                  ? <p className="text-white/30 text-sm text-center py-4">No pending leave requests</p>
                  : teamLeaves.filter(l=>l.status==="Pending").map(l=>(
                    <div key={l.id} className="bg-white/5 border border-white/10 rounded-xl p-3 mb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white font-medium text-sm">{l.empName}</p>
                          <p className="text-white/50 text-xs">{l.leaveType} · {l.date}</p>
                          <p className="text-white/30 text-xs mt-1 italic">{l.reason}</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button className={btnPri+" text-xs py-1 px-3"} onClick={()=>managerDecideLeave(l.id,"Approved")}>Approve</button>
                          <button className={btnDanger+" text-xs py-1 px-3"} onClick={()=>managerDecideLeave(l.id,"Rejected")}>Reject</button>
                        </div>
                      </div>
                    </div>
                  ))}
                <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2 mt-4">Correction Requests</p>
                {teamRegs.filter(r=>r.status==="Pending").length===0
                  ? <p className="text-white/30 text-sm text-center py-4">No pending correction requests</p>
                  : teamRegs.filter(r=>r.status==="Pending").map(r=>(
                    <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-3 mb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-white font-medium text-sm">{r.empName}</p>
                          <p className="text-white/50 text-xs">{r.date} · <span className="font-mono">{r.requestedIn||"--:--"} — {r.requestedOut||"--:--"}</span></p>
                          <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button className={btnPri+" text-xs py-1 px-3"} onClick={()=>managerDecideReg(r.id,"Approved")}>Approve</button>
                          <button className={btnDanger+" text-xs py-1 px-3"} onClick={()=>managerDecideReg(r.id,"Rejected")}>Reject</button>
                        </div>
                      </div>
                    </div>
                  ))}
                {(teamLeaves.filter(l=>l.status!=="Pending").length>0||teamRegs.filter(r=>r.status!=="Pending").length>0)&&<>
                  <p className="text-white/20 text-xs font-medium uppercase tracking-wide mb-2 mt-4">Previously Actioned</p>
                  {[...teamLeaves.filter(l=>l.status!=="Pending"),...teamRegs.filter(r=>r.status!=="Pending")].slice(0,10).map((item,i)=>(
                    <div key={i} className="flex items-center justify-between py-2 border-b border-white/5">
                      <div>
                        <p className="text-white/50 text-xs font-medium">{item.empName} · {item.leaveType||`Correction ${item.date}`}</p>
                        <p className="text-white/20 text-xs">{item.date}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${item.status==="Approved"?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>{item.status}</span>
                    </div>
                  ))}
                </>}
              </>}

              {teamTab==="attendance"&&<>
                <div className="flex gap-2 mb-4 flex-wrap">
                  <select className={inp+" text-xs"} value={teamMonthSel.month} onChange={e=>{const m={...teamMonthSel,month:+e.target.value};setTeamMonthSel(m);loadTeamAttendance(employeeToken,currentUser.id,m.month,m.year);}}>
                    {MONTHS.map((mn,i)=><option key={i+1} value={i+1}>{mn}</option>)}
                  </select>
                  <select className={inp+" text-xs"} value={teamMonthSel.year} onChange={e=>{const m={...teamMonthSel,year:+e.target.value};setTeamMonthSel(m);loadTeamAttendance(employeeToken,currentUser.id,m.month,m.year);}}>
                    {Array.from({length:3},(_,i)=>new Date().getFullYear()-i).map(yr=><option key={yr} value={yr}>{yr}</option>)}
                  </select>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-white/60 min-w-max">
                    <thead><tr className="border-b border-white/10">
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Employee</th>
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Present</th>
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Absent</th>
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Leave</th>
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Half Day</th>
                      <th className="text-left py-2 pr-4 text-white/30 font-medium">Hours</th>
                    </tr></thead>
                    <tbody>{myTeam.map(emp=>{
                      const recs=Object.entries(teamAttn).filter(([k])=>k.startsWith(emp.id+"_")).map(([,v])=>v);
                      const present=recs.filter(r=>r.status==="Present").length;
                      const absent=recs.filter(r=>r.status==="Absent").length;
                      const leave=recs.filter(r=>r.status==="Leave"||r.status==="WFH"||r.status==="On Duty").length;
                      const half=recs.filter(r=>r.status==="Half Day").length;
                      const hrs=recs.reduce((s,r)=>s+calcRawHrs(r.inTime,r.outTime),0);
                      return <tr key={emp.id} className="border-b border-white/5 hover:bg-white/5">
                        <td className="py-2 pr-4 font-medium text-white/80">{emp.name}</td>
                        <td className="py-2 pr-4 text-emerald-400">{present}</td>
                        <td className="py-2 pr-4 text-red-400">{absent}</td>
                        <td className="py-2 pr-4 text-amber-400">{leave}</td>
                        <td className="py-2 pr-4 text-yellow-400">{half}</td>
                        <td className="py-2 pr-4">{fmtHrs(hrs)}</td>
                      </tr>;
                    })}</tbody>
                  </table>
                </div>
              </>}

              {teamTab==="members"&&<div className="space-y-2">
                {myTeam.map(emp=>(
                  <div key={emp.id} className="flex items-center gap-3 p-3 bg-white/5 border border-white/10 rounded-xl">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center font-bold text-white text-sm shrink-0">
                      {emp.name[0].toUpperCase()}
                    </div>
                    <div>
                      <p className="text-white text-sm font-medium">{emp.name}</p>
                      <p className="text-white/30 text-xs">{emp.empNum?`#${emp.empNum} · `:""}{emp.jobTitle||emp.dept||"—"}</p>
                    </div>
                    <div className="ml-auto"><ShiftBadge shift={getShiftInfo(null,emp)}/></div>
                  </div>
                ))}
              </div>}
            </div>
          </div>}
        </div>
        {leaveModal&&<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={card+" w-full max-w-sm"}>
            <h2 className="text-white font-bold text-lg mb-4">Apply Leave / Status</h2>
            <label className={lbl}>Type <span className="text-red-400">*</span></label>
            <div className="grid grid-cols-2 gap-2 mb-3 max-h-52 overflow-y-auto pr-1">
              {avLT.map(lt=>(
                <button key={lt.label} onClick={()=>setLeaveForm(p=>({...p,type:lt.label}))}
                  className={`p-2 rounded-xl text-xs text-left border transition-all ${leaveForm.type===lt.label?"bg-indigo-600/30 border-indigo-500/50 text-white":"bg-white/5 border-white/10 text-white/60 hover:bg-white/10"}`}>
                  <p className="text-xs font-bold text-white/40 mb-0.5">{lt.icon}</p>{lt.label}
                </button>
              ))}
            </div>
            {leaveFormErr.type&&<p className="text-red-400 text-xs mb-2">{leaveFormErr.type}</p>}
            <label className={lbl}>Date</label>
            <input type="date" className={inp+" mb-3"} value={leaveForm.date}
              onChange={e=>setLeaveForm(p=>({...p,date:e.target.value}))}/>
            <label className={lbl}>Reason <span className="text-red-400">*</span></label>
            <textarea rows={3} className={`${inp} resize-none mb-1 ${leaveFormErr.reason?"border-red-500":""}`} value={leaveForm.reason}
              onChange={e=>setLeaveForm(p=>({...p,reason:e.target.value}))} placeholder="Enter reason for leave..."/>
            {leaveFormErr.reason&&<p className="text-red-400 text-xs mb-2">{leaveFormErr.reason}</p>}
            {leaveForm.type==="Work From Home"&&<>
              <div className="mb-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                <p className="text-amber-300 text-xs font-medium mb-2">Location is mandatory for Work From Home</p>
                {leaveForm.location
                  ? <p className="text-emerald-400 text-xs">Located: {leaveForm.location}</p>
                  : <button className={btnSec+" w-full text-xs"} onClick={()=>{
                    setLocationStatus("Capturing location...");
                    getLocation((loc,err)=>{
                      if(loc){setLeaveForm(p=>({...p,location:loc}));setLocationStatus("");}
                      else{setLocationStatus("Location access denied — please enable GPS and try again");}
                    });
                  }}>Capture My Location (Required)</button>}
                {locationStatus&&<p className="text-red-400 text-xs mt-1">{locationStatus}</p>}
              </div>
              {leaveFormErr.location&&<p className="text-red-400 text-xs mb-2">{leaveFormErr.location}</p>}
            </>}
            {leaveForm.type==="On Duty"&&<>
              <div className="mb-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-xl">
                <p className="text-purple-300 text-xs font-medium mb-2">Location is mandatory for On Duty</p>
                {leaveForm.location
                  ? <p className="text-emerald-400 text-xs">Located: {leaveForm.location}</p>
                  : <button className={btnSec+" w-full text-xs"} onClick={()=>{
                    setLocationStatus("Capturing location...");
                    getLocation((loc,err)=>{
                      if(loc){setLeaveForm(p=>({...p,location:loc}));setLocationStatus("");}
                      else{setLocationStatus("Location access denied — please enable GPS and try again");}
                    });
                  }}>Capture My Location (Required)</button>}
                {locationStatus&&<p className="text-red-400 text-xs mt-1">{locationStatus}</p>}
              </div>
            </>}
            <div className="flex gap-2 mt-3">
              <button className={btnPri+" flex-1"} onClick={applyLeave}>Submit Application</button>
              <button className={btnSec} onClick={()=>setLeaveModal(false)}>Cancel</button>
            </div>
          </div>
        </div>}
        {showRegModal&&<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className={card+" w-full max-w-sm"}>
            <h2 className="text-white font-bold text-lg mb-1">Request Attendance Correction</h2>
            <p className="text-white/40 text-xs mb-4">Submit if you missed a punch or had an incorrect time recorded.</p>
            <label className={lbl}>Date <span className="text-red-400">*</span></label>
            <input type="date" className={inp+" mb-3"} value={regForm.date} max={TODAY}
              onChange={e=>setRegForm(p=>({...p,date:e.target.value}))}/>
            {regFormErr.date&&<p className="text-red-400 text-xs mb-2">{regFormErr.date}</p>}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div>
                <label className={lbl}>Actual In Time</label>
                <input type="time" className={inp} value={regForm.inTime}
                  onChange={e=>setRegForm(p=>({...p,inTime:e.target.value}))}/>
              </div>
              <div>
                <label className={lbl}>Actual Out Time</label>
                <input type="time" className={inp} value={regForm.outTime}
                  onChange={e=>setRegForm(p=>({...p,outTime:e.target.value}))}/>
              </div>
            </div>
            {regFormErr.inTime&&<p className="text-red-400 text-xs mb-2">{regFormErr.inTime}</p>}
            <label className={lbl}>Reason <span className="text-red-400">*</span></label>
            <textarea rows={3} className={`${inp} resize-none mb-1 ${regFormErr.reason?"border-red-500":""}`}
              value={regForm.reason} onChange={e=>setRegForm(p=>({...p,reason:e.target.value}))}
              placeholder="Explain why regularization is needed..."/>
            {regFormErr.reason&&<p className="text-red-400 text-xs mb-2">{regFormErr.reason}</p>}
            <div className="flex gap-2 mt-3">
              <button className={btnPri+" flex-1"} onClick={submitRegularization}>Submit Request</button>
              <button className={btnSec} onClick={()=>setShowRegModal(false)}>Cancel</button>
            </div>
          </div>
        </div>}
      </div>
    );
  }

  // ===== ADMIN PANEL =====
  const stats=getTodayStats();
  const attnRows=getAttnRows();
  const summaryRows=getSummaryRows();
  const filteredEmps=employees.filter(e=>!empFilter||e.company===empFilter);
  const dbRows=(()=>{
    const q=dbSearch.toLowerCase(); let rows=[];
    if(dbSubTab==="employees") rows=employees.filter(e=>!q||JSON.stringify(e).toLowerCase().includes(q));
    if(dbSubTab==="attendance") rows=Object.values(attendance).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,200).filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q));
    if(dbSubTab==="leaves") rows=[...leaves].sort((a,b)=>b.date.localeCompare(a.date)).filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q));
    if(dbSubTab==="balances"){ Object.entries(leaveBalances).forEach(([eid,types])=>{ const emp=employees.find(e=>e.id===eid);
      Object.entries(types).forEach(([lt,v])=>rows.push({"Employee":emp?.name||eid,"Leave Type":lt,...v})); }); rows=rows.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q)); }
    if(dbSubTab==="audit") rows=auditLogs.filter(r=>!q||JSON.stringify(r).toLowerCase().includes(q));
    return rows;
  })();
  const adminTabs=[
    {id:"dashboard",label:"Dashboard"},
    {id:"attendance",label:"Attendance"},
    {id:"leaves",label:"Leaves"},
    {id:"employees",label:"Employees"},
    {id:"reports",label:"Reports"},
    {id:"database",label:"Database"},
    {id:"settings",label:"Settings"},
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      <div className="bg-gradient-to-r from-indigo-900/40 to-violet-900/40 border-b border-white/10 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">AD</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm">Admin Panel</p>
              <p className="text-white/30 text-xs">HRMS {'\u00B7'} {TODAY}</p>
            </div>
          </div>
          <button className={btnSec+" text-xs"} onClick={adminLogoutHandler}>Logout</button>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-0 flex gap-1 overflow-x-auto">
          {adminTabs.map(t=>(
            <button key={t.id} onClick={()=>setAdminTab(t.id)}
              className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${adminTab===t.id?"border-indigo-400 text-white":"border-transparent text-white/40 hover:text-white/70"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {adminTab==="dashboard"&&<>
          <h2 className="text-white font-bold text-lg">Today's Summary {'\u2014'} {TODAY}</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total Active" value={stats.active} color="indigo" sub="Registered employees"/>
            <StatCard label="Present" value={stats.present} color="emerald" sub="Punched in today"/>
            <StatCard label="Absent" value={stats.absent} color="red" sub="No punch today"/>
            <StatCard label="On Leave" value={stats.leave} color="amber" sub="Approved leave"/>
            <StatCard label="Half Day" value={stats.halfDay} color="yellow" sub="Below std hours"/>
            <StatCard label="WFH" value={stats.wfh} color="cyan" sub="Work from home"/>
            <StatCard label="On Duty" value={stats.onDuty} color="purple" sub="Out on duty"/>
            <StatCard label="Pending" value={stats.pending} color="orange" sub="Leave requests"/>
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Today's Attendance Details</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-white/70 min-w-[700px]">
                <thead><tr className="border-b border-white/10">{["Employee","Emp Code","Dept","Shift","Manager","In","Out","Net Hrs","OT","Status"].map(h=><th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{activeEmps.map(e=>{
                  const r=attendance[`${e.id}_${TODAY}`]||{};
                  const raw=calcRawHrs(r.inTime,r.outTime);
                  const deduct=r.leaveType?(LEAVE_TYPES.find(l=>l.label===r.leaveType)?.deduct||0):0;
                  const net=Math.max(0,raw-deduct);
                  const sh=getShiftInfo(r,e);
                  return <tr key={e.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-white/80">{e.name}</td>
                    <td className="py-2.5 pr-4 text-white/30">{e.empNum||"--"}</td>
                    <td className="py-2.5 pr-4 text-white/30">{e.dept||"--"}</td>
                    <td className="py-2.5 pr-4"><ShiftBadge shift={sh}/></td>
                    <td className="py-2.5 pr-4 text-white/30">{e.manager||"--"}</td>
                    <td className="py-2.5 pr-4 font-mono text-emerald-400">{r.inTime||"--"}</td>
                    <td className="py-2.5 pr-4 font-mono text-red-400">{r.outTime||"--"}</td>
                    <td className="py-2.5 pr-4">{fmtHrs(net)}</td>
                    <td className="py-2.5 pr-4 text-indigo-300">{net>settings.stdHours?fmtHrs(net-settings.stdHours):"--"}</td>
                    <td className="py-2.5"><Badge s={r.status||"Absent"}/></td>
                  </tr>;
                })}</tbody>
              </table>
            </div>
          </div>
        </>}
        {adminTab==="attendance"&&<>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
            <div className={card+" flex flex-col min-h-0"} style={{height:"480px",overflow:"hidden"}}>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">1</span>
                <h3 className="text-white font-semibold text-sm">Import Leave Balance Data</h3>
              </div>
              <p className="text-white/30 text-xs mb-3 flex-shrink-0">Required: Employee Number, Employee Name, Job Title, Business Unit, Department, Sub Department, Location, Cost Center, Reporting Manager + [Leave Type] - Accrued/Consumed/Balance/AnnualQuota/Unit</p>
              <input ref={sheetImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport}/>
              <div className="flex-shrink-0">
              {importedSheet
                ? <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
                  <div><p className="text-emerald-300 text-sm font-medium truncate">{importedSheet.filename}</p><p className="text-white/30 text-xs">{importedSheet.rows?.length} rows {'\u00B7'} {new Date(importedSheet.importedAt).toLocaleDateString()}</p></div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className={btnSec+" text-xs py-1 px-2"} onClick={()=>sheetImportRef.current?.click()}>Re-import</button>
                    <button className={btnDanger+" py-1 px-2"} onClick={removeSheet}>Remove</button>
                  </div>
                </div>
                : <button className={btnPri+" text-xs mb-2 w-full"} onClick={()=>sheetImportRef.current?.click()}>Choose Excel File</button>}
              {importStatus&&<p className={`text-xs mb-2 ${importStatus.startsWith("Imported")?"text-emerald-400":importStatus.startsWith("Loading")?"text-blue-400":"text-red-400"}`}>{importStatus}</p>}
              </div>
              {importedSheet?.rows?.length>0&&<div className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-2 mb-2 flex-wrap flex-shrink-0">
                  <input className={inp+" flex-1 text-xs"} placeholder="Search sheet..." value={sheetSearch} onChange={e=>setSheetSearch(e.target.value)}/>
                  <button className={btnSec+" text-xs"} onClick={exportSheet}>Export</button>
                </div>
                <div className="overflow-auto flex-1 border border-white/10 rounded-xl">
                  <table className="text-xs text-white/60 min-w-max">
                    <thead className="sticky top-0 bg-slate-900">
                      <tr>{importedSheet.cols.map(c=><th key={c} className="px-3 py-2 text-white/30 text-left border-b border-white/10 whitespace-nowrap">{c}</th>)}<th className="px-3 py-2 border-b border-white/10"></th></tr>
                    </thead>
                    <tbody>
                      {importedSheet.rows.filter(r=>!sheetSearch||Object.values(r).some(v=>String(v).toLowerCase().includes(sheetSearch.toLowerCase()))).map((r,ri)=>(
                        <tr key={ri} className="border-b border-white/5 hover:bg-white/5">
                          {importedSheet.cols.map(c=>{ const cid=`${ri}_${c}`;
                            return <td key={c} className="px-3 py-1.5 whitespace-nowrap cursor-pointer" onClick={()=>{setSheetEditCell(cid);setSheetEditVal(String(r[c]||"")); }}>
                              {sheetEditCell===cid
                                ? <input autoFocus className="bg-white/10 border border-indigo-400 rounded px-1 text-white text-xs w-24" value={sheetEditVal}
                                    onChange={e=>setSheetEditVal(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter"){ const newRows=importedSheet.rows.map((row,i)=>i===ri?{...row,[c]:sheetEditVal}:row); persistImportedSheet({...importedSheet,rows:newRows}); } setSheetEditCell(null); }}
                                    onBlur={()=>setSheetEditCell(null)}/>
                                : String(r[c]||"")}
                            </td>; })}
                          <td className="px-3 py-1.5"><button className="text-red-400 hover:text-red-300 text-xs" onClick={()=>{ const newRows=importedSheet.rows.filter((_,i)=>i!==ri); persistImportedSheet({...importedSheet,rows:newRows}); }}>x</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>}
            </div>
            <div className={card+" flex flex-col min-h-0"} style={{height:"480px",overflow:"hidden"}}>
              <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-600 to-blue-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">2</span>
                <h3 className="text-white font-semibold text-sm">Import Daily Bio Data</h3>
              </div>
              <p className="text-white/30 text-xs mb-3 flex-shrink-0">Export from a biometric attendance device for a single day — arrival/departure times, late hours, shift, temperature checks, etc.</p>
              <input ref={bioImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleBioImport}/>
              <div className="flex-shrink-0">
              {bioSheet
                ? <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
                  <div><p className="text-emerald-300 text-sm font-medium truncate">{bioSheet.filename}</p><p className="text-white/30 text-xs">{bioSheet.rows?.length||0} rows {bioSheet.synced!==undefined?`\u00B7 ${bioSheet.synced} synced \u00B7 ${bioSheet.skipped} skipped`:""}</p></div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className={btnSec+" text-xs py-1 px-2"} onClick={()=>bioImportRef.current?.click()}>Re-import</button>
                    <button className={btnSec+" text-xs py-1 px-2"} onClick={exportBioSheet}>Export</button>
                    <button className={btnDanger+" py-1 px-2"} onClick={removeBioSheet}>Remove</button>
                  </div>
                </div>
                : <button className={btnPri+" text-xs mb-2 w-full"} onClick={()=>bioImportRef.current?.click()}>Choose Excel File</button>}
              {bioImportStatus&&<p className={`text-xs mb-2 ${bioImportStatus.startsWith("Synced")?"text-emerald-400":bioImportStatus.startsWith("Reading")||bioImportStatus.startsWith("Parsed")?"text-blue-400":"text-red-400"}`}>{bioImportStatus}</p>}
              {bioSyncLog.length>0&&<button className={btnSec+" text-xs py-1 px-2 mb-2"} onClick={()=>setShowBioLog(s=>!s)}>{showBioLog?"Hide":"Show"} Log ({bioSyncLog.length})</button>}
              {showBioLog&&bioSyncLog.length>0&&<div className="max-h-24 overflow-y-auto border border-white/10 rounded-xl p-2 mb-2 space-y-0.5 flex-shrink-0">
                {bioSyncLog.map((l,i)=><p key={i} className={`text-xs font-mono py-0.5 ${l.type==="ok"?"text-emerald-400/80":"text-red-400/80"}`}>{l.type==="ok"?"OK ":"SKIP "}{l.msg}</p>)}
              </div>}
              </div>
              {bioSheet?.rows?.length>0&&<div className="flex flex-col flex-1 min-h-0">
                <input className={inp+" text-xs mb-1 flex-shrink-0"} placeholder="Search..." value={bioSearch} onChange={e=>setBioSearch(e.target.value)}/>
                <div className="overflow-auto flex-1 border border-white/10 rounded-xl">
                  <table className="text-xs text-white/60 min-w-max">
                    <thead className="sticky top-0 bg-slate-900"><tr>{(bioSheet.cols||[]).map(c=><th key={c} className="px-2 py-1.5 text-white/30 text-left border-b border-white/10 whitespace-nowrap">{c}</th>)}</tr></thead>
                    <tbody>
                      {bioSheet.rows.filter(r=>!bioSearch||Object.values(r).some(v=>String(v).toLowerCase().includes(bioSearch.toLowerCase()))).slice(0,200).map((r,ri)=>(
                        <tr key={ri} className="border-b border-white/5 hover:bg-white/5">
                          {(bioSheet.cols||[]).map(c=><td key={c} className={`px-2 py-1 whitespace-nowrap ${bioSheetCellColor(c,r[c])}`}>{String(r[c]||"")}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>}
            </div>
            <div className={card+" flex flex-col min-h-0"} style={{height:"480px",overflow:"hidden"}}>
              <div className="flex items-center gap-2 mb-1 flex-shrink-0">
                <span className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-600 to-fuchsia-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">3</span>
                <h3 className="text-white font-semibold text-sm">Import Monthly Bio Data</h3>
              </div>
              <p className="text-white/30 text-xs mb-3 flex-shrink-0">A whole month's attendance grid per employee (MnPerformance format) — each employee spans several rows, one per metric, with a column per day.</p>
              <input ref={monthlyImportRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleMonthlyImport}/>
              <div className="flex-shrink-0">
              {monthlySheet
                ? <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-3 flex items-start justify-between gap-2">
                  <div><p className="text-emerald-300 text-sm font-medium truncate">{monthlySheet.filename}</p><p className="text-white/30 text-xs">{MONTHS[(monthlySheet.reportMonth||1)-1]} {monthlySheet.reportYear} {monthlySheet.synced!==undefined?`\u00B7 ${monthlySheet.synced} day-records \u00B7 ${monthlySheet.skipped} skipped`:""}</p></div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className={btnSec+" text-xs py-1 px-2"} onClick={()=>monthlyImportRef.current?.click()}>Re-import</button>
                    <button className={btnDanger+" py-1 px-2"} onClick={removeMonthlySheet}>Remove</button>
                  </div>
                </div>
                : <button className={btnPri+" text-xs mb-2 w-full"} onClick={()=>monthlyImportRef.current?.click()}>Choose Excel File</button>}
              {monthlyImportStatus&&<p className={`text-xs mb-2 ${monthlyImportStatus.startsWith("Synced")?"text-emerald-400":monthlyImportStatus.startsWith("Reading")?"text-blue-400":"text-red-400"}`}>{monthlyImportStatus}</p>}
              {monthlySyncLog.length>0&&<button className={btnSec+" text-xs py-1 px-2"} onClick={()=>setShowMonthlyLog(s=>!s)}>{showMonthlyLog?"Hide":"Show"} Log ({monthlySyncLog.length})</button>}
              {showMonthlyLog&&monthlySyncLog.length>0&&<div className="max-h-24 overflow-y-auto border border-white/10 rounded-xl p-2 mt-2 space-y-0.5">
                {monthlySyncLog.map((l,i)=><p key={i} className={`text-xs font-mono py-0.5 ${l.type==="ok"?"text-emerald-400/80":"text-red-400/80"}`}>{l.type==="ok"?"OK ":"SKIP "}{l.msg}</p>)}
              </div>}
              </div>
            </div>
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Filters</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <select className={inp} value={attnFilters.company} onChange={e=>setAttnFilters(p=>({...p,company:e.target.value,empId:""}))}>
                <option value="">All Companies</option>{COMPANIES.map(c=><option key={c} value={c}>{c}</option>)}
              </select>
              <select className={inp} value={attnFilters.location} onChange={e=>setAttnFilters(p=>({...p,location:e.target.value}))}>
                <option value="">All Locations</option>{uniqueLocations.map(l=><option key={l} value={l}>{l}</option>)}
              </select>
              {!attnFilters.customRange&&<select className={inp} value={attnFilters.month} onChange={e=>setAttnFilters(p=>({...p,month:+e.target.value}))}>
                {MONTHS.map((mn,i)=><option key={i+1} value={i+1}>{mn}</option>)}
              </select>}
              {!attnFilters.allSummary&&<select className={inp} value={attnFilters.empId} onChange={e=>setAttnFilters(p=>({...p,empId:e.target.value}))}>
                <option value="">All Employees</option>
                {employees.filter(e=>(!attnFilters.company||e.company===attnFilters.company)&&(!attnFilters.location||e.locationInfo===attnFilters.location))
                  .map(e=><option key={e.id} value={e.id}>{e.name}{e.locationInfo?` [${e.locationInfo}]`:""}</option>)}
              </select>}
            </div>
            {!attnFilters.customRange&&<div className="flex gap-1 flex-wrap items-center mb-3">
              <span className="text-white/30 text-xs mr-1">Year:</span>
              {availYears.map(y=><button key={y} onClick={()=>setAttnFilters(p=>({...p,year:y}))} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${attnFilters.year===y?"bg-indigo-600 text-white":"bg-white/5 text-white/40 hover:bg-white/10 border border-white/10"}`}>{y}</button>)}
              <button className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg hover:bg-indigo-500/10 transition-all" onClick={()=>setAvailYears(p=>[...p,Math.max(...p)+1])}>+ Next</button>
              <button className="text-xs text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg hover:bg-indigo-500/10 transition-all" onClick={()=>setAvailYears(p=>[Math.min(...p)-1,...p])}>+ Earlier</button>
            </div>}
            <div className="flex gap-4 flex-wrap items-center mb-2">
              <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={attnFilters.customRange} onChange={e=>setAttnFilters(p=>({...p,customRange:e.target.checked}))} className="accent-indigo-500 w-3.5 h-3.5"/>Custom Range</label>
              <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={attnFilters.allSummary} onChange={e=>setAttnFilters(p=>({...p,allSummary:e.target.checked,monthlyDetail:false}))} className="accent-indigo-500 w-3.5 h-3.5"/>All Employees Summary</label>
              <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={attnFilters.monthlyDetail} onChange={e=>setAttnFilters(p=>({...p,monthlyDetail:e.target.checked,allSummary:false}))} className="accent-violet-500 w-3.5 h-3.5"/>Monthly Detail (Employee)</label>
              <div className="flex items-center gap-1"><span className="text-white/30 text-xs">Std hrs:</span><input type="number" min="1" max="24" value={settings.stdHours} onChange={async e=>{ const v=+e.target.value; setSettings(s=>({...s,stdHours:v})); try { await adminUpdateSettings(adminToken, v); } catch(err){ console.error(err); } }} className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white text-xs w-16"/></div>
            </div>
            {attnFilters.customRange&&<div className="flex gap-2"><input type="date" className={inp} value={attnFilters.from} onChange={e=>setAttnFilters(p=>({...p,from:e.target.value}))}/><input type="date" className={inp} value={attnFilters.to} onChange={e=>setAttnFilters(p=>({...p,to:e.target.value}))}/></div>}
            {(attnFilters.company||attnFilters.location)&&<div className="flex gap-2 flex-wrap mt-2">
              {attnFilters.company&&<span className="flex items-center gap-1 bg-indigo-600/20 text-indigo-300 text-xs px-2.5 py-1 rounded-full border border-indigo-500/30">{attnFilters.company.split(" ")[0]} <button onClick={()=>setAttnFilters(p=>({...p,company:""}))} className="hover:text-white ml-1">x</button></span>}
              {attnFilters.location&&<span className="flex items-center gap-1 bg-cyan-600/20 text-cyan-300 text-xs px-2.5 py-1 rounded-full border border-cyan-500/30">{attnFilters.location} <button onClick={()=>setAttnFilters(p=>({...p,location:""}))} className="hover:text-white ml-1">x</button></span>}
            </div>}
          </div>
          <div className={card}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <span className="text-white/50 text-xs">{attnRows.length} records</span>
              </div>
              <div className="flex gap-2">
                <button className={btnPri+" text-xs"} onClick={()=>exportDailyRecords("xlsx")}>Export XLSX</button>
                <button className={btnSec+" text-xs"} onClick={()=>exportDailyRecords("csv")}>Export CSV</button>
              </div>
            </div>
          </div>
          {attnFilters.allSummary
            ? <div className={card}>
              <h3 className="text-white font-semibold mb-3">All Employees Summary</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-white/70 min-w-[700px]">
                  <thead><tr className="border-b border-white/10">{["Employee","Company","Shift","Present","Half Day","Leave","Absent","WFH","On Duty","Hours","OT"].map(h=><th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{summaryRows.map(r=>{ const emp=employees.find(e=>e.id===r.empId)||{};
                    const sh=getShiftInfo(null,emp);
                    return <tr key={r.empId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2 pr-4"><button className="text-indigo-400 hover:text-indigo-300 hover:underline" onClick={()=>setAttnFilters(p=>({...p,allSummary:false,monthlyDetail:true,empId:r.empId}))}>{emp.name}</button></td>
                      <td className="py-2 pr-4 text-white/30">{emp.company?.split(" ")[0]}</td>
                      <td className="py-2 pr-4"><ShiftBadge shift={sh}/></td>
                      <td className="py-2 pr-4 text-emerald-400 font-medium">{r.present}</td>
                      <td className="py-2 pr-4 text-yellow-400">{r.halfDay}</td>
                      <td className="py-2 pr-4 text-amber-400">{r.leave}</td>
                      <td className="py-2 pr-4 text-red-400">{r.absent}</td>
                      <td className="py-2 pr-4 text-indigo-400">{r.wfh}</td>
                      <td className="py-2 pr-4 text-purple-400">{r.onDuty}</td>
                      <td className="py-2 pr-4">{fmtHrs(r.hrs)}</td>
                      <td className="py-2 pr-4 text-emerald-400">{r.ot>0?fmtHrs(r.ot):"--"}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {summaryRows.length===0&&<p className="text-white/30 text-center py-8">No records</p>}
              </div>
            </div>
            : attnFilters.monthlyDetail
            ? <div className={card}>
              <div className="flex items-center gap-2 mb-4 flex-wrap">
                <h3 className="text-white font-semibold flex-1">Monthly Detail</h3>
                <select className={inp+" text-xs"} value={attnFilters.empId} onChange={e=>setAttnFilters(p=>({...p,empId:e.target.value}))}>
                  <option value="">Select Employee</option>
                  {employees.filter(e=>!attnFilters.company||e.company===attnFilters.company).map(e=><option key={e.id} value={e.id}>{e.name} ({e.empNum||"--"})</option>)}
                </select>
                <select className={inp+" text-xs"} value={attnFilters.month} onChange={e=>setAttnFilters(p=>({...p,month:+e.target.value}))}>
                  {MONTHS.map((mn,i)=><option key={i+1} value={i+1}>{mn}</option>)}
                </select>
                <select className={inp+" text-xs"} value={attnFilters.year} onChange={e=>setAttnFilters(p=>({...p,year:+e.target.value}))}>
                  {Array.from({length:4},(_,i)=>new Date().getFullYear()-i).map(yr=><option key={yr} value={yr}>{yr}</option>)}
                </select>
              </div>
              {attnFilters.empId?(()=>{
                const selEmp=employees.find(e=>e.id===attnFilters.empId)||{};
                const mth=attnFilters.month, yr=attnFilters.year;
                const daysInMonth=new Date(yr,mth,0).getDate();
                const firstDay=new Date(yr,mth-1,1).getDay();
                const mthSummary=getMonthlySummary(attnFilters.empId,mth,yr);
                const empBal=leaveBalances[attnFilters.empId]||{};
                return <>
                  <div className="flex items-center gap-3 mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white text-sm">{(selEmp.name||"?")[0].toUpperCase()}</div>
                    <div>
                      <p className="text-white font-semibold">{selEmp.name}</p>
                      <p className="text-white/40 text-xs">{selEmp.empNum} · {selEmp.dept||"--"} · {selEmp.company?.split(" ")[0]}</p>
                    </div>
                    <div className="ml-auto"><ShiftBadge shift={getShiftInfo(null,selEmp)}/></div>
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-3 text-center text-white/30 text-xs font-medium">
                    {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d=><span key={d}>{d}</span>)}
                  </div>
                  <div className="grid grid-cols-7 gap-1 mb-4">
                    {Array(firstDay).fill(null).map((_,i)=><div key={i}/>)}
                    {Array.from({length:daysInMonth},(_,i)=>i+1).map(d=>{
                      const dateStr=`${yr}-${fmt2(mth)}-${fmt2(d)}`;
                      const rec=attendance[`${attnFilters.empId}_${dateStr}`]||{};
                      const st=rec.status||calcStatus(rec,settings.stdHours);
                      const isToday=dateStr===TODAY;
                      const isFuture=dateStr>TODAY;
                      const isWeekend=new Date(yr,mth-1,d).getDay()===0||new Date(yr,mth-1,d).getDay()===6;
                      const holiday=holidays.find(h=>h.date===dateStr);
                      let bg="bg-white/5",tc="text-white/40",bc="border-white/10";
                      if(holiday){bg="bg-amber-500/15";tc="text-amber-300";bc="border-amber-500/20";}
                      else if(isWeekend&&!rec.inTime){bg="bg-white/3";tc="text-white/20";bc="border-white/5";}
                      else if(!isFuture){
                        if(st==="Present"){bg="bg-emerald-500/15";tc="text-emerald-300";bc="border-emerald-500/20";}
                        else if(st==="Half Day"){bg="bg-yellow-500/15";tc="text-yellow-300";bc="border-yellow-500/20";}
                        else if(st==="Leave"||st==="WFH"||st==="On Duty"){bg="bg-indigo-500/15";tc="text-indigo-300";bc="border-indigo-500/20";}
                        else if(st==="Absent"&&!isWeekend){bg="bg-red-500/10";tc="text-red-400/80";bc="border-red-500/15";}
                      }
                      return <div key={d} className={`${bg} border ${bc} rounded-lg p-1 text-center ${isToday?"ring-1 ring-indigo-400":""}`}
                        title={`${dateStr}${rec.inTime?` | In: ${rec.inTime}`:""}${rec.outTime?` Out: ${rec.outTime}`:""}${holiday?` | ${holiday.name}`:""}`}>
                        <p className={`text-xs font-bold ${tc}`}>{d}</p>
                        {holiday&&<p className="text-amber-400/60 text-[8px] leading-tight truncate">{holiday.name.split(" ")[0]}</p>}
                        {!isFuture&&!holiday&&rec.inTime&&<p className="text-white/20 text-[8px] font-mono">{rec.inTime}</p>}
                        {!isFuture&&!holiday&&!isWeekend&&!rec.inTime&&<p className={`text-[8px] ${tc}`}>{st==="Leave"?"L":st==="Absent"?"A":""}</p>}
                      </div>;
                    })}
                  </div>
                  <div className="grid grid-cols-4 gap-2 mb-4">
                    {[["Present",mthSummary.present,"emerald"],["Half Day",mthSummary.halfDay,"yellow"],["Leave",mthSummary.leave,"amber"],["Absent",mthSummary.absent,"red"],["WFH",mthSummary.wfh,"indigo"],["On Duty",mthSummary.onDuty,"purple"],["Hours",fmtHrs(mthSummary.totalHrs),"blue"],["OT",fmtHrs(mthSummary.otHrs),"green"]].map(([k,v,c])=>(
                      <div key={k} className={`bg-${c}-500/10 border border-${c}-500/20 rounded-xl p-2 text-center`}>
                        <p className={`text-${c}-300 text-lg font-bold`}>{v}</p>
                        <p className={`text-${c}-400/60 text-xs`}>{k}</p>
                      </div>
                    ))}
                  </div>
                  {Object.keys(empBal).length>0&&<>
                    <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-3">Leave Balances (Current FY)</p>
                    <div className="space-y-2">
                      {Object.entries(empBal).map(([lt,v])=>{
                        const pct=v.quota>0?Math.min(100,(v.balance/v.quota)*100):0;
                        const low=v.balance<=1&&v.quota>0;
                        return <div key={lt} className={`p-3 rounded-xl border ${low?"bg-red-500/5 border-red-500/20":"bg-white/5 border-white/10"}`}>
                          <div className="flex items-center justify-between mb-1">
                            <p className={`text-xs font-medium ${low?"text-red-300":"text-white/80"}`}>{lt}</p>
                            <span className={`text-sm font-bold ${low?"text-red-300":"text-white"}`}>{v.balance}<span className="text-white/30 text-xs font-normal">/{v.quota}</span></span>
                          </div>
                          <div className="w-full bg-white/10 rounded-full h-1">
                            <div className={`h-1 rounded-full ${low?"bg-red-400":"bg-gradient-to-r from-indigo-500 to-violet-500"}`} style={{width:`${pct}%`}}/>
                          </div>
                          <div className="flex justify-between mt-1">
                            <span className="text-white/20 text-xs">{v.consumed} used</span>
                            <span className={`text-xs ${low?"text-red-400":"text-emerald-400"}`}>{v.balance} left</span>
                          </div>
                        </div>;
                      })}
                    </div>
                  </>}
                </>;
              })():<p className="text-white/30 text-center py-8">Select an employee to view monthly detail</p>}
            </div>
            : <div className={card}>
              <h3 className="text-white font-semibold mb-3">Daily Records</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-white/70 min-w-max">
                  <thead><tr className="border-b border-white/10">{["Date","Emp Code","Name","Dept","Designation","Manager","Company","Shift","In Time","Out Time","Raw Hrs","Net Hrs","OT","Status","Leave Type","Reason","In Location","Out Location"].map(h=><th key={h} className="text-left py-2.5 pr-3 text-white/30 font-medium uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody>{attnRows.map(r=>{
                    const emp=employees.find(e=>e.id===r.empId)||{};
                    const raw=calcRawHrs(r.inTime,r.outTime);
                    const lt=r.leaveType?LEAVE_TYPES.find(l=>l.label===r.leaveType):null;
                    const deduct=lt?.deduct||0;
                    const net=Math.max(0,raw-deduct);
                    const aKey=`${r.empId}_${r.date}`;
                    const sh=getShiftInfo(r,emp);
                    return <tr key={aKey} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                      <td className="py-2 pr-3 font-mono text-white/50 whitespace-nowrap">{r.date}</td>
                      <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{emp.empNum||"--"}</td>
                      <td className="py-2 pr-3 font-medium text-white/80 whitespace-nowrap">{emp.name}</td>
                      <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{emp.dept||"--"}</td>
                      <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{r.designation||emp.jobTitle||"--"}</td>
                      <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{emp.manager||"--"}</td>
                      <td className="py-2 pr-3 text-white/30 whitespace-nowrap">{emp.company?.split(" ")[0]}</td>
                      <td className="py-2 pr-3 whitespace-nowrap"><ShiftBadge shift={sh}/></td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {editingCell===aKey+"_in"
                          ? <input autoFocus type="time" className="bg-white/10 border border-indigo-400 rounded-lg px-1.5 py-0.5 text-white text-xs w-24" value={editVal}
                              onChange={e=>setEditVal(e.target.value)}
                              onBlur={()=>{editAttnCell(aKey,"inTime",editVal);setEditingCell(null);}}
                              onKeyDown={e=>{if(e.key==="Enter"){editAttnCell(aKey,"inTime",editVal);setEditingCell(null);}if(e.key==="Escape")setEditingCell(null);}}/>
                          : <span className="cursor-pointer text-emerald-400 hover:text-emerald-300 font-mono" onClick={()=>{setEditingCell(aKey+"_in");setEditVal(r.inTime||"");}}>{r.inTime||"--"}</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {editingCell===aKey+"_out"
                          ? <input autoFocus type="time" className="bg-white/10 border border-indigo-400 rounded-lg px-1.5 py-0.5 text-white text-xs w-24" value={editVal}
                              onChange={e=>setEditVal(e.target.value)}
                              onBlur={()=>{editAttnCell(aKey,"outTime",editVal);setEditingCell(null);}}
                              onKeyDown={e=>{if(e.key==="Enter"){editAttnCell(aKey,"outTime",editVal);setEditingCell(null);}if(e.key==="Escape")setEditingCell(null);}}/>
                          : <span className="cursor-pointer text-red-400 hover:text-red-300 font-mono" onClick={()=>{setEditingCell(aKey+"_out");setEditVal(r.outTime||"");}}>{r.outTime||"--"}</span>}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">{fmtHrs(raw)}</td>
                      <td className="py-2 pr-3 font-medium text-white/80 whitespace-nowrap">{fmtHrs(net)}</td>
                      <td className="py-2 pr-3 text-indigo-300 whitespace-nowrap">{net>settings.stdHours?fmtHrs(net-settings.stdHours):"--"}</td>
                      <td className="py-2 pr-3 whitespace-nowrap"><Badge s={r.status||"Absent"}/></td>
                      <td className="py-2 pr-3 text-white/30 text-xs whitespace-nowrap">{r.leaveType||""}</td>
                      <td className="py-2 pr-3 text-white/30 text-xs truncate max-w-[140px]">{r.leaveReason||""}</td>
                      <td className="py-2 pr-3 text-purple-400/70 text-xs truncate max-w-[120px]">{r.inLocation||""}</td>
                      <td className="py-2 pr-3 text-purple-400/70 text-xs truncate max-w-[120px]">{r.outLocation||""}</td>
                    </tr>;
                  })}</tbody>
                </table>
                {attnRows.length===0&&<p className="text-white/30 text-center py-8">No records found</p>}
              </div>
            </div>}
        </>}
        {adminTab==="leaves"&&<>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Attendance Correction Requests
              {adminRegs.filter(r=>r.status==="Pending").length>0&&
                <span className="ml-2 bg-violet-500/20 text-violet-300 text-xs px-2 py-0.5 rounded-full border border-violet-500/30">{adminRegs.filter(r=>r.status==="Pending").length} pending</span>}
            </h3>
            {adminRegs.length===0
              ? <p className="text-white/30 text-sm text-center py-4">No correction requests yet</p>
              : adminRegs.map(r=>{
                const emp=employees.find(e=>e.id===r.emp_id)||{};
                return <div key={r.id} className="bg-white/5 rounded-xl p-4 mb-2 border border-white/10">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-white font-medium">{r.emp_name||emp.name} <span className="text-white/30 text-xs">({r.emp_num||emp.empNum})</span></p>
                      <p className="text-white/50 text-sm">{r.date} · <span className="font-mono">{r.requested_in||"--:--"} — {r.requested_out||"--:--"}</span></p>
                      <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                      <p className="text-white/20 text-xs mt-1">Manager: {emp.manager||"—"}</p>
                    </div>
                    <div className="flex flex-col gap-1 shrink-0">
                      {r.status==="Pending"
                        ? <>
                          <button className={btnPri+" text-xs py-1 px-3"} onClick={()=>adminDecideReg(r.id,"Approved")}>Approve</button>
                          <button className={btnDanger+" text-xs py-1 px-3"} onClick={()=>adminDecideReg(r.id,"Rejected")}>Reject</button>
                        </>
                        : <span className={`text-xs px-2 py-1 rounded-full font-semibold ${r.status==="Approved"?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>{r.status}</span>}
                    </div>
                  </div>
                </div>;
              })
            }
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Pending Requests <span className="ml-2 bg-orange-500/20 text-orange-300 text-xs px-2 py-0.5 rounded-full border border-orange-500/30">{leaves.filter(l=>l.status==="Pending").length}</span></h3>
            {leaves.filter(l=>l.status==="Pending").length===0
              ? <div className="text-center py-8"><p className="text-white/30">All caught up {'\u2014'} no pending requests</p></div>
              : leaves.filter(l=>l.status==="Pending").map(l=>(
                <div key={l.id} className="bg-white/5 rounded-xl p-4 mb-2 border border-white/10 hover:border-white/20 transition-all">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-white font-semibold">{l.empName}</span>
                        <span className="text-white/30">{'\u00B7'}</span>
                        <span className="text-indigo-300 text-sm">{l.leaveType}</span>
                      </div>
                      <p className="text-white/40 text-xs">{l.date} {'\u00B7'} {l.company?.split(" ")[0]}</p>
                      <p className="text-white/60 text-xs mt-1 italic">"{l.reason}"</p>
                    </div>
                    <div className="flex gap-2">
                      <button className={btnSuccess} onClick={()=>approveLeave(l.id,"approve")}>Approve</button>
                      <button className={btnDanger} onClick={()=>approveLeave(l.id,"reject")}>Reject</button>
                    </div>
                  </div>
                </div>
              ))}
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">All Applications</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-white/70 min-w-[600px]">
                <thead><tr className="border-b border-white/10">{["Employee","Company","Type","Date","Reason","Status"].map(h=><th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
                <tbody>{[...leaves].sort((a,b)=>b.date.localeCompare(a.date)).map(l=>(
                  <tr key={l.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 pr-4 text-white/80">{l.empName}</td>
                    <td className="py-2 pr-4 text-white/30">{l.company?.split(" ")[0]}</td>
                    <td className="py-2 pr-4">{l.leaveType}</td>
                    <td className="py-2 pr-4 font-mono">{l.date}</td>
                    <td className="py-2 pr-4 max-w-[150px] truncate text-white/40">{l.reason}</td>
                    <td className="py-2"><span className={`px-2 py-1 rounded-full text-xs border ${l.status==="Approved"?"bg-emerald-500/20 text-emerald-300 border-emerald-500/30":l.status==="Rejected"?"bg-red-500/20 text-red-300 border-red-500/30":"bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>{l.status}</span></td>
                  </tr>
                ))}</tbody>
              </table>
              {leaves.length===0&&<p className="text-white/30 text-center py-8">No leave applications</p>}
            </div>
          </div>
        </>}
        {adminTab==="employees"&&<>
          <div className={card}>
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h3 className="text-white font-semibold">Employees <span className="text-white/30 text-sm font-normal ml-1">({filteredEmps.length})</span></h3>
              <div className="flex gap-2 flex-wrap">
                <select className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-xs" value={empFilter} onChange={e=>setEmpFilter(e.target.value)}>
                  <option value="">All Companies</option>{COMPANIES.map(c=><option key={c} value={c}>{c}</option>)}
                </select>
                <button className={btnPri+" text-xs"} onClick={()=>setEmpForm({name:"",pin:"",company:COMPANIES[0],empNum:"",jobTitle:"",bu:"",dept:"",subDept:"",locationInfo:"",costCenter:"",manager:"",managerEmpId:"",email:"",phone:"",joiningDate:""})}>+ Add Employee</button>
              </div>
            </div>
            {empForm&&<div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 mb-4">
              <h4 className="text-white font-medium mb-3">{empForm.id?"Edit":"New"} Employee</h4>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[["name","Full Name*"],["pin","PIN*"],["empNum","Emp Number"],["jobTitle","Job Title"],["dept","Department"],["subDept","Sub Dept"],["bu","Business Unit"],["locationInfo","Location"],["costCenter","Cost Center"],["email","Email"],["phone","Phone"],["joiningDate","Joining Date","date"]].map(([k,l,t])=>(
                  <div key={k}><label className={lbl}>{l}</label><input type={t||"text"} className={inp} value={empForm[k]||""} onChange={e=>setEmpForm(p=>({...p,[k]:e.target.value}))}/></div>
                ))}
                <div><label className={lbl}>Company*</label><select className={inp} value={empForm.company} onChange={e=>setEmpForm(p=>({...p,company:e.target.value,managerEmpId:"",manager:""}))}>{COMPANIES.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
                <div>
                  <label className={lbl}>Reporting Manager</label>
                  <select className={inp} value={empForm.managerEmpId||""}
                    onChange={e=>{
                      const mgr=employees.find(x=>x.id===e.target.value);
                      setEmpForm(p=>({...p,managerEmpId:e.target.value,manager:mgr?mgr.name:""}));
                    }}>
                    <option value="">— No Manager —</option>
                    {employees
                      .filter(e=>e.active && e.company===empForm.company && e.id!==empForm.id)
                      .sort((a,b)=>a.name.localeCompare(b.name))
                      .map(e=><option key={e.id} value={e.id}>{e.name}{e.jobTitle?` (${e.jobTitle})`:""}</option>)}
                  </select>
                </div>
                <div><label className={lbl}>Shift Type</label>
                  <select className={inp} value={empForm.shiftType||"none"} onChange={e=>setEmpForm(p=>({...p,shiftType:e.target.value}))}>
                    {SHIFTS.map(s=><option key={s.id} value={s.id}>{s.label}{s.start?` (${s.start}–${s.end})`:""}</option>)}
                  </select>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                <button className={btnPri+" text-xs"} onClick={()=>saveEmployee(empForm)}>Save Employee</button>
                <button className={btnSec+" text-xs"} onClick={()=>setEmpForm(null)}>Cancel</button>
              </div>
            </div>}
            <div className="space-y-2">
              {filteredEmps.length===0
                ? <div className="text-center py-10"><p className="text-white/30">No employees yet</p></div>
                : filteredEmps.map(e=>(
                  <div key={e.id} className={`bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-all flex items-center justify-between flex-wrap gap-2 ${!e.active?"opacity-40":""}`}>
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl ${e.active?"bg-gradient-to-br from-indigo-500/30 to-violet-500/30":"bg-white/5"} flex items-center justify-center font-bold text-white/60 text-sm`}>{e.name.charAt(0).toUpperCase()}</div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white text-sm font-medium">{e.name}</p>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${e.active?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>{e.active?"Active":"Inactive"}</span>
                          <ShiftBadge shift={getShiftInfo(null,e)}/>
                        </div>
                        <p className="text-white/30 text-xs">{e.empNum&&`#${e.empNum} \u00B7 `}{e.company?.split(" ")[0]} {'\u00B7'} {e.dept||"\u2014"} {'\u00B7'} PIN: {e.pin}</p>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-wrap">
                      <button className={btnSec+" text-xs"} onClick={()=>setEmpForm({...e})}>Edit</button>
                      <button className={btnSec+" text-xs"} onClick={()=>{
                        const bal = leaveBalances[e.id] || {};
                        const editorBal = {};
                        LEAVE_TYPES.filter(lt=>!lt.label.includes("Partial")).forEach(lt=>{
                          editorBal[lt.label] = bal[lt.label] ? {...bal[lt.label]} : { accrued:0, consumed:0, balance:0, quota:0, unit:"Days" };
                        });
                        setLeaveBalEditor({ empId: e.id, empName: e.name, balances: editorBal });
                      }}>Leave Bal</button>
                      <button className={e.active?btnWarning:btnSuccess} onClick={()=>toggleEmpStatus(e.id)}>{e.active?"Deactivate":"Restore"}</button>
                      <button className={btnDanger} onClick={()=>deleteEmp(e.id)}>Delete</button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </>}
        {adminTab==="reports"&&<div className={card+" space-y-5"}>
          <h3 className="text-white font-semibold text-lg">Reports</h3>
          {reportMsg&&<div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 text-yellow-300 text-sm">{reportMsg}</div>}
          <div className="border border-white/10 rounded-2xl p-4 space-y-3">
            <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide">Single Day</h4>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[140px]"><label className={lbl}>Date</label><input type="date" className={inp} value={reportDate} onChange={e=>setReportDate(e.target.value)}/></div>
              <button className={btnPri+" text-xs"} onClick={()=>exportReport("xlsx",reportDate,reportDate)}>Export XLSX</button>
              <button className={btnSec+" text-xs"} onClick={()=>exportReport("csv",reportDate,reportDate)}>Export CSV</button>
            </div>
          </div>
          <div className="border border-white/10 rounded-2xl p-4 space-y-3">
            <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide">Date Range</h4>
            <div className="flex gap-2 flex-wrap items-end">
              <div className="flex-1 min-w-[140px]"><label className={lbl}>From</label><input type="date" className={inp} value={reportFrom} onChange={e=>setReportFrom(e.target.value)}/></div>
              <div className="flex-1 min-w-[140px]"><label className={lbl}>To</label><input type="date" className={inp} value={reportTo} onChange={e=>setReportTo(e.target.value)}/></div>
              <button className={btnPri+" text-xs"} onClick={()=>{ const d=(new Date(reportTo)-new Date(reportFrom))/86400000; if(d>92){setReportMsg("Range exceeds 92 days. Proceeding anyway.");} exportReport("xlsx",reportFrom,reportTo); }}>Export XLSX</button>
              <button className={btnSec+" text-xs"} onClick={()=>{ const d=(new Date(reportTo)-new Date(reportFrom))/86400000; if(d>92){setReportMsg("Range exceeds 92 days."); return;} exportReport("csv",reportFrom,reportTo); }}>Export CSV</button>
            </div>
          </div>
          <div className="border border-white/10 rounded-2xl p-4">
            <h4 className="text-white/60 text-sm font-medium uppercase tracking-wide mb-3">Quick Monthly</h4>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {MONTHS.map((mn,i)=>{ const m=i+1, y=new Date().getFullYear(), from=`${y}-${fmt2(m)}-01`, to=`${y}-${fmt2(m)}-${fmt2(new Date(y,m,0).getDate())}`;
                return <div key={mn} className="flex items-center gap-1 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
                  <span className="text-white/60 text-xs flex-1">{mn} {y}</span>
                  <button className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" onClick={()=>exportReport("xlsx",from,to)}>xlsx</button>
                  <span className="text-white/10 mx-1">|</span>
                  <button className="text-xs text-indigo-400 hover:text-indigo-300 font-medium" onClick={()=>exportReport("csv",from,to)}>csv</button>
                </div>;
              })}
            </div>
          </div>
        </div>}
        {adminTab==="database"&&<div className={card}>
          <h3 className="text-white font-semibold mb-4">Database</h3>
          <div className="flex gap-1 mb-4 flex-wrap bg-white/5 rounded-xl p-1 border border-white/10">
            {[["employees","Employees"],["attendance","Attendance"],["balances","Balances"],["leaves","Leave Apps"],["audit","Audit Logs"],["locations","Location Logs"]].map(([t,l])=>(
              <button key={t} onClick={()=>setDbSubTab(t)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all min-w-[80px] ${dbSubTab===t?"bg-indigo-600 text-white":"text-white/40 hover:text-white/60"}`}>{l}</button>
            ))}
          </div>
          <div className="flex gap-2 mb-3 flex-wrap">
            <input className={inp+" flex-1"} placeholder="Search..." value={dbSearch} onChange={e=>setDbSearch(e.target.value)}/>
            <button className={btnPri+" text-xs"} onClick={()=>exportDB(dbSubTab,"xlsx")}>Export XLSX</button>
            <button className={btnSec+" text-xs"} onClick={()=>exportDB(dbSubTab,"csv")}>Export CSV</button>
          </div>
          <div className="overflow-x-auto border border-white/10 rounded-xl" style={{maxHeight:"500px",overflowY:"auto"}}>
            {dbSubTab==="employees"&&(()=>{
              const q=dbSearch.toLowerCase();
              const rows=employees.filter(e=>!q||`${e.name} ${e.empNum} ${e.company} ${e.dept} ${e.jobTitle} ${e.manager}`.toLowerCase().includes(q));
              return rows.length===0?<p className="text-white/30 text-center py-10">No records</p>:
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{["Name","Emp #","Company","Dept","Job Title","Manager","PIN","Status"].map(h=><th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0,100).map((e,i)=><tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{e.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.empNum||"--"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.company?.split(" ")[0]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.dept||"--"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.jobTitle||"--"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.manager||"--"}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{e.pin}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs ${e.active?"bg-emerald-500/20 text-emerald-300":"bg-red-500/20 text-red-300"}`}>{e.active?"Active":"Inactive"}</span></td>
                </tr>)}</tbody>
              </table>;
            })()}
            {dbSubTab==="attendance"&&(()=>{
              const q=dbSearch.toLowerCase();
              const rows=Object.values(attendance).sort((a,b)=>(b.date||"").localeCompare(a.date||"")).slice(0,200).filter(r=>!q||`${employees.find(e=>e.id===r.empId)?.name||""} ${r.date} ${r.status||""}`.toLowerCase().includes(q));
              return rows.length===0?<p className="text-white/30 text-center py-10">No records</p>:
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{["Emp Name","Emp #","Date","In Time","Out Time","In Location","Out Location","Leave Type","Leave Reason","Status","Bio Status","Bio Hrs","Source"].map(h=><th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0,100).map((r,i)=>{
                  const emp=employees.find(e=>e.id===r.empId)||{};
                  const src=r.bioSource?"Daily Bio":r.monthlySource?"Monthly Bio":r.source==="manual"?"Manual":"";
                  return <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{emp.name||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{emp.empNum||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{r.date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-emerald-400 font-mono">{r.inTime||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-red-400 font-mono">{r.outTime||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-purple-400 max-w-[120px] truncate">{r.inLocation||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-purple-400 max-w-[120px] truncate">{r.outLocation||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.leaveType||"--"}</td>
                    <td className="px-3 py-2 max-w-[120px] truncate">{r.leaveReason||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><Badge s={r.status||"Absent"}/></td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.bioStatusRaw||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.bioWrkHrs||"--"}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{src||"--"}</td>
                  </tr>;
                })}</tbody>
              </table>;
            })()}
            {dbSubTab==="balances"&&(()=>{
              const q=dbSearch.toLowerCase();
              const leaveTypes=["Sick Leave","Casual Leave","Earned Leave","Unpaid Leave","Bereavement Leave","Marriage Leave","Maternity Leave","Paternity Leave"];
              const rows=employees.filter(e=>leaveBalances[e.id]).filter(e=>!q||e.name.toLowerCase().includes(q));
              return rows.length===0?<p className="text-white/30 text-center py-10">No records</p>:
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">
                  <th className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">Employee</th>
                  {leaveTypes.map(lt=><th key={lt} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{lt.replace(" Leave","")}</th>)}
                </tr></thead>
                <tbody>{rows.slice(0,100).map((e,i)=>{
                  const bal=leaveBalances[e.id]||{};
                  return <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{e.name}</td>
                    {leaveTypes.map(lt=><td key={lt} className="px-3 py-2 whitespace-nowrap">{bal[lt]?`${bal[lt].balance}/${bal[lt].quota}`:"--"}</td>)}
                  </tr>;
                })}</tbody>
              </table>;
            })()}
            {dbSubTab==="leaves"&&(()=>{
              const q=dbSearch.toLowerCase();
              const rows=[...leaves].sort((a,b)=>b.date.localeCompare(a.date)).filter(r=>!q||`${r.empName} ${r.leaveType} ${r.status}`.toLowerCase().includes(q));
              return rows.length===0?<p className="text-white/30 text-center py-10">No records</p>:
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{["Employee","Company","Type","Date","Status","Reason","Applied At"].map(h=><th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0,100).map((l,i)=><tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{l.empName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.company?.split(" ")[0]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.leaveType}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{l.date}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs border ${l.status==="Approved"?"bg-emerald-500/20 text-emerald-300 border-emerald-500/30":l.status==="Rejected"?"bg-red-500/20 text-red-300 border-red-500/30":"bg-yellow-500/20 text-yellow-300 border-yellow-500/30"}`}>{l.status}</span></td>
                  <td className="px-3 py-2 max-w-[150px] truncate">{l.reason||"--"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.appliedAt?new Date(l.appliedAt).toLocaleDateString():"--"}</td>
                </tr>)}</tbody>
              </table>;
            })()}
            {dbSubTab==="audit"&&(()=>{
              const q=dbSearch.toLowerCase();
              const rows=auditLogs.filter(r=>!q||`${r.action} ${r.detail} ${r.by}`.toLowerCase().includes(q));
              return rows.length===0?<p className="text-white/30 text-center py-10">No records</p>:
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{["Timestamp","Action","Detail","By"].map(h=><th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{rows.slice(0,100).map((r,i)=><tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-indigo-300">{r.action}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.detail}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.by}</td>
                </tr>)}</tbody>
              </table>;
            })()}
            {dbSubTab==="locations"&&<div>
              <div className="flex items-center gap-2 mb-3">
                <label className="text-white/40 text-xs">Date:</label>
                <input type="date" className={inp+" text-xs"} value={locDate} max={TODAY} onChange={e=>setLocDate(e.target.value)}/>
                {locLoading&&<span className="text-white/30 text-xs">Loading...</span>}
                <span className="text-white/20 text-xs ml-auto">{locLogs.filter(r=>!dbSearch||`${r.emp_name} ${r.emp_num} ${r.lat_lon} ${r.type}`.toLowerCase().includes(dbSearch.toLowerCase())).length} pings</span>
              </div>
              {locLogs.length===0
                ? <p className="text-white/30 text-center py-10">{locLoading?"Loading...":"No location logs for this date"}</p>
                : <table className="w-full text-xs text-white/60 min-w-max">
                  <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{["Time","Employee","Emp #","Location","Type"].map(h=><th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                  <tbody>{locLogs.filter(r=>!dbSearch||`${r.emp_name} ${r.emp_num} ${r.lat_lon} ${r.type}`.toLowerCase().includes(dbSearch.toLowerCase())).map((r,i)=>(
                    <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-3 py-2 whitespace-nowrap font-mono">{new Date(r.captured_at).toLocaleTimeString()}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{r.emp_name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{r.emp_num||"--"}</td>
                      <td className="px-3 py-2 max-w-[250px] truncate text-purple-400/80">{r.lat_lon}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type==="punch_in"?"bg-emerald-500/20 text-emerald-300":r.type==="punch_out"?"bg-red-500/20 text-red-300":"bg-blue-500/20 text-blue-300"}`}>
                          {r.type==="punch_in"?"Punch In":r.type==="punch_out"?"Punch Out":"Auto"}
                        </span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>}
            </div>}
          </div>
          <p className="text-white/20 text-xs mt-2">Showing up to 100 rows</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[["Employees",employees.length],["Attendance Records",Object.keys(attendance).length],["Leave Applications",leaves.length],["Audit Logs",auditLogs.length]].map(([k,v])=>(
              <div key={k} className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
                <p className="text-white text-2xl font-bold">{v}</p>
                <p className="text-white/30 text-xs mt-1">{k}</p>
              </div>
            ))}
          </div>
        </div>}
        {adminTab==="settings"&&<div className="space-y-4">
          <div className={card}>
            <h3 className="text-white font-semibold mb-4">Change Admin PIN</h3>
            <label className={lbl}>New PIN (min 4 characters)</label>
            <input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" className={inp+" mb-2 tracking-widest"} value={newPin} onChange={e=>setNewPin(e.target.value)} placeholder="Enter new PIN"/>
            {settingsMsg&&<div className={`rounded-xl p-2.5 mb-3 text-sm ${settingsMsg.startsWith("PIN updated")?"bg-emerald-500/10 border border-emerald-500/30 text-emerald-300":"bg-red-500/10 border border-red-500/30 text-red-300"}`}>{settingsMsg}</div>}
            <button className={btnPri+" text-xs"} onClick={async ()=>{
              if(newPin.length<4){setSettingsMsg("PIN must be at least 4 characters"); setTimeout(()=>setSettingsMsg(""),3000); return;}
              try {
                await adminUpdateSettings(adminToken, settings.stdHours, newPin);
                setNewPin(""); setSettingsMsg("PIN updated successfully"); addAudit("SETTINGS","Admin PIN changed","admin");
              } catch(err) { setSettingsMsg("Error: "+err.message); }
              setTimeout(()=>setSettingsMsg(""),3000);
            }}>Update PIN</button>
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-4">Standard Hours / Day</h3>
            <input type="number" min="1" max="24" className={inp+" mb-1"} value={newStd||settings.stdHours} onChange={e=>setNewStd(e.target.value)}/>
            <p className="text-white/30 text-xs mb-3">Half-day threshold: below {((Number(newStd)||settings.stdHours)/2).toFixed(1)} hours</p>
            <button className={btnPri+" text-xs"} onClick={async ()=>{ const v=Number(newStd); if(!v||v<1) return;
              try { await adminUpdateSettings(adminToken, v); setSettings(s=>({...s,stdHours:v})); setNewStd(""); addAudit("SETTINGS",`Std hours set to ${v}`,"admin"); }
              catch(err) { alert(err.message); }
            }}>Save</button>
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-1">Financial Year Reset</h3>
            <p className="text-white/30 text-xs mb-4">Resets leave balances for the new financial year (1st April). Previous year data is preserved — only the interface resets. Each employee gets a fresh balance equal to their quota.</p>
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
              <p className="text-amber-300 text-xs font-medium">This action creates new FY records for all employees. Run only on 1st April.</p>
            </div>
            <button className={btnDanger+" text-xs"} onClick={async()=>{
              if(!window.confirm("Create new financial year leave balances for all employees? This should only be done on 1st April.")) return;
              try {
                const { data, error } = await supabase.rpc("admin_reset_leave_balances", { p_token: adminToken });
                if(error) throw error;
                alert(`Done. ${data} employee-leave records created for new FY.`);
                const lb = await adminFetchAllLeaveBalances(adminToken);
                setLeaveBalances(lb);
                addAudit("SETTINGS","Financial year leave balances reset","admin");
              } catch(err) { alert("Error: "+err.message); }
            }}>Reset for New Financial Year</button>
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Backup & Restore</h3>
            <div className="flex gap-2 flex-wrap">
              <button className={btnPri+" text-xs"} onClick={backupAll}>Download Backup</button>
              <label className={btnSec+" text-xs cursor-pointer"}>Restore from JSON<input ref={restoreRef} type="file" accept=".json" className="hidden" onChange={restoreAll}/></label>
            </div>
          </div>
          <div className={card}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold">Holiday Calendar</h3>
              <button className={btnPri+" text-xs"} onClick={()=>setShowHolidayForm(s=>!s)}>{showHolidayForm?"Cancel":"+ Add Holiday"}</button>
            </div>
            {showHolidayForm&&<div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
              <div>
                <label className={lbl}>Date</label>
                <input type="date" className={inp} value={holidayForm.date} onChange={e=>setHolidayForm(f=>({...f,date:e.target.value}))}/>
              </div>
              <div>
                <label className={lbl}>Holiday Name</label>
                <input type="text" className={inp} value={holidayForm.name} onChange={e=>setHolidayForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Diwali"/>
              </div>
              <div>
                <label className={lbl}>Type</label>
                <select className={inp} value={holidayForm.type} onChange={e=>setHolidayForm(f=>({...f,type:e.target.value}))}>
                  {["Public","Optional","Restricted","Company"].map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="md:col-span-3 flex gap-2">
                <button className={btnPri+" text-xs"} onClick={async()=>{
                  if(!holidayForm.date||!holidayForm.name.trim()){setHolidayMsg("Date and name are required."); return;}
                  try {
                    const h = await adminAddHoliday(adminToken, holidayForm.date, holidayForm.name.trim(), holidayForm.type);
                    setHolidays(prev=>[...prev,h].sort((a,b)=>a.date<b.date?-1:1));
                    setHolidayForm({date:"",name:"",type:"Public"});
                    setShowHolidayForm(false);
                    addAudit("SETTINGS",`Holiday added: ${h.name} on ${h.date}`,"admin");
                    setHolidayMsg("");
                  } catch(err){setHolidayMsg("Error: "+err.message);}
                }}>Save Holiday</button>
                {holidayMsg&&<p className="text-red-400 text-xs self-center">{holidayMsg}</p>}
              </div>
            </div>}
            {holidays.length===0
              ? <p className="text-white/30 text-sm text-center py-4">No holidays added yet</p>
              : <div className="overflow-x-auto">
                <table className="w-full text-xs text-white/70">
                  <thead><tr className="border-b border-white/10">{["Date","Holiday","Type",""].map(h=><th key={h} className="text-left py-2 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
                  <tbody>{holidays.map(h=>(
                    <tr key={h.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="py-2 pr-4 font-mono">{h.date}</td>
                      <td className="py-2 pr-4 text-white/80 font-medium">{h.name}</td>
                      <td className="py-2 pr-4"><span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">{h.type}</span></td>
                      <td className="py-2"><button className={btnDanger} onClick={async()=>{
                        try { await adminDeleteHoliday(adminToken, h.id); setHolidays(prev=>prev.filter(x=>x.id!==h.id)); addAudit("SETTINGS",`Holiday removed: ${h.name}`,"admin"); }
                        catch(err){alert(err.message);}
                      }}>Remove</button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>}
          </div>
          <div className={card}>
            <h3 className="text-white font-semibold mb-3">Database Summary</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[["Employees",employees.length],["Attendance Records",Object.keys(attendance).length],["Leave Applications",leaves.length],["Audit Logs",auditLogs.length]].map(([k,v])=>(
                <div key={k} className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
                  <p className="text-white text-2xl font-bold">{v}</p>
                  <p className="text-white/30 text-xs mt-1">{k}</p>
                </div>
              ))}
            </div>
          </div>
        </div>}
      </div>
      {leaveBalEditor&&<div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
        <div className={card+" w-full max-w-lg max-h-[90vh] overflow-y-auto"}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-bold text-lg">Leave Balances</h2>
              <p className="text-white/40 text-xs">{leaveBalEditor.empName}</p>
            </div>
            <button className={btnSec+" text-xs"} onClick={()=>setLeaveBalEditor(null)}>Close</button>
          </div>
          <div className="space-y-3 mb-4">
            {Object.entries(leaveBalEditor.balances).map(([lt, v])=>(
              <div key={lt} className="bg-white/5 border border-white/10 rounded-xl p-3">
                <p className="text-white text-sm font-medium mb-2">{lt}</p>
                <div className="grid grid-cols-4 gap-2">
                  {[["Quota","quota"],["Accrued","accrued"],["Consumed","consumed"],["Balance","balance"]].map(([label, field])=>(
                    <div key={field}>
                      <label className={lbl}>{label}</label>
                      <input type="number" min="0" className={inp+" text-xs"} value={v[field]||0}
                        onChange={e=>{
                          const val = parseFloat(e.target.value)||0;
                          setLeaveBalEditor(prev=>{
                            const updated = {...prev};
                            updated.balances[lt] = {...updated.balances[lt], [field]: val};
                            // Auto-calculate balance when quota or consumed changes
                            if(field==="quota"||field==="consumed") {
                              updated.balances[lt].balance = Math.max(0, updated.balances[lt].quota - updated.balances[lt].consumed);
                              updated.balances[lt].accrued = updated.balances[lt].quota;
                            }
                            return updated;
                          });
                        }}/>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <button className={btnPri+" w-full"} onClick={async()=>{
            try {
              const records = Object.entries(leaveBalEditor.balances).map(([lt, v])=>({
                empId: leaveBalEditor.empId,
                leaveType: lt,
                accrued: v.accrued||0,
                consumed: v.consumed||0,
                balance: v.balance||0,
                quota: v.quota||0,
                unit: v.unit||"Days",
              }));
              await adminBulkUpsertLeaveBalances(adminToken, records);
              const lb = await adminFetchAllLeaveBalances(adminToken);
              setLeaveBalances(lb);
              addAudit("LEAVE_BAL_UPDATE", `Updated leave balances for ${leaveBalEditor.empName}`, "admin");
              setLeaveBalEditor(null);
            } catch(err) { alert("Error: "+err.message); }
          }}>Save Leave Balances</button>
        </div>
      </div>}
    </div>
  );
}
