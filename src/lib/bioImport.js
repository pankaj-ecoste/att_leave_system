// Helpers for the Daily Bio and Monthly Bio imports, plus the smarter
// employee-matching used by all three import types. Kept separate from
// App.jsx since none of this touches React or Supabase directly — it's
// pure parsing/matching logic that the import handlers call into.

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function fmt2(n) {
  return String(n).padStart(2, "0");
}

// Converts a time value from a biometric export (which can be a decimal
// Excel time fraction, "HH:MM AM/PM", or plain "HH:MM") into "HH:MM".
export function parseBioTime(t) {
  if (!t && t !== 0) return "";
  const s = String(t).trim();
  if (!s) return "";
  if (!isNaN(s) && s.includes(".")) {
    const sec = Math.round(parseFloat(s) * 86400);
    return `${fmt2(Math.floor(sec / 3600))}:${fmt2(Math.floor((sec % 3600) / 60))}`;
  }
  const m12 = s.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (m12) {
    let h = parseInt(m12[1]), mn = parseInt(m12[2]);
    if (m12[3].toUpperCase() === "PM" && h !== 12) h += 12;
    if (m12[3].toUpperCase() === "AM" && h === 12) h = 0;
    return `${fmt2(h)}:${fmt2(mn)}`;
  }
  const m24 = s.match(/(\d{1,2}):(\d{2})/);
  if (m24) return `${fmt2(parseInt(m24[1]))}:${fmt2(parseInt(m24[2]))}`;
  return "";
}

// Converts a date value found in a biometric export's header (various
// formats: "17-Jun-2026", "2026-06-17", "17/06/2026") into "YYYY-MM-DD".
// Falls back to today's date if nothing recognizable is found.
export function parseBioDate(raw, today) {
  if (!raw) return today;
  const s = String(raw).trim();
  const dm = s.match(/(\d{1,2})[-/]([A-Za-z]+)[-/](\d{4})/);
  if (dm) {
    const mi = MONTHS_SHORT.indexOf(dm[2].toLowerCase().slice(0, 3));
    if (mi >= 0) return `${dm[3]}-${fmt2(mi + 1)}-${fmt2(parseInt(dm[1]))}`;
  }
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) return `${dmy[3]}-${fmt2(parseInt(dmy[2]))}-${fmt2(parseInt(dmy[1]))}`;
  return today;
}

// Maps a raw status code from a biometric export ("P", "A", "HD", etc.)
// to one of this app's own status labels.
export function mapBioStatus(s) {
  if (!s) return null;
  const sl = String(s).toLowerCase().trim();
  if (sl === "p" || sl === "present") return "Present";
  if (sl === "a" || sl === "absent") return "Absent";
  if (sl === "hd" || sl === "h" || sl === "half day" || sl === "halfday") return "Half Day";
  if (sl === "l" || sl === "leave") return "Leave";
  return null;
}

export function normCode(c) {
  return String(c || "").trim();
}

// Pulls a value out of an imported spreadsheet row by trying several
// possible column-name spellings (exports from different machines/sources
// label the same field differently — "Emp Code" vs "EmpCode" vs "EMP CODE").
export function gField(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && String(row[k]).trim() !== "") return String(row[k]).trim();
    const kn = k.toLowerCase().replace(/[\s._]/g, "");
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase().replace(/[\s._]/g, "") === kn && String(row[rk]).trim() !== "") {
        return String(row[rk]).trim();
      }
    }
  }
  return "";
}

// Builds quick lookup maps (by employee code, and by lowercased name) for
// matching import rows against a snapshot of the current employee list.
export function buildEmpMaps(emps) {
  const byCode = {};
  const byName = {};
  emps.forEach(em => {
    if (em.empNum) {
      const r = normCode(em.empNum);
      byCode[r] = em;
      byCode[String(parseInt(r, 10) || 0)] = em;
      byCode[r.replace(/^0+/, "") || "0"] = em;
    }
    if (em.name) byName[em.name.trim().toLowerCase()] = em;
  });
  return { byCode, byName };
}

// Finds the best-matching employee for a given code/name pair, trying an
// exact code match first, then exact name match, then first-name match.
export function findEmpInSnap(codeRaw, nameRaw, snap) {
  const code = normCode(codeRaw);
  const name = String(nameRaw || "").trim().toLowerCase();
  let emp = null;
  if (code) {
    emp = snap.find(e =>
      e.empNum && (
        e.empNum === code ||
        e.empNum.replace(/^0+/, "") === code.replace(/^0+/, "") ||
        String(parseInt(e.empNum, 10)) === String(parseInt(code, 10))
      )
    );
  }
  if (!emp && name.length > 2) emp = snap.find(e => e.name && e.name.trim().toLowerCase() === name);
  if (!emp && name.length > 2) {
    const fw = name.split(/\s+/)[0];
    if (fw.length > 2) emp = snap.find(e => e.name && e.name.toLowerCase().startsWith(fw));
  }
  return emp || null;
}
