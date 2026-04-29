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
async function loadHospitalData() {
    const snap = await get(ref(db, "Hospitals/" + hospitalId));
    if (!snap.exists()) return;

    hospitalData = snap.val();

    document.getElementById("header-hospital-name").textContent = hospitalData.name;
    document.getElementById("info-name").textContent = hospitalData.name;
    document.getElementById("info-barangay").textContent = hospitalData.barangay;
    document.getElementById("info-phone").textContent = hospitalData.phone;
    document.getElementById("info-approval").textContent = hospitalData.approved ? "✅ Approved" : "⏳ Pending";
    document.getElementById("available-beds").textContent = hospitalData.availableBeds ?? "—";
    document.getElementById("total-beds").textContent = hospitalData.totalBeds ?? "—";

    const isAvailable = hospitalData.erStatus === "Available";
    document.getElementById("er-toggle").checked = isAvailable;
    updateERStatusUI(isAvailable);

    onValue(ref(db, "Hospitals/" + hospitalId), (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        hospitalData = data;
        document.getElementById("available-beds").textContent = data.availableBeds ?? "—";
        const avail = data.erStatus === "Available";
        document.getElementById("er-toggle").checked = avail;
        updateERStatusUI(avail);
    });
}

async function loadPastPatients() {
    const logDiv = document.getElementById("patient-log");
    const requestsRef = ref(db, "PatientRequests");
    
    onValue(requestsRef, (snapshot) => {
        logDiv.innerHTML = ""; 
        let hasPatients = false;
        const data = [];
        
        snapshot.forEach(child => {
            const req = child.val();
            // Show only COMPLETED patients in the history log
            if (req.hospitalId === hospitalId && req.status === "COMPLETED") {
                data.push(req);
                hasPatients = true;
            }
        });

        if (!hasPatients) {
            logDiv.innerHTML = '<p class="empty-log">No history found.</p>';
            return;
        }

        data.sort((a, b) => b.timestamp - a.timestamp);
        data.forEach(req => addToPatientLog(req));
    });
}

window.toggleERStatus = function() {
    const isAvailable = document.getElementById("er-toggle").checked;
    update(ref(db, "Hospitals/" + hospitalId), {
        erStatus: isAvailable ? "Available" : "Full"
    });
};

function updateERStatusUI(isAvailable) {
    const statusText = document.getElementById("er-status-text");
    const headerBadge = document.getElementById("header-status-badge");
    const headerText = document.getElementById("header-status-text");

    if (isAvailable) {
        statusText.textContent = "Available";
        statusText.className = "er-status-value available";
        headerBadge.className = "status-badge available";
        headerText.textContent = "AVAILABLE";
    } else {
        statusText.textContent = "Full";
        statusText.className = "er-status-value full";
        headerBadge.className = "status-badge full";
        headerText.textContent = "FULL";
    }
}

window.adjustBeds = function(delta) {
    const current = hospitalData.availableBeds ?? 0;
    const total = hospitalData.totalBeds ?? 0;
    let newVal = Math.max(0, Math.min(total, current + delta));

    update(ref(db, "Hospitals/" + hospitalId), {
        availableBeds: newVal,
        erStatus: newVal > 0 ? "Available" : "Full"
    }).then(() => {
        showToast(`Beds updated to ${newVal}`, "success");
    });
};

function listenForPatientRequests() {
    let requestCount = 0;

    onValue(ref(db, "PatientRequests"), (snapshot) => {
        const container = document.getElementById("requests-container");
        container.innerHTML = "";
        requestCount = 0;

        if (!snapshot.exists()) {
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">🏥</div><p>No incoming patient requests</p></div>`;
            document.getElementById("request-count").textContent = "0";
            return;
        }

        snapshot.forEach((child) => {
            const data = child.val();
            if (data.hospitalId !== hospitalId) return;
            // Display both PENDING and ACCEPTED (awaiting confirmation) requests
            if (data.status === "PENDING" || data.status === "ACCEPTED") {
                if (data.status === "PENDING") requestCount++;
                renderRequestCard(child.key, data);
            }
        });

        document.getElementById("request-count").textContent = requestCount;
    });

    // Alert sound for new PENDING requests
    onChildAdded(ref(db, "PatientRequests"), (snapshot) => {
        const data = snapshot.val();
        if (data.hospitalId === hospitalId && data.status === "PENDING") {
            showPatientModal(snapshot.key, data);
        }
    });
}

