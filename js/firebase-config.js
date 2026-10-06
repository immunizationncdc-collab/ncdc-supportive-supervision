// ================================================================
//  إعدادات Firebase — مشروع ncdc-supervision
// ================================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBgMjLOMeY2uKSv6zuuYB3DoF0Dw2qRrkM",
  authDomain: "ncdc-supervision.firebaseapp.com",
  projectId: "ncdc-supervision",
  storageBucket: "ncdc-supervision.firebasestorage.app",
  messagingSenderId: "960694663871",
  appId: "1:960694663871:web:f9946777f20f47a06f240a"
};

export const isConfigured = !String(firebaseConfig.apiKey).startsWith("YOUR");

// اسم مجموعة الزيارات في Firestore
export const VISITS_COLLECTION = "visits";
export const APP_VERSION = "1.4.0";
