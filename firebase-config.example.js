// ============================================================
// COPY THIS FILE → firebase-config.js
// Then fill in your values from Firebase Console → Project Settings
// firebase-config.js is listed in .gitignore and will NEVER be committed.
// ============================================================

export const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
  measurementId:     "YOUR_MEASUREMENT_ID"   // optional
};

// ============================================================
// CLOUDINARY (free file hosting — cloudinary.com)
// 1. Sign up free at cloudinary.com
// 2. Dashboard → copy Cloud Name
// 3. Settings → Upload → Add upload preset → Signing mode: Unsigned
// ============================================================
export const CLOUDINARY_CLOUD_NAME    = "YOUR_CLOUD_NAME";
export const CLOUDINARY_UPLOAD_PRESET = "YOUR_UPLOAD_PRESET";
