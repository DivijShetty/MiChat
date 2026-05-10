// ============================================================
// MiChat v4 — app.js
// Features: Rooms (create/delete), Admins, Message deletion,
//           Firebase Storage (file sharing), Typing indicators,
//           Customization panel, XSS protection
// ============================================================

import { firebaseConfig, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET }
  from './firebase-config.js';

// ── Firebase SDK ─────────────────────────────────────────────
import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged }
  from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, setDoc, getDoc, getDocs,
  updateDoc, deleteDoc, arrayUnion, arrayRemove,
  query, orderBy, onSnapshot, serverTimestamp, limitToLast, writeBatch
} from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// ── Init ─────────────────────────────────────────────────────
const firebaseApp = initializeApp(firebaseConfig);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);
const provider    = new GoogleAuthProvider();

// ── DOM refs ─────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const loginScreen       = $('login-screen');
const loginBtn          = $('login-btn');
const logoutBtn         = $('logout-btn');
const chatApp           = $('chat-app');
const roomListEl        = $('room-list');
const messagesEl        = $('messages');
const messageForm       = $('message-form');
const messageInput      = $('message-input');
const activeRoomNameEl  = $('active-room-name');
const roomMemberCount   = $('room-member-count');
const msgCountBadge     = $('msg-count-badge');
const roomSettingsBtn   = $('room-settings-btn');
const typingIndicator   = $('typing-indicator');
const typingText        = $('typing-text');
const fileInput         = $('file-input');
const attachBtn         = $('attach-btn');
const filePreview       = $('file-preview');
const filePreviewName   = $('file-preview-name');
const fileCancelBtn     = $('file-cancel');
const uploadProgress    = $('upload-progress');
const uploadBar         = $('upload-bar');
const uploadLabel       = $('upload-label');
const customizeBtn      = $('customize-btn');
const customizePanel    = $('customize-panel');
const closePanel        = $('close-panel');
const lightboxEl        = $('lightbox');
const lightboxImg       = $('lightbox-img');
const userAvatarEl      = $('user-avatar');
const userNameEl        = $('user-name');
const userRoleBadge     = $('user-role-badge');
const myUidDisplay      = $('my-uid-display');
const copyUidBtn        = $('copy-uid-btn');
const newRoomBtn        = $('new-room-btn');
const modalOverlay      = $('modal-overlay');
const createRoomSubmit  = $('create-room-submit');
const newRoomNameInput  = $('new-room-name');
const newRoomDescInput  = $('new-room-desc');
const roomSettingsOverlay = $('room-settings-overlay');
const settingsRoomTitle = $('settings-room-title');
const membersList       = $('members-list');
const adminsList        = $('admins-list');
const inviteUidInput    = $('invite-uid-input');
const inviteBtn         = $('invite-btn');
const deleteRoomBtn     = $('delete-room-btn');

// ── App state ────────────────────────────────────────────────
let currentUser         = null;
let currentRoomId       = null;
let currentRoomData     = null;   // live room document data
let unsubRoom           = null;   // messages listener unsub
let unsubTyping         = null;   // typing listener unsub
let unsubRoomList       = null;   // room list listener unsub
let unsubRoomDoc        = null;   // current room doc listener unsub
let selectedFile        = null;
let typingTimer         = null;
let messageCount        = 0;
let customDisplayName   = localStorage.getItem('michat_displayName') || null;

// ════════════════════════════════════════════════════════════
// AUTH
// ════════════════════════════════════════════════════════════
loginBtn.addEventListener('click', () => signInWithPopup(auth, provider).catch(console.error));

logoutBtn.addEventListener('click', async () => {
  await clearTypingStatus();
  await signOut(auth).catch(console.error);
});

onAuthStateChanged(auth, async user => {
  if (user) {
    currentUser = user;
    loginScreen.classList.add('hidden');
    chatApp.classList.remove('hidden');

    // Populate sidebar footer
    userAvatarEl.src = user.photoURL || 'https://placehold.co/40';
    userNameEl.textContent = customDisplayName || user.displayName || 'Anonymous';
    myUidDisplay.textContent = user.uid;

    // Upsert user profile in Firestore
    await setDoc(doc(db, 'users', user.uid), {
      displayName: user.displayName,
      photoURL:    user.photoURL,
      email:       user.email,
      lastSeen:    serverTimestamp()
    }, { merge: true });

    startRoomListListener();
  } else {
    currentUser = null;
    loginScreen.classList.remove('hidden');
    chatApp.classList.add('hidden');
    stopAll();
    messagesEl.innerHTML = '';
    roomListEl.innerHTML = '';
  }
});

