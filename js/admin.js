// ================================================================
//  منصة الإدارة — تحليل بيانات الزيارات الإشرافية الداعمة وإعداد التقارير
//  المركز الوطني لمكافحة الأمراض (NCDC) — إدارة التطعيمات
//  إعداد: د. محمد علي الجرنازي
// ================================================================
import { SECTIONS, QUESTIONS } from "./questions.js";
import { computeScores, riskOf, pct, Q_BY_CODE, RISK_COLORS } from "./scoring.js";
import * as L from "./lists.js";
import * as store from "./store.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const todayISO = () => new Date().toISOString().slice(0, 10);
const RISK_AR = { red: "أحمر", orange: "برتقالي", green: "أخضر", blue: "فرصة تحسين" };
const badge = r => `<span class="badge b-${r || "grey"}">${RISK_AR[r] || "—"}</span>`;
const secName = id => SECTIONS.find(s => s.id === id)?.name || id;
const A = { all: [], list: [], tab: "dash", charts: {}, current: null, unsub: null };

function toast(m) { const t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 2600); }

// ---------------- إثراء البيانات ----------------
function enrich(list) {
  list.forEach(v => { v._sc = computeScores(v); v._no = new Set(Object.entries(v.answers || {}).filter(([, a]) => a === "no").map(([c]) => c)); });
  const byCenter = {};
  [...list].sort((a, b) => (a.info?.date || "").localeCompare(b.info?.date || "")).forEach(v => {
    const k = (v.info?.municipality || "") + "|" + (v.info?.center || "");
    const prev = byCenter[k];
    v._prev = prev || null;
    v._recurring = prev ? [...v._no].filter(c => prev._no.has(c)) : [];
    byCenter[k] = v;
  });
  return list.sort((a, b) => (b.info?.date || "").localeCompare(a.info?.date || ""));
}
const isOverdue = f => f.deadline && f.deadline < todayISO() && !["مكتمل", "غير قابل للتنفيذ"].includes(f.status);

