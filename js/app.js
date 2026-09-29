// ================================================================
//  تطبيق الهاتف — الزيارة الإشرافية الداعمة لمراكز التطعيم
//  المركز الوطني لمكافحة الأمراض (NCDC) — إدارة التطعيمات
//  إعداد: د. محمد علي الجرنازي
// ================================================================
import { SECTIONS, QUESTIONS } from "./questions.js";
import { computeScores, riskOf, pct, Q_BY_CODE } from "./scoring.js";
import * as L from "./lists.js";
import * as store from "./store.js";
import { APP_VERSION } from "./firebase-config.js";

const $app = document.getElementById("app");
const K = { drafts: "ncdc_drafts", queue: "ncdc_queue", sent: "ncdc_sent", centers: "ncdc_centers", name: "ncdc_sup_name" };
const S = { user: null, profile: null, view: "boot", visit: null, step: 0 };

// ---------- أدوات ----------
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { toast("تعذّر الحفظ المحلي: الذاكرة ممتلئة"); } };
const today = () => new Date().toISOString().slice(0, 10);
const nowHM = () => new Date().toTimeString().slice(0, 5);
const getPath = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
function setPath(o, p, v) { const ks = p.split("."); let c = o; ks.slice(0, -1).forEach(k => { c[k] = c[k] ?? {}; c = c[k]; }); c[ks.at(-1)] = v; }
function toast(msg, ms = 2600) {
  const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; t.setAttribute("role", "status");
  document.body.appendChild(t); setTimeout(() => t.remove(), ms);
}
const ICON = {
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  save: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/></svg>'
};

// ---------- تثبيت التطبيق على الهاتف ----------
let deferredPrompt = null;
const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredPrompt = e; if (S.view === "home") render(); });
window.addEventListener("appinstalled", () => { deferredPrompt = null; toast("تم تثبيت التطبيق على الشاشة الرئيسية"); if (S.view === "home") render(); });
const canOfferInstall = () => !isStandalone();
async function doInstall() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    const r = await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    if (r?.outcome === "accepted") return;
    return render();
  }
  showInstallHelp();
}
function showInstallHelp() {
  const ios = isIOS();
  const box = document.createElement("div");
  box.className = "sheet"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", "طريقة تثبيت التطبيق");
  box.innerHTML = `<div class="sheet-card">
    <img src="icons/icon-192.png" alt="" class="sheet-icon">
    <h3>تثبيت التطبيق على الهاتف</h3>
    ${ios ? `<ol><li>افتح هذا الرابط في متصفح <b>Safari</b>.</li><li>اضغط زر المشاركة <span class="kbd">⬆︎</span> في أسفل الشاشة.</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> (Add to Home Screen).</li><li>اضغط <b>«إضافة»</b>.</li></ol>`
          : `<ol><li>افتح هذا الرابط في متصفح <b>Chrome</b>.</li><li>اضغط القائمة <span class="kbd">⋮</span> في أعلى الشاشة.</li><li>اختر <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</li><li>اضغط <b>«تثبيت»</b>.</li></ol>`}
    <p>بعدها تظهر أيقونة المركز على شاشة هاتفك ويفتح التطبيق مباشرة ويعمل دون إنترنت.</p>
    <button class="btn block" type="button">حسناً</button></div>`;
  box.addEventListener("click", e => { if (e.target === box || e.target.tagName === "BUTTON") box.remove(); });
  document.body.appendChild(box); box.querySelector("button").focus();
}
const ICON_INSTALL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M12 7v7M9 11l3 3 3-3M10 18h4"/></svg>';

// ---------- الخطوات ----------
function steps() {
  const v = S.visit;
  const list = [
    { id: "info", title: "معلومات الزيارة", kicker: "القسم 1" },
    { id: "prep", title: "التحضير للزيارة", kicker: "القسم 2" }
  ];
  if (v?.info?.pendingActions === "نعم") list.push({ id: "prev", title: "مراجعة الإجراءات السابقة", kicker: "القسم 15" });
  SECTIONS.forEach(s => list.push({ id: s.id, title: s.name, kicker: "القسم " + s.n, sec: s }));
  list.push({ id: "dialogue", title: "الحوار الداعم", kicker: "ملحق ج" });
  list.push({ id: "summary", title: "الخلاصة والإرسال", kicker: "ملحق هـ" });
  return list;
}

// ---------- المسودات والطابور ----------
let saveTimer;
function saveDraft(now) {
  clearTimeout(saveTimer);
  const doIt = () => { if (!S.visit) return; const d = load(K.drafts, {}); S.visit.updatedAt = new Date().toISOString(); d[S.visit.localId] = S.visit; save(K.drafts, d); };
  now ? doIt() : (saveTimer = setTimeout(doIt, 400));
}
function newVisit() {
  const d = new Date();
  const no = "V-" + d.toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase();
  return {
    localId: "L" + Date.now(), visitNo: no, appVersion: APP_VERSION,
    info: { date: today(), startTime: nowHM(), visitType: "روتينية", pendingActions: "لا", overdueCount: 0, team: S.profile?.name || "" },
    prep: {}, answers: {}, notes: {}, findings: [], prevActions: [], discrepancies: [],
    dialogue: { answers: ["", "", "", "", ""], supportProvided: "", supportRequested: "" },
    summary: {}, signature: { name: S.profile?.name || "", title: "" }, geo: null
  };
}
async function flushQueue() {
  const q = load(K.queue, []);
  if (!q.length || !navigator.onLine) return;
  if (!store.demoMode && !store.currentUser()) { try { await store.loginAnon(); } catch { return; } }
  const remain = [];
  for (const v of q) {
    try {
      const id = await store.submitVisit(v);
      const sent = load(K.sent, []);
      sent.unshift({ id, visitNo: v.visitNo, center: v.info.center, municipality: v.info.municipality, date: v.info.date, overall: v.scores?.overall });
      save(K.sent, sent.slice(0, 50));
    } catch (e) { console.warn(e); remain.push(v); }
  }
  save(K.queue, remain);
  if (remain.length < q.length) toast(`تم إرسال ${q.length - remain.length} زيارة إلى منصة الإدارة`);
  if (S.view === "home") render();
}
window.addEventListener("online", flushQueue);