// ════════════════════════════════════════════════════════════
// ROOM LIST — live, real-time
// Shows public rooms + private rooms the user is a member of
// ════════════════════════════════════════════════════════════
function startRoomListListener() {
  if (unsubRoomList) unsubRoomList();

  const q = query(collection(db, 'rooms'), orderBy('createdAt', 'asc'));

  unsubRoomList = onSnapshot(q, snapshot => {
    roomListEl.innerHTML = '';
    let firstRoom = null;

    snapshot.forEach(docSnap => {
      const room = { id: docSnap.id, ...docSnap.data() };

      // Filter: show public rooms OR rooms where user is a member
      const canSee = !room.isPrivate
        || (room.members || []).includes(currentUser.uid)
        || (room.admins  || []).includes(currentUser.uid);

      if (!canSee) return;
      if (!firstRoom) firstRoom = room.id;

      const btn = document.createElement('button');
      btn.className = 'room-item' + (room.id === currentRoomId ? ' active' : '');
      btn.dataset.roomId = room.id;

      const lockIcon = room.isPrivate
        ? '<span class="room-private-icon">🔒</span>' : '';

      btn.innerHTML = `
        <span class="room-item-name"># ${escHTML(room.name)}</span>
        ${lockIcon}
      `;

      btn.addEventListener('click', () => joinRoom(room.id));
      roomListEl.appendChild(btn);
    });

    // Auto-join first available room on initial load
    if (!currentRoomId && firstRoom) joinRoom(firstRoom);

  }, err => {
    // Surface Firestore errors so they're visible — most common cause
    // is a missing composite index for orderBy('createdAt').
    console.error('Room list error:', err);
    if (err.code === 'failed-precondition') {
      roomListEl.innerHTML = `
        <div style="padding:12px;font-size:12px;color:var(--red);line-height:1.6">
          ⚠️ Missing Firestore index.<br>
          Open browser DevTools console — click the index link there, wait ~1 min, then refresh.
        </div>`;
    } else if (err.code === 'permission-denied') {
      roomListEl.innerHTML = `
        <div style="padding:12px;font-size:12px;color:var(--red);line-height:1.6">
          ⚠️ Permission denied.<br>
          Publish the new <code>firestore.rules</code> in Firebase Console.
        </div>`;
    }
  });
}

// ════════════════════════════════════════════════════════════
// CREATE ROOM
// ════════════════════════════════════════════════════════════
newRoomBtn.addEventListener('click', () => {
  newRoomNameInput.value = '';
  newRoomDescInput.value = '';
  modalOverlay.classList.remove('hidden');
  newRoomNameInput.focus();
});

// Close modal on overlay click or cancel buttons
modalOverlay.addEventListener('click', e => {
  if (e.target === modalOverlay) modalOverlay.classList.add('hidden');
});
document.querySelectorAll('[data-close="create-room-modal"]').forEach(btn =>
  btn.addEventListener('click', () => modalOverlay.classList.add('hidden'))
);

createRoomSubmit.addEventListener('click', async () => {
  const name = newRoomNameInput.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!name) { newRoomNameInput.focus(); return; }

  const isPrivate = document.querySelector('input[name="room-privacy"]:checked').value === 'private';

  try {
    createRoomSubmit.disabled = true;
    createRoomSubmit.textContent = 'Creating…';

    const roomRef = await addDoc(collection(db, 'rooms'), {
      name,
      description: newRoomDescInput.value.trim(),
      isPrivate,
      createdBy:   currentUser.uid,
      admins:      [currentUser.uid],
      members:     [currentUser.uid],
      createdAt:   serverTimestamp()
    });

    modalOverlay.classList.add('hidden');
    joinRoom(roomRef.id);
  } catch (err) {
    console.error('Create room failed:', err);
    const code = err?.code || 'unknown';
    if (code === 'permission-denied') {
      alert('Permission denied — paste the new firestore.rules into Firebase Console → Firestore → Rules and click Publish.');
    } else if (code === 'failed-precondition') {
      alert('Missing Firestore index. Open browser console — click the link there to create the index, wait ~1 min, then retry.');
    } else {
      alert('Create room failed (' + code + '). See browser console for details.');
    }
  } finally {
    createRoomSubmit.disabled = false;
    createRoomSubmit.textContent = 'Create room';
  }
});

