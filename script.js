// ================================================================
// Sales Manager · Flipkart + Cashify
// Dual Firebase integration — Flipkart (default) + Cashify (secondary)
// ================================================================

// ==========================================
// FIREBASE CONFIG — FLIPKART (default app)
// ==========================================
const flipkartConfig = {
    apiKey: "AIzaSyDGJWdgj2GBL-44gXZ9W0mWnOfsczwPXdw",
    authDomain: "mobile-shop-9ea44.firebaseapp.com",
    databaseURL: "https://mobile-shop-9ea44-default-rtdb.firebaseio.com",
    projectId: "mobile-shop-9ea44",
    storageBucket: "mobile-shop-9ea44.firebasestorage.app",
    messagingSenderId: "902893829958",
    appId: "1:902893829958:web:f2f429ad9290c56f4d6f47",
    measurementId: "G-V4JQT7Z8T9"
};
firebase.initializeApp(flipkartConfig);
const flipkartDb = firebase.database();

// ==========================================
// FIREBASE CONFIG — CASHIFY (secondary app)
// ==========================================
const cashifyConfig = {
    apiKey: "AIzaSyD1XNPVJfKzPoNgxo5R33zxOCebH2H613w",
    authDomain: "cashify-1cea1.firebaseapp.com",
    databaseURL: "https://cashify-1cea1-default-rtdb.firebaseio.com",
    projectId: "cashify-1cea1",
    storageBucket: "cashify-1cea1.firebasestorage.app",
    messagingSenderId: "141846449557",
    appId: "1:141846449557:web:8afe3b2c843b1297a3fa9c",
    measurementId: "G-SNC5ELYPL6"
};
const cashifyApp = firebase.initializeApp(cashifyConfig, "cashifyApp");
const cashifyDb = cashifyApp.database();

// ==========================================
// SOURCE HELPERS
// ==========================================
function getDb(source) {
    return source === 'cashify' ? cashifyDb : flipkartDb;
}

function getSourceLabel(source) {
    return source === 'cashify' ? 'Cashify' : 'Flipkart';
}

// ==========================================
// COMMISSION BRACKETS (Flipkart only)
// ==========================================
const COMMISSION_BRACKETS = [
    { min: 0,     max: 10000,    type: 'percentage', value: 10   },
    { min: 10001, max: 31000,    type: 'percentage', value: 8    },
    { min: 31001, max: Infinity, type: 'fixed',      value: 2500 }
];

function calculateCommission(purchasePrice) {
    if (!purchasePrice || purchasePrice <= 0) return 0;
    for (const b of COMMISSION_BRACKETS) {
        if (purchasePrice >= b.min && purchasePrice <= b.max) {
            if (b.type === 'percentage') {
                return Math.round((purchasePrice * b.value) / 100);
            }
            return b.value;
        }
    }
    return 0;
}