function renderRequestCard(requestId, data) {
    const container = document.getElementById("requests-container");
    const existing = document.getElementById("req-" + requestId);
    if (existing) existing.remove();

    container.querySelector(".empty-state")?.remove();

    const card = document.createElement("div");
    card.id = "req-" + requestId;
    card.className = `request-card ${(data.status || "pending").toLowerCase()}`;

    const isPending = data.status === "PENDING";
    const isAccepted = data.status === "ACCEPTED";

    card.innerHTML = `
        <div class="request-card-header">
            <span class="request-patient-name">${escapeHTML(data.patientName || "Unknown")}</span>
            <span class="request-badge ${(data.status || "pending").toLowerCase()}">${data.status || "PENDING"}</span>
        </div>
        <div class="request-meta">Type: <span>${escapeHTML(data.type || "MEDICAL")}</span></div>
        <div class="request-meta">Responder: <span>${escapeHTML(data.responderName || "—")}</span></div>
        <div class="request-meta">ETA: <span>~${data.eta || "—"} min</span></div>
        <div class="request-meta">Time: <span>${formatTime(data.timestamp)}</span></div>
        
        <div class="request-actions">
            ${isPending ? `
                <button class="btn-decline" onclick="respondToRequestCard('${requestId}', 'DECLINED')">DECLINE</button>
                <button class="btn-accept" onclick="respondToRequestCard('${requestId}', 'ACCEPTED')">ACCEPT PATIENT</button>
            ` : ""}
            ${isAccepted ? `
                <button class="btn-accept" style="background:var(--primary); width:100%; flex:none;" 
                    onclick="confirmPatientArrival('${requestId}')">
                    CONFIRM PATIENT ENTRY
                </button>
            ` : ""}
        </div>
    `;
    container.prepend(card);
}

window.confirmPatientArrival = async function(requestId) {
    // This completes the transport mission and moves the entry to history
    await update(ref(db, "PatientRequests/" + requestId), {
        status: "COMPLETED" 
    });
    showToast("Patient admitted to ER.", "success");
};

function renderIncomingRequest(requestId, req) {
    // ── Read new fields with backwards-compatible fallbacks ──
    const patientName  = req.patientName  || req.name  || "Unknown Patient";
    const incidentType = req.type         || "MEDICAL";
    const callerName   = req.callerName   || patientName;
    const isWitness    = req.isWitness    ?? false;
    const responder    = req.responderName || "—";
    const eta          = req.eta           || "—";

    // ── Populate modal fields ──
    document.getElementById("modal-patient-name").textContent = patientName;
    document.getElementById("modal-type").textContent         = incidentType;
    document.getElementById("modal-responder").textContent    = responder;
    document.getElementById("modal-eta").textContent          =
        eta !== "—" ? `~${eta} min` : "—";

    // ── Show witness note in modal if caller ≠ patient ──
    const modalWitnessRow = document.getElementById("modal-witness-row");
    const modalWitnessVal = document.getElementById("modal-witness-value");

    if (modalWitnessRow && modalWitnessVal) {
        if (isWitness) {
            modalWitnessRow.style.display = "flex";
            modalWitnessVal.textContent   = `Reported by ${callerName}`;
        } else {
            modalWitnessRow.style.display = "none";
        }
    }

    // Store current requestId for accept/decline buttons
    window._currentRequestId  = requestId;
    window._currentPatientReq = req;

    // Show the modal
    document.getElementById("patient-modal").style.display = "flex";
}

window.respondToRequest = function(response) {
    if (!activeRequestId) return;
    respondToRequestCard(activeRequestId, response);
    document.getElementById("patient-modal").style.display = "none";
    activeRequestId = "";
};

window.respondToRequestCard = async function(requestId, response) {
    const snap = await get(ref(db, "PatientRequests/" + requestId));
    const data = snap.val();
    if (!data) return;

    await update(ref(db, "PatientRequests/" + requestId), { status: response });

    if (response === "ACCEPTED") {
        //
        await update(ref(db, "Emergencies/" + data.emergencyId), {
            status: "HOSPITAL_BOUND",
            hospital_name: hospitalData.name,
            hospital_lat: hospitalData.latitude,
            hospital_lon: hospitalData.longitude,
            hospital_id: hospitalId,
        });

        const newBeds = Math.max(0, (hospitalData.availableBeds ?? 1) - 1);
        await update(ref(db, "Hospitals/" + hospitalId), {
            availableBeds: newBeds,
            erStatus: newBeds > 0 ? "Available" : "Full"
        });

        showToast("Patient accepted. Waiting for unit arrival.", "success");
    } else {
        await update(ref(db, "Emergencies/" + data.emergencyId), {
            status: "ARRIVED",
            hospital_declined: true,
        });
        showToast("Patient declined.", "danger");
    }
};

function addToPatientLog(data) {
    const logDiv = document.getElementById("patient-log");
    if (!logDiv) return;
    logDiv.querySelector(".empty-log")?.remove();

    const entry = document.createElement("div");
    entry.className = "log-entry";
    entry.innerHTML = `
        <div class="log-entry-name">${escapeHTML(data.patientName || "Unknown")}</div>
        <div class="log-entry-meta">${data.type || "MEDICAL"} · ${formatTime(data.timestamp)}</div>
    `;
    logDiv.prepend(entry);
}

window.logoutHospital = function() {
    signOut(auth).then(() => { window.location.href = "index.html"; });
};

function formatTime(ts) {
    if (!ts) return "—";
    return new Date(ts).toLocaleString("en-PH", {
        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false
    });
}

function escapeHTML(str) {
    return String(str).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"}[m]));
}

function showToast(message, type = "default") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `show ${type}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { toast.className = "toast-hidden"; }, 3500);
}