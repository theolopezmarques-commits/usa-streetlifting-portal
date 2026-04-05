/* ===== USA Streetlifting – Judge Certification Portal JS ===== */

// API_BASE is injected by the mobile build script (build.sh).
// In the browser it is undefined, so all calls use relative URLs (same origin).
/* global API_BASE */
const _API = (typeof API_BASE !== 'undefined') ? API_BASE : '';

// ===================== CAPACITOR NATIVE SETUP =====================
(function initCapacitor() {
  if (typeof window === 'undefined' || !window.Capacitor) return;
  const { StatusBar, SplashScreen, App } = window.Capacitor.Plugins;

  // Dark status bar to match the app's dark theme
  StatusBar?.setStyle({ style: 'DARK' });
  StatusBar?.setBackgroundColor({ color: '#0a0a0a' });

  // Hide splash screen after the app is ready
  document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => SplashScreen?.hide(), 300);
  });

  // Android: hardware back button — go back a page or minimize
  App?.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.minimizeApp?.();
    }
  });
})();

let currentUser = null;

// ===================== NAVIGATION =====================
function navigate(page) {
  // Close mobile menu
  document.getElementById('nav-links')?.classList.remove('open');
  document.getElementById('hamburger')?.classList.remove('open');

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`page-${page}`);
  if (target) target.classList.add('active');

  // Trigger slide-in / fade-up animations on the new page
  setTimeout(() => {
    target.querySelectorAll('.slide-in, .fade-up').forEach(el => el.classList.add('visible'));
  }, 50);

  // Page-specific init
  if (page === 'dashboard' && currentUser) { loadDashboard(); loadCompHistory(); initCompHistory(); }
  if (page === 'payment' && currentUser) loadPaymentOptions();
  if (page === 'profile' && currentUser) loadProfile();
  if (page === 'admin' && currentUser?.is_admin) loadAdmin();
  if (page === 'course' && currentUser) loadCourse();
  if (page === 'home') {
    startParticles();
    loadStats().then(() => animateCounters());
  }
  if (page === 'directory') loadDirectory();
  if (page === 'events') loadEvents();
  if (page === 'chat' && currentUser) {
    if (currentUser._isCertified || currentUser.is_admin) loadChat();
    else {
      document.getElementById('chat-box').innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:3rem;">Chat is available to certified judges only.<br><br><a data-nav="payment" style="color:var(--clr-primary);cursor:pointer;">Get certified →</a></p>';
    }
  }
  if (page === 'judge-profile') { /* loaded externally via openJudgeProfile() */ }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleMenu() {
  document.getElementById('hamburger').classList.toggle('open');
  document.getElementById('nav-links').classList.toggle('open');
}

function updateNav() {
  const loggedIn = !!currentUser;
  document.getElementById('nav-login').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-register').classList.toggle('hidden', loggedIn);
  document.getElementById('nav-dashboard').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-profile').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-payment').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-logout').classList.toggle('hidden', !loggedIn);
  document.getElementById('nav-admin').classList.toggle('hidden', !(loggedIn && currentUser.is_admin));
  const chatNav = document.getElementById('nav-chat');
  if (chatNav) chatNav.classList.toggle('hidden', !(loggedIn && (currentUser?._isCertified || currentUser?.is_admin)));
  // Course nav: shown when logged in (visibility refined when status is loaded)
  const courseNav = document.getElementById('nav-course');
  if (courseNav) courseNav.classList.toggle('hidden', !loggedIn);

  const heroReg = document.getElementById('hero-register');
  const heroLogin = document.getElementById('hero-login');
  if (heroReg) heroReg.classList.toggle('hidden', loggedIn);
  if (heroLogin) heroLogin.classList.toggle('hidden', loggedIn);

  // Hide all "Apply Now" buttons when logged in, show dashboard buttons instead
  document.querySelectorAll('.guest-only').forEach(el => el.classList.toggle('hidden', loggedIn));
  document.querySelectorAll('.logged-only').forEach(el => el.classList.toggle('hidden', !loggedIn));
}

// ===================== TOAST NOTIFICATIONS =====================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => { toast.classList.add('out'); }, 3000);
  setTimeout(() => { toast.remove(); }, 3400);
}

// ===================== BUTTON RIPPLE EFFECT =====================
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const circle = document.createElement('span');
  circle.className = 'ripple';
  const rect = btn.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  circle.style.width = circle.style.height = size + 'px';
  circle.style.left = (e.clientX - rect.left - size / 2) + 'px';
  circle.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(circle);
  setTimeout(() => circle.remove(), 600);
});

// ===================== API HELPERS =====================
async function apiFetch(url, options = {}) {
  const res = await fetch(_API + url, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error(data.error || 'Request failed');
    if (data.userId) err.userId = data.userId;
    if (data.pending_verification) err.pending_verification = true;
    throw err;
  }
  return data;
}

function setButtonLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  const text = btn.querySelector('.btn-text');
  const spinner = btn.querySelector('.btn-spinner');
  if (loading) {
    btn.disabled = true;
    if (text) text.classList.add('hidden');
    if (spinner) spinner.classList.remove('hidden');
  } else {
    btn.disabled = false;
    if (text) text.classList.remove('hidden');
    if (spinner) spinner.classList.add('hidden');
  }
}

// ===================== EMAIL VERIFICATION =====================
let pendingVerifyUserId = null;

function showVerifyModal(userId) {
  pendingVerifyUserId = userId;
  const modal = document.getElementById('verify-modal');
  modal.setAttribute('aria-hidden', 'false');
  modal.style.display = 'flex';
  document.getElementById('verify-code-input').value = '';
  document.getElementById('verify-error').textContent = '';
  document.getElementById('verify-code-input').focus();
}

function hideVerifyModal() {
  const modal = document.getElementById('verify-modal');
  modal.setAttribute('aria-hidden', 'true');
  modal.style.display = 'none';
  pendingVerifyUserId = null;
}

async function submitVerifyCode() {
  const code = document.getElementById('verify-code-input').value.trim();
  const errEl = document.getElementById('verify-error');
  if (code.length !== 6) { errEl.textContent = 'Enter the 6-digit code.'; return; }
  const btn = document.getElementById('verify-submit-btn');
  btn.disabled = true; btn.textContent = 'Verifying…';
  try {
    const data = await apiFetch('/api/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ userId: pendingVerifyUserId, code }),
    });
    hideVerifyModal();
    currentUser = data.user;
    updateNav();
    showToast('Email verified! Welcome, ' + data.user.name, 'success');
    navigate('dashboard');
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Verify';
  }
}

// ===================== REGISTER =====================
async function handleRegister(e) {
  e.preventDefault();
  const errEl = document.getElementById('register-error');
  errEl.textContent = '';
  setButtonLoading('register-btn', true);

  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({
        name: document.getElementById('reg-name').value,
        email: document.getElementById('reg-email').value,
        password: document.getElementById('reg-password').value,
      }),
    });
    if (data.pending_verification) {
      errEl.style.color = 'var(--clr-primary)';
      errEl.textContent = 'Account created! Check your email for a verification link.';
      document.getElementById('register-form').reset();
    } else {
      currentUser = data.user;
      updateNav();
      showToast('Account created! Welcome, ' + data.user.name, 'success');
      navigate('dashboard');
    }
  } catch (err) {
    errEl.style.color = '';
    errEl.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    setButtonLoading('register-btn', false);
  }
}

// ===================== LOGIN =====================
async function handleLogin(e) {
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  errEl.textContent = '';
  setButtonLoading('login-btn', true);

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('login-email').value,
        password: document.getElementById('login-password').value,
      }),
    });
    if (data.pending_verification) {
      errEl.style.color = 'var(--clr-primary)';
      errEl.textContent = 'Please verify your email first. Check your inbox for a verification link.';
    } else {
      currentUser = data.user;
      updateNav();
      showToast('Welcome back, ' + data.user.name + '!', 'success');
      navigate('dashboard');
    }
  } catch (err) {
    if (err.pending_verification) {
      errEl.style.color = 'var(--clr-primary)';
      errEl.textContent = 'Please verify your email first. A new link has been sent to your inbox.';
      return;
    }
    errEl.style.color = '';
    errEl.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    setButtonLoading('login-btn', false);
  }
}

// ===================== LOGOUT =====================
async function logout() {
  try { await apiFetch('/api/auth/logout', { method: 'POST' }); } catch { /* ok */ }
  currentUser = null;
  updateNav();
  showToast('Logged out.', 'info');
  navigate('home');
}

// ===================== PASSWORD HELPERS =====================
function togglePassword(inputId, btn) {
  const inp = document.getElementById(inputId);
  if (inp.type === 'password') {
    inp.type = 'text';
    btn.textContent = 'Hide';
  } else {
    inp.type = 'password';
    btn.textContent = 'Show';
  }
}

function updatePasswordStrength(pw) {
  const bar = document.getElementById('pw-bar');
  const label = document.getElementById('pw-label');
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;

  const levels = [
    { w: '0%', c: '#333', t: '' },
    { w: '20%', c: '#ff3b30', t: 'Weak' },
    { w: '40%', c: '#ff9500', t: 'Fair' },
    { w: '60%', c: '#f5a623', t: 'Good' },
    { w: '80%', c: '#34c759', t: 'Strong' },
    { w: '100%', c: '#30d158', t: 'Excellent' },
  ];
  const l = levels[score];
  bar.style.width = l.w;
  bar.style.background = l.c;
  label.textContent = l.t;
  label.style.color = l.c;
}

