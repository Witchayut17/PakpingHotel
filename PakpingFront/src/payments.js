'use strict';

(() => {
const list = document.getElementById('payments-list');
const tableWrap = document.getElementById('payments-table-wrap');
const pagination = document.getElementById('payments-pagination');
const section = document.getElementById('moments');
const status = document.getElementById('payments-status');
const refresh = document.getElementById('payments-refresh');
const refundDialog = document.getElementById('refund-dialog');
const refundForm = document.getElementById('refund-form');
const refundBank = document.getElementById('refund-bank');
const refundAccount = document.getElementById('refund-account');
const refundStatus = document.getElementById('refund-form-status');
const refundSubmit = document.getElementById('refund-submit');
const refundBankAccountLengths = {
    promptpay: [10],
    BBL: [10], KBANK: [10], KTB: [10], SCB: [10], BAY: [10],
    TTB: [10, 12], GSB: [12], BAAC: [12], UOB: [10],
    CIMBT: [10, 14], KKP: [10, 14], TISCO: [10, 14], LH: [10, 14],
    ICBC: [10, 15], GHB: [12, 15],
};
const currency = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB',minimumFractionDigits: 0, maximumFractionDigits: 2 });
let requestVersion = 0;
let loadingUserId = null;
let loadedUserId = null;
let allPayments = [];
let currentPage = 1;
let declineRefreshTimer = null;
let refundRefreshTimer = null;
let selectedRefund = null;
let selectedRefundRate = 0;
const cancellingBookingIds = new Set();
const pageSize = 3;

function refundRate(payment) {
    const checkIn = Date.parse(`${payment.check_in}T00:00:00+07:00`);
    if (!Number.isFinite(checkIn)) return 0;
    const hours = (checkIn - Date.now()) / 3600000;
    return hours >= 168 ? 100 : hours > 72 ? 70 : 0;
}

function refundAccountHint(lengths) {
    return `กรุณากรอกตัวเลข ${lengths.join(' หรือ ')} หลัก`;
}

function validateRefundAccount() {
    const lengths = refundBankAccountLengths[refundBank.value];
    const account = refundAccount.value.trim();
    const valid = !account || (lengths?.includes(account.length) && /^[0-9]+$/.test(account));
    refundAccount.setCustomValidity(valid ? '' : refundAccountHint(lengths || [10, 15]));
    return Boolean(lengths && account && valid);
}

function updateRefundAccountRules() {
    const lengths = refundBankAccountLengths[refundBank.value];
    refundAccount.pattern = lengths
        ? lengths.map(length => `[0-9]{${length}}`).join('|')
        : '[0-9]{10,15}';
    refundAccount.maxLength = lengths ? Math.max(...lengths) : 15;
    refundAccount.title = lengths ? refundAccountHint(lengths) : 'กรุณาเลือกธนาคารหรือพร้อมเพย์ก่อน';
    refundAccount.placeholder = lengths ? `ตัวเลข ${lengths.join(' หรือ ')} หลัก` : '';
    validateRefundAccount();
    refundStatus.textContent = '';
}

function openRefund(payment) {
    selectedRefund = payment;
    selectedRefundRate = refundRate(payment);
    refundForm.reset();
    updateRefundAccountRules();
    refundStatus.textContent = '';
    document.getElementById('refund-summary').textContent =
        `ห้อง ${payment.room_number} · คืน ${selectedRefundRate}% ของยอดที่ชำระ ${currency.format(Number(payment.amount) || 0)}`;
    refundDialog.showModal();
    refundBank.focus();
}

document.getElementById('refund-close').addEventListener('click', () => refundDialog.close());
refundDialog.addEventListener('close', () => { selectedRefund = null; });
refundBank.addEventListener('change', updateRefundAccountRules);
refundAccount.addEventListener('input', () => {
    validateRefundAccount();
    refundStatus.textContent = '';
});
refundAccount.addEventListener('invalid', () => { refundStatus.textContent = refundAccount.validationMessage; });
refundForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payment = selectedRefund;
    if (!payment || !userId) return;
    const currentRate = refundRate(payment);
    if (!currentRate) {
        refundStatus.textContent = 'อยู่ในช่วง 3 วันก่อนเข้าพักแล้ว ไม่สามารถขอคืนเงินได้';
        loadPayments();
        return;
    }
    if (currentRate !== selectedRefundRate) {
        selectedRefundRate = currentRate;
        document.getElementById('refund-summary').textContent =
            `ห้อง ${payment.room_number} · คืน ${currentRate}% ของยอดที่ชำระ ${currency.format(Number(payment.amount) || 0)}`;
        refundStatus.textContent = 'อัตราคืนเงินเปลี่ยนแล้ว กรุณาตรวจสอบและกดส่งคำขออีกครั้ง';
        return;
    }
    const account = refundAccount.value.trim();
    if (!validateRefundAccount()) {
        refundStatus.textContent = refundAccount.validationMessage || 'กรุณาตรวจสอบเลขที่บัญชีหรือหมายเลขพร้อมเพย์';
        return;
    }
    refundSubmit.disabled = true;
    refundStatus.textContent = 'กำลังส่งคำขอ...';
    try {
        const response = await fetch(`${API}/request_refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: userId, booking_id: String(payment.id),
                refund_bank: refundBank.value, refund_account: account,
            }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.status !== 'requested') {
            throw new Error(typeof result.detail === 'string' ? result.detail : 'ส่งคำขอคืนเงินไม่สำเร็จ กรุณาลองอีกครั้ง');
        }
        refundDialog.close();
        await loadPayments();
    } catch (error) {
        refundStatus.textContent = error instanceof TypeError
            ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง' : error.message;
    } finally {
        refundSubmit.disabled = false;
    }
});

function renderPagination(pageCount) {
    window.PakpingPagination.render(pagination, {
        pageCount, currentPage, controlsId: 'payments-list',
        onPage: (page) => { currentPage = page; render(); },
        scrollTarget: section,
    });
}

function render() {
    clearTimeout(declineRefreshTimer);
    clearTimeout(refundRefreshTimer);
    list.replaceChildren();
    tableWrap.hidden = !allPayments.length;
    if (!allPayments.length) {
        renderPagination(0);
        status.hidden = false;
        status.textContent = 'ยังไม่มีรายการจอง';
        return;
    }
    status.hidden = true;
    const pageCount = Math.ceil(allPayments.length / pageSize);
    currentPage = Math.min(Math.max(currentPage, 1), pageCount);
    const labels = {
        paid: 'รอตรวจสอบสลิป',
        pending: 'ยังไม่จ่าย',
        expired: 'หมดอายุ',
        ready: 'อนุมัติแล้ว',
        inhouse: 'กำลังเข้าพัก',
        decline: 'ปฏิเสธแล้ว',
        cancel: 'ยกเลิกแล้ว',
        missing: 'ไม่เข้าพัก',
        success: 'เช็คเอาต์แล้ว',
        refund_pending: 'คืนเงิน',
        refunded: 'คืนเงินแล้ว'
    };
    for (const payment of allPayments.slice((currentPage - 1) * pageSize, currentPage * pageSize)) {
        const expired = Number.isFinite(Date.parse(payment.expired_at)) && Date.parse(payment.expired_at) <= Date.now();
        const state = payment.payment_status === 'pending' && expired ? 'expired' : payment.payment_status;
        const row = document.createElement('tr');
        const room = document.createElement('td');
        room.className = 'payment-room';
        room.dataset.label = 'ห้อง';
        room.textContent = payment.room_number;
        const amount = document.createElement('td');
        amount.className = 'payment-amount';
        amount.dataset.label = 'จ่ายแล้ว';
        const paidAmount = document.createElement('strong');
        paidAmount.textContent = currency.format(Number(payment.amount) || 0);
        const fullAmount = document.createElement('small');
        fullAmount.textContent = `ยอดเต็ม ${currency.format(Number(payment.full_amount) || 0)}`;
        amount.append(paidAmount, document.createElement('br'), fullAmount);
        const dates = document.createElement('td');
        dates.className = 'payment-dates';
        dates.dataset.label = 'เข้าพัก';
        dates.textContent = `${payment.check_in} – ${payment.check_out}`;
        const stateCell = document.createElement('td');
        stateCell.dataset.label = 'สถานะ';
        const badge = document.createElement('span');
        badge.className = `payment-status ${state}`;
        badge.textContent = labels[state] || labels.expired;
        stateCell.append(badge);
        const action = document.createElement('td');
        action.className = 'payment-action';
        action.dataset.label = 'ดำเนินการ';

        if (state === 'decline' || state === 'cancel') {
            const reason = document.createElement('p');
            reason.className = 'payment-decline-reason';
            reason.textContent = `เหตุผล: ${payment.description || 'ไม่ได้ระบุเหตุผล'}`;
            action.append(reason);
        }
        if (state === 'decline') {
            const warning = document.createElement('p');
            warning.className = 'payment-decline-warning';
            const deadline = new Date(payment.expired_at);
            warning.textContent = expired
                ? 'ครบกำหนดเวลาส่งสลิปใหม่แล้ว รายการถูกยกเลิก'
                : `หากไม่ส่งสลิปใหม่ภายใน ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(deadline)} สถานะจะเปลี่ยนเป็นยกเลิก`;
            action.append(warning);
        }

        if ((state === 'pending' || (state === 'decline' && !expired)) && payment.qr_url) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'button button-green';
            button.textContent = state === 'decline' ? 'ส่งสลิปใหม่' : 'สแกนจ่าย';
            button.addEventListener('click', () => {
                if (Date.parse(payment.expired_at) <= Date.now()) {
                    loadPayments();
                    return;
                }
                window.dispatchEvent(new CustomEvent('pakping:open-payment', {
                    detail: {
                        booking: { id: payment.id, payment_due: payment.payment_due, expired_at: payment.expired_at },
                        qr_url: payment.qr_url,
                        retry: state === 'decline'
                   }
                }));
            });
            action.append(button);
        } else if (state === 'pending' || (state === 'decline' && !expired)) {
            const note = document.createElement('span');
            note.className = 'payment-action-note';
            note.textContent = state === 'decline' ? 'ไม่พบรูป QR กรุณาติดต่อที่พักเพื่อส่งสลิปใหม่' : 'ไม่พบรูป QR กรุณาติดต่อที่พัก';
            action.append(note);
        } else if (state !== 'decline' && state !== 'cancel' && state !== 'expired') {
            action.classList.add('is-empty');
            action.textContent = '—';
        }
        const approvedDeposit = state === 'ready' && payment.payment_method === 'partial_deposit';
        if (state === 'pending' || state === 'expired' || approvedDeposit) {
            if (approvedDeposit) action.replaceChildren();
            const cancelButton = document.createElement('button');
            cancelButton.type = 'button';
            cancelButton.className = 'button payment-cancel-button';
            cancelButton.textContent = 'ยกเลิกรายการ';
            cancelButton.disabled = cancellingBookingIds.has(String(payment.id));
            cancelButton.addEventListener('click', async () => {
                if (cancellingBookingIds.has(String(payment.id))) return;
                const confirmation = approvedDeposit
                    ? `ยกเลิกรายการจองห้อง ${payment.room_number} ใช่ไหม? ระบบจะบันทึกสถานะยกเลิก โดยไม่สร้างคำขอคืนเงิน`
                    : `ยกเลิกรายการจองห้อง ${payment.room_number} ใช่ไหม? รายการจองและรูป QR จะถูกลบ`;
                if (!window.confirm(confirmation)) return;
                cancellingBookingIds.add(String(payment.id));
                action.querySelectorAll('button').forEach(button => { button.disabled = true; });
                cancelButton.textContent = 'กำลังยกเลิก...';
                try {
                    const response = await fetch(`${API}/${approvedDeposit ? 'cancel_approved_deposit' : 'cancel_booking'}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ user_id: userId, booking_id: String(payment.id) })
                    });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok || result.status !== 'cancelled') {
                        const detail = result.detail;
                        throw new Error(typeof detail === 'string' ? detail : 'ยกเลิกรายการไม่สำเร็จ กรุณาลองอีกครั้ง');
                    }
                    await loadPayments();
                    if (!approvedDeposit && result.qr_cleanup_status === 'failed') {
                        window.alert('ยกเลิกรายการแล้ว แต่ลบรูป QR ไม่สำเร็จ กรุณาติดต่อที่พัก');
                    }
                } catch (error) {
                    const note = document.createElement('span');
                    note.className = 'payment-action-error';
                    note.setAttribute('role', 'alert');
                    note.textContent = error instanceof TypeError
                        ? 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ กรุณาลองอีกครั้ง'
                        : error.message;
                    action.append(note);
                    cancelButton.textContent = 'ยกเลิกรายการ';
                    action.querySelectorAll('button').forEach(button => { button.disabled = false; });
                } finally {
                    cancellingBookingIds.delete(String(payment.id));
                }
            });
            action.classList.remove('is-empty');
            action.append(cancelButton);
        }
        if (state === 'ready' && payment.payment_method === 'full_payment') {
            action.classList.remove('is-empty');
            action.replaceChildren();
            if (payment.refund_timestamp) {
                const note = document.createElement('small');
                note.className = 'payment-action-note';
                note.textContent = `ส่งคำขอคืนเงินแล้ว (${payment.refund_value}%)`;
                action.append(note);
            } else {
                const rate = refundRate(payment);
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'button payment-cancel-button';
                button.textContent = 'ขอคืนเงิน';
                button.disabled = rate === 0;
                button.addEventListener('click', () => openRefund(payment));
                action.append(button);
                const note = document.createElement('small');
                note.className = 'payment-action-note';
                note.textContent = rate
                    ? `คืน ${rate}% ของยอดที่ชำระ`
                    : 'อยู่ในช่วง 3 วันก่อนเข้าพักแล้ว ไม่สามารถขอคืนเงินได้';
                action.append(note);
            }
        }
        if ((state === 'refund_pending' || state === 'refunded') && payment.refund_timestamp) {
            action.classList.remove('is-empty');
            action.replaceChildren();
            const note = document.createElement('small');
            note.className = 'payment-action-note';
            note.textContent = state === 'refunded'
                ? `คืนเงินแล้ว (${payment.refund_value}%)`
                : `ส่งคำขอคืนเงินแล้ว (${payment.refund_value}%)`;
            action.append(note);
        }
        row.append(room, amount, dates, stateCell, action);
        list.append(row);
    }
    renderPagination(pageCount);
    const declinedDeadlines = allPayments
        .filter(payment => payment.payment_status === 'decline')
        .map(payment => Date.parse(payment.expired_at))
        .filter(Number.isFinite);
    if (declinedDeadlines.length) {
        const nextDeadline = Math.min(...declinedDeadlines);
        declineRefreshTimer = setTimeout(() => loadPayments(),
        nextDeadline > Date.now() ? Math.min(nextDeadline - Date.now() + 1000, 2147483647) : 15000);
    }
    const refundDeadlines = allPayments
        .filter(payment => payment.payment_status === 'ready'
            && payment.payment_method === 'full_payment' && !payment.refund_timestamp)
        .flatMap(payment => [168, 72].map(hours =>
            Date.parse(`${payment.check_in}T00:00:00+07:00`) - hours * 3600000))
        .filter(deadline => Number.isFinite(deadline) && deadline > Date.now());
    if (refundDeadlines.length) {
        refundRefreshTimer = setTimeout(render,
            Math.min(Math.min(...refundDeadlines) - Date.now() + 1000, 2147483647));
    }
}

