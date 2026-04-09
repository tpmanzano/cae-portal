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
  // Also toggle on app container for reliable CSS targeting
  const app = document.querySelector('.app');
  if (app) app.classList.toggle('sidebar-collapsed', sidebar.classList.contains('collapsed'));
  localStorage.setItem('sidebar-collapsed', sidebar.classList.contains('collapsed'));
}

// ── Restore State ──
document.addEventListener('DOMContentLoaded', () => {
  // Theme
  const savedTheme = localStorage.getItem('mpower-theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  // Sidebar — default to expanded
  const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  if (collapsed) {
    const sidebar = document.getElementById('sidebar');
    const app = document.querySelector('.app');
    if (sidebar) sidebar.classList.add('collapsed');
    if (app) app.classList.add('sidebar-collapsed');
  }
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
    const res = await fetch('/api/me');
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