function learnCenter(m, c) {
  if (!m || !c) return;
  const x = load(K.centers, {}); x[m] = [...new Set([...(x[m] || []), c])]; save(K.centers, x);
}
function centersFor(m) { return [...new Set([...(L.CENTERS[m] || []), ...(load(K.centers, {})[m] || [])])]; }

// ================================================================
//  العرض
// ================================================================
function render() {
  renderView();
  document.getElementById("installTop")?.addEventListener("click", doInstall);
}
function renderView() {
  if (S.view === "login") return renderLogin();
  if (S.view === "home") return renderHome();
  if (S.view === "visit") return renderVisit();
  if (S.view === "done") return renderDone();
  $app.innerHTML = `<div class="brand"><div class="wrap"><img src="assets/logo.jpg" alt=""><div><h1>جارٍ التحميل…</h1></div></div></div>`;
}

const brand = sub => `
  ${store.demoMode ? '<div class="demo-flag">وضع التجربة — البيانات تُحفظ على هذا الجهاز فقط حتى يُضبط Firebase</div>' : ""}
  <header class="brand"><div class="wrap">
    <img src="assets/logo.jpg" alt="شعار المركز الوطني لمكافحة الأمراض">
    <div><h1>الزيارة الإشرافية الداعمة<br>لمراكز التطعيم</h1><p>${esc(sub || "المركز الوطني لمكافحة الأمراض — إدارة التطعيمات")}</p><p class="by">إعداد: د. محمد الجرنازي</p></div>
    ${canOfferInstall() ? `<button class="installbtn" id="installTop" type="button" aria-label="تثبيت التطبيق على الهاتف">${ICON_INSTALL}<span>تثبيت</span></button>` : ""}
  </div></header>`;

const credit = `<div class="credit">إعداد <b>د. محمد الجرنازي</b><br>رئيس قسم الإحصاء والمعلومات — إدارة التطعيمات</div>`;

function renderLogin(err = "") {
  $app.innerHTML = brand() + `
  <main class="wrap login"><div class="card">
    <h2>تسجيل دخول المشرف</h2><p>استخدم الحساب الذي أنشأته لك إدارة التطعيمات.</p>
    <form id="lf" novalidate>
      <div class="field"><label for="em">البريد الإلكتروني</label><input id="em" type="email" autocomplete="username" required dir="ltr"></div>
      <div class="field"><label for="pw">كلمة المرور</label><input id="pw" type="password" autocomplete="current-password" required dir="ltr"></div>
      <button class="btn block" type="submit">دخول</button>
      <div class="err" id="lerr">${esc(err)}</div>
    </form>
    <button class="linkbtn" id="forgot" type="button">نسيت كلمة المرور؟</button>
  </div>${credit}</main>`;
  document.getElementById("lf").onsubmit = async e => {
    e.preventDefault();
    const em = document.getElementById("em").value, pw = document.getElementById("pw").value;
    const out = document.getElementById("lerr"); out.textContent = "جارٍ التحقق…";
    try { await store.login(em, pw); }
    catch (x) { out.textContent = "البريد أو كلمة المرور غير صحيحة، أو لا يوجد اتصال بالإنترنت."; }
  };
  document.getElementById("forgot").onclick = async () => {
    const em = document.getElementById("em").value;
    if (!em) return toast("اكتب بريدك أولاً ثم اضغط «نسيت كلمة المرور»");
    try { await store.resetPassword(em); toast("أُرسل رابط إعادة التعيين إلى بريدك"); } catch { toast("تعذّر الإرسال — تحقق من البريد"); }
  };
}

function renderHome() {
  const drafts = Object.values(load(K.drafts, {})).sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const queue = load(K.queue, []), sent = load(K.sent, []);
  const lamp = o => `<span class="dot" style="background:var(--${o || "line"})"></span>`;
  const anon = S.profile?.anon;
  const needName = anon && !S.profile.name;
  $app.innerHTML = brand() + `
  <main class="wrap home">
    ${S.authErr ? `<p class="callout">${esc(S.authErr)}</p>` : ""}
    ${canOfferInstall() ? `<button class="installcard" id="installCard" type="button"><span class="ic">${ICON_INSTALL}</span><span class="tx"><b>ثبّت التطبيق على هاتفك</b><small>أيقونة على الشاشة الرئيسية، ويعمل دون إنترنت في الميدان</small></span><span class="go">تثبيت</span></button>` : ""}
    ${anon ? `<div class="namecard${needName ? " need" : ""}"><label for="supname">اسم المشرف (يظهر في التقارير)</label>
      <div class="namerow"><input id="supname" value="${esc(S.profile.name || "")}" placeholder="اكتب اسمك الثلاثي" autocomplete="name"><button class="btn" id="savename" type="button">حفظ</button></div></div>` : ""}
    <button class="start-btn" id="new"><span>بدء زيارة إشرافية جديدة</span>${ICON.plus}</button>
    <p class="cycle"><b>التقييم</b> ← التحليل ← <b>التوجيه الفني</b> ← التصحيح الفوري ← <b>خطة العمل</b> ← المتابعة ← تحسّن قابل للقياس</p>

    ${queue.length ? `<section class="list-block"><h2>بانتظار الإرسال <small>${queue.length}</small></h2>
      ${queue.map(v => `<div class="item">${lamp(v.scores?.overall)}<div class="grow"><div class="t">${esc(v.info.center)}</div><div class="s">${esc(v.info.date)} — ستُرسل تلقائياً عند توفر الإنترنت</div></div></div>`).join("")}
      <button class="btn ghost block" id="sync">إعادة المحاولة الآن</button></section>` : ""}

    <section class="list-block"><h2>المسودات <small>${drafts.length}</small></h2>
      ${drafts.length ? drafts.map(v => {
        const sc = computeScores(v);
        return `<div class="item">${lamp(sc.answered ? sc.overall : "")}<div class="grow"><div class="t">${esc(v.info.center || "زيارة بدون اسم مركز")}</div><div class="s">${esc(v.info.date)} — ${sc.answered}/${sc.total} بنداً</div></div>
        <button data-del="${v.localId}" aria-label="حذف المسودة">حذف</button><button class="primary" data-open="${v.localId}">متابعة</button></div>`;
      }).join("") : '<div class="empty">لا توجد مسودات. تُحفظ الزيارة تلقائياً أثناء التعبئة.</div>'}
    </section>

    <section class="list-block"><h2>الزيارات المرسلة <small>${sent.length}</small></h2>
      ${sent.length ? sent.slice(0, 10).map(v => `<div class="item">${lamp(v.overall)}<div class="grow"><div class="t">${esc(v.center)}</div><div class="s">${esc(v.municipality || "")} — ${esc(v.date)} — ${esc(v.visitNo)}</div></div></div>`).join("")
        : '<div class="empty">لم تُرسل أي زيارة من هذا الجهاز بعد.</div>'}
    </section>

    <div class="userbar"><span>${esc(S.profile?.name || S.user?.email || "")}</span>${store.demoMode ? '<a class="linkbtn" href="admin/">فتح منصة الإدارة (تجربة)</a>' : anon ? "" : '<button class="linkbtn" id="out">تسجيل الخروج</button>'}</div>
    ${credit}
  </main>`;
  document.getElementById("installCard")?.addEventListener("click", doInstall);
  document.getElementById("savename")?.addEventListener("click", () => {
    const v = document.getElementById("supname").value.trim();
    if (!v) return toast("اكتب اسمك أولاً");
    save(K.name, v); S.profile.name = v; toast("حُفظ الاسم"); render();
  });
  document.getElementById("new").onclick = () => {
    if (S.profile?.anon && !S.profile.name) { toast("اكتب اسمك واضغط «حفظ» قبل بدء الزيارة"); document.getElementById("supname")?.focus(); return; }
    S.visit = newVisit(); S.step = 0; S.view = "visit"; saveDraft(true); render(); };
  document.getElementById("sync")?.addEventListener("click", flushQueue);
  document.getElementById("out")?.addEventListener("click", () => store.logout());
  $app.querySelectorAll("[data-open]").forEach(b => b.onclick = () => {
    S.visit = load(K.drafts, {})[b.dataset.open]; S.step = 0; S.view = "visit"; render();
  });
  $app.querySelectorAll("[data-del]").forEach(b => b.onclick = () => {
    if (!confirm("حذف هذه المسودة نهائياً؟")) return;
    const d = load(K.drafts, {}); delete d[b.dataset.del]; save(K.drafts, d); render();
  });
}

