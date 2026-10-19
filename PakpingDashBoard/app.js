const API_BASE_URL = 'https://habitat-sacramento-stop-pcs.trycloudflare.com';
const root = document.querySelector('#app');
let renderBusinessAnalytics = null;
let analyticsLoadError = '';
import('./analytics.js?v=10').then((module) => {
  renderBusinessAnalytics = module.renderAnalytics;
  renderAnalytics();
}).catch((error) => {
  console.error('Unable to load business analytics', error);
  analyticsLoadError = 'โหลดส่วนสถิติธุรกิจไม่สำเร็จ กรุณารีเฟรชหน้า';
  renderAnalytics();
});

const state = {
  reviews: [], loading: false, error: '', selectedId: null, selectedRoomNumber: null,
  rooms: [], roomsLoading: false, roomsLoaded: false, roomsError: '',
  visibleRoomStatuses: new Set(['Available', 'Busy', 'Maintenance', 'Booked']),
  slipUrl: '', slipError: '', slipLoading: false,
  declineDescription: '', busy: false, toast: '', sortNewest: true,
  roomSearch: '', reservationSearch: '', approvedSearch: '', approvedStatusFirst: 'ready',
  visibleStatuses: new Set(['pending', 'paid', 'ready', 'inhouse', 'decline', 'expired', 'cancel', 'missing', 'success']),
  analyticsRange: 'today', analyticsForecastDays: 7,
  balanceConfirmed: new Set(),
};

const statusLabels = {
  pending: 'ยังไม่จ่าย', paid: 'จ่ายแล้ว', ready: 'อนุมัติแล้ว', inhouse: 'กำลังเข้าพัก', expired: 'หมดอายุ',
  decline: 'ปฏิเสธแล้ว', cancel: 'ยกเลิกแล้ว', missing: 'ไม่เข้าพัก',
  success: 'เช็คเอาต์แล้ว',
};

const roomStatusLabels = {
  Available: 'Available', Booked: 'Booked', Busy: 'Busy', Maintenance: 'Maintenance',
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

function renderAnalytics() {
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
  } catch (error) {
    console.error('Unable to render business analytics', error);
    root.querySelector('#analytics-content').innerHTML = '<div class="empty" role="alert"><p>แสดงสถิติธุรกิจไม่สำเร็จ กรุณารีเฟรชหน้า</p></div>';
  }
}