async function loadPayments(attempt = 0) {
    clearTimeout(refundRefreshTimer);
    const version = ++requestVersion;
    list.replaceChildren();
    tableWrap.hidden = true;
    pagination.hidden = true;
    pagination.replaceChildren();
    status.hidden = false;
    if (!userId) {
        clearTimeout(declineRefreshTimer);
        declineRefreshTimer = null;
        allPayments = [];
        currentPage = 1;
        loadingUserId = null;
        loadedUserId = null;
        list.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
        status.textContent = 'เข้าสู่ระบบ LINE เพื่อดูรายการของคุณ';
        return;
    }
    const requestedUserId = userId;
    loadingUserId = requestedUserId;
    status.textContent = 'กำลังโหลดรายการ...';
    list.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    try {
        const response = await fetch(`${API}/list_user_payments?userId=${encodeURIComponent(requestedUserId)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('โหลดรายการชำระเงินไม่สำเร็จ');
        const data = await response.json();
        if (!Array.isArray(data.payments)) throw new Error('ข้อมูลรายการชำระเงินไม่ถูกต้อง');
        if (version === requestVersion && requestedUserId === userId) {
            loadedUserId = requestedUserId;
            allPayments = data.payments;
            currentPage = 1;
            render();
        }
    } catch {
        if (version === requestVersion && requestedUserId === userId) {
            if (attempt < 2) {
                status.textContent = 'กำลังลองโหลดรายการอีกครั้ง...';
                setTimeout(() => {
                    if (version === requestVersion && requestedUserId === userId) loadPayments(attempt +1);
                }, 1500 * (attempt + 1));
            } else {
                status.textContent = 'โหลดรายการไม่สำเร็จ กรุณาลองอีกครั้ง';
            }
        }
    } finally {
        if (version === requestVersion) {
            loadingUserId = null;
            list.setAttribute('aria-busy', 'false');
            refresh.disabled = false;
        }
    }
}

refresh.addEventListener('click', () => loadPayments());
window.addEventListener('pakping:user-changed', () => {
    if (refundDialog.open) refundDialog.close();
    loadPayments();
});
window.addEventListener('pakping:payments-changed', () => loadPayments());
window.addEventListener('hashchange', () => { if (location.hash === '#moments') loadPayments(); });
if (userId) loadPayments();
window.pakpingLineInit?.finally(() => {
    if (userId && loadedUserId !== userId && loadingUserId !== userId) loadPayments();
});
})();