// ---------- مكوّنات الحقول ----------
function fld(label, path, o = {}) {
  const v = getPath(S.visit, path) ?? "";
  const id = "f_" + path.replace(/\./g, "_");
  const req = o.req ? ' <span class="req">*</span>' : "";
  let input;
  if (o.options) input = `<select id="${id}" data-bind="${path}"><option value="">— اختر —</option>${o.options.map(x => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  else if (o.area) input = `<textarea id="${id}" data-bind="${path}" placeholder="${esc(o.ph || "")}">${esc(v)}</textarea>`;
  else input = `<input id="${id}" data-bind="${path}" type="${o.type || "text"}" value="${esc(v)}" ${o.list ? `list="${o.list}"` : ""} ${o.type === "number" ? 'inputmode="decimal"' : ""} placeholder="${esc(o.ph || "")}" ${o.dir ? `dir="${o.dir}"` : ""}>`;
  return `<div class="field"><label for="${id}">${esc(label)}${req}</label>${input}${o.hint ? `<div class="hint">${esc(o.hint)}</div>` : ""}</div>`;
}
function chipsFld(label, path, options) {
  const v = getPath(S.visit, path);
  return `<div class="field"><label>${esc(label)}</label><div class="chips">${options.map(x =>
    `<button type="button" class="chip" data-setpath="${path}" data-val="${esc(x)}" aria-pressed="${x === v}">${esc(x)}</button>`).join("")}</div></div>`;
}

// ---------- معالج الزيارة ----------
function renderVisit() {
  const st = steps(); if (S.step >= st.length) S.step = st.length - 1;
  const cur = st[S.step];
  const sc = computeScores(S.visit);
  $app.innerHTML = `
  <div class="topbar">
    <div class="wrap row">
      <button class="icon" id="home" aria-label="العودة للرئيسية">${ICON.back}</button>
      <div class="ttl"><b>${esc(S.visit.info.center || "زيارة جديدة")}</b><span>${esc(S.visit.visitNo)} — تُحفظ تلقائياً</span></div>
      <button class="icon" id="savebtn" aria-label="حفظ المسودة">${ICON.save}</button>
    </div>
    <div class="progress"><i style="width:${Math.round(sc.answered / sc.total * 100)}%"></i></div>
  </div>
  <nav class="steps" id="steps" aria-label="أقسام الأداة">${st.map((s, i) => stepChip(s, i, sc)).join("")}</nav>
  <main class="wrap">
    <div class="stephead"><div class="kicker">${esc(cur.kicker)}</div><h2>${esc(cur.title)}</h2>${cur.sec ? secStat(cur.sec.id, sc) : ""}</div>
    <div class="body" id="body">${stepBody(cur)}</div>
  </main>
  ${rail(sc, st)}`;
  document.getElementById("steps").querySelector(".cur")?.scrollIntoView({ inline: "center", block: "nearest" });
  wireVisit();
  if (cur.id === "summary") wireSignature();
}

function stepChip(s, i, sc) {
  let cls = "";
  if (s.sec) {
    const qs = QUESTIONS.filter(q => q.s === s.id);
    const done = qs.every(q => S.visit.answers[q.code]);
    const nos = qs.filter(q => S.visit.answers[q.code] === "no").map(q => riskOf(S.visit, q.code));
    cls = nos.includes("red") ? "hasred" : nos.includes("orange") ? "hasorange" : done ? "done" : "";
  }
  return `<button class="step ${cls} ${i === S.step ? "cur" : ""}" data-go="${i}"><span class="sd"></span>${s.sec ? s.sec.n + ". " : ""}${esc(s.title)}</button>`;
}
function secStat(sid, sc) {
  const s = sc.sections[sid]; const qs = QUESTIONS.filter(q => q.s === sid);
  const ans = qs.filter(q => S.visit.answers[q.code]).length;
  return `<div class="secstat" id="secstat"><span>${ans}/${qs.length} بنداً</span><div class="secbar"><i style="width:${s.pct === null ? 0 : Math.round(s.pct * 100)}%;background:${s.pct !== null && s.pct < .75 ? "var(--orange)" : "var(--green)"}"></i></div><span>الالتزام ${pct(s.pct)}</span></div>`;
}
function rail(sc, st) {
  const lbl = { red: "أحمر — تدخل فوري", orange: "برتقالي — إجراء خلال 24–72 ساعة", green: "أخضر — الوضع مقبول" }[sc.overall];
  return `<div class="rail"><div class="wrap">
    <div class="light"><span class="lamp ${sc.answered ? sc.overall : ""}" id="lamp" style="${sc.answered ? "" : "background:var(--line)"}"></span>
      <div class="lt" id="lt"><b>${sc.answered ? lbl : "لم يبدأ التقييم"}</b>
      <span class="counts"><span style="background:var(--red-soft);color:var(--red)">${sc.red} حمراء</span><span style="background:var(--orange-soft);color:var(--orange)">${sc.orange} برتقالية</span></span></div></div>
    <div class="nav">${S.step > 0 ? '<button class="btn ghost" id="prev">السابق</button>' : ""}${S.step < st.length - 1 ? '<button class="btn" id="next">التالي</button>' : ""}</div>
  </div></div>`;
}
function refreshLive() {
  const sc = computeScores(S.visit), st = steps();
  document.querySelector(".rail").outerHTML = rail(sc, st);
  document.getElementById("steps").innerHTML = st.map((s, i) => stepChip(s, i, sc)).join("");
  const cur = st[S.step];
  if (cur.sec) document.getElementById("secstat").outerHTML = secStat(cur.sec.id, sc);
  document.querySelector(".progress i").style.width = Math.round(sc.answered / sc.total * 100) + "%";
  wireNav();
}

function stepBody(cur) {
  const v = S.visit;
  if (cur.id === "info") return `
    <datalist id="dl-muni">${L.MUNICIPALITIES.map(m => `<option value="${esc(m)}">`).join("")}</datalist>
    <datalist id="dl-center">${centersFor(v.info.municipality).map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    ${fld("البلدية", "info.municipality", { req: 1, list: "dl-muni", ph: "اكتب أو اختر البلدية" })}
    ${fld("اسم المركز", "info.center", { req: 1, list: "dl-center", ph: "اكتب أو اختر المركز" })}
    <div id="lastinfo"></div>
    ${fld("نوع المركز", "info.centerType", { options: L.CENTER_TYPES })}
    ${fld("اسم مسؤول التطعيم بالمركز", "info.focalPerson")}
    ${fld("أسماء فريق الإشراف", "info.team", { req: 1, ph: "مثال: د. هدى المبروك / أ. نجاة الفيتوري" })}
    <div class="grid2">${fld("تاريخ الزيارة", "info.date", { type: "date", req: 1 })}${fld("تاريخ الزيارة السابقة", "info.prevDate", { type: "date" })}</div>
    <div class="grid2">${fld("وقت البداية", "info.startTime", { type: "time" })}${fld("وقت النهاية", "info.endTime", { type: "time" })}</div>
    ${chipsFld("نوع الزيارة", "info.visitType", L.VISIT_TYPES)}
    ${chipsFld("هل توجد إجراءات معلقة من الزيارة السابقة؟", "info.pendingActions", ["نعم", "لا"])}
    ${v.info.pendingActions === "نعم" ? '<div class="callout">عند وجود إجراءات معلقة يُنتقل إلى <b>القسم 15 — مراجعة الإجراءات السابقة</b> قبل بدء التقييم. أُضيف القسم بعد «التحضير للزيارة».</div>' : ""}
    ${fld("عدد الإجراءات المتأخرة عن موعدها من الزيارة السابقة", "info.overdueCount", { type: "number" })}`;

  if (cur.id === "prep") return `
    <p class="callout">يُعبَّأ قبل التحرك إلى المركز من البيانات الروتينية المتاحة وملف الزيارة السابقة، ويحدد أولويات التركيز.</p>
    <div class="grid2">${fld("نسبة التغطية بالجرعات الأساسية % (HEXA, MMR)", "prep.coverage", { type: "number" })}${fld("معدل التسرب Dropout % (HEXA/DPT, MMR)", "prep.dropout", { type: "number" })}</div>
    <div class="grid2">${fld("عدد الأطفال Zero-dose", "prep.zeroDose", { type: "number" })}${fld("الفرص الضائعة المسجَّلة", "prep.missedOpp", { type: "number" })}</div>
    ${chipsFld("حالة توفر اللقاحات وقت آخر تقرير", "prep.stockStatus", L.STOCK_STATUS)}
    ${fld("تقارير استهلاك اللقاحات (ملاحظة)", "prep.consumptionNote", { area: 1 })}
    ${fld("مشاكل سلسلة تبريد مسجَّلة سابقاً (أعطال، تجاوزات حرارية)", "prep.coldChainNote", { area: 1 })}
    ${chipsFld("تصنيف نتيجة الزيارة السابقة", "prep.prevRating", L.RATINGS)}
    ${fld("أهم مؤشر أو مشكلة يستوجب التركيز عليها في هذه الزيارة", "prep.focus", { area: 1 })}`;

  if (cur.id === "prev") return `
    <p class="callout">لكل إجراء اتُّفق عليه في الزيارة السابقة: الحالة الحالية، وسبب عدم التنفيذ، والدعم المطلوب.</p>
    ${S.profile?.anon ? "" : '<button class="btn gold block" id="importPrev" type="button">استيراد إجراءات آخر زيارة لهذا المركز</button><div style="height:12px"></div>'}
    <div id="prevlist">${prevRows()}</div>
    <button class="btn ghost block" id="addPrev" type="button">+ إضافة إجراء</button>`;

  if (cur.sec) return QUESTIONS.filter(q => q.s === cur.id).map((q, i) => qCard(q, i)).join("") + (cur.id === "S11" ? discBlock() : "");

  if (cur.id === "dialogue") return `
    <p class="callout">تُطرح هذه الأسئلة مع مسؤول التطعيم/الفريق في جلسة قصيرة لتشجيع الحوار المفتوح بدلاً من الاقتصار على التفتيش.</p>
    ${L.DIALOGUE.map((q, i) => fld(`${i + 1}. ${q}`, `dialogue.answers.${i}`, { area: 1 })).join("")}
    ${fld("الدعم المقدَّم أثناء الزيارة", "dialogue.supportProvided", { area: 1 })}
    ${fld("الدعم المطلوب من مستوى أعلى", "dialogue.supportRequested", { area: 1 })}`;

  if (cur.id === "summary") return summaryBody();
  return "";
}

function qCard(q, i) {
  const a = S.visit.answers[q.code] || "";
  const r = a === "no" ? riskOf(S.visit, q.code) : "";
  const note = S.visit.notes[q.code] || "";
  const num = q.code.replace(/^S(\d+)_Q0?(\d+)$/, "$1.$2");
  return `<article class="q ${r ? "r-" + r : ""}" data-code="${q.code}" data-ans="${a}">
    <div class="q-head"><span class="q-num">${num}</span><span class="sev sev-${q.sev}" title="الخطورة المرجعية عند عدم الاستيفاء">${L.SEV_LABEL[q.sev]}</span></div>
    <p class="q-text">${esc(q.t)}</p>
    <div class="q-meta">طريقة التحقق: ${esc(q.m)}</div>
    <div class="seg" role="group" aria-label="الإجابة">${["yes", "no", "na"].map(x =>
      `<button type="button" data-ans="${x}" aria-pressed="${a === x}">${L.ANSWER_LABEL[x]}</button>`).join("")}</div>
    ${note ? "" : `<button class="notebtn" type="button" data-shownote>+ ملاحظة / دليل</button>`}
    <textarea class="note ${note ? "" : "hidden"}" data-note="${q.code}" placeholder="الملاحظة / الدليل">${esc(note)}</textarea>
    <div class="fwrap">${a === "no" ? findingPanel(q) : ""}</div>
  </article>`;
}

function findingPanel(q) {
  const f = S.visit.findings.find(x => x.code === q.code);
  const r = f.risk || q.sev, id = q.code;
  const inp = (lbl, key, t = "text") => `<div class="field"><label for="${id}_${key}">${lbl}</label><input id="${id}_${key}" type="${t}" data-f="${key}" value="${esc(f[key] || "")}"></div>`;
  return `<div class="finding">
    <h4>سجل النتائج وخطة العمل التصحيحية</h4>
    <div class="field"><label>مستوى الخطورة (يؤكده المشرف أو يعدّله)</label><div class="riskpick">${["red", "orange", "green", "blue"].map(x =>
      `<button type="button" data-r="${x}" aria-pressed="${r === x}">${L.RISK_LABEL[x]}</button>`).join("")}</div></div>
    <div class="field"><label for="${id}_problem">وصف مختصر للمشكلة</label><textarea id="${id}_problem" data-f="problem" placeholder="ما الذي لوحظ فعلياً؟">${esc(f.problem || "")}</textarea></div>
    ${r === "red" || r === "orange" ? `<div class="field"><label>السبب الجذري (رمز واحد أو أكثر)</label><div class="rc">${L.ROOT_CAUSES.map(c =>
      `<button type="button" data-rc="${c.c}" aria-pressed="${(f.rootCauses || []).includes(c.c)}"><b>${c.c}</b>${c.t}</button>`).join("")}</div></div>` : ""}
    <div class="field"><label for="${id}_action">الإجراء التصحيحي الفوري</label><textarea id="${id}_action" data-f="action">${esc(f.action || "")}</textarea></div>
    ${inp("الدعم المقدَّم أثناء الزيارة", "support")}
    <div class="grid2">${inp("المسؤول", "responsible")}${inp("الموعد النهائي", "deadline", "date")}</div>
    <label class="toggle"><input type="checkbox" data-f="escalate" ${f.escalate ? "checked" : ""}> يحتاج تصعيداً لمستوى أعلى</label>
  </div>`;
}

function prevRows() {
  const rows = S.visit.prevActions;
  if (!rows.length) return '<div class="empty">لا توجد إجراءات بعد.</div>';
  return rows.map((r, i) => `<div class="rowcard" data-prev="${i}">
    <button class="del" type="button" data-delprev="${i}">حذف</button><div class="n">إجراء ${i + 1}</div>
    ${["problem:المشكلة السابقة", "action:الإجراء المتفق عليه", "responsible:المسؤول"].map(p => { const [k, l] = p.split(":"); return `<div class="field"><label>${l}</label><input data-bind="prevActions.${i}.${k}" value="${esc(r[k] || "")}"></div>`; }).join("")}
    <div class="field"><label>الموعد النهائي</label><input type="date" data-bind="prevActions.${i}.deadline" value="${esc(r.deadline || "")}"></div>
    <div class="field"><label>الحالة الحالية</label><div class="chips">${L.FOLLOW_STATUS.map(x => `<button type="button" class="chip" data-setpath="prevActions.${i}.status" data-val="${x}" aria-pressed="${r.status === x}">${x}</button>`).join("")}</div></div>
    <div class="field"><label>سبب عدم التنفيذ (إن وجد)</label><input data-bind="prevActions.${i}.reason" value="${esc(r.reason || "")}"></div>
    <div class="field"><label>الدعم المطلوب</label><input data-bind="prevActions.${i}.support" value="${esc(r.support || "")}"></div>
  </div>`).join("");
}

function discBlock() {
  const rows = S.visit.discrepancies;
  return `<div class="stephead"><h2 style="font-size:1.05rem">توثيق التباين بين مصدر البيانات والتقرير</h2><p>يُعبَّأ عند وجود اختلاف.</p></div>
  <div id="disclist">${rows.map((r, i) => `<div class="rowcard"><button class="del" type="button" data-deldisc="${i}">حذف</button><div class="n">تباين ${i + 1}</div>
    ${["source:Source data (السجل الأصلي)", "reported:Reported data (المُبلَّغ)", "diff:Discrepancy (الفرق ونوعه)", "action:Corrective action (الإجراء التصحيحي)"].map(p => { const [k, l] = p.split(":"); return `<div class="field"><label>${l}</label><input data-bind="discrepancies.${i}.${k}" value="${esc(r[k] || "")}"></div>`; }).join("")}
  </div>`).join("")}</div>
  <button class="btn ghost block" id="addDisc" type="button">+ إضافة تباين</button>`;
}

function summaryBody() {
  const v = S.visit, sc = computeScores(v);
  const missing = QUESTIONS.filter(q => !v.answers[q.code]);
  const strengths = SECTIONS.filter(s => sc.sections[s.id].pct === 1).map(s => s.name);
  const reds = v.findings.filter(f => (f.risk || Q_BY_CODE[f.code].sev) === "red");
  const lbl = { red: "أحمر — تدخل فوري", orange: "برتقالي — إجراء خلال 24–72 ساعة", green: "أخضر — الوضع مقبول" };
  return `
    <div class="verdict ${sc.overall}"><div style="font-size:.85rem;opacity:.9">التصنيف العام للمخاطر</div><div class="big">${lbl[sc.overall]}</div>
      ${sc.reasons.length ? `<ul>${sc.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : '<ul><li>لا ملاحظات حمراء، وأقل من 3 برتقالية، وكل الأقسام 75٪ فأكثر</li></ul>'}</div>
    <div class="kpis">
      <div class="kpi"><b style="color:var(--red)">${sc.red}</b><span>ملاحظات حمراء</span></div>
      <div class="kpi"><b style="color:var(--orange)">${sc.orange}</b><span>برتقالية</span></div>
      <div class="kpi"><b style="color:var(--blue)">${sc.blue}</b><span>فرص تحسين</span></div>
      <div class="kpi"><b>${pct(sc.compliance)}</b><span>الالتزام العام</span></div>
    </div>
    ${missing.length ? `<div class="callout">لم يُجَب على <b>${missing.length}</b> بنداً. يمكنك الإرسال، لكن تُحسب النسب على البنود المُجابة فقط.</div>` : ""}
    <div class="secrows">${SECTIONS.map(s => { const p = sc.sections[s.id].pct; return `<div class="secrow"><span>${s.n}. ${esc(s.name)}</span><div class="secbar"><i style="width:${p === null ? 0 : p * 100}%;background:${p !== null && p < .75 ? "var(--orange)" : "var(--green)"}"></i></div><span class="v">${pct(p)}</span></div>`; }).join("")}</div>

    <h3 style="color:var(--navy);font-size:1.05rem;margin:18px 0 10px">الخلاصة التنفيذية</h3>
    ${fld("أهم 3 نقاط قوة", "summary.strengths", { area: 1, ph: strengths.length ? "مقترح: " + strengths.slice(0, 3).join("، ") : "" })}
    ${fld("أهم 3 مخاطر", "summary.risks", { area: 1, ph: reds.length ? "مقترح: " + reds.slice(0, 3).map(f => f.problem || f.text).join("؛ ") : "" })}
    ${fld("أهم الإجراءات الفورية المتخذة أثناء الزيارة", "summary.immediateActions", { area: 1 })}
    ${fld("مسؤوليات البلدية", "summary.muniResp", { area: 1 })}
    ${fld("مسؤوليات المركز الصحي", "summary.centerResp", { area: 1 })}
    ${fld("مسؤوليات إدارة التطعيمات", "summary.deptResp", { area: 1 })}
    ${fld("موعد الزيارة/المتابعة القادمة", "summary.nextVisit", { type: "date" })}

    <h3 style="color:var(--navy);font-size:1.05rem;margin:18px 0 10px">إقرار الزيارة والتوقيع</h3>
    <div class="grid2">${fld("اسم مشرف الزيارة", "signature.name", { req: 1 })}${fld("صفة مشرف الزيارة", "signature.title")}</div>
    <div class="field"><label>التوقيع</label><canvas class="sig" id="sig" aria-label="مساحة التوقيع"></canvas>
      <button class="linkbtn" id="sigclear" type="button">مسح التوقيع</button></div>
    <div class="field"><label>الموقع الجغرافي للزيارة (اختياري)</label>
      <button class="btn ghost" id="geo" type="button">${v.geo ? `تم التسجيل (±${Math.round(v.geo.acc)}م) — تحديث` : "تسجيل الموقع الحالي"}</button></div>
    <div style="height:10px"></div>
    <button class="btn gold block" id="submit" type="button" style="padding:16px;font-size:1.05rem">إرسال الزيارة إلى منصة الإدارة</button>
    <p class="hint" style="font-size:.8rem;color:var(--muted);text-align:center">إن لم يتوفر إنترنت تُحفظ الزيارة وتُرسل تلقائياً عند عودة الاتصال.</p>`;
}

// ---------- ربط الأحداث ----------
function wireNav() {
  document.getElementById("prev")?.addEventListener("click", () => go(S.step - 1));
  document.getElementById("next")?.addEventListener("click", () => go(S.step + 1));
  document.querySelectorAll("[data-go]").forEach(b => b.onclick = () => go(+b.dataset.go));
}
function go(i) { saveDraft(true); S.step = i; renderVisit(); window.scrollTo({ top: 0 }); }

function wireVisit() {
  wireNav();
  document.getElementById("home").onclick = () => { saveDraft(true); S.view = "home"; render(); };
  document.getElementById("savebtn").onclick = () => { saveDraft(true); toast("حُفظت المسودة على الجهاز"); };
  const body = document.getElementById("body");

  body.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.bind) {
      let val = t.type === "number" ? (t.value === "" ? "" : Number(t.value)) : t.value;
      setPath(S.visit, t.dataset.bind, val);
      if (t.dataset.bind === "info.center") document.querySelector(".topbar .ttl b").textContent = t.value || "زيارة جديدة";
      if (t.dataset.bind === "info.municipality") document.getElementById("dl-center").innerHTML = centersFor(t.value).map(c => `<option value="${esc(c)}">`).join("");
      if (t.dataset.bind === "info.overdueCount" || t.dataset.bind.startsWith("prevActions")) refreshLive();
      saveDraft();
    } else if (t.dataset.note) { S.visit.notes[t.dataset.note] = t.value; saveDraft(); }
    else if (t.dataset.f && t.type !== "checkbox") { findingOf(t).f[t.dataset.f] = t.value; saveDraft(); }
  });
  body.addEventListener("change", e => {
    const t = e.target;
    if (t.dataset.f === "escalate") { findingOf(t).f.escalate = t.checked; saveDraft(); }
    if (t.dataset.bind === "info.center") checkLastVisit(t.value);
  });
  body.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.setpath) {
      setPath(S.visit, b.dataset.setpath, b.dataset.val); saveDraft();
      if (b.dataset.setpath === "info.pendingActions") { renderVisit(); return; }
      b.parentElement.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", x === b));
      if (b.dataset.setpath.startsWith("prevActions")) refreshLive();
      return;
    }
    const card = b.closest(".q");
    if (card && b.dataset.ans) return setAnswer(card, b.dataset.ans);
    if (card && b.hasAttribute("data-shownote")) { card.querySelector(".note").classList.remove("hidden"); card.querySelector(".note").focus(); b.remove(); return; }
    if (card && b.dataset.r) {
      const { f } = findingOf(b); f.risk = b.dataset.r;
      card.querySelector(".fwrap").innerHTML = findingPanel(Q_BY_CODE[card.dataset.code]);
      card.className = "q r-" + f.risk; saveDraft(); refreshLive(); return;
    }
    if (card && b.dataset.rc) {
      const { f } = findingOf(b); const set = new Set(f.rootCauses || []);
      set.has(b.dataset.rc) ? set.delete(b.dataset.rc) : set.add(b.dataset.rc);
      f.rootCauses = [...set]; b.setAttribute("aria-pressed", set.has(b.dataset.rc)); saveDraft(); return;
    }
    if (b.id === "addPrev") { S.visit.prevActions.push({ status: "لم يبدأ" }); rerenderBody(); return; }
    if (b.dataset.delprev) { S.visit.prevActions.splice(+b.dataset.delprev, 1); rerenderBody(); refreshLive(); return; }
    if (b.id === "importPrev") return importPrev();
    if (b.id === "addDisc") { S.visit.discrepancies.push({}); rerenderBody(); return; }
    if (b.dataset.deldisc) { S.visit.discrepancies.splice(+b.dataset.deldisc, 1); rerenderBody(); return; }
    if (b.id === "geo") return captureGeo(b);
    if (b.id === "submit") return submit();
  });
  if (steps()[S.step].id === "info" && S.visit.info.center) checkLastVisit(S.visit.info.center, true);
}
function rerenderBody() { saveDraft(); document.getElementById("body").innerHTML = stepBody(steps()[S.step]); }
function findingOf(el) {
  const code = el.closest(".q").dataset.code;
  return { f: S.visit.findings.find(x => x.code === code), code };
}
function setAnswer(card, ans) {
  const code = card.dataset.code, q = Q_BY_CODE[code];
  S.visit.answers[code] = ans;
  card.dataset.ans = ans;
  card.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x.dataset.ans === ans));
  const exists = S.visit.findings.find(x => x.code === code);
  if (ans === "no" && !exists) {
    S.visit.findings.push({ code, section: q.s, text: q.t, risk: q.sev, problem: "", rootCauses: [], action: "", support: "", responsible: "", deadline: "", escalate: false, status: "لم يبدأ" });
  } else if (ans !== "no" && exists) {
    S.visit.findings = S.visit.findings.filter(x => x.code !== code);
  }
  card.className = "q" + (ans === "no" ? " r-" + riskOf(S.visit, code) : "");
  card.querySelector(".fwrap").innerHTML = ans === "no" ? findingPanel(q) : "";
  saveDraft(); refreshLive();
}

