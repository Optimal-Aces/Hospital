import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } 
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, update, onChildAdded } 
    from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

// ── CONFIGURATION ─────────────────────────────────────────────
const firebaseConfig = {
    apiKey: "AIzaSyDIREAXDfSg_uUgzvjXId0mYSrFdeHvD7I",
    authDomain: "v-rescue-0410.firebaseapp.com",
    databaseURL: "https://v-rescue-0410-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "v-rescue-0410",
    storageBucket: "v-rescue-0410.firebasestorage.app",
    messagingSenderId: "175999345052",
    appId: "1:175999345052:web:f716950e372ed84117e859",
    measurementId: "G-3ELM7ZF9HS"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

// Dashboard State
let hospitalId = "";
let hospitalData = {};
let activeRequestId = "";

// ── AUTH GUARD & INITIALIZATION ──────────────────────────────
onAuthStateChanged(auth, async (user) => {
    const isLoginPage = !!document.getElementById("form-login");
    const isDashboardPage = !!document.getElementById("requests-container");

    if (user) {
        hospitalId = user.uid;
        
        if (isLoginPage) {
            const snap = await get(ref(db, "Hospitals/" + user.uid));
            if (snap.exists() && snap.val().approved) {
                window.location.href = "dashboard.html";
            }
        }

        if (isDashboardPage) {
            await loadHospitalData();
            listenForPatientRequests();
            loadPastPatients();
        }
    } else {
        if (isDashboardPage) {
            window.location.href = "index.html";
        }
    }
});

// ── AUTH FUNCTIONS ────────────────────────────────────────────
window.switchTab = function(tab) {
    const loginForm = document.getElementById("form-login");
    const regForm = document.getElementById("form-register");
    if (!loginForm || !regForm) return;

    loginForm.style.display = tab === "login" ? "block" : "none";
    regForm.style.display = tab === "register" ? "block" : "none";
    document.getElementById("tab-login").classList.toggle("active", tab === "login");
    document.getElementById("tab-register").classList.toggle("active", tab === "register");
};

window.loginHospital = async function() {
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value.trim();
    const errEl = document.getElementById("login-error");
    const btn = document.getElementById("btn-login");

    if (!email || !password) {
        errEl.textContent = "Please fill all fields.";
        return;
    }

    btn.disabled = true;
    btn.textContent = "LOGGING IN...";
    errEl.textContent = "";

    try {
        const cred = await signInWithEmailAndPassword(auth, email, password);
        const snap = await get(ref(db, "Hospitals/" + cred.user.uid));

        if (!snap.exists()) {
            errEl.textContent = "No hospital account found.";
            btn.disabled = false;
            btn.textContent = "LOGIN";
            await signOut(auth);
            return;
        }

        if (!snap.val().approved) {
            errEl.textContent = "Account pending dispatcher approval.";
            btn.disabled = false;
            btn.textContent = "LOGIN";
            await signOut(auth);
            return;
        }

        window.location.href = "dashboard.html";
    } catch (err) {
        errEl.textContent = "Invalid credentials or network error.";
        btn.disabled = false;
        btn.textContent = "LOGIN";
    }
};

window.registerHospital = async function() {
    const name = document.getElementById("reg-name").value.trim();
    const phone = document.getElementById("reg-phone").value.trim();
    const barangay = document.getElementById("reg-barangay").value;
    const totalBeds = parseInt(document.getElementById("reg-total-beds").value) || 0;
    const email = document.getElementById("reg-email").value.trim();
    const password = document.getElementById("reg-password").value.trim();
    const errEl = document.getElementById("reg-error");
    const btn = document.getElementById("btn-register");

    if (!name || !phone || !barangay || !email || !password || totalBeds < 1) {
        errEl.textContent = "Please fill all fields.";
        return;
    }

    btn.disabled = true;
    btn.textContent = "CREATING ACCOUNT...";
    errEl.textContent = "";

    try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const uid = cred.user.uid;

        const BARANGAY_COORDS = {
            "Poblacion": { lat: 7.9064, lon: 125.0931 },
            "Bagontaas": { lat: 7.9422, lon: 125.0952 },
            "Maapag": { lat: 7.8601, lon: 125.1174 },
            "Guinoyoran": { lat: 7.9150, lon: 125.0130 },
            "Lumbo": { lat: 7.8920, lon: 125.0980 },
            "Mailag": { lat: 7.9710, lon: 125.1050 },
            "Sinayawan": { lat: 7.8420, lon: 125.0930 },
            "Tongantongan": { lat: 7.8750, lon: 125.0620 },
            "Laligan": { lat: 7.9350, lon: 125.0450 },
            "Catumbalon": { lat: 7.9210, lon: 125.1450 },
        };

        const coords = BARANGAY_COORDS[barangay] || { lat: 7.9064, lon: 125.0931 };

        await set(ref(db, "Hospitals/" + uid), {
            name: name,
            phone: phone,
            barangay: barangay,
            email: email,
            latitude: coords.lat,
            longitude: coords.lon,
            totalBeds: totalBeds,
            availableBeds: totalBeds,
            erStatus: "Available",
            approved: false,
            uid: uid,
        });

        errEl.style.color = "#00E676";
        errEl.textContent = "Account created! Waiting for dispatcher approval.";
        btn.disabled = false;
        btn.textContent = "CREATE ACCOUNT";
    } catch (err) {
        errEl.textContent = err.message;
        btn.disabled = false;
        btn.textContent = "CREATE ACCOUNT";
    }
};


