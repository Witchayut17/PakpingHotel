'use strict'

const $ = (id) => document.getElementById(id)
const BUCKET = 'https://rhhhqzqmctimhwjyvlts.supabase.co/storage/v1/object/public/Rooms/'
const API = 'https://ruth-participation-insulation-identifies.trycloudflare.com'
const money = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB', maximumFractionDigits: 0 })

let userId = ''
let lineId = ''
let rooms = []
let activeRoom = null
let selectedType = 'all'
let currentRoomPage = 1
const roomPageSize = 4
const compactRooms = window.matchMedia('(max-width: 700px)')
compactRooms.addEventListener('change', () => {
    currentRoomPage = 1
    if (rooms.length) renderRooms()
})
let deepLinkHandled = false
let liffReady = false
let toastTimer

function element(tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
}

function notify(message) {
    clearTimeout(toastTimer)
    $('account-status').textContent = message
    $('account-status').hidden = false
    toastTimer = setTimeout(() => { $('account-status').hidden = true }, 8000)
}

function roomPhoto(value) {
    if (typeof value !== 'string' || !value) return null
    try {
        const url = new URL(value, BUCKET)
        return url.href.startsWith(BUCKET) ? url.href : null
    } catch { return null }
}

function setPhoto(image, value, alt) {
    const src = roomPhoto(value)
    const container = image.parentElement
    image.alt = alt
    container.classList.remove('failed')
    image.onerror = () => container.classList.add('failed')
    if (src) image.src = src
    else {
        image.removeAttribute('src')
        container.classList.add('failed')
    }
}

function priceText(value) {
    return value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0
        ? money.format(Number(value)) : 'ติดต่อถามราคา'
}

function showRoom(room) {
    activeRoom = room
    $('detail-type').textContent = `ประเภท ${room.room_type}` || ''
    $('detail-name').textContent = `ห้อง ${room.room_name}` || `ห้อง ${room.room_number}`
    $('detail-description').textContent = `รายละเอียด : ${room.description}` || 'รายละเอียด'
    $('detail-price').textContent = priceText(room.price_per_night)
    $('detail-number').textContent = `ห้อง ${room.room_number}`
    setPhoto($('detail-image'), room.imageUrl, `${room.room_type} · ${room.room_name}`)
    if (!$('room-dialog').open) $('room-dialog').showModal()
}

function roomCard(room) {
    const card = element('article', 'room-card')
    const photoButton = element('button', 'card-photo photo-surface')
    photoButton.type = 'button'
    photoButton.setAttribute('aria-label', `ดูห้อง ${room.room_number}: ${room.room_name}`)
    const image = element('img')
    image.loading = 'lazy'
    image.width = 600
    image.height = 450
    photoButton.append(image, element('span', 'room-number', `ห้อง ${room.room_number}`))
    setPhoto(image, room.imageUrl, `${room.room_type} · ${room.room_name}`)
    photoButton.addEventListener('click', () => showRoom(room))
    const body = element('div', 'card-body')
    const title = element('h3', '', room.room_name || `ห้อง ${room.room_number}`)
    title.lang = 'th'
    const description = element('p', 'card-description', room.description || '')
    description.lang = 'th'
    const bottom = element('div', 'card-bottom')
    const price = element('p', 'price', priceText(room.price_per_night))
    price.append(element('span', 'price-note', ' / night'))
    const details = element('button', 'card-link', 'ดูรายละเอียดเพิ่มเติม')
    details.append(element('span', '', '↗'))
    details.setAttribute('aria-label', `ดูรายละเอียดห้อง ${room.room_number}`)
    details.addEventListener('click', () => showRoom(room))
    bottom.append(price, details)
    body.append(element('p', 'card-type', room.room_type || 'Room'), title, description, bottom)
    card.append(photoButton, body)
    return card
}

function renderRooms() {
    const visible = selectedType === 'all' ? rooms : rooms.filter(room => room.room_type === selectedType)
    const pageCount = compactRooms.matches ? Math.ceil(visible.length / roomPageSize) : 1
    currentRoomPage = Math.max(1, Math.min(currentRoomPage, pageCount))
    const start = (currentRoomPage - 1) * roomPageSize
    const pageRooms = compactRooms.matches ? visible.slice(start, start + roomPageSize) : visible
    $('room-grid').replaceChildren(...pageRooms.map(roomCard))
    window.PakpingPagination.render($('room-pagination'), {
        pageCount, currentPage: currentRoomPage, controlsId: 'room-grid',
        onPage: (page) => { currentRoomPage = page; renderRooms() },
        scrollTarget: $('room-toolbar'),
    })
    $('room-count').textContent = `ห้องทั้งหมด ${visible.length} ${visible.length === 1 ? 'room' : 'ห้อง'}`
    $('room-status').hidden = visible.length > 0
    if (!visible.length) $('room-status').textContent = 'ห้องเพิ่งถูกจัดการใหม่โปรด โหลดหน้าเว็บอีกครั้ง'
    document.querySelectorAll('.filter').forEach(button => {
        const active = button.dataset.type === selectedType
        button.classList.toggle('active', active)
        button.setAttribute('aria-pressed', String(active))
    })
}

function buildFilters() {
    const types = [...new Set(rooms.map(room => room.room_type).filter(Boolean))]
    const order = ['Standard', 'Deluxe', 'Suite']
    types.sort((a, b) => (order.includes(a) ? order.indexOf(a) : 99) - (order.includes(b) ? order.indexOf(b) : 99) || a.localeCompare(b))
    const buttons = [['all', 'All rooms'], ...types.map(type => [type, type])].map(([type, label]) => {
        const button = element('button', 'filter', label)
        button.dataset.type = type
        button.addEventListener('click', () => { selectedType = type; currentRoomPage = 1; renderRooms() })
        return button
    })
    $('room-filters').replaceChildren(...buttons)
}

