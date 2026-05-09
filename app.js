// ============================================================
// IMPORTS
// ============================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore, collection, addDoc, doc, setDoc, deleteDoc,
  query, orderBy, onSnapshot, serverTimestamp, limitToLast, getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ============================================================
// FIREBASE CONFIG
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBwfmyvixhpjqpb4Gy5ZZ3rg8QzSeV-3nQ",
  authDomain: "michat-01.firebaseapp.com",
  projectId: "michat-01",
  storageBucket: "michat-01.firebasestorage.app",
  messagingSenderId: "1098599963803",
  appId: "1:1098599963803:web:8a067e07fe71c9db567a3e",
  measurementId: "G-SZ5YM9M7B1"
};

// ============================================================
// CLOUDINARY CONFIG — FREE tier (25GB storage / 25GB bandwidth/mo)
// Sign up at cloudinary.com → Dashboard → copy Cloud Name
// Create an unsigned upload preset: Settings → Upload → Add upload preset → Signing mode: Unsigned
// ============================================================
const CLOUDINARY_CLOUD_NAME = "dh9bepvzp";       // ← replace
const CLOUDINARY_UPLOAD_PRESET = "michat_uploads"; // ← replace

// ============================================================
// INIT
// ============================================================
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const provider = new GoogleAuthProvider();

// ============================================================
// DOM
// ============================================================
const loginScreen      = document.getElementById('login-screen');
const loginBtn         = document.getElementById('login-btn');
const logoutBtn        = document.getElementById('logout-btn');
const chatApp          = document.getElementById('chat-app');
const messagesEl       = document.getElementById('messages');
const messageForm      = document.getElementById('message-form');
const messageInput     = document.getElementById('message-input');
const roomButtons      = document.querySelectorAll('.room-btn');
const activeRoomName   = document.getElementById('active-room-name');
const msgCountEl       = document.getElementById('msg-count');
const userAvatarEl     = document.getElementById('user-avatar');
const userNameEl       = document.getElementById('user-name');
const typingIndicator  = document.getElementById('typing-indicator');
const typingText       = document.getElementById('typing-text');
const fileInput        = document.getElementById('file-input');
const attachBtn        = document.getElementById('attach-btn');
const filePreview      = document.getElementById('file-preview');
const filePreviewName  = document.getElementById('file-preview-name');
const fileCancelBtn    = document.getElementById('file-cancel');
const uploadProgress   = document.getElementById('upload-progress');
const uploadBar        = document.getElementById('upload-bar');
const uploadLabel      = document.getElementById('upload-label');
const customizeBtn     = document.getElementById('customize-btn');
const customizePanel   = document.getElementById('customize-panel');
const closePanel       = document.getElementById('close-panel');
const lightbox         = document.createElement('div');

// Build lightbox
lightbox.id = 'lightbox';
lightbox.className = 'hidden';
lightbox.innerHTML = '<img id="lightbox-img" src="" alt="">';
document.body.appendChild(lightbox);
lightbox.addEventListener('click', () => lightbox.classList.add('hidden'));

// ============================================================
// STATE
// ============================================================
let currentUser           = null;
let currentRoomId         = 'general';
let unsubscribeFromRoom   = null;
let unsubscribeTyping     = null;
let messageCount          = 0;
let selectedFile          = null;
let typingTimeout         = null;
let customDisplayName     = localStorage.getItem('michat_displayName') || null;

// ============================================================
// PART 1 — AUTHENTICATION
// ============================================================
loginBtn.addEventListener('click', async () => {
  try { await signInWithPopup(auth, provider); }
  catch (err) { console.error("Login failed:", err); }
});

logoutBtn.addEventListener('click', async () => {
  await clearTypingStatus();
  try { await signOut(auth); }
  catch (err) { console.error("Logout failed:", err); }
});

onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add('hidden');
    chatApp.classList.remove('hidden');
    userAvatarEl.src = user.photoURL || 'https://placehold.co/40';
    userNameEl.textContent = customDisplayName || user.displayName || 'Anonymous';
    joinRoom(currentRoomId);
  } else {
    currentUser = null;
    loginScreen.classList.remove('hidden');
    chatApp.classList.add('hidden');
    stopRoomListener();
    stopTypingListener();
    messagesEl.innerHTML = '';
  }
});