async function checkLastVisit(center, quiet) {
  const box = document.getElementById("lastinfo"); if (!box || !center) return;
  learnCenter(S.visit.info.municipality, center);
  if (S.profile?.anon) return; // الدخول بدون حساب لا يملك صلاحية قراءة الزيارات السابقة
  try {
    const last = await store.lastVisitFor(center);
    if (!last || last.visitNo === S.visit.visitNo) { box.innerHTML = ""; return; }
    const sc = computeScores(last);
    const open = (last.findings || []).filter(f => f.status !== "مكتمل").length;
    box.innerHTML = `<div class="callout">آخر زيارة لهذا المركز: <b>${esc(last.info.date)}</b> — التصنيف <b>${{ red: "أحمر", orange: "برتقالي", green: "أخضر" }[sc.overall]}</b> — ${open} إجراء غير مكتمل.</div>`;
    if (!quiet) {
      if (!S.visit.info.prevDate) S.visit.info.prevDate = last.info.date;
      if (!S.visit.prep.prevRating) S.visit.prep.prevRating = { red: "أحمر", orange: "برتقالي", green: "أخضر" }[sc.overall];
      if (open && S.visit.info.pendingActions !== "نعم") S.visit.info.pendingActions = "نعم";
      S._last = last; saveDraft(true); renderVisit();
    }
  } catch (e) { console.warn(e); }
}
async function importPrev() {
  const c = S.visit.info.center;
  if (!c) return toast("اكتب اسم المركز في القسم 1 أولاً");
  try {
    const last = S._last || await store.lastVisitFor(c);
    if (!last) return toast("لا توجد زيارة سابقة مسجَّلة لهذا المركز");
    const rows = (last.findings || []).filter(f => f.status !== "مكتمل")
      .map(f => ({ problem: f.problem || f.text, action: f.action || "", responsible: f.responsible || "", deadline: f.deadline || "", status: f.status || "لم يبدأ", reason: "", support: "" }));
    if (!rows.length) return toast("كل إجراءات الزيارة السابقة مكتملة");
    S.visit.prevActions.push(...rows); rerenderBody(); refreshLive();
    toast(`استُورد ${rows.length} إجراء من زيارة ${last.info.date}`);
  } catch { toast("تعذّر جلب الزيارة السابقة — تحقق من الاتصال"); }
}