// ---------------- التصفية ----------------
const F = () => ({ muni: $("fMuni").value, center: $("fCenter").value, from: $("fFrom").value, to: $("fTo").value, type: $("fType").value, risk: $("fRisk").value });
function applyFilters() {
  const f = F();
  A.list = A.all.filter(v => (!f.muni || v.info.municipality === f.muni) && (!f.center || v.info.center === f.center)
    && (!f.from || v.info.date >= f.from) && (!f.to || v.info.date <= f.to)
    && (!f.type || v.info.visitType === f.type) && (!f.risk || v._sc.overall === f.risk));
  const parts = [f.muni || "كل البلديات", f.center || "كل المراكز"];
  if (f.from || f.to) parts.push(`الفترة ${f.from || "…"} إلى ${f.to || "…"}`);
  $("metaLine").textContent = `${A.list.length} زيارة من أصل ${A.all.length} — ${parts.join("، ")} — تتحدّث البيانات لحظياً عند وصول زيارات جديدة`;
  renderTab();
}
function fillSelect(sel, values, allLabel, keep = true) {
  const cur = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` + values.map(v => `<option>${esc(v)}</option>`).join("");
  if (keep && values.includes(cur)) sel.value = cur;
}
function refreshFilterOptions() {
  const munis = [...new Set(A.all.map(v => v.info.municipality).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  fillSelect($("fMuni"), munis, "كل البلديات");
  refreshCenters();
}
function refreshCenters() {
  const m = $("fMuni").value;
  const cs = [...new Set(A.all.filter(v => !m || v.info.municipality === m).map(v => v.info.center).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ar"));
  fillSelect($("fCenter"), cs, "كل المراكز");
}

// ---------------- التبويبات ----------------
function renderTab() {
  ["dash", "visits", "cap", "centers", "lists"].forEach(t => $("tab-" + t).classList.toggle("hidden", t !== A.tab));
  $("filtersBar").classList.toggle("hidden", A.tab === "lists");
  $("metaLine").classList.toggle("hidden", A.tab === "lists");
  ({ dash: renderDash, visits: renderVisits, cap: renderCap, centers: renderCenters, lists: renderLists })[A.tab]();
}

// ================================================================
//  إدارة البلديات والمراكز — تُحفظ في Firestore وتظهر تلقائياً في تطبيق الهاتف
// ================================================================
const LS = { munis: null, dirty: false, open: new Set(), q: "", meta: null, loading: false };
const tidy = s => String(s ?? "").replace(/\u0640/g, "").replace(/\s+/g, " ").trim();
const arSort = (a, b) => a.localeCompare(b, "ar");

async function loadLists(force) {
  if (LS.loading || (LS.munis && !force)) return;
  LS.loading = true;
  try {
    const d = await store.getLists();
    LS.munis = d?.munis?.length ? d.munis.map(m => ({ name: m.name, centers: [...(m.centers || [])] })) : L.defaultMuniList();
    LS.meta = d ? { at: d.updatedAt, by: d.updatedBy } : null;
    LS.dirty = false;
  } catch (e) {
    toast("تعذّر تحميل القائمة: " + (e.code || e.message));
    if (!LS.munis) LS.munis = L.defaultMuniList();
  }
  LS.loading = false;
  if (A.tab === "lists") renderLists();
}
function markDirty() { LS.dirty = true; renderLists(); }
const findMuni = name => LS.munis.find(m => m.name === name);

function renderLists() {
  const box = $("tab-lists");
  if (!LS.munis) { box.innerHTML = '<div class="panel" style="margin:16px 0"><p class="empty">جارٍ تحميل القائمة…</p></div>'; loadLists(); return; }
  const q = tidy(LS.q);
  const totalC = LS.munis.reduce((n, m) => n + m.centers.length, 0);
  const munis = [...LS.munis].sort((a, b) => arSort(a.name, b.name))
    .filter(m => !q || m.name.includes(q) || m.centers.some(c => c.includes(q)));
  const meta = LS.meta?.at ? `آخر نشر: ${new Date(LS.meta.at).toLocaleString("ar-LY")}${LS.meta.by ? " — " + esc(LS.meta.by) : ""}` : "لم تُنشر قائمة بعد — التطبيق يستخدم القائمة الافتراضية";
  box.innerHTML = `<div class="panel lists-panel" style="margin:16px 0 24px">
    <div class="lists-head">
      <div><h3>البلديات والمراكز</h3><div class="sub">${LS.munis.length} بلدية — ${totalC} مركزاً. ${meta}</div></div>
      <div class="lists-actions">
        <button class="btn gold" id="lsSave" type="button" ${LS.dirty ? "" : "disabled"}>${LS.dirty ? "حفظ ونشر للتطبيق" : "لا توجد تغييرات"}</button>
        <button class="btn ghost" id="lsAddM" type="button">+ إضافة بلدية</button>
        <label class="btn ghost" for="lsFile">استيراد Excel</label><input type="file" id="lsFile" accept=".xlsx,.xls,.csv" hidden>
        <button class="btn ghost" id="lsExp" type="button">تصدير Excel</button>
        <button class="btn ghost sm" id="lsReload" type="button">${LS.dirty ? "تجاهل التغييرات" : "تحديث"}</button>
      </div>
    </div>
    ${LS.dirty ? '<p class="dirty-note">لديك تغييرات غير محفوظة. اضغط «حفظ ونشر للتطبيق» لتظهر للمشرفين.</p>' : ""}
    <input class="lists-search" id="lsQ" type="search" placeholder="ابحث عن بلدية أو مركز…" value="${esc(LS.q)}">
    <div class="munis">${munis.length ? munis.map(m => {
      const open = LS.open.has(m.name) || (q && !m.name.includes(q));
      const cs = q && !m.name.includes(q) ? m.centers.filter(c => c.includes(q)) : m.centers;
      return `<details class="muni" data-m="${esc(m.name)}" ${open ? "open" : ""}>
        <summary><span class="mname">${esc(m.name)}</span><span class="mcount">${m.centers.length} مركز</span>
          <span class="macts"><button type="button" class="lnk" data-act="renM">تعديل الاسم</button><button type="button" class="lnk red" data-act="delM">حذف البلدية</button></span></summary>
        <ul class="centers">${cs.map(c => `<li data-c="${esc(c)}"><span>${esc(c)}</span><button type="button" class="lnk" data-act="renC">تعديل</button><button type="button" class="lnk red" data-act="delC">حذف</button></li>`).join("")
          || '<li class="empty">لا توجد مراكز بعد</li>'}</ul>
        <form class="addc" data-act="addC"><input placeholder="اسم مركز جديد في ${esc(m.name)}" required><button class="btn sm" type="submit">إضافة مركز</button></form>
      </details>`; }).join("") : '<p class="empty">لا نتائج مطابقة للبحث.</p>'}</div>
  </div>`;
  wireLists();
}

function wireLists() {
  const box = $("tab-lists");
  $("lsQ").oninput = e => { LS.q = e.target.value; const pos = e.target.selectionStart; renderLists(); const i = $("lsQ"); i.focus(); i.setSelectionRange(pos, pos); };
  box.querySelectorAll("details.muni").forEach(d => d.addEventListener("toggle", () => d.open ? LS.open.add(d.dataset.m) : LS.open.delete(d.dataset.m)));
  $("lsAddM").onclick = () => {
    const n = tidy(prompt("اسم البلدية الجديدة:")); if (!n) return;
    if (findMuni(n)) return toast("هذه البلدية موجودة مسبقاً");
    LS.munis.push({ name: n, centers: [] }); LS.open.add(n); LS.q = ""; markDirty();
  };
  $("lsReload").onclick = () => { if (LS.dirty && !confirm("تجاهل كل التغييرات غير المحفوظة؟")) return; loadLists(true); };
  $("lsExp").onclick = () => {
    if (!window.XLSX) return toast("مكتبة Excel لم تُحمَّل");
    const rows = [["البلدية", "المركز"]];
    [...LS.munis].sort((a, b) => arSort(a.name, b.name)).forEach(m => m.centers.length ? m.centers.forEach(c => rows.push([m.name, c])) : rows.push([m.name, ""]));
    const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows); ws["!cols"] = [{ wch: 24 }, { wch: 48 }];
    XLSX.utils.book_append_sheet(wb, ws, "البلديات والمراكز"); XLSX.writeFile(wb, `البلديات_والمراكز_${todayISO()}.xlsx`);
  };
  $("lsFile").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) importLists(f); };
  $("lsSave").onclick = async () => {
    const b = $("lsSave"); b.disabled = true; b.textContent = "جارٍ النشر…";
    const clean = LS.munis.map(m => ({ name: m.name, centers: [...new Set(m.centers)] })).sort((a, b) => arSort(a.name, b.name));
    try {
      await store.saveLists(clean);
      LS.munis = clean; LS.dirty = false; LS.meta = { at: new Date().toISOString(), by: "" };
      toast("نُشرت القائمة — تظهر في تطبيق الهاتف عند فتحه"); renderLists();
    } catch (err) { toast("تعذّر الحفظ: " + (err.code || err.message) + (err.code === "permission-denied" ? " — انشر قواعد الأمان الجديدة" : "")); b.disabled = false; b.textContent = "حفظ ونشر للتطبيق"; }
  };
  box.querySelectorAll("form.addc").forEach(f => f.onsubmit = e => {
    e.preventDefault();
    const m = findMuni(f.closest(".muni").dataset.m), n = tidy(f.querySelector("input").value); if (!n) return;
    if (m.centers.includes(n)) return toast("هذا المركز موجود مسبقاً");
    m.centers.push(n); LS.open.add(m.name); markDirty();
    box.querySelector(`details.muni[data-m="${CSS.escape(m.name)}"] form.addc input`)?.focus();
  });
  box.querySelectorAll("button[data-act]").forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const m = findMuni(b.closest(".muni").dataset.m), act = b.dataset.act, c = b.closest("li")?.dataset.c;
    if (act === "renM") {
      const n = tidy(prompt("الاسم الجديد للبلدية:", m.name)); if (!n || n === m.name) return;
      if (findMuni(n)) return toast("يوجد بلدية بهذا الاسم");
      LS.open.delete(m.name); m.name = n; LS.open.add(n); markDirty();
    } else if (act === "delM") {
      if (!confirm(`حذف بلدية «${m.name}» ومراكزها (${m.centers.length}) من القائمة؟\nالزيارات المرسلة سابقاً لا تتأثر.`)) return;
      LS.munis = LS.munis.filter(x => x !== m); markDirty();
    } else if (act === "renC") {
      const n = tidy(prompt("الاسم الجديد للمركز:", c)); if (!n || n === c) return;
      if (m.centers.includes(n)) return toast("يوجد مركز بهذا الاسم");
      m.centers[m.centers.indexOf(c)] = n; markDirty();
    } else if (act === "delC") {
      if (!confirm(`حذف «${c}» من قائمة ${m.name}؟`)) return;
      m.centers = m.centers.filter(x => x !== c); markDirty();
    }
  });
}

// استيراد من Excel: عمود للبلدية وعمود للمركز (يقبل بنية ملف الإحصائيات: اسم البلدية في أول صف من مجموعتها فقط)
async function importLists(file) {
  if (!window.XLSX) return toast("مكتبة Excel لم تُحمَّل");
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" });
    const isM = x => /بلدي/.test(String(x)), isC = x => /(مرفق|مراف|مركز|مراكز)/.test(String(x));
    let h = rows.findIndex(r => r.some(isM) && r.some((x, i) => isC(x) && i !== r.findIndex(isM)));
    let mc = 0, cc = 1;
    if (h >= 0) { mc = rows[h].findIndex(isM); cc = rows[h].findIndex((x, i) => i !== mc && isC(x)); }
    const out = new Map(); let cur = "";
    rows.slice(h + 1).forEach(r => {
      const m = tidy(r[mc]); if (m) cur = m;
      const c = tidy(r[cc]); if (!cur) return;
      if (!out.has(cur)) out.set(cur, []);
      if (c && !out.get(cur).includes(c)) out.get(cur).push(c);
    });
    if (!out.size) return toast("لم أجد بيانات. يجب أن يحوي الملف عموداً للبلدية وعموداً للمركز.");
    const nC = [...out.values()].reduce((n, a) => n + a.length, 0);
    const replace = confirm(`في الملف ${out.size} بلدية و${nC} مركزاً.\n\nموافق = استبدال القائمة الحالية بالكامل\nإلغاء = دمجها مع القائمة الحالية (إضافة الجديد فقط)`);
    if (replace) LS.munis = [...out].map(([name, centers]) => ({ name, centers }));
    else out.forEach((cs, name) => { const m = findMuni(name); if (m) cs.forEach(c => !m.centers.includes(c) && m.centers.push(c)); else LS.munis.push({ name, centers: cs }); });
    LS.q = ""; markDirty(); toast("استُورد الملف — راجع القائمة ثم اضغط «حفظ ونشر للتطبيق»");
  } catch (e) { toast("تعذّر قراءة الملف: " + e.message); }
}
window.addEventListener("beforeunload", e => { if (LS.dirty) { e.preventDefault(); e.returnValue = ""; } });

// ---------- مؤشرات مجمّعة ----------
function aggregate(list) {
  const n = list.length;
  const risk = { red: 0, orange: 0, green: 0 };
  const find = { red: 0, orange: 0, blue: 0 };
  const secSum = Object.fromEntries(SECTIONS.map(s => [s.id, { sum: 0, n: 0 }]));
  const itemNo = {}, rc = {};
  let compSum = 0, compN = 0, open = 0, overdue = 0, escalated = 0, recurring = 0;
  for (const v of list) {
    const sc = v._sc; risk[sc.overall]++; find.red += sc.red; find.orange += sc.orange; find.blue += sc.blue;
    if (sc.compliance !== null) { compSum += sc.compliance; compN++; }
    for (const s of SECTIONS) { const p = sc.sections[s.id].pct; if (p !== null) { secSum[s.id].sum += p; secSum[s.id].n++; } }
    v._no.forEach(c => itemNo[c] = (itemNo[c] || 0) + 1);
    (v.findings || []).forEach(f => {
      if (!["مكتمل", "غير قابل للتنفيذ"].includes(f.status)) open++;
      if (isOverdue(f)) overdue++;
      if (f.escalate) escalated++;
      (f.rootCauses || []).forEach(c => rc[c] = (rc[c] || 0) + 1);
    });
    recurring += v._recurring.length;
  }
  const sections = Object.fromEntries(SECTIONS.map(s => [s.id, secSum[s.id].n ? secSum[s.id].sum / secSum[s.id].n : null]));
  const top = Object.entries(itemNo).sort((a, b) => b[1] - a[1] || (a[0] > b[0] ? 1 : -1)).slice(0, 10);
  const centers = new Set(list.map(v => v.info.municipality + "|" + v.info.center)).size;
  return { n, risk, find, sections, top, rc, open, overdue, escalated, recurring, centers, compliance: compN ? compSum / compN : null };
}

function ribbon(g) {
  const seg = (k, c) => g.risk[k] ? `<div style="flex:${g.risk[k]};background:${RISK_COLORS[k]}" title="${RISK_AR[k]}: ${g.risk[k]}">${g.risk[k]}</div>` : "";
  return `<div class="ribbon"><div class="bar" role="img" aria-label="توزيع الزيارات: ${g.risk.green} أخضر، ${g.risk.orange} برتقالي، ${g.risk.red} أحمر">
    ${g.n ? seg("green") + seg("orange") + seg("red") : '<div style="flex:1;color:var(--muted)">لا توجد زيارات ضمن التصفية</div>'}</div>
    <div class="legend"><span>🟢 أخضر: الوضع مقبول (${g.risk.green})</span><span>🟠 برتقالي: إجراء خلال 24–72 ساعة (${g.risk.orange})</span><span>🔴 أحمر: تدخل فوري (${g.risk.red})</span></div></div>`;
}
function figures(g) {
  const f = (v, l, c) => `<div class="fig"><b style="${c ? "color:" + c : ""}" class="num">${v}</b><span>${l}</span></div>`;
  return `<div class="figures">${f(g.n, "زيارة")}${f(g.centers, "مركز تمت زيارته")}${f(pct(g.compliance), "متوسط الالتزام العام")}
    ${f(g.find.red, "ملاحظة حمراء", RISK_COLORS.red)}${f(g.find.orange, "ملاحظة برتقالية", RISK_COLORS.orange)}${f(g.find.blue, "فرصة تحسين", RISK_COLORS.blue)}
    ${f(g.open, "إجراء تصحيحي مفتوح")}${f(g.overdue, "إجراء متأخر عن موعده", g.overdue ? RISK_COLORS.red : "")}${f(g.recurring, "مشكلة متكررة من زيارة سابقة")}</div>`;
}

function renderDash() {
  const g = aggregate(A.list);
  $("tab-dash").innerHTML = ribbon(g) + figures(g) + `
  <div class="grid">
    <div class="panel c8"><h3>متوسط نسبة الالتزام لكل قسم</h3><div class="sub">نعم ÷ البنود القابلة للتطبيق — الخط الفاصل 75٪</div><div class="chartbox tall"><canvas id="chSec"></canvas></div></div>
    <div class="panel c4"><h3>الملاحظات حسب الخطورة</h3><div class="sub">مجموع إجابات «لا» مصنّفة حسب الخطورة النهائية</div><div class="chartbox tall"><canvas id="chSev"></canvas></div></div>
    <div class="panel c6"><h3>الزيارات شهرياً حسب التصنيف العام</h3><div class="sub">عدد الزيارات في كل شهر</div><div class="chartbox"><canvas id="chMonth"></canvas></div></div>
    <div class="panel c6"><h3>مقارنة البلديات</h3><div class="sub">متوسط الالتزام العام وعدد الملاحظات الحمراء</div><div class="chartbox"><canvas id="chMuni"></canvas></div></div>
    <div class="panel c6"><h3>الأسباب الجذرية للملاحظات</h3><div class="sub">حسب رموز ملحق ب</div><div class="chartbox"><canvas id="chRc"></canvas></div></div>
    <div class="panel c6"><h3>التغطية ومعدل التسرب (من التحضير للزيارة)</h3><div class="sub">متوسط آخر قيم مسجّلة لكل بلدية</div><div class="chartbox"><canvas id="chCov"></canvas></div></div>
    <div class="panel c12"><h3>أكثر 10 بنود تكراراً بإجابة «لا»</h3><div class="sub">ضمن الزيارات المصفّاة</div>
      <div class="tablewrap"><table><thead><tr><th>#</th><th>الكود</th><th>القسم</th><th>نص المعيار</th><th>الخطورة المرجعية</th><th>التكرار</th><th>% من الزيارات</th></tr></thead><tbody>
      ${g.top.length ? g.top.map(([c, k], i) => { const q = Q_BY_CODE[c]; return `<tr><td>${i + 1}</td><td dir="ltr">${c}</td><td>${esc(secName(q.s))}</td><td>${esc(q.t)}</td><td>${badge(q.sev)}</td><td class="num"><b>${k}</b></td><td class="num">${pct(k / g.n)}</td></tr>`; }).join("")
        : '<tr><td colspan="7" class="empty">لا توجد إجابات «لا» ضمن التصفية الحالية</td></tr>'}
      </tbody></table></div></div>
  </div>`;
  drawCharts(g);
}

function chart(id, cfg) {
  if (A.charts[id]) A.charts[id].destroy();
  const el = $(id); if (!el || !window.Chart) return;
  A.charts[id] = new Chart(el, cfg);
}
function drawCharts(g) {
  if (!window.Chart) return;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = "#5A6A79";
  const common = { responsive: true, maintainAspectRatio: false, plugins: { legend: { rtl: true, position: "bottom", labels: { boxWidth: 12 } }, tooltip: { rtl: true } } };
  const secVals = SECTIONS.map(s => g.sections[s.id] === null ? null : Math.round(g.sections[s.id] * 100));
  chart("chSec", { type: "bar", data: { labels: SECTIONS.map(s => s.n + ". " + s.name), datasets: [{ label: "% الالتزام", data: secVals,
      backgroundColor: secVals.map(v => v !== null && v < 75 ? RISK_COLORS.orange : "#0F3B5F"), borderRadius: 4 }] },
    options: { ...common, indexAxis: "y", plugins: { ...common.plugins, legend: { display: false } },
      scales: { x: { min: 0, max: 100, reverse: true, ticks: { callback: v => v + "٪" } }, y: { position: "right", ticks: { font: { size: 11 } } } } } });
  chart("chSev", { type: "doughnut", data: { labels: ["حمراء", "برتقالية", "فرص تحسين"], datasets: [{ data: [g.find.red, g.find.orange, g.find.blue], backgroundColor: [RISK_COLORS.red, RISK_COLORS.orange, RISK_COLORS.blue], borderWidth: 2 }] },
    options: { ...common, cutout: "62%" } });

  const months = {};
  A.list.forEach(v => { const m = (v.info.date || "").slice(0, 7); if (!m) return; months[m] = months[m] || { red: 0, orange: 0, green: 0 }; months[m][v._sc.overall]++; });
  const mk = Object.keys(months).sort();
  chart("chMonth", { type: "bar", data: { labels: mk, datasets: ["green", "orange", "red"].map(k => ({ label: RISK_AR[k], data: mk.map(m => months[m][k]), backgroundColor: RISK_COLORS[k], stack: "s" })) },
    options: { ...common, scales: { x: { stacked: true, reverse: true }, y: { stacked: true, ticks: { precision: 0 }, position: "right" } } } });

  const mu = {};
  A.list.forEach(v => { const m = v.info.municipality || "—"; mu[m] = mu[m] || { c: 0, n: 0, red: 0 }; if (v._sc.compliance !== null) { mu[m].c += v._sc.compliance; mu[m].n++; } mu[m].red += v._sc.red; });
  const ml = Object.keys(mu);
  chart("chMuni", { type: "bar", data: { labels: ml.map(x => x.replace("بلدية ", "")), datasets: [
      { label: "متوسط الالتزام ٪", data: ml.map(m => mu[m].n ? Math.round(mu[m].c / mu[m].n * 100) : null), backgroundColor: "#0F3B5F", yAxisID: "y" },
      { label: "ملاحظات حمراء", data: ml.map(m => mu[m].red), backgroundColor: RISK_COLORS.red, yAxisID: "y1" }] },
    options: { ...common, scales: { x: { reverse: true }, y: { min: 0, max: 100, position: "right" }, y1: { position: "left", grid: { drawOnChartArea: false }, ticks: { precision: 0 } } } } });

  const rcl = L.ROOT_CAUSES.filter(c => g.rc[c.c]);
  chart("chRc", { type: "bar", data: { labels: rcl.map(c => c.c + " — " + c.t), datasets: [{ label: "عدد الملاحظات", data: rcl.map(c => g.rc[c.c]), backgroundColor: "#D9A21B", borderRadius: 4 }] },
    options: { ...common, indexAxis: "y", plugins: { ...common.plugins, legend: { display: false } }, scales: { x: { reverse: true, ticks: { precision: 0 } }, y: { position: "right" } } } });

  const cov = {};
  A.list.forEach(v => { const m = v.info.municipality || "—"; const p = v.prep || {}; cov[m] = cov[m] || { c: [], d: [] };
    if (p.coverage !== "" && p.coverage != null) cov[m].c.push(+p.coverage); if (p.dropout !== "" && p.dropout != null) cov[m].d.push(+p.dropout); });
  const avg = a => a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : null;
  const cl = Object.keys(cov);
  chart("chCov", { type: "bar", data: { labels: cl.map(x => x.replace("بلدية ", "")), datasets: [
      { label: "التغطية ٪", data: cl.map(m => avg(cov[m].c)), backgroundColor: RISK_COLORS.green },
      { label: "معدل التسرب ٪", data: cl.map(m => avg(cov[m].d)), backgroundColor: RISK_COLORS.orange }] },
    options: { ...common, scales: { x: { reverse: true }, y: { min: 0, max: 100, position: "right" } } } });
}

// ---------- جدول الزيارات ----------
function renderVisits() {
  $("tab-visits").innerHTML = `<div class="panel" style="margin:16px 0 24px"><h3>الزيارات</h3><div class="sub">اضغط على أي زيارة لعرض تقريرها المفصل وطباعته أو تصديره</div>
  <div class="tablewrap"><table><thead><tr><th>التاريخ</th><th>رقم الزيارة</th><th>البلدية</th><th>المركز</th><th>النوع</th><th>فريق الإشراف</th><th>الالتزام</th><th>حمراء</th><th>برتقالية</th><th>متكررة</th><th>التصنيف</th></tr></thead><tbody>
  ${A.list.length ? A.list.map(v => { const s = v._sc; const c = s.compliance;
    return `<tr class="click" data-id="${esc(v.id)}" tabindex="0"><td class="num">${esc(v.info.date)}</td><td dir="ltr" style="text-align:right">${esc(v.visitNo || "")}</td><td>${esc(v.info.municipality)}</td><td><b>${esc(v.info.center)}</b></td><td>${esc(v.info.visitType || "")}</td><td>${esc(v.info.team || "")}</td>
    <td class="num"><span class="mini"><i style="width:${c === null ? 0 : c * 100}%;background:${c !== null && c < .75 ? RISK_COLORS.orange : RISK_COLORS.green}"></i></span>${pct(c)}</td>
    <td class="num" style="color:${RISK_COLORS.red};font-weight:700">${s.red}</td><td class="num" style="color:${RISK_COLORS.orange};font-weight:700">${s.orange}</td><td class="num">${v._recurring.length}</td><td>${badge(s.overall)}</td></tr>`; }).join("")
    : '<tr><td colspan="11" class="empty">لا توجد زيارات ضمن التصفية. عند إرسال أي زيارة من تطبيق الهاتف ستظهر هنا فوراً.</td></tr>'}
  </tbody></table></div></div>`;
  $("tab-visits").querySelectorAll("tr[data-id]").forEach(tr => {
    const open = () => openReport(A.all.find(v => v.id === tr.dataset.id));
    tr.onclick = open; tr.onkeydown = e => { if (e.key === "Enter") open(); };
  });
}

// ---------- خطة العمل التصحيحية ----------
function capRows() {
  const rows = [];
  A.list.forEach(v => (v.findings || []).forEach((f, i) => rows.push({ v, f, i })));
  return rows;
}
function renderCap() {
  const st = $("capStatus")?.value || "", sv = $("capSev")?.value || "", only = $("capOver")?.value || "";
  const rows = capRows().filter(({ f }) => (!st || f.status === st) && (!sv || (f.risk || Q_BY_CODE[f.code]?.sev) === sv)
    && (!only || (only === "over" ? isOverdue(f) : f.escalate)));
  $("tab-cap").innerHTML = `<div class="panel" style="margin:16px 0 24px"><h3>سجل النتائج وخطة العمل التصحيحية (CAP)</h3>
  <div class="sub">حدّث «حالة المتابعة» مباشرة من هنا — يُحفظ التعديل في قاعدة البيانات فوراً</div>
  <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
    <div class="f"><label for="capStatus">حالة المتابعة</label><select id="capStatus"><option value="">الكل</option>${L.FOLLOW_STATUS.map(s => `<option ${s === st ? "selected" : ""}>${s}</option>`).join("")}</select></div>
    <div class="f"><label for="capSev">الخطورة</label><select id="capSev"><option value="">الكل</option>${["red", "orange", "green", "blue"].map(s => `<option value="${s}" ${s === sv ? "selected" : ""}>${RISK_AR[s]}</option>`).join("")}</select></div>
    <div class="f"><label for="capOver">عرض</label><select id="capOver"><option value="">كل الإجراءات</option><option value="over" ${only === "over" ? "selected" : ""}>المتأخرة فقط</option><option value="esc" ${only === "esc" ? "selected" : ""}>المحتاجة لتصعيد</option></select></div>
  </div>
  <div class="tablewrap"><table><thead><tr><th>المركز</th><th>تاريخ الزيارة</th><th>القسم</th><th>المشكلة</th><th>الخطورة</th><th>السبب الجذري</th><th>الإجراء التصحيحي</th><th>المسؤول</th><th>الموعد النهائي</th><th>تصعيد</th><th>حالة المتابعة</th></tr></thead><tbody>
  ${rows.length ? rows.map(({ v, f, i }) => `<tr><td><a href="#" data-open="${esc(v.id)}">${esc(v.info.center)}</a><div style="font-size:.75rem;color:var(--muted)">${esc(v.info.municipality)}</div></td>
    <td class="num">${esc(v.info.date)}</td><td>${esc(secName(f.section))}</td><td>${esc(f.problem || f.text)}</td><td>${badge(f.risk || Q_BY_CODE[f.code]?.sev)}</td>
    <td>${esc((f.rootCauses || []).join("، "))}</td><td>${esc(f.action || "")}</td><td>${esc(f.responsible || "")}</td>
    <td class="num" style="${isOverdue(f) ? "color:var(--red);font-weight:700" : ""}">${esc(f.deadline || "—")}${isOverdue(f) ? " (متأخر)" : ""}</td>
    <td>${f.escalate ? '<span class="badge b-red">نعم</span>' : "لا"}</td>
    <td><select class="status-sel" data-v="${esc(v.id)}" data-i="${i}" ${v.demo ? "disabled title='بيانات توضيحية'" : ""}>${L.FOLLOW_STATUS.map(s => `<option ${s === f.status ? "selected" : ""}>${s}</option>`).join("")}</select></td></tr>`).join("")
    : '<tr><td colspan="11" class="empty">لا توجد إجراءات مطابقة</td></tr>'}
  </tbody></table></div></div>`;
  ["capStatus", "capSev", "capOver"].forEach(id => $(id).onchange = renderCap);
  $("tab-cap").querySelectorAll("a[data-open]").forEach(a => a.onclick = e => { e.preventDefault(); openReport(A.all.find(v => v.id === a.dataset.open)); });
  $("tab-cap").querySelectorAll(".status-sel").forEach(s => s.onchange = async () => {
    const v = A.all.find(x => x.id === s.dataset.v); const findings = structuredClone(v.findings);
    findings[+s.dataset.i].status = s.value;
    try { await store.updateVisit(v.id, { findings }); toast("حُفظت حالة المتابعة"); } catch (e) { toast("تعذّر الحفظ: " + (e.code || e.message)); }
  });
}

// ---------- متابعة المراكز ----------
function renderCenters() {
  const groups = {};
  A.list.forEach(v => { const k = v.info.municipality + "|" + v.info.center; (groups[k] = groups[k] || []).push(v); });
  const rows = Object.values(groups).map(vs => {
    vs.sort((a, b) => a.info.date.localeCompare(b.info.date));
    const first = vs[0], last = vs.at(-1);
    const open = vs.flatMap(v => v.findings || []).filter(f => !["مكتمل", "غير قابل للتنفيذ"].includes(f.status)).length;
    const delta = vs.length > 1 && first._sc.compliance !== null && last._sc.compliance !== null ? last._sc.compliance - first._sc.compliance : null;
    const next = last.summary?.nextVisit;
    return { first, last, n: vs.length, open, delta, next };
  }).sort((a, b) => ({ red: 0, orange: 1, green: 2 }[a.last._sc.overall] - { red: 0, orange: 1, green: 2 }[b.last._sc.overall]));
  $("tab-centers").innerHTML = `<div class="panel" style="margin:16px 0 24px"><h3>متابعة المراكز</h3><div class="sub">آخر حالة لكل مركز، والتحسّن منذ أول زيارة، والمشاكل المتكررة — مرتّبة حسب الأولوية</div>
  <div class="tablewrap"><table><thead><tr><th>البلدية</th><th>المركز</th><th>عدد الزيارات</th><th>آخر زيارة</th><th>آخر تصنيف</th><th>آخر التزام</th><th>التغيّر منذ أول زيارة</th><th>مشاكل متكررة</th><th>إجراءات مفتوحة</th><th>الزيارة القادمة</th></tr></thead><tbody>
  ${rows.length ? rows.map(r => `<tr class="click" data-id="${esc(r.last.id)}"><td>${esc(r.last.info.municipality)}</td><td><b>${esc(r.last.info.center)}</b></td><td class="num">${r.n}</td><td class="num">${esc(r.last.info.date)}</td>
    <td>${badge(r.last._sc.overall)}</td><td class="num">${pct(r.last._sc.compliance)}</td>
    <td class="num" style="font-weight:700;color:${r.delta === null ? "inherit" : r.delta >= 0 ? RISK_COLORS.green : RISK_COLORS.red}">${r.delta === null ? "—" : (r.delta >= 0 ? "▲ " : "▼ ") + Math.abs(Math.round(r.delta * 100)) + " نقطة"}</td>
    <td class="num">${r.last._recurring.length}</td><td class="num">${r.open}</td>
    <td class="num" style="${r.next && r.next < todayISO() ? "color:var(--red);font-weight:700" : ""}">${esc(r.next || "—")}${r.next && r.next < todayISO() ? " (فات موعدها)" : ""}</td></tr>`).join("")
    : '<tr><td colspan="10" class="empty">لا توجد مراكز ضمن التصفية</td></tr>'}
  </tbody></table></div></div>`;
  $("tab-centers").querySelectorAll("tr[data-id]").forEach(tr => tr.onclick = () => openReport(A.all.find(v => v.id === tr.dataset.id)));
}

// ================================================================
//  التقارير
// ================================================================
const lblOverall = { red: "أحمر — تدخل فوري", orange: "برتقالي — إجراء خلال 24–72 ساعة", green: "أخضر — الوضع مقبول" };
function secBars(sections, extra) {
  return `<div class="secbars">${SECTIONS.map(s => { const p = sections[s.id]; const c = p === null ? "#C9D2DB" : p < .75 ? RISK_COLORS.orange : RISK_COLORS.green;
    return `<div class="row"><span>${s.n}. ${esc(s.name)}</span><div class="track"><i style="width:${p === null ? 0 : p * 100}%;background:${c}"></i></div><span class="v">${pct(p)}</span><span class="c">${extra ? extra(s.id) : ""}</span></div>`; }).join("")}</div>`;
}
function narrative(v) {
  const s = v._sc, i = v.info;
  const scored = SECTIONS.filter(x => s.sections[x.id].pct !== null);
  const best = scored.filter(x => s.sections[x.id].pct === 1).map(x => x.name);
  const weak = scored.filter(x => s.sections[x.id].pct < .75).sort((a, b) => s.sections[a.id].pct - s.sections[b.id].pct);
  const redSecs = [...new Set((v.findings || []).filter(f => (f.risk || Q_BY_CODE[f.code]?.sev) === "red").map(f => secName(f.section)))];
  let t = `أُجريت زيارة إشرافية ${esc(i.visitType || "")} إلى ${esc(i.center)} (${esc(i.municipality)}) بتاريخ ${esc(i.date)}${i.team ? " من قِبل " + esc(i.team) : ""}. `;
  t += `بلغت نسبة الالتزام العامة ${pct(s.compliance)} على ${s.answered} بنداً مُجاباً من أصل ${s.total}. `;
  t += `صُنِّف المركز <b>${RISK_AR[s.overall]}</b>${s.reasons.length ? " بسبب " + s.reasons.join("، و") : " لعدم وجود ملاحظات حرجة واستيفاء كل الأقسام حد 75٪"}. `;
  if (redSecs.length) t += `تركّزت الملاحظات الحرجة في: ${redSecs.join("، ")}. `;
  if (weak.length) t += `الأقسام دون حد 75٪: ${weak.map(x => `${x.name} (${pct(s.sections[x.id].pct)})`).join("، ")}. `;
  if (best.length) t += `حقّقت الأقسام التالية التزاماً كاملاً: ${best.slice(0, 5).join("، ")}${best.length > 5 ? " وغيرها" : ""}. `;
  if (v._prev) {
    const d = s.compliance !== null && v._prev._sc.compliance !== null ? s.compliance - v._prev._sc.compliance : null;
    t += `مقارنةً بالزيارة السابقة (${esc(v._prev.info.date)} — ${RISK_AR[v._prev._sc.overall]})${d !== null ? `، ${d >= 0 ? "تحسّن" : "انخفض"} الالتزام بمقدار ${Math.abs(Math.round(d * 100))} نقطة` : ""}`;
    t += v._recurring.length ? `، وتكرّرت ${v._recurring.length} مشكلة لم تُعالَج.` : "، ولم تتكرر أي مشكلة.";
  }
  return t;
}
const kv = pairs => `<div class="kv">${pairs.map(([k, v]) => `<div>${esc(k)}</div><div>${esc(v || "—")}</div>`).join("")}</div>`;

function autoStrengths(v) {
  const x = SECTIONS.filter(s => v._sc.sections[s.id].pct === 1).slice(0, 3).map(s => s.name);
  return x.length ? x.join("، ") + " (مستخلص تلقائياً)" : "";
}
function autoRisks(v) {
  const order = { red: 0, orange: 1, blue: 2, green: 3 };
  const x = [...(v.findings || [])].sort((a, b) => order[a.risk || "green"] - order[b.risk || "green"]).filter(f => ["red", "orange"].includes(f.risk)).slice(0, 3).map(f => f.problem || f.text);
  return x.length ? x.join("؛ ") + " (مستخلص تلقائياً)" : "";
}

function buildVisitReport(v) {
  const i = v.info, s = v._sc, p = v.prep || {}, sm = v.summary || {}, dg = v.dialogue || {};
  const cell = (k, val) => `<div><small>${k}</small><b>${esc(val || "—")}</b></div>`;
  const findings = [...(v.findings || [])].sort((a, b) => "rogb".indexOf((a.risk || "g")[0]) - "rogb".indexOf((b.risk || "g")[0]));
  return `
  <div class="r-head"><img src="../assets/logo.jpg" alt=""><div><h2>تقرير الزيارة الإشرافية الداعمة لمركز التطعيم</h2><p>المركز الوطني لمكافحة الأمراض (NCDC) — إدارة التطعيمات</p></div>
    <div class="no">رقم الزيارة<br><b dir="ltr">${esc(v.visitNo || v.id)}</b></div></div>
  <div class="r-info">${cell("البلدية", i.municipality)}${cell("اسم المركز", i.center)}${cell("نوع المركز", i.centerType)}${cell("مسؤول التطعيم", i.focalPerson)}
    ${cell("فريق الإشراف", i.team)}${cell("تاريخ الزيارة", i.date)}${cell("الوقت", (i.startTime || "") + (i.endTime ? " – " + i.endTime : ""))}${cell("نوع الزيارة", i.visitType)}
    ${cell("الزيارة السابقة", i.prevDate)}${cell("إجراءات معلقة؟", i.pendingActions)}${cell("إجراءات متأخرة", String(s.overdue))}${cell("الموقع", v.geo ? `${v.geo.lat.toFixed(5)}, ${v.geo.lng.toFixed(5)}` : "")}</div>
  <div class="r-band ${s.overall}"><div><div class="lbl">التصنيف العام للمخاطر</div><div class="big">${lblOverall[s.overall]}</div></div>
    <div class="nums"><div><b>${s.red}</b><span>حمراء</span></div><div><b>${s.orange}</b><span>برتقالية</span></div><div><b>${s.blue}</b><span>فرص تحسين</span></div><div><b>${pct(s.compliance)}</b><span>الالتزام العام</span></div><div><b>${pct(s.minSection)}</b><span>أدنى قسم</span></div></div></div>

  <h3>القراءة التحليلية</h3><div class="narr">${narrative(v)}</div>

  <h3>نسبة الالتزام لكل قسم</h3>${secBars(Object.fromEntries(SECTIONS.map(x => [x.id, s.sections[x.id].pct])), id => { const x = s.sections[id]; return `نعم ${x.yes}، لا ${x.no}، لا ينطبق ${x.na}`; })}

  <h3>مؤشرات التحضير للزيارة</h3>
  ${kv([["نسبة التغطية بالجرعات الأساسية", p.coverage !== undefined && p.coverage !== "" ? p.coverage + "٪" : ""], ["معدل التسرب (Dropout)", p.dropout !== undefined && p.dropout !== "" ? p.dropout + "٪" : ""],
    ["عدد الأطفال Zero-dose", p.zeroDose], ["الفرص الضائعة المسجّلة", p.missedOpp], ["حالة توفر اللقاحات", p.stockStatus],
    ["تقارير الاستهلاك", p.consumptionNote], ["مشاكل سلسلة التبريد السابقة", p.coldChainNote], ["تصنيف الزيارة السابقة", p.prevRating], ["أهم مشكلة للتركيز", p.focus]].map(([k, x]) => [k, x === undefined || x === null ? "" : String(x)]))}

  <h3>سجل النتائج وخطة العمل التصحيحية (${findings.length})</h3>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>القسم</th><th>المشكلة (Finding)</th><th>الخطورة</th><th>السبب</th><th>الإجراء التصحيحي الفوري</th><th>الدعم المقدَّم</th><th>المسؤول</th><th>الموعد</th><th>تصعيد</th><th>الحالة</th></tr></thead><tbody>
  ${findings.length ? findings.map((f, k) => `<tr><td>${k + 1}</td><td>${esc(secName(f.section))}</td><td>${esc(f.problem || f.text)}${v._recurring.includes(f.code) ? ' <span class="badge b-grey">متكررة</span>' : ""}</td><td>${badge(f.risk || Q_BY_CODE[f.code]?.sev)}</td>
    <td>${esc((f.rootCauses || []).join("، "))}</td><td>${esc(f.action)}</td><td>${esc(f.support)}</td><td>${esc(f.responsible)}</td><td class="num">${esc(f.deadline)}</td><td>${f.escalate ? "نعم" : "لا"}</td><td>${esc(f.status)}</td></tr>`).join("")
    : '<tr><td colspan="11" class="empty">لا توجد ملاحظات — كل البنود المُجابة مستوفاة</td></tr>'}</tbody></table></div>

  ${(v.prevActions || []).length ? `<h3>مراجعة الإجراءات السابقة (القسم 15)</h3><div class="tablewrap"><table><thead><tr><th>المشكلة السابقة</th><th>الإجراء المتفق عليه</th><th>المسؤول</th><th>الموعد</th><th>الحالة</th><th>سبب عدم التنفيذ</th><th>الدعم المطلوب</th></tr></thead><tbody>
    ${v.prevActions.map(a => `<tr><td>${esc(a.problem)}</td><td>${esc(a.action)}</td><td>${esc(a.responsible)}</td><td class="num">${esc(a.deadline)}</td><td>${esc(a.status)}</td><td>${esc(a.reason)}</td><td>${esc(a.support)}</td></tr>`).join("")}</tbody></table></div>` : ""}

  ${(v.discrepancies || []).length ? `<h3>التباين بين مصدر البيانات والتقرير</h3><div class="tablewrap"><table><thead><tr><th>Source data</th><th>Reported data</th><th>Discrepancy</th><th>Corrective action</th></tr></thead><tbody>
    ${v.discrepancies.map(d => `<tr><td>${esc(d.source)}</td><td>${esc(d.reported)}</td><td>${esc(d.diff)}</td><td>${esc(d.action)}</td></tr>`).join("")}</tbody></table></div>` : ""}

  <h3>الحوار الداعم (ملحق ج)</h3>
  ${kv([...L.DIALOGUE.map((q, k) => [q, (dg.answers || [])[k]]), ["الدعم المقدَّم أثناء الزيارة", dg.supportProvided], ["الدعم المطلوب من مستوى أعلى", dg.supportRequested]])}

  <h3>الخلاصة التنفيذية</h3>
  ${kv([["الحالة العامة للمركز", RISK_AR[s.overall]],
    ["أهم 3 نقاط قوة", sm.strengths || autoStrengths(v)], ["أهم 3 مخاطر", sm.risks || autoRisks(v)], ["عدد الملاحظات الحمراء", String(s.red)], ["عدد الملاحظات البرتقالية", String(s.orange)],
    ["أهم الإجراءات الفورية المتخذة", sm.immediateActions], ["مسؤوليات البلدية", sm.muniResp], ["مسؤوليات المركز الصحي", sm.centerResp], ["مسؤوليات إدارة التطعيمات", sm.deptResp], ["موعد الزيارة/المتابعة القادمة", sm.nextVisit]])}

  <h3>تفاصيل الإجابات لكل بند</h3>
  ${SECTIONS.map(sec => `<details class="ans"><summary>القسم ${sec.n} — ${esc(sec.name)} (${pct(s.sections[sec.id].pct)})</summary><div class="tablewrap"><table><thead><tr><th>الكود</th><th>المعيار</th><th>طريقة التحقق</th><th>الإجابة</th><th>الخطورة</th><th>الملاحظة / الدليل</th></tr></thead><tbody>
    ${QUESTIONS.filter(q => q.s === sec.id).map(q => { const a = v.answers?.[q.code]; return `<tr><td dir="ltr">${q.code}</td><td>${esc(q.t)}</td><td>${esc(q.m)}</td>
      <td><b style="color:${a === "yes" ? RISK_COLORS.green : a === "no" ? RISK_COLORS.red : "inherit"}">${L.ANSWER_LABEL[a] || "—"}</b></td><td>${a === "no" ? badge(riskOf(v, q.code)) : ""}</td><td>${esc(v.notes?.[q.code] || "")}</td></tr>`; }).join("")}
  </tbody></table></div></details>`).join("")}

  <h3>إقرار الزيارة</h3>
  ${kv([["اسم مشرف الزيارة", v.signature?.name], ["صفة مشرف الزيارة", v.signature?.title], ["تاريخ الزيارة", i.date]])}
  ${v.signature?.image ? `<p><img class="sig-img" src="${v.signature.image}" alt="توقيع المشرف"></p>` : ""}
  <div class="r-foot"><span>أُعدّ آلياً من منصة الزيارات الإشرافية الداعمة — ${new Date().toLocaleDateString("ar-LY")}</span><span>إعداد د. محمد علي الجرنازي — رئيس قسم الإحصاء والمعلومات، إدارة التطعيمات</span></div>`;
}

function buildAggReport(list) {
  const g = aggregate(list), f = F();
  const groups = {};
  list.forEach(v => { const k = v.info.municipality + "|" + v.info.center; (groups[k] = groups[k] || []).push(v); });
  const lastPer = Object.values(groups).map(vs => vs.sort((a, b) => b.info.date.localeCompare(a.info.date))[0]);
  const reds = list.flatMap(v => (v.findings || []).filter(x => (x.risk || Q_BY_CODE[x.code]?.sev) === "red").map(x => ({ v, f: x })));
  const overall = g.risk.red ? "red" : g.risk.orange ? "orange" : "green";
  const weak = SECTIONS.filter(s => g.sections[s.id] !== null && g.sections[s.id] < .75);
  return `
  <div class="r-head"><img src="../assets/logo.jpg" alt=""><div><h2>التقرير المجمّع للزيارات الإشرافية الداعمة</h2><p>${esc(f.muni || "كل البلديات")} — ${esc(f.center || "كل المراكز")}${f.from || f.to ? ` — الفترة ${esc(f.from || "…")} إلى ${esc(f.to || "…")}` : ""}</p></div>
    <div class="no">تاريخ الإصدار<br><b>${todayISO()}</b></div></div>
  <div style="height:16px"></div>
  <div class="r-band ${overall}"><div><div class="lbl">عدد الزيارات</div><div class="big">${g.n} زيارة لـ ${g.centers} مركزاً</div></div>
    <div class="nums"><div><b>${g.risk.green}</b><span>خضراء</span></div><div><b>${g.risk.orange}</b><span>برتقالية</span></div><div><b>${g.risk.red}</b><span>حمراء</span></div><div><b>${pct(g.compliance)}</b><span>متوسط الالتزام</span></div></div></div>
  <h3>القراءة التحليلية</h3><div class="narr">
    شملت هذه الفترة ${g.n} زيارة إشرافية لـ ${g.centers} مركزاً، بمتوسط التزام عام ${pct(g.compliance)}. صُنِّفت ${g.risk.red} زيارة بالأحمر و${g.risk.orange} بالبرتقالي و${g.risk.green} بالأخضر.
    سُجّلت ${g.find.red} ملاحظة حمراء و${g.find.orange} ملاحظة برتقالية، ويوجد ${g.open} إجراء تصحيحي مفتوح منها ${g.overdue} متأخر عن موعده، و${g.escalated} يحتاج تصعيداً.
    ${weak.length ? `الأقسام دون حد 75٪ في المتوسط: ${weak.map(s => `${s.name} (${pct(g.sections[s.id])})`).join("، ")}.` : "جميع الأقسام فوق حد 75٪ في المتوسط."}
    ${g.recurring ? `تكرّرت ${g.recurring} مشكلة بين زيارتين متتاليتين لنفس المركز، ما يستدعي متابعة أوثق.` : ""}
  </div>
  <h3>متوسط الالتزام لكل قسم</h3>${secBars(g.sections)}
  <h3>آخر حالة لكل مركز</h3>
  <div class="tablewrap"><table><thead><tr><th>البلدية</th><th>المركز</th><th>آخر زيارة</th><th>الالتزام</th><th>حمراء</th><th>برتقالية</th><th>التصنيف</th></tr></thead><tbody>
  ${lastPer.map(v => `<tr><td>${esc(v.info.municipality)}</td><td>${esc(v.info.center)}</td><td class="num">${esc(v.info.date)}</td><td class="num">${pct(v._sc.compliance)}</td><td class="num">${v._sc.red}</td><td class="num">${v._sc.orange}</td><td>${badge(v._sc.overall)}</td></tr>`).join("")}
  </tbody></table></div>
  <h3>أكثر البنود تكراراً بإجابة «لا»</h3>
  <div class="tablewrap"><table><thead><tr><th>#</th><th>المعيار</th><th>القسم</th><th>الخطورة</th><th>التكرار</th></tr></thead><tbody>
  ${g.top.map(([c, k], i) => `<tr><td>${i + 1}</td><td>${esc(Q_BY_CODE[c].t)}</td><td>${esc(secName(Q_BY_CODE[c].s))}</td><td>${badge(Q_BY_CODE[c].sev)}</td><td class="num">${k}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">لا يوجد</td></tr>'}
  </tbody></table></div>
  <h3>الملاحظات الحمراء (تدخل فوري)</h3>
  <div class="tablewrap"><table><thead><tr><th>المركز</th><th>التاريخ</th><th>المشكلة</th><th>الإجراء</th><th>المسؤول</th><th>الحالة</th></tr></thead><tbody>
  ${reds.map(({ v, f }) => `<tr><td>${esc(v.info.center)}</td><td class="num">${esc(v.info.date)}</td><td>${esc(f.problem || f.text)}</td><td>${esc(f.action)}</td><td>${esc(f.responsible)}</td><td>${esc(f.status)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">لا توجد ملاحظات حمراء</td></tr>'}
  </tbody></table></div>
  <div class="r-foot"><span>أُعدّ آلياً من منصة الزيارات الإشرافية الداعمة</span><span>إعداد د. محمد علي الجرنازي — رئيس قسم الإحصاء والمعلومات، إدارة التطعيمات</span></div>`;
}

function openReport(v) {
  if (v?.id && N.unread.some(u => u.id === v.id)) markRead(v.id);
  if (!v) return;
  A.current = v;
  $("repTitle").textContent = `${v.info.center} — ${v.info.date}`;
  $("report").innerHTML = buildVisitReport(v);
  $("repDel").classList.toggle("hidden", !!v.demo);
  $("repXlsx").classList.remove("hidden");
  $("reportScreen").classList.remove("hidden"); $("reportScreen").scrollTop = 0; $("repClose").focus();
}
function openAgg() {
  if (!A.list.length) return toast("لا توجد زيارات ضمن التصفية");
  A.current = "agg";
  $("repTitle").textContent = "التقرير المجمّع — " + ($("fMuni").value || "كل البلديات");
  $("report").innerHTML = buildAggReport(A.list);
  $("repDel").classList.add("hidden");
  $("reportScreen").classList.remove("hidden"); $("reportScreen").scrollTop = 0;
}

// ================================================================
//  التصدير
// ================================================================
function flatVisit(v) {
  const i = v.info, p = v.prep || {}, s = v._sc, sm = v.summary || {};
  const row = {
    "رقم الزيارة": v.visitNo || v.id, "البلدية": i.municipality, "اسم المركز": i.center, "نوع المركز": i.centerType, "مسؤول التطعيم": i.focalPerson,
    "فريق الإشراف": i.team, "تاريخ الزيارة": i.date, "وقت البداية": i.startTime, "وقت النهاية": i.endTime, "نوع الزيارة": i.visitType,
    "تاريخ الزيارة السابقة": i.prevDate, "إجراءات معلقة من زيارة سابقة؟": i.pendingActions, "عدد الإجراءات المتأخرة من الزيارة السابقة": s.overdue,
    "نسبة التغطية الحالية %": p.coverage, "معدل التسرب Dropout %": p.dropout, "عدد الأطفال Zero-dose": p.zeroDose, "الفرص الضائعة المسجَّلة": p.missedOpp,
    "حالة توفر اللقاحات": p.stockStatus, "تقارير استهلاك اللقاحات (ملاحظة)": p.consumptionNote, "مشاكل سلسلة تبريد سابقة (ملاحظة)": p.coldChainNote,
    "تصنيف نتيجة الزيارة السابقة": p.prevRating, "أهم مؤشر/مشكلة للتركيز عليها": p.focus
  };
  QUESTIONS.forEach(q => row[q.code] = L.ANSWER_LABEL[v.answers?.[q.code]] || "");
  SECTIONS.forEach(x => row[`% امتثال القسم ${x.n}`] = s.sections[x.id].pct === null ? "" : +(s.sections[x.id].pct * 100).toFixed(1));
  Object.assign(row, {
    "عدد الملاحظات الحمراء": s.red, "عدد الملاحظات البرتقالية": s.orange, "عدد فرص التحسين": s.blue,
    "أدنى نسبة امتثال لقسم %": s.minSection === null ? "" : +(s.minSection * 100).toFixed(1),
    "نسبة الالتزام العامة %": s.compliance === null ? "" : +(s.compliance * 100).toFixed(1),
    "التصنيف العام للمخاطر": RISK_AR[s.overall], "مشاكل متكررة من الزيارة السابقة": v._recurring.length,
    "أهم نقاط القوة": sm.strengths, "أهم المخاطر": sm.risks, "الإجراءات الفورية": sm.immediateActions, "الدعم المقدَّم": v.dialogue?.supportProvided,
    "الدعم المطلوب من مستوى أعلى": v.dialogue?.supportRequested, "موعد الزيارة القادمة": sm.nextVisit, "المشرف": v.signature?.name,
    "خط العرض": v.geo?.lat, "خط الطول": v.geo?.lng
  });
  return row;
}
function workbook(list) {
  const wb = XLSX.utils.book_new();
  const add = (rows, name, widths) => { const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ "—": "لا توجد بيانات" }]); ws["!views"] = [{ RTL: true }]; if (widths) ws["!cols"] = widths.map(w => ({ wch: w })); XLSX.utils.book_append_sheet(wb, ws, name); };
  add(list.map(flatVisit), "إدخال_البيانات");
  add(list.flatMap(v => (v.findings || []).map(f => ({ "رقم الزيارة": v.visitNo || v.id, "اسم المركز": v.info.center, "البلدية": v.info.municipality, "تاريخ الزيارة": v.info.date,
    "القسم": secName(f.section), "كود البند": f.code, "وصف مختصر للمشكلة (Finding)": f.problem || f.text, "مستوى الخطورة": RISK_AR[f.risk || Q_BY_CODE[f.code]?.sev],
    "رمز السبب الجذري": (f.rootCauses || []).join(","), "الإجراء التصحيحي الفوري": f.action, "الدعم المقدَّم أثناء الزيارة": f.support, "المسؤول": f.responsible,
    "الموعد النهائي": f.deadline, "تصعيد؟": f.escalate ? "نعم" : "لا", "حالة المتابعة": f.status, "متأخر؟": isOverdue(f) ? "نعم" : "لا" }))), "سجل_النتائج_CAP");
  add(list.flatMap(v => (v.prevActions || []).map(a => ({ "رقم الزيارة": v.visitNo || v.id, "اسم المركز": v.info.center, "المشكلة السابقة": a.problem, "الإجراء المتفق عليه": a.action,
    "المسؤول": a.responsible, "الموعد النهائي": a.deadline, "الحالة الحالية": a.status, "سبب عدم التنفيذ": a.reason, "الدعم المطلوب": a.support }))), "مراجعة_الإجراءات_السابقة");
  add(list.map(v => { const r = { "رقم الزيارة": v.visitNo || v.id, "اسم المركز": v.info.center };
    L.DIALOGUE.forEach((q, k) => r[q] = v.dialogue?.answers?.[k] || ""); r["الدعم المقدَّم"] = v.dialogue?.supportProvided; r["الدعم المطلوب"] = v.dialogue?.supportRequested; return r; }), "الحوار_الداعم");
  const g = aggregate(list);
  add(SECTIONS.map(s => ({ "القسم": `القسم ${s.n} - ${s.name}`, "متوسط % الالتزام": g.sections[s.id] === null ? "" : +(g.sections[s.id] * 100).toFixed(1) })), "ملخص_الأقسام", [40, 18]);
  add(QUESTIONS.map(q => ({ "كود البند": q.code, "رقم القسم": +q.s.slice(1), "اسم القسم": secName(q.s), "نص معيار التقييم": q.t, "طريقة التحقق": q.m,
    "مستوى الخطورة عند عدم الاستيفاء": L.SEV_LABEL[q.sev], "تكرار (لا)": g.top.find(([c]) => c === q.code)?.[1] ?? list.filter(v => v._no.has(q.code)).length })), "بنك_الأسئلة", [10, 8, 28, 70, 22, 22, 10]);
  return wb;
}
function exportXlsx(list, name) {
  if (!window.XLSX) return toast("مكتبة Excel لم تُحمَّل — تحقق من الاتصال");
  if (!list.length) return toast("لا توجد زيارات للتصدير");
  XLSX.writeFile(workbook(list), name);
}
function exportCsv() {
  if (!A.list.length) return toast("لا توجد زيارات للتصدير");
  const rows = A.list.map(flatVisit), cols = Object.keys(rows[0]);
  const q = x => { const s = String(x ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = "\uFEFF" + [cols.map(q).join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `visits_${todayISO()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ================================================================
//  الإشعارات عند استلام تقرير جديد
//  تعمل ما دامت المنصة مفتوحة (ولو في تبويب بالخلفية)، وتُظهر عند الدخول ما وصل منذ آخر زيارة للمنصة.
// ================================================================
const NK = { seen: "ncdc_admin_seen", on: "ncdc_admin_notify", since: "ncdc_admin_since" };
const N = { known: null, unread: [], baseTitle: document.title };
const lsGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const arrivedAt = v => v.createdAt || v.submittedAt || "";

function detectNew(list) {
  const seen = new Set(lsGet(NK.seen, []));
  if (N.known === null) {
    N.known = new Set(list.map(v => v.id));
    const since = lsGet(NK.since, null);
    if (since === null) list.forEach(v => seen.add(v.id)); // أول دخول: لا نُغرق المسؤول بإشعارات قديمة
    N.unread = list.filter(v => !seen.has(v.id) && (!since || arrivedAt(v) > since));
    lsSet(NK.seen, [...seen].slice(-3000)); lsSet(NK.since, new Date().toISOString());
    if (N.unread.length) toast(`وصل ${N.unread.length} تقرير جديد منذ آخر دخول`);
    return updateBell();
  }
  const fresh = list.filter(v => !N.known.has(v.id));
  fresh.forEach(v => N.known.add(v.id));
  if (!fresh.length) return;
  N.unread = [...fresh, ...N.unread.filter(u => list.some(v => v.id === u.id))];
  lsSet(NK.since, new Date().toISOString());
  fresh.forEach(notify);
  chime(); updateBell();
}
async function notify(v) {
  const sc = v._sc?.overall, lamp = { red: "🔴", orange: "🟠", green: "🟢" }[sc] || "";
  const title = `${lamp} تقرير زيارة جديد — ${v.info?.center || ""}`;
  const body = `${v.info?.municipality || ""} — ${v.info?.date || ""}\nالمشرف: ${v.supervisorName || v.info?.team || "—"}\nالتصنيف: ${RISK_AR[sc] || "—"} (${v._sc?.red || 0} حمراء، ${v._sc?.orange || 0} برتقالية)`;
  toast(`وصل تقرير جديد: ${v.info?.center || ""}`);
  if (!lsGet(NK.on, false) || !("Notification" in window) || Notification.permission !== "granted") return;
  const opts = { body, icon: "../icons/icon-192.png", badge: "../icons/icon-192.png", tag: "visit-" + v.id, data: { id: v.id, url: location.href } };
  try {
    const reg = await navigator.serviceWorker?.getRegistration?.("../");
    if (reg) return reg.showNotification(title, opts);
  } catch { }
  try { const n = new Notification(title, opts); n.onclick = () => { window.focus(); openFromNotif(v.id); n.close(); }; } catch { }
}
function openFromNotif(id) { const v = A.all.find(x => x.id === id); if (v) { markRead(id); openReport(v); } }
function chime() {
  if (!lsGet(NK.on, false)) return;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [880, 1175].forEach((f, i) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination);
      const t = ac.currentTime + i * .18; g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + .3); o.start(t); o.stop(t + .32); });
  } catch { }
}
function markRead(id) {
  const seen = new Set(lsGet(NK.seen, []));
  (id ? [id] : N.unread.map(v => v.id)).forEach(x => seen.add(x));
  lsSet(NK.seen, [...seen].slice(-3000));
  N.unread = id ? N.unread.filter(v => v.id !== id) : [];
  updateBell();
}
function updateBell() {
  const n = N.unread.length;
  $("bell").classList.remove("hidden");
  $("bellCount").textContent = n > 99 ? "99+" : n; $("bellCount").classList.toggle("hidden", !n);
  $("bell").classList.toggle("ring", !!n);
  document.title = n ? `(${n}) ${N.baseTitle}` : N.baseTitle;
  if (!$("notifPanel").classList.contains("hidden")) renderNotifPanel();
}
function renderNotifPanel() {
  const on = lsGet(NK.on, false), sup = "Notification" in window, perm = sup ? Notification.permission : "unsupported";
  $("npPerm").innerHTML = !sup ? '<p>المتصفح لا يدعم إشعارات النظام؛ ستظهر التنبيهات داخل المنصة فقط.</p>'
    : perm === "denied" ? '<p>الإشعارات محظورة لهذا الموقع في إعدادات المتصفح. اسمح بها من رمز القفل بجانب الرابط.</p>'
    : on && perm === "granted" ? '<p class="ok">✓ الإشعارات مفعّلة: تنبيه صوتي وإشعار على الجهاز عند وصول أي تقرير.</p><button class="btn ghost sm" id="npOff" type="button">إيقاف الإشعارات</button>'
    : '<p>فعّل الإشعارات لتصلك رسالة وتنبيه صوتي فور استلام أي تقرير زيارة.</p><button class="btn gold sm" id="npOn" type="button">تفعيل الإشعارات</button>';
  $("npList").innerHTML = N.unread.length ? N.unread.map(v => `<button class="np-item" data-id="${esc(v.id)}" type="button">
      ${badge(v._sc?.overall)} <span><b>${esc(v.info?.center)}</b><small>${esc(v.info?.municipality)} — ${esc(v.info?.date)} — ${esc(v.supervisorName || v.info?.team || "")}</small></span></button>`).join("")
    : '<p class="empty">لا توجد تقارير جديدة غير مقروءة.</p>';
  $("npOn")?.addEventListener("click", async () => {
    let p = Notification.permission;
    if (p !== "granted") p = await Notification.requestPermission();
    if (p === "granted") { lsSet(NK.on, true); chime(); toast("تم تفعيل الإشعارات"); notifyTest(); } else toast("لم يُسمح بالإشعارات");
    renderNotifPanel();
  });
  $("npOff")?.addEventListener("click", () => { lsSet(NK.on, false); renderNotifPanel(); });
  $("npList").querySelectorAll(".np-item").forEach(b => b.onclick = () => { $("notifPanel").classList.add("hidden"); openFromNotif(b.dataset.id); });
}
async function notifyTest() {
  const opts = { body: "ستصلك رسالة مثل هذه عند استلام كل تقرير زيارة.", icon: "../icons/icon-192.png", tag: "test" };
  try { const reg = await navigator.serviceWorker?.getRegistration?.("../"); if (reg) return reg.showNotification("الإشعارات تعمل ✓", opts); } catch { }
  try { new Notification("الإشعارات تعمل ✓", opts); } catch { }
}
function wireNotif() {
  $("bell").onclick = e => { e.stopPropagation(); const p = $("notifPanel"); p.classList.toggle("hidden"); if (!p.classList.contains("hidden")) renderNotifPanel(); };
  $("npRead").onclick = () => markRead();
  document.addEventListener("click", e => { if (!e.target.closest("#notifPanel, #bell")) $("notifPanel").classList.add("hidden"); });
  // عامل الخدمة يتيح إظهار الإشعارات على أندرويد، ويفتح التقرير عند الضغط على الإشعار
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("../sw.js", { scope: "../" }).catch(() => { });
    navigator.serviceWorker.addEventListener("message", e => { if (e.data?.type === "open-visit") openFromNotif(e.data.id); });
  }
}