// ============================================================
// PART 2 — ROOM SWITCHING
// ============================================================
roomButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const roomId = btn.dataset.room;
    if (roomId === currentRoomId) return;
    roomButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    joinRoom(roomId);
  });
});

function joinRoom(roomId) {
  clearTypingStatus(); // clear old room typing
  currentRoomId = roomId;
  activeRoomName.textContent = `# ${roomId}`;
  messageInput.placeholder = `Message #${roomId}…`;
  startChatListener(roomId);
  startTypingListener(roomId);
}

// ============================================================
// PART 3 — REAL-TIME CHAT
// ============================================================
function stopRoomListener() {
  if (unsubscribeFromRoom) { unsubscribeFromRoom(); unsubscribeFromRoom = null; }
}

function startChatListener(roomId) {
  stopRoomListener();
  messagesEl.innerHTML = '';
  messageCount = 0;

  const q = query(
    collection(db, "rooms", roomId, "messages"),
    orderBy("createdAt", "asc"),
    limitToLast(50)
  );

  unsubscribeFromRoom = onSnapshot(q, (snapshot) => {
    messagesEl.innerHTML = '';
    messageCount = 0;
    let lastDate = null;

    snapshot.forEach((doc) => {
      const data = doc.data();
      const ts = data.createdAt?.toDate?.() ?? null;

      if (ts) {
        const label = formatDateLabel(ts);
        if (label !== lastDate) { renderDateDivider(label); lastDate = label; }
      }

      renderMessage(data, ts);
      messageCount++;
    });

    if (messageCount === 0) renderEmptyState();
    msgCountEl.textContent = messageCount;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ============================================================
// PART 4 — TYPING INDICATORS (100% free — Firestore)
// Strategy: write a doc to rooms/{roomId}/typing/{uid} while typing.
// Delete it when done. Other clients listen with onSnapshot.
// Firestore free tier = 50k reads/day — typing uses very few.
// ============================================================
function stopTypingListener() {
  if (unsubscribeTyping) { unsubscribeTyping(); unsubscribeTyping = null; }
}

function startTypingListener(roomId) {
  stopTypingListener();

  const typingRef = collection(db, "rooms", roomId, "typing");

  unsubscribeTyping = onSnapshot(typingRef, (snapshot) => {
    const typers = [];
    snapshot.forEach((doc) => {
      if (doc.id !== currentUser?.uid) {
        typers.push(doc.data().displayName || 'Someone');
      }
    });

    if (typers.length === 0) {
      typingIndicator.classList.add('hidden');
    } else {
      typingIndicator.classList.remove('hidden');
      if (typers.length === 1) {
        typingText.textContent = `${typers[0]} is typing…`;
      } else if (typers.length === 2) {
        typingText.textContent = `${typers[0]} and ${typers[1]} are typing…`;
      } else {
        typingText.textContent = `${typers.length} people are typing…`;
      }
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });
}

// Write typing status; auto-clear after 4s of inactivity
messageInput.addEventListener('input', () => {
  if (!currentUser) return;

  const typingDocRef = doc(db, "rooms", currentRoomId, "typing", currentUser.uid);
  setDoc(typingDocRef, {
    displayName: customDisplayName || currentUser.displayName || 'Anonymous',
    uid: currentUser.uid
  });

  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => clearTypingStatus(), 4000);
});

// Clear typing when message sent or focus lost
messageInput.addEventListener('blur', () => clearTimeout(typingTimeout));

async function clearTypingStatus() {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(db, "rooms", currentRoomId, "typing", currentUser.uid));
  } catch (_) {}
}

// ============================================================
// PART 5 — FILE & IMAGE SHARING (Cloudinary — free tier)
// Free tier: 25 GB storage, 25 GB bandwidth/month, no credit card needed.
// Uses an "unsigned upload preset" — no server needed, pure client upload.
// ============================================================
attachBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  selectedFile = file;
  filePreviewName.textContent = file.name;
  filePreview.classList.remove('hidden');
  fileInput.value = '';
});