// ── DASHBOARD FUNCTIONS ───────────────────────────────────────
let allRequests = [];
let currentFilter = "ALL";
let selectedRequestId = "";
const modalShownRequests = new Set();

function normalizeRequestStatus(status) {
    const s = String(status || "PENDING").toUpperCase();
    if (s === "HOSPITAL_ACCEPTED" || s === "HOSPITAL_BOUND") return "ACCEPTED";
    if (s === "HOSPITAL_READY") return "READY";
    if (s === "PATIENT_RECEIVED" || s === "ARRIVED_HOSPITAL") return "COMPLETED";
    return s;
}

async function loadHospitalData() {
    const snap = await get(ref(db, "Hospitals/" + hospitalId));
    if (!snap.exists()) return;

    hospitalData = snap.val();
    applyHospitalDataToUI(hospitalData);

    onValue(ref(db, "Hospitals/" + hospitalId), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        hospitalData = data;
        applyHospitalDataToUI(data);
    });
}

function applyHospitalDataToUI(data) {
    setText("header-hospital-name", data.name || "Hospital");
    setText("info-name", data.name || "—");
    setText("info-barangay", data.barangay || "—");
    setText("info-phone", data.phone || "—");
    setText("info-approval", data.approved ? "✅ Approved" : "⏳ Pending");
    setText("available-beds", data.availableBeds ?? "—");
    setText("total-beds", data.totalBeds ?? "—");
    setText("beds-summary", `${data.availableBeds ?? "—"}/${data.totalBeds ?? "—"}`);

    const erToggle = document.getElementById("er-toggle");
    const isAvailable = data.erStatus === "Available";
    if (erToggle) erToggle.checked = isAvailable;
    updateERStatusUI(isAvailable);
}

async function loadPastPatients() {
    const logDiv = document.getElementById("patient-log");
    const requestsRef = ref(db, "PatientRequests");

    onValue(requestsRef, (snapshot) => {
        if (!logDiv) return;
        logDiv.innerHTML = "";
        const data = [];

        snapshot.forEach(child => {
            const req = child.val();
            if (req.hospitalId === hospitalId && req.status === "COMPLETED") {
                data.push(req);
            }
        });

        if (!data.length) {
            logDiv.innerHTML = '<p class="empty-log">No history found.</p>';
            return;
        }

        data.sort((a, b) => (b.completedAt || b.timestamp || 0) - (a.completedAt || a.timestamp || 0));
        data.slice(0, 8).forEach(req => addToPatientLog(req));
    });
}

window.toggleERStatus = function() {
    const isAvailable = document.getElementById("er-toggle")?.checked;
    update(ref(db, "Hospitals/" + hospitalId), {
        erStatus: isAvailable ? "Available" : "Full"
    });
};

