import { API_BASE_URL } from './config.js?v=1';

const get = (id) => document.getElementById(id);
const token = sessionStorage.getItem('pakping_dashboard_token') || '';
const roles = { owner: 'Owner', ceo: 'CEO', reception: 'Receptionist', it_support: 'IT Support', housekeeper: 'Housekeeper' };
let page = 1;
const pageSize = 20;
let total = 0;
let version = 0;
let authorized = false;
let search = '';
let role = '';
let controller;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function deny(message) {
  authorized = false;
  document.querySelector('.app-shell').hidden = false;
  get('log-account-actions').hidden = true;
  get('log-page-actions').hidden = true;
  get('log-navigation').hidden = true;
  version++;
  controller?.abort();
  get('log-panel').hidden = true;
  get('log-table').replaceChildren();
  get('log-access').hidden = false;
  get('log-access').replaceChildren();
  const text = document.createElement('p');
  text.textContent = message;
  const link = document.createElement('a');
  link.className = 'button primary';
  link.href = './index.html';
  link.textContent = 'กลับ Dashboard / เข้าสู่ระบบ';
  get('log-access').append(text, link);
}

async function request(path, signal) {
  const response = await fetch(`${API_BASE_URL}${path}`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal });
  const body = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    if (response.status === 401) sessionStorage.removeItem('pakping_dashboard_token');
    deny(response.status === 401 ? 'กรุณาเข้าสู่ระบบใหม่' : 'หน้านี้เปิดให้เฉพาะ CEO และ Owner');
  }
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'โหลดประวัติไม่สำเร็จ กรุณาลองอีกครั้ง');
  return body;
}

function setBusy(busy) {
  get('log-panel').setAttribute('aria-busy', String(busy));
  get('log-refresh').disabled = busy;
  get('log-refresh').textContent = busy ? 'กำลังรีเฟรช...' : 'รีเฟรช';
  get('log-prev').disabled = busy || page <= 1;
  get('log-next').disabled = busy || page * pageSize >= total;
}

function timeLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(date);
}

async function load() {
  if (!authorized) return;
  controller?.abort();
  controller = new AbortController();
  const current = ++version;
  setBusy(true);
  get('log-status').textContent = 'กำลังโหลดประวัติ…';
  get('log-table').replaceChildren();
  try {
    const params = new URLSearchParams({ page, page_size: pageSize, search, role });
    const result = await request(`/dashboard/worker-logs?${params}`, controller.signal);
    if (current !== version || !authorized) return;
    total = result.total;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    if (page > pages) { page = pages; return load(); }
    get('log-status').textContent = result.records.length ? '' : 'ไม่พบประวัติที่ตรงกับตัวกรอง';
    if (result.records.length) {
      get('log-table').innerHTML = `<table class="review-table">
        <thead><tr><th scope="col">วันเวลา</th><th scope="col">พนักงาน</th><th scope="col">Role</th><th scope="col">Description</th></tr></thead>
        <tbody>${result.records.map((row) => `<tr>
          <td data-label="วันเวลา"><span>${esc(timeLabel(row.created_at))}</span></td>
          <td data-label="พนักงาน"><div>${esc(row.worker_name || '—')}<small class="log-worker-id">${esc(row.userId || '')}</small></div></td>
          <td data-label="Role" class="log-role"><span>${esc(roles[row.role] || row.role || '—')}</span></td>
          <td data-label="Description" class="log-description"><span>${esc(row.description || '—')}</span></td>
        </tr>`).join('')}</tbody></table>`;
    }
    get('log-count').textContent = total ? `แสดง ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} จาก ${total} รายการ` : '0 รายการ';
    get('log-page').textContent = `หน้า ${page} / ${pages}`;
  } catch (error) {
    if (current === version && authorized && error.name !== 'AbortError') {
      get('log-status').textContent = error.message;
      get('log-count').textContent = '';
      get('log-page').textContent = '';
      total = 0;
    }
  } finally {
    if (current === version) setBusy(false);
  }
}

get('log-filter').addEventListener('submit', (event) => {
  event.preventDefault();
  search = get('log-search').value.trim();
  role = get('log-role').value;
  page = 1;
  load();
});
get('log-refresh').addEventListener('click', load);
get('log-reset').addEventListener('click', () => { get('log-filter').reset(); search = ''; role = ''; page = 1; load(); });
get('log-prev').addEventListener('click', () => { if (page > 1) { page--; load(); } });
get('log-next').addEventListener('click', () => { if (page * pageSize < total) { page++; load(); } });
get('logout-button').addEventListener('click', () => {
  authorized = false;
  version++;
  controller?.abort();
  get('log-table').replaceChildren();
  sessionStorage.removeItem('pakping_dashboard_token');
  fetch(`${API_BASE_URL}/dashboard/logout`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, keepalive: true,
  }).catch(() => {});
  window.location.replace('./index.html');
});

if (!token) {
  deny('กรุณาเข้าสู่ระบบด้วยบัญชี CEO หรือ Owner');
} else {
  try {
    const account = await request('/dashboard/me');
    if (!['ceo', 'owner'].includes(account.role)) {
      deny('หน้านี้เปิดให้เฉพาะ CEO และ Owner');
    } else {
      authorized = true;
      document.querySelector('.app-shell').hidden = false;
      get('log-account-actions').hidden = false;
      get('log-page-actions').hidden = false;
      get('log-navigation').hidden = false;
      get('log-reservation-link').hidden = account.role !== 'owner';
      get('log-support-link').hidden = account.role !== 'owner';
      get('log-account-name').textContent = `${account.name} · ${roles[account.role]}`;
      get('log-access').hidden = true;
      get('log-panel').hidden = false;
      await load();
    }
  } catch (error) {
    deny(error.message);
  }
}