fileCancelBtn.addEventListener('click', () => {
  selectedFile = null;
  filePreview.classList.add('hidden');
});

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  // Show progress UI
  uploadProgress.classList.remove('hidden');
  uploadBar.style.width = '0%';
  uploadLabel.textContent = 'Uploading…';

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100);
        uploadBar.style.width = pct + '%';
        uploadLabel.textContent = `Uploading… ${pct}%`;
      }
    };

    xhr.onload = () => {
      uploadProgress.classList.add('hidden');
      if (xhr.status === 200) {
        const data = JSON.parse(xhr.responseText);
        resolve({ url: data.secure_url, resourceType: data.resource_type, originalName: file.name });
      } else {
        reject(new Error('Upload failed'));
      }
    };

    xhr.onerror = () => {
      uploadProgress.classList.add('hidden');
      reject(new Error('Network error during upload'));
    };

    xhr.send(formData);
  });
}

// ============================================================
// PART 6 — SEND MESSAGE (text + optional file)
// ============================================================
messageForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text && !selectedFile) return;
  if (!currentUser) return;

  // Clear UI immediately
  messageInput.value = '';
  clearTypingStatus();

  let attachment = null;

  if (selectedFile) {
    filePreview.classList.add('hidden');
    const file = selectedFile;
    selectedFile = null;

    // Check Cloudinary is configured
    if (CLOUDINARY_CLOUD_NAME === 'YOUR_CLOUD_NAME') {
      alert('⚠️ Configure Cloudinary in app.js to enable file sharing.\nSee SETUP.md for instructions.');
      return;
    }

    try {
      const result = await uploadToCloudinary(file);
      attachment = result;
    } catch (err) {
      console.error('Upload failed:', err);
      alert('File upload failed. Check your Cloudinary config.');
      return;
    }
  }

  try {
    await addDoc(collection(db, "rooms", currentRoomId, "messages"), {
      text,
      uid:         currentUser.uid,
      displayName: customDisplayName || currentUser.displayName,
      photoURL:    currentUser.photoURL,
      createdAt:   serverTimestamp(),
      ...(attachment && {
        attachmentUrl:      attachment.url,
        attachmentType:     attachment.resourceType,  // 'image' | 'video' | 'raw'
        attachmentName:     attachment.originalName
      })
    });
  } catch (err) {
    console.error("Error sending message:", err);
  }
});

// ============================================================
// RENDERING
// ============================================================
function renderDateDivider(label) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.textContent = label;
  messagesEl.appendChild(div);
}

function renderEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-icon">💬</span><span>No messages yet.</span><span>Be the first!</span>`;
  messagesEl.appendChild(div);
}

function renderMessage(data, ts) {
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';

  const photo     = data.photoURL    || 'https://placehold.co/40';
  const name      = data.displayName || 'Anonymous';
  const text      = escapeHTML(data.text || '');
  const timeLabel = ts ? formatTime(ts) : '';

  let attachmentHTML = '';

  if (data.attachmentUrl) {
    if (data.attachmentType === 'image') {
      attachmentHTML = `<img class="msg-image" src="${escapeHTML(data.attachmentUrl)}" alt="${escapeHTML(data.attachmentName || 'image')}" loading="lazy">`;
    } else if (data.attachmentType === 'video') {
      attachmentHTML = `<video class="msg-image" src="${escapeHTML(data.attachmentUrl)}" controls style="max-width:320px;border-radius:8px;margin-top:6px;"></video>`;
    } else {
      // Generic file download link
      attachmentHTML = `
        <a class="msg-file" href="${escapeHTML(data.attachmentUrl)}" target="_blank" rel="noopener">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${escapeHTML(data.attachmentName || 'Download file')}
        </a>`;
    }
  }

  bubble.innerHTML = `
    <img src="${escapeHTML(photo)}" alt="${escapeHTML(name)}">
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name">${escapeHTML(name)}</span>
        <span class="msg-time">${timeLabel}</span>
      </div>
      ${text ? `<p class="msg-text">${text}</p>` : ''}
      ${attachmentHTML}
    </div>
  `;

  // Lightbox for images
  if (data.attachmentType === 'image') {
    const img = bubble.querySelector('.msg-image');
    img.addEventListener('click', () => {
      document.getElementById('lightbox-img').src = data.attachmentUrl;
      lightbox.classList.remove('hidden');
    });
  }

  messagesEl.appendChild(bubble);
}