// ════════════════════════════════════════════════════════════
// JOIN ROOM
// ════════════════════════════════════════════════════════════
async function joinRoom(roomId) {
  if (roomId === currentRoomId) return;

  await clearTypingStatus();
  stopRoomListeners();

  currentRoomId = roomId;

  // Highlight active room in sidebar
  document.querySelectorAll('.room-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.roomId === roomId);
  });

  // Subscribe to room document (for admin/member changes)
  unsubRoomDoc = onSnapshot(doc(db, 'rooms', roomId), snap => {
    if (!snap.exists()) return;
    currentRoomData = { id: snap.id, ...snap.data() };
    renderRoomHeader();
  });

  startChatListener(roomId);
  startTypingListener(roomId);
}

function renderRoomHeader() {
  if (!currentRoomData) return;
  const { name, members = [], admins = [] } = currentRoomData;

  activeRoomNameEl.textContent = `# ${name}`;
  messageInput.placeholder = `Message #${name}…`;
  roomMemberCount.textContent = `${members.length} member${members.length !== 1 ? 's' : ''}`;

  const isAdmin = admins.includes(currentUser?.uid);
  roomSettingsBtn.classList.toggle('hidden', !isAdmin);

  // Show admin badge in sidebar footer
  if (isAdmin) {
    userRoleBadge.textContent = '⚡ ADMIN';
    userRoleBadge.classList.remove('hidden');
  } else {
    userRoleBadge.classList.add('hidden');
  }
}

// ════════════════════════════════════════════════════════════
// MESSAGES — real-time, limitToLast(50)
// ════════════════════════════════════════════════════════════
function startChatListener(roomId) {
  const q = query(
    collection(db, 'rooms', roomId, 'messages'),
    orderBy('createdAt', 'asc'),
    limitToLast(50)
  );

  unsubRoom = onSnapshot(q, snapshot => {
    messagesEl.innerHTML = '';
    messageCount = 0;
    let lastDate = null;

    snapshot.forEach(docSnap => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const ts   = data.createdAt?.toDate?.() ?? null;

      if (ts) {
        const label = formatDateLabel(ts);
        if (label !== lastDate) { renderDateDivider(label); lastDate = label; }
      }

      renderMessage(data, ts);
      messageCount++;
    });

    if (messageCount === 0) renderEmptyState();
    msgCountBadge.textContent = `${messageCount} message${messageCount !== 1 ? 's' : ''}`;
    messagesEl.scrollTop = messagesEl.scrollHeight;
  });
}

// ════════════════════════════════════════════════════════════
// RENDER MESSAGE
// ════════════════════════════════════════════════════════════
function renderMessage(data, ts) {
  const isAdmin  = (currentRoomData?.admins || []).includes(currentUser?.uid);
  const isOwner  = data.uid === currentUser?.uid;
  const canDelete = isAdmin || isOwner;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.dataset.msgId = data.id;

  // Soft-deleted message
  if (data.deletedAt) {
    bubble.innerHTML = `
      <img class="avatar" src="https://placehold.co/40" alt="">
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-name">${escHTML(data.displayName || 'Unknown')}</span>
          <span class="msg-time">${ts ? formatTime(ts) : ''}</span>
        </div>
        <p class="msg-text deleted">🚫 This message was deleted.</p>
      </div>`;
    messagesEl.appendChild(bubble);
    return;
  }

  const senderIsAdmin = (currentRoomData?.admins || []).includes(data.uid);
  const nameClass = senderIsAdmin ? 'msg-name is-admin' : 'msg-name';

  // Attachment HTML
  let attachHTML = '';
  if (data.attachmentUrl) {
    if (data.attachmentType === 'image') {
      attachHTML = `<img class="msg-image" src="${escHTML(data.attachmentUrl)}" alt="${escHTML(data.attachmentName || 'image')}" loading="lazy">`;
    } else if (data.attachmentType === 'video') {
      attachHTML = `<video class="msg-image" src="${escHTML(data.attachmentUrl)}" controls style="max-width:300px;border-radius:8px;margin-top:5px;"></video>`;
    } else {
      attachHTML = `
        <a class="msg-file" href="${escHTML(data.attachmentUrl)}" target="_blank" rel="noopener noreferrer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${escHTML(data.attachmentName || 'Download file')}
        </a>`;
    }
  }

  bubble.innerHTML = `
    <img class="avatar" src="${escHTML(data.photoURL || 'https://placehold.co/40')}" alt="${escHTML(data.displayName || '')}">
    <div class="msg-body">
      <div class="msg-meta">
        <span class="${nameClass}">${escHTML(data.displayName || 'Anonymous')}</span>
        <span class="msg-time">${ts ? formatTime(ts) : ''}</span>
      </div>
      ${data.text ? `<p class="msg-text">${escHTML(data.text)}</p>` : ''}
      ${attachHTML}
    </div>
    ${canDelete ? `
      <div class="msg-actions">
        <button class="msg-action-btn delete-btn" title="Delete message">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>` : ''}
  `;

  // Delete handler — soft delete (keeps thread structure)
  if (canDelete) {
    bubble.querySelector('.delete-btn').addEventListener('click', async () => {
      if (!confirm('Delete this message?')) return;
      try {
        await updateDoc(
          doc(db, 'rooms', currentRoomId, 'messages', data.id),
          { deletedAt: serverTimestamp() }
        );
      } catch (err) {
        console.error('Delete failed:', err);
        alert('Delete failed. Check your admin permissions.');
      }
    });
  }

  // Image lightbox
  if (data.attachmentType === 'image') {
    bubble.querySelector('.msg-image')?.addEventListener('click', () => {
      lightboxImg.src = data.attachmentUrl;
      lightboxEl.classList.remove('hidden');
    });
  }

  messagesEl.appendChild(bubble);
}