// ===================== DASHBOARD =====================
async function loadDashboard() {
  const nameEl = document.getElementById('dash-name');
  nameEl.textContent = currentUser.name;
  if (currentUser.is_admin) {
    nameEl.insertAdjacentHTML('afterend', '<span class="admin-badge">Admin</span>');
  }
  document.getElementById('dash-email').textContent = currentUser.email;

  // Avatar — show photo if uploaded, otherwise initials
  const initials = currentUser.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const avatarEl = document.getElementById('dash-avatar');
  if (currentUser.is_admin) avatarEl.classList.add('avatar--admin');
  if (currentUser.avatar) {
    avatarEl.textContent = '';
    avatarEl.style.backgroundImage = `url('${currentUser.avatar}')`;
    avatarEl.style.backgroundSize = 'cover';
    avatarEl.style.backgroundPosition = 'center';
  } else {
    avatarEl.textContent = initials;
    avatarEl.style.backgroundImage = '';
  }

  // Avatar upload interaction
  const avatarWrap = document.getElementById('avatar-upload-wrap');
  const avatarOverlay = avatarWrap?.querySelector('.avatar-upload-overlay');
  const avatarFileInput = document.getElementById('avatar-file-input');
  if (avatarWrap && avatarFileInput) {
    avatarWrap.onclick = () => avatarFileInput.click();
    avatarWrap.onmouseenter = () => { if (avatarOverlay) avatarOverlay.style.opacity = '1'; };
    avatarWrap.onmouseleave = () => { if (avatarOverlay) avatarOverlay.style.opacity = '0'; };
    avatarFileInput.onchange = async () => {
      const file = avatarFileInput.files[0];
      if (!file) return;
      const formData = new FormData();
      formData.append('avatar', file);
      try {
        const res = await fetch(_API + '/api/profile/avatar', {
          method: 'POST',
          credentials: 'include',
          body: formData,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        currentUser.avatar = data.avatar;
        avatarEl.textContent = '';
        avatarEl.style.backgroundImage = `url('${data.avatar}?t=${Date.now()}')`;
        avatarEl.style.backgroundSize = 'cover';
        avatarEl.style.backgroundPosition = 'center';
        showToast('Profile photo updated!', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
      avatarFileInput.value = '';
    };
  }

  const container = document.getElementById('payment-history');
  try {
    const [data, status] = await Promise.all([
      apiFetch('/api/payment/history'),
      apiFetch('/api/course/status'),
    ]);
    updateCertCard(status);

    // Flag certified state so chat nav works
    const prog = status.progress || {};
    currentUser._isCertified = !!(prog.level0?.certified || prog.level1?.certified || prog.level2?.certified || status.level3?.certified);
    const chatNav = document.getElementById('nav-chat');
    if (chatNav) chatNav.classList.toggle('hidden', !currentUser._isCertified && !currentUser.is_admin);

    // Only show paid payments, deduplicated per level (keep latest)
    const seen = new Set();
    const paidOnly = data.payments.filter(p => {
      if (p.status !== 'paid') return false;
      if (seen.has(p.description)) return false;
      seen.add(p.description);
      return true;
    });

    if (!paidOnly.length) {
      container.innerHTML = '<p class="muted">No completed payments yet. Start your certification below.</p>';
      return;
    }
    let html = '<table class="history"><thead><tr><th>Date</th><th>Description</th><th>Amount</th><th>Status</th></tr></thead><tbody>';
    for (const p of paidOnly) {
      const date = new Date(p.date + 'Z').toLocaleDateString();
      html += `<tr>
        <td>${escapeHtml(date)}</td>
        <td>${escapeHtml(p.description)}</td>
        <td>${escapeHtml(p.amount)}</td>
        <td class="status-paid">paid</td>
      </tr>`;
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p class="muted">Could not load history.</p>';
  }
}

async function handleDeleteAccount() {
  const confirmed = confirm('Are you sure you want to permanently delete your account?\n\nThis will erase all your data including certifications, payments, and progress. This cannot be undone.');
  if (!confirmed) return;
  const doubleConfirm = confirm('Last chance — this is permanent. Delete account?');
  if (!doubleConfirm) return;
  try {
    await apiFetch('/api/profile', { method: 'DELETE' });
    currentUser = null;
    updateNav();
    showToast('Your account has been deleted.', 'info');
    navigate('home');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function updateCertCard(courseStatus) {
  const statusEl = document.getElementById('cert-status');
  const detailEl = document.getElementById('cert-detail');
  const levelEl = document.getElementById('cert-level');
  const progressEl = document.getElementById('cert-progress');
  const actionBtn = document.getElementById('cert-action-btn');

  // Determine highest certified level directly from certifications table
  const prog = courseStatus.progress || {};
  let highest = -1;
  if (courseStatus.level3?.certified) highest = 3;
  else if (prog.level2?.certified) highest = 2;
  else if (prog.level1?.certified) highest = 1;
  else if (prog.level0?.certified) highest = 0;

  const totalStroke = 226;
  if (highest >= 0) {
    const names = ['Level 0 – Beginner', 'Level 1 – Local', 'Level 2 – State', 'Level 3 – National'];
    statusEl.textContent = names[highest] + ' Judge';
    statusEl.style.color = 'var(--clr-success)';
    detailEl.textContent = 'Your certification is active.';
    levelEl.textContent = `L${highest}`;
    progressEl.style.strokeDashoffset = totalStroke * (1 - (highest + 1) / 4);
    progressEl.style.transition = 'stroke-dashoffset 1s ease';
    actionBtn.textContent = highest < 3 ? 'View My Course' : 'Renew';
    actionBtn.dataset.nav = 'course';
  } else {
    statusEl.textContent = 'Not Certified';
    detailEl.textContent = 'Complete your course and exam to get certified.';
    levelEl.textContent = '--';
    progressEl.style.strokeDashoffset = totalStroke;
    actionBtn.textContent = 'Start Certification';
    actionBtn.dataset.nav = 'payment';
  }
}

// ===================== PAYMENT =====================
const CERT_DESCRIPTIONS = {
  cert_level_0: {
    tagline: 'Classic Format · Pull & Dip',
    detail: 'Covers the judging standards for the <strong>Pull</strong> and the <strong>Dip</strong>. Perfect if you want to judge <strong>Classic format</strong> competitions only. <em>No prerequisites — start here or go straight to Level 1.</em>',
  },
  cert_level_1: {
    tagline: 'All 4 Movements · Full Format',
    detail: 'Covers all four movements: <strong>Pull, Dip, Muscle Up</strong> and <strong>Back Squat</strong>. Includes everything in Level 0 plus the additional movements. <strong>No Level 0 required</strong> — you can take this directly and judge any competition format.',
  },
};

async function loadPaymentOptions() {
  const container = document.getElementById('payment-options');

  try {
    const [optData, histData] = await Promise.all([
      apiFetch('/api/payment/options'),
      apiFetch('/api/payment/history'),
    ]);

    // Build set of already-paid option IDs
    const paidLevels = new Set();
    (histData.payments || []).forEach(p => {
      if (p.status === 'paid') {
        if (p.description.includes('Level 0')) paidLevels.add('cert_level_0');
        if (p.description.includes('Level 1')) paidLevels.add('cert_level_1');
      }
    });

    // Filter out already-paid options
    const available = optData.options.filter(o => !paidLevels.has(o.id));

    if (available.length === 0 && paidLevels.size > 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:2rem;">
          <div style="font-size:2.5rem;margin-bottom:.75rem;">✅</div>
          <p style="font-weight:600;margin-bottom:.5rem;">All available levels are paid.</p>
          <p style="color:var(--clr-muted);font-size:.9rem;">Head to <strong>My Course</strong> to start your certification.</p>
          <button data-nav="course" class="btn btn-primary btn-glow" style="margin-top:1rem;">Go to My Course</button>
        </div>`;
      return;
    }

    let html = `
      <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:1.25rem 1.5rem;margin-bottom:1.5rem;">
        <div style="font-size:.8rem;font-weight:700;color:var(--clr-primary);text-transform:uppercase;letter-spacing:.1em;margin-bottom:1rem;">How it works</div>
        <div style="display:flex;align-items:stretch;gap:0;flex-wrap:wrap;">
          <!-- Level 0 -->
          <div style="flex:1;min-width:140px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:10px;padding:.85rem 1rem;text-align:center;">
            <div style="font-size:.65rem;font-weight:800;color:#60a5fa;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.3rem;">Level 0</div>
            <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem;">Classic Format</div>
            <div style="font-size:.72rem;color:var(--clr-muted);">Pull &amp; Dip only</div>
            <div style="margin-top:.5rem;font-size:.68rem;background:rgba(96,165,250,.15);color:#60a5fa;border-radius:20px;padding:2px 8px;display:inline-block;">Standalone ✓</div>
          </div>
          <!-- OR arrow -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 .75rem;color:var(--clr-muted);font-size:.75rem;font-weight:700;gap:.15rem;">
            <span>OR</span>
          </div>
          <!-- Level 1 -->
          <div style="flex:1;min-width:140px;background:rgba(76,217,100,.08);border:1px solid rgba(76,217,100,.2);border-radius:10px;padding:.85rem 1rem;text-align:center;">
            <div style="font-size:.65rem;font-weight:800;color:#4cd964;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.3rem;">Level 1</div>
            <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem;">Full Format</div>
            <div style="font-size:.72rem;color:var(--clr-muted);">All 4 movements</div>
            <div style="margin-top:.5rem;font-size:.68rem;background:rgba(76,217,100,.15);color:#4cd964;border-radius:20px;padding:2px 8px;display:inline-block;">No prereq ✓</div>
          </div>
          <!-- THEN arrow -->
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 .75rem;color:var(--clr-muted);font-size:.75rem;font-weight:700;gap:.15rem;">
            <span>→</span>
          </div>
          <!-- Level 2 -->
          <div style="flex:1;min-width:140px;background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.15);border-radius:10px;padding:.85rem 1rem;text-align:center;opacity:.7;">
            <div style="font-size:.65rem;font-weight:800;color:#f59e0b;text-transform:uppercase;letter-spacing:.1em;margin-bottom:.3rem;">Level 2</div>
            <div style="font-size:.82rem;font-weight:700;margin-bottom:.3rem;">Technical Rules</div>
            <div style="font-size:.72rem;color:var(--clr-muted);">Infractions &amp; equipment</div>
            <div style="margin-top:.5rem;font-size:.68rem;background:rgba(245,158,11,.15);color:#f59e0b;border-radius:20px;padding:2px 8px;display:inline-block;">Requires Level 0 or 1</div>
          </div>
        </div>
      </div>`;
    for (const opt of available) {
      const desc = CERT_DESCRIPTIONS[opt.id] || {};
      html += `
        <div class="pay-option" data-id="${escapeAttr(opt.id)}">
          <div class="pay-option-info">
            <span class="pay-option-label">${escapeHtml(opt.label)}</span>
            <span class="pay-option-tag">${escapeHtml(desc.tagline || '')}</span>
            <span class="pay-option-desc">${desc.detail || ''}</span>
          </div>
          <span class="pay-option-price">${escapeHtml(opt.amount)}</span>
        </div>`;
    }
    // Level 2 — coming soon
    html += `
      <div class="pay-option pay-option--disabled">
        <div class="pay-option-info">
          <span class="pay-option-label">Level 2 – Advanced Certification</span>
          <span class="pay-option-tag">Technical &amp; Equipment Rules</span>
          <span class="pay-option-desc">Covers technical infractions, equipment rules, and head-judge responsibilities. <strong>Requires Level 0 or Level 1</strong> certification before enrolling.</span>
        </div>
        <span class="pay-option-price pay-option-soon">Coming Soon</span>
      </div>`;
    container.innerHTML = html;

    container.addEventListener('click', (e) => {
      const card = e.target.closest('.pay-option');
      if (!card || card.classList.contains('pay-option--disabled')) return;
      handlePaymentSelect(card, card.dataset.id);
    });
  } catch {
    container.innerHTML = '<p class="muted">Could not load certification options.</p>';
  }
}

async function handlePaymentSelect(el, optionId) {
  document.querySelectorAll('.pay-option').forEach(o => o.classList.remove('selected'));
  el.classList.add('selected');
  el.style.pointerEvents = 'none';
  el.querySelector('.pay-option-price').textContent = 'Loading…';

  try {
    const data = await apiFetch('/api/payment/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ optionId }),
    });
    // Redirect to Stripe's hosted checkout page
    window.location.href = data.url;
  } catch (err) {
    showToast(err.message, 'error');
    el.classList.remove('selected');
    el.style.pointerEvents = '';
    loadPaymentOptions(); // reload to restore prices
  }
}

// Handle Stripe redirect back to the site (?payment=success or ?payment=cancelled)
async function handleStripeReturn() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('payment');
  const sessionId = params.get('session_id');

  if (!status) return;

  // Clean up the URL
  window.history.replaceState({}, '', window.location.pathname);

  if (status === 'cancelled') {
    showToast('Payment cancelled — you can try again anytime.', 'error');
    return;
  }

  if (status === 'success') {
    showToast('Payment received! Your certification will be activated shortly.', 'success');
    navigate('dashboard');
  }
}

// ===================== HERO PARTICLES =====================
let particleAnimFrame;
function startParticles() {
  const canvas = document.getElementById('hero-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function resize() {
    const hero = canvas.parentElement;
    w = canvas.width = hero.offsetWidth;
    h = canvas.height = hero.offsetHeight;
  }

  function createParticles() {
    particles = [];
    const count = Math.floor((w * h) / 12000);
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * w, y: Math.random() * h,
        r: Math.random() * 2 + 0.5,
        dx: (Math.random() - 0.5) * 0.6,
        dy: (Math.random() - 0.5) * 0.6,
        alpha: Math.random() * 0.4 + 0.1,
      });
    }
  }

  function draw() {
    ctx.clearRect(0, 0, w, h);
    for (const p of particles) {
      p.x += p.dx; p.y += p.dy;
      if (p.x < 0 || p.x > w) p.dx *= -1;
      if (p.y < 0 || p.y > h) p.dy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 16, 46, ${p.alpha})`;
      ctx.fill();
    }
    // Draw lines between nearby particles
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 100) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = `rgba(200, 16, 46, ${0.08 * (1 - dist / 100)})`;
          ctx.stroke();
        }
      }
    }
    particleAnimFrame = requestAnimationFrame(draw);
  }

  cancelAnimationFrame(particleAnimFrame);
  resize();
  createParticles();
  draw();
  window.addEventListener('resize', () => { resize(); createParticles(); });
}

// ===================== COUNTER ANIMATION =====================
let countersAnimated = false;
async function loadStats() {
  try {
    const data = await apiFetch('/api/stats');
    const map = {
      certified_judges:    '[data-stat="certified_judges"]',
      competitions_judged: '[data-stat="competitions_judged"]',
      states_covered:      '[data-stat="states_covered"]',
    };
    for (const [key, sel] of Object.entries(map)) {
      const el = document.querySelector(sel);
      if (el) el.dataset.target = data[key];
    }
  } catch { /* use hardcoded fallback */ }
}

function animateCounters() {
  if (countersAnimated) return;
  const nums = document.querySelectorAll('.stat-num');
  if (!nums.length) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        countersAnimated = true;
        nums.forEach(num => {
          const target = parseInt(num.dataset.target, 10);
          let current = 0;
          const step = Math.max(1, Math.floor(target / 60));
          const timer = setInterval(() => {
            current += step;
            if (current >= target) { current = target; clearInterval(timer); }
            num.textContent = current.toLocaleString();
          }, 25);
        });
        observer.disconnect();
      }
    });
  }, { threshold: 0.3 });

  const statsBar = document.querySelector('.stats-bar');
  if (statsBar) observer.observe(statsBar);
}

// ===================== SCROLL REVEAL =====================
function initScrollReveal() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.fade-up, .slide-in').forEach(el => observer.observe(el));
}

// ===================== PROFILE =====================
async function loadProfile() {
  try {
    const data = await apiFetch('/api/profile');
    const u = data.user;
    document.getElementById('profile-name').value = u.name || '';
    document.getElementById('profile-email').value = u.email || '';
    document.getElementById('profile-phone').value = u.phone || '';
    document.getElementById('profile-state').value = u.state || '';
    document.getElementById('profile-experience').value = u.experience || '';

    // Header display
    const initials = u.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    document.getElementById('profile-avatar').textContent = initials;
    document.getElementById('profile-display-name').textContent = u.name;
    document.getElementById('profile-display-email').textContent = u.email;
    if (u.created_at) {
      const joined = new Date(u.created_at + 'Z').toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      document.getElementById('profile-joined').textContent = 'Member since ' + joined;
    }
  } catch {
    showToast('Could not load profile.', 'error');
  }
}

async function handleProfileUpdate(e) {
  e.preventDefault();
  const errEl = document.getElementById('profile-error');
  errEl.textContent = '';
  setButtonLoading('profile-save-btn', true);

  try {
    const data = await apiFetch('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById('profile-name').value,
        phone: document.getElementById('profile-phone').value,
        state: document.getElementById('profile-state').value,
        experience: document.getElementById('profile-experience').value,
      }),
    });
    currentUser = data.user;
    updateNav();
    showToast('Profile updated!', 'success');
    loadProfile();
  } catch (err) {
    errEl.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    setButtonLoading('profile-save-btn', false);
  }
}

async function handlePasswordChange(e) {
  e.preventDefault();
  const errEl = document.getElementById('password-error');
  errEl.textContent = '';

  const newPw = document.getElementById('pw-new').value;
  const confirmPw = document.getElementById('pw-confirm').value;
  if (newPw !== confirmPw) {
    errEl.textContent = 'New passwords do not match.';
    return;
  }

  setButtonLoading('password-btn', true);
  try {
    await apiFetch('/api/profile/password', {
      method: 'PUT',
      body: JSON.stringify({
        currentPassword: document.getElementById('pw-current').value,
        newPassword: newPw,
      }),
    });
    showToast('Password changed successfully!', 'success');
    document.getElementById('password-form').reset();
    document.getElementById('pw-bar').style.width = '0';
    document.getElementById('pw-label').textContent = '';
  } catch (err) {
    errEl.textContent = err.message;
    showToast(err.message, 'error');
  } finally {
    setButtonLoading('password-btn', false);
  }
}

// ===================== CONTACT =====================
async function handleContactSubmit(e) {
  e.preventDefault();
  const errEl = document.getElementById('contact-error');
  errEl.textContent = '';
  setButtonLoading('contact-btn', true);

  // Client-side only (no backend endpoint needed – simulated send)
  const name = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const subject = document.getElementById('contact-subject').value;
  const message = document.getElementById('contact-message').value.trim();

  if (!name || !email || !subject || !message) {
    errEl.textContent = 'All fields are required.';
    setButtonLoading('contact-btn', false);
    return;
  }

  // Simulate a short send delay
  await new Promise(r => setTimeout(r, 800));

  showToast('Message sent! We\'ll get back to you soon.', 'success');
  document.getElementById('contact-form').reset();
  setButtonLoading('contact-btn', false);
}

// ===================== UTILITIES =====================
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/[&"'<>]/g, c => ({
    '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;'
  }[c]));
}

// ===================== INIT =====================
(async function init() {
  // ---- Global click delegation for [data-nav], [data-action], [data-toggle-pw] ----
  document.addEventListener('click', (e) => {
    // Navigation links / buttons
    const navEl = e.target.closest('[data-nav]');
    if (navEl) {
      e.preventDefault();
      navigate(navEl.dataset.nav);
      return;
    }

    // Actions
    const actionEl = e.target.closest('[data-action]');
    if (actionEl) {
      e.preventDefault();
      const action = actionEl.dataset.action;
      if (action === 'logout') logout();
      if (action === 'toggle-menu') toggleMenu();
      if (action === 'delete-account') handleDeleteAccount();
      return;
    }

    // Password visibility toggle
    const pwToggle = e.target.closest('[data-toggle-pw]');
    if (pwToggle) {
      e.preventDefault();
      togglePassword(pwToggle.dataset.togglePw, pwToggle);
      return;
    }
  });

  // ---- Form submissions ----
  document.getElementById('register-form')?.addEventListener('submit', handleRegister);
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('profile-form')?.addEventListener('submit', handleProfileUpdate);
  document.getElementById('password-form')?.addEventListener('submit', handlePasswordChange);
  document.getElementById('contact-form')?.addEventListener('submit', handleContactSubmit);

  // ---- Password strength on register & profile pages ----
  document.getElementById('reg-password')?.addEventListener('input', (e) => updatePasswordStrength(e.target.value));
  document.getElementById('pw-new')?.addEventListener('input', (e) => updatePasswordStrength(e.target.value));

  // ---- Check existing session ----
  try {
    const data = await apiFetch('/api/me');
    currentUser = data.user;
  } catch { /* not logged in */ }
  updateNav();
  initScrollReveal();
  startParticles();
  loadStats().then(() => animateCounters());

  // Trigger animations on home page
  document.querySelectorAll('#page-home .fade-up, #page-home .slide-in').forEach(el => {
    setTimeout(() => el.classList.add('visible'), 100);
  });

  // Handle email verification link (?verify=<token>)
  const verifyParam = new URLSearchParams(window.location.search).get('verify');
  if (verifyParam) {
    // Remove param from URL immediately so refresh doesn't re-trigger
    history.replaceState(null, '', window.location.pathname);
    try {
      const data = await apiFetch(`/api/auth/verify-email?token=${encodeURIComponent(verifyParam)}`);
      currentUser = data.user;
      updateNav();
      showToast('Email verified! You are now logged in.', 'success');
      navigate('dashboard');
    } catch (err) {
      showToast(err.message || 'Verification failed. The link may have expired.', 'error');
      navigate('login');
    }
  }

  // Handle Stripe redirect back (?payment=success or ?payment=cancelled)
  if (window.location.search.includes('payment=')) {
    await handleStripeReturn();
  }

  // User detail drawer close
  const detailOverlay = document.getElementById('user-detail-overlay');
  document.getElementById('user-detail-close')?.addEventListener('click', () => {
    detailOverlay?.classList.remove('open');
    document.body.style.overflow = '';
  });
  detailOverlay?.addEventListener('click', (e) => {
    if (e.target === detailOverlay) {
      detailOverlay.classList.remove('open');
      document.body.style.overflow = '';
    }
  });
})();

