// منطق التقييم وفق «ملحق أ — نظام تصنيف المخاطر والتقييم»
// لا يُختزل التقييم في مجموع الدرجات: ملاحظة حمراء واحدة تجعل التصنيف العام أحمر.
import { SECTIONS, QUESTIONS } from "./questions.js";

export const Q_BY_CODE = Object.fromEntries(QUESTIONS.map(q => [q.code, q]));
export const THRESHOLD = 0.75;

/** مستوى الخطورة الفعلي لبند أُجيب عنه بـ«لا» (تعديل المشرف في سجل النتائج يتقدّم على المرجعي) */
export function riskOf(visit, code) {
  const f = (visit.findings || []).find(x => x.code === code);
  return (f && f.risk) || Q_BY_CODE[code]?.sev || "green";
}

export function overdueActions(visit) {
  const ref = visit.info?.date || new Date().toISOString().slice(0, 10);
  const fromList = (visit.prevActions || []).filter(a =>
    a.status !== "مكتمل" && a.status !== "غير قابل للتنفيذ" && a.deadline && a.deadline < ref).length;
  const declared = Number(visit.info?.overdueCount) || 0;
  return Math.max(fromList, declared);
}

export function computeScores(visit) {
  const answers = visit.answers || {};
  const sections = {};
  let yesAll = 0, applAll = 0, answered = 0;
  const counts = { red: 0, orange: 0, green: 0, blue: 0 };

  for (const s of SECTIONS) sections[s.id] = { yes: 0, no: 0, na: 0, pct: null };
  for (const q of QUESTIONS) {
    const a = answers[q.code];
    if (!a) continue;
    answered++;
    const sec = sections[q.s];
    sec[a]++;
    if (a === "no") counts[riskOf(visit, q.code)]++;
  }
  let minSection = null, minSectionId = null, belowThreshold = 0;
  for (const s of SECTIONS) {
    const sec = sections[s.id];
    const appl = sec.yes + sec.no;
    yesAll += sec.yes; applAll += appl;
    sec.pct = appl ? sec.yes / appl : null;
    if (sec.pct !== null) {
      if (minSection === null || sec.pct < minSection) { minSection = sec.pct; minSectionId = s.id; }
      if (sec.pct < THRESHOLD) belowThreshold++;
    }
  }
  const overdue = overdueActions(visit);
  let overall = "green";
  if (counts.red > 0) overall = "red";
  else if (counts.orange >= 3 || belowThreshold > 0 || overdue > 0) overall = "orange";

  const reasons = [];
  if (counts.red > 0) reasons.push(`${counts.red} ملاحظة حمراء (حرجة)`);
  if (counts.orange >= 3) reasons.push(`${counts.orange} ملاحظات برتقالية`);
  if (belowThreshold > 0) reasons.push(`${belowThreshold} قسم بنسبة التزام أقل من 75٪`);
  if (overdue > 0) reasons.push(`${overdue} إجراء متأخر من زيارة سابقة`);

  return {
    sections, red: counts.red, orange: counts.orange, blue: counts.blue, greenNo: counts.green,
    compliance: applAll ? yesAll / applAll : null,
    minSection, minSectionId, belowThreshold, overdue, overall, reasons,
    answered, total: QUESTIONS.length
  };
}

export const pct = v => (v === null || v === undefined || isNaN(v)) ? "—" : Math.round(v * 100) + "٪";
export const RISK_COLORS = { red: "#C62828", orange: "#E66A00", green: "#2E7D32", blue: "#1565C0" };
