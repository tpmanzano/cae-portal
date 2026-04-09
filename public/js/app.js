// ── Report Data Preload ──
// Fetches report data on any page load so Reports pages render instantly
(function preloadReportData() {
  const CACHE_KEY = 'cae_reports_cache';
  const CACHE_TTL = 5 * 60 * 1000;
  try {
    const cached = sessionStorage.getItem(CACHE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Date.now() - parsed.timestamp < CACHE_TTL) return; // still fresh
    }
  } catch(e) {}
  // Fetch in background — don't block page load
  Promise.all([
    fetch('/api/reports/open-escrows').then(r => r.ok ? r.json() : null),
    fetch('/api/reports/pipeline-summary').then(r => r.ok ? r.json() : null),
    fetch('/api/reports/officer-workload').then(r => r.ok ? r.json() : null),
  ]).then(([escrows, pipeline, officers]) => {
    if (escrows && pipeline && officers) {
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          data: { escrows: escrows.escrows, pipeline, officers },
          timestamp: Date.now()
        }));
      } catch(e) {}
    }
  }).catch(() => {}); // silent — don't break the page if reports API is down
})();

// ── Refresh Report Data (called from refresh button) ──
function refreshReportData() {
  sessionStorage.removeItem('cae_reports_cache');
  if (window.location.pathname.startsWith('/reports')) {
    window.location.reload();
  } else {
    // Re-preload silently
    Promise.all([
      fetch('/api/reports/open-escrows').then(r => r.ok ? r.json() : null),
      fetch('/api/reports/pipeline-summary').then(r => r.ok ? r.json() : null),
      fetch('/api/reports/officer-workload').then(r => r.ok ? r.json() : null),
    ]).then(([escrows, pipeline, officers]) => {
      if (escrows && pipeline && officers) {
        try {
          sessionStorage.setItem('cae_reports_cache', JSON.stringify({
            data: { escrows: escrows.escrows, pipeline, officers },
            timestamp: Date.now()
          }));
        } catch(e) {}
      }
    }).catch(() => {});
  }
}

// ── Theme Toggle ──
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('mpower-theme', next);
}

// ── Sidebar Toggle ──
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('collapsed');
  localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
}

// ── Restore State ──
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  const savedTheme = localStorage.getItem('mpower-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Sidebar — always start expanded (collapsed state not persisted until UX is stable)
  localStorage.removeItem('sidebar-collapsed');
});

// ── Account Menu ──
function toggleAccountMenu() {
  const dropdown = document.getElementById('account-dropdown');
  dropdown.classList.toggle('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const menu = document.querySelector('.account-menu');
  const dropdown = document.getElementById('account-dropdown');
  if (menu && dropdown && !menu.contains(e.target)) {
    dropdown.classList.remove('open');
  }
});

// Load user info
document.addEventListener('DOMContentLoaded', async () => {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    if (res.ok) {
      const user = await res.json();
      const nameEl = document.getElementById('account-name');
      const emailEl = document.getElementById('account-email');
      const avatarEl = document.getElementById('account-avatar');

      if (nameEl) nameEl.textContent = user.name || 'User';
      if (emailEl) emailEl.textContent = user.email || '';
      if (avatarEl) {
        if (user.photo) {
          avatarEl.style.backgroundImage = `url(${user.photo})`;
          avatarEl.textContent = '';
        } else {
          avatarEl.textContent = (user.name || user.email || 'U').charAt(0).toUpperCase();
        }
      }

      // Admin link — only visible to Tom
      const adminEmails = ['tpmanzano@gmail.com', 'tom@mpoweranalytics.com'];
      if (adminEmails.includes((user.email || '').toLowerCase())) {
        const nav = document.querySelector('.sidebar-nav');
        if (nav && !document.getElementById('admin-nav-link')) {
          const adminLink = document.createElement('a');
          adminLink.href = '/admin';
          adminLink.className = 'nav-item' + (window.location.pathname === '/admin' ? ' active' : '');
          adminLink.id = 'admin-nav-link';
          adminLink.innerHTML = '<svg class="nav-icon" viewBox="0 0 24 24"><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg><span>Admin</span>';
          nav.appendChild(adminLink);
        }
      }
    }
  } catch (e) {
    // Not logged in or API unavailable
  }
});

// Nav item nested toggle
document.querySelectorAll('.nav-item[data-toggle]').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const target = document.getElementById(item.dataset.toggle);
    const chevron = item.querySelector('.nav-toggle');
    if (target) {
      target.classList.toggle('open');
      if (chevron) chevron.classList.toggle('open');
    }
  });
});
