export function createWorkerLog({ request, getAccount, getPageSize }) {
  const get = (id) => document.getElementById(id);
  const isAuthorized = () => getAccount()?.role === 'it_support';
  const roles = { owner: 'Owner', ceo: 'CEO', reception: 'Receptionist', it_support: 'IT Support', housekeeper: 'Housekeeper' };
  let page = 1;
  let pageSize = getPageSize();
  let total = 0;
  let version = 0;
  let search = '';
  let role = '';
  let controller;
  let busy = false;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

  function setBusy(value) {
    busy = value;
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
    if (!isAuthorized()) return;
    controller?.abort();
    controller = new AbortController();
    const current = ++version;
    setBusy(true);
    get('log-status').textContent = 'กำลังโหลดประวัติ…';
    get('log-table').replaceChildren();
    try {
      const params = new URLSearchParams({ page, page_size: pageSize, search, role });
      const result = await request(`/dashboard/worker-logs?${params}`, { cache: 'no-store', signal: controller.signal });
      if (current !== version || !isAuthorized()) return;
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
      if (current === version && isAuthorized() && error.name !== 'AbortError') {
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

  return {
    load,
    refresh() { if (!busy) return load(); },
    resize() {
      const nextPageSize = getPageSize();
      if (pageSize === nextPageSize) return;
      page = Math.floor((page - 1) * pageSize / nextPageSize) + 1;
      pageSize = nextPageSize;
      return load();
    },
    reset() {
      version++;
      controller?.abort();
      page = 1; total = 0; search = ''; role = '';
      get('log-filter').reset();
      for (const id of ['log-table', 'log-status', 'log-count', 'log-page']) get(id).replaceChildren();
      setBusy(false);
    },
  };
}