// ===================== MOVEMENT RULES MODAL =====================
const MOVEMENT_RULES = {
  muscleup: {
    title: 'Muscle Up',
    img: 'https://usastreetlifting.org/wp-content/uploads/2025/03/Abu-Asada-Returns-819x1024.jpg',
    standards: [
      'Start from the box, arms fully extended.',
      'Wait for the "START!" signal from the front judge before exiting the box.',
      'Complete the pull phase, then the dip phase in one movement.',
      'Finish with both elbows fully locked out.',
      'Wait for the "BOX!" signal — arms must remain fully extended before exiting.',
    ],
    norep: [
      'Arms not fully extended at the start.',
      'Excessive kipping or leg kicking to generate momentum.',
      'Chicken wing — elbows clear the bar one at a time.',
      'Downward motion during the concentric phase.',
      'Elbows not locked out at the finish.',
    ],
  },
  pull: {
    title: 'Pull',
    img: 'https://usastreetlifting.org/wp-content/uploads/2025/03/Lincoln-Black-Returns-819x1024.jpg',
    standards: [
      'Start from a dead hang — arms fully extended, no swing.',
      'Any grip allowed (pronated or supinated). Plates must be between the legs.',
      'Wait for the "START!" signal from the front judge.',
      'Pull until chin is clearly above the bar.',
      'Return to dead hang, then wait for the "BOX!" signal.',
    ],
    norep: [
      'Chin does not clearly pass above the bar.',
      'Arms not fully extended at the start.',
      'Excessive kipping or leg kicking.',
      'Downward motion of the plates before the chin clears the bar.',
    ],
  },
  dip: {
    title: 'Dip',
    img: 'https://usastreetlifting.org/wp-content/uploads/2025/03/Brian-Shtika-Returns-1-819x1024.jpg',
    standards: [
      'Start at full arm lockout — no swing. Plates between the legs.',
      'Wait for the "START!" signal from the front judge.',
      'Lower until the rear delt is visibly below the elbow joint.',
      'Press back up to full arm lockout.',
      'Wait for the "BOX!" signal before dismounting.',
    ],
    norep: [
      'Arms not fully locked out at the start or finish.',
      'Shoulder depth not reached (rear delt above elbow at bottom).',
      'Excessive kipping or leg flare to assist the lift.',
      'Downward motion during the press phase.',
    ],
  },
  squat: {
    title: 'Squat',
    img: 'https://usastreetlifting.org/wp-content/uploads/2025/03/Miguel-Robles-Returns-819x1024.jpg',
    standards: [
      'Bar on the back, athlete stands erect with knees locked.',
      'Wait for the "START!" signal from the front judge.',
      'Descend until the hip crease is below the top of the knees.',
      'Rise back to a fully erect position with knees locked.',
      'Wait motionless for the "RACK!" signal.',
    ],
    norep: [
      'Hip crease does not go below the top of the knees (depth not reached).',
      'Knees not fully locked at the finish.',
      'Downward motion or double bounce at the bottom.',
      'Feet move during the lift (forward, backward, or sideways).',
      'Elbows or arms used to push off the thighs.',
    ],
  },
};