function wireSignature() {
  const cv = document.getElementById("sig"); if (!cv) return;
  const ratio = window.devicePixelRatio || 1, rect = cv.getBoundingClientRect();
  cv.width = rect.width * ratio; cv.height = rect.height * ratio;
  const ctx = cv.getContext("2d"); ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.strokeStyle = "#0A2740";
  if (S.visit.signature.image) { const im = new Image(); im.onload = () => ctx.drawImage(im, 0, 0, rect.width, rect.height); im.src = S.visit.signature.image; }
  let drawing = false;
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  cv.onpointerdown = e => { drawing = true; cv.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); };
  cv.onpointermove = e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); };
  cv.onpointerup = () => {
    drawing = false;
    const out = document.createElement("canvas"); out.width = 480; out.height = Math.round(480 * rect.height / rect.width);
    out.getContext("2d").drawImage(cv, 0, 0, out.width, out.height);
    S.visit.signature.image = out.toDataURL("image/png"); saveDraft();
  };
  document.getElementById("sigclear").onclick = () => { ctx.clearRect(0, 0, cv.width, cv.height); S.visit.signature.image = ""; saveDraft(); };
}
function captureGeo(btn) {
  if (!navigator.geolocation) return toast("الجهاز لا يدعم تحديد الموقع");
  btn.textContent = "جارٍ تحديد الموقع…";
  navigator.geolocation.getCurrentPosition(p => {
    S.visit.geo = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    btn.textContent = `تم التسجيل (±${Math.round(p.coords.accuracy)}م) — تحديث`; saveDraft();
  }, () => { btn.textContent = "تسجيل الموقع الحالي"; toast("لم يُسمح بالوصول إلى الموقع"); }, { enableHighAccuracy: true, timeout: 15000 });
}