// ════════════════════════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════════════════════════
messageForm.addEventListener('submit', async e => {
  e.preventDefault();

  const text = messageInput.value.trim();
  if (!text && !selectedFile) return;
  if (!currentUser || !currentRoomId) return;

  messageInput.value = '';
  clearTypingStatus();

  let attachment = null;

  if (selectedFile) {
    filePreview.classList.add('hidden');
    const file = selectedFile;
    selectedFile = null;

    if (CLOUDINARY_CLOUD_NAME === 'YOUR_CLOUD_NAME') {
      alert('Set up Cloudinary in firebase-config.js to share files.');
      return;
    }
    try {
      attachment = await uploadToCloudinary(file);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('File upload failed. Check your Cloudinary config.');
      return;
    }
  }

  try {
    await addDoc(collection(db, 'rooms', currentRoomId, 'messages'), {
      text,
      uid:         currentUser.uid,
      displayName: customDisplayName || currentUser.displayName,
      photoURL:    currentUser.photoURL,
      createdAt:   serverTimestamp(),
      deletedAt:   null,
      ...(attachment && {
        attachmentUrl:  attachment.url,
        attachmentType: attachment.resourceType,
        attachmentName: attachment.originalName
      })
    });
  } catch (err) {
    console.error('Send failed:', err);
  }
});

// ════════════════════════════════════════════════════════════
// TYPING INDICATORS
// ════════════════════════════════════════════════════════════
function startTypingListener(roomId) {
  if (unsubTyping) { unsubTyping(); unsubTyping = null; }

  unsubTyping = onSnapshot(collection(db, 'rooms', roomId, 'typing'), snap => {
    const typers = [];
    snap.forEach(d => {
      if (d.id !== currentUser?.uid) typers.push(d.data().displayName || 'Someone');
    });

    if (typers.length === 0) {
      typingIndicator.classList.add('hidden');
    } else {
      typingIndicator.classList.remove('hidden');
      typingText.textContent = typers.length === 1
        ? `${typers[0]} is typing…`
        : typers.length === 2
          ? `${typers[0]} and ${typers[1]} are typing…`
          : `${typers.length} people are typing…`;
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }
  });
}

messageInput.addEventListener('input', () => {
  if (!currentUser || !currentRoomId) return;
  setDoc(doc(db, 'rooms', currentRoomId, 'typing', currentUser.uid), {
    displayName: customDisplayName || currentUser.displayName || 'Anonymous',
    uid: currentUser.uid
  });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(clearTypingStatus, 4000);
});

