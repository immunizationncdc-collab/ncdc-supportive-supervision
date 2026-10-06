// طبقة البيانات: Firebase (Auth + Firestore) مع «وضع تجربة» محلي عند عدم ضبط الإعدادات.
import { firebaseConfig, isConfigured, VISITS_COLLECTION } from "./firebase-config.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2/";
const DEMO_KEY = "ncdc_demo_visits";
let fb = null; // { auth, db, m: {auth fns, firestore fns} }

export const demoMode = !isConfigured;

export async function init() {
  if (!isConfigured) return null;
  if (fb) return fb;
  const [appM, authM, fsM] = await Promise.all([
    import(SDK + "firebase-app.js"), import(SDK + "firebase-auth.js"), import(SDK + "firebase-firestore.js")
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  await authM.setPersistence(auth, authM.browserLocalPersistence);
  fb = { auth, db: fsM.getFirestore(app), a: authM, f: fsM };
  return fb;
}

// ---------------- المصادقة ----------------
export function onUser(cb) {
  if (!isConfigured) { cb({ uid: "demo", email: "demo@local", demo: true }); return () => {}; }
  return fb.a.onAuthStateChanged(fb.auth, cb);
}
export const loginAnon = () => fb.a.signInAnonymously(fb.auth);
export const currentUser = () => (isConfigured && fb) ? fb.auth.currentUser : { uid: "demo" };
export const login = (email, pw) => fb.a.signInWithEmailAndPassword(fb.auth, email.trim(), pw);
export const logout = () => isConfigured ? fb.a.signOut(fb.auth) : Promise.resolve();
export const resetPassword = email => fb.a.sendPasswordResetEmail(fb.auth, email.trim());

/** الدور من المستند users/{uid} : { role: "admin" | "supervisor", name } */
export async function getProfile(user) {
  if (!isConfigured) return { role: "admin", name: "وضع التجربة" };
  const snap = await fb.f.getDoc(fb.f.doc(fb.db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

// ---------------- الزيارات ----------------
function demoList() { try { return JSON.parse(localStorage.getItem(DEMO_KEY) || "[]"); } catch { return []; } }
function demoSave(list) { localStorage.setItem(DEMO_KEY, JSON.stringify(list)); window.dispatchEvent(new Event("demo-visits")); }

export async function submitVisit(visit) {
  if (!isConfigured) {
    const list = demoList();
    const id = "demo-" + Date.now();
    list.push({ ...visit, id, createdAt: new Date().toISOString() });
    demoSave(list);
    return id;
  }
  const { f, db, auth } = fb;
  if (!auth.currentUser) throw Object.assign(new Error("not signed in"), { code: "unauthenticated" });
  const p = f.addDoc(f.collection(db, VISITS_COLLECTION), {
    ...visit,
    createdBy: auth.currentUser.uid,
    createdByEmail: auth.currentUser.email || null,
    createdAt: f.serverTimestamp()
  }).then(ref => ref.id);
  if (visit.localId) pending.set(visit.localId, p);
  p.finally(() => visit.localId && pending.delete(visit.localId)).catch(() => {});
  // Firestore ينتظر الخادم بلا حد زمني عند ضعف الشبكة؛ نُظهر خطأ بعد دقيقة بدل التعليق الصامت
  let timer;
  const to = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error("timeout"), { code: "timeout" })), 60000); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(timer); }
}
const pending = new Map();
/** نتيجة إرسال انتهت مهلته لكنه ما زال جارياً في الخلفية */
export const lateResult = localId => pending.get(localId) || null;

// ---------------- قائمة البلديات والمراكز (config/lists) ----------------
const DEMO_LISTS = "ncdc_demo_lists";
/** يُرجع { munis: [{name, centers}], updatedAt, updatedBy } أو null إن لم تُحفظ قائمة بعد */
export async function getLists() {
  if (!isConfigured) { try { const m = JSON.parse(localStorage.getItem(DEMO_LISTS)); return m ? { munis: m } : null; } catch { return null; } }
  const s = await fb.f.getDoc(fb.f.doc(fb.db, "config", "lists"));
  if (!s.exists()) return null;
  const d = s.data();
  return { munis: d.munis || [], updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : d.updatedAt, updatedBy: d.updatedBy || "" };
}
export async function saveLists(munis) {
  if (!isConfigured) { localStorage.setItem(DEMO_LISTS, JSON.stringify(munis)); return; }
  const { f, db, auth } = fb;
  await f.setDoc(f.doc(db, "config", "lists"), { munis, updatedAt: f.serverTimestamp(), updatedBy: auth.currentUser?.email || "" });
}

/** حذف مجموعة زيارات دفعةً واحدة (للإدارة) */
export async function deleteVisits(ids, onProgress) {
  if (!isConfigured) {
    const set = new Set(ids);
    demoSave(demoList().filter(v => !set.has(v.id)));
    onProgress?.(ids.length, ids.length);
    return ids.length;
  }
  const { f, db } = fb;
  let done = 0;
  for (let i = 0; i < ids.length; i += 400) {
    const batch = f.writeBatch(db);
    ids.slice(i, i + 400).forEach(id => batch.delete(f.doc(db, VISITS_COLLECTION, id)));
    await batch.commit();
    done += Math.min(400, ids.length - i);
    onProgress?.(done, ids.length);
  }
  return done;
}

/** اشتراك لحظي في كل الزيارات (للإدارة) */
export function watchVisits(cb, onErr) {
  if (!isConfigured) {
    const emit = async () => {
      const { DEMO_VISITS } = await import("./demo-data.js");
      cb([...DEMO_VISITS, ...demoList()]);
    };
    emit();
    const h = () => emit();
    window.addEventListener("demo-visits", h);
    window.addEventListener("storage", h);
    return () => { window.removeEventListener("demo-visits", h); window.removeEventListener("storage", h); };
  }
  const { f, db } = fb;
  const q = f.query(f.collection(db, VISITS_COLLECTION), f.orderBy("info.date", "desc"));
  return f.onSnapshot(q, s => cb(s.docs.map(d => {
    const v = d.data();
    return { ...v, id: d.id, createdAt: v.createdAt?.toDate ? v.createdAt.toDate().toISOString() : v.createdAt };
  })), onErr);
}

/** آخر زيارة لنفس المركز (لربط الزيارة السابقة في تطبيق الهاتف) */
export async function lastVisitFor(center) {
  if (!center) return null;
  if (!isConfigured) {
    const { DEMO_VISITS } = await import("./demo-data.js");
    return [...DEMO_VISITS, ...demoList()].filter(v => v.info?.center === center)
      .sort((a, b) => (b.info.date || "").localeCompare(a.info.date || ""))[0] || null;
  }
  const { f, db } = fb;
  const q = f.query(f.collection(db, VISITS_COLLECTION), f.where("info.center", "==", center),
    f.orderBy("info.date", "desc"), f.limit(1));
  const s = await f.getDocs(q);
  return s.empty ? null : { ...s.docs[0].data(), id: s.docs[0].id };
}

export async function updateVisit(id, patch) {
  if (!isConfigured) {
    const list = demoList(); const i = list.findIndex(v => v.id === id);
    if (i >= 0) { list[i] = { ...list[i], ...patch }; demoSave(list); }
    return;
  }
  await fb.f.updateDoc(fb.f.doc(fb.db, VISITS_COLLECTION, id), patch);
}

export async function deleteVisit(id) {
  if (!isConfigured) { demoSave(demoList().filter(v => v.id !== id)); return; }
  await fb.f.deleteDoc(fb.f.doc(fb.db, VISITS_COLLECTION, id));
}