// ============================================================
// PART 7 — CUSTOMIZATION PANEL
// Saves preferences to localStorage — no backend needed, free!
// ============================================================
const prefs = {
  theme:    localStorage.getItem('michat_theme')    || 'dark',
  accent:   localStorage.getItem('michat_accent')   || '#5b7cfa',
  fontSize: parseInt(localStorage.getItem('michat_fontSize') || '14'),
  compact:  localStorage.getItem('michat_compact')  === 'true'
};

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.style.setProperty('--accent', prefs.accent);
  document.documentElement.style.setProperty('--accent-dim', shadeColor(prefs.accent, -20));
  document.documentElement.style.setProperty('--accent-glow', hexToRgba(prefs.accent, 0.18));
  document.documentElement.style.setProperty('--msg-font-size', prefs.fontSize + 'px');
  document.body.classList.toggle('compact', prefs.compact);
}
applyPrefs();

customizeBtn.addEventListener('click', () => customizePanel.classList.toggle('hidden'));
closePanel.addEventListener('click', () => customizePanel.classList.add('hidden'));

// Theme swatches
document.querySelectorAll('.theme-swatch').forEach(btn => {
  if (btn.dataset.theme === prefs.theme) btn.classList.add('active');
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-swatch').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    prefs.theme = btn.dataset.theme;
    localStorage.setItem('michat_theme', prefs.theme);
    applyPrefs();
  });
});

// Accent dots
document.querySelectorAll('.accent-dot').forEach(btn => {
  if (btn.dataset.accent === prefs.accent) btn.classList.add('active');
  btn.addEventListener('click', () => {
    document.querySelectorAll('.accent-dot').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    prefs.accent = btn.dataset.accent;
    localStorage.setItem('michat_accent', prefs.accent);
    applyPrefs();
  });
});

// Font size
const fontSizeRange = document.getElementById('font-size-range');
const fontSizeLabel = document.getElementById('font-size-label');
fontSizeRange.value = prefs.fontSize;
fontSizeLabel.textContent = prefs.fontSize + 'px';
fontSizeRange.addEventListener('input', () => {
  prefs.fontSize = parseInt(fontSizeRange.value);
  fontSizeLabel.textContent = prefs.fontSize + 'px';
  localStorage.setItem('michat_fontSize', prefs.fontSize);
  applyPrefs();
});

// Compact mode
const compactToggle = document.getElementById('compact-toggle');
compactToggle.checked = prefs.compact;
compactToggle.addEventListener('change', () => {
  prefs.compact = compactToggle.checked;
  localStorage.setItem('michat_compact', prefs.compact);
  applyPrefs();
});

// Display name override
const displayNameInput = document.getElementById('display-name-input');
const saveNameBtn      = document.getElementById('save-name-btn');
displayNameInput.value = customDisplayName || '';
saveNameBtn.addEventListener('click', () => {
  const name = displayNameInput.value.trim();
  if (!name) return;
  customDisplayName = name;
  localStorage.setItem('michat_displayName', name);
  if (currentUser) userNameEl.textContent = name;
  saveNameBtn.textContent = 'Saved ✓';
  setTimeout(() => saveNameBtn.textContent = 'Save', 2000);
});

// ============================================================
// UTILITIES
// ============================================================
function escapeHTML(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
}

function formatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today))     return 'Today';
  if (isSameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month:'long', day:'numeric', year:'numeric' });
}

function isSameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function shadeColor(hex, pct) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (num>>16) + pct));
  const g = Math.min(255, Math.max(0, ((num>>8)&0xff) + pct));
  const b = Math.min(255, Math.max(0, (num&0xff) + pct));
  return '#' + ((1<<24)|(r<<16)|(g<<8)|b).toString(16).slice(1);
}