async function clearTypingStatus() {
  clearTimeout(typingTimer);
  if (!currentUser || !currentRoomId) return;
  try {
    await deleteDoc(doc(db, 'rooms', currentRoomId, 'typing', currentUser.uid));
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════
// ROOM SETTINGS PANEL (admin only)
// ════════════════════════════════════════════════════════════
roomSettingsBtn.addEventListener('click', openRoomSettings);

document.querySelectorAll('[data-close-overlay="room-settings-overlay"]').forEach(btn =>
  btn.addEventListener('click', () => roomSettingsOverlay.classList.add('hidden'))
);
roomSettingsOverlay.addEventListener('click', e => {
  if (e.target === roomSettingsOverlay) roomSettingsOverlay.classList.add('hidden');
});

// Settings tabs
document.querySelectorAll('.settings-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
    tab.classList.add('active');
    $(`tab-${tab.dataset.tab}`).classList.remove('hidden');
  });
});

async function openRoomSettings() {
  if (!currentRoomData) return;
  settingsRoomTitle.textContent = `# ${currentRoomData.name} — settings`;
  roomSettingsOverlay.classList.remove('hidden');

  // Reset to Members tab
  document.querySelectorAll('.settings-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.add('hidden'));
  document.querySelector('.settings-tab[data-tab="members"]').classList.add('active');
  $('tab-members').classList.remove('hidden');

  await renderMembersList();
  await renderAdminsList();
}

async function renderMembersList() {
  membersList.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px 0">Loading…</p>';
  const { members = [], admins = [], createdBy } = currentRoomData;

  const rows = await Promise.all(members.map(uid => buildMemberRow(uid, admins, createdBy, 'member')));
  membersList.innerHTML = '';
  rows.forEach(row => row && membersList.appendChild(row));
}

async function renderAdminsList() {
  adminsList.innerHTML = '<p style="font-size:12px;color:var(--text-muted);padding:8px 0">Loading…</p>';
  const { admins = [], createdBy } = currentRoomData;

  const rows = await Promise.all(admins.map(uid => buildMemberRow(uid, admins, createdBy, 'admin')));
  adminsList.innerHTML = '';
  rows.forEach(row => row && adminsList.appendChild(row));
}

async function buildMemberRow(uid, admins, createdBy, context) {
  // Fetch user profile
  let displayName = uid.slice(0, 12) + '…';
  let photoURL    = '';
  try {
    const userSnap = await getDoc(doc(db, 'users', uid));
    if (userSnap.exists()) {
      const ud = userSnap.data();
      displayName = ud.displayName || displayName;
      photoURL    = ud.photoURL    || '';
    }
  } catch (_) {}

  const isOwner    = uid === createdBy;
  const isAdmin    = admins.includes(uid);
  const isSelf     = uid === currentUser?.uid;
  const amICreator = currentUser?.uid === createdBy;

  const row = document.createElement('div');
  row.className = 'member-row';

  const avatarHTML = photoURL
    ? `<img class="member-avatar" src="${escHTML(photoURL)}" alt="">`
    : `<div class="member-avatar-placeholder">${(displayName[0] || '?').toUpperCase()}</div>`;

  const badge = isOwner
    ? '<span class="member-badge badge-owner">Owner</span>'
    : isAdmin
      ? '<span class="member-badge badge-admin">Admin</span>'
      : '';

  // Actions: only creator can promote/demote/kick; can't act on self or owner
  let actionsHTML = '';
  if (amICreator && !isSelf && !isOwner) {
    if (context === 'member') {
      const promoteBtn = isAdmin ? '' :
        `<button class="member-btn promote" data-uid="${uid}" data-action="promote">Make admin</button>`;
      const kickBtn = `<button class="member-btn" data-uid="${uid}" data-action="kick">Kick</button>`;
      actionsHTML = `<div class="member-actions">${promoteBtn}${kickBtn}</div>`;
    } else if (context === 'admin') {
      const demoteBtn = `<button class="member-btn" data-uid="${uid}" data-action="demote">Remove admin</button>`;
      actionsHTML = `<div class="member-actions">${demoteBtn}</div>`;
    }
  }

  row.innerHTML = `
    ${avatarHTML}
    <div class="member-info">
      <div class="member-name">${escHTML(displayName)}${isSelf ? ' <span style="color:var(--text-muted);font-weight:400">(you)</span>' : ''}</div>
      <div class="member-uid">${uid}</div>
    </div>
    ${badge}
    ${actionsHTML}
  `;

  // Wire up action buttons
  row.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', () => handleMemberAction(btn.dataset.action, btn.dataset.uid));
  });

  return row;
}

