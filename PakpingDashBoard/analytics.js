const hotelDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

const dateKey = (value) => {
  if (!value || Number.isNaN(new Date(value).getTime())) return '';
  const parts = Object.fromEntries(hotelDate.formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const stayDate = (value) => String(value || '').slice(0, 10);
const addDays = (day, count) => new Date(Date.parse(`${day}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
const daysBetween = (start, end) => Math.max(0, Math.round(
  (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000,
));

const amount = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
const percent = (part, total) => total > 0 ? Math.round(part / total * 100) : 0;
const approved = (row) => ['ready', 'inhouse', 'success'].includes(row.status);
const hasReceipt = (row) => ['ready', 'inhouse', 'success', 'cancel', 'missing'].includes(row.status);
const isMock = (row) => row.is_mock || String(row.line_user_id || '').startsWith('MOCK-');

function datesForRange(state, root, rows, today) {
  switch (state.analyticsRange) {
    case 'today': return [today, today];
    case '7days': return [addDays(today, -6), today];
    case 'month': {
      const first = `${today.slice(0, 7)}-01`;
      const next = `${addDays(first, 32).slice(0, 7)}-01`;
      return [first, addDays(next, -1)];
    }
    case 'year': return [`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`];
    case 'custom': return [root.querySelector('#analytics-start').value, root.querySelector('#analytics-end').value];
    default: {
      const dates = rows.flatMap((row) => [
        stayDate(row.check_in), row.check_out ? addDays(stayDate(row.check_out), -1) : '',
        dateKey(row.initial_paid_at), dateKey(row.arrive_at),
      ]).filter(Boolean).sort();
      return [dates[0] || today, dates.at(-1) || today];
    }
  }
}

function approvedDeposit(full) {
  const value = full * 0.3;
  const floor = Math.floor(value);
  return value - floor === 0.5 ? floor + (floor % 2) : Math.round(value);
}

function cashEvents(rows) {
  const events = [];
  let untracked = 0;
  for (const row of rows) {
    const full = amount(row.full_amount);
    const paid = amount(row.amount);
    if (!hasReceipt(row) || !full || !paid) continue;
    const firstPayment = row.payment_method === 'partial_deposit' ? approvedDeposit(full) : full;
    if (row.initial_paid_at) {
      const day = dateKey(row.initial_paid_at);
      if (day) events.push({ day, amount: Math.min(firstPayment, paid) });
    } else {
      untracked++;
    }
    if (row.payment_method === 'partial_deposit' && paid >= full && row.arrive_at) {
      const day = dateKey(row.arrive_at);
      if (day) events.push({ day, amount: Math.max(0, full - firstPayment) });
    }
  }
  return { events, untracked };
}

function bar(label, value, maximum, detail, tone, esc) {
  const width = maximum > 0 ? Math.max(0, Math.min(100, value / maximum * 100)) : 0;
  return `<div class="analytics-bar-row">
    <div class="analytics-bar-label"><span>${esc(label)}</span><strong>${esc(detail)}</strong></div>
    <div class="analytics-bar-track" role="progressbar" aria-label="${esc(label)}" aria-valuenow="${Math.round(width)}" aria-valuemin="0" aria-valuemax="100">
      <span class="analytics-bar-fill analytics-tone-${tone}" style="width:${width}%"></span>
    </div>
  </div>`;
}

function card(label, value, note, tone, esc) {
  return `<div class="analytics-kpi analytics-kpi--${tone}"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`;
}

export function renderAnalytics(state, root, { esc, money, number }) {
  //โหลดบัค
  const content = root.querySelector('#analytics-content');
  if (state.loading && !state.reviews.length) {
    content.innerHTML = '<div class="empty"><p>กำลังโหลดข้อมูลสถิติ</p></div>';
    return;
  }
  if (state.error && !state.reviews.length) {
    content.innerHTML = `<div class="empty" role="alert"><p>${esc(state.error)}</p></div>`;
    return;
  }


  //ช่วงวันที่และรายการที่ใช้ในภาพรวม
  const today = dateKey(new Date());
  const rows = state.reviews.filter((row) => !isMock(row));
  const [from, to] = datesForRange(state, root, rows, today);
  if (state.analyticsRange === 'custom' && (!from || !to)) {
    content.innerHTML = '<div class="empty">เลือกวันที่เริ่มและสิ้นสุด</div>';
    return;
  }
  if (!from || !to || from > to) {
    content.innerHTML = '<div class="empty" role="alert">วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด</div>';
    return;
  }
  const endExclusive = addDays(to, 1);
  const roomCount = state.rooms.length;
  const checkInRows = rows.filter((row) => {
    const day = stayDate(row.check_in);
    return day >= from && day <= to;
  });


  // การ์ดสรุป
  const confirmedRows = checkInRows.filter(approved);
  const inhouseCount = rows.filter((row) => row.status === 'inhouse').length;
  const bookedValue = confirmedRows.reduce((sum, row) => sum + amount(row.full_amount), 0);
  const confirmedPaid = confirmedRows.reduce((sum, row) =>
    sum + Math.min(amount(row.full_amount), amount(row.amount)), 0);
  const closedPaid = checkInRows.filter((row) => ['missing', 'cancel'].includes(row.status))
    .reduce((sum, row) => sum + amount(row.amount), 0);
  const paidToDate = confirmedPaid + closedPaid;
  const outstanding = bookedValue - confirmedPaid;
  const roomNights = new Set();
  for (const row of rows) {
    if (!approved(row)) continue;
    const checkIn = stayDate(row.check_in);
    const checkOut = stayDate(row.check_out);
    if (!checkIn || !checkOut || checkIn >= endExclusive || checkOut <= from) continue;
    for (let day = checkIn; day < checkOut && day <= to; day = addDays(day, 1)) {
      if (day >= from && (day >= today || row.arrive_at || row.status === 'success')) {
        roomNights.add(`${row.room_number}|${day}`);
      }
    }
  }
  const availableNights = roomCount * daysBetween(from, endExclusive);
  const occupancy = percent(roomNights.size, availableNights);


  // งานที่ต้องทำวันนี้และยอดคงเหลือที่ต้องรับ
  const todayCheckins = rows.filter((row) => row.status === 'ready' && stayDate(row.check_in) === today && !row.arrive_at);
  const todayBalances = todayCheckins.filter((row) =>
    row.payment_method === 'partial_deposit' && amount(row.full_amount) > amount(row.amount));
  const todayBalanceTotal = todayBalances.reduce((sum, row) =>
    sum + amount(row.full_amount) - amount(row.amount), 0);


  // ห้องที่ถูกจองล่วงหน้า
  const forecastDays = state.analyticsForecastDays || 7;
  const forecastBars = Array.from({ length: forecastDays }, (_, index) => {
    const day = addDays(today, index);
    const rooms = new Set(rows.filter((row) =>
      ['ready', 'inhouse'].includes(row.status) && stayDate(row.check_in) <= day && stayDate(row.check_out) > day,
    ).map((row) => String(row.room_number)));
    return bar(day.slice(5), rooms.size, roomCount,
      `${number.format(rooms.size)} / ${number.format(roomCount)} ห้อง · ${percent(rooms.size, roomCount)}%`, 3, esc);
  }).join('');


  // เงินรับจริงตามวันที่รับเงิน
  const { events, untracked } = cashEvents(rows);
  const cashInRange = events.filter((event) => event.day >= from && event.day <= to);
  const monthly = daysBetween(from, endExclusive) > 45;
  const cashGroups = new Map();
  for (const event of cashInRange) {
    const key = monthly ? event.day.slice(0, 7) : event.day;
    cashGroups.set(key, (cashGroups.get(key) || 0) + event.amount);
  }
  const cashPoints = [...cashGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const cashTotal = cashInRange.reduce((sum, event) => sum + event.amount, 0);
  const cashMax = Math.max(0, ...cashPoints.map((point) => point[1]));
  const cashBars = cashPoints.map(([day, received]) =>
    bar(day, received, cashMax, money.format(received), 9, esc)).join('');


  // ยกเลิกและไม่เข้าพัก
  const rateRows = checkInRows.filter((row) => ['ready', 'inhouse', 'success', 'cancel', 'missing'].includes(row.status));
  const canceled = rateRows.filter((row) => row.status === 'cancel').length;
  const missed = rateRows.filter((row) => row.status === 'missing').length;


  // สถานะรายการจอง
  const statusCounts = new Map();
  for (const row of checkInRows) {
    const status = row.status || 'unknown';
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);
  }
  const statusNames = {
    pending: 'รอชำระ', paid: 'รอตรวจสลิป', ready: 'พร้อมเข้าพัก', inhouse: 'กำลังเข้าพัก', success: 'เช็กเอาต์แล้ว',
    cancel: 'ยกเลิก', missing: 'ไม่เข้าพัก', decline: 'ปฏิเสธ', expired: 'หมดอายุ',
  };
  const statusBars = [...statusCounts.entries()].sort((a, b) => b[1] - a[1])
    .map(([status, count], index) => bar(statusNames[status] || status, count, checkInRows.length,
      `${number.format(count)} รายการ · ${percent(count, checkInRows.length)}%`, (index % 7) + 1, esc)).join('');


  // สัดส่วนยอดชำระ แยกตามวิธีชำระที่ลูกค้าเลือก
  const paidRows = checkInRows.filter((row) => hasReceipt(row) && amount(row.amount) > 0);
  const paidTotal = paidRows.reduce((sum, row) => sum + amount(row.amount), 0);
  const methodBars = [
    ['full_payment', 'ชำระเต็มจำนวน'], ['partial_deposit', 'มัดจำ / จ่ายที่พัก'],
  ].map(([method, label], index) => {
    const matching = paidRows.filter((row) => row.payment_method === method);
    const received = matching.reduce((sum, row) => sum + amount(row.amount), 0);
    return bar(label, received, paidTotal,
      `${number.format(matching.length)} รายการ · ${money.format(received)} · ${percent(received, paidTotal)}%`,
      index + 8, esc);
  }).join('');


  // แสดงผล
  content.innerHTML = `
    <div class="analytics-note">ช่วงวันที่เข้าพัก ${esc(from)} ถึง ${esc(to)} · จำนวนห้อง ${number.format(roomCount)} ห้อง</div>

    <div class="analytics-summary">
      ${card('ยอดจองที่อนุมัติ', money.format(bookedValue), `ยอดเต็มของ ${number.format(confirmedRows.length)} การจอง`, 'booked', esc)}
      ${card('รับชำระแล้ว', money.format(paidToDate), 'รวมยอดที่รับจากรายการยกเลิกและไม่เข้าพัก', 'paid', esc)}
      ${card('ยอดค้างรับ', money.format(outstanding), 'เฉพาะรายการ ready / inhouse / success', 'balance', esc)}
      ${card('อัตราเข้าพัก / จอง', `${occupancy}%`, `${number.format(roomNights.size)} / ${number.format(availableNights)} ห้อง-คืน`, 'occupancy', esc)}
      ${card('กำลังเข้าพัก', number.format(inhouseCount), 'จำนวนรายการที่เข้าพักอยู่ขณะนี้', 'inhouse', esc)}
    </div>

    <div class="analytics-charts">

      <div class="analytics-chart analytics-actions">
        <div class="analytics-actions-intro">
          <span class="analytics-actions-label">งานประจำวัน</span>
          <h3>งานที่ต้องทำวันนี้ · ${esc(today)}</h3>
          <p>รายการ ready ที่กำหนดเช็กอินวันนี้และยังไม่เช็กอิน</p>
          <div class="analytics-action-stats"><strong>${number.format(todayCheckins.length)} เช็กอิน</strong><strong>${number.format(todayBalances.length)} รายการต้องรับยอดคงเหลือ · ${money.format(todayBalanceTotal)}</strong></div>
          <a href="#history">ไปยังรายการพร้อมเข้าพัก →</a>
        </div>

        <div class="analytics-actions-list">
          <h4>รายการรอดำเนินการ</h4>
          ${todayCheckins.length ? `<ul>${todayCheckins.map((row) => `<li><strong>ห้อง ${esc(row.room_number)}</strong><span>${esc(row.customer_name)}</span>${row.payment_method === 'partial_deposit' && amount(row.full_amount) > amount(row.amount) ? `<small>คงเหลือ ${esc(money.format(amount(row.full_amount) - amount(row.amount)))}</small>` : ''}</li>`).join('')}</ul>` : '<div class="analytics-no-data">ไม่มีรายการเช็กอินวันนี้</div>'}
        </div>
      </div>

      <div class="analytics-chart analytics-forecast"><div class="analytics-chart-heading"><h3>ห้องที่ถูกจองล่วงหน้า</h3>
        <div class="analytics-ranges" role="group" aria-label="ช่วงคาดการณ์ห้อง">
          <button type="button" class="analytics-range ${forecastDays === 7 ? 'is-active' : ''}" data-forecast-days="7" aria-pressed="${forecastDays === 7}">7 วัน</button>
          <button type="button" class="analytics-range ${forecastDays === 30 ? 'is-active' : ''}" data-forecast-days="30" aria-pressed="${forecastDays === 30}">30 วัน</button>
        </div></div>
        <p>นับรายการ ready และ inhouse ที่ทับวันเข้าพักแต่ละวัน</p>
        <div class="analytics-scroll">${roomCount ? forecastBars : '<div class="analytics-no-data">กำลังโหลดจำนวนห้อง</div>'}</div>
      </div>
      
      <div class="analytics-chart analytics-cash"><h3>เงินรับจริงตามวันที่</h3>
        <p>รับครั้งแรกเมื่ออนุมัติสลิป · รับยอดคงเหลือเมื่อเช็กอิน · รวม ${esc(money.format(cashTotal))}</p>
        <div class="analytics-scroll">${cashBars || '<div class="analytics-no-data">ไม่มีเงินรับที่บันทึกเวลาในช่วงนี้</div>'}</div>
        ${untracked ? `<p class="analytics-caveat">มี ${number.format(untracked)} รายการเก่าที่ไม่มีเวลายืนยันรับครั้งแรก จึงไม่รวมยอดแรกในกราฟนี้</p>` : ''}
      </div>
      
      <div class="analytics-chart analytics-booking-status"><h3>สถานะรายการจอง</h3><p>ตามวันเช็กอินในช่วงที่เลือก</p>
        ${statusBars || '<div class="analytics-no-data">ไม่มีรายการในช่วงนี้</div>'}
      </div>

      <div class="analytics-chart analytics-cancellations"><h3>ยกเลิกและไม่เข้าพัก</h3>
        <p>นับจากการจองที่มีวันเช็กอินในช่วงที่เลือก</p>
        ${bar('ยกเลิก', canceled, rateRows.length, `${number.format(canceled)} / ${number.format(rateRows.length)} · ${percent(canceled, rateRows.length)}%`, 5, esc)}
        ${bar('ไม่เข้าพัก', missed, rateRows.length, `${number.format(missed)} / ${number.format(rateRows.length)} · ${percent(missed, rateRows.length)}%`, 1, esc)}
      </div>

      <div class="analytics-chart analytics-payment-split"><h3>สัดส่วนยอดชำระ</h3><p>ยอดที่รับแล้วของรายการตามวันเช็กอินในช่วงที่เลือก</p>
        ${paidTotal ? methodBars : '<div class="analytics-no-data">ไม่มีรายการที่รับชำระในช่วงนี้</div>'}
      </div>
    </div>`;
}