(function initMovementModal() {
  const overlay = document.getElementById('rules-modal');
  const closeBtn = document.getElementById('rules-modal-close');
  const title = document.getElementById('rules-modal-title');
  const badge = document.getElementById('rules-modal-badge');
  const body = document.getElementById('rules-modal-body');

  function openModal(key) {
    const data = MOVEMENT_RULES[key];
    if (!data) return;
    title.textContent = data.title;
    badge.style.backgroundImage = `url('${data.img}')`;

    body.innerHTML = `
      <div class="rules-section">
        <h3>Standards</h3>
        <ul class="rules-list">
          ${data.standards.map(s => `<li><span class="rule-icon ok">✓</span>${s}</li>`).join('')}
        </ul>
      </div>
      <div class="rules-section">
        <h3>No Rep — Common Reasons</h3>
        <ul class="rules-list">
          ${data.norep.map(n => `<li><span class="rule-icon no">✕</span>${n}</li>`).join('')}
        </ul>
      </div>
    `;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  document.querySelectorAll('.movement-card[data-movement]').forEach(card => {
    card.addEventListener('click', () => openModal(card.dataset.movement));
  });

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
})();

async function lookupUserPayments() {
  const email = document.getElementById('fix-email-input').value.trim();
  if (!email) return;
  const el = document.getElementById('fix-user-result');
  el.innerHTML = 'Looking up…';
  try {
    const data = await apiFetch(`/api/admin/user-payments?email=${encodeURIComponent(email)}`);
    const { user, payments, access } = data;
    const accessList = access.length ? access.map(a => `Level ${a.level}`).join(', ') : 'None';
    const paymentRows = payments.map(p => `
      <tr>
        <td style="padding:.3rem .5rem;font-size:.8rem">${p.description}</td>
        <td style="padding:.3rem .5rem;font-size:.8rem">$${(p.amount_cents/100).toFixed(2)}</td>
        <td style="padding:.3rem .5rem;font-size:.8rem;color:${p.status==='paid'?'#4ade80':'#f87171'}">${p.status}</td>
        <td style="padding:.3rem .5rem">
          ${p.status !== 'paid' ? `<button class="btn btn-outline" style="font-size:.75rem;padding:.2rem .5rem" onclick="forceGrant(${user.id},${p.description.includes('Level 1')?1:0},${p.id})">Mark paid + grant access</button>` : `<button class="btn btn-outline" style="font-size:.75rem;padding:.2rem .5rem" onclick="forceGrant(${user.id},${p.description.includes('Level 1')?1:0},null)">Grant access only</button>`}
        </td>
      </tr>`).join('');
    el.innerHTML = `
      <div style="font-size:.85rem;margin-bottom:.5rem"><strong>${user.name}</strong> (${user.email}) — Course access: <strong>${accessList}</strong></div>
      ${payments.length ? `<table style="width:100%;border-collapse:collapse">${paymentRows}</table>` : '<p style="font-size:.85rem;color:var(--clr-muted)">No payments found for this user.</p>'}`;
  } catch (err) {
    el.innerHTML = `<span style="color:#f87171">${err.message}</span>`;
  }
}

async function forceGrant(userId, level, paymentId) {
  try {
    const res = await apiFetch('/api/admin/force-grant', { method: 'POST', body: JSON.stringify({ userId, level, paymentId }) });
    showToast(res.message, 'success');
    lookupUserPayments();
    loadAdmin();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function syncPayments() {
  const btn = document.getElementById('sync-payments-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Syncing…'; }
  try {
    const res = await apiFetch('/api/admin/sync-payments', { method: 'POST' });
    if (res.fixed > 0) loadAdmin();
    // Show full results in an alert so you can see exactly what happened
    alert(`Sync complete — fixed ${res.fixed} issue(s)\n\n${res.results.join('\n')}`);
  } catch (err) {
    alert('Sync failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Sync Payments'; }
  }
}

// ===================== ADMIN PANEL =====================
async function loadAdmin() {
  const section = document.getElementById('admin-content');
  if (!section) return;
  section.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Loading…</p>';

  try {
    const [{ users }, { applications }, settings, { events }, { rooms: chatRooms }] = await Promise.all([
      apiFetch('/api/admin/users'),
      apiFetch('/api/admin/level3-applications'),
      apiFetch('/api/admin/settings'),
      apiFetch('/api/admin/events'),
      apiFetch('/api/chat/admin-rooms'),
    ]);

    const total   = users.length;
    const paid    = users.filter(u => u.payment_status === 'paid').length;
    const pending = users.filter(u => u.payment_status === 'pending').length;
    const noPay   = total - paid - pending;

    function fmtDate(d) {
      if (!d) return '—';
      return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    function payPill(u) {
      if (!u.payment_status) return '<span class="cert-pill cert-pill--none">—</span>';
      if (u.payment_status === 'paid') return '<span class="cert-pill cert-pill--paid">Paid</span>';
      return '<span class="cert-pill cert-pill--pending">Pending</span>';
    }
    function certPill(u) {
      if (!u.cert_level) return '<span class="cert-pill cert-pill--none">—</span>';
      return `<span class="cert-pill cert-pill--paid">${u.cert_level}</span>`;
    }
    function certBadges(u) {
      if (!u.certifications || u.certifications.length === 0) return '<span style="color:var(--clr-muted);font-size:.82rem;">None</span>';
      const now = new Date();
      return u.certifications.map(c => {
        const granted  = new Date(c.granted_at);
        const expiry   = new Date(c.granted_at);
        expiry.setFullYear(expiry.getFullYear() + 1);
        const expired  = now > expiry;
        const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
        const expiryStr = expiry.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const grantedStr = granted.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const color = expired ? '#f87171' : daysLeft <= 30 ? '#f5a623' : '#4cd964';
        return `<div style="margin-bottom:.35rem;">
          <span style="font-weight:700;color:${color};">Level ${c.level}</span>
          <span style="font-size:.75rem;color:var(--clr-muted);margin-left:.4rem;">Issued ${grantedStr}</span><br>
          <span style="font-size:.75rem;color:${color};">${expired ? '⚠ Expired' : `Valid until ${expiryStr}`}${!expired && daysLeft <= 30 ? ` (${daysLeft}d left)` : ''}</span>
        </div>`;
      }).join('');
    }

    // Settings section
    const settingsHtml = `
      <div class="course-section-card" style="margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">⚙️ Homepage Stats</h3>
        <p style="color:var(--clr-muted);font-size:.88rem;margin-bottom:1rem;">Update these numbers manually — they display on the homepage.</p>
        <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-end;">
          <label style="font-size:.85rem;">Certified Judges<br>
            <input id="set-judges" type="number" value="${settings.certified_judges}" min="0" style="width:100px;margin-top:.3rem;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:1rem;">
          </label>
          <label style="font-size:.85rem;">Competitions Judged<br>
            <input id="set-comps" type="number" value="${settings.competitions_judged}" min="0" style="width:100px;margin-top:.3rem;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:1rem;">
          </label>
          <label style="font-size:.85rem;">States Covered<br>
            <input id="set-states" type="number" value="${settings.states_covered}" min="0" style="width:100px;margin-top:.3rem;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:1rem;">
          </label>
          <button id="save-settings-btn" class="btn-grant" style="padding:.5rem 1.2rem;">Save</button>
        </div>
      </div>`;

    // Collect all states from users for the state dropdown
    const allStates = [...new Set(users.map(u => u.state).filter(Boolean))].sort();
    const inputSt = 'padding:.45rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;width:100%;';

    // Announcements section
    const announceHtml = `
      <div class="course-section-card" style="margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">📢 Send Announcement</h3>
        <p style="color:var(--clr-muted);font-size:.88rem;margin-bottom:1rem;">Email certified judges — choose who receives it.</p>

        <div style="display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap;">
          <button class="ann-target-btn btn-grant" data-target="all" style="padding:.4rem .9rem;">Everyone</button>
          <button class="ann-target-btn" data-target="state" style="padding:.4rem .9rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;cursor:pointer;">By State</button>
          <button class="ann-target-btn" data-target="manual" style="padding:.4rem .9rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;cursor:pointer;">Pick Judges</button>
        </div>

        <div id="ann-state-row" style="display:none;margin-bottom:.75rem;">
          <select id="ann-state" style="${inputSt}">
            <option value="">— Select a state —</option>
            ${allStates.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('')}
          </select>
        </div>

        <div id="ann-manual-row" style="display:none;margin-bottom:.75rem;">
          <p style="font-size:.82rem;color:var(--clr-muted);margin-bottom:.5rem;">Select judges to include:</p>
          <div style="max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:.3rem;padding:.25rem;">
            ${users.map(u => `
              <label style="display:flex;align-items:center;gap:.6rem;cursor:pointer;font-size:.85rem;padding:.3rem .4rem;border-radius:5px;background:rgba(255,255,255,.03);">
                <input type="checkbox" class="ann-judge-check" value="${u.id}" style="accent-color:var(--clr-primary);">
                <span>${escapeHtml(u.name)}</span>
                <span style="color:var(--clr-muted);font-size:.75rem;">${u.state || '—'}</span>
              </label>`).join('')}
          </div>
        </div>

        <input id="announce-subject" type="text" placeholder="Subject" style="${inputSt}margin-bottom:.75rem;">
        <textarea id="announce-body" rows="4" placeholder="Message…" style="${inputSt}resize:vertical;margin-bottom:.75rem;"></textarea>
        <button id="announce-send-btn" class="btn-grant" style="padding:.5rem 1.2rem;">Send</button>
        <span id="announce-result" style="margin-left:1rem;font-size:.85rem;color:var(--clr-muted);"></span>
      </div>`;

    // Events management section
    const eventsAdminHtml = `
      <div class="course-section-card" style="margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">🏆 Competition Events</h3>
        <div style="display:flex;gap:.75rem;flex-wrap:wrap;margin-bottom:1rem;">
          <input id="ev-name" type="text" placeholder="Event name" style="flex:2;min-width:160px;padding:.5rem .75rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.9rem;">
          <input id="ev-date" type="date" style="flex:1;min-width:130px;padding:.5rem .75rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.9rem;">
          <input id="ev-location" type="text" placeholder="City, State" style="flex:1;min-width:130px;padding:.5rem .75rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.9rem;">
          <input id="ev-desc" type="text" placeholder="Description (optional)" style="flex:2;min-width:160px;padding:.5rem .75rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.9rem;">
          <button id="ev-add-btn" class="btn-grant" style="padding:.5rem 1rem;">Add Event</button>
        </div>
        <div id="admin-events-list">
          ${events.length === 0 ? '<p style="color:var(--clr-muted);font-size:.9rem;">No events yet.</p>' : events.map(ev => `
            <div id="ev-row-${ev.id}" style="padding:.6rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:.5rem;">
              <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:.5rem;" id="ev-view-${ev.id}">
                <div>
                  <strong>${escapeHtml(ev.name)}</strong>
                  <span style="color:var(--clr-muted);font-size:.82rem;margin-left:.5rem;">${escapeHtml(ev.event_date)} — ${escapeHtml(ev.location)}</span>
                  <span style="color:var(--clr-muted);font-size:.82rem;margin-left:.5rem;">(${ev.judge_count} judges)</span>
                </div>
                <div style="display:flex;gap:.4rem;">
                  <button class="btn-grant ev-edit-btn" data-ev-id="${ev.id}" data-ev-name="${escapeAttr(ev.name)}" data-ev-date="${escapeAttr(ev.event_date)}" data-ev-location="${escapeAttr(ev.location)}" data-ev-desc="${escapeAttr(ev.description || '')}" style="font-size:.8rem;padding:.3rem .7rem;">Edit</button>
                  <button class="btn-grant ev-delete-btn" data-ev-id="${ev.id}" style="background:rgba(248,113,113,.15);color:#f87171;font-size:.8rem;padding:.3rem .7rem;">Delete</button>
                </div>
              </div>
              <div id="ev-edit-form-${ev.id}" style="display:none;margin-top:.75rem;">
                <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
                  <input class="ev-edit-name" type="text" value="${escapeAttr(ev.name)}" placeholder="Event name" style="flex:2;min-width:140px;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
                  <input class="ev-edit-date" type="date" value="${escapeAttr(ev.event_date)}" style="flex:1;min-width:120px;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
                  <input class="ev-edit-location" type="text" value="${escapeAttr(ev.location)}" placeholder="City, State" style="flex:1;min-width:120px;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
                  <input class="ev-edit-desc" type="text" value="${escapeAttr(ev.description || '')}" placeholder="Description (optional)" style="flex:2;min-width:140px;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
                </div>
                <div style="display:flex;gap:.4rem;margin-top:.5rem;">
                  <button class="btn-grant ev-save-btn" data-ev-id="${ev.id}" style="font-size:.8rem;padding:.3rem .7rem;">Save</button>
                  <button class="btn-grant ev-cancel-btn" data-ev-id="${ev.id}" style="background:rgba(255,255,255,.08);font-size:.8rem;padding:.3rem .7rem;">Cancel</button>
                </div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    // Chat rooms management
    const allStatesForChat = [...new Set(users.map(u => u.state).filter(Boolean))].sort();
    const scopeOptions = [
      '<option value="all">Everyone (all certified judges)</option>',
      '<option value="admin">Admin only</option>',
      ...allStatesForChat.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)} judges only</option>`),
    ].join('');
    const chatRoomsHtml = `
      <div class="course-section-card" style="margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">💬 Chat Rooms</h3>
        <p style="color:var(--clr-muted);font-size:.88rem;margin-bottom:1rem;">Create or delete chat channels. The General room cannot be deleted.</p>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:1rem;">
          <input id="cr-id" type="text" placeholder="room-id (e.g. east-coast)" style="flex:1;min-width:120px;padding:.45rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
          <input id="cr-label" type="text" placeholder="Display name (e.g. 🌊 East Coast)" style="flex:2;min-width:140px;padding:.45rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">
          <select id="cr-scope" style="flex:1;min-width:160px;padding:.45rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;">${scopeOptions}</select>
          <button id="cr-add-btn" class="btn-grant" style="padding:.45rem 1rem;">Add Room</button>
        </div>
        <div id="chat-rooms-admin-list">
          ${chatRooms.map(r => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;margin-bottom:.4rem;">
              <div>
                <strong style="font-size:.88rem;">${escapeHtml(r.label)}</strong>
                <span style="color:var(--clr-muted);font-size:.75rem;margin-left:.5rem;">ID: ${escapeHtml(r.room_id)}</span>
                <span style="color:var(--clr-muted);font-size:.75rem;margin-left:.5rem;">· ${escapeHtml(r.scope)}</span>
              </div>
              ${r.room_id === 'general'
                ? '<span style="font-size:.75rem;color:var(--clr-muted);">Default</span>'
                : `<button class="btn-revoke cr-delete-btn" data-room-id="${escapeAttr(r.room_id)}" style="font-size:.78rem;padding:.3rem .6rem;">Delete</button>`}
            </div>`).join('')}
        </div>
      </div>`;

    // Level 3 applications section
    const l3html = applications.length === 0 ? '' : `
      <div class="course-section-card" style="border-color:rgba(240,192,48,.3);margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">⭐ Level 3 Applications</h3>
        ${applications.map(a => `
          <div class="l3-app-row">
            <div>
              <strong>${a.name}</strong> <span style="color:var(--clr-muted);font-size:.85rem;">${a.email}</span>
              <span class="cert-pill ${a.status === 'pending' ? 'cert-pill--pending' : (a.status === 'approved' ? 'cert-pill--paid' : 'cert-pill--none')}" style="margin-left:.5rem;">${a.status}</span>
            </div>
            ${a.status === 'pending' ? `
              <div style="display:flex;gap:.5rem;">
                <button class="btn-grant" data-l3-approve="${a.user_id}">Approve</button>
                <button class="btn-revoke" data-l3-reject="${a.user_id}">Reject</button>
              </div>` : ''}
          </div>
        `).join('')}
      </div>`;

    section.innerHTML = `
      <div style="margin-bottom:2rem;">
        <h3 style="margin-bottom:1rem;">📊 Analytics</h3>
        <div id="analytics-content"><p style="color:var(--clr-muted);font-size:.88rem;">Loading…</p></div>
      </div>
      <div class="admin-stats">
        <div class="admin-stat"><span class="admin-stat-num">${total}</span><span>Registered</span></div>
        <div class="admin-stat"><span class="admin-stat-num">${paid}</span><span>Paid</span></div>
        <div class="admin-stat"><span class="admin-stat-num">${pending}</span><span>Pending</span></div>
        <div class="admin-stat"><span class="admin-stat-num">${noPay}</span><span>Not Started</span></div>
      </div>
      ${settingsHtml}
      ${announceHtml}
      ${eventsAdminHtml}
      ${chatRoomsHtml}
      ${l3html}
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Name</th><th>Email</th><th>State</th><th>Payment</th><th>Certifications</th><th>Joined</th>
              <th>Grant Certificate</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${users.length === 0
              ? '<tr><td colspan="8" style="text-align:center;color:var(--clr-muted)">No users yet.</td></tr>'
              : users.map(u => `
                <tr class="admin-user-row" data-uid="${u.id}" style="cursor:pointer;">
                  <td>${u.name || '—'}</td>
                  <td style="font-size:.82rem;">${u.email}</td>
                  <td>${u.state || '—'}</td>
                  <td>${payPill(u)}</td>
                  <td>${certBadges(u)}</td>
                  <td>${fmtDate(u.created_at)}</td>
                  <td>
                    <div style="display:flex;gap:.4rem;flex-wrap:wrap;">
                      <button class="btn-grant" style="font-size:.75rem;padding:.3rem .6rem;" data-admin-grant-cert data-uid="${u.id}" data-level="0">L0 ✓</button>
                      <button class="btn-grant" style="font-size:.75rem;padding:.3rem .6rem;" data-admin-grant-cert data-uid="${u.id}" data-level="1">L1 ✓</button>
                      <button class="btn-grant" style="font-size:.75rem;padding:.3rem .6rem;" data-admin-grant-cert data-uid="${u.id}" data-level="2">L2 ✓</button>
                      <button class="btn-grant" style="font-size:.75rem;padding:.3rem .6rem;background:#7a5a00;" data-admin-grant-l3 data-uid="${u.id}">L3 ⭐</button>
                    </div>
                  </td>
                  <td>
                    <button class="btn-delete-user" data-uid="${u.id}" style="font-size:.75rem;padding:.3rem .6rem;background:#7f1d1d;border:none;border-radius:5px;color:#fff;cursor:pointer;">Delete</button>
                  </td>
                </tr>
              `).join('')}
          </tbody>
        </table>
      </div>
    `;

    // Grant cert buttons
    section.querySelectorAll('[data-admin-grant-cert]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.uid);
        const lv  = parseInt(btn.dataset.level);
        try {
          await apiFetch('/api/admin/grant-certification', { method: 'POST', body: JSON.stringify({ userId: uid, level: lv }) });
          showToast(`Level ${lv} certificate granted.`, 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Grant L3 buttons
    section.querySelectorAll('[data-admin-grant-l3]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid = parseInt(btn.dataset.uid);
        try {
          await apiFetch('/api/admin/grant-level3', { method: 'POST', body: JSON.stringify({ userId: uid }) });
          showToast('Level 3 granted.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Level 3 approve/reject
    section.querySelectorAll('[data-l3-approve]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/admin/review-level3', { method: 'POST', body: JSON.stringify({ userId: parseInt(btn.dataset.l3Approve), decision: 'approved' }) });
          showToast('Level 3 application approved.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
    section.querySelectorAll('[data-l3-reject]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch('/api/admin/review-level3', { method: 'POST', body: JSON.stringify({ userId: parseInt(btn.dataset.l3Reject), decision: 'rejected' }) });
          showToast('Application rejected.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Delete user buttons
    section.querySelectorAll('.btn-delete-user').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const uid = parseInt(btn.dataset.uid);
        const user = users.find(u => u.id === uid);
        if (!confirm(`Delete account for ${user?.name || 'this user'}? This cannot be undone.`)) return;
        try {
          await apiFetch(`/api/admin/users/${uid}`, { method: 'DELETE' });
          showToast('User deleted.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Row click → open detail panel
    section.querySelectorAll('.admin-user-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('button')) return;
        const uid = parseInt(row.dataset.uid);
        const user = users.find(u => u.id === uid);
        if (user) openUserDetail(user);
      });
    });

    // Announcement target toggle
    let announceTarget = 'all';
    section.querySelectorAll('.ann-target-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        announceTarget = btn.dataset.target;
        section.querySelectorAll('.ann-target-btn').forEach(b => {
          b.className = 'ann-target-btn';
          b.style.cssText = 'padding:.4rem .9rem;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#fff;cursor:pointer;';
        });
        btn.className = 'ann-target-btn btn-grant';
        btn.style.cssText = 'padding:.4rem .9rem;';
        document.getElementById('ann-state-row').style.display  = announceTarget === 'state'  ? 'block' : 'none';
        document.getElementById('ann-manual-row').style.display = announceTarget === 'manual' ? 'block' : 'none';
      });
    });

    // Announce send
    document.getElementById('announce-send-btn')?.addEventListener('click', async () => {
      const subject = document.getElementById('announce-subject')?.value.trim();
      const body    = document.getElementById('announce-body')?.value.trim();
      const result  = document.getElementById('announce-result');
      if (!subject || !body) { showToast('Subject and message required.', 'error'); return; }

      const payload = { subject, body, target: announceTarget };

      if (announceTarget === 'state') {
        const state = document.getElementById('ann-state')?.value;
        if (!state) { showToast('Please select a state.', 'error'); return; }
        payload.state = state;
      }
      if (announceTarget === 'manual') {
        const checked = [...section.querySelectorAll('.ann-judge-check:checked')].map(c => parseInt(c.value));
        if (!checked.length) { showToast('Select at least one judge.', 'error'); return; }
        payload.userIds = checked;
      }

      const btn = document.getElementById('announce-send-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const data = await apiFetch('/api/admin/announce', { method: 'POST', body: JSON.stringify(payload) });
        result.textContent = `Sent to ${data.sent} judge${data.sent !== 1 ? 's' : ''}.`;
        showToast(`Announcement sent to ${data.sent} judge${data.sent !== 1 ? 's' : ''}.`, 'success');
      } catch (err) { showToast(err.message, 'error'); }
      finally { btn.disabled = false; btn.textContent = 'Send'; }
    });

    // Add event
    document.getElementById('ev-add-btn')?.addEventListener('click', async () => {
      const name     = document.getElementById('ev-name')?.value.trim();
      const date     = document.getElementById('ev-date')?.value;
      const location = document.getElementById('ev-location')?.value.trim();
      const desc     = document.getElementById('ev-desc')?.value.trim();
      if (!name || !date || !location) { showToast('Name, date and location required.', 'error'); return; }
      try {
        await apiFetch('/api/admin/events', { method: 'POST', body: JSON.stringify({ name, event_date: date, location, description: desc }) });
        showToast('Event added.', 'success');
        loadAdmin();
      } catch (err) { showToast(err.message, 'error'); }
    });

    // Delete event
    section.querySelectorAll('.ev-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this event?')) return;
        try {
          await apiFetch(`/api/admin/events/${btn.dataset.evId}`, { method: 'DELETE' });
          showToast('Event deleted.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Edit event — show inline form
    section.querySelectorAll('.ev-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.evId;
        document.getElementById(`ev-view-${id}`).style.display = 'none';
        document.getElementById(`ev-edit-form-${id}`).style.display = 'block';
      });
    });

    // Cancel edit
    section.querySelectorAll('.ev-cancel-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.evId;
        document.getElementById(`ev-view-${id}`).style.display = '';
        document.getElementById(`ev-edit-form-${id}`).style.display = 'none';
      });
    });

    // Save edited event
    section.querySelectorAll('.ev-save-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.evId;
        const row = document.getElementById(`ev-row-${id}`);
        const name     = row.querySelector('.ev-edit-name')?.value.trim();
        const date     = row.querySelector('.ev-edit-date')?.value;
        const location = row.querySelector('.ev-edit-location')?.value.trim();
        const desc     = row.querySelector('.ev-edit-desc')?.value.trim();
        if (!name || !date || !location) { showToast('Name, date and location required.', 'error'); return; }
        btn.disabled = true; btn.textContent = 'Saving…';
        try {
          await apiFetch(`/api/admin/events/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name, event_date: date, location, description: desc }),
          });
          showToast('Event updated.', 'success');
          loadAdmin();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false; btn.textContent = 'Save';
        }
      });
    });

    // Add chat room
    document.getElementById('cr-add-btn')?.addEventListener('click', async () => {
      const room_id = document.getElementById('cr-id')?.value.trim().toLowerCase().replace(/\s+/g, '-');
      const label   = document.getElementById('cr-label')?.value.trim();
      const scope   = document.getElementById('cr-scope')?.value;
      if (!room_id || !label) { showToast('Room ID and name required.', 'error'); return; }
      try {
        await apiFetch('/api/chat/admin-rooms', { method: 'POST', body: JSON.stringify({ room_id, label, scope }) });
        showToast('Room created.', 'success');
        loadAdmin();
      } catch (err) { showToast(err.message, 'error'); }
    });

    // Delete chat room
    section.querySelectorAll('.cr-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Delete room "${btn.dataset.roomId}" and all its messages?`)) return;
        try {
          await apiFetch(`/api/chat/admin-rooms/${btn.dataset.roomId}`, { method: 'DELETE' });
          showToast('Room deleted.', 'success');
          loadAdmin();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });

    // Load analytics
    loadAnalytics();

    document.getElementById('save-settings-btn')?.addEventListener('click', async () => {
      const judges = document.getElementById('set-judges')?.value;
      const comps  = document.getElementById('set-comps')?.value;
      const states = document.getElementById('set-states')?.value;
      try {
        await apiFetch('/api/admin/settings', { method: 'POST', body: JSON.stringify({ certified_judges: judges, competitions_judged: comps, states_covered: states }) });
        showToast('Stats updated.', 'success');
      } catch (err) { showToast(err.message, 'error'); }
    });

  } catch (e) {
    section.innerHTML = '<p style="color:#f87171;text-align:center;padding:2rem;">Could not load admin data.</p>';
  }
}

async function openUserDetail(user) {
  const panel = document.getElementById('user-detail-panel');
  const overlay = document.getElementById('user-detail-overlay');
  if (!panel || !overlay) return;

  // Always fetch fresh course access unless already loaded
  if (!user.courseAccess) {
    try {
      const detail = await apiFetch(`/api/admin/user-detail/${user.id}`);
      user = { ...user, courseAccess: detail.courseAccess };
    } catch { user = { ...user, courseAccess: [] }; }
  }

  const now = new Date();

  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  function certRow(c) {
    const expiry = new Date(c.granted_at);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const expired = now > expiry;
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    const color = expired ? '#f87171' : daysLeft <= 30 ? '#f5a623' : '#4cd964';
    return `
      <div class="user-detail-cert">
        <div>
          <span style="font-family:var(--font-heading);font-size:1.1rem;font-weight:800;color:${color};">Level ${c.level}</span>
          <span style="font-size:.8rem;color:var(--clr-muted);margin-left:.5rem;">Issued ${fmtDate(c.granted_at)}</span><br>
          <span style="font-size:.82rem;color:${color};">${expired ? '⚠ Expired' : `Valid until ${fmtDate(expiry.toISOString())}`}${!expired && daysLeft <= 30 ? ` — ${daysLeft} days left` : ''}</span>
        </div>
        <a href="/api/certificate/${c.level}?as_user=${user.id}" target="_blank" rel="noopener" class="btn-grant" style="text-decoration:none;font-size:.8rem;padding:.35rem .8rem;">Download</a>
      </div>`;
  }

  const inputStyle = 'width:100%;padding:.4rem .6rem;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.07);color:#fff;font-size:.88rem;margin-top:.25rem;';

  panel.innerHTML = `
    <div class="user-detail-header">
      <div class="avatar avatar--sm">${(user.name || '?').split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase()}</div>
      <div>
        <h3 style="font-family:var(--font-heading);font-size:1.3rem;font-weight:800;">${escapeHtml(user.name || '—')}</h3>
        <p style="color:var(--clr-muted);font-size:.88rem;">${escapeHtml(user.email)}</p>
      </div>
    </div>
    <div class="user-detail-meta">
      <span><strong>State:</strong> ${user.state || '—'}</span>
      <span><strong>Experience:</strong> ${user.experience || '—'}</span>
      <span><strong>Joined:</strong> ${fmtDate(user.created_at)}</span>
      <span><strong>Phone:</strong> ${user.phone || '—'}</span>
    </div>

    <h4 style="font-family:var(--font-heading);margin:1.5rem 0 .75rem;">Certifications</h4>
    ${user.certifications && user.certifications.length > 0
      ? user.certifications.map(certRow).join('')
      : '<p style="color:var(--clr-muted);font-size:.9rem;">No certifications yet.</p>'}

    <h4 style="font-family:var(--font-heading);margin:1.5rem 0 .75rem;">Grant Certification</h4>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap;">
      <button class="btn-grant" data-detail-grant data-uid="${user.id}" data-level="0">Level 0 ✓</button>
      <button class="btn-grant" data-detail-grant data-uid="${user.id}" data-level="1">Level 1 ✓</button>
      <button class="btn-grant" data-detail-grant data-uid="${user.id}" data-level="2">Level 2 ✓</button>
      <button class="btn-grant" style="background:#7a5a00;" data-detail-grant-l3 data-uid="${user.id}">Level 3 ⭐</button>
    </div>

    <h4 style="font-family:var(--font-heading);margin:1.5rem 0 .5rem;">Course Access</h4>
    <p style="font-size:.82rem;color:var(--clr-muted);margin-bottom:.75rem;">Grant access to course videos without requiring payment.</p>
    <div id="course-access-rows" style="display:flex;flex-direction:column;gap:.5rem;">
      ${[0,1,2].map(lvl => {
        const hasAccess = (user.courseAccess || []).includes(lvl);
        const hasPaid = (user.payments || []).some(p => p.status === 'paid' && p.description.includes(`Level ${lvl}`));
        const hasCert = (user.certifications || []).some(c => c.level === lvl);
        const lockedByPayment = hasPaid || hasCert;
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:.5rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;">
          <span style="font-size:.88rem;">Level ${lvl} Course ${lockedByPayment ? '<span style="color:#4cd964;font-size:.75rem;">(paid/certified)</span>' : hasAccess ? '<span style="color:#4cd964;font-size:.75rem;">✓ Access granted</span>' : ''}</span>
          ${lockedByPayment
            ? `<span style="font-size:.75rem;color:var(--clr-muted);">Already has access</span>`
            : hasAccess
              ? `<button class="btn-revoke" style="font-size:.75rem;padding:.3rem .7rem;" data-revoke-course="${lvl}" data-uid="${user.id}">Revoke</button>`
              : `<button class="btn-grant" style="font-size:.75rem;padding:.3rem .7rem;" data-grant-course="${lvl}" data-uid="${user.id}">Grant Access</button>`
          }
        </div>`;
      }).join('')}
    </div>

    <h4 style="font-family:var(--font-heading);margin:1.5rem 0 .75rem;">Directory Profile</h4>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:.75rem;margin-bottom:.75rem;">
      <label style="font-size:.82rem;color:var(--clr-muted);">Position
        <input id="ud-position" type="text" value="${escapeHtml(user.position || '')}" placeholder="e.g. State Judge" style="${inputStyle}">
      </label>
      <label style="font-size:.82rem;color:var(--clr-muted);">Instagram (@handle)
        <input id="ud-instagram" type="text" value="${escapeHtml(user.instagram || '')}" placeholder="@username" style="${inputStyle}">
      </label>
      <label style="font-size:.82rem;color:var(--clr-muted);">Comps Judged
        <input id="ud-comps" type="number" value="${user.comps_judged || 0}" min="0" style="${inputStyle}">
      </label>
      <label style="font-size:.82rem;color:var(--clr-muted);display:flex;flex-direction:column;gap:.4rem;">Show in Directory
        <select id="ud-show" style="${inputStyle}">
          <option value="1" ${user.show_in_directory !== 0 ? 'selected' : ''}>Yes</option>
          <option value="0" ${user.show_in_directory === 0 ? 'selected' : ''}>No</option>
        </select>
      </label>
    </div>
    <button id="ud-save-btn" class="btn-grant" style="padding:.45rem 1rem;">Save Profile</button>
  `;

  // Grant buttons inside detail panel
  panel.querySelectorAll('[data-detail-grant]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = parseInt(btn.dataset.uid);
      const lv  = parseInt(btn.dataset.level);
      try {
        await apiFetch('/api/admin/grant-certification', { method: 'POST', body: JSON.stringify({ userId: uid, level: lv }) });
        showToast(`Level ${lv} granted.`, 'success');
        loadAdmin();
        // Refresh panel with updated data
        const fresh = await apiFetch('/api/admin/users');
        const updated = fresh.users.find(u => u.id === uid);
        if (updated) openUserDetail(updated);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
  panel.querySelectorAll('[data-detail-grant-l3]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const uid = parseInt(btn.dataset.uid);
      try {
        await apiFetch('/api/admin/grant-level3', { method: 'POST', body: JSON.stringify({ userId: uid }) });
        showToast('Level 3 granted.', 'success');
        loadAdmin();
        const fresh = await apiFetch('/api/admin/users');
        const updated = fresh.users.find(u => u.id === uid);
        if (updated) openUserDetail(updated);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // Grant course access
  panel.querySelectorAll('[data-grant-course]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lvl = parseInt(btn.dataset.grantCourse);
      const uid = parseInt(btn.dataset.uid);
      try {
        await apiFetch('/api/admin/grant-course-access', { method: 'POST', body: JSON.stringify({ userId: uid, level: lvl }) });
        showToast(`Level ${lvl} course access granted.`, 'success');
        const fresh = await apiFetch(`/api/admin/user-detail/${uid}`);
        openUserDetail({ ...user, courseAccess: fresh.courseAccess });
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // Revoke course access
  panel.querySelectorAll('[data-revoke-course]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const lvl = parseInt(btn.dataset.revokeCourse);
      const uid = parseInt(btn.dataset.uid);
      try {
        await apiFetch('/api/admin/revoke-course-access', { method: 'POST', body: JSON.stringify({ userId: uid, level: lvl }) });
        showToast(`Level ${lvl} course access revoked.`, 'success');
        const fresh = await apiFetch(`/api/admin/user-detail/${uid}`);
        openUserDetail({ ...user, courseAccess: fresh.courseAccess });
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  document.getElementById('ud-save-btn')?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/admin/update-judge', {
        method: 'POST',
        body: JSON.stringify({
          userId: user.id,
          position: document.getElementById('ud-position')?.value.trim(),
          instagram: document.getElementById('ud-instagram')?.value.trim(),
          comps_judged: document.getElementById('ud-comps')?.value,
          show_in_directory: document.getElementById('ud-show')?.value === '1',
        }),
      });
      showToast('Profile saved.', 'success');
    } catch (err) { showToast(err.message, 'error'); }
  });

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

// ===================== COURSE PAGE =====================
let courseStatus = null;

async function loadCourse() {
  const container = document.getElementById('course-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:3rem;">Loading…</p>';

  try {
    courseStatus = await apiFetch('/api/course/status');
  } catch {
    container.innerHTML = '<p style="color:#f87171;text-align:center;padding:3rem;">Could not load course data.</p>';
    return;
  }

  const { access, progress, level3, can_apply_level3, is_admin } = courseStatus;
  const hasAny = access.level0 || access.level1 || access.level2;

  if (!hasAny) {
    container.innerHTML = `
      <div style="text-align:center;padding:4rem 2rem;">
        <div style="font-size:3rem;margin-bottom:1rem;">🔒</div>
        <h2 style="font-family:var(--font-heading);font-size:1.6rem;margin-bottom:.75rem;">No Course Access Yet</h2>
        <p style="color:var(--clr-muted);max-width:420px;margin:0 auto 1.5rem;">Complete payment for Level 0 or Level 1 to unlock your certification course.</p>
        <button data-nav="payment" class="btn btn-primary btn-glow">Go to Payment</button>
      </div>`;
    return;
  }

  // Build tabs
  const tabs = [];
  if (access.level0) tabs.push({ level: 0, label: 'Level 0 Certification', prog: progress.level0 });
  if (access.level1) tabs.push({ level: 1, label: 'Level 1 Certification', prog: progress.level1 });
  if (access.level2) tabs.push({ level: 2, label: 'Level 2 Certification', prog: progress.level2 });

  let html = `<div class="course-tabs" id="course-tabs">`;
  tabs.forEach((t, i) => {
    html += `<button class="course-tab${i === 0 ? ' active' : ''}" data-level="${t.level}">${t.label}</button>`;
  });
  html += `</div><div id="course-level-content"></div>`;

  // Level 3 apply section (for certified users)
  if (can_apply_level3) {
    html += `
      <div class="course-section-card" style="border-color:rgba(240,192,48,.3);margin-top:2rem;">
        <div class="course-section-icon">⭐</div>
        <h3>Apply for Level 3</h3>
        <p>You hold a certified judge license. Level 3 is awarded based on proven experience — apply and the Director will review your record.</p>
        <button class="btn-apply-l3" id="btn-apply-l3">Apply for Level 3</button>
      </div>`;
  } else if (level3.application_status === 'pending') {
    html += `
      <div class="course-section-card" style="border-color:rgba(240,192,48,.3);margin-top:2rem;">
        <div class="course-section-icon">⏳</div>
        <h3>Level 3 Application — Pending</h3>
        <p>Your application has been submitted and is under review by the Director.</p>
      </div>`;
  } else if (level3.certified) {
    html += `
      <div class="course-section-card passed" style="margin-top:2rem;">
        <div class="course-section-icon">🏆</div>
        <h3>Level 3 Judge — Certified</h3>
        <p>You are a certified Level 3 USA Streetlifting Judge. Congratulations.</p>
      </div>`;
  }

  container.innerHTML = html;

  // Render first tab
  renderCourseLevel(tabs[0].level, tabs[0].prog, is_admin);

  // Tab switching
  document.getElementById('course-tabs')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.course-tab');
    if (!btn) return;
    document.querySelectorAll('.course-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    const level = parseInt(btn.dataset.level);
    const prog = level === 0 ? progress.level0 : level === 1 ? progress.level1 : progress.level2;
    renderCourseLevel(level, prog, is_admin);
  });

  // Level 3 apply button
  document.getElementById('btn-apply-l3')?.addEventListener('click', async () => {
    try {
      await apiFetch('/api/course/apply-level3', { method: 'POST' });
      showToast('Application submitted! The Director will review it.', 'success');
      loadCourse();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

const COURSE_VIDEOS = {
  0: [
    { title: 'Course Overview', file: 'Course Overview.mp4' },
    { title: 'Introduction',    file: 'Introduction.mp4' },
    { title: 'Judging System',  file: 'Judging System.mp4' },
    { title: 'Pulls',           file: 'Pulls.mp4' },
    { title: 'Dips',            file: 'DIPS.mp4' },
    { title: 'Conclusion',      file: 'Conclusion.mp4' },
  ],
  1: [
    { title: 'Course Overview', file: 'Course Overview.mp4' },
    { title: 'Introduction',    file: 'Introduction.mp4' },
    { title: 'Judging System',  file: 'Judging System.mp4' },
    { title: 'Bar Muscle Up',   file: 'Bar Muscle Up.mp4' },
    { title: 'Ring Muscle Up',  file: 'Ring Muscle Up.mp4' },
    { title: 'Pulls',           file: 'Pulls.mp4' },
    { title: 'Dips',            file: 'DIPS.mp4' },
    { title: 'Squats',          file: 'Squats.mp4' },
    { title: 'Conclusion',      file: 'Conclusion.mp4' },
  ],
};
COURSE_VIDEOS[2] = COURSE_VIDEOS[1]; // Level 2 uses same videos for now

function renderCourseLevel(level, prog, isAdmin) {
  const container = document.getElementById('course-level-content');
  if (!container) return;

  const levelLabel = `Level ${level} Certification`;
  const desc = level === 0
    ? 'Master the judging standards for the Pull and the Dip.'
    : level === 1
    ? 'Extend your knowledge with the Muscle Up and Back Squat, qualifying you for all 4 movements.'
    : 'Advanced course covering technical infractions, equipment rules, and Head Judge responsibilities.';

  // Step statuses
  const videosDone = prog.all_videos_done;
  const examDone   = prog.exam_passed;
  const certDone   = prog.certified;

  function stepClass(condition, prev) {
    if (condition) return 'done';
    if (prev) return 'active';
    return '';
  }

  const videoStep    = stepClass(videosDone, true);
  const examStep     = stepClass(examDone, videosDone);
  const scheduleStep = stepClass(false, examDone);
  const certStep     = stepClass(certDone, false);

  const videos = COURSE_VIDEOS[level] || [];

  let videoCards = '';
  videos.forEach((v, i) => {
    const done      = prog.videos_completed.includes(i);
    const unlocked  = isAdmin || done || i === 0 || prog.videos_completed.includes(i - 1);
    const cardClass = done ? 'completed' : (unlocked ? 'unlocked' : 'locked');
    const statusText = done ? '✓ Watched' : (unlocked ? 'Click to watch' : '🔒 Locked');
    const statusClass = done ? 'done' : (unlocked ? 'unlocked' : 'locked');
    const src = `https://pub-be06f36754244e97924aad36ac6257af.r2.dev/${encodeURIComponent(v.file)}`;

    videoCards += `
      <div class="video-card ${cardClass}" data-video-index="${i}" data-level="${level}" data-src="${src}" style="${unlocked ? 'cursor:pointer;' : ''}">
        <div class="video-thumb" style="pointer-events:none;">
          ${unlocked
            ? `<video preload="metadata" src="${src}#t=0.1" style="width:100%;height:100%;object-fit:cover;pointer-events:none;" tabindex="-1"></video>
               <div class="video-play-overlay" style="pointer-events:none;">${done ? '<span class="video-done-check">✓</span>' : '<span class="video-play-btn">▶</span>'}</div>`
            : `<div class="video-thumb-placeholder" style="pointer-events:none;"><span>🔒</span><span>Locked</span></div>`}
        </div>
        <div class="video-info" style="pointer-events:none;">
          <div class="video-title">${v.title}</div>
          <div class="video-status ${statusClass}">${statusText}</div>
          ${(isAdmin && !done) ? `<button class="btn-grant" style="margin-top:.5rem;font-size:.75rem;pointer-events:all;" data-mark-video="${i}" data-mark-level="${level}">Mark watched (admin)</button>` : ''}
        </div>
      </div>`;
  });

  const examCard = `
    <div class="course-section-card ${examDone ? 'passed' : (videosDone ? 'unlocked' : 'locked')}" id="exam-card-${level}">
      <div class="course-section-icon">${examDone ? '✅' : '📝'}</div>
      <h3>Certification Exam</h3>
      ${examDone
        ? `<p style="color:#4cd964;font-weight:600;">Passed with ${prog.exam_best_score}% — congratulations!</p>`
        : videosDone
          ? `<p>You have watched all the course videos. Take the exam below — you need <strong>80% or higher</strong> to pass.</p>
             ${prog.exam_attempts > 0 ? `<p style="margin-top:.5rem;font-size:.85rem;color:var(--clr-muted);">Previous best: <strong>${prog.exam_best_score}%</strong> — keep trying!</p>` : ''}
             <button class="btn btn-primary" style="margin-top:1rem;" id="start-exam-btn-${level}">Start Exam</button>
             <div id="exam-ui-${level}" style="margin-top:1.5rem;"></div>`
          : `<p>Complete all videos to unlock the exam.</p>
             <span class="lock-badge">🔒 Locked — watch all videos first</span>`
      }
    </div>`;

  const scheduleCard = `
    <div class="course-section-card ${examDone ? 'unlocked' : 'locked'}">
      <div class="course-section-icon">📅</div>
      <h3>Schedule Your Oral Exam</h3>
      ${examDone ? `
        <p>Pick a time slot that works for you. The Director will receive an automatic confirmation email when you book.</p>
        <a href="https://calendar.app.google/buLedPtpm2yv6Wau8" target="_blank" rel="noopener" class="btn btn-primary btn-glow" style="margin-top:1rem;display:inline-block;">Book a Time Slot</a>
        <div class="schedule-divider">
          <span>None of the slots work for you?</span>
        </div>
        <p style="font-size:.88rem;color:var(--clr-muted);margin-bottom:.75rem;">Send a message to the Director and we'll find a time that works.</p>
        <a href="mailto:usastreetlifting.judging@gmail.com?subject=Oral Exam Scheduling — Level ${level} Certification&body=Hi Théo,%0A%0AI passed the Level ${level} written exam and none of the available time slots work for me.%0A%0AMy availability:%0A%0AName: ${escapeHtml(currentUser?.name || '')}" class="btn btn-outline" style="display:inline-block;">Email the Director</a>
      ` : `
        <p>Pass the written exam to unlock scheduling.</p>
        <span class="lock-badge">🔒 Locked — pass the exam first</span>
      `}
    </div>`;

  // Expiry check
  let certExpired = false, certDaysLeft = null;
  if (certDone && prog.cert_granted_at) {
    const expiry = new Date(prog.cert_granted_at);
    expiry.setFullYear(expiry.getFullYear() + 1);
    const now = new Date();
    certExpired = now > expiry;
    certDaysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
  }

  const certCard = `
    <div class="course-section-card ${certDone ? (certExpired ? '' : 'passed') : 'locked'}" ${certExpired ? 'style="border-color:rgba(248,113,113,.4);"' : ''}>
      <div class="course-section-icon">🏅</div>
      <h3>Official Certificate</h3>
      ${certDone
        ? certExpired
          ? `<p style="color:#f87171;font-weight:600;">Your certification has expired.</p>
             <p style="color:var(--clr-muted);font-size:.9rem;margin-top:.35rem;">Renew to restore your judging privileges.</p>
             <button class="btn btn-primary" style="margin-top:1rem;" onclick="navigate('payment')">Renew Certification</button>`
          : `<p>Your certification is active${certDaysLeft !== null && certDaysLeft <= 30 ? ` — <strong style="color:#f5a623;">expires in ${certDaysLeft} days</strong>` : ''}. Download your official certificate below.</p>
             <button class="btn btn-primary" style="margin-top:1rem;" id="dl-cert-btn-${level}">Download Certificate</button>
             ${certDaysLeft !== null && certDaysLeft <= 60 ? `<button class="btn btn-outline" style="margin-top:.5rem;margin-left:.75rem;" onclick="navigate('payment')">Renew Early</button>` : ''}`
        : '<p>The Director will approve your certification after the oral exam.</p><span class="lock-badge">🔒 Pending Director approval</span>'}
    </div>`;

  const adminControls = isAdmin ? `
    <div class="course-section-card" style="border-color:rgba(240,192,48,.3);margin-top:2rem;">
      <h3>⭐ Admin Controls — Level ${level}</h3>
      <p style="margin-bottom:1rem;">Manually grant or revoke the Level ${level} oral certification for this user (viewing own account).</p>
      <div class="admin-cert-row">
        <button class="btn-grant" data-grant-cert="${level}">✓ Grant Level ${level} Certificate</button>
        <button class="btn-revoke" data-revoke-cert="${level}">✗ Revoke Level ${level} Certificate</button>
      </div>
    </div>` : '';

  container.innerHTML = `
    <div class="course-level-header">
      <h2>${levelLabel}</h2>
      <p>${desc}</p>
    </div>
    <div class="course-steps">
      <div class="course-step ${videoStep}">
        <div class="course-step-dot">${videosDone ? '✓' : '1'}</div>
        <div class="course-step-label">Videos</div>
      </div>
      <div class="course-step ${examStep}">
        <div class="course-step-dot">${examDone ? '✓' : '2'}</div>
        <div class="course-step-label">Exam</div>
      </div>
      <div class="course-step ${scheduleStep}">
        <div class="course-step-dot">3</div>
        <div class="course-step-label">Schedule</div>
      </div>
      <div class="course-step ${certStep}">
        <div class="course-step-dot">${certDone ? '✓' : '4'}</div>
        <div class="course-step-label">Certificate</div>
      </div>
    </div>
    <div class="video-grid">${videoCards}</div>
    ${examCard}
    ${scheduleCard}
    ${certCard}
    ${adminControls}
  `;

  // Click on video card to open player
  container.querySelectorAll('.video-card.unlocked, .video-card.completed').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const vi    = parseInt(card.dataset.videoIndex);
      const lv    = parseInt(card.dataset.level);
      const src   = card.dataset.src;
      const title = (COURSE_VIDEOS[lv] || [])[vi]?.title || `Video ${vi + 1}`;
      const done  = card.classList.contains('completed');
      window.openVideoPlayer(src, title, vi, lv, done);
    });
  });

  // Admin: mark video watched
  container.querySelectorAll('[data-mark-video]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const vi = parseInt(btn.dataset.markVideo);
      const lv = parseInt(btn.dataset.markLevel);
      try {
        await apiFetch('/api/course/video-complete', { method: 'POST', body: JSON.stringify({ level: lv, videoIndex: vi }) });
        showToast('Video marked as watched.', 'success');
        courseStatus = await apiFetch('/api/course/status');
        const prog = lv === 0 ? courseStatus.progress.level0 : courseStatus.progress.level1;
        renderCourseLevel(lv, prog, true);
      } catch (err) { showToast(err.message, 'error'); }
    });
  });

  // Download certificate button
  document.getElementById(`dl-cert-btn-${level}`)?.addEventListener('click', () => {
    downloadCertificate(level);
  });

  // Start exam button
  document.getElementById(`start-exam-btn-${level}`)?.addEventListener('click', () => {
    loadExam(level);
  });

  // Admin: grant/revoke cert
  container.querySelector('[data-grant-cert]')?.addEventListener('click', async (e) => {
    const lv = parseInt(e.target.dataset.grantCert);
    try {
      await apiFetch('/api/admin/grant-certification', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, level: lv }) });
      showToast(`Level ${lv} certificate granted.`, 'success');
      loadCourse();
    } catch (err) { showToast(err.message, 'error'); }
  });
  container.querySelector('[data-revoke-cert]')?.addEventListener('click', async (e) => {
    const lv = parseInt(e.target.dataset.revokeCert);
    try {
      await apiFetch('/api/admin/revoke-certification', { method: 'POST', body: JSON.stringify({ userId: currentUser.id, level: lv }) });
      showToast(`Level ${lv} certificate revoked.`, 'success');
      loadCourse();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

function downloadCertificate(level) {
  showToast('Generating your certificate…', 'success');
  const a = document.createElement('a');
  a.href = `/api/certificate/${level}`;
  a.target = '_blank';
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ===================== VIDEO PLAYER MODAL =====================
(function initVideoModal() {
  const overlay  = document.getElementById('video-modal');
  const closeBtn = document.getElementById('video-modal-close');
  const titleEl  = document.getElementById('video-modal-title');
  const player   = document.getElementById('video-modal-player');
  const footer   = document.getElementById('video-modal-footer');

  let currentVideoIndex = null;
  let currentLevel      = null;
  let markedComplete    = false;

  window.openVideoPlayer = function(src, title, videoIndex, level, alreadyDone) {
    currentVideoIndex = videoIndex;
    currentLevel      = level;
    markedComplete    = alreadyDone;

    titleEl.textContent = title;
    player.src = src;
    player.currentTime = 0;
    footer.innerHTML = alreadyDone
      ? '<span style="color:#4cd964;font-weight:600;">✓ Already completed</span>'
      : '<span style="color:var(--clr-muted);font-size:.88rem;">Watch the full video to mark it as complete.</span>';

    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    player.play().catch(() => {});
  };

  // Mark complete when 90% watched
  player.addEventListener('timeupdate', async () => {
    if (markedComplete || !player.duration) return;
    if (player.currentTime / player.duration >= 0.9) {
      markedComplete = true;
      footer.innerHTML = '<span style="color:#4cd964;font-weight:600;">✓ Video complete! Loading next…</span>';
      try {
        await apiFetch('/api/course/video-complete', {
          method: 'POST',
          body: JSON.stringify({ level: currentLevel, videoIndex: currentVideoIndex }),
        });
        // Refresh course page in background
        if (courseStatus) {
          courseStatus = await apiFetch('/api/course/status');
          const prog = currentLevel === 0 ? courseStatus.progress.level0
                     : currentLevel === 1 ? courseStatus.progress.level1
                     : courseStatus.progress.level2;
          renderCourseLevel(currentLevel, prog, courseStatus.is_admin);
        }
      } catch (e) { /* silent */ }
    }
  });

  function closeModal() {
    player.pause();
    player.src = '';
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  }

  closeBtn.addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });
})();

// ===================== EXAM =====================
async function loadExam(level) {
  const ui = document.getElementById(`exam-ui-${level}`);
  const startBtn = document.getElementById(`start-exam-btn-${level}`);
  if (!ui) return;

  if (startBtn) startBtn.style.display = 'none';
  ui.innerHTML = '<p style="color:var(--clr-muted);">Loading questions…</p>';

  try {
    const { questions, total, pass_threshold } = await apiFetch(`/api/course/exam-questions?level=${level}`);

    let userAnswers = new Array(total).fill(null);

    function renderExam() {
      ui.innerHTML = `
        <div class="exam-header">
          <p style="color:var(--clr-muted);font-size:.88rem;margin-bottom:1.5rem;">
            ${total} questions · Pass mark: ${pass_threshold}% · Answers are not revealed on failure.
          </p>
        </div>
        <div class="exam-questions" id="exam-questions-${level}">
          ${questions.map((q, i) => `
            <div class="exam-question" id="eq-${level}-${i}">
              <p class="exam-q-text"><strong>${i + 1}.</strong> ${escapeHtml(q.question)}</p>
              <div class="exam-options">
                ${q.options.map((opt, oi) => `
                  <label class="exam-option ${userAnswers[i] === oi ? 'selected' : ''}" data-qi="${i}" data-oi="${oi}">
                    <span class="exam-option-letter">${String.fromCharCode(65 + oi)}</span>
                    <span>${escapeHtml(opt)}</span>
                  </label>
                `).join('')}
              </div>
            </div>
          `).join('')}
        </div>
        <div id="exam-submit-area-${level}" style="margin-top:2rem;text-align:center;">
          <p id="exam-progress-${level}" style="color:var(--clr-muted);font-size:.88rem;margin-bottom:1rem;">
            0 / ${total} answered
          </p>
          <button class="btn btn-primary btn-glow" id="exam-submit-btn-${level}" disabled>Submit Exam</button>
        </div>
      `;

      // Option click handler
      ui.querySelectorAll('.exam-option').forEach(label => {
        label.addEventListener('click', () => {
          const qi = parseInt(label.dataset.qi);
          const oi = parseInt(label.dataset.oi);
          userAnswers[qi] = oi;

          // Update visuals for this question
          ui.querySelectorAll(`[data-qi="${qi}"]`).forEach(l => l.classList.remove('selected'));
          label.classList.add('selected');

          // Update progress
          const answered = userAnswers.filter(a => a !== null).length;
          const prog = document.getElementById(`exam-progress-${level}`);
          if (prog) prog.textContent = `${answered} / ${total} answered`;

          // Enable submit when all answered
          const submitBtn = document.getElementById(`exam-submit-btn-${level}`);
          if (submitBtn) submitBtn.disabled = answered < total;
        });
      });

      // Submit handler
      document.getElementById(`exam-submit-btn-${level}`)?.addEventListener('click', async () => {
        if (userAnswers.some(a => a === null)) {
          showToast('Please answer all questions before submitting.', 'error');
          return;
        }
        const submitBtn = document.getElementById(`exam-submit-btn-${level}`);
        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting…';

        try {
          const result = await apiFetch('/api/course/submit-exam', {
            method: 'POST',
            body: JSON.stringify({ level, answers: userAnswers }),
          });
          showExamResult(level, result);
        } catch (err) {
          showToast(err.message, 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = 'Submit Exam';
        }
      });
    }

    renderExam();
  } catch (err) {
    ui.innerHTML = `<p style="color:#f87171;">Could not load exam: ${escapeHtml(err.message)}</p>`;
  }
}

function showExamResult(level, result) {
  const ui = document.getElementById(`exam-ui-${level}`);
  if (!ui) return;

  if (result.passed) {
    ui.innerHTML = `
      <div style="text-align:center;padding:2rem 0;">
        <div style="font-size:3.5rem;margin-bottom:1rem;">🎉</div>
        <h3 style="font-family:var(--font-heading);font-size:1.6rem;color:#4cd964;margin-bottom:.5rem;">Exam Passed!</h3>
        <p style="font-size:1.1rem;margin-bottom:.5rem;">Score: <strong style="color:#4cd964;">${result.score}%</strong> (${result.correct}/${result.total} correct)</p>
        <p style="color:var(--clr-muted);margin-bottom:1.5rem;">You can now schedule your oral exam with the Director.</p>
      </div>`;
    // Reload full course to update step indicators
    setTimeout(() => loadCourse(), 1500);
  } else {
    ui.innerHTML = `
      <div style="text-align:center;padding:2rem 0;">
        <div style="font-size:3rem;margin-bottom:1rem;">📝</div>
        <h3 style="font-family:var(--font-heading);font-size:1.4rem;margin-bottom:.5rem;">Not quite — keep going!</h3>
        <p style="font-size:1.05rem;margin-bottom:.5rem;">Score: <strong style="color:var(--clr-primary);">${result.score}%</strong> (${result.correct}/${result.total} correct)</p>
        <p style="color:var(--clr-muted);margin-bottom:1.5rem;">You need <strong>80%</strong> to pass. Answers are not shown — review the course videos and try again.</p>
        <button class="btn btn-primary" id="retry-exam-btn-${level}">Try Again</button>
      </div>`;
    document.getElementById(`retry-exam-btn-${level}`)?.addEventListener('click', () => loadExam(level));
  }
}

// ===================== JUDGE DIRECTORY =====================
async function loadDirectory() {
  const container = document.getElementById('directory-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:2rem;">Loading…</p>';
  try {
    const data = await fetch(_API + '/api/judges').then(r => r.json());
    renderDirectory(data.judges);

    document.getElementById('directory-search')?.addEventListener('input', (e) => {
      const q = e.target.value.toLowerCase();
      const filtered = data.judges.filter(j =>
        j.name.toLowerCase().includes(q) || (j.state || '').toLowerCase().includes(q)
      );
      renderDirectory(filtered);
    });
  } catch {
    container.innerHTML = '<p style="color:#f87171;text-align:center;">Could not load directory.</p>';
  }
}

function renderDirectory(judges) {
  const container = document.getElementById('directory-content');
  if (!judges.length) {
    container.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:2rem;">No judges found.</p>';
    return;
  }
  // Group by state
  const byState = {};
  for (const j of judges) {
    const state = j.state || 'Unknown';
    if (!byState[state]) byState[state] = [];
    byState[state].push(j);
  }
  const levelColors  = { '0':'#60a5fa', '1':'#4cd964', '2':'#f59e0b', '3':'#e11d48' };
  const levelLabels2 = { '0':'Entry', '1':'Foundational', '2':'Advanced', '3':'Elite' };
  let html = '';
  for (const [state, list] of Object.entries(byState).sort()) {
    html += `<div style="margin-bottom:3rem;">
      <h3 style="font-family:var(--font-heading);color:var(--clr-primary);font-size:.85rem;letter-spacing:.18em;text-transform:uppercase;margin-bottom:1.25rem;display:flex;align-items:center;gap:.75rem;">
        <span>${escapeHtml(state)}</span>
        <span style="flex:1;height:1px;background:linear-gradient(90deg,rgba(200,16,46,.3),transparent);"></span>
        <span style="font-size:.75rem;color:var(--clr-muted);letter-spacing:.05em;">${list.length} judge${list.length !== 1 ? 's' : ''}</span>
      </h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(185px,1fr));gap:1.25rem;">`;
    for (const j of list) {
      const topLevel = (j.levels || '').split(',').map(Number).filter(n => !isNaN(n));
      const highest  = topLevel.length ? Math.max(...topLevel) : null;
      const clr      = levelColors[highest] || '#c0392b';
      const lbl      = highest !== null ? levelLabels2[highest] || `Level ${highest}` : '';
      const dirInitials = j.name.split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase();
      const avatarInner = j.avatar
        ? `<img src="${escapeAttr(j.avatar)}" alt="${escapeAttr(j.name)}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;display:block;">`
        : `<div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${clr}44,${clr}11);display:flex;align-items:center;justify-content:center;font-weight:900;font-size:1.4rem;color:${clr};">${escapeHtml(dirInitials)}</div>`;
      const compsHtml = j.comps_judged > 0
        ? `<div style="text-align:center;"><div style="font-size:1.1rem;font-weight:800;color:#fff;">${j.comps_judged}</div><div style="font-size:.6rem;color:var(--clr-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:.1rem;">Comps</div></div>` : '';
      const igHtml = j.instagram
        ? `<div style="text-align:center;"><div style="font-size:1rem;">📸</div><div style="font-size:.6rem;color:var(--clr-muted);text-transform:uppercase;letter-spacing:.06em;margin-top:.1rem;">Insta</div></div>` : '';
      const hasStats = j.comps_judged > 0 || j.instagram;
      html += `
        <div style="position:relative;background:linear-gradient(160deg,${clr}18 0%,rgba(10,10,14,1) 55%);border:1px solid ${clr}30;border-radius:20px;overflow:hidden;cursor:pointer;transition:transform .3s cubic-bezier(.34,1.56,.64,1),box-shadow .3s ease;"
          onclick="openJudgeProfile(${j.id || 0})"
          onmouseenter="this.style.transform='translateY(-8px) scale(1.03)';this.style.boxShadow='0 24px 48px ${clr}30,0 0 0 1px ${clr}50';this.querySelector('.shine').style.opacity='1'"
          onmouseleave="this.style.transform='';this.style.boxShadow='';this.querySelector('.shine').style.opacity='0'">
          <!-- Shine sweep -->
          <div class="shine" style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,.08) 0%,transparent 60%);opacity:0;transition:opacity .3s;pointer-events:none;z-index:1;border-radius:20px;"></div>
          <!-- Top color bar -->
          <div style="height:3px;background:linear-gradient(90deg,${clr},${clr}44);"></div>
          <!-- Body -->
          <div style="padding:1.5rem 1rem 1.25rem;text-align:center;position:relative;z-index:2;">
            <!-- Avatar with glowing ring -->
            <div style="position:relative;display:inline-flex;align-items:center;justify-content:center;margin-bottom:.9rem;">
              <div style="position:absolute;inset:-3px;border-radius:50%;background:linear-gradient(135deg,${clr},${clr}33);padding:3px;z-index:0;"></div>
              <div style="position:relative;z-index:1;border-radius:50%;background:#0a0a0e;padding:3px;">${avatarInner}</div>
              <div style="position:absolute;inset:-3px;border-radius:50%;box-shadow:0 0 18px ${clr}55;pointer-events:none;"></div>
            </div>
            <!-- Name -->
            <div style="font-weight:800;font-size:.98rem;letter-spacing:.01em;line-height:1.2;margin-bottom:.2rem;">${escapeHtml(j.name)}</div>
            <!-- Position -->
            ${j.position ? `<div style="font-size:.72rem;color:var(--clr-muted);margin-bottom:.6rem;letter-spacing:.02em;">${escapeHtml(j.position)}</div>` : `<div style="margin-bottom:.6rem;"></div>`}
            <!-- Level badge -->
            ${highest !== null ? `<div style="margin-bottom:${hasStats ? '.85rem' : '0'};"><span style="display:inline-block;background:${clr}22;color:${clr};border:1px solid ${clr}55;border-radius:20px;padding:4px 14px;font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;">Level ${highest} · ${lbl}</span></div>` : ''}
            <!-- Stats row -->
            ${hasStats ? `<div style="display:flex;justify-content:center;gap:1.5rem;padding-top:.7rem;border-top:1px solid rgba(255,255,255,.07);">${compsHtml}${igHtml}</div>` : ''}
          </div>
        </div>`;
    }
    html += `</div></div>`;
  }
  container.innerHTML = html;
}

// ===================== EVENTS =====================
async function loadEvents() {
  const container = document.getElementById('events-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:2rem;">Loading…</p>';
  try {
    const eventsRes = await fetch(_API + '/api/events', { credentials: 'include' });
    const eventsData = await eventsRes.json();
    const myData = currentUser
      ? await apiFetch('/api/events/my').catch(() => ({ events: [] }))
      : { events: [] };
    const myIds = new Set((myData.events || []).map(e => e.id));
    renderEvents(eventsData.events || [], myIds);
  } catch {
    container.innerHTML = '<p style="color:#f87171;text-align:center;">Could not load events.</p>';
  }
}

function renderEvents(events, myIds) {
  const container = document.getElementById('events-content');
  if (!events.length) {
    container.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:2rem;">No upcoming events scheduled.</p>';
    return;
  }
  let html = '';
  for (const ev of events) {
    const registered = myIds.has(ev.id);
    html += `
      <div class="course-section-card" style="margin-bottom:1.25rem;" data-event-id="${ev.id}">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:1rem;">
          <div>
            <h3 style="font-family:var(--font-heading);font-size:1.2rem;margin-bottom:.35rem;">${escapeHtml(ev.name)}</h3>
            <p style="color:var(--clr-muted);font-size:.9rem;">📅 ${escapeHtml(ev.event_date)} &nbsp;|&nbsp; 📍 ${escapeHtml(ev.location)}</p>
            ${ev.description ? `<p style="margin-top:.5rem;font-size:.9rem;">${escapeHtml(ev.description)}</p>` : ''}
            <p style="font-size:.8rem;color:var(--clr-muted);margin-top:.4rem;">${ev.judge_count} judge${ev.judge_count !== 1 ? 's' : ''} registered</p>
          </div>
          <div>
            ${currentUser
              ? registered
                ? `<button class="btn btn-outline event-unreg-btn" data-id="${ev.id}" style="font-size:.85rem;padding:.5rem 1rem;">✓ Registered — Cancel</button>`
                : `<button class="btn btn-primary event-reg-btn" data-id="${ev.id}" style="font-size:.85rem;padding:.5rem 1rem;">Register to Judge</button>`
              : `<button class="btn btn-primary" data-nav="login" style="font-size:.85rem;padding:.5rem 1rem;">Login to Register</button>`
            }
          </div>
        </div>
      </div>`;
  }
  container.innerHTML = html;

  container.querySelectorAll('.event-reg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      btn.disabled = true; btn.textContent = 'Registering…';
      try {
        await apiFetch(`/api/events/${id}/register`, { method: 'POST' });
        showToast('Registered! Confirmation email sent.', 'success');
        loadEvents();
      } catch (err) { showToast(err.message, 'error'); btn.disabled = false; btn.textContent = 'Register to Judge'; }
    });
  });

  container.querySelectorAll('.event-unreg-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      try {
        await apiFetch(`/api/events/${id}/unregister`, { method: 'POST' });
        showToast('Registration cancelled.', 'info');
        loadEvents();
      } catch (err) { showToast(err.message, 'error'); }
    });
  });
}