function updateERStatusUI(isAvailable) {
    const statusText = document.getElementById("er-status-text");
    const headerBadge = document.getElementById("header-status-badge");
    const headerText = document.getElementById("header-status-text");

    if (isAvailable) {
        if (statusText) { statusText.textContent = "Available"; statusText.className = "er-status-value available"; }
        if (headerBadge) headerBadge.className = "status-badge available";
        if (headerText) headerText.textContent = "AVAILABLE";
    } else {
        if (statusText) { statusText.textContent = "Full"; statusText.className = "er-status-value full"; }
        if (headerBadge) headerBadge.className = "status-badge full";
        if (headerText) headerText.textContent = "FULL";
    }
}

window.adjustBeds = function(delta) {
    const current = hospitalData.availableBeds ?? 0;
    const total = hospitalData.totalBeds ?? 0;
    let newVal = Math.max(0, Math.min(total, current + delta));

    update(ref(db, "Hospitals/" + hospitalId), {
        availableBeds: newVal,
        erStatus: newVal > 0 ? "Available" : "Full"
    }).then(() => showToast(`Beds updated to ${newVal}`, "success"));
};

function listenForPatientRequests() {
    onValue(ref(db, "PatientRequests"), (snapshot) => {
        allRequests = [];

        if (snapshot.exists()) {
            snapshot.forEach((child) => {
                const data = child.val();
                if (data.hospitalId !== hospitalId) return;
                allRequests.push({ id: child.key, ...data, status: normalizeRequestStatus(data.status || "PENDING") });
            });
        }

        allRequests.sort((a, b) => {
            const p = priorityWeight(b.priority || b.type) - priorityWeight(a.priority || a.type);
            if (p !== 0) return p;
            return (b.timestamp || 0) - (a.timestamp || 0);
        });

        renderQueueBoard();
        updateHospitalStats();

        // Close the incoming modal automatically once its request is accepted/declined elsewhere.
        if (activeRequestId) {
            const active = allRequests.find(r => r.id === activeRequestId);
            if (!active || normalizeRequestStatus(active.status) !== "PENDING") {
                const modal = document.getElementById("patient-modal");
                if (modal) modal.style.display = "none";
                activeRequestId = "";
            }
        }

        if (selectedRequestId) {
            const selected = allRequests.find(r => r.id === selectedRequestId);
            if (selected) renderSelectedPatient(selectedRequestId, selected);
        }
    });

    onChildAdded(ref(db, "PatientRequests"), (snapshot) => {
        const data = snapshot.val();
        const status = normalizeRequestStatus(data.status || "PENDING");
        if (data.hospitalId === hospitalId && status === "PENDING") {
            showPatientModal(snapshot.key, data);
        }
    });
}

window.setQueueFilter = function(filter) {
    currentFilter = filter;
    document.querySelectorAll(".queue-tab").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.filter === filter);
    });
    renderQueueBoard();
};