// ==========================================
// HELPERS
// ==========================================
function getLocalYMD(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

function formatTimeShort(d = new Date()) {
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function refreshIcons() {
    if (window.lucide) {
        try { lucide.createIcons(); } catch (e) {}
    }
}

// ==========================================
// STATE
// ==========================================
let currentSource = 'flipkart';
let inventoryList = [];
let filteredInventory = [];
let sellOrderData = null;
let isRefreshing = false;

// Cache: overhead per phone for each source
const overheadCache = {
    flipkart: { ts: 0, value: 0 },
    cashify:  { ts: 0, value: 0 }
};
const OVERHEAD_TTL = 10 * 60 * 1000; // 10 minutes

// Last updated timestamp per source
const lastUpdatedBySource = { flipkart: null, cashify: null };

// ==========================================
// DOM REFS
// ==========================================
const toastEl = document.getElementById('toast');

// ==========================================
// TOAST
// ==========================================
function showToast(msg, type = 'info', duration = 3000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.className = 'toast-fixed ' + type;
    void toastEl.offsetWidth;
    toastEl.classList.add('show');
    clearTimeout(toastEl._timer);
    toastEl._timer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

// ==========================================
// CONNECTION STATUS
// ==========================================
function setupOfflineDetection() {
    const updateStatus = () => {
        const isOnline = navigator.onLine;
        const dot = document.getElementById('statusDot');
        const text = document.getElementById('statusText');
        const container = document.getElementById('connectionStatus');
        if (!container) return;
        if (isOnline) {
            container.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1 bg-green-50 rounded-full text-xs font-medium text-green-700';
            if (dot) dot.className = 'w-2 h-2 bg-green-500 rounded-full pulse-ring';
            if (text) text.textContent = 'Online';
        } else {
            container.className = 'hidden sm:flex items-center gap-1.5 px-3 py-1 bg-red-50 rounded-full text-xs font-medium text-red-700';
            if (dot) dot.className = 'w-2 h-2 bg-red-500 rounded-full';
            if (text) text.textContent = 'Offline';
        }
    };
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
    updateStatus();
}

// ==========================================
// SOURCE SWITCHING
// ==========================================
function switchSource(source) {
    if (source !== 'flipkart' && source !== 'cashify') return;
    if (currentSource === source) return;

    currentSource = source;

    // Update tabs
    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === source);
    });

    // Update stat card accents
    const accentClass = source === 'cashify' ? 'cashify-accent' : 'flipkart-accent';
    const statStock = document.getElementById('statCardStock');
    const statSold = document.getElementById('statCardSold');
    if (statStock) {
        statStock.classList.remove('flipkart-accent', 'cashify-accent');
        statStock.classList.add(accentClass);
    }
    if (statSold) {
        statSold.classList.remove('flipkart-accent', 'cashify-accent');
        statSold.classList.add(accentClass);
    }

    // Clear search when switching source
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.value = '';

    // Reset in-memory lists, reload
    inventoryList = [];
    filteredInventory = [];
    renderInventory();

    loadInventory();
}

// ==========================================
// LOAD INVENTORY (unsold pickups for current source)
// ==========================================
async function loadInventory() {
    const db = getDb(currentSource);
    showToast('🔄 Loading ' + getSourceLabel(currentSource) + ' inventory…', 'info', 1500);

    try {
        const snap = await db.ref('pickups').once('value');
        const data = snap.val() || {};

        inventoryList = Object.entries(data)
            .filter(([_, item]) => item.status === 'pickup' && !item.sold)
            .map(([id, item]) => ({ id, ...item, _source: currentSource }));

        inventoryList.sort((a, b) => {
            const ta = new Date(a.timestamp || 0).getTime() || 0;
            const tb = new Date(b.timestamp || 0).getTime() || 0;
            return tb - ta;
        });

        lastUpdatedBySource[currentSource] = Date.now();

        applySearch();
        updateStats(data);
        updateLastUpdatedLabel();
    } catch (e) {
        console.error('Inventory load error:', e);
        showToast('Error loading ' + getSourceLabel(currentSource) + ' inventory', 'error');
        const tbody = document.getElementById('inventoryTableBody');
        const cards = document.getElementById('inventoryCards');
        const errHtml = `<div class="empty-state"><i data-lucide="alert-circle"></i><p class="text-sm font-medium text-red-500">Failed to load inventory</p></div>`;
        if (cards) cards.innerHTML = errHtml;
        if (tbody) tbody.innerHTML = `<tr><td colspan="7">${errHtml}</td></tr>`;
        refreshIcons();
    }
}

// ==========================================
// STATS (In Stock + Sold) — from current source
// ==========================================
function updateStats(pickupsData) {
    if (!pickupsData) {
        // fetch fresh if not provided
        getDb(currentSource).ref('pickups').once('value').then(snap => {
            updateStats(snap.val() || {});
        }).catch(() => {});
        return;
    }

    let soldCount = 0;
    Object.values(pickupsData).forEach(item => {
        if (item.sold === true) soldCount++;
    });

    const elInv = document.getElementById('statInventory');
    const elSold = document.getElementById('statSold');
    if (elInv) elInv.textContent = inventoryList.length;
    if (elSold) elSold.textContent = soldCount;
}

function updateLastUpdatedLabel() {
    const el = document.getElementById('lastUpdated');
    if (!el) return;
    const ts = lastUpdatedBySource[currentSource];
    if (!ts) { el.textContent = ''; return; }
    el.textContent = 'Updated ' + formatTimeShort(new Date(ts));
}