// ================================================================
//  تصفير البيانات (حذف الزيارات) — للإدارة فقط
// ================================================================
function wireReset() {
  const dlg = $("resetDlg"), word = "حذف";
  const scope = () => document.querySelector('input[name="rsScope"]:checked').value;
  const target = () => scope() === "all" ? A.all.filter(v => !v.demo) : A.list.filter(v => !v.demo);
  const sync = () => { $("rsGo").disabled = $("rsConfirm").value.trim() !== word || !target().length; $("rsGo").textContent = `حذف نهائي (${target().length})`; };
  $("resetData").onclick = () => {
    if (!A.all.length) return toast("لا توجد بيانات");
    $("rsN1").textContent = A.list.length; $("rsN2").textContent = A.all.length;
    $("rsConfirm").value = ""; $("rsProg").textContent = ""; dlg.classList.remove("hidden"); sync(); $("rsConfirm").focus();
  };
  document.querySelectorAll('input[name="rsScope"]').forEach(r => r.onchange = sync);
  $("rsConfirm").oninput = sync;
  $("rsCancel").onclick = () => dlg.classList.add("hidden");
  dlg.addEventListener("click", e => { if (e.target === dlg) dlg.classList.add("hidden"); });
  $("rsBackup").onclick = () => exportXlsx(target(), `نسخة_احتياطية_قبل_التصفير_${todayISO()}.xlsx`);
  $("rsGo").onclick = async () => {
    const ids = target().map(v => v.id);
    if (!ids.length || $("rsConfirm").value.trim() !== word) return;
    $("rsGo").disabled = true; $("rsCancel").disabled = true;
    try {
      const n = await store.deleteVisits(ids, (d, t) => $("rsProg").textContent = `جارٍ الحذف… ${d} من ${t}`);
      dlg.classList.add("hidden"); toast(`حُذفت ${n} زيارة`); markRead();
    } catch (e) { $("rsProg").textContent = "تعذّر الحذف: " + (e.code || e.message); }
    $("rsCancel").disabled = false; sync();
  };
}

