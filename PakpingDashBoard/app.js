import { createWorkerLog } from './worker-log.js?v=7';

export const API_BASE_URL = 'https://evaluations-closer-children-newbie.trycloudflare.com';

function initializeDashboard() {
  const reservationMobile = window.matchMedia('(max-width: 900px)');
  const itemsPerPage = () => reservationMobile.matches ? 2 : 5;
  const analyticsMobile = window.matchMedia('(max-width: 700px)');
  const analyticsNarrow = window.matchMedia('(max-width: 480px)');
  const root = document.querySelector('#app');
  let sessionToken = sessionStorage.getItem('pakping_dashboard_token') || '';
  let account = null;
  const workerLog = createWorkerLog({ request, getAccount: () => account, getPageSize: itemsPerPage });
  let supportUsers = [];
  let supportLoading = false;
  let renderBusinessAnalytics = null;
  let analyticsLoadError = '';
  import('./analytics.js?v=12').then((module) => {
    renderBusinessAnalytics = module.renderAnalytics;
    renderAnalytics();
  }).catch((error) => {
    console.error('โหลดสถิติธุรกิจไม่สำเร็จ', error);
    analyticsLoadError = 'โหลดส่วนสถิติธุรกิจไม่สำเร็จ กรุณารีเฟรชหน้า';
    renderAnalytics();
  });

  const state = {
    reviews: [], loading: false, error: '', selectedId: null, selectedRoomNumber: null,
    confirmRoomAction: null,
    rooms: [], roomsLoading: false, roomsLoaded: false, roomsError: '',
    visibleRoomStatuses: new Set(['Available', 'Busy', 'Maintenance', 'Booked']),
    slipUrl: '', slipError: '', slipLoading: false,
    refundBookingId: null, refundConfirmed: false,
    declineDescription: '', busy: false, toast: '', sortNewest: true,
    roomSearch: '', roomPage: 1, reservationSearch: '', pendingPage: 1,
    approvedSearch: '', approvedPage: 1, approvedSort: 'date',
    approvedDateAscending: true, approvedAmountDescending: true,
    visibleStatuses: new Set(['pending', 'paid', 'ready', 'refund_pending', 'refunded', 'inhouse', 'decline', 'expired', 'cancel', 'missing', 'success']),
    analyticsRange: 'today', analyticsForecastDays: 7,
    analyticsSummaryPage: 1, analyticsChartPage: 1,
    balanceConfirmed: new Set(),
  };

  const statusLabels = {
    pending: 'ยังไม่จ่าย', paid: 'จ่ายแล้ว', ready: 'อนุมัติแล้ว', inhouse: 'กำลังเข้าพัก', expired: 'หมดอายุ',
    decline: 'ปฏิเสธแล้ว', cancel: 'ยกเลิกแล้ว', missing: 'ไม่เข้าพัก',
    success: 'เช็คเอาต์แล้ว',
    refund_pending: 'คืนเงิน', refunded: 'คืนเงินแล้ว',
  };

  const roomStatusLabels = {
    Available: 'Available', Booked: 'Booked', Busy: 'Busy', Maintenance: 'Maintenance',
  };

  const refundBankLabels = {
    promptpay: 'พร้อมเพย์', BBL: 'กรุงเทพ', KBANK: 'กสิกรไทย', KTB: 'กรุงไทย',
    SCB: 'ไทยพาณิชย์', BAY: 'กรุงศรีอยุธยา', TTB: 'ทหารไทยธนชาต', GSB: 'ออมสิน',
    BAAC: 'ธ.ก.ส.', UOB: 'ยูโอบี', CIMBT: 'ซีไอเอ็มบี ไทย', KKP: 'เกียรตินาคินภัทร',
    TISCO: 'ทิสโก้', LH: 'แลนด์ แอนด์ เฮ้าส์', ICBC: 'ไอซีบีซี (ไทย)', GHB: 'อาคารสงเคราะห์',
  };

  const money = new Intl.NumberFormat('th-TH', {
    style: 'currency', currency: 'THB', maximumFractionDigits: 2,
  });

  const number = new Intl.NumberFormat('th-TH');

  let toastTimer;
  let roomRequestVersion = 0;

  function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function bangkokDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('th-TH', {
      dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok',
    }).format(date);
  }

  function matchesSearch(query, values) {
    const term = query.trim().toLocaleLowerCase('th');
    return !term || values.some((value) => String(value ?? '').toLocaleLowerCase('th').includes(term));
  }

  function matchesReservationSearch(row, query) {
    return matchesSearch(query, [row.customer_name, row.room_number, row.booking_id,
      row.check_in, row.check_out, row.status, statusLabels[row.status]]);
  }

  function paginationControls(pageCount, page, group, label) {
    const start = Math.max(1, Math.min(page - 1, pageCount - 3));
    const pageButton = (target, text, description, className, disabled = false) =>
      `<button class="${className}" type="button" data-action="pagination-page" data-group="${group}" data-value="${target}" aria-label="${description}" title="${description}" ${disabled ? 'disabled' : ''} ${target === page && className === 'pagination-number' ? 'aria-current="page"' : ''}>${text}</button>`;
    const numbers = Array.from({ length: Math.min(4, pageCount) }, (_, index) => {
      const target = start + index;
      return pageButton(target, target, `${label} หน้าที่ ${target}`, 'pagination-number');
    }).join('');
    return `<span class="pagination-status" aria-live="polite">หน้า ${page} จาก ${pageCount}</span>
      <div class="pagination-controls">
        <div class="pagination-navigation">
          ${pageButton(page - 1, '‹', 'หน้าก่อนหน้า', 'pagination-step', page === 1)}
          ${numbers}
          ${pageButton(page + 1, '›', 'หน้าถัดไป', 'pagination-step', page === pageCount)}
        </div>
        <form class="pagination-jump" data-page-jump="${group}">
          <input type="number" min="1" max="${pageCount}" step="1" required inputmode="numeric" value="${page}" aria-label="ไปหน้าที่ 1 ถึง ${pageCount}">
          <button type="submit" aria-label="ไปยังหน้าที่กรอก">ไป</button>
        </form>
        ${pageButton(pageCount, '»', 'ไปหน้าสุดท้าย', 'pagination-last', page === pageCount)}
      </div>`;
  }

  function goToPage(group, page) {
    const pager = root.querySelector(`.pagination-bar[data-page-group="${group}"]`);
    const pageCount = Number(pager?.dataset.pageCount);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) return;
    if (group === 'rooms') {
      state.roomPage = page;
      renderRoomStatuses();
      root.querySelector('#room-status-content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (group === 'summary' || group === 'charts') {
      state[group === 'summary' ? 'analyticsSummaryPage' : 'analyticsChartPage'] = page;
      applyAnalyticsPagination();
      root.querySelector(group === 'summary' ? '.analytics-summary' : '.analytics-charts')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (group === 'pending' || group === 'history') {
      state[group === 'pending' ? 'pendingPage' : 'approvedPage'] = page;
      render({ skipAnalytics: true });
      root.querySelector(`#${group}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    root.querySelector(`.pagination-bar[data-page-group="${group}"] [aria-current="page"]`)?.focus({ preventScroll: true });
  }

  function renderAnalytics() {
    if (!account || !roleTabs[account.role]?.includes('overview')) return;
    if (analyticsLoadError) {
      root.querySelector('#analytics-content').innerHTML = `<div class="empty" role="alert"><p>${esc(analyticsLoadError)}</p></div>`;
      return;
    }
    if (!renderBusinessAnalytics) {
      root.querySelector('#analytics-content').innerHTML = '<div class="empty"><p>กำลังโหลดข้อมูลสถิติ</p></div>';
      return;
    }
    try {
      renderBusinessAnalytics(state, root, { esc, money, number });
      applyAnalyticsPagination();
    } catch (error) {
      console.error('แสดงสถิติธุรกิจไม่สำเร็จ', error);
      root.querySelector('#analytics-content').innerHTML = '<div class="empty" role="alert"><p>แสดงสถิติธุรกิจไม่สำเร็จ กรุณารีเฟรชหน้า</p></div>';
    }
  }

  function paginateAnalytics(container, group, pageSize, stateKey, label) {
    if (!container) return;
    const items = [...container.children];
    let pager = container.nextElementSibling;
    if (!pager?.matches(`.analytics-pagination[data-group="${group}"]`)) pager = null;

    if (!analyticsMobile.matches || items.length <= pageSize) {
      items.forEach((item) => { item.hidden = false; });
      pager?.remove();
      return;
    }

    const pageCount = Math.ceil(items.length / pageSize);
    state[stateKey] = Math.min(Math.max(state[stateKey], 1), pageCount);
    items.forEach((item, index) => {
      item.hidden = Math.floor(index / pageSize) + 1 !== state[stateKey];
    });

    if (pager?.dataset.pageCount !== String(pageCount)) {
      pager?.remove();
      pager = document.createElement('nav');
      pager.className = 'analytics-pagination pagination-bar';
      pager.dataset.group = group;
      pager.setAttribute('aria-label', label);
      container.after(pager);
    }
    pager.dataset.pageGroup = group;
    pager.dataset.pageCount = String(pageCount);
    pager.innerHTML = paginationControls(pageCount, state[stateKey], group, label);
  }

  function applyAnalyticsPagination() {
    const content = root.querySelector('#analytics-content');
    paginateAnalytics(content.querySelector('.analytics-summary'), 'summary', analyticsNarrow.matches ? 1 : 2, 'analyticsSummaryPage', 'ข้อมูลสรุป');
    paginateAnalytics(content.querySelector('.analytics-charts'), 'charts', 1, 'analyticsChartPage', 'กราฟและข้อมูล');
  }

  analyticsMobile.addEventListener('change', applyAnalyticsPagination);
  analyticsNarrow.addEventListener('change', applyAnalyticsPagination);

  async function request(path, options) {
    const sentToken = sessionToken;
    const headers = new Headers(options?.headers || {});
    if (sentToken) headers.set('Authorization', `Bearer ${sentToken}`);
    let response;
    try {
      response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });
    } catch {
      throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง');
    }
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && path !== '/dashboard/login' && sentToken === sessionToken) showAuth();
    if (!response.ok) throw new Error(typeof body.detail === 'string'
      ? body.detail : `ดำเนินการไม่สำเร็จ (รหัส ${response.status})`);
    return body;
  }

const roleTabs = {
    owner: ['overview', 'reservation', 'support'],
    ceo: ['overview'],
    reception: ['reservation'],
    it_support: ['support', 'worker-log'],
};
  const roleLabels = { owner: 'Owner', ceo: 'CEO', reception: 'Receptionist', it_support: 'IT Support' };

  function showAuth() {
    roomRequestVersion++;
    sessionToken = '';
    account = null;
    workerLog.reset();
    root.querySelector('#worker-log-tab').hidden = true;
    root.querySelector('#worker-log-panel').hidden = true;
    supportUsers = [];
    sessionStorage.removeItem('pakping_dashboard_token');
    root.querySelector('.app-shell').hidden = true;
    root.querySelector('#login-screen').hidden = false;
    state.reviews = [];
    state.rooms = [];
    state.loading = false;
    state.roomsLoading = false;
    state.roomsLoaded = false;
    state.error = '';
    state.roomsError = '';
    state.userId = {};
    state.selectedId = null;
    state.selectedRoomNumber = null;
    state.confirmRoomAction = null;
    state.refundBookingId = null;
    state.refundConfirmed = false;
    for (const selector of ['#analytics-content', '#room-status-content', '#pending-content',
      '#history-content', '#modal-root']) {
      root.querySelector(selector).replaceChildren();
    }
    root.querySelector('#login-password').value = '';
    root.querySelector('#login-status').hidden = true;
    root.querySelector('#profile-panel').hidden = true;
    root.querySelector('#support-users').replaceChildren();
    resetSupportForm();
    root.querySelector('#profile-password-form').reset();
  }

  function showDashboard(profile) {
    account = profile;
    root.querySelector('#login-screen').hidden = true;
    root.querySelector('.app-shell').hidden = false;
    root.querySelector('#account-name').textContent = `${profile.name} · ${roleLabels[profile.role] || profile.role}`;
    root.querySelector('#profile-name').textContent = profile.name;
    root.querySelector('#profile-role').textContent = roleLabels[profile.role] || profile.role;
    root.querySelector('#profile-phone').textContent = profile.phone || 'ยังไม่ระบุ';
    const ownerOption = root.querySelector('#support-user-form select[name="role"] option[value="owner"]');
    ownerOption.hidden = profile.role !== 'owner';
    ownerOption.disabled = profile.role !== 'owner';
    for (const name of ['overview', 'reservation', 'support', 'worker-log']) {
      root.querySelector(`#${name}-tab`).hidden = !roleTabs[profile.role]?.includes(name);
    }
    syncTabFromHash();
    render();
    refreshAll();
  }

  function supportError(message = '') {
    const box = root.querySelector('#support-error');
    box.textContent = message;
    box.hidden = !message;
  }

  function resetSupportForm() {
    const form = root.querySelector('#support-user-form');
    form.reset();
    form.elements.namedItem('worker_id').value = '';
    root.querySelector('#support-save').textContent = 'สร้างบัญชี';
    root.querySelector('#support-cancel').hidden = true;
    supportError();
  }

  function renderSupportUsers() {
    const container = root.querySelector('#support-users');
    if (!supportUsers.length) {
      container.innerHTML = '<p class="support-empty">ยังไม่มีบัญชีพนักงาน</p>';
      return;
    }
    container.innerHTML = `<div class="support-users-list">${supportUsers.map((user) => `
      <div class="support-user-row">
        <div><strong>${esc(user.worker_name)}</strong><span>${esc(roleLabels[user.role] || user.role)} · ${esc(user.phone || 'ไม่มีเบอร์โทร')}</span></div>
        <div class="support-user-actions">
          <button class="button small" type="button" data-support-action="edit" data-id="${esc(user.id)}">แก้ไข</button>
          <button class="button small" type="button" data-support-action="reset" data-id="${esc(user.id)}">รีเซ็ตรหัสผ่าน</button>
          <button class="button small danger" type="button" data-support-action="delete" data-id="${esc(user.id)}" ${String(user.id) === String(account?.id) ? 'disabled title="ลบบัญชีตนเองไม่ได้"' : ''}>ลบ</button>
        </div>
      </div>`).join('')}</div>`;
  }

  async function loadSupportUsers() {
    if (!account || !roleTabs[account.role]?.includes('support') || supportLoading) return;
    const token = sessionToken;
    supportLoading = true;
    supportError();
    root.querySelector('#support-refresh').disabled = true;
    try {
      const result = await request('/dashboard/users');
      if (token !== sessionToken) return;
      supportUsers = result.users || [];
      renderSupportUsers();
    } catch (error) {
      if (token === sessionToken) supportError(error.message);
    } finally {
      supportLoading = false;
      root.querySelector('#support-refresh').disabled = false;
    }
  }

  function canRoomAction(action, row) {
    if (state.busy || !row || row.refund_timestamp) return false;
    if (action === 'checkin') {
      return row.status === 'ready' && !row.arrive_at
        && ['full_payment', 'partial_deposit'].includes(row.payment_method)
        && (row.payment_method !== 'partial_deposit' || state.balanceConfirmed.has(String(row.booking_id)))
        && ['Available', 'Booked', 'Maintenance'].includes(row.room_status);
    }
    if (action === 'checkout') {
      return row.status === 'inhouse' && Boolean(row.arrive_at)
        && !row.out_at && row.room_status === 'Busy';
    }
    return false;
  }

  function reviewRow(row, index, showRoomActions = false) {
    const initials = String(row.customer_name || '?').split(/\s+/)
      .map((part) => part[0]).slice(0, 2).join('').toUpperCase();
    const palette = ['peach', 'purple', 'blue', 'green', 'pink', 'sand'];
    const isPartial = row.payment_method === 'partial_deposit';
    const methodKnown = ['full_payment', 'partial_deposit'].includes(row.payment_method);
    const balance = Math.max(0, Number(row.full_amount || 0) - Number(row.amount || 0));
    const balanceConfirmed = state.balanceConfirmed.has(String(row.booking_id));
    const paymentMethodCell = showRoomActions
      ? `<td data-label="วิธีชำระ"><div class="payment-method-cell">
          <span>${isPartial ? 'มัดจำ' : methodKnown ? 'เต็มจำนวน' : 'ไม่ทราบวิธีชำระ'}</span>
          ${isPartial ? `<small>คงเหลือ ${esc(money.format(balance))}</small>` : ''}
          ${isPartial && row.status === 'ready' && !row.arrive_at && !row.refund_timestamp ? `<label class="balance-confirmation">
            <input type="checkbox" data-balance-confirm="${esc(row.booking_id)}" ${balanceConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''}>
            <span>รับเงินส่วนที่เหลือแล้ว</span>
          </label>` : ''}
        </div></td>` : '';
    const roomActions = showRoomActions
      ? `<div class="room-actions">
          <button class="button small" type="button" data-action="checkin" data-value="${esc(row.booking_id)}" ${canRoomAction('checkin', row) ? '' : 'disabled'} ${isPartial && !balanceConfirmed ? 'title="ยืนยันรับเงินส่วนที่เหลือก่อนเช็กอิน"' : ''}>เช็คอิน</button>
          <button class="button small" type="button" data-action="checkout" data-value="${esc(row.booking_id)}" ${canRoomAction('checkout', row) ? '' : 'disabled'}>เช็คเอาต์</button>
        </div>` : '';
    return `<tr>
      <td data-label="ชื่อผู้จอง"><div class="review-guest">
        <span class="avatar ${palette[index % palette.length]}">${esc(initials)}</span>
        <span><strong>${esc(row.customer_name)}</strong></span>
      </div></td>
      <td data-label="ห้อง"><strong>${esc(row.room_number)}</strong></td>
      <td data-label="ยอดชำระ"><div class="payment-amounts"><strong>${esc(money.format(Number(row.amount) || 0))}</strong><br><small>ยอดเต็ม ${esc(money.format(Number(row.full_amount) || 0))}</small>
        ${row.refund_timestamp ? `<div class="refund-request-details"><strong>${row.refund_completed_at ? 'คืนเงินแล้ว' : 'ขอคืน'} ${esc(row.refund_value)}%</strong><small>${esc(money.format((Number(row.amount) || 0) * Number(row.refund_value) / 100))}</small><small>ส่งคำขอ ${esc(bangkokDateTime(row.refund_timestamp))}</small>${row.refund_completed_at ? `<small>โอนคืนแล้ว ${esc(bangkokDateTime(row.refund_completed_at))}</small>` : ''}</div>` : ''}
      </div></td>
      ${paymentMethodCell}
      <td data-label="วันเข้า"><div class="checkin-cell"><span>${esc(row.check_in || '—')}</span>${roomActions}</div></td>
      <td data-label="วันออก">${esc(row.check_out || '—')}</td>
      <td data-label="สถานะ"><span class="review-status review-status-${esc(row.status)}">${esc(statusLabels[row.status] || row.status)}</span></td>
      <td data-label="ดำเนินการ">${row.status === 'refund_pending'
        ? `<button class="button small refund-open-button" type="button" data-action="open-refund" data-value="${esc(row.booking_id)}" ${state.busy ? 'disabled' : ''}>คืนเงิน</button>` : ''}${row.has_slip
        ? `<button class="button small slip-view-button ${row.status === 'paid' ? 'slip-awaiting-review' : 'slip-other-status'}" type="button" data-action="view-slip" data-value="${esc(row.booking_id)}">ดูภาพสลิป</button>`
        : row.status === 'refund_pending' ? '' : '—'}</td>
    </tr>`;
  }

  function reviewTable(rows, showRoomActions = false) {
    return `<div class="table-scroll">
              <table class="review-table">
                <thead>
                  <tr>
                    <th>ชื่อผู้จอง</th>
                    <th>ห้อง</th>
                    <th>ยอดชำระ</th>
                    ${showRoomActions ? '<th>วิธีชำระ</th>' : ''}
                    <th>วันเข้า</th>
                    <th>วันออก</th>
                    <th>สถานะ</th>
                    <th>ดำเนินการ</th>
                  </tr>
                </thead>
              <tbody>${rows.map((row, index) => reviewRow(row, index, showRoomActions)).join('')}</tbody>
            </table></div>`;
  }

  function reservationPage(rows, stateKey) {
    const pageSize = itemsPerPage();
    const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
    state[stateKey] = Math.min(Math.max(state[stateKey], 1), pageCount);
    const start = (state[stateKey] - 1) * pageSize;
    return rows.slice(start, start + pageSize);
  }

  function reservationPagination(total, page, group) {
    const pageCount = Math.ceil(total / itemsPerPage());
    if (pageCount <= 1) return '';
    const label = group === 'pending' ? 'รายการจองทั้งหมด' : 'รายการจองที่อนุมัติแล้ว';
    return `<nav class="reservation-pagination pagination-bar" data-page-group="${group}" data-page-count="${pageCount}" aria-label="หน้าของ${label}">
      ${paginationControls(pageCount, page, group, label)}</nav>`;
  }

  function renderRoomStatuses() {
    const content = root.querySelector('#room-status-content');
    updateRefreshButton();
    const counts = { Available: 0, Busy: 0, Maintenance: 0};
    for (const room of state.rooms) {
      if (Object.hasOwn(counts, room.status)) counts[room.status]++;
    }
    root.querySelector('#rooms-total').textContent = String(state.rooms.length);
    root.querySelector('#rooms-available').textContent = String(counts.Available);
    root.querySelector('#rooms-busy').textContent = String(counts.Busy);
    root.querySelector('#rooms-maintenance').textContent = String(counts.Maintenance);
    if (state.roomsLoading && !state.roomsLoaded) {
      content.innerHTML = '<div class="empty"><p>กำลังโหลดสถานะห้อง</p></div>';
      return;
    }
    if (state.roomsError && !state.rooms.length) {
      content.innerHTML = `<div class="empty" role="alert"><p>${esc(state.roomsError)}</p></div>`;
      return;
    }
    if (!state.rooms.length) {
      content.innerHTML = '<div class="empty"><p>ยังไม่มีข้อมูลห้องพัก</p></div>';
      return;
    }
    const rooms = state.rooms.filter((room) => state.visibleRoomStatuses.has(room.status)
        && matchesSearch(state.roomSearch, [room.room_number, room.room_name, room.status, room.occupant?.customer_name]))
      .sort((a, b) => String(a.room_number).localeCompare(String(b.room_number), 'th', { numeric: true }));
    if (!rooms.length) {
      content.innerHTML = '<div class="empty"><p>ไม่พบห้องที่ตรงกับการค้นหาและสถานะที่เลือก</p></div>';
      return;
    }
    const pageSize = itemsPerPage();
    const pageCount = Math.ceil(rooms.length / pageSize);
    state.roomPage = Math.min(Math.max(state.roomPage, 1), pageCount);
    const pageRooms = rooms.slice((state.roomPage - 1) * pageSize, state.roomPage * pageSize);
    content.innerHTML = `${state.roomsError ? `<p class="review-error" role="alert">${esc(state.roomsError)}</p>` : ''}
      <div class="room-status-grid">${pageRooms.map((room) => {
        const status = roomStatusLabels[room.status] || String(room.status || 'Unknown');
        const style = Object.hasOwn(roomStatusLabels, room.status) ? room.status.toLowerCase() : 'unknown';
        const occupantName = room.occupant?.customer_name || 'ไม่พบข้อมูลผู้เข้าพัก';
        const roomContent = `<div><strong>ห้อง ${esc(room.room_number)}</strong><span>${esc(room.room_name || '')}</span>
          ${room.status === 'Busy' ? `<span class="room-status-guest">ผู้เข้าพัก: ${esc(occupantName)}</span>` : ''}</div>
          <span class="room-status-badge">${esc(status)}</span>`;
        return room.status === 'Busy'
          ? `<button class="room-status-item room-status-${style}" type="button" data-action="view-occupant" data-value="${esc(room.room_number)}" title="ผู้เข้าพัก: ${esc(occupantName)}" aria-label="ดูข้อมูลผู้เข้าพักห้อง ${esc(room.room_number)}: ${esc(occupantName)}">${roomContent}</button>`
          : `<article class="room-status-item room-status-${style}">${roomContent}</article>`;
      }).join('')}</div>
      ${pageCount > 1 ? `<nav class="room-pagination pagination-bar" data-page-group="rooms" data-page-count="${pageCount}" aria-label="หน้ารายการห้อง">
        ${paginationControls(pageCount, state.roomPage, 'rooms', 'รายการห้อง')}</nav>` : ''}`;
  }

  function slipModal() {
    if (state.selectedId === null) return '';
    const row = state.reviews.find((item) => String(item.booking_id) === state.selectedId);
    if (!row) return '';

    const image = state.slipLoading
      ? '<div class="slip-placeholder">กำลังโหลดภาพสลิป</div>'
      : state.slipError
        ? `<div class="slip-placeholder" role="alert">${esc(state.slipError)}<button class="button" data-action="retry-slip">ลองอีกครั้ง</button></div>`
        : state.slipUrl
          ? `<img class="slip-image" width="220" height="290" src="${esc(state.slipUrl)}" alt="สลิปการชำระเงินของ ${esc(row.customer_name)}">`
          : '<div class="slip-placeholder">ไม่พบภาพสลิป</div>';

    const actions = row.status === 'paid'
      ? `<label class="decline-field" for="decline-description">เหตุผลที่ปฏิเสธสลิป
          <textarea id="decline-description" maxlength="500" rows="3" placeholder="ระบุเหตุผลก่อนกดปฏิเสธ">${esc(state.declineDescription)}</textarea>
        </label>

        <div class="modal-actions slip-actions">
          <button class="button danger" data-action="review-status" data-value="decline" ${state.busy || !state.slipUrl ? 'disabled' : ''}>ปฏิเสธ</button>
          <button class="button primary" data-action="review-status" data-value="ready" ${state.busy || !state.slipUrl ? 'disabled' : ''}>อนุมัติ</button>
        </div>`

      : `<p class="review-complete">สถานะ: ${esc(statusLabels[row.status] || row.status)}</p>
        ${['decline', 'cancel'].includes(row.status) && row.description
          ? `<p class="review-reason">เหตุผล: ${esc(row.description)}</p>` : ''}`;

    return `<div class="modal-backdrop" data-action="backdrop">
              <section class="modal slip-modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
                <div class="modal-heading">
                  <div><h2 id="dialog-title">ตรวจสอบสลิป</h2><p>ดูภาพและผลการตรวจสอบ</p></div>
                  <button class="icon-button" data-action="close-modal" aria-label="ปิดหน้าต่าง">×</button>
                </div>

                <div class="slip-details"><strong>${esc(row.customer_name)}</strong><span>ห้อง ${esc(row.room_number)} · Booking #${esc(row.booking_id)}</span></div>

                <div class="slip-image-wrap">${image}</div>${actions}
              </section>
            </div>`;
  }

  function occupantModal() {
    if (state.selectedRoomNumber === null) return '';
    const room = state.rooms.find((item) => String(item.room_number) === state.selectedRoomNumber && item.status === 'Busy');
    if (!room) return '';
    const occupant = room.occupant;
    const fields = occupant ? [
      ['ชื่อผู้เข้าพัก', occupant.customer_name],
      ['เบอร์โทรศัพท์', occupant.phone],
      ['วันเช็กอิน', occupant.check_in],
      ['วันเช็กเอาต์', occupant.check_out],
      ['เวลาเข้าพักจริง', bangkokDateTime(occupant.arrive_at)],
    ] : [];
    return `<div class="modal-backdrop" data-action="backdrop">
      <section class="modal occupant-modal" role="dialog" aria-modal="true" aria-labelledby="occupant-dialog-title">
        <div class="modal-heading">
          <div><h2 id="occupant-dialog-title">ผู้เข้าพักห้อง ${esc(room.room_number)}</h2><p>${esc(room.room_name || '')}</p></div>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="ปิดหน้าต่าง">×</button>
        </div>
        ${occupant ? `<dl class="occupant-details">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>`
          : '<p class="occupant-empty">ไม่พบข้อมูลผู้เข้าพักปัจจุบันของห้องนี้</p>'}
      </section>
    </div>`;
  }

  function roomActionConfirmModal() {
    const pending = state.confirmRoomAction;
    if (!pending) return '';
    const row = state.reviews.find((item) => String(item.booking_id) === pending.bookingId);
    if (!row) return '';
    const label = pending.action === 'checkin' ? 'เช็คอิน' : 'เช็คเอาต์';
    return `<div class="modal-backdrop" data-action="backdrop">
      <section class="modal room-action-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="room-action-dialog-title" aria-describedby="room-action-dialog-details">
        <div class="modal-heading">
          <div><h2 id="room-action-dialog-title">ยืนยันการ${label}</h2><p>ตรวจสอบรายการก่อนเปลี่ยนสถานะห้อง</p></div>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="ปิดหน้าต่าง" ${state.busy ? 'disabled' : ''}>×</button>
        </div>
        <p id="room-action-dialog-details" class="room-action-confirm-details">${label}ให้ <strong>${esc(row.customer_name)}</strong> ห้อง <strong>${esc(row.room_number)}</strong> ใช่หรือไม่?</p>
        ${pending.action === 'checkin' && row.payment_method === 'partial_deposit'
          ? '<p class="room-action-confirm-note">ยืนยันว่าได้รับเงินส่วนที่เหลือแล้ว</p>' : ''}
        <div class="modal-actions room-action-confirm-actions">
          <button class="button" type="button" data-action="close-modal" ${state.busy ? 'disabled' : ''}>ยกเลิก</button>
          <button class="button primary" type="button" data-action="confirm-room-action" ${state.busy ? 'disabled' : ''}>ยืนยัน${label}</button>
        </div>
      </section>
    </div>`;
  }

  function refundModal() {
    if (state.refundBookingId === null) return '';
    const row = state.reviews.find((item) => String(item.booking_id) === state.refundBookingId);
    if (!row || row.status !== 'refund_pending') return '';
    const refundAmount = (Number(row.amount) || 0) * Number(row.refund_value) / 100;
    const hasTransferDetails = Number.isFinite(refundAmount) && refundAmount > 0
      && Boolean(row.refund_bank && row.refund_account);
    const fields = [
      ['ผู้จอง', row.customer_name],
      ['ห้อง', row.room_number],
      ['รหัสการจอง', row.booking_id],
      ['ยอดที่ต้องโอนคืน', money.format(refundAmount)],
      ['อัตราคืนเงิน', `${row.refund_value}%`],
      ['ธนาคาร/ช่องทาง', refundBankLabels[row.refund_bank] || row.refund_bank],
      ['เลขที่บัญชี/พร้อมเพย์', row.refund_account],
      ['เวลาขอคืนเงิน', bangkokDateTime(row.refund_timestamp)],
    ];
    return `<div class="modal-backdrop" data-action="backdrop">
      <section class="modal refund-modal" role="dialog" aria-modal="true" aria-labelledby="refund-dialog-title">
        <div class="modal-heading">
          <div><h2 id="refund-dialog-title">คืนเงิน</h2><p>ตรวจสอบข้อมูลก่อนโอนเงินคืนลูกค้า</p></div>
          <button class="icon-button" type="button" data-action="close-modal" aria-label="ปิดหน้าต่าง" ${state.busy ? 'disabled' : ''}>×</button>
        </div>
        <dl class="refund-modal-details">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${esc(value || '—')}</dd></div>`).join('')}</dl>
        ${hasTransferDetails ? '' : '<p class="review-error" role="alert">ข้อมูลสำหรับโอนคืนไม่ครบ กรุณาตรวจสอบรายการก่อน</p>'}
        <label class="refund-confirmation"><input id="refund-confirmed" type="checkbox" ${state.refundConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''}> คืนเงินแล้ว</label>
        <div class="modal-actions refund-modal-actions">
          <button class="button" type="button" data-action="close-modal" ${state.busy ? 'disabled' : ''}>ยกเลิก</button>
          <button class="button primary" type="button" data-action="complete-refund" ${state.busy || !state.refundConfirmed || !hasTransferDetails ? 'disabled' : ''}>ยืนยันคืนเงินแล้ว</button>
        </div>
      </section>
    </div>`;
  }

  function render({ skipAnalytics = false } = {}) {
    if (!skipAnalytics) renderAnalytics();
    const pendingContent = root.querySelector('#pending-content');
    const historyContent = root.querySelector('#history-content');
    updateRefreshButton();
    if (!account || !roleTabs[account.role]?.includes('reservation')) {
      pendingContent.replaceChildren();
      historyContent.replaceChildren();
      root.querySelector('#modal-root').replaceChildren();
      return;
    }
    const sorted = [...state.reviews].sort((a, b) => {
      const byDate = String(a.check_in || '').localeCompare(String(b.check_in || ''));
      return state.sortNewest ? -byDate : byDate;
    });
    const pending = sorted.filter((row) => state.visibleStatuses.has(row.status)
      && matchesReservationSearch(row, state.reservationSearch));
    const approved = state.reviews.filter((row) => ['ready', 'inhouse', 'refund_pending', 'refunded'].includes(row.status));
    const history = approved.filter((row) => matchesReservationSearch(row, state.approvedSearch))
      .sort((a, b) => {
        const byDate = String(a.check_in || '').localeCompare(String(b.check_in || ''));
        if (state.approvedSort === 'amount') {
          const byAmount = (Number(a.amount) || 0) - (Number(b.amount) || 0);
          return (state.approvedAmountDescending ? -byAmount : byAmount) || byDate;
        }
        return state.approvedDateAscending ? byDate : -byDate;
      });
    const pendingRows = reservationPage(pending, 'pendingPage');
    const historyRows = reservationPage(history, 'approvedPage');
    root.querySelector('#pending-count').textContent = `พบ ${pending.length} จาก ${state.reviews.length} รายการ`;
    root.querySelector('#history-count').textContent = `พบ ${history.length} จาก ${approved.length} รายการ`;
    root.querySelector('#sort-reservations').textContent = state.sortNewest ? 'วันเข้า: ใหม่ก่อน' : 'วันเข้า: เก่าก่อน';
    root.querySelector('#sort-approved-date').textContent = state.approvedDateAscending
      ? 'วันเข้า: ก่อนไปหลัง' : 'วันเข้า: หลังไปก่อน';
    root.querySelector('#sort-approved-amount').textContent = state.approvedAmountDescending
      ? 'ยอดชำระ: มากไปน้อย' : 'ยอดชำระ: น้อยไปมาก';
    root.querySelector('#sort-approved-date').setAttribute('aria-pressed', String(state.approvedSort === 'date'));
    root.querySelector('#sort-approved-amount').setAttribute('aria-pressed', String(state.approvedSort === 'amount'));
    if (state.loading && !state.reviews.length) {
      pendingContent.innerHTML = '<div class="empty"><h3>กำลังโหลดรายการ</h3><p>กำลังดึงรายการชำระเงินจาก backend</p></div>';
      historyContent.innerHTML = '<div class="empty"><p>กำลังโหลดรายการ</p></div>';
    } else if (state.error && !state.reviews.length) {
      pendingContent.innerHTML = `<div class="empty" role="alert"><h3>โหลดรายการไม่สำเร็จ</h3><p>${esc(state.error)}</p><p>กดรีเฟรชด้านบนเพื่อลองอีกครั้ง</p></div>`;
      historyContent.innerHTML = '<div class="empty"><p>ยังไม่สามารถแสดงรายการได้</p></div>';
    } else {
      pendingContent.innerHTML = `${state.error ? `<p class="review-error" role="alert">${esc(state.error)}</p>` : ''}${pending.length
        ? reviewTable(pendingRows) + reservationPagination(pending.length, state.pendingPage, 'pending')
        : '<div class="empty"><h3>ไม่มีรายการตามตัวกรอง</h3><p>ลองเลือกสถานะอื่นหรือรีเฟรชรายการ</p></div>'}`;
      historyContent.innerHTML = history.length
        ? reviewTable(historyRows, true) + reservationPagination(history.length, state.approvedPage, 'history')
        : `<div class="empty"><h3>${approved.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มี reservation ที่อนุมัติแล้ว'}</h3></div>`;
    }
    root.querySelector('#modal-root').innerHTML = state.confirmRoomAction ? roomActionConfirmModal()
      : state.refundBookingId !== null ? refundModal()
        : state.selectedRoomNumber !== null ? occupantModal() : slipModal();
    root.querySelector('#toast-root').innerHTML = state.toast
      ? `<div class="toast" role="status"><span>${esc(state.toast)}</span><button data-action="dismiss-toast" aria-label="ปิดแจ้งเตือน">×</button></div>` : '';
  }

  reservationMobile.addEventListener('change', (event) => {
    const oldPageSize = event.matches ? 5 : 2;
    const newPageSize = itemsPerPage();
    for (const key of ['pendingPage', 'approvedPage', 'roomPage']) {
      state[key] = Math.floor((state[key] - 1) * oldPageSize / newPageSize) + 1;
    }
    render({ skipAnalytics: true });
    renderRoomStatuses();
    workerLog.resize();
  });

  async function loadRoomStatuses() {
    const version = ++roomRequestVersion;
    const token = sessionToken;
    state.roomsLoading = true;
    state.roomsError = '';
    renderRoomStatuses();
    try {
      const result = await request('/room_statuses');
      if (version === roomRequestVersion && token === sessionToken) state.rooms = Array.isArray(result.rooms) ? result.rooms : [];
    } catch (error) {
      if (version === roomRequestVersion && token === sessionToken) state.roomsError = error.message;
    } finally {
      if (version === roomRequestVersion && token === sessionToken) {
        state.roomsLoading = false;
        state.roomsLoaded = true;
        renderRoomStatuses();
        render();
      }
    }
  }

  function showToast(message) {
    state.toast = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { state.toast = ''; render(); }, 4500);
    render();
  }

  async function loadReviews() {
    if (state.loading) return;
    const token = sessionToken;
    state.loading = true;
    state.error = '';
    render();
    try {
      const result = await request(account.role === 'ceo' ? '/dashboard/overview_data' : '/list_reservations');
      if (token !== sessionToken) return;
      const records = result.records || [];
      state.reviews = records;
      state.balanceConfirmed.clear();
      state.userId = Object.fromEntries(records.filter((row) => row.booking_id)
        .map((row) => [row.booking_id, row.line_user_id]));
    } catch (error) {
      if (token === sessionToken) state.error = error.message;
    } finally {
      if (token === sessionToken) {
        state.loading = false;
        render();
      }
    }
  }

  function updateRefreshButton() {
    const button = root.querySelector('#refresh-all');
    const loading = state.loading || state.roomsLoading;
    button.disabled = loading;
    button.textContent = loading ? 'กำลังรีเฟรช...' : 'รีเฟรช';
  }

  function refreshAll() {
    if (!account || state.loading || state.roomsLoading) return;
    const tasks = [];
    if (roleTabs[account.role].includes('overview')) tasks.push(loadRoomStatuses());
    if (roleTabs[account.role].includes('overview') || roleTabs[account.role].includes('reservation')) tasks.push(loadReviews());
    if (roleTabs[account.role].includes('support')) tasks.push(loadSupportUsers());
    if (!root.querySelector('#worker-log-panel').hidden) tasks.push(workerLog.refresh());
    return Promise.all(tasks);
  }

  function tabFromHash() {
    if (window.location.hash === '#worker-log') return 'worker-log';
    if (window.location.hash === '#support') return 'support';
    return ['#reservation', '#pending', '#history'].includes(window.location.hash) ? 'reservation' : 'overview';
  }

  function selectTab(name, updateUrl = false) {
    const allowed = roleTabs[account?.role] || [];
    const active = allowed.includes(name) ? name : allowed[0];
    if (!active) return;
    root.querySelector('#profile-panel').hidden = true;
    for (const tabName of ['overview', 'reservation', 'support', 'worker-log']) {
      const selected = tabName === active;
      const button = root.querySelector(`#${tabName}-tab`);
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      root.querySelector(`#${tabName}-panel`).hidden = !selected;
    }
    if (active === 'worker-log') workerLog.refresh();
    if (updateUrl) {
      const hash = active === 'overview' ? '#analytics' : active === 'reservation' ? '#pending' : `#${active}`;
      if (window.location.hash !== hash) window.history.pushState(null, '', hash);
    }
  }

  function syncTabFromHash() {
    if (window.location.hash === '#profile' && account) {
      showProfile();
      return;
    }
    selectTab(tabFromHash());
    const target = document.getElementById(window.location.hash.slice(1));
    if (target && ((['analytics', 'rooms'].includes(target.id) && roleTabs[account?.role]?.includes('overview'))
      || (['pending', 'history'].includes(target.id) && roleTabs[account?.role]?.includes('reservation')))) {
      requestAnimationFrame(() => target.scrollIntoView());
    }
  }

  function showProfile() {
    for (const name of ['overview', 'reservation', 'support', 'worker-log']) root.querySelector(`#${name}-panel`).hidden = true;
    root.querySelector('#profile-panel').hidden = false;
    root.querySelector('#profile-error').hidden = true;
  }

  async function openSlip(bookingId) {
    state.selectedRoomNumber = null;
    state.selectedId = String(bookingId);
    state.declineDescription = '';
    state.slipUrl = '';
    state.slipError = '';
    state.slipLoading = true;
    render();
    try {
      const result = await request(`/booking_slip?booking_id=${encodeURIComponent(bookingId)}`);
      let url;
      try {
        url = new URL(result.slip_url);
      } catch {
        throw new Error('ลิงก์สลิปไม่ถูกต้อง');
      }
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('ลิงก์สลิปไม่ถูกต้อง');
      if (state.selectedId === String(bookingId)) state.slipUrl = url.href;
    } catch (error) {
      if (state.selectedId === String(bookingId)) state.slipError = error.message;
    } finally {
      state.slipLoading = false;
      render();
    }
  }

  async function reviewStatus(status) {
    const row = state.reviews.find((item) => String(item.booking_id) === state.selectedId);
    if (state.busy || !state.slipUrl || row?.status !== 'paid' || !['ready', 'decline'].includes(status)) return;
    const userId = state.userId[row.booking_id];
    const field = root.querySelector('#decline-description');
    const description = status === 'decline' ? field?.value.trim() : null;
    if (status === 'decline' && !description) {
      field.setCustomValidity('กรุณาระบุเหตุผลที่ปฏิเสธสลิป');
      field.reportValidity();
      field.focus();
      return;
    }
    state.busy = true;
    state.declineDescription = description || '';
    render();
    try {
      await Promise.all([
        request('/update_user_status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: row.booking_id, status,
            ...(status === 'decline' ? { description } : {})
          })
        }),
        request('/reply_approval', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            booking_id: row.booking_id, userId, status,
            ...(status === 'decline' ? { description } : {})
          })
        })
      ]);
      row.status = status;
      row.description = description;
      state.selectedId = null;
      state.slipUrl = '';
      showToast(status === 'ready' ? 'อนุมัติรายการแล้ว' : 'ปฏิเสธรายการแล้ว');
      await loadReviews();
    } catch (error) {
      showToast(error.message);
    } finally {
      state.busy = false;
      render();
    }
  }

  function openRoomActionConfirmation(action, bookingId) {
    const row = state.reviews.find((item) => String(item.booking_id) === String(bookingId));
    if (!canRoomAction(action, row)) return;
    state.confirmRoomAction = { action, bookingId: String(bookingId) };
    render({ skipAnalytics: true });
    root.querySelector('.room-action-confirm-modal [data-action="close-modal"]')?.focus();
  }

  async function roomAction() {
    const pending = state.confirmRoomAction;
    if (!pending || state.busy) return;
    const { action, bookingId } = pending;
    const row = state.reviews.find((item) => String(item.booking_id) === bookingId);
    if (!canRoomAction(action, row)) {
      state.confirmRoomAction = null;
      showToast('สถานะรายการเปลี่ยนไป กรุณาตรวจสอบอีกครั้ง');
      return;
    }
    state.busy = true;
    render({ skipAnalytics: true });
    try {
      await request('/reservation_room_action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          booking_id: bookingId, action,
          ...(action === 'checkin' ? { balance_paid_confirmed: state.balanceConfirmed.has(String(bookingId)) } : {}),
        }),
      });
      state.confirmRoomAction = null;
      showToast(action === 'checkin' ? 'เช็คอินแล้ว' : 'เช็คเอาต์แล้ว');
      await Promise.all([loadReviews(), loadRoomStatuses()]);
    } catch (error) {
      showToast(error.message);
    } finally {
      state.busy = false;
      render();
      root.querySelector('.room-action-confirm-modal [data-action="confirm-room-action"]')?.focus();
    }
  }

  function openRefundModal(bookingId) {
    const row = state.reviews.find((item) => String(item.booking_id) === String(bookingId));
    if (state.busy || row?.status !== 'refund_pending') return;
    state.selectedId = null;
    state.selectedRoomNumber = null;
    state.confirmRoomAction = null;
    state.refundBookingId = String(bookingId);
    state.refundConfirmed = false;
    render({ skipAnalytics: true });
    root.querySelector('#refund-confirmed')?.focus();
  }

  async function completeRefund() {
    const bookingId = state.refundBookingId;
    const row = state.reviews.find((item) => String(item.booking_id) === bookingId);
    if (state.busy || !state.refundConfirmed || row?.status !== 'refund_pending'
      || !row.refund_bank || !row.refund_account || Number(row.refund_value) <= 0) return;
    state.busy = true;
    render({ skipAnalytics: true });
    try {
      const result = await request('/complete_refund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id: bookingId, confirmed: true }),
      });
      if (result.status !== 'refunded') throw new Error('บันทึกการคืนเงินไม่สำเร็จ กรุณาลองอีกครั้ง');
      row.status = 'refunded';
      row.refund_completed_at = result.refund_completed_at;
      state.refundBookingId = null;
      state.refundConfirmed = false;
      showToast('บันทึกสถานะคืนเงินแล้ว');
      await loadReviews();
    } catch (error) {
      showToast(error.message);
    } finally {
      state.busy = false;
      render({ skipAnalytics: true });
    }
  }

  function closeModal() {
    if (state.busy) return;
    const previousRoomNumber = state.selectedRoomNumber;
    const previousRoomAction = state.confirmRoomAction;
    state.selectedId = null;
    state.selectedRoomNumber = null;
    state.confirmRoomAction = null;
    state.refundBookingId = null;
    state.refundConfirmed = false;
    state.slipUrl = '';
    state.slipError = '';
    render({ skipAnalytics: true });
    if (previousRoomNumber !== null) {
      [...root.querySelectorAll('[data-action="view-occupant"]')]
        .find((button) => button.dataset.value === previousRoomNumber)?.focus();
    } else if (previousRoomAction) {
      [...root.querySelectorAll(`[data-action="${previousRoomAction.action}"]`)]
        .find((button) => button.dataset.value === previousRoomAction.bookingId)?.focus();
    }
  }

  root.addEventListener('click', (event) => {
    if (event.target.closest('#logout-button')) {
      const logoutRequest = request('/dashboard/logout', { method: 'POST' });
      showAuth();
      logoutRequest.catch(() => {});
      return;
    }
    if (!account) return;
    if (event.target.closest('#profile-button')) {
      showProfile();
      return;
    }
    if (event.target.closest('#profile-close')) { selectTab(tabFromHash(), true); return; }
    if (event.target.closest('#support-refresh')) { loadSupportUsers(); return; }
    if (event.target.closest('#support-cancel')) { resetSupportForm(); return; }
    const supportButton = event.target.closest('[data-support-action]');
    if (supportButton && roleTabs[account.role]?.includes('support')) {
      const user = supportUsers.find((item) => String(item.id) === supportButton.dataset.id);
      if (!user) return;
      const action = supportButton.dataset.supportAction;
      if (action === 'edit') {
        const form = root.querySelector('#support-user-form');
        form.elements.namedItem('worker_id').value = user.id;
        form.elements.namedItem('name').value = user.worker_name;
        form.elements.namedItem('phone').value = user.phone || '';
        form.elements.namedItem('role').value = user.role;
        root.querySelector('#support-save').textContent = 'บันทึกการแก้ไข';
        root.querySelector('#support-cancel').hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (action === 'reset' && window.confirm(`รีเซ็ตรหัสผ่านของ ${user.worker_name} เป็นเบอร์โทร ${user.phone || 'ที่บันทึกไว้'}?`)) {
        supportButton.disabled = true;
        request(`/dashboard/users/${encodeURIComponent(user.id)}/reset-password`, { method: 'POST' })
          .then(() => {
            if (String(user.id) === String(account?.id)) {
              showAuth();
              const status = root.querySelector('#login-status');
              status.textContent = 'รีเซ็ตรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่';
              status.hidden = false;
            } else showToast('รีเซ็ตรหัสผ่านแล้ว');
          })
          .catch((error) => supportError(error.message))
          .finally(() => { supportButton.disabled = false; });
      } else if (action === 'delete' && window.confirm(`ลบบัญชี ${user.worker_name} หรือไม่?`)) {
        supportButton.disabled = true;
        request(`/dashboard/users/${encodeURIComponent(user.id)}`, { method: 'DELETE' })
          .then(() => { resetSupportForm(); return loadSupportUsers(); })
          .catch((error) => supportError(error.message))
          .finally(() => { supportButton.disabled = false; });
      }
      return;
    }
    const tab = event.target.closest('[data-tab]');
    if (tab && root.contains(tab)) {
      selectTab(tab.dataset.tab, true);
      return;
    }
    const forecastButton = event.target.closest('[data-forecast-days]');
    if (forecastButton && root.contains(forecastButton)) {
      state.analyticsForecastDays = Number(forecastButton.dataset.forecastDays);
      renderAnalytics();
      return;
    }
    const range = event.target.closest('[data-analytics-range]');
    if (range && root.contains(range)) {
      state.analyticsRange = range.dataset.analyticsRange;
      state.analyticsSummaryPage = 1;
      state.analyticsChartPage = 1;
      root.querySelectorAll('[data-analytics-range]').forEach((button) => {
        const active = button === range;
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      root.querySelector('#analytics-custom-dates').hidden = state.analyticsRange !== 'custom';
      renderAnalytics();
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button)) return;
    const { action, value } = button.dataset;
    if (action === 'pagination-page') {
      goToPage(button.dataset.group, Number(value));
      return;
    }
    if (action === 'backdrop' && event.target === button) closeModal();
    if (action === 'close-modal') closeModal();
    if (action === 'refresh-all') refreshAll();
    if (action === 'sort-reservations') { state.sortNewest = !state.sortNewest; state.pendingPage = 1; render(); }
    if (action === 'sort-approved-date' || action === 'sort-approved-amount') {
      const sort = action === 'sort-approved-date' ? 'date' : 'amount';
      if (state.approvedSort === sort) {
        if (sort === 'date') state.approvedDateAscending = !state.approvedDateAscending;
        else state.approvedAmountDescending = !state.approvedAmountDescending;
      }
      state.approvedSort = sort;
      state.approvedPage = 1;
      render();
    }
    if (action === 'view-slip') openSlip(value);
    if (action === 'open-refund') openRefundModal(value);
    if (action === 'complete-refund') completeRefund();
    if (action === 'view-occupant') {
      state.selectedId = null;
      state.selectedRoomNumber = String(value);
      render();
      root.querySelector('.occupant-modal [data-action="close-modal"]')?.focus();
    }
    if (action === 'checkin' || action === 'checkout') openRoomActionConfirmation(action, value);
    if (action === 'confirm-room-action') roomAction();
    if (action === 'retry-slip') openSlip(state.selectedId);
    if (action === 'review-status') reviewStatus(value);
    if (action === 'dismiss-toast') { state.toast = ''; render(); }
  });

  root.addEventListener('submit', (event) => {
    if (event.target.id === 'support-user-form') {
      event.preventDefault();
      if (!account || !roleTabs[account.role]?.includes('support')) return;
      const form = event.target;
      const workerId = form.elements.namedItem('worker_id').value;
      const save = root.querySelector('#support-save');
      save.disabled = true;
      supportError();
      request(workerId ? `/dashboard/users/${encodeURIComponent(workerId)}` : '/dashboard/users', {
        method: workerId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.elements.namedItem('name').value.trim(),
          phone: form.elements.namedItem('phone').value.trim(), role: form.elements.namedItem('role').value }),
      }).then(async () => {
        resetSupportForm();
        if (String(workerId) === String(account.id)) {
          const profile = await request('/dashboard/me');
          account = profile;
          root.querySelector('#account-name').textContent = `${profile.name} · ${roleLabels[profile.role] || profile.role}`;
          root.querySelector('#profile-name').textContent = profile.name;
          root.querySelector('#profile-phone').textContent = profile.phone || 'ยังไม่ระบุ';
        }
        await loadSupportUsers();
        showToast(workerId ? 'บันทึกข้อมูลแล้ว' : 'สร้างบัญชีแล้ว');
      }).catch((error) => supportError(error.message)).finally(() => { save.disabled = false; });
      return;
    }
    if (event.target.id === 'profile-password-form') {
      event.preventDefault();
      const form = event.target;
      const box = root.querySelector('#profile-error');
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      box.hidden = true;
      request('/dashboard/profile/password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ current_password: form.elements.namedItem('current_password').value,
          new_password: form.elements.namedItem('new_password').value }),
      }).then(() => {
        form.reset();
        showAuth();
        const status = root.querySelector('#login-status');
        status.textContent = 'เปลี่ยนรหัสผ่านแล้ว กรุณาเข้าสู่ระบบใหม่';
        status.hidden = false;
      }).catch((error) => { box.textContent = error.message; box.hidden = false; })
        .finally(() => { submit.disabled = false; });
      return;
    }
    if (event.target.id === 'login-form') {
      event.preventDefault();
      const form = event.target;
      const errorBox = root.querySelector('#login-error');
      errorBox.hidden = true;
      root.querySelector('#login-status').hidden = true;
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true;
      request('/dashboard/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ worker_name: form.elements.namedItem('worker_name').value.trim(),
          password: form.elements.namedItem('password').value }),
      }).then((result) => {
        sessionToken = result.token;
        sessionStorage.setItem('pakping_dashboard_token', sessionToken);
        showDashboard(result);
      }).catch((error) => {
        errorBox.textContent = error.message;
        errorBox.hidden = false;
      }).finally(() => { submit.disabled = false; });
      return;
    }
    const form = event.target.closest('form[data-page-jump]');
    if (!form || !root.contains(form)) return;
    event.preventDefault();
    goToPage(form.dataset.pageJump, Number(form.querySelector('input').value));
  });

  root.addEventListener('keydown', (event) => {
    const tab = event.target.closest('[data-tab]');
    if (!tab || !root.contains(tab)) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = roleTabs[account?.role] || [];
    const index = tabs.indexOf(tab.dataset.tab);
    const next = event.key === 'Home' ? tabs[0]
      : event.key === 'End' ? tabs.at(-1)
        : tabs[(index + (event.key === 'ArrowLeft' ? tabs.length - 1 : 1)) % tabs.length];
    selectTab(next, true);
    root.querySelector(`#${next}-tab`).focus();
  });

  window.addEventListener('hashchange', syncTabFromHash);
  window.addEventListener('popstate', syncTabFromHash);

  root.addEventListener('change', (event) => {
    if (event.target.id === 'refund-confirmed') {
      state.refundConfirmed = event.target.checked;
      const row = state.reviews.find((item) => String(item.booking_id) === state.refundBookingId);
      root.querySelector('[data-action="complete-refund"]').disabled = !state.refundConfirmed
        || !row?.refund_bank || !row?.refund_account || Number(row.refund_value) <= 0;
      return;
    }
    const balanceCheckbox = event.target.closest('[data-balance-confirm]');
    if (balanceCheckbox) {
      const bookingId = balanceCheckbox.dataset.balanceConfirm;
      if (balanceCheckbox.checked) state.balanceConfirmed.add(bookingId);
      else state.balanceConfirmed.delete(bookingId);
      render();
      return;
    }
    if (event.target.matches('#analytics-start, #analytics-end')) {
      state.analyticsSummaryPage = 1;
      state.analyticsChartPage = 1;
      renderAnalytics();
      return;
    }
    const roomFilter = event.target.closest('[data-room-filter]');
    if (roomFilter) {
      state.roomPage = 1;
      const boxes = [...root.querySelectorAll('[data-room-filter]:not([data-room-filter="all"])')];
      if (roomFilter.dataset.roomFilter === 'all') {
        boxes.forEach((box) => { box.checked = roomFilter.checked; });
      }
      root.querySelector('[data-room-filter="all"]').checked = boxes.every((box) => box.checked);
      state.visibleRoomStatuses = new Set(boxes.filter((box) => box.checked).map((box) => box.dataset.roomFilter));
      const selected = state.visibleRoomStatuses.size;
      root.querySelector('#room-filter-label').textContent = selected === boxes.length
        ? 'สถานะ: ทั้งหมด' : `สถานะ: ${selected} รายการ`;
      renderRoomStatuses();
      return;
    }
    const input = event.target.closest('[data-status-filter]');
    if (!input) return;
    state.pendingPage = 1;
    const boxes = [...root.querySelectorAll('[data-status-filter]:not([data-status-filter="all"])')];
    if (input.dataset.statusFilter === 'all') {
      boxes.forEach((box) => { box.checked = input.checked; });
    }
    root.querySelector('[data-status-filter="all"]').checked = boxes.every((box) => box.checked);
    state.visibleStatuses = new Set(boxes.filter((box) => box.checked).map((box) => box.dataset.statusFilter));
    const selected = state.visibleStatuses.size;
    root.querySelector('#status-filter-label').textContent = selected === boxes.length
      ? 'สถานะ: ทั้งหมด' : `สถานะ: ${selected} รายการ`;
    render();
  });

  root.addEventListener('error', (event) => {
    if (!event.target.classList?.contains('slip-image')) return;
    state.slipUrl = '';
    state.slipError = 'ไม่สามารถแสดงภาพสลิปได้';
    render();
  }, true);

  root.addEventListener('input', (event) => {
    if (event.target.id === 'room-search') {
      state.roomSearch = event.target.value;
      state.roomPage = 1;
      renderRoomStatuses();
      return;
    }
    if (event.target.id === 'reservation-search') {
      state.reservationSearch = event.target.value;
      state.pendingPage = 1;
      render({ skipAnalytics: true });
      return;
    }
    if (event.target.id === 'approved-search') {
      state.approvedSearch = event.target.value;
      state.approvedPage = 1;
      render({ skipAnalytics: true });
      return;
    }
    if (event.target.id !== 'decline-description') return;
    state.declineDescription = event.target.value;
    event.target.setCustomValidity('');
  });

  document.addEventListener('keydown', (event) => {
    const modalOpen = state.selectedId !== null || state.selectedRoomNumber !== null || state.confirmRoomAction !== null || state.refundBookingId !== null;
    if (event.key === 'Escape' && modalOpen) closeModal();
    if (event.key !== 'Tab' || !modalOpen) return;
    const focusable = [...root.querySelectorAll('.modal button:not(:disabled), .modal textarea:not(:disabled), .modal input:not(:disabled)')];
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable.at(-1).focus();
    } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  });

  if (sessionToken) {
    request('/dashboard/me').then(showDashboard).catch(() => showAuth());
  } else {
    showAuth();
  }
  refreshAll();
}

if (document.querySelector('#app')) initializeDashboard();