async function handleMemberAction(action, uid) {
  const roomRef = doc(db, 'rooms', currentRoomId);
  try {
    if (action === 'promote') {
      await updateDoc(roomRef, { admins: arrayUnion(uid) });
    } else if (action === 'demote') {
      await updateDoc(roomRef, { admins: arrayRemove(uid) });
    } else if (action === 'kick') {
      if (!confirm('Remove this member from the room?')) return;
      await updateDoc(roomRef, {
        members: arrayRemove(uid),
        admins:  arrayRemove(uid)
      });
    }
    // Re-render after action
    await renderMembersList();
    await renderAdminsList();
  } catch (err) {
    console.error('Member action failed:', err);
    alert('Action failed. You may not have permission.');
  }
}

// ── Invite member ────────────────────────────────────────────
inviteBtn.addEventListener('click', async () => {
  const uid = inviteUidInput.value.trim();
  if (!uid) return;

  // Verify user exists
  const userSnap = await getDoc(doc(db, 'users', uid)).catch(() => null);
  if (!userSnap?.exists()) {
    alert('User not found. Ask them to log in to MiChat first so their profile is created.');
    return;
  }

  try {
    inviteBtn.disabled = true;
    inviteBtn.textContent = 'Inviting…';
    await updateDoc(doc(db, 'rooms', currentRoomId), {
      members: arrayUnion(uid)
    });
    inviteUidInput.value = '';
    await renderMembersList();
    inviteBtn.textContent = 'Invited ✓';
    setTimeout(() => { inviteBtn.textContent = 'Invite'; inviteBtn.disabled = false; }, 2000);
  } catch (err) {
    console.error('Invite failed:', err);
    alert('Invite failed. Check Firestore rules.');
    inviteBtn.disabled = false;
    inviteBtn.textContent = 'Invite';
  }
});

// ── Delete room ───────────────────────────────────────────────
deleteRoomBtn.addEventListener('click', async () => {
  if (!currentRoomData) return;
  const confirmed = confirm(
    `Permanently delete #${currentRoomData.name}?\n\nAll messages will be lost. This cannot be undone.`
  );
  if (!confirmed) return;

  try {
    deleteRoomBtn.disabled = true;
    deleteRoomBtn.textContent = 'Deleting…';

    // Delete all messages in a batch (Firestore limit: 500/batch)
    const msgSnap = await getDocs(collection(db, 'rooms', currentRoomId, 'messages'));
    const batches = [];
    let batch = writeBatch(db);
    let count = 0;

    msgSnap.forEach(d => {
      batch.delete(d.ref);
      count++;
      if (count === 499) {
        batches.push(batch.commit());
        batch = writeBatch(db);
        count = 0;
      }
    });
    batches.push(batch.commit());
    await Promise.all(batches);

    // Delete room doc
    await deleteDoc(doc(db, 'rooms', currentRoomId));

    roomSettingsOverlay.classList.add('hidden');
    currentRoomId = null;
    currentRoomData = null;
    messagesEl.innerHTML = '';
    activeRoomNameEl.textContent = 'Select a room';
  } catch (err) {
    console.error('Delete room failed:', err);
    alert('Failed to delete room. Check Firestore rules.');
    deleteRoomBtn.disabled = false;
    deleteRoomBtn.textContent = 'Delete room';
  }
});