async function request(path, options) {
  const response = await fetch(`${API_BASE_URL}${path}`, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string'
    ? body.detail : `Request failed (${response.status})`);
  return body;
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
        ${isPartial && row.status === 'ready' && !row.arrive_at ? `<label class="balance-confirmation">
          <input type="checkbox" data-balance-confirm="${esc(row.booking_id)}" ${balanceConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''}>
          <span>รับเงินส่วนที่เหลือแล้ว</span>
        </label>` : ''}
      </div></td>` : '';
  const roomActions = showRoomActions
    ? `<div class="room-actions">
        <button class="button small" type="button" data-action="checkin" data-value="${esc(row.booking_id)}" ${state.busy || row.status !== 'ready' || row.arrive_at || !methodKnown || (isPartial && !balanceConfirmed) || !['Available', 'Booked', 'Maintenance'].includes(row.room_status) ? 'disabled' : ''} ${isPartial && !balanceConfirmed ? 'title="ยืนยันรับเงินส่วนที่เหลือก่อนเช็กอิน"' : ''}>เช็คอิน</button>
        <button class="button small" type="button" data-action="checkout" data-value="${esc(row.booking_id)}" ${state.busy || row.status !== 'inhouse' || !row.arrive_at || row.out_at || row.room_status !== 'Busy' ? 'disabled' : ''}>เช็คเอาต์</button>
      </div>` : '';
  return `<tr>
    <td data-label="ชื่อผู้จอง"><div class="review-guest">
      <span class="avatar ${palette[index % palette.length]}">${esc(initials)}</span>
      <span><strong>${esc(row.customer_name)}</strong></span>
    </div></td>
    <td data-label="ห้อง"><strong>${esc(row.room_number)}</strong></td>
    <td data-label="ยอดชำระ"><div class="payment-amounts"><strong>${esc(money.format(Number(row.amount) || 0))}</strong><br><small>ยอดเต็ม ${esc(money.format(Number(row.full_amount) || 0))}</small></div></td>
    ${paymentMethodCell}
    <td data-label="วันเข้า"><div class="checkin-cell"><span>${esc(row.check_in || '—')}</span>${roomActions}</div></td>
    <td data-label="วันออก">${esc(row.check_out || '—')}</td>
    <td data-label="สถานะ"><span class="review-status review-status-${esc(row.status)}">${esc(statusLabels[row.status] || row.status)}</span></td>
    <td data-label="สลิป">${row.has_slip
      ? `<button class="button small" data-action="view-slip" data-value="${esc(row.booking_id)}">ดูภาพสลิป</button>`
      : '—'}</td>
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
                  <th><span class="sr-only">ดูสลิป</span></th>
                </tr>
              </thead>
            <tbody>${rows.map((row, index) => reviewRow(row, index, showRoomActions)).join('')}</tbody>
          </table></div>`;
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
  content.innerHTML = `${state.roomsError ? `<p class="review-error" role="alert">${esc(state.roomsError)}</p>` : ''}
    <div class="room-status-grid">${rooms.map((room) => {
      const status = roomStatusLabels[room.status] || String(room.status || 'Unknown');
      const style = Object.hasOwn(roomStatusLabels, room.status) ? room.status.toLowerCase() : 'unknown';
      const occupantName = room.occupant?.customer_name || 'ไม่พบข้อมูลผู้เข้าพัก';
      const roomContent = `<div><strong>ห้อง ${esc(room.room_number)}</strong><span>${esc(room.room_name || '')}</span>
        ${room.status === 'Busy' ? `<span class="room-status-guest">ผู้เข้าพัก: ${esc(occupantName)}</span>` : ''}</div>
        <span class="room-status-badge">${esc(status)}</span>`;
      return room.status === 'Busy'
        ? `<button class="room-status-item room-status-${style}" type="button" data-action="view-occupant" data-value="${esc(room.room_number)}" title="ผู้เข้าพัก: ${esc(occupantName)}" aria-label="ดูข้อมูลผู้เข้าพักห้อง ${esc(room.room_number)}: ${esc(occupantName)}">${roomContent}</button>`
        : `<article class="room-status-item room-status-${style}">${roomContent}</article>`;
    }).join('')}</div>`;
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

function render({ skipAnalytics = false } = {}) {
  if (!skipAnalytics) renderAnalytics();
  const pendingContent = root.querySelector('#pending-content');
  const historyContent = root.querySelector('#history-content');
  updateRefreshButton();
  const sorted = [...state.reviews].sort((a, b) => {
    const byDate = String(a.check_in || '').localeCompare(String(b.check_in || ''));
    return state.sortNewest ? -byDate : byDate;
  });
  const pending = sorted.filter((row) => state.visibleStatuses.has(row.status)
    && matchesReservationSearch(row, state.reservationSearch));
  const approved = sorted.filter((row) => ['ready', 'inhouse'].includes(row.status));
  const history = approved.filter((row) => matchesReservationSearch(row, state.approvedSearch))
    .sort((a, b) => (a.status === state.approvedStatusFirst ? 0 : 1)
      - (b.status === state.approvedStatusFirst ? 0 : 1));
  root.querySelector('#pending-count').textContent = `แสดง ${pending.length} จาก ${state.reviews.length} รายการ`;
  root.querySelector('#history-count').textContent = `แสดง ${history.length} จาก ${approved.length} รายการ`;
  root.querySelector('#sort-reservations').textContent = state.sortNewest ? 'วันเข้า: ใหม่ก่อน' : 'วันเข้า: เก่าก่อน';
  root.querySelector('#sort-approved-status').textContent = state.approvedStatusFirst === 'ready'
    ? 'สถานะ: อนุมัติแล้วก่อน' : 'สถานะ: กำลังเข้าพักก่อน';
  if (state.loading && !state.reviews.length) {
    pendingContent.innerHTML = '<div class="empty"><h3>กำลังโหลดรายการ</h3><p>กำลังดึงรายการชำระเงินจาก backend</p></div>';
    historyContent.innerHTML = '<div class="empty"><p>กำลังโหลดรายการ</p></div>';
  } else if (state.error && !state.reviews.length) {
    pendingContent.innerHTML = `<div class="empty" role="alert"><h3>โหลดรายการไม่สำเร็จ</h3><p>${esc(state.error)}</p><p>กดรีเฟรชด้านบนเพื่อลองอีกครั้ง</p></div>`;
    historyContent.innerHTML = '<div class="empty"><p>ยังไม่สามารถแสดงรายการได้</p></div>';
  } else {
    pendingContent.innerHTML = `${state.error ? `<p class="review-error" role="alert">${esc(state.error)}</p>` : ''}${pending.length
      ? reviewTable(pending)
      : '<div class="empty"><h3>ไม่มีรายการตามตัวกรอง</h3><p>ลองเลือกสถานะอื่นหรือรีเฟรชรายการ</p></div>'}`;
    historyContent.innerHTML = history.length
      ? reviewTable(history, true)
      : `<div class="empty"><h3>${approved.length ? 'ไม่พบรายการที่ตรงกับการค้นหา' : 'ยังไม่มี reservation ที่อนุมัติแล้ว'}</h3></div>`;
  }
  root.querySelector('#modal-root').innerHTML = state.selectedRoomNumber !== null ? occupantModal() : slipModal();
  root.querySelector('#toast-root').innerHTML = state.toast
    ? `<div class="toast" role="status"><span>${esc(state.toast)}</span><button data-action="dismiss-toast" aria-label="ปิดแจ้งเตือน">×</button></div>` : '';
}

async function loadRoomStatuses() {
  const version = ++roomRequestVersion;
  state.roomsLoading = true;
  state.roomsError = '';
  renderRoomStatuses();
  try {
    const result = await request('/room_statuses');
    if (version === roomRequestVersion) state.rooms = Array.isArray(result.rooms) ? result.rooms : [];
  } catch (error) {
    if (version === roomRequestVersion) state.roomsError = error.message;
  } finally {
    if (version === roomRequestVersion) {
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
  state.loading = true;
  state.error = '';
  render();
  try {
    const result = await request('/list_reservations');
    const records = result.records || [];
    state.reviews = records;
    state.balanceConfirmed.clear();
    state.userId = Object.fromEntries(
      records.map((row) =>  [row.booking_id, row.line_user_id])
    );
  } catch (error) {
    state.error = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

function updateRefreshButton() {
  const button = root.querySelector('#refresh-all');
  const loading = state.loading || state.roomsLoading;
  button.disabled = loading;
  button.textContent = loading ? 'กำลังรีเฟรช...' : 'รีเฟรช';
}

function refreshAll() {
  if (state.loading || state.roomsLoading) return;
  return Promise.all([loadReviews(), loadRoomStatuses()]);
}

function tabFromHash() {
  return ['#reservation', '#pending', '#history'].includes(window.location.hash)
    ? 'reservation' : 'overview';
}

function selectTab(name, updateUrl = false) {
  const active = name === 'reservation' ? 'reservation' : 'overview';
  for (const tabName of ['overview', 'reservation']) {
    const selected = tabName === active;
    const button = root.querySelector(`#${tabName}-tab`);
    button.classList.toggle('is-active', selected);
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
    root.querySelector(`#${tabName}-panel`).hidden = !selected;
  }
  if (updateUrl) {
    const hash = active === 'overview' ? '#analytics' : '#pending';
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }
}

