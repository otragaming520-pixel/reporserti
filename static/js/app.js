// Minimal static app that simulates users, login, approval using localStorage
// Key storage keys: 'spa_users', 'spa_currentUser', 'spa_approvalRequests'
(function () {
  const STORAGE_KEY = 'spa_users';
  const CURRENT_KEY = 'spa_currentUser';
  const REQ_KEY = 'spa_approvalRequests';

  // Utility: SHA-256 hashing for passwords (returns hex)
  async function hashPassword(password) {
    const enc = new TextEncoder();
    const data = enc.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function loadUsers() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; } catch (e) { return []; }
  }
  function saveUsers(users) { localStorage.setItem(STORAGE_KEY, JSON.stringify(users)); }

  function loadRequests() { try { const raw = localStorage.getItem(REQ_KEY); return raw ? JSON.parse(raw) : []; } catch(e){ return []; } }
  function saveRequests(reqs) { localStorage.setItem(REQ_KEY, JSON.stringify(reqs)); }

  function getNextId(users) { return users.reduce((m,u)=>Math.max(m,u.id),0)+1; }
  function getNextReqId(reqs) { return reqs.reduce((m,r)=>Math.max(m,r.id),0)+1; }

  function getCurrentUser() { try { return JSON.parse(sessionStorage.getItem(CURRENT_KEY)); } catch(e){ return null; } }
  function setCurrentUser(user) { if(user) sessionStorage.setItem(CURRENT_KEY, JSON.stringify(user)); else sessionStorage.removeItem(CURRENT_KEY); }

  async function ensureDefaultAdmin() {
    const users = loadUsers();
    const admin = users.find(u => u.role === 'admin');
    if (!admin) {
      const hashed = await hashPassword('admin123');
      users.push({ id: getNextId(users), username: 'admin', passwordHash: hashed, role: 'admin', approved: true, createdAt: Date.now() });
      saveUsers(users);
      console.log('Default admin created: admin / admin123');
    }
  }

  async function registerDirect(username, password) {
    const users = loadUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return { success:false, message:'Username already exists' };
    const hashed = await hashPassword(password);
    const u = { id: getNextId(users), username, passwordHash: hashed, role: 'user', approved: false, createdAt: Date.now() };
    users.push(u); saveUsers(users); return { success:true, message:'Registered. Waiting for admin approval.' };
  }

  // Instead of directly registering, we create an approval request so admin can approve creation
  async function requestAccountCreation(username, password) {
    username = String(username || '').trim();
    if (!username || !password) return { success:false, message:'Username and password required' };
    const users = loadUsers();
    if (users.some(u => u.username.toLowerCase() === username.toLowerCase())) return { success:false, message:'Username already exists' };
    const reqs = loadRequests();
    const hashed = await hashPassword(password);
    const r = { id: getNextReqId(reqs), type: 'create', username, passwordHash: hashed, createdAt: Date.now(), status: 'pending', note: '' };
    reqs.push(r); saveRequests(reqs);
    return { success:true, message:'Account creation requested. Admin will approve.' };
  }

  async function requestPasswordChange(newPassword) {
    const cur = getCurrentUser(); if (!cur) return { success:false, message:'Not logged in' };
    if (!newPassword) return { success:false, message:'Password required' };
    const reqs = loadRequests();
    const hashed = await hashPassword(newPassword);
    const r = { id: getNextReqId(reqs), type: 'password_change', userId: cur.id, targetUsername: cur.username, passwordHash: hashed, createdAt: Date.now(), status: 'pending', note: '' };
    reqs.push(r); saveRequests(reqs);
    return { success:true, message:'Password change requested. Admin will approve.' };
  }

  async function login(username, password) {
    username = String(username || '').trim(); if (!username || !password) return { success:false, message:'Username and password required' };
    const users = loadUsers(); const user = users.find(u => u.username.toLowerCase() === username.toLowerCase()); if (!user) return { success:false, message:'Invalid credentials' };
    const hashed = await hashPassword(password); if (user.passwordHash !== hashed) return { success:false, message:'Invalid credentials' };
    setCurrentUser({ id: user.id, username: user.username, role: user.role, approved: user.approved }); return { success:true, message: 'Logged in' };
  }

  function logout() { setCurrentUser(null); }

  function getUsers() { return loadUsers().map(u=>({ id:u.id, username:u.username, role:u.role, approved:u.approved, createdAt:u.createdAt })); }
  function getPendingUsers() { return getUsers().filter(u=>!u.approved && u.role !== 'admin'); }

  function getApprovalRequests() { return loadRequests().filter(r=>r.status==='pending'); }

  function approveRequest(id) {
    const reqs = loadRequests(); const idx = reqs.findIndex(r=>r.id===id); if (idx===-1) return false; const r = reqs[idx];
    if (r.type==='create') {
      // create user and mark approved
      const users = loadUsers(); if (users.some(u=>u.username.toLowerCase()===r.username.toLowerCase())) { reqs[idx].status='rejected'; saveRequests(reqs); return false; }
      const u = { id: getNextId(users), username: r.username, passwordHash: r.passwordHash, role: 'user', approved: true, createdAt: Date.now() };
      users.push(u); saveUsers(users);
      reqs[idx].status='approved'; saveRequests(reqs); return true;
    }
    if (r.type==='password_change') {
      const users = loadUsers(); const uidx = users.findIndex(x=>x.id===r.userId); if (uidx===-1) { reqs[idx].status='rejected'; saveRequests(reqs); return false; }
      users[uidx].passwordHash = r.passwordHash; saveUsers(users);
      // If the user who requested is logged in, update session
      const cur = getCurrentUser(); if (cur && cur.id === r.userId) setCurrentUser(Object.assign({}, cur, { }));
      reqs[idx].status='approved'; saveRequests(reqs); return true;
    }
    return false;
  }

  function rejectRequest(id) {
    const reqs = loadRequests(); const idx = reqs.findIndex(r=>r.id===id); if (idx===-1) return false; reqs[idx].status='rejected'; saveRequests(reqs); return true;
  }

  function removeUser(id) {
    let users = loadUsers(); users = users.filter(x=>x.id!==id); saveUsers(users);
    // Also remove any pending requests for that user
    let reqs = loadRequests(); reqs = reqs.filter(r=> !(r.userId && r.userId===id) ); saveRequests(reqs);
    // If current user was removed, logout
    const cur = getCurrentUser(); if (cur && cur.id === id) logout();
    return true;
  }

  // Boot
  ensureDefaultAdmin();

  // Expose API
  window.StaticApp = {
    hashPassword,
    registerDirect,
    requestAccountCreation,
    requestPasswordChange,
    login,
    logout,
    getUsers,
    getPendingUsers,
    getApprovalRequests,
    approveRequest,
    rejectRequest,
    removeUser,
    getCurrentUser
  };
})();