// ════════════════════════════════════════════════════════════
// FILE SHARING — Cloudinary free tier
// ════════════════════════════════════════════════════════════
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
  const fd = new FormData();
  fd.append('file', file);
  fd.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

  uploadProgress.classList.remove('hidden');
  uploadBar.style.width = '0%';

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`);

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) {
        const pct = Math.round(e.loaded / e.total * 100);
        uploadBar.style.width = pct + '%';
        uploadLabel.textContent = `Uploading… ${pct}%`;
      }
    };

    xhr.onload = () => {
      uploadProgress.classList.add('hidden');
      if (xhr.status === 200) {
        const d = JSON.parse(xhr.responseText);
        resolve({ url: d.secure_url, resourceType: d.resource_type, originalName: file.name });
      } else {
        reject(new Error('Cloudinary upload failed'));
      }
    };

    xhr.onerror = () => { uploadProgress.classList.add('hidden'); reject(new Error('Network error')); };
    xhr.send(fd);
  });
}

// ════════════════════════════════════════════════════════════
// LIGHTBOX
// ════════════════════════════════════════════════════════════
lightboxEl.addEventListener('click', () => lightboxEl.classList.add('hidden'));

// ════════════════════════════════════════════════════════════
// CUSTOMIZATION (localStorage — no DB cost)
// ════════════════════════════════════════════════════════════
const prefs = {
  theme:    localStorage.getItem('michat_theme')    || 'dark',
  accent:   localStorage.getItem('michat_accent')   || '#5b7cfa',
  fontSize: parseInt(localStorage.getItem('michat_fontSize') || '14'),
  compact:  localStorage.getItem('michat_compact')  === 'true'
};

function applyPrefs() {
  document.documentElement.setAttribute('data-theme', prefs.theme);
  document.documentElement.style.setProperty('--accent',      prefs.accent);
  document.documentElement.style.setProperty('--accent-dim',  shadeColor(prefs.accent, -20));
  document.documentElement.style.setProperty('--accent-glow', hexToRgba(prefs.accent, 0.18));
  document.documentElement.style.setProperty('--msg-font-size', prefs.fontSize + 'px');
  document.body.classList.toggle('compact', prefs.compact);
}
applyPrefs();

customizeBtn.addEventListener('click',  () => customizePanel.classList.toggle('hidden'));
closePanel.addEventListener('click',    () => customizePanel.classList.add('hidden'));

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

const fontSizeRange = $('font-size-range');
const fontSizeLabel = $('font-size-label');
fontSizeRange.value = prefs.fontSize;
fontSizeLabel.textContent = prefs.fontSize + 'px';
fontSizeRange.addEventListener('input', () => {
  prefs.fontSize = parseInt(fontSizeRange.value);
  fontSizeLabel.textContent = prefs.fontSize + 'px';
  localStorage.setItem('michat_fontSize', prefs.fontSize);
  applyPrefs();
});

const compactToggle = $('compact-toggle');
compactToggle.checked = prefs.compact;
compactToggle.addEventListener('change', () => {
  prefs.compact = compactToggle.checked;
  localStorage.setItem('michat_compact', prefs.compact);
  applyPrefs();
});

const displayNameInput = $('display-name-input');
const saveNameBtn      = $('save-name-btn');
displayNameInput.value = customDisplayName || '';
saveNameBtn.addEventListener('click', () => {
  const name = displayNameInput.value.trim();
  if (!name) return;
  customDisplayName = name;
  localStorage.setItem('michat_displayName', name);
  if (currentUser) userNameEl.textContent = name;
  saveNameBtn.textContent = 'Saved ✓';
  setTimeout(() => { saveNameBtn.textContent = 'Save'; }, 2000);
});

copyUidBtn.addEventListener('click', () => {
  if (!currentUser) return;
  navigator.clipboard.writeText(currentUser.uid).then(() => {
    copyUidBtn.textContent = 'Copied!';
    setTimeout(() => { copyUidBtn.textContent = 'Copy'; }, 2000);
  });
});

// ════════════════════════════════════════════════════════════
// RENDER HELPERS
// ════════════════════════════════════════════════════════════
function renderDateDivider(label) {
  const div = document.createElement('div');
  div.className = 'date-divider';
  div.textContent = label;
  messagesEl.appendChild(div);
}

function renderEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = `<span class="empty-icon">💬</span><span>No messages yet — say hello!</span>`;
  messagesEl.appendChild(div);
}

// ════════════════════════════════════════════════════════════
// CLEANUP
// ════════════════════════════════════════════════════════════
function stopRoomListeners() {
  if (unsubRoom)    { unsubRoom();    unsubRoom    = null; }
  if (unsubTyping)  { unsubTyping();  unsubTyping  = null; }
  if (unsubRoomDoc) { unsubRoomDoc(); unsubRoomDoc = null; }
}

function stopAll() {
  stopRoomListeners();
  if (unsubRoomList) { unsubRoomList(); unsubRoomList = null; }
  currentRoomId   = null;
  currentRoomData = null;
}

// ════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════
function escHTML(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateLabel(date) {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(date, today))     return 'Today';
  if (sameDay(date, yesterday)) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
      && a.getMonth()    === b.getMonth()
      && a.getDate()     === b.getDate();
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function shadeColor(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.max(0, (n >> 16)        + pct));
  const g = Math.min(255, Math.max(0, ((n >> 8) & 0xff) + pct));
  const b = Math.min(255, Math.max(0, (n & 0xff)        + pct));
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}