// ===================== COMP HISTORY =====================
async function loadCompHistory() {
  const container = document.getElementById('comp-history-list');
  if (!container) return;
  try {
    const { history } = await apiFetch('/api/comp-history');
    if (!history.length) {
      container.innerHTML = '<p class="muted" style="font-size:.88rem;">No competitions logged yet.</p>';
      return;
    }
    let html = '<div style="display:flex;flex-direction:column;gap:.4rem;">';
    for (const c of history) {
      html += `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:.5rem .75rem;background:rgba(255,255,255,.04);border-radius:8px;flex-wrap:wrap;gap:.4rem;">
          <div>
            <strong style="font-size:.9rem;">${escapeHtml(c.comp_name)}</strong>
            <span style="color:var(--clr-muted);font-size:.8rem;margin-left:.5rem;">${escapeHtml(c.comp_date)}${c.location ? ' · ' + escapeHtml(c.location) : ''}</span>
            ${c.role ? `<span style="font-size:.78rem;color:var(--clr-primary);margin-left:.4rem;">${escapeHtml(c.role)}</span>` : ''}
          </div>
          <button class="btn-revoke" style="font-size:.75rem;padding:.25rem .6rem;" data-ch-delete="${c.id}">Remove</button>
        </div>`;
    }
    html += '</div>';
    container.innerHTML = html;
    container.querySelectorAll('[data-ch-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await apiFetch(`/api/comp-history/${btn.dataset.chDelete}`, { method: 'DELETE' });
          loadCompHistory();
        } catch (err) { showToast(err.message, 'error'); }
      });
    });
  } catch { container.innerHTML = '<p class="muted">Could not load history.</p>'; }
}