async function submit() {
  const v = S.visit, miss = [];
  if (!v.info.municipality) miss.push("البلدية");
  if (!v.info.center) miss.push("اسم المركز");
  if (!v.info.date) miss.push("تاريخ الزيارة");
  if (!v.info.team) miss.push("فريق الإشراف");
  if (!v.signature.name) miss.push("اسم مشرف الزيارة");
  if (miss.length) return toast("أكمل الحقول المطلوبة: " + miss.join("، "), 4000);
  const sc = computeScores(v);
  if (sc.answered < sc.total && !confirm(`لم يُجَب على ${sc.total - sc.answered} بنداً. هل تريد الإرسال الآن؟`)) return;
  if (!v.info.endTime) v.info.endTime = nowHM();
  v.findings.forEach(f => { if (!f.problem) f.problem = f.text; });
  v.scores = { ...sc, sections: Object.fromEntries(Object.entries(sc.sections).map(([k, s]) => [k, s.pct])) };
  v.submittedAt = new Date().toISOString();
  v.supervisorName = S.profile?.name || v.signature.name;
  v.authMode = S.profile?.anon ? "anonymous" : "account";
  learnCenter(v.info.municipality, v.info.center);
  const q = load(K.queue, []); q.push(v); save(K.queue, q);
  const d = load(K.drafts, {}); delete d[v.localId]; save(K.drafts, d);
  S.lastSubmitted = v; S.visit = null; S.view = "done"; render();
  await flushQueue();
  if (S.view === "done") render();
}

