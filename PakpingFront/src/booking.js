'use strict';

(() => {
    const get = id => document.getElementById(id)
    const form = get('booking-form')
    const dialog = get('booking-dialog')
    const startInput = get('booking-check-in')
    const endInput = get('booking-check-out')
    let ranges = []
    let ready = false
    let submitting = false
    let completed = false
    let uploadingSlip = false
    let activeBookingId = null
    let activeRetryDeadline = null
    let revision = 0
    let dateField = startInput
    let month

    const iso = date => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
    const today = () => iso(new Date(Date.now() + 7 * 60 * 60 * 1000))
    const overlaps = (start, end) => ranges.some(stay => start < stay.check_out && end > stay.check_in)
    const validStay = () => startInput.value >= today() && endInput.value > startInput.value && !overlaps(startInput.value, endInput.value)

    function resetPayment() {
        activeBookingId = null
        activeRetryDeadline = null
        get('booking-slip-form').reset()
        get('booking-slip-image').disabled = false
        get('booking-slip-submit').disabled = false
        get('booking-slip-status').textContent = ''
        form.hidden = false
        get('booking-intro').hidden = false
        get('booking-qr').hidden = true
        get('booking-qr-error').hidden = true
        get('booking-qr-image').removeAttribute('src')
        get('booking-qr-link').removeAttribute('href')
    }

    function showPayment(result) {
        let url
        try {
            url = new URL(result.qr_url)
            if (!['https:', 'http:'].includes(url.protocol)) return false
        } catch { return false }

        const booking = result.booking || {}
        activeBookingId = booking.id ?? booking._id ?? null
        activeRetryDeadline = result.retry ? Date.parse(booking.expired_at) : null
        get('booking-slip-submit').disabled = !activeBookingId
        const image = get('booking-qr-image')

        image.hidden = false
        image.onload = () => { get('booking-qr-error').hidden = true }
        image.onerror = () => {
            image.hidden = true
            get('booking-qr-error').hidden = false
        }
        image.src = url.href

        get('booking-qr-link').href = url.href
        get('booking-qr-status').textContent = result.retry
            ? 'สลิปเดิมถูกปฏิเสธ กรุณาตรวจสอบยอดชำระและแนบสลิปใหม่ด้านล่าง'
            : 'สร้างรายการจองแล้ว กรุณาชำระเงินตาม QR และแนบสลิปด้านล่าง'

        const amount = Number(booking.payment_due)
        get('booking-qr-amount').textContent = booking.payment_due != null && Number.isFinite(amount)
            ? `ยอดชำระ ${new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' }).format(amount)}` : ''

        const expiry = new Date(booking.expired_at)
        get('booking-qr-expiry').textContent = result.retry
            ? `ส่งสลิปใหม่ภายใน ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(expiry)} (เวลาไทย) หากไม่ส่งทันเวลา สถานะจะเปลี่ยนเป็นยกเลิก`
            : Number.isFinite(expiry.getTime())
                ? `ชำระภายใน ${new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(expiry)} (เวลาไทย)`
                : 'กรุณาชำระเงินภายใน 5 นาทีหลังสร้างรายการ'

        form.hidden = true
        get('booking-intro').hidden = true
        get('booking-qr').hidden = false
        dialog.scrollTop = 0
        get('booking-qr-title').focus({ preventScroll: true })
        return true
    }

    function canSelect(day) {
        if (!ready || submitting || completed || day < today()) return false
        if (dateField === startInput) return !ranges.some(stay => day >= stay.check_in && day < stay.check_out)
        return Boolean(startInput.value && day > startInput.value && !overlaps(startInput.value, day))
    }

    function updateSubmit() {
        get('booking-submit').disabled = !ready || submitting || completed || !validStay() || !form.querySelector('[name="action"]:checked')
        startInput.disabled = endInput.disabled = !ready || submitting || completed
    }

    form.querySelectorAll('[name="action"]').forEach(input => input.addEventListener('change', () => {
        if (input.checked) form.querySelectorAll('[name="action"]').forEach(other => { if (other !== input) other.checked = false })
        updateSubmit()
    }))

    function drawCalendar() {
        get('calendar-month').textContent = new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(month)
        get('calendar-prev').disabled = iso(month).slice(0, 7) <= today().slice(0, 7)
        const days = get('calendar-days')
        days.replaceChildren()
        for (let i = 0; i < month.getUTCDay(); i++) days.append(document.createElement('span'))
        const count = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0)).getUTCDate()
        for (let day = 1; day <= count; day++) {
            const value = iso(new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth(), day)))
            const button = document.createElement('button')
            button.type = 'button'
            button.textContent = day
            button.disabled = !canSelect(value)
            button.setAttribute('aria-label', value)
            button.setAttribute('aria-pressed', String(dateField.value === value))
            if (value === today()) button.setAttribute('aria-current', 'date')
            button.addEventListener('click', () => {
                dateField.value = value
                if (dateField === startInput) {
                    if (!validStay()) endInput.value = ''
                    openCalendar(endInput)
                    get('booking-status').textContent = 'เลือกวันออกหลังวันเข้าพัก'
                } else {
                    closeCalendar()
                    endInput.focus()
                    get('booking-status').textContent = 'ช่วงวันที่เลือกว่าง พร้อมยืนยันการจอง'
                }
                updateSubmit()
            })
            days.append(button)
        }
    }

    function closeCalendar() {
        get('booking-calendar').hidden = true
        startInput.setAttribute('aria-expanded', 'false')
        endInput.setAttribute('aria-expanded', 'false')
    }

    function openCalendar(input) {
        if (!ready || submitting || completed) return
        if (input === endInput && !startInput.value) input = startInput
        dateField = input
        const value = input.value || startInput.value || today()
        month = new Date(`${value.slice(0, 7)}-01T00:00:00Z`)
        closeCalendar()
        input.setAttribute('aria-expanded', 'true')
        get('booking-calendar').hidden = false
        get('booking-calendar').setAttribute('aria-label', input === startInput ? 'เลือกวันเข้าพัก' : 'เลือกวันออก')
        drawCalendar()
        get('calendar-days').querySelector('button:not(:disabled)')?.focus()
    }

    for (const input of [startInput, endInput]) {
        input.addEventListener('click', () => openCalendar(input))
        input.addEventListener('keydown', event => {
            if (['Enter', ' ', 'ArrowDown'].includes(event.key)) {
                event.preventDefault()
                openCalendar(input)
            }
        })
    }

    for (const [id, delta] of [['calendar-prev', -1], ['calendar-next', 1]]) {
        get(id).addEventListener('click', () => {
            month = new Date(Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + delta, 1))
            drawCalendar()
        })
    }

    async function refreshAvailability() {
        const version = ++revision
        ready = false
        closeCalendar()
        updateSubmit()
        get('booking-retry').hidden = true
        get('booking-status').textContent = 'กำลังตรวจสอบวันว่าง'
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 12000)
        try {
            const response = await fetch(`${API}/room_availability?room_number=${encodeURIComponent(get('booking-room').value)}`, { signal: controller.signal, cache: 'no-store' })
            if (!response.ok) throw new Error('Availability unavailable')
            const data = await response.json()
            if (!Array.isArray(data.booked_ranges) || data.booked_ranges.some(stay => !/^\d{4}-\d{2}-\d{2}$/.test(stay.check_in) || !/^\d{4}-\d{2}-\d{2}$/.test(stay.check_out) || stay.check_out <= stay.check_in)) throw new Error('Invalid availability')
            if (version !== revision) return false
            ranges = data.booked_ranges
            ready = true
            get('booking-status').textContent = 'เลือกวันเข้าพักและวันออกได้เลย'
            return true
        } catch {
            if (version !== revision) return false
            get('booking-status').textContent = 'โหลดวันว่างไม่สำเร็จ กรุณาลองอีกครั้งก่อนเลือกวัน'
            get('booking-retry').hidden = false
            return false
        } finally {
            clearTimeout(timer)
            if (version === revision) updateSubmit()
        }
    }

    get('open-booking').addEventListener('click', async () => {
        if (!activeRoom || submitting) return
        form.reset()
        resetPayment()
        completed = false
        get('booking-submit').textContent = 'ยืนยันการจอง'
        get('booking-room').value = activeRoom.room_number
        get('room-dialog').close()
        dialog.showModal()
        refreshAvailability()
    })

    get('booking-retry').addEventListener('click', refreshAvailability)
    window.addEventListener('pakping:open-payment', event => {
        if (dialog.open || submitting || uploadingSlip) return
        resetPayment()
        completed = true
        dialog.showModal()
        if (!showPayment(event.detail)) dialog.close()
    })

    get('booking-slip-form').addEventListener('submit', async event => {
        event.preventDefault()
        if (uploadingSlip || !activeBookingId) return

        const file = get('booking-slip-image').files[0]
        const status = get('booking-slip-status')
        if (activeRetryDeadline !== null && activeRetryDeadline <= Date.now()) {
            status.textContent = 'ครบกำหนดเวลาส่งสลิปใหม่แล้ว รายการนี้จะเปลี่ยนเป็นยกเลิกและไม่สามารถส่งสลิปใหม่ได้'
            window.dispatchEvent(new Event('pakping:payments-changed'))
            return
        }
        if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
            status.textContent = 'กรุณาเลือกรูปสลิป JPG, PNG หรือ WebP ขนาดไม่เกิน 5 MB'
            return
        }
        if (!userId) {
            status.textContent = 'กรุณาเข้าสู่ระบบ LINE ก่อนส่งสลิป'
            return
        }

        uploadingSlip = true
        get('booking-slip-submit').disabled = true
        get('booking-slip-image').disabled = true
        dialog.querySelector('[data-close]').disabled = true
        status.textContent = 'กำลังส่งสลิป...'
        try {
            const image = await new Promise((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(reader.result)
                reader.onerror = () => reject(new Error('read failed'))
                reader.readAsDataURL(file)
            })
            const response = await fetch(`${API}/post_slip`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, bookingId: String(activeBookingId), image })
            })
            if (!response.ok) {
                status.textContent = response.status === 409
                    ? (activeRetryDeadline !== null ? 'หมดเวลาส่งสลิปใหม่หรือรายการเปลี่ยนสถานะแล้ว กรุณารีเฟรชรายการ' : 'รายการจองหมดอายุหรือส่งสลิปไปแล้ว กรุณารีเฟรชรายการหรือติดต่อที่พัก')
                    : 'ส่งสลิปไม่สำเร็จ กรุณาลองอีกครั้ง'
                return
            }
            status.textContent = 'ได้รับสลิปแล้ว กรุณารอเจ้าหน้าที่ตรวจสอบ'
            get('booking-slip-image').disabled = true
            get('booking-slip-submit').disabled = true
            window.dispatchEvent(new Event('pakping:payments-changed'))
        } catch {
            status.textContent = 'ส่งสลิปไม่สำเร็จ กรุณาลองอีกครั้ง'
        } finally {
            uploadingSlip = false
            dialog.querySelector('[data-close]').disabled = false
            if (!status.textContent.startsWith('ได้รับสลิปแล้ว')) {
                get('booking-slip-image').disabled = false
                get('booking-slip-submit').disabled = false
            }
        }
    })

    dialog.addEventListener('close', () => { revision++; closeCalendar() })
    dialog.addEventListener('cancel', event => { if (submitting || uploadingSlip) event.preventDefault() })
    dialog.addEventListener('click', event => {
        if (submitting && event.target === dialog) event.stopImmediatePropagation()
    }, true)

    form.addEventListener('submit', async event => {
        event.preventDefault()
        if (submitting || completed || !ready || !validStay() || !form.reportValidity()) return
        const payload = Object.fromEntries(new FormData(form))

        payload.user_name = payload.user_name.trim()
        payload.user_phone = payload.user_phone.trim()
        payload.user_id = userId

        if (!['full_payment', 'partial_deposit'].includes(payload.action)) return
        if (!payload.user_id) {
            get('booking-status').textContent = 'กรุณาลงชื่อเข้าใช้ LINE ก่อนยืนยันการจอง'
            return
        }
        if (!payload.user_name || !/^[0-9]{10}$/.test(payload.user_phone)) {
            get('booking-status').textContent = 'กรุณากรอกชื่อและเบอร์โทรศัพท์ 10 หลัก'
            return
        }

        submitting = true
        dialog.querySelector('[data-close]').disabled = true
        updateSubmit()

        try {
            if (!await refreshAvailability()) return
            if (!validStay()) {
                endInput.value = ''
                get('booking-status').textContent = 'ช่วงวันนี้เพิ่งถูกจอง กรุณาเลือกวันใหม่'
                return
            }

            get('booking-status').textContent = 'กำลังยืนยันการจอง กรุณารอสักครู่…'
            const response = await fetch(`${API}/post_booking`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
            })

            const result = await response.json()

            if (response.ok || result.detail?.booking) {
                completed = true
                get('booking-submit').textContent = 'สร้างรายการจองแล้ว'
                get('booking-status').textContent = response.ok
                    ? 'สร้างรายการจองแล้ว กรุณาชำระเงินและแนบสลิปภายใน 5 นาที'
                    : (result.detail.message || 'สร้างรายการจองแล้ว แต่ดำเนินการไม่ครบ กรุณาติดต่อที่พัก ไม่ต้องจองซ้ำ')
                showPayment(response.ok ? result : result.detail)
                window.dispatchEvent(new Event('pakping:payments-changed'))
            }

            else if (response.status === 409) {
                if (result.detail?.code === 'pending_booking_exists') {
                    get('booking-status').textContent = result.detail.message || 'กรุณาไปที่รายการของฉันและทำรายการเดิมให้เสร็จก่อนจองใหม่'
                } else {
                    await refreshAvailability()
                    endInput.value = ''
                    get('booking-status').textContent = 'ห้องถูกจองในช่วงวันที่เลือก กรุณาเลือกวันใหม่'
                }
            }

            else if (response.status >= 500) {
                throw new Error('ไม่ทราบการจองนี้')
            }

            else {
                get('booking-status').textContent = typeof result.detail === 'string' ? result.detail : 'จองไม่สำเร็จ กรุณาตรวจสอบข้อมูลหรือรายการค้างชำระ'
            }
        }

        catch {
            completed = true
            get('booking-status').textContent = 'ยังยืนยันผลรายการไม่ได้ กรุณาติดต่อที่พักก่อนจองซ้ำ'
        }

        finally {
            submitting = false
            dialog.querySelector('[data-close]').disabled = false
            updateSubmit()
        }
    })
})()