function initCompHistory() {
  document.getElementById('ch-add-btn')?.addEventListener('click', async () => {
    const name     = document.getElementById('ch-name')?.value.trim();
    const date     = document.getElementById('ch-date')?.value;
    const location = document.getElementById('ch-location')?.value.trim();
    const role     = document.getElementById('ch-role')?.value.trim();
    if (!name || !date) { showToast('Competition name and date required.', 'error'); return; }
    try {
      await apiFetch('/api/comp-history', { method: 'POST', body: JSON.stringify({ comp_name: name, comp_date: date, location, role }) });
      document.getElementById('ch-name').value = '';
      document.getElementById('ch-date').value = '';
      document.getElementById('ch-location').value = '';
      document.getElementById('ch-role').value = '';
      showToast('Competition logged!', 'success');
      loadCompHistory();
    } catch (err) { showToast(err.message, 'error'); }
  });
}

// ===================== JUDGE PROFILE =====================
async function openJudgeProfile(judgeId) {
  navigate('judge-profile');
  const container = document.getElementById('judge-profile-content');
  container.innerHTML = '<p class="muted" style="text-align:center;padding:3rem;">Loading…</p>';
  try {
    const { user, certs, history } = await fetch(_API + `/api/judge/${judgeId}`).then(r => r.json());
    if (!user) { container.innerHTML = '<p style="color:#f87171;text-align:center;">Judge not found.</p>'; return; }

    const initials = user.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const avatarHtml = user.avatar
      ? `<div style="width:80px;height:80px;border-radius:50%;background:center/cover url('${escapeAttr(user.avatar)}');flex-shrink:0;"></div>`
      : `<div style="width:80px;height:80px;border-radius:50%;background:rgba(200,16,46,.2);display:flex;align-items:center;justify-content:center;font-size:1.6rem;font-weight:800;color:var(--clr-primary);">${escapeHtml(initials)}</div>`;

    const certBadges = certs.map(c => {
      const expiry = new Date(c.granted_at); expiry.setFullYear(expiry.getFullYear() + 1);
      const expired = new Date() > expiry;
      const color = expired ? '#f87171' : '#4cd964';
      return `<span style="background:rgba(200,16,46,.15);color:${color};border-radius:6px;padding:4px 12px;font-size:.8rem;font-weight:700;">Level ${c.level}${expired ? ' (expired)' : ''}</span>`;
    }).join(' ');

    const historyHtml = history.length ? history.map(h => `
      <div style="display:flex;justify-content:space-between;padding:.5rem 0;border-bottom:1px solid rgba(255,255,255,.06);">
        <div>
          <strong style="font-size:.9rem;">${escapeHtml(h.comp_name)}</strong>
          ${h.location ? `<span style="color:var(--clr-muted);font-size:.8rem;"> · ${escapeHtml(h.location)}</span>` : ''}
          ${h.role ? `<span style="color:var(--clr-primary);font-size:.78rem;margin-left:.4rem;">${escapeHtml(h.role)}</span>` : ''}
        </div>
        <span style="color:var(--clr-muted);font-size:.8rem;white-space:nowrap;">${escapeHtml(h.comp_date)}</span>
      </div>`).join('') : '<p class="muted" style="font-size:.88rem;">No competitions logged.</p>';

    const certLevelNames = { 0: 'Beginner', 1: 'Local', 2: 'State', 3: 'National' };
    const activeCerts = certs.filter(c => { const e = new Date(c.granted_at); e.setFullYear(e.getFullYear()+1); return new Date() <= e; });
    const highestLevel = activeCerts.length ? Math.max(...activeCerts.map(c => c.level)) : -1;

    container.innerHTML = `
      <button class="btn btn-outline" style="margin-bottom:2rem;font-size:.85rem;" onclick="window.history.back()">← Back to Directory</button>

      <!-- Hero banner -->
      <div style="position:relative;border-radius:16px;overflow:hidden;margin-bottom:2rem;background:linear-gradient(135deg,rgba(200,16,46,.18) 0%,rgba(0,0,0,.6) 100%);border:1px solid rgba(200,16,46,.2);">
        <div style="padding:2rem 2rem 1.5rem;display:flex;gap:1.5rem;align-items:flex-end;flex-wrap:wrap;">
          ${user.avatar
            ? `<img src="${escapeAttr(user.avatar)}" alt="${escapeAttr(user.name)}" style="width:96px;height:96px;border-radius:50%;object-fit:cover;border:3px solid rgba(200,16,46,.5);flex-shrink:0;">`
            : `<div style="width:96px;height:96px;border-radius:50%;background:rgba(200,16,46,.25);display:flex;align-items:center;justify-content:center;font-size:2.2rem;font-weight:800;color:var(--clr-primary);border:3px solid rgba(200,16,46,.3);flex-shrink:0;">${escapeHtml(user.name.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase())}</div>`
          }
          <div style="flex:1;min-width:0;">
            <h2 style="font-family:var(--font-heading);font-size:2rem;font-weight:800;margin:0 0 .2rem;">${escapeHtml(user.name)}</h2>
            ${user.position ? `<div style="color:var(--clr-primary);font-size:.95rem;font-weight:600;margin-bottom:.4rem;">${escapeHtml(user.position)}</div>` : ''}
            ${highestLevel >= 0 ? `<div style="display:inline-block;background:rgba(200,16,46,.2);color:#fff;border:1px solid rgba(200,16,46,.4);border-radius:20px;padding:3px 14px;font-size:.82rem;font-weight:700;letter-spacing:.05em;">Level ${highestLevel} — ${certLevelNames[highestLevel] || ''} Judge</div>` : ''}
          </div>
        </div>
        <!-- Stat strip -->
        <div style="display:flex;gap:0;border-top:1px solid rgba(255,255,255,.07);">
          ${user.state ? `<div style="flex:1;text-align:center;padding:.75rem .5rem;border-right:1px solid rgba(255,255,255,.07);"><div style="font-size:1.1rem;">📍</div><div style="font-size:.78rem;color:var(--clr-muted);margin-top:.15rem;">${escapeHtml(user.state)}</div></div>` : ''}
          <div style="flex:1;text-align:center;padding:.75rem .5rem;${user.state ? 'border-right:1px solid rgba(255,255,255,.07);' : ''}"><div style="font-size:1.3rem;font-weight:800;font-family:var(--font-heading);color:var(--clr-primary);">${user.comps_judged || 0}</div><div style="font-size:.78rem;color:var(--clr-muted);">Comps Judged</div></div>
          <div style="flex:1;text-align:center;padding:.75rem .5rem;border-left:1px solid rgba(255,255,255,.07);"><div style="font-size:1.3rem;font-weight:800;font-family:var(--font-heading);color:#4cd964;">${activeCerts.length}</div><div style="font-size:.78rem;color:var(--clr-muted);">Active Certs</div></div>
          ${user.instagram ? `<div style="flex:1;text-align:center;padding:.75rem .5rem;border-left:1px solid rgba(255,255,255,.07);"><a href="https://instagram.com/${user.instagram.replace('@','')}" target="_blank" rel="noopener" style="color:var(--clr-muted);text-decoration:none;font-size:1.1rem;">📸</a><div style="font-size:.78rem;color:var(--clr-muted);margin-top:.15rem;">${escapeHtml(user.instagram)}</div></div>` : ''}
        </div>
      </div>

      <!-- Certifications -->
      ${certs.length ? `
        <h3 style="font-family:var(--font-heading);font-size:1.1rem;margin-bottom:.75rem;letter-spacing:.05em;text-transform:uppercase;color:var(--clr-muted);">Certifications</h3>
        <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-bottom:2rem;">
          ${certs.map(c => {
            const expiry = new Date(c.granted_at); expiry.setFullYear(expiry.getFullYear()+1);
            const expired = new Date() > expiry;
            const daysLeft = Math.ceil((expiry - new Date()) / 86400000);
            return `<div style="background:${expired ? 'rgba(248,113,113,.1)' : 'rgba(76,217,100,.08)'};border:1px solid ${expired ? 'rgba(248,113,113,.3)' : 'rgba(76,217,100,.25)'};border-radius:10px;padding:.6rem 1rem;">
              <div style="font-weight:800;font-family:var(--font-heading);font-size:1.05rem;color:${expired ? '#f87171' : '#4cd964'};">Level ${c.level}</div>
              <div style="font-size:.75rem;color:var(--clr-muted);">${certLevelNames[c.level] || ''} Judge</div>
              <div style="font-size:.72rem;margin-top:.25rem;color:${expired ? '#f87171' : daysLeft <= 30 ? '#f5a623' : 'var(--clr-muted)'};">${expired ? '⚠ Expired' : daysLeft <= 30 ? `Expires in ${daysLeft}d` : `Valid until ${expiry.toLocaleDateString('en-US',{month:'short',year:'numeric'})}`}</div>
            </div>`;
          }).join('')}
        </div>` : ''}

      <!-- Bio -->
      ${user.experience ? `
        <h3 style="font-family:var(--font-heading);font-size:1.1rem;margin-bottom:.75rem;letter-spacing:.05em;text-transform:uppercase;color:var(--clr-muted);">About</h3>
        <div style="background:rgba(255,255,255,.04);border-radius:12px;padding:1.25rem;margin-bottom:2rem;font-size:.92rem;line-height:1.8;color:#ccc;">${escapeHtml(user.experience)}</div>` : ''}

      <!-- Competition history -->
      <h3 style="font-family:var(--font-heading);font-size:1.1rem;margin-bottom:.75rem;letter-spacing:.05em;text-transform:uppercase;color:var(--clr-muted);">Competition History</h3>
      ${history.length ? `
        <div style="display:flex;flex-direction:column;gap:.4rem;">
          ${history.map((h, i) => `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:.7rem 1rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:10px;flex-wrap:wrap;gap:.4rem;">
              <div style="display:flex;align-items:center;gap:.75rem;">
                <div style="width:32px;height:32px;border-radius:8px;background:rgba(200,16,46,.15);display:flex;align-items:center;justify-content:center;font-size:.8rem;font-weight:700;color:var(--clr-primary);flex-shrink:0;">${i+1}</div>
                <div>
                  <div style="font-weight:600;font-size:.92rem;">${escapeHtml(h.comp_name)}</div>
                  <div style="font-size:.78rem;color:var(--clr-muted);">${h.location ? escapeHtml(h.location) + ' · ' : ''}${h.role ? `<span style="color:var(--clr-primary);">${escapeHtml(h.role)}</span>` : ''}</div>
                </div>
              </div>
              <span style="font-size:.8rem;color:var(--clr-muted);background:rgba(255,255,255,.05);padding:2px 10px;border-radius:20px;">${escapeHtml(h.comp_date)}</span>
            </div>`).join('')}
        </div>` : '<p style="color:var(--clr-muted);font-size:.9rem;">No competitions logged yet.</p>'}
    `;
  } catch {
    container.innerHTML = '<p style="color:#f87171;text-align:center;">Could not load profile.</p>';
  }
}

