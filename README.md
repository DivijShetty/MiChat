# ⬡ MiChat

A production-ready, real-time group chat app built with **Vanilla JavaScript** and **Firebase** — no frameworks, no build step, open the HTML and it works.

![MiChat Screenshot](https://placehold.co/900x500/0d0f14/5b7cfa?text=MiChat+Screenshot)

## ✨ Features

| Feature | Details |
|---|---|
| 🔐 Google Auth | Sign in with Google — no passwords to manage |
| 🏠 Dynamic rooms | Create public or private rooms in real time |
| 👑 Admins | Room creators become admins — promote others, kick members |
| 🗑️ Delete messages | Soft-delete — admins or message owner can remove; shows "deleted" placeholder |
| 📎 File & image sharing | Upload images, video, PDFs via Cloudinary (free tier) |
| ✍️ Typing indicators | Live "Alex is typing…" powered by Firestore |
| 🎨 Customization | 6 themes, 8 accent colours, font size, compact mode, display name |
| ⚡ Real-time | Firestore `onSnapshot` — zero polling |
| 🔒 Secure | Firestore security rules enforce every permission server-side |

---

## 🚀 Getting Started

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/michat.git
cd michat
```

### 2. Set up Firebase

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → create a project
2. Enable **Authentication → Google** sign-in
3. Enable **Firestore Database** (start in test mode, then apply rules below)
4. Register a **Web app** → copy your config

### 3. Configure secrets

```bash
cp firebase-config.example.js firebase-config.js
```

Edit `firebase-config.js` and paste your Firebase config values.  
**This file is gitignored** — it will never be committed.

### 4. Apply Firestore security rules

In the Firebase Console → Firestore → Rules, paste the contents of `firestore.rules`.

### 5. (Optional) Set up Cloudinary for file sharing

1. Sign up free at [cloudinary.com](https://cloudinary.com) — no credit card needed
2. Dashboard → copy your **Cloud Name**
3. Settings → Upload → Add upload preset → set signing mode to **Unsigned**
4. Add both values to `firebase-config.js`

### 6. Run

Open `index.html` in a browser. That's it — no build step needed.

For local development with live reload:

```bash
npx serve .
# or
npx live-server
```

---

## 📁 Project structure

```
michat/
├── index.html                  # App shell + all modals
├── style.css                   # Design system + 6 themes
├── app.js                      # All logic — auth, rooms, messages, admin
├── firebase-config.js          # ← YOUR SECRETS (gitignored)
├── firebase-config.example.js  # Template to commit safely
├── firestore.rules             # Copy-paste into Firebase Console
├── .gitignore
└── README.md
```

---

## 🔐 Firestore data model

```
users/
  {uid}/                      ← user profile (displayName, photoURL)

rooms/
  {roomId}/
    name, description, isPrivate
    createdBy: uid
    admins:  uid[]
    members: uid[]
    createdAt

    messages/
      {msgId}/
        text, uid, displayName, photoURL
        createdAt, deletedAt (null or timestamp)
        attachmentUrl, attachmentType, attachmentName

    typing/
      {uid}/                  ← ephemeral, deleted after 4s
        displayName, uid
```

---

## 🛡️ Admin permissions

| Action | Owner | Admin | Member |
|---|---|---|---|
| Send messages | ✅ | ✅ | ✅ |
| Delete own messages | ✅ | ✅ | ✅ |
| Delete any message | ✅ | ✅ | ❌ |
| Invite members | ✅ | ✅ | ❌ |
| Kick members | ✅ | ✅ | ❌ |
| Promote to admin | ✅ | ❌ | ❌ |
| Delete room | ✅ | ❌ | ❌ |

---

## 🆓 Running cost

Everything uses free tiers:

- **Firebase Auth** — free forever
- **Firestore** — 50k reads / 20k writes / 1 GB storage per day free
- **Cloudinary** — 25 GB storage + 25 GB bandwidth/month free

---

## 📄 License

MIT — use it, fork it, ship it.