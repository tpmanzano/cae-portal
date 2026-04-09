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

  // Sidebar
  const collapsed = localStorage.getItem('sidebar-collapsed') === 'true';
  if (collapsed) {
    document.getElementById('sidebar').classList.add('collapsed');
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