function renderDone() {
  const v = S.lastSubmitted, queued = load(K.queue, []).some(x => x.localId === v.localId);
  const o = v.scores.overall;
  $app.innerHTML = brand() + `<main class="wrap done-screen">
    <span class="lamp ${o}" style="display:block"></span>
    <h2 style="color:var(--navy);margin:0 0 6px">${queued ? "حُفظت الزيارة وستُرسل عند توفر الإنترنت" : "أُرسلت الزيارة إلى منصة الإدارة"}</h2>
    <p style="color:var(--muted)">${esc(v.info.center)} — ${esc(v.info.date)}<br>رقم الزيارة: <b dir="ltr">${esc(v.visitNo)}</b></p>
    <p>التصنيف العام: <b style="color:var(--${o})">${{ red: "أحمر", orange: "برتقالي", green: "أخضر" }[o]}</b> — ${v.scores.red} حمراء، ${v.scores.orange} برتقالية</p>
    <button class="btn block" id="h" style="margin-top:20px">العودة للرئيسية</button>
  </main>`;
  document.getElementById("h").onclick = () => { S.view = "home"; render(); };
}

// ================================================================
//  الإقلاع
// ================================================================
(async function boot() {
  render();
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
  try { await store.init(); }
  catch (e) { $app.innerHTML = brand() + `<main class="wrap"><p class="callout">تعذّر تحميل Firebase. تحقق من الاتصال ثم أعد فتح التطبيق.</p></main>`; return; }
  store.onUser(async user => {
    S.user = user;
    if (!user) {
      // دخول تلقائي بدون اسم مستخدم أو كلمة مرور
      try { await store.loginAnon(); return; }
      catch (e) {
        S.profile = { role: "supervisor", anon: true, name: load(K.name, "") };
        if (e?.code === "auth/operation-not-allowed" || e?.code === "auth/admin-restricted-operation")
          S.authErr = "الدخول بدون حساب غير مفعّل في Firebase. فعّل Anonymous من Authentication ← Sign-in method.";
        if (S.view !== "visit") { S.view = "home"; render(); }
        return; // بدون إنترنت: يعمل التطبيق وتُرسل الزيارات عند عودة الاتصال
      }
    }
    S.authErr = "";
    if (user.isAnonymous || user.demo) {
      S.profile = user.demo ? { role: "admin", name: "وضع التجربة" } : { role: "supervisor", anon: true, name: load(K.name, "") };
    } else {
      const pk = "ncdc_profile_" + user.uid;
      try { S.profile = await store.getProfile(user); if (S.profile) save(pk, S.profile); }
      catch { S.profile = load(pk, null); }
      if (!S.profile || !["admin", "supervisor"].includes(S.profile.role)) { await store.logout(); return; }
    }
    if (S.view !== "visit") { S.view = "home"; render(); }
    flushQueue();
  });
})();