// ===================== CHAT =====================
let chatPollInterval = null;
let lastMessageId = 0;
let currentRoom = 'general';

async function loadChat() {
  const box = document.getElementById('chat-box');
  const roomsEl = document.getElementById('chat-rooms');
  if (!box) return;

  if (chatPollInterval) { clearInterval(chatPollInterval); chatPollInterval = null; }

  // Load available rooms
  try {
    const { rooms } = await apiFetch('/api/chat/rooms');
    roomsEl.innerHTML = rooms.map(r => `
      <button class="chat-room-btn" data-room="${escapeAttr(r.id)}" style="
        text-align:left;padding:.5rem .75rem;border-radius:8px;font-size:.85rem;cursor:pointer;
        background:${r.id === currentRoom ? 'rgba(200,16,46,.25)' : 'rgba(255,255,255,.05)'};
        border:1px solid ${r.id === currentRoom ? 'rgba(200,16,46,.4)' : 'rgba(255,255,255,.08)'};
        color:#fff;width:100%;transition:background .15s;">
        ${escapeHtml(r.label)}
      </button>`).join('');

    roomsEl.querySelectorAll('.chat-room-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        currentRoom = btn.dataset.room;
        switchRoom(rooms);
      });
    });
  } catch { /* no rooms sidebar */ }

  await switchRoom(null);

  // Input listeners (attached once here, not re-cloned)
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const charCount = document.getElementById('chat-char-count');

  // Remove old listeners by replacing elements once
  const freshInput = input.cloneNode(true);
  input.parentNode.replaceChild(freshInput, input);
  const freshSend = sendBtn.cloneNode(true);
  sendBtn.parentNode.replaceChild(freshSend, sendBtn);

  const doSend = async () => {
    const inp = document.getElementById('chat-input');
    const content = inp.value.trim();
    if (!content) return;
    freshSend.disabled = true;
    try {
      const { message } = await apiFetch('/api/chat/send', {
        method: 'POST',
        body: JSON.stringify({ content, room: currentRoom }),
      });
      inp.value = '';
      if (charCount) charCount.textContent = '0 / 500';
      appendChatMessage(message, box);
      lastMessageId = message.id;
      box.scrollTop = box.scrollHeight;
    } catch (err) { showToast(err.message, 'error'); }
    finally { freshSend.disabled = false; document.getElementById('chat-input').focus(); }
  };

  freshSend.addEventListener('click', doSend);
  freshInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSend(); } });
  freshInput.addEventListener('input', e => { if (charCount) charCount.textContent = `${e.target.value.length} / 500`; });

  // Poll every 3s
  chatPollInterval = setInterval(async () => {
    if (!document.getElementById('page-chat')?.classList.contains('active')) {
      clearInterval(chatPollInterval); chatPollInterval = null; return;
    }
    try {
      const { messages } = await apiFetch(`/api/chat/messages?room=${encodeURIComponent(currentRoom)}&since=${lastMessageId}`);
      if (messages.length) {
        const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
        messages.forEach(m => appendChatMessage(m, box));
        lastMessageId = messages[messages.length - 1].id;
        if (atBottom) box.scrollTop = box.scrollHeight;
      }
    } catch { /* silent */ }
  }, 8000);
}