function syncTabFromHash() {
  selectTab(tabFromHash());
  const target = document.getElementById(window.location.hash.slice(1));
  if (target && ['analytics', 'rooms', 'pending', 'history'].includes(target.id)) {
    requestAnimationFrame(() => target.scrollIntoView());
  }
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
    const url = new URL(result.slip_url);
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

async function roomAction(action, bookingId) {
  if (state.busy || !['checkin', 'checkout'].includes(action)) return;
  const row = state.reviews.find((item) => String(item.booking_id) === String(bookingId));
  if (action === 'checkin' && row?.status !== 'ready') return;
  if (action === 'checkout' && row?.status !== 'inhouse') return;
  if (action === 'checkin' && row.payment_method === 'partial_deposit'
      && !state.balanceConfirmed.has(String(bookingId))) {
    showToast('กรุณายืนยันว่ารับเงินส่วนที่เหลือแล้วก่อนเช็กอิน');
    return;
  }
  state.busy = true;
  render();
  try {
    await request('/reservation_room_action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: bookingId, action,
        ...(action === 'checkin' ? { balance_paid_confirmed: state.balanceConfirmed.has(String(bookingId)) } : {}),
      }),
    });
    showToast(action === 'checkin' ? 'เช็คอินแล้ว' : 'เช็คเอาต์แล้ว');
    await Promise.all([loadReviews(), loadRoomStatuses()]);
  } catch (error) {
    showToast(error.message);
  } finally {
    state.busy = false;
    render();
  }
}