// ==========================================
// SEARCH
// ==========================================
function applySearch() {
    const searchInput = document.getElementById('inventorySearch');
    const raw = (searchInput ? searchInput.value : '').trim().toLowerCase();

    if (!raw) {
        filteredInventory = [...inventoryList];
    } else {
        filteredInventory = inventoryList.filter(item => {
            const orderId = String(item.orderId || item.id || '').toLowerCase();
            const model = String(item.phoneModel || '').toLowerCase();
            const imei = String(item.imei || '').toLowerCase();
            const imei2 = String(item.imei2 || '').toLowerCase();
            const cust = String(item.customerName || '').toLowerCase();
            return orderId.includes(raw)
                || model.includes(raw)
                || imei.includes(raw)
                || imei2.includes(raw)
                || cust.includes(raw);
        });
    }

    renderInventory();

    const countEl = document.getElementById('inventoryCount');
    if (countEl) {
        countEl.textContent = filteredInventory.length + ' phone' + (filteredInventory.length === 1 ? '' : 's');
    }
}

function clearSearch() {
    const searchInput = document.getElementById('inventorySearch');
    if (searchInput) searchInput.value = '';
    applySearch();
}

// ==========================================
// RENDER — Mobile Cards + Desktop Table
// ==========================================
function renderInventory() {
    renderMobileCards();
    renderDesktopTable();
    refreshIcons();
}