function renderQueueBoard() {
    const container = document.getElementById("requests-container");
    if (!container) return;
    container.innerHTML = "";

    const visible = allRequests.filter(req => {
        const status = normalizeRequestStatus(req.status);
        if (currentFilter === "ALL") return status !== "DECLINED";
        return status === currentFilter;
    });

    const activeCount = allRequests.filter(req => ["PENDING", "ACCEPTED", "READY"].includes(normalizeRequestStatus(req.status))).length;
    setText("request-count", activeCount);

    if (!visible.length) {
        container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏥</div><p>No ${currentFilter.toLowerCase()} patient requests</p></div>`;
        return;
    }

    visible.forEach(req => renderRequestCard(req.id, req));
}

function renderRequestCard(requestId, data) {
    const container = document.getElementById("requests-container");
    if (!container) return;

    const status = normalizeRequestStatus(data.status || "PENDING");
    const priority = normalizePriority(data.priority || data.type);
    const isPending = status === "PENDING";
    const isAccepted = status === "ACCEPTED" || status === "READY";
    const isCompleted = status === "COMPLETED";

    const card = document.createElement("div");
    card.id = "req-" + requestId;
    card.className = `request-card ${status.toLowerCase()} priority-${priority.toLowerCase()}`;
    card.onclick = (e) => {
        if (e.target.tagName.toLowerCase() === "button") return;
        selectedRequestId = requestId;
        renderSelectedPatient(requestId, data);
    };

    card.innerHTML = `
        <div class="request-card-header">
            <div>
                <span class="request-patient-name">${escapeHTML(data.patientName || data.name || "Unknown Patient")}</span>
                <div class="queue-mini-meta">${escapeHTML(data.type || "MEDICAL")} · ${formatTime(data.timestamp)}</div>
            </div>
            <span class="priority-pill ${priority.toLowerCase()}">${priority}</span>
        </div>

        <div class="request-status-line">
            <span class="request-badge ${status.toLowerCase()}">${statusLabel(status)}</span>
            <span class="eta-chip">ETA: ${formatEta(data.eta)}</span>
        </div>

        <div class="request-meta">Responder: <span>${escapeHTML(data.responderName || "—")}</span></div>
        <div class="request-meta">Reported by: <span>${escapeHTML(data.callerName || data.patientName || "—")}</span></div>

        <div class="request-actions">
            ${isPending ? `
                <button class="btn-decline" onclick="respondToRequestCard('${requestId}', 'DECLINED')">DECLINE</button>
                <button class="btn-accept" onclick="respondToRequestCard('${requestId}', 'ACCEPTED')">ACCEPT PATIENT</button>
            ` : ""}
            ${isAccepted ? `
                <button class="btn-accept btn-ready" onclick="markHospitalReady('${requestId}')">PREPARE ER</button>
                <button class="btn-accept" onclick="confirmPatientArrival('${requestId}')">PATIENT RECEIVED</button>
            ` : ""}
            ${isCompleted ? `<button class="btn-accept" disabled>COMPLETED</button>` : ""}
        </div>
    `;
    container.appendChild(card);
}

function updateHospitalStats() {
    const today = new Date();
    const isToday = (ts) => {
        if (!ts) return false;
        const d = new Date(ts);
        return d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate();
    };

    const todays = allRequests.filter(r => isToday(r.timestamp) || isToday(r.acceptedAt) || isToday(r.completedAt));
    const critical = allRequests.filter(r => normalizePriority(r.priority || r.type) === "CRITICAL" && r.status !== "COMPLETED" && r.status !== "DECLINED");
    const incoming = allRequests.filter(r => ["PENDING", "ACCEPTED", "READY"].includes(normalizeRequestStatus(r.status)));

    setText("today-cases", todays.length);
    setText("critical-cases", critical.length);
    setText("incoming-cases", incoming.length);
}

function renderSelectedPatient(requestId, data) {
    const panel = document.getElementById("selected-patient-panel");
    if (!panel) return;

    const priority = normalizePriority(data.priority || data.type);
    const status = normalizeRequestStatus(data.status || "PENDING");

    panel.innerHTML = `
        <div class="selected-priority ${priority.toLowerCase()}">${priority}</div>
        <h2>${escapeHTML(data.patientName || data.name || "Unknown Patient")}</h2>
        <div class="selected-row"><span>Emergency</span><strong>${escapeHTML(data.type || "MEDICAL")}</strong></div>
        <div class="selected-row"><span>Status</span><strong>${statusLabel(status)}</strong></div>
        <div class="selected-row"><span>Responder</span><strong>${escapeHTML(data.responderName || "—")}</strong></div>
        <div class="selected-row"><span>ETA</span><strong>${formatEta(data.eta)}</strong></div>
        <div class="selected-row"><span>Reported</span><strong>${formatTime(data.timestamp)}</strong></div>
        ${data.isWitness ? `<div class="witness-note">Reported by witness: ${escapeHTML(data.callerName || "Unknown")}</div>` : ""}
        <div class="detail-actions">
            ${status === "PENDING" ? `<button class="btn-accept" onclick="respondToRequestCard('${requestId}', 'ACCEPTED')">ACCEPT PATIENT</button>` : ""}
            ${(status === "ACCEPTED" || status === "READY") ? `<button class="btn-accept btn-ready" onclick="markHospitalReady('${requestId}')">MARK ER READY</button><button class="btn-accept" onclick="confirmPatientArrival('${requestId}')">PATIENT RECEIVED</button>` : ""}
        </div>
    `;

    renderPreparationChecklist(data);
    renderTimeline(data);
}

function renderPreparationChecklist(data) {
    const box = document.getElementById("prep-checklist");
    if (!box) return;

    const type = String(data.type || "medical").toLowerCase();
    const priority = normalizePriority(data.priority || data.type);
    let items = ["Prepare receiving nurse", "Prepare patient registration", "Check emergency bed availability"];

    if (priority === "CRITICAL") items.unshift("Alert ER physician immediately");
    if (type.includes("accident") || type.includes("crash") || type.includes("trauma")) {
        items.push("Prepare trauma bed", "Prepare oxygen support", "Prepare wound care kit");
    } else if (type.includes("heart") || type.includes("cardiac") || type.includes("medical")) {
        items.push("Prepare vital signs monitor", "Prepare oxygen support", "Prepare emergency cart");
    } else if (type.includes("fire") || type.includes("burn")) {
        items.push("Prepare burn care supplies", "Prepare sterile dressing", "Prepare IV fluids");
    } else {
        items.push("Prepare wheelchair or stretcher", "Prepare triage area");
    }

    box.innerHTML = items.map(item => `<label class="prep-item"><input type="checkbox"> <span>${escapeHTML(item)}</span></label>`).join("");
}

function renderTimeline(data) {
    const box = document.getElementById("hospital-timeline");
    if (!box) return;

    const rows = [
        { label: "SOS Created", time: data.timestamp, done: !!data.timestamp },
        { label: "Hospital Assigned", time: data.assignedAt || data.timestamp, done: true },
        { label: "Patient Accepted", time: data.acceptedAt, done: normalizeRequestStatus(data.status) === "ACCEPTED" || normalizeRequestStatus(data.status) === "READY" || normalizeRequestStatus(data.status) === "COMPLETED" },
        { label: "ER Prepared", time: data.readyAt, done: normalizeRequestStatus(data.status) === "READY" || normalizeRequestStatus(data.status) === "COMPLETED" },
        { label: "Patient Received", time: data.completedAt, done: normalizeRequestStatus(data.status) === "COMPLETED" },
    ];

    box.innerHTML = rows.map(row => `
        <div class="timeline-item ${row.done ? "done" : "pending"}">
            <div class="timeline-dot"></div>
            <div>
                <strong>${row.label}</strong>
                <span>${row.done ? formatTime(row.time) : "Waiting"}</span>
            </div>
        </div>
    `).join("");
}

function showPatientModal(requestId, req) {
    activeRequestId = requestId;
    renderIncomingRequest(requestId, req);
}

function renderIncomingRequest(requestId, req) {
    const patientName  = req.patientName  || req.name  || "Unknown Patient";
    const incidentType = req.type         || "MEDICAL";
    const callerName   = req.callerName   || patientName;
    const isWitness    = req.isWitness    ?? false;
    const responder    = req.responderName || "—";
    const eta          = req.eta           || "—";

    setText("modal-patient-name", patientName);
    setText("modal-type", incidentType);
    setText("modal-responder", responder);
    setText("modal-eta", eta !== "—" ? `~${eta} min` : "—");

    const modalWitnessRow = document.getElementById("modal-witness-row");
    const modalWitnessVal = document.getElementById("modal-witness-value");
    if (modalWitnessRow && modalWitnessVal) {
        if (isWitness) {
            modalWitnessRow.style.display = "flex";
            modalWitnessVal.textContent = `Reported by ${callerName}`;
        } else {
            modalWitnessRow.style.display = "none";
        }
    }

    const modal = document.getElementById("patient-modal");
    if (modal) {
        modal.dataset.requestId = requestId;
        modal.style.display = "flex";
        modal.querySelectorAll("button").forEach(btn => {
            btn.disabled = false;
            if (btn.classList.contains("btn-accept-modal")) btn.textContent = "ACCEPT PATIENT";
            if (btn.classList.contains("btn-decline-modal")) btn.textContent = "DECLINE";
        });
    }
}

window.respondToRequest = async function(response) {
    const modal = document.getElementById("patient-modal");
    const requestId = activeRequestId || modal?.dataset?.requestId || selectedRequestId;
    if (!requestId) {
        showToast("No active patient request selected.", "danger");
        return;
    }

    const modalButtons = modal ? modal.querySelectorAll("button") : [];
    modalButtons.forEach(btn => btn.disabled = true);
    const acceptBtn = modal?.querySelector(".btn-accept-modal");
    const declineBtn = modal?.querySelector(".btn-decline-modal");
    if (response === "ACCEPTED" && acceptBtn) acceptBtn.textContent = "ACCEPTING...";
    if (response === "DECLINED" && declineBtn) declineBtn.textContent = "DECLINING...";

    try {
        await respondToRequestCard(requestId, response, true);
        if (modal) modal.style.display = "none";
        activeRequestId = "";
    } catch (err) {
        console.error(err);
        showToast("Action failed. Please check internet/Firebase rules.", "danger");
        modalButtons.forEach(btn => btn.disabled = false);
        if (acceptBtn) acceptBtn.textContent = "ACCEPT PATIENT";
        if (declineBtn) declineBtn.textContent = "DECLINE";
    }
};

window.respondToRequestCard = async function(requestId, response, fromModal = false) {
    const snap = await get(ref(db, "PatientRequests/" + requestId));
    const data = snap.val();
    if (!data) {
        showToast("Patient request not found.", "danger");
        return;
    }

    const currentStatus = normalizeRequestStatus(data.status || "PENDING");

    // Stop duplicate Accept. Once accepted, continue with ER workflow.
    if (response === "ACCEPTED" && currentStatus !== "PENDING") {
        const normalizedData = { id: requestId, ...data, status: currentStatus };
        selectedRequestId = requestId;
        updateLocalRequest(requestId, normalizedData);
        renderQueueBoard();
        renderSelectedPatient(requestId, normalizedData);
        showToast("Patient is already accepted. Continue ER preparation.", "success");
        return;
    }

    const now = Date.now();

    if (response === "ACCEPTED") {
        const patientUpdate = {
            status: "ACCEPTED",
            acceptedAt: now,
            hospitalStatus: "ACCEPTED",
            hospitalApproved: true,
            hospitalApprovedAt: now
        };

        await update(ref(db, "PatientRequests/" + requestId), patientUpdate);

        if (data.emergencyId) {
            await update(ref(db, "Emergencies/" + data.emergencyId), {
                // Keep HOSPITAL_BOUND because the responder app already listens for this status.
                status: "HOSPITAL_BOUND",
                hospital_name: hospitalData.name || data.hospitalName || "Hospital",
                hospital_lat: hospitalData.latitude ?? data.hospital_lat ?? 0,
                hospital_lon: hospitalData.longitude ?? data.hospital_lon ?? 0,
                hospital_id: hospitalId,
                hospitalStatus: "ACCEPTED",
                hospitalApproved: true,
                hospitalApprovedAt: now
            });
        }

        const updatedRequest = { id: requestId, ...data, ...patientUpdate };
        selectedRequestId = requestId;
        updateLocalRequest(requestId, updatedRequest);
        renderQueueBoard();
        renderSelectedPatient(requestId, updatedRequest);
        showToast("Patient accepted. Responder has been notified.", "success");
        return;
    }

    if (response === "DECLINED") {
        const patientUpdate = {
            status: "DECLINED",
            declinedAt: now,
            hospitalStatus: "DECLINED"
        };

        await update(ref(db, "PatientRequests/" + requestId), patientUpdate);

        if (data.emergencyId) {
            await update(ref(db, "Emergencies/" + data.emergencyId), {
                status: "ARRIVED",
                hospital_declined: true,
                hospitalStatus: "DECLINED",
                hospitalApproved: false
            });
        }

        const updatedRequest = { id: requestId, ...data, ...patientUpdate };
        updateLocalRequest(requestId, updatedRequest);
        if (selectedRequestId === requestId) selectedRequestId = "";
        renderQueueBoard();
        const panel = document.getElementById("selected-patient-panel");
        if (panel) panel.innerHTML = `<p class="empty-log">Request declined.</p>`;
        showToast("Patient declined.", "danger");
    }
};

window.markHospitalReady = async function(requestId) {
    const snap = await get(ref(db, "PatientRequests/" + requestId));
    const data = snap.val();
    if (!data) {
        showToast("Patient request not found.", "danger");
        return;
    }

    const now = Date.now();
    const patientUpdate = {
        status: "READY",
        readyAt: now,
        hospitalStatus: "READY"
    };

    await update(ref(db, "PatientRequests/" + requestId), patientUpdate);

    if (data.emergencyId) {
        await update(ref(db, "Emergencies/" + data.emergencyId), {
            hospitalStatus: "READY",
            status: "HOSPITAL_READY",
            hospitalReadyAt: now
        });
    }

    const updatedRequest = { id: requestId, ...data, ...patientUpdate };
    selectedRequestId = requestId;
    updateLocalRequest(requestId, updatedRequest);
    renderQueueBoard();
    renderSelectedPatient(requestId, updatedRequest);
    showToast("ER marked ready for incoming patient.", "success");
};

window.confirmPatientArrival = async function(requestId) {
    const snap = await get(ref(db, "PatientRequests/" + requestId));
    const data = snap.val();
    if (!data) {
        showToast("Patient request not found.", "danger");
        return;
    }

    const now = Date.now();
    const patientUpdate = {
        status: "COMPLETED",
        completedAt: now,
        hospitalStatus: "PATIENT_RECEIVED"
    };

    await update(ref(db, "PatientRequests/" + requestId), patientUpdate);

    if (data.emergencyId) {
        await update(ref(db, "Emergencies/" + data.emergencyId), {
            hospitalStatus: "PATIENT_RECEIVED",
            status: "PATIENT_RECEIVED",
            patientReceivedAt: now
        });
    }

    // Deduct bed only when patient is actually received, not on accept.
    const currentBeds = Number(hospitalData.availableBeds ?? 0);
    const newBeds = Math.max(0, currentBeds - 1);
    await update(ref(db, "Hospitals/" + hospitalId), {
        availableBeds: newBeds,
        erStatus: newBeds > 0 ? "Available" : "Full"
    });

    const updatedRequest = { id: requestId, ...data, ...patientUpdate };
    selectedRequestId = requestId;
    updateLocalRequest(requestId, updatedRequest);
    renderQueueBoard();
    renderSelectedPatient(requestId, updatedRequest);
    showToast("Patient received and admitted to ER.", "success");
};

function updateLocalRequest(requestId, updatedRequest) {
    const normalized = {
        ...updatedRequest,
        status: normalizeRequestStatus(updatedRequest.status || "PENDING")
    };

    const index = allRequests.findIndex(req => req.id === requestId);
    if (index >= 0) {
        allRequests[index] = normalized;
    } else {
        allRequests.unshift(normalized);
    }
}

function addToPatientLog(data) {
    const logDiv = document.getElementById("patient-log");
    if (!logDiv) return;
    logDiv.querySelector(".empty-log")?.remove();

    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.innerHTML = `
        <div class="log-entry-name">${escapeHTML(data.patientName || "Unknown")}</div>
        <div class="log-entry-meta">${escapeHTML(data.type || "MEDICAL")} · ${formatTime(data.completedAt || data.timestamp)}</div>
    `;
    logDiv.appendChild(entry);
}

window.logoutHospital = function() {
    signOut(auth).then(() => { window.location.href = "index.html"; });
};

function normalizePriority(value) {
    const v = String(value || "").toLowerCase();
    if (v.includes("critical") || v.includes("cardiac") || v.includes("heart") || v.includes("severe") || v.includes("unconscious")) return "CRITICAL";
    if (v.includes("high") || v.includes("accident") || v.includes("crash") || v.includes("fire") || v.includes("bleeding")) return "HIGH";
    if (v.includes("medium") || v.includes("injury") || v.includes("medical")) return "MEDIUM";
    return "LOW";
}

function priorityWeight(value) {
    const p = normalizePriority(value);
    return { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }[p] || 1;
}

function statusLabel(status) {
    const map = {
        PENDING: "Incoming",
        ACCEPTED: "Preparing",
        READY: "ER Ready",
        COMPLETED: "Received",
        DECLINED: "Declined"
    };
    const s = normalizeRequestStatus(status);
    return map[s] || s || "Incoming";
}

function formatEta(eta) {
    if (!eta || eta === "—") return "—";
    return String(eta).includes("min") ? eta : `~${eta} min`;
}

function formatTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-PH", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true
    });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function escapeHTML(str) {
    return String(str ?? "").replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

function showToast(message, type = "default") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `show ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.className = "toast-hidden"; }, 3500);
}