function requestedRoom() {
    const params = new URLSearchParams(location.search)
    const state = params.get('liff.state')
    if (params.get('room')) return params.get('room')
    try { return state ? new URL(state, location.origin).searchParams.get('room') : null }
    catch { return null }
}

async function loadRooms() {
    $('retry').hidden = true
    $('room-status').hidden = false
    $('room-status').textContent = 'กำลังโหลดห้อง'
    $('room-grid').setAttribute('aria-busy', 'true')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 12000)
    try {
        const response = await fetch(`${API}/list_room`, { signal: controller.signal })
        if (!response.ok) throw new Error(`Room catalogue returned ${response.status}`)
        const data = await response.json()
        if (!Array.isArray(data.rooms)) throw new Error('Invalid room catalogue')
        rooms = data.rooms
        selectedType = 'all'
        currentRoomPage = 1
        buildFilters()
        renderRooms()
        if (!deepLinkHandled) {
            deepLinkHandled = true
            const number = requestedRoom()
            if (number) {
                const room = rooms.find(room => String(room.room_number).toLowerCase() === number.toLowerCase())
                if (room) showRoom(room)
                else notify('ห้องนี้ไม่พร้อมจอง กรุณาเลือกห้องอื่น')
            }
        }
    } catch (error) {
        $('room-status').textContent = 'โหลดห้องไม่สำเร็จกรุณาลองใหม่'
        $('room-status').hidden = false
        $('room-count').textContent = 'ห้องไม่พร้อมจองในขณะนี้'
        $('retry').hidden = false
        console.error('Room catalogue unavailable:', error)
    } finally {
        clearTimeout(timeout)
        $('room-grid').setAttribute('aria-busy', 'false')
    }
}

function waitForLiff() {
    if (window.liff) return Promise.resolve()
    return new Promise((resolve, reject) => {
        const sdk = $('liff-sdk')
        const timer = setTimeout(() => reject(new Error('LINE SDK หมดเวลา')), 8000)
        sdk.addEventListener('load', () => { clearTimeout(timer); resolve() }, { once: true })
        sdk.addEventListener('error', () => { clearTimeout(timer); reject(new Error('LINE SDK ไม่ติด')) }, { once: true })
    })
}

async function initLine() {
    $('login').disabled = true
    try {
        await waitForLiff()
        await liff.init({ liffId: '2012069184-52LHZkYs' })
        liffReady = true
        if (liff.isLoggedIn()) {
            const profile = await liff.getProfile()
            $('lineName').textContent = `${profile.displayName}`
            if (profile.pictureUrl) {
                $('lineImage').onerror = () => { $('lineImage').hidden = true }
                $('lineImage').src = profile.pictureUrl
                $('lineImage').hidden = false
            }
            $('lineProfile').hidden = false
            $('login').hidden = true
            $('logout').hidden = false
            console.log("login successfully", profile)
            userId = profile.userId
            window.dispatchEvent(new Event('pakping:user-changed'))
        } else {
            $('login').textContent = 'ลงชือเข้าใช้ด้วยไลน์'
        }
    } catch (error) {
        $('login').textContent = 'ลงชื่อเข้าใช้อีกครั้ง'
        console.warn('ลงชื่อเข้าใช้ไม่ได้ แต่ยังสามารถดูห้องได้ครับ', error)
    } finally {
        $('login').disabled = false
    }
}

$('login').addEventListener('click', async () => {
    try {
        if (!liffReady) await initLine()
        if (!liffReady) { notify('ลงชื่อเข้าใช้ไม่ได้ แต่ยังสามารถดูห้องได้ครับ'); return }
        if (!liff.isLoggedIn()) liff.login()
        else await initLine()
    } catch { notify('ลงชื่อเข้าใช้ไม่สำเร็จ ลองอีกครั้ง') }
})

$('logout').addEventListener('click', () => {
    try {
        liff.logout()
        userId = ''
        window.dispatchEvent(new Event('pakping:user-changed'))
        $('lineProfile').hidden = true
        $('logout').hidden = true
        $('lineImage').hidden = true
        $('lineImage').removeAttribute('src')
        $('lineName').textContent = ''
        $('login').textContent = 'ลงชื่อเข้าใช้ด้วยไลน์'
        $('login').hidden = false
        notify('คุณออกจากระบบแล้ว.')
    } catch { notify('เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง') }
})

$('retry').addEventListener('click', loadRooms)

document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()))

document.querySelectorAll('dialog').forEach(dialog => dialog.addEventListener('click', event => {
    if (event.target !== dialog) return
    const rect = dialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close()
}))

document.querySelectorAll('.gallery-tile').forEach(button => button.addEventListener('click', () => {
    const caption = button.dataset.caption
    setPhoto($('gallery-image'), `${BUCKET}${encodeURIComponent(button.dataset.photo)}`, caption)
    $('photo-caption').textContent = caption
    $('photo-dialog').showModal()
}))

document.querySelectorAll('.hero-photo img, .gallery-tile img').forEach(image => {
    const markFailure = () => { image.parentElement.classList.add('photo-surface', 'failed') }
    image.addEventListener('error', markFailure)
    if (image.complete && !image.naturalWidth) markFailure()
})

$('year').textContent = new Date().getFullYear()

loadRooms()
window.pakpingLineInit = initLine()