function renderMobileCards() {
    const container = document.getElementById('inventoryCards');
    if (!container) return;

    if (!filteredInventory.length) {
        container.innerHTML = `
            <div class="empty-state">
                <i data-lucide="inbox"></i>
                <p class="text-sm font-medium">No inventory</p>
                <p class="text-xs text-gray-400 mt-1">Phones picked up will appear here</p>
            </div>
        `;
        return;
    }

    const srcClass = currentSource === 'cashify' ? 'cashify-src' : 'flipkart-src';
    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
    const pillLabel = getSourceLabel(currentSource);

    let html = '';
    filteredInventory.forEach(item => {
        const orderId = escapeHtml(item.orderId || item.id);
        const model = escapeHtml(item.phoneModel || '—');
        const imei = escapeHtml(item.imei || '—');
        const cust = escapeHtml(item.customerName || '—');

        html += `
            <div class="inventory-card ${srcClass}">
                <div class="flex items-start justify-between gap-2 mb-2 pl-2">
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-2 flex-wrap mb-1">
                            <span class="src-pill ${pillClass}"><span class="dot"></span>${pillLabel}</span>
                        </div>
                        <div class="font-mono font-bold text-gray-800 text-sm truncate">${orderId}</div>
                        <div class="text-sm text-gray-700 font-medium truncate mt-0.5">${model}</div>
                    </div>
                </div>
                <div class="pl-2 space-y-1 text-xs text-gray-500">
                    <div class="flex items-center gap-1.5">
                        <i data-lucide="hash" class="w-3 h-3 flex-shrink-0"></i>
                        <span class="font-mono truncate">${imei}</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <i data-lucide="user" class="w-3 h-3 flex-shrink-0"></i>
                        <span class="truncate">${cust}</span>
                    </div>
                </div>
                <div class="flex gap-2 mt-3 pl-2">
                    <button onclick="openSellModal('${item.id}')" class="btn-action success flex-1">
                        <i data-lucide="badge-dollar-sign"></i> Sell
                    </button>
                    <button onclick="viewOrderDetail('${item.id}')" class="btn-action view" title="View">
                        <i data-lucide="eye"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderDesktopTable() {
    const tbody = document.getElementById('inventoryTableBody');
    if (!tbody) return;

    if (!filteredInventory.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7">
                    <div class="empty-state">
                        <i data-lucide="inbox"></i>
                        <p class="text-sm font-medium">No inventory</p>
                    </div>
                </td>
            </tr>
        `;
        return;
    }

    const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';
    const pillLabel = getSourceLabel(currentSource);

    let html = '';
    filteredInventory.forEach((item, idx) => {
        const orderId = escapeHtml(item.orderId || item.id);
        const model = escapeHtml(item.phoneModel || '—');
        const imei = escapeHtml(item.imei || '—');
        const cust = escapeHtml(item.customerName || '—');

        html += `
            <tr class="border-b border-gray-50 hover:bg-gray-50 transition">
                <td class="py-3 px-4 text-gray-400 font-mono text-xs">${idx + 1}</td>
                <td class="py-3 px-4">
                    <span class="src-pill ${pillClass}"><span class="dot"></span>${pillLabel}</span>
                </td>
                <td class="py-3 px-4 font-mono font-bold text-gray-800 text-sm">${orderId}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${model}</td>
                <td class="py-3 px-4 font-mono text-xs text-gray-500">${imei}</td>
                <td class="py-3 px-4 text-gray-600 text-sm">${cust}</td>
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <button onclick="openSellModal('${item.id}')" class="btn-action success" style="padding:8px 14px;min-height:38px;font-size:12px;">
                            <i data-lucide="badge-dollar-sign" style="width:16px;height:16px;"></i> Sell
                        </button>
                        <button onclick="viewOrderDetail('${item.id}')" class="btn-action view" style="padding:8px 12px;min-height:38px;" title="View">
                            <i data-lucide="eye" style="width:16px;height:16px;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

// ==========================================
// OVERHEAD PER PHONE (used for finalNetProfit)
// Mirrors the admin panel's loadSales logic.
// ==========================================
async function computeOverheadPerPhone(source) {
    const db = getDb(source);

    const [usersSnap, attendanceSnap, pickupsSnap] = await Promise.all([
        db.ref('users').once('value'),
        db.ref('attendance').once('value'),
        db.ref('pickups').once('value')
    ]);

    const users = usersSnap.val() || {};
    const attendance = attendanceSnap.val() || {};
    const pickups = pickupsSnap.val() || {};

    const today = new Date();
    let totalOverhead = 0;

    // 1) Base salary overhead — per agent, per present day
    for (const [uname, uData] of Object.entries(users)) {
        const role = uData.role || 'agent';
        if (role !== 'agent') continue;

        const monthlySalary = Number(uData.salary) || 0;
        if (monthlySalary <= 0) continue;
        const perDaySalary = monthlySalary / 30;

        let joinDate = null;
        if (uData.joinDate) joinDate = new Date(uData.joinDate + 'T00:00:00');
        else if (uData.createdAt) joinDate = new Date(uData.createdAt);
        if (!joinDate || isNaN(joinDate)) joinDate = new Date(today);

        let cur = new Date(joinDate);
        while (cur <= today) {
            const ds = getLocalYMD(cur);
            const att = (attendance[uname] && attendance[uname][ds]) || {};
            const isPresent = att.status === 'present';
            const salaryCounted = att.salary_counted !== false;
            if (isPresent && salaryCounted) {
                totalOverhead += (att.half_day === true) ? perDaySalary * 0.5 : perDaySalary;
            }
            cur.setDate(cur.getDate() + 1);
        }
    }

    // 2) Add pickup + approved-reject incentives for agents
    let totalPickupIncentives = 0;
    let totalRejectIncentives = 0;

    Object.values(pickups).forEach(item => {
        if (!item || item.status === 'on_hold') return;
        const agent = item.agent;
        if (!agent) return;
        const uData = users[agent];
        if (!uData || (uData.role || 'agent') !== 'agent') return;

        if (item.status === 'pickup') {
            totalPickupIncentives += Number(uData.pickup_incentive) || 0;
        } else if (item.status === 'rejected' && Boolean(item.incentive_approved)) {
            totalRejectIncentives += Number(uData.reject_incentive) || 0;
        }
    });

    totalOverhead += totalPickupIncentives + totalRejectIncentives;

    // 3) Divide by total sold count
    let totalSold = 0;
    Object.values(pickups).forEach(item => {
        if (item && item.status === 'pickup' && item.sold) totalSold++;
    });

    return totalSold > 0 ? totalOverhead / totalSold : 0;
}

async function getOverheadPerPhone(source, force = false) {
    const cached = overheadCache[source];
    if (!force && cached && cached.value > 0 && (Date.now() - cached.ts < OVERHEAD_TTL)) {
        return cached.value;
    }
    try {
        const value = await computeOverheadPerPhone(source);
        overheadCache[source] = { ts: Date.now(), value };
        return value;
    } catch (e) {
        console.warn('Overhead calc failed:', e);
        return cached ? cached.value : 0;
    }
}

// ==========================================
// SELL MODAL
// ==========================================
function openSellModal(orderId) {
    const order = inventoryList.find(item => item.id === orderId);
    if (!order) {
        showToast('Order not found in inventory', 'error');
        return;
    }

    sellOrderData = order;

    document.getElementById('sellOrderId').value = order.orderId || order.id;
    document.getElementById('sellModel').value = order.phoneModel || '—';
    document.getElementById('sellImei').value = order.imei || '—';
    document.getElementById('sellCustomer').value = order.customerName || '—';
    document.getElementById('sellSalePrice').value = '';
    document.getElementById('sellBuyerName').value = '';
    document.getElementById('sellBuyerContact').value = '';
    document.getElementById('sellSaleDate').value = getLocalYMD();

    // Update source banner
    const banner = document.getElementById('sellSourceBanner');
    if (banner) {
        if (currentSource === 'cashify') {
            banner.style.background = '#E6FAF6';
            banner.style.color = '#0FA88B';
            banner.style.border = '1px solid #a7f3d0';
            banner.innerHTML = `
                <span style="display:flex;align-items:center;gap:8px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#12CAA7;display:inline-block;"></span>
                    Selling from Cashify
                </span>
                <span>CASHIFY</span>
            `;
        } else {
            banner.style.background = '#eef2ff';
            banner.style.color = '#4338ca';
            banner.style.border = '1px solid #c7d2fe';
            banner.innerHTML = `
                <span style="display:flex;align-items:center;gap:8px;">
                    <span style="width:8px;height:8px;border-radius:50%;background:#6366f1;display:inline-block;"></span>
                    Selling from Flipkart
                </span>
                <span>FLIPKART</span>
            `;
        }
    }

    const modal = document.getElementById('sellModal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    refreshIcons();

    setTimeout(() => {
        const inp = document.getElementById('sellSalePrice');
        if (inp) inp.focus();
    }, 300);
}

function closeSellModal() {
    const modal = document.getElementById('sellModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    sellOrderData = null;
}

// ==========================================
// CONFIRM SELL — writes to correct Firebase
// ==========================================
async function confirmSell() {
    if (!sellOrderData) return;

    const salePriceRaw = document.getElementById('sellSalePrice').value.trim();
    const buyerName = document.getElementById('sellBuyerName').value.trim();
    const buyerContact = document.getElementById('sellBuyerContact').value.trim();
    const saleDate = document.getElementById('sellSaleDate').value || getLocalYMD();

    const salePrice = parseFloat(salePriceRaw);

    if (!salePrice || salePrice <= 0 || isNaN(salePrice)) {
        showToast('Please enter a valid sale price', 'error');
        const inp = document.getElementById('sellSalePrice');
        if (inp) inp.focus();
        return;
    }
    if (!buyerName) {
        showToast('Please enter buyer name', 'error');
        const inp = document.getElementById('sellBuyerName');
        if (inp) inp.focus();
        return;
    }

    const order = sellOrderData;
    const source = currentSource;
    const sourceLabel = getSourceLabel(source);

    // ------- Build confirm dialog info -------
    const confirm = await Swal.fire({
        title: 'Confirm Sale',
        html: `
            <div style="text-align:left;font-size:14px;line-height:1.7;">
                <div style="margin-bottom:6px;">
                    <span style="display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:0.4px;
                        background:${source === 'cashify' ? '#E6FAF6' : '#eef2ff'};
                        color:${source === 'cashify' ? '#0FA88B' : '#4338ca'};
                        border:1px solid ${source === 'cashify' ? '#a7f3d0' : '#c7d2fe'};">
                        ${sourceLabel.toUpperCase()}
                    </span>
                </div>
                <p><strong>Order:</strong> ${escapeHtml(order.orderId || order.id)}</p>
                <p><strong>Model:</strong> ${escapeHtml(order.phoneModel || '—')}</p>
                <p><strong>Sale Price:</strong> ₹${salePrice.toLocaleString('en-IN')}</p>
                <p><strong>Buyer:</strong> ${escapeHtml(buyerName)}</p>
                <p><strong>Sale Date:</strong> ${escapeHtml(saleDate)}</p>
            </div>
        `,
        icon: 'question',
        showCancelButton: true,
        confirmButtonColor: '#059669',
        cancelButtonColor: '#64748b',
        confirmButtonText: '✅ Confirm Sale',
        cancelButtonText: 'Cancel'
    });

    if (!confirm.isConfirmed) return;

    // ------- Disable confirm button while saving -------
    const confirmBtn = document.getElementById('confirmSellBtn');
    const originalBtnHtml = confirmBtn ? confirmBtn.innerHTML : '';
    if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<span class="spinner-sm" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.35);"></span> Saving…';
    }

    try {
        // ------- Compute profit per source -------
        const overhead = await getOverheadPerPhone(source, false);
        const purchase = Number(order.value) || 0;

        let writePayload = {
            sold: true,
            salePrice: salePrice,
            buyerName: buyerName,
            buyerContact: buyerContact || '',
            saleDate: saleDate,
            saleTimestamp: new Date().toISOString()
        };

        if (source === 'flipkart') {
            // Flipkart: purchase + commission + grossProfit + finalNetProfit
            const commission = calculateCommission(purchase);
            const grossProfit = salePrice - purchase - commission;
            const finalProfit = grossProfit - overhead;

            writePayload.commission = commission;
            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = finalProfit;
            writePayload.profit = grossProfit; // match admin panel style
        } else {
            // Cashify: actual cost = value + coinTotalValue
            const coins = Number(order.coins) || 0;
            const rate = Number(order.coinValueRate) || 12.5;
            const coinsValue = (order.coinTotalValue !== undefined && order.coinTotalValue !== null)
                ? Number(order.coinTotalValue)
                : coins * rate;
            const actualCost = (order.actualTotalCost !== undefined && order.actualTotalCost !== null)
                ? Number(order.actualTotalCost)
                : purchase + coinsValue;

            const grossProfit = salePrice - actualCost;
            const finalProfit = grossProfit - overhead;

            writePayload.grossProfit = grossProfit;
            writePayload.finalNetProfit = finalProfit;
        }

        // ------- Write to correct Firebase -------
        const db = getDb(source);
        await db.ref('pickups/' + order.id).update(writePayload);

        showToast(`✅ Sold from ${sourceLabel} for ₹${salePrice.toLocaleString('en-IN')}`, 'success');

        closeSellModal();

        // ------- Reload current inventory + stats -------
        await loadInventory();

    } catch (e) {
        console.error('Sale error:', e);
        showToast('Error saving sale. Please try again.', 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.innerHTML = originalBtnHtml || '<i data-lucide="check-circle" class="w-4 h-4"></i> Confirm Sale';
            refreshIcons();
        }
    }
}

// ==========================================
// VIEW ORDER DETAIL
// ==========================================
async function viewOrderDetail(orderId) {
    const modal = document.getElementById('detailModal');
    const content = document.getElementById('detailContent');
    if (!modal || !content) return;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    content.innerHTML = `<div class="text-center py-8 text-gray-400"><span class="spinner-sm"></span><p class="text-sm mt-2">Loading...</p></div>`;

    try {
        const db = getDb(currentSource);
        const snap = await db.ref('pickups/' + orderId).once('value');
        const item = snap.val();

        if (!item) {
            content.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="alert-circle"></i>
                    <p class="text-sm font-medium">Order not found</p>
                </div>
            `;
            refreshIcons();
            return;
        }

        const statusLabel = item.status || 'unknown';
        const isSold = item.sold === true;

        const statusDisplay = isSold ? 'Sold'
            : statusLabel === 'pickup' ? 'Pickup'
            : statusLabel === 'rejected' ? 'Rejected'
            : 'Pending';

        const statusClass = isSold ? 'sold'
            : statusLabel === 'pickup' ? 'available'
            : 'rejected';

        const sourceLabel = getSourceLabel(currentSource);
        const pillClass = currentSource === 'cashify' ? 'cashify' : 'flipkart';

        let saleHtml = '';
        if (isSold) {
            saleHtml = `
                <div class="detail-item">
                    <div class="label">Sale Price</div>
                    <div class="value">₹${Number(item.salePrice || 0).toLocaleString('en-IN')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Buyer</div>
                    <div class="value">${escapeHtml(item.buyerName || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Buyer Contact</div>
                    <div class="value">${escapeHtml(item.buyerContact || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Sale Date</div>
                    <div class="value">${escapeHtml(item.saleDate || '—')}</div>
                </div>
            `;
        }

        const ramStorage = item.ramStorage
            ? escapeHtml(item.ramStorage)
            : (item.ram && item.storage ? escapeHtml(item.ram + ' / ' + item.storage) : '—');

        const html = `
            <div class="flex items-center gap-2 flex-wrap mb-4">
                <span class="badge-status ${statusClass} text-sm px-4 py-1.5">${statusDisplay}</span>
                <span class="src-pill ${pillClass}"><span class="dot"></span>${sourceLabel}</span>
                <span class="font-mono font-bold text-gray-800 text-sm">${escapeHtml(item.orderId || orderId)}</span>
            </div>

            <div class="detail-grid">
                <div class="detail-item">
                    <div class="label">Phone Model</div>
                    <div class="value">${escapeHtml(item.phoneModel || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">IMEI</div>
                    <div class="value font-mono text-xs">${escapeHtml(item.imei || '—')}</div>
                </div>
                ${item.imei2 ? `
                    <div class="detail-item">
                        <div class="label">IMEI 2</div>
                        <div class="value font-mono text-xs">${escapeHtml(item.imei2)}</div>
                    </div>
                ` : ''}
                <div class="detail-item">
                    <div class="label">RAM / Storage</div>
                    <div class="value">${ramStorage}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Network</div>
                    <div class="value">${escapeHtml(item.networkType || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Customer</div>
                    <div class="value">${escapeHtml(item.customerName || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Reason</div>
                    <div class="value">${escapeHtml(item.reason || '—')}</div>
                </div>
                <div class="detail-item">
                    <div class="label">Time (IST)</div>
                    <div class="value text-xs">${escapeHtml(item.timestampIST || item.timestamp || '—')}</div>
                </div>
                ${item.agent ? `
                    <div class="detail-item">
                        <div class="label">Agent</div>
                        <div class="value">${escapeHtml(item.agent)}</div>
                    </div>
                ` : ''}
                ${saleHtml}
            </div>
        `;

        content.innerHTML = html;
        refreshIcons();

    } catch (err) {
        console.error('Detail load error:', err);
        content.innerHTML = `
            <div class="empty-state">
                <i data-lucide="alert-circle"></i>
                <p class="text-sm font-medium text-red-500">Error loading details</p>
            </div>
        `;
        refreshIcons();
        showToast('Error loading order details', 'error');
    }
}

function closeDetailModal() {
    const modal = document.getElementById('detailModal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
}

// ==========================================
// REFRESH
// ==========================================
async function refreshInventory() {
    if (isRefreshing) return;
    isRefreshing = true;

    showToast('🔄 Refreshing…', 'info', 1200);

    // Force fresh overhead on next sale
    overheadCache[currentSource] = { ts: 0, value: 0 };

    await loadInventory();

    isRefreshing = false;
    showToast('✅ Refreshed', 'success', 1500);
}

// ==========================================
// INIT
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    setupOfflineDetection();
    refreshIcons();

    // Ensure source tabs state is consistent with currentSource
    document.querySelectorAll('#sourceTabs .source-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.source === currentSource);
    });

    // Initial load
    loadInventory();

    // Auto-refresh every 60 seconds
    setInterval(() => {
        if (document.hidden) return;
        loadInventory();
    }, 60000);

    showToast('👋 Sales Manager ready', 'info', 2000);
    console.log('✅ Sales Manager (dual-source) initialized');
});

// ==========================================
// MODAL OUTSIDE-CLICK + ESC
// ==========================================
const sellModalEl = document.getElementById('sellModal');
if (sellModalEl) {
    sellModalEl.addEventListener('click', function (e) {
        if (e.target === this) closeSellModal();
    });
}

const detailModalEl = document.getElementById('detailModal');
if (detailModalEl) {
    detailModalEl.addEventListener('click', function (e) {
        if (e.target === this) closeDetailModal();
    });
}

document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeSellModal();
        closeDetailModal();
    }
});

// ==========================================
// EXPOSE FOR INLINE HANDLERS
// ==========================================
window.switchSource = switchSource;
window.applySearch = applySearch;
window.clearSearch = clearSearch;
window.openSellModal = openSellModal;
window.closeSellModal = closeSellModal;
window.confirmSell = confirmSell;
window.viewOrderDetail = viewOrderDetail;
window.closeDetailModal = closeDetailModal;
window.refreshInventory = refreshInventory;