async function switchRoom(rooms) {
  const box = document.getElementById('chat-box');
  lastMessageId = 0;
  box.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:2rem;">Loading…</p>';

  // Update room button styles
  document.querySelectorAll('.chat-room-btn').forEach(btn => {
    const active = btn.dataset.room === currentRoom;
    btn.style.background = active ? 'rgba(200,16,46,.25)' : 'rgba(255,255,255,.05)';
    btn.style.borderColor = active ? 'rgba(200,16,46,.4)' : 'rgba(255,255,255,.08)';
  });

  try {
    const { messages } = await apiFetch(`/api/chat/history?room=${encodeURIComponent(currentRoom)}`);
    box.innerHTML = '';
    messages.forEach(m => appendChatMessage(m, box));
    if (messages.length) lastMessageId = messages[messages.length - 1].id;
    box.scrollTop = box.scrollHeight;
  } catch (err) {
    box.innerHTML = `<p style="color:#f87171;text-align:center;">${escapeHtml(err.message)}</p>`;
  }
}

function appendChatMessage(m, box) {
  const isMe = currentUser && m.name === currentUser.name;
  const initials = m.name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  const avatarHtml = m.avatar
    ? `<div style="width:32px;height:32px;border-radius:50%;background:center/cover url('${escapeAttr(m.avatar)}');flex-shrink:0;"></div>`
    : `<div style="width:32px;height:32px;border-radius:50%;background:${m.is_admin ? '#7a2a00' : 'rgba(200,16,46,.2)'};display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;color:${m.is_admin ? '#f5a623' : 'var(--clr-primary)'};flex-shrink:0;">${escapeHtml(initials)}</div>`;
  const time = new Date(m.created_at + 'Z').toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const div = document.createElement('div');
  div.style.cssText = `display:flex;gap:.6rem;align-items:flex-start;${isMe ? 'flex-direction:row-reverse;' : ''}`;
  div.innerHTML = `
    ${avatarHtml}
    <div style="max-width:70%;${isMe ? 'align-items:flex-end;' : ''}display:flex;flex-direction:column;gap:.2rem;">
      <div style="font-size:.72rem;color:var(--clr-muted);${isMe ? 'text-align:right;' : ''}">
        ${m.is_admin ? '<span style="color:#f5a623;font-weight:700;">⭐ Director</span> · ' : ''}${escapeHtml(m.name)} · ${time}
      </div>
      <div style="background:${isMe ? 'rgba(200,16,46,.25)' : 'rgba(255,255,255,.06)'};padding:.5rem .75rem;border-radius:${isMe ? '12px 4px 12px 12px' : '4px 12px 12px 12px'};font-size:.9rem;line-height:1.5;word-break:break-word;">
        ${escapeHtml(m.content)}
      </div>
    </div>
    ${currentUser?.is_admin && !isMe ? `<button onclick="deleteMsg(${m.id},this.closest('div[style]'))" style="font-size:.65rem;color:#f87171;background:none;border:none;cursor:pointer;opacity:.5;margin-top:.3rem;" title="Delete">✕</button>` : ''}`;
  box.appendChild(div);
}

async function deleteMsg(id, el) {
  try {
    await apiFetch(`/api/chat/messages/${id}`, { method: 'DELETE' });
    el?.remove();
  } catch (err) { showToast(err.message, 'error'); }
}

// ===================== ADMIN — ANALYTICS =====================
let analyticsCharts = [];
async function loadAnalytics() {
  const container = document.getElementById('analytics-content');
  if (!container) return;
  container.innerHTML = '<p style="color:var(--clr-muted);text-align:center;padding:1rem;">Loading…</p>';

  try {
    const [{ signups, certs, totalUsers, totalCerts, totalRevenue }, { certs: expiring }] = await Promise.all([
      apiFetch('/api/admin/analytics'),
      apiFetch('/api/admin/expiring-certs'),
    ]);

    // Destroy previous charts
    analyticsCharts.forEach(c => c.destroy());
    analyticsCharts = [];

    const cardStyle = 'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:1.25rem;';

    const expiryRows = expiring.length === 0
      ? '<p style="color:var(--clr-muted);font-size:.88rem;">No certs expiring in the next 90 days.</p>'
      : `<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:.85rem;">
          <thead><tr style="color:var(--clr-muted);text-align:left;">
            <th style="padding:.4rem .6rem;">Judge</th><th>State</th><th>Level</th><th>Expires</th><th>Days Left</th>
          </tr></thead><tbody>
          ${expiring.map(c => {
            const color = c.days_left <= 0 ? '#f87171' : c.days_left <= 30 ? '#f5a623' : '#4cd964';
            return `<tr style="border-top:1px solid rgba(255,255,255,.06);">
              <td style="padding:.4rem .6rem;">${escapeHtml(c.name)}</td>
              <td>${c.state || '—'}</td>
              <td>Level ${c.level}</td>
              <td>${escapeHtml(c.expires_at)}</td>
              <td style="color:${color};font-weight:700;">${c.days_left <= 0 ? 'Expired' : c.days_left + 'd'}</td>
            </tr>`;
          }).join('')}
          </tbody></table></div>`;

    container.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:1rem;margin-bottom:1.5rem;">
        <div style="${cardStyle}text-align:center;"><div style="font-size:2rem;font-weight:800;font-family:var(--font-heading);color:var(--clr-primary);">${totalUsers}</div><div style="font-size:.82rem;color:var(--clr-muted);">Total Judges</div></div>
        <div style="${cardStyle}text-align:center;"><div style="font-size:2rem;font-weight:800;font-family:var(--font-heading);color:#4cd964;">${totalCerts}</div><div style="font-size:.82rem;color:var(--clr-muted);">Certifications Granted</div></div>
        <div style="${cardStyle}text-align:center;"><div style="font-size:2rem;font-weight:800;font-family:var(--font-heading);color:#f5a623;">$${(totalRevenue/100).toFixed(0)}</div><div style="font-size:.82rem;color:var(--clr-muted);">Total Revenue</div></div>
        <div style="${cardStyle}text-align:center;"><div style="font-size:2rem;font-weight:800;font-family:var(--font-heading);color:#f87171;">${expiring.filter(c=>c.days_left<=30&&c.days_left>=0).length}</div><div style="font-size:.82rem;color:var(--clr-muted);">Expiring in 30 days</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1.5rem;">
        <div style="${cardStyle}"><h4 style="margin-bottom:1rem;font-size:.9rem;">Signups per Month</h4><canvas id="chart-signups" height="160"></canvas></div>
        <div style="${cardStyle}"><h4 style="margin-bottom:1rem;font-size:.9rem;">Certifications per Month</h4><canvas id="chart-certs" height="160"></canvas></div>
      </div>
      <div style="${cardStyle}margin-bottom:1.5rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
          <h4 style="font-size:.9rem;">Certifications Expiring (Next 90 Days)</h4>
          <button id="export-csv-btn" class="btn-grant" style="font-size:.8rem;padding:.35rem .8rem;">⬇ Export CSV</button>
        </div>
        ${expiryRows}
      </div>`;

    // Signups chart
    const sCtx = document.getElementById('chart-signups')?.getContext('2d');
    if (sCtx) {
      analyticsCharts.push(new Chart(sCtx, {
        type: 'bar',
        data: {
          labels: signups.map(s => s.month),
          datasets: [{ label: 'Signups', data: signups.map(s => s.count), backgroundColor: 'rgba(200,16,46,.6)', borderRadius: 4 }],
        },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#888', stepSize: 1 }, grid: { color: 'rgba(255,255,255,.05)' } } } },
      }));
    }

    // Certs chart
    const cCtx = document.getElementById('chart-certs')?.getContext('2d');
    if (cCtx) {
      analyticsCharts.push(new Chart(cCtx, {
        type: 'bar',
        data: {
          labels: certs.map(c => c.month),
          datasets: [{ label: 'Certs', data: certs.map(c => c.count), backgroundColor: 'rgba(76,217,100,.5)', borderRadius: 4 }],
        },
        options: { plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.05)' } }, y: { ticks: { color: '#888', stepSize: 1 }, grid: { color: 'rgba(255,255,255,.05)' } } } },
      }));
    }

    document.getElementById('export-csv-btn')?.addEventListener('click', () => {
      window.location.href = _API + '/api/admin/export-csv';
    });

  } catch (e) {
    container.innerHTML = '<p style="color:#f87171;">Could not load analytics.</p>';
  }
}

// ===================== VERIFY MODAL SETUP =====================
(function initVerifyModal() {
  document.getElementById('verify-submit-btn')?.addEventListener('click', submitVerifyCode);
  document.getElementById('verify-code-input')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') submitVerifyCode();
  });
})();
