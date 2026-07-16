// Firebase Web 設定是公開識別資訊，不是密鑰；真正的資料權限由 firestore.rules 控制。
// 來源：railisland 專案 Console「專案設定 → 你的應用程式 → Web app」(2026-07-16)。
// Apple 登入開關：Apple Developer 開通＋Firebase Apple provider 啟用後改 true（App 送審前必須為 true）。
window.RAIL_APPLE_LOGIN = false;
window.RAIL_FIREBASE_CONFIG = window.RAIL_FIREBASE_CONFIG || {
  apiKey: "AIzaSyA91uGt6IIL8mzXl69ZU17r9y8CJKtpIHY",
  authDomain: "railisland.firebaseapp.com",
  projectId: "railisland",
  storageBucket: "railisland.firebasestorage.app",
  messagingSenderId: "415549765868",
  appId: "1:415549765868:web:08f63bd7a005555ce14dc9"
};