// ================================================================
//  الإقلاع والمصادقة
// ================================================================
function wireUI() {
  document.querySelectorAll(".tab").forEach(t => t.onclick = () => {
    A.tab = t.dataset.tab; document.querySelectorAll(".tab").forEach(x => x.setAttribute("aria-selected", x === t)); renderTab();
  });
  fillSelect($("fType"), L.VISIT_TYPES, "كل الأنواع");
  $("fRisk").innerHTML = `<option value="">كل التصنيفات</option><option value="red">أحمر</option><option value="orange">برتقالي</option><option value="green">أخضر</option>`;
  $("fMuni").onchange = () => { refreshCenters(); applyFilters(); };
  ["fCenter", "fFrom", "fTo", "fType", "fRisk"].forEach(id => $(id).onchange = applyFilters);
  $("fReset").onclick = () => { ["fMuni", "fCenter", "fFrom", "fTo", "fType", "fRisk"].forEach(id => $(id).value = ""); refreshCenters(); applyFilters(); };
  $("expXlsx").onclick = () => exportXlsx(A.list, `تحليل_الزيارات_الإشرافية_${todayISO()}.xlsx`);
  $("expCsv").onclick = exportCsv;
  $("aggReport").onclick = openAgg;
  $("repClose").onclick = () => { $("reportScreen").classList.add("hidden"); A.current = null; };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("reportScreen").classList.contains("hidden")) $("repClose").click(); });
  $("repPrint").onclick = () => window.print();
  window.addEventListener("beforeprint", () => document.querySelectorAll("details.ans").forEach(d => d.open = true));
  $("repXlsx").onclick = () => A.current === "agg" ? exportXlsx(A.list, `التقرير_المجمع_${todayISO()}.xlsx`)
    : exportXlsx([A.current], `تقرير_زيارة_${(A.current.info.center || "").replace(/\s+/g, "_")}_${A.current.info.date}.xlsx`);
  $("repDel").onclick = async () => {
    const v = A.current; if (!v || v === "agg") return;
    if (!confirm(`حذف زيارة «${v.info.center}» بتاريخ ${v.info.date} نهائياً؟ لا يمكن التراجع.`)) return;
    try { await store.deleteVisit(v.id); $("repClose").click(); toast("حُذفت الزيارة"); } catch (e) { toast("تعذّر الحذف: " + (e.code || e.message)); }
  };
}