function closeModal() {
  if (state.busy) return;
  const previousRoomNumber = state.selectedRoomNumber;
  state.selectedId = null;
  state.selectedRoomNumber = null;
  state.slipUrl = '';
  state.slipError = '';
  render();
  if (previousRoomNumber !== null) {
    [...root.querySelectorAll('[data-action="view-occupant"]')]
      .find((button) => button.dataset.value === previousRoomNumber)?.focus();
  }
}

root.addEventListener('click', (event) => {
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
  if (action === 'backdrop' && event.target === button) closeModal();
  if (action === 'close-modal') closeModal();
  if (action === 'refresh-all') refreshAll();
  if (action === 'sort-reservations') { state.sortNewest = !state.sortNewest; render(); }
  if (action === 'sort-approved-status') {
    state.approvedStatusFirst = state.approvedStatusFirst === 'ready' ? 'inhouse' : 'ready';
    render();
  }
  if (action === 'view-slip') openSlip(value);
  if (action === 'view-occupant') {
    state.selectedId = null;
    state.selectedRoomNumber = String(value);
    render();
    root.querySelector('.occupant-modal [data-action="close-modal"]')?.focus();
  }
  if (action === 'checkin' || action === 'checkout') roomAction(action, value);
  if (action === 'retry-slip') openSlip(state.selectedId);
  if (action === 'review-status') reviewStatus(value);
  if (action === 'dismiss-toast') { state.toast = ''; render(); }
});

root.addEventListener('keydown', (event) => {
  const tab = event.target.closest('[data-tab]');
  if (!tab || !root.contains(tab)) return;
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 'overview'
    : event.key === 'End' ? 'reservation'
      : tab.dataset.tab === 'overview' ? 'reservation' : 'overview';
  selectTab(next, true);
  root.querySelector(`#${next}-tab`).focus();
});

window.addEventListener('hashchange', syncTabFromHash);
window.addEventListener('popstate', syncTabFromHash);

root.addEventListener('change', (event) => {
  const balanceCheckbox = event.target.closest('[data-balance-confirm]');
  if (balanceCheckbox) {
    const bookingId = balanceCheckbox.dataset.balanceConfirm;
    if (balanceCheckbox.checked) state.balanceConfirmed.add(bookingId);
    else state.balanceConfirmed.delete(bookingId);
    render();
    return;
  }
  if (event.target.matches('#analytics-start, #analytics-end')) {
    renderAnalytics();
    return;
  }
  const roomFilter = event.target.closest('[data-room-filter]');
  if (roomFilter) {
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
    renderRoomStatuses();
    return;
  }
  if (event.target.id === 'reservation-search') {
    state.reservationSearch = event.target.value;
    render({ skipAnalytics: true });
    return;
  }
  if (event.target.id === 'approved-search') {
    state.approvedSearch = event.target.value;
    render({ skipAnalytics: true });
    return;
  }
  if (event.target.id !== 'decline-description') return;
  state.declineDescription = event.target.value;
  event.target.setCustomValidity('');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && (state.selectedId !== null || state.selectedRoomNumber !== null)) closeModal();
  if (event.key !== 'Tab' || (state.selectedId === null && state.selectedRoomNumber === null)) return;
  const focusable = [...root.querySelectorAll('.modal button:not(:disabled), .modal textarea:not(:disabled)')];
  if (!focusable.length) return;
  if (event.shiftKey && document.activeElement === focusable[0]) {
    event.preventDefault();
    focusable.at(-1).focus();
  } else if (!event.shiftKey && document.activeElement === focusable.at(-1)) {
    event.preventDefault();
    focusable[0].focus();
  }
});

syncTabFromHash();
render();
refreshAll();