function showLogin(msg = "") {
  $("loginView").classList.remove("hidden"); $("mainView").classList.add("hidden"); $("userBox").innerHTML = "";
  $("lerr").textContent = msg;
  $("loginForm").onsubmit = async e => {
    e.preventDefault(); $("lerr").textContent = "جارٍ التحقق…";
    try { await store.login($("lem").value, $("lpw").value); } catch { $("lerr").textContent = "بيانات الدخول غير صحيحة."; }
  };
}
function startData() {
  A.unsub?.();
  N.known = null;
  A.unsub = store.watchVisits(list => {
    A.all = enrich(list); refreshFilterOptions(); applyFilters();
    detectNew(A.all);
    if (A.current && A.current !== "agg") { const v = A.all.find(x => x.id === A.current.id); v ? openReport(v) : $("repClose").click(); }
    else if (A.current === "agg") openAgg();
  }, err => { toast("تعذّر قراءة البيانات: " + (err.code || err.message)); });
}

(async function boot() {
  wireUI(); wireNotif(); wireReset();
  if (store.demoMode) $("demoFlag").classList.remove("hidden");
  try { await store.init(); } catch { document.body.insertAdjacentHTML("beforeend", '<p class="empty">تعذّر تحميل Firebase — تحقق من الاتصال.</p>'); return; }
  store.onUser(async user => {
    if (!user) { A.unsub?.(); return showLogin(); }
    let prof = null; try { prof = await store.getProfile(user); } catch { }
    if (prof?.role !== "admin") { await store.logout(); return showLogin("هذا الحساب ليست لديه صلاحية الإدارة."); }
    $("loginView").classList.add("hidden"); $("mainView").classList.remove("hidden");
    $("userBox").innerHTML = `${esc(prof.name || user.email)}${store.demoMode ? "" : '<button id="logout" type="button">خروج</button>'}`;
    $("logout")?.addEventListener("click", () => store.logout());
    startData();
  });
})();
