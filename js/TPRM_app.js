/**
 * CISO Toolbox — Vendor Risk Management (TPRM)
 *
 * Uses shared libraries: cisotoolbox.js (esc, _da, showStatus), i18n.js (t),
 * TPRM_questions.js (questions, tier matrix, categories).
 *
 * Data model stored in D (global, used by cisotoolbox.js autosave):
 *   vendors[], risks[], assessments[], documents[]
 */

// CT_CONFIG — cisotoolbox framework integration
var TPRM_INIT_DATA = { vendors: [], risks: [], assessments: [], documents: [], questionnaire_templates: [], metadata: { organization: "", created: "" } };
window.CT_CONFIG = {
    autosaveKey: "tprm_autosave",
    initDataVar: "TPRM_INIT_DATA",
    filePrefix: "TPRM",
    labelKey: "toolbar.subtitle",
    getSociete: function(data) { return (data.metadata && data.metadata.organization) || ""; },
    getDate: function(data) { return (data.metadata && data.metadata.created) || ""; }
};

var _panel = "dashboard";
var D = JSON.parse(JSON.stringify(TPRM_INIT_DATA));
var _selectedVendor = null;
var _vendorTab = "info";

// ═══════════════════════════════════════════════════════════════
// SIDEBAR + NAVIGATION
// ═══════════════════════════════════════════════════════════════

function selectPanel(id) {
    _panel = id;
    _selectedVendor = null;
    document.querySelector(".sidebar").classList.remove("open");
    _updateSidebarAccordion(id);
    renderPanel();
}

function renderPanel() {
    var c = document.getElementById("content");
    _docsTableCounter = 0;
    // Measure edit form takes priority
    if (_editingMeasure) { c.innerHTML = _renderMeasureEditForm(); _initSliders(); return; }
    // Handle broken logo images — fallback to initials
    setTimeout(function() {
        document.querySelectorAll(".vendor-logo-img").forEach(function(img) {
            img.addEventListener("error", function() {
                var initials = img.getAttribute("data-initials") || "?";
                var fallback = document.createElement("span");
                fallback.className = "vendor-initials";
                fallback.textContent = initials;
                img.replaceWith(fallback);
            });
        });
    }, 50);
    switch (_panel) {
        case "dashboard": c.innerHTML = renderDashboard(); break;
        case "vendors": c.innerHTML = _selectedVendor !== null ? renderVendorDetail() : renderVendorList(); break;
        case "risks": c.innerHTML = renderRiskList(); break;
        case "measures": c.innerHTML = renderGlobalMeasures(); break;
        case "assessments": c.innerHTML = _selectedVendor !== null ? renderVendorDetail() : renderVendorList(); _vendorTab = "assessments"; break;
        case "documents": c.innerHTML = renderDocList(); break;
        case "templates":
            if (_editingTemplateId) { c.innerHTML = renderTemplateEditor(_editingTemplateId); }
            else { c.innerHTML = renderTemplateList(); }
            break;
        default: c.innerHTML = renderDashboard();
    }
    _initSliders();
    _initTimelineDrag();
    // Setup column hide/show and resize for all tables in current view
    _setupTable("risk-list-table");
    _setupTable("vendor-risks-table");
    _setupTable("vendor-measures-table");
    _setupTable("global-measures-table");
    // Docs tables use auto-incrementing IDs
    for (var _dti = 0; _dti < _docsTableCounter; _dti++) _setupTable("docs-table-" + _dti);
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
    var v = D.vendors, r = D.risks, a = D.assessments;
    var criticalCount = v.filter(function(x) { var tier = _getTier(x); return tier === "critical"; }).length;
    var highRiskCount = r.filter(function(x) { var sc = (x.impact||0) * (x.likelihood||0); return sc >= 15; }).length;
    var openRisks = r.filter(function(x) { return x.status === "needs_treatment" || x.status === "active"; }).length;
    var pendingAssess = a.filter(function(x) { return x.status !== "completed"; }).length;
    var expiring = _getExpiringItems().length;

    var h = '<h2>' + t("dashboard.title") + '</h2>';
    // Cards
    h += '<div class="tprm-cards">';
    h += _card(v.length, t("dashboard.total_vendors"), "");
    h += _card(criticalCount, t("dashboard.critical_vendors"), criticalCount > 0 ? "critical" : "");
    h += _card(highRiskCount, t("dashboard.critical_risks"), highRiskCount > 0 ? "critical" : "");
    h += _card(pendingAssess, t("dashboard.pending_assessments"), pendingAssess > 0 ? "warning" : "");
    h += _card(openRisks, t("dashboard.open_risks"), openRisks > 0 ? "high" : "");
    h += _card(expiring, t("dashboard.expiring_soon", { days: _deadlineDays }), expiring > 0 ? "warning" : "");
    h += '</div>';

    // Row 1: Two matrices side by side
    h += '<div class="dash-risk-row">';
    var _today = new Date().toISOString().split("T")[0];
    var _todayLabel = _today.split("-").reverse().join("/");
    h += '<div class="risk-matrix-container dash-matrix"><h3 style="font-size:0.9em;margin-bottom:6px">' + t("dashboard.risk_matrix") + ' <span style="font-weight:400;font-size:0.85em;color:var(--text-muted)">(' + esc(_todayLabel) + ')</span></h3>';
    h += _renderResidualMatrix(null);
    h += '</div>';
    var _endDate = _getLastMeasureDate();
    var _endLabel = _endDate ? _endDate.split("-").reverse().join("/") : _todayLabel;
    h += '<div class="risk-matrix-container dash-matrix"><h3 style="font-size:0.9em;margin-bottom:6px"><span id="residual-matrix-title">' + t("dashboard.residual_matrix") + '</span> <span id="residual-date-label" style="font-weight:400;font-size:0.85em;color:var(--text-muted)">(' + esc(_endLabel) + ')</span></h3>';
    h += '<div id="residual-matrix-svg">' + _renderResidualMatrix(_endDate || null) + '</div>';
    h += '</div>';
    h += '</div>';

    // Row 2: Timeline full width
    if (r.length > 0) {
        h += '<div class="risk-matrix-container dash-timeline" style="margin-bottom:12px;padding:12px">';
        h += '<h3 style="font-size:0.9em;margin-bottom:6px">' + t("dashboard.risk_timeline") + '</h3>';
        h += _renderRiskTimeline();
        h += '</div>';
    }

    // Row 3: Top risks + Upcoming deadlines side by side
    h += '<div class="dash-grid-2col" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">';
    h += '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:14px">';
    h += '<h3 style="font-size:0.9em;margin-bottom:8px">' + t("dashboard.top_risks") + '</h3>';
    var topR = r.filter(function(x) { return x.status !== "closed" && x.status !== "archived"; })
        .sort(function(a, b) { return (b.impact * b.likelihood) - (a.impact * a.likelihood); }).slice(0, 5);
    if (!topR.length) h += '<div style="color:var(--text-muted);font-size:0.85em">' + t("risk.empty") + '</div>';
    topR.forEach(function(ri) {
        var vn = _vendorName(ri.vendor_id);
        var sc = ri.impact * ri.likelihood;
        h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em">';
        h += '<span class="' + _scoreClass(sc) + '" style="font-weight:700;min-width:24px">' + sc + '</span>';
        h += '<span style="flex:1">' + esc(ri.title) + '</span>';
        h += '<span style="color:var(--text-muted);font-size:0.8em">' + esc(vn) + '</span>';
        h += '</div>';
    });
    h += '</div>';

    h += '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:14px">';
    h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
    h += '<h3 style="font-size:0.9em;margin:0;flex:1">' + t("dashboard.upcoming_deadlines") + '</h3>';
    h += '<div style="display:flex;gap:2px">';
    [30, 60, 90].forEach(function(d) {
        var active = _deadlineDays === d ? "background:var(--light-blue);color:white" : "background:var(--bg);color:var(--text-muted)";
        h += '<button style="border:none;padding:3px 8px;border-radius:4px;font-size:0.72em;font-weight:600;cursor:pointer;' + active + '" data-click="setDeadlineDays" data-args=\'[' + d + ']\'>' + d + 'j</button>';
    });
    h += '</div></div>';
    var deadlines = _getExpiringItems();
    if (!deadlines.length) h += '<div style="color:var(--text-muted);font-size:0.85em">-</div>';
    deadlines.slice(0, 8).forEach(function(d) {
        h += '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:0.85em">';
        h += '<span style="color:var(--orange);font-weight:600;min-width:80px">' + esc(d.date) + '</span>';
        h += '<span style="flex:1">' + esc(d.label) + '</span>';
        h += '</div>';
    });
    h += '</div>';
    h += '</div>';

    return h;
}

function _renderRiskTimeline() {
    var risks = D.risks.filter(function(r) { return r.status !== "closed" && r.status !== "archived"; });
    if (!risks.length) return '<div style="color:var(--text-muted);font-size:0.85em">-</div>';

    // Collect all measure deadlines as transition dates
    var dates = [];
    var now = new Date();
    var today = now.toISOString().split("T")[0];
    dates.push(today);

    // Find min/max dates for the timeline
    D.vendors.forEach(function(v) {
        (v.measures || []).forEach(function(m) {
            if (m.echeance) dates.push(m.echeance);
        });
    });
    risks.forEach(function(r) {
        if (r.treatment && r.treatment.due_date) dates.push(r.treatment.due_date);
    });

    if (dates.length < 2) return '<div style="color:var(--text-muted);font-size:0.85em">-</div>';

    dates.sort();
    // Timeline: from 6 months ago to 12 months ahead
    var startDate = new Date(now.getTime() - 180 * 86400000);
    var endDate = new Date(now.getTime() + 365 * 86400000);
    var startStr = startDate.toISOString().split("T")[0];
    var endStr = endDate.toISOString().split("T")[0];

    // Build monthly time points
    var points = [];
    var d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (d <= endDate) {
        points.push(d.toISOString().split("T")[0]);
        d = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    }

    // Matrix color lookup — same colors as the risk matrices
    var _matColors = [
        ["#dcfce7","#dcfce7","#fef9c3","#fed7aa","#fecaca"],
        ["#dcfce7","#fef9c3","#fed7aa","#fecaca","#fecaca"],
        ["#fef9c3","#fed7aa","#fed7aa","#fecaca","#fca5a5"],
        ["#fed7aa","#fecaca","#fecaca","#fca5a5","#fca5a5"],
        ["#fecaca","#fecaca","#fca5a5","#fca5a5","#ef4444"]
    ];
    function _matColor(imp, lik) {
        return _matColors[Math.min(Math.max(lik, 1), 5) - 1][Math.min(Math.max(imp, 1), 5) - 1];
    }

    // Timeline levels = distinct matrix colors (ordered from critical to low)
    var levels = [
        { label: t("vendor.exposure_critical"), color: "#ef4444" },
        { label: t("vendor.exposure_high"), color: "#fca5a5" },
        { label: t("vendor.exposure_moderate"), color: "#fecaca" },
        { label: "", color: "#fed7aa" },
        { label: "", color: "#fef9c3" },
        { label: t("vendor.exposure_low"), color: "#dcfce7" }
    ];

    var series = levels.map(function() { return []; });

    points.forEach(function(dateStr) {
        var counts = levels.map(function() { return 0; });
        risks.forEach(function(r) {
            var imp = r.impact || 1, lik = r.likelihood || 1;
            var resI = r.residual_impact || 0, resL = r.residual_likelihood || 0;
            var hasResidual = resI > 0 && resL > 0;
            var measuresApplied = false;

            if (hasResidual) {
                var v = D.vendors.find(function(x) { return x.id === r.vendor_id; });
                if (v && v.measures) {
                    var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
                    var allMeasuresDone = linkedIds.length > 0 && linkedIds.every(function(mid) {
                        var m = v.measures.find(function(x) { return x.id === mid; });
                        return m && m.echeance && m.echeance <= dateStr;
                    });
                    if (allMeasuresDone) measuresApplied = true;
                }
                if (r.treatment && r.treatment.due_date && r.treatment.due_date <= dateStr) measuresApplied = true;
            }

            var eImp = measuresApplied ? resI : imp;
            var eLik = measuresApplied ? resL : lik;
            var color = _matColor(eImp, eLik);

            for (var li = 0; li < levels.length; li++) {
                if (color === levels[li].color) { counts[li]++; break; }
            }
        });
        for (var li = 0; li < levels.length; li++) series[li].push(counts[li]);
    });

    // SVG stacked area chart
    var W = 600, H = 200, ML = 30, MR = 10, MT = 10, MB = 40;
    var cW = W - ML - MR, cH = H - MT - MB;
    var maxVal = 0;
    points.forEach(function(_, pi) {
        var sum = 0;
        for (var li = 0; li < levels.length; li++) sum += series[li][pi];
        if (sum > maxVal) maxVal = sum;
    });
    if (maxVal === 0) maxVal = 1;

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%">';

    // Grid lines
    for (var g = 0; g <= 4; g++) {
        var gy = MT + cH - (g / 4 * cH);
        svg += '<line x1="' + ML + '" y1="' + gy + '" x2="' + (W - MR) + '" y2="' + gy + '" stroke="#e2e8f0" stroke-width="0.5"/>';
        svg += '<text x="' + (ML - 4) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="8" fill="#94a3b8">' + Math.round(g / 4 * maxVal) + '</text>';
    }

    // Draggable date line
    var todayIdx = -1;
    for (var pi = 0; pi < points.length; pi++) {
        if (points[pi] >= today) { todayIdx = pi; break; }
    }
    // Store timeline metadata for drag handler
    var _tlMeta = { ML: ML, MR: MR, MT: MT, MB: MB, W: W, H: H, cW: cW, points: points, startDate: startDate, endDate: endDate };
    window._timelineMeta = _tlMeta;
    var initTx = todayIdx >= 0 ? ML + (todayIdx / (points.length - 1)) * cW : ML;
    // Fixed "today" dashed line
    if (todayIdx >= 0) {
        svg += '<line x1="' + initTx + '" y1="' + MT + '" x2="' + initTx + '" y2="' + (H - MB) + '" stroke="#94a3b8" stroke-width="1" stroke-dasharray="4,3" style="pointer-events:none"/>';
        svg += '<text x="' + initTx + '" y="' + (MT - 3) + '" text-anchor="middle" font-size="7" fill="#94a3b8">' + t("dashboard.today") + '</text>';
    }
    // Invisible drag zone (wide hit area)
    svg += '<rect id="tl-drag-zone" x="' + ML + '" y="' + MT + '" width="' + cW + '" height="' + (H - MT - MB) + '" fill="transparent" style="cursor:col-resize"/>';
    // Draggable blue line
    svg += '<line id="tl-dateline" x1="' + initTx + '" y1="' + MT + '" x2="' + initTx + '" y2="' + (H - MB) + '" stroke="#3b82f6" stroke-width="2" style="pointer-events:none"/>';
    svg += '<text id="tl-dateline-label" x="' + initTx + '" y="' + (H - MB + 12) + '" text-anchor="middle" font-size="8" fill="#3b82f6" font-weight="600">' + t("dashboard.today") + '</text>';

    // Smooth lines per risk level (cardinal spline)
    for (var li = 0; li < levels.length; li++) {
        var pts = [];
        for (var pi = 0; pi < points.length; pi++) {
            pts.push({
                x: ML + (pi / (points.length - 1)) * cW,
                y: MT + cH - (series[li][pi] / maxVal * cH)
            });
        }
        if (pts.length < 2) continue;
        var pathD = "M" + pts[0].x + "," + pts[0].y;
        for (var i = 0; i < pts.length - 1; i++) {
            var p0 = pts[Math.max(i - 1, 0)];
            var p1 = pts[i];
            var p2 = pts[i + 1];
            var p3 = pts[Math.min(i + 2, pts.length - 1)];
            var cp1x = p1.x + (p2.x - p0.x) / 6;
            var cp1y = Math.min(p1.y + (p2.y - p0.y) / 6, MT + cH);
            var cp2x = p2.x - (p3.x - p1.x) / 6;
            var cp2y = Math.min(p2.y - (p3.y - p1.y) / 6, MT + cH);
            pathD += " C" + cp1x.toFixed(1) + "," + cp1y.toFixed(1) + " " + cp2x.toFixed(1) + "," + cp2y.toFixed(1) + " " + p2.x.toFixed(1) + "," + p2.y.toFixed(1);
        }
        svg += '<path d="' + pathD + '" fill="none" stroke="' + levels[li].color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    // X axis labels (months)
    points.forEach(function(dateStr, pi) {
        if (pi % 2 !== 0 && pi !== points.length - 1) return;
        var x = ML + (pi / (points.length - 1)) * cW;
        var parts = dateStr.split("-");
        var label = parts[1] + "/" + parts[0].substring(2);
        svg += '<text x="' + x + '" y="' + (H - MB + 22) + '" text-anchor="middle" font-size="7" fill="#94a3b8">' + label + '</text>';
    });

    svg += '</svg>';

    // Legend (same as matrices)
    svg += '<div class="matrix-legend" style="display:flex;gap:8px;justify-content:center;margin-top:6px;font-size:0.7em">';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#dcfce7"></span>' + t("vendor.exposure_low") + '</span>';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#fef9c3"></span>' + t("vendor.exposure_moderate") + '</span>';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#fed7aa"></span>' + t("vendor.exposure_significant") + '</span>';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#fecaca"></span>' + t("vendor.exposure_high") + '</span>';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#fca5a5"></span>' + t("vendor.exposure_critical") + '</span>';
    svg += '<span style="display:flex;align-items:center;gap:3px"><span style="width:14px;height:3px;border-radius:1px;background:#ef4444"></span>' + t("vendor.exposure_extreme") + '</span>';
    svg += '</div>';

    return svg;
}

function _card(val, label, cls) {
    return '<div class="tprm-card ' + cls + '"><div class="card-val">' + val + '</div><div class="card-lbl">' + esc(label) + '</div></div>';
}

var _deadlineDays = 90;

function setDeadlineDays(days) {
    _deadlineDays = parseInt(days) || 90;
    renderPanel();
}
window.setDeadlineDays = setDeadlineDays;

function _getExpiringItems() {
    var items = [], now = new Date(), limit = new Date(now.getTime() + _deadlineDays * 86400000);
    D.vendors.forEach(function(v) {
        if (v.contract && v.contract.end_date) {
            var d = new Date(v.contract.end_date);
            if (d > now && d < limit) items.push({ date: v.contract.end_date, label: v.name + " — " + t("vendor.contract_end") });
        }
        if (v.contract && v.contract.review_date) {
            var dr = new Date(v.contract.review_date);
            if (dr > now && dr < limit) items.push({ date: v.contract.review_date, label: v.name + " — " + t("vendor.review_date") });
        }
        (v.certifications || []).forEach(function(c) {
            if (c.expiry_date) {
                var d2 = new Date(c.expiry_date);
                if (d2 > now && d2 < limit) items.push({ date: c.expiry_date, label: v.name + " — " + c.name });
            }
        });
    });
    items.sort(function(a, b) { return a.date.localeCompare(b.date); });
    return items;
}

// ═══════════════════════════════════════════════════════════════
// RISK MATRIX (SVG)
// ═══════════════════════════════════════════════════════════════

function _getLastMeasureDate() {
    var last = "";
    D.vendors.forEach(function(v) {
        (v.measures || []).forEach(function(m) {
            if (m.echeance && m.echeance > last) last = m.echeance;
        });
    });
    D.risks.forEach(function(r) {
        if (r.treatment && r.treatment.due_date && r.treatment.due_date > last) last = r.treatment.due_date;
    });
    return last || "";
}

function _renderResidualMatrix(atDate) {
    var active = D.risks.filter(function(r) { return r.status !== "closed" && r.status !== "archived"; });
    var checkDate = atDate || new Date().toISOString().split("T")[0];
    var grid = {};
    active.forEach(function(r) {
        var imp = r.impact || 1, lik = r.likelihood || 1;
        var resI = r.residual_impact || 0, resL = r.residual_likelihood || 0;
        var hasResidual = resI > 0 && resL > 0;

        if (hasResidual) {
            var measuresApplied = false;
            var v = D.vendors.find(function(x) { return x.id === r.vendor_id; });
            if (v && v.measures) {
                var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
                var allDone = linkedIds.length > 0 && linkedIds.every(function(mid) {
                    var m = v.measures.find(function(x) { return x.id === mid; });
                    return m && m.echeance && m.echeance <= checkDate;
                });
                if (allDone) measuresApplied = true;
            }
            if (r.treatment && r.treatment.due_date && r.treatment.due_date <= checkDate) measuresApplied = true;
            if (measuresApplied) { imp = resI; lik = resL; }
        }

        var k = imp + "-" + lik;
        if (!grid[k]) grid[k] = [];
        grid[k].push({ id: r.id, label: r.title, impact: imp, likelihood: lik, vendor_id: r.vendor_id });
    });
    return ctRenderMatrix({
        levels: 5,
        xLabel: t("risk.impact"),
        yLabel: t("risk.likelihood"),
        grid: grid,
        tooltipFn: function(items) {
            return items.map(function(r) {
                var sc = (r.impact || 1) * (r.likelihood || 1);
                return '<div style="display:flex;gap:6px;align-items:center;padding:2px 0">'
                    + '<span class="' + _scoreClass(sc) + '" style="font-weight:700;min-width:18px">' + sc + '</span>'
                    + '<span style="flex:1">' + esc(r.label || "") + '</span>'
                    + '<span style="color:#94a3b8;font-size:0.85em">' + esc(_vendorName(r.vendor_id)) + '</span>'
                    + '</div>';
            }).join("");
        }
    });
}

function _initTimelineDrag() {
    var zone = document.getElementById("tl-drag-zone");
    if (!zone) return;
    var svg = zone.closest("svg");
    var line = document.getElementById("tl-dateline");
    var label = document.getElementById("tl-dateline-label");
    var meta = window._timelineMeta;
    if (!svg || !line || !meta) return;

    function _xToDate(clientX) {
        var rect = svg.getBoundingClientRect();
        var svgX = (clientX - rect.left) / rect.width * meta.W;
        var pct = Math.max(0, Math.min(1, (svgX - meta.ML) / meta.cW));
        var ms = meta.startDate.getTime() + pct * (meta.endDate.getTime() - meta.startDate.getTime());
        return new Date(ms);
    }

    function _moveTo(clientX) {
        var rect = svg.getBoundingClientRect();
        var svgX = (clientX - rect.left) / rect.width * meta.W;
        svgX = Math.max(meta.ML, Math.min(meta.ML + meta.cW, svgX));
        line.setAttribute("x1", svgX);
        line.setAttribute("x2", svgX);
        label.setAttribute("x", svgX);
        var d = _xToDate(clientX);
        var dateStr = d.toISOString().split("T")[0];
        label.textContent = dateStr;
        // Update residual matrix
        var container = document.getElementById("residual-matrix-svg");
        if (container) container.innerHTML = _renderResidualMatrix(dateStr);
        var dateLabel = document.getElementById("residual-date-label");
        if (dateLabel) dateLabel.textContent = "(" + dateStr + ")";
        var titleEl = document.getElementById("residual-matrix-title");
        var today = new Date().toISOString().split("T")[0];
        if (titleEl) titleEl.textContent = dateStr < today ? t("dashboard.past_matrix") : t("dashboard.residual_matrix");
    }

    var dragging = false;
    zone.addEventListener("mousedown", function(e) { dragging = true; _moveTo(e.clientX); e.preventDefault(); });
    zone.addEventListener("touchstart", function(e) { dragging = true; _moveTo(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
    document.addEventListener("mousemove", function(e) { if (dragging) _moveTo(e.clientX); });
    document.addEventListener("touchmove", function(e) { if (dragging) _moveTo(e.touches[0].clientX); }, { passive: false });
    document.addEventListener("mouseup", function() { dragging = false; });
    document.addEventListener("touchend", function() { dragging = false; });
    // Click anywhere on timeline also moves the line
    zone.addEventListener("click", function(e) { _moveTo(e.clientX); });
}

// ═══════════════════════════════════════════════════════════════
// VENDOR LIST
// ═══════════════════════════════════════════════════════════════

var _vendorFilter = "";
var _vendorStatusFilter = "";

function filterVendors(val) { _vendorFilter = (val || "").toLowerCase(); renderPanel(); }
window.filterVendors = filterVendors;
function filterVendorStatus(val) { _vendorStatusFilter = val || ""; renderPanel(); }
window.filterVendorStatus = filterVendorStatus;

function renderVendorList() {
    var h = '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">';
    h += '<h2>' + t("vendor.title") + '</h2>';
    h += '<div style="display:flex;gap:8px">';
    h += '<button class="btn-add" data-click="addVendor">' + t("vendor.add") + '</button>';
    h += '<button class="btn-add" style="background:var(--light-blue)" data-click="triggerImportRisk">' + t("vendor.import_risk") + '</button>';
    h += '</div></div>';

    // Search + filter bar
    h += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    h += '<input type="text" placeholder="🔍 ' + esc(t("vendor.search")) + '" value="' + esc(_vendorFilter) + '" style="flex:1;min-width:180px;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-input="filterVendors" data-pass-value>';
    h += '<select style="padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-change="filterVendorStatus" data-pass-value>';
    h += '<option value="">' + t("vendor.filter_all") + '</option>';
    h += '<option value="active"' + (_vendorStatusFilter === "active" ? ' selected' : '') + '>' + t("vendor.status_active") + '</option>';
    h += '<option value="prospect"' + (_vendorStatusFilter === "prospect" ? ' selected' : '') + '>' + t("vendor.status_prospect") + '</option>';
    h += '<option value="review"' + (_vendorStatusFilter === "review" ? ' selected' : '') + '>' + t("vendor.status_review") + '</option>';
    h += '<option value="offboarded"' + (_vendorStatusFilter === "offboarded" ? ' selected' : '') + '>' + t("vendor.status_offboarded") + '</option>';
    h += '</select>';
    h += '</div>';

    if (!D.vendors.length) return h + '<div class="empty-state">' + t("vendor.empty") + '</div>';

    var q = _vendorFilter;
    var sf = _vendorStatusFilter;
    var count = 0;

    D.vendors.forEach(function(v, i) {
        // Filter by status
        if (sf && v.status !== sf) return;
        // Filter by search
        if (q) {
            var haystack = ((v.name || "") + " " + (v.sector || "") + " " + (v.legal_entity || "") + " " + (v.id || "")).toLowerCase();
            if (haystack.indexOf(q) < 0) return;
        }
        count++;

        var tier = _getTier(v);
        var statusLabel = t("vendor.status_" + (v.status || "prospect"));
        var statusColor = v.status === "active" ? "var(--green)" : v.status === "offboarded" ? "var(--text-muted)" : v.status === "review" ? "var(--orange)" : "var(--light-blue)";

        // Assessment progress
        var assessments = D.assessments.filter(function(a) { return a.vendor_id === v.id; });
        var lastAssess = assessments.length > 0 ? assessments[assessments.length - 1] : null;
        var completion = lastAssess && lastAssess.completion_rate != null ? lastAssess.completion_rate : null;

        // Next review
        var reviewDate = (v.contract || {}).review_date || "";

        var hasCompletedAssess = assessments.some(function(a) { return a.status === "completed"; });
        var riskCount = D.risks.filter(function(r) { return r.vendor_id === v.id && r.status !== "closed"; }).length;

        h += '<div class="vendor-card" data-click="openVendor" data-args=\'' + _da(i) + '\'>';

        // Left: logo, name, status, tier, DORA/PII badges
        h += '<div class="vendor-card-left">';
        h += _vendorAvatar(v);
        h += '<span class="vendor-name">' + esc(v.name || "") + '</span>';
        h += '<span style="font-size:0.72em;font-weight:600;color:' + statusColor + '">' + esc(statusLabel) + '</span>';
        h += '<span class="tier-badge tier-' + tier + '">' + t("vendor.tier_" + tier) + '</span>';
        if (_isDoraICTCritical(v.classification)) h += '<span class="dora-badge">DORA</span>';
        if (v.classification && v.classification.gdpr_subprocessor) h += '<span class="dora-badge" style="background:#64748b">PII</span>';
        h += '</div>';

        // Right: metrics
        var metrics = [];
        if (riskCount > 0) metrics.push('<span style="color:var(--red);font-weight:600">' + riskCount + ' ' + t("nav.risks").toLowerCase() + '</span>');
        if (!hasCompletedAssess) {
            metrics.push('<span style="color:var(--orange);font-weight:600">' + t("vendor.no_assessment") + '</span>');
        } else if (completion != null) {
            metrics.push('<span style="color:var(--text-muted)">' + t("assessment.completion") + ' ' + completion + '%</span>');
        }
        if (reviewDate) {
            var daysLeft = Math.ceil((new Date(reviewDate) - new Date()) / 86400000);
            var rdColor = daysLeft < 0 ? "var(--red)" : daysLeft < 30 ? "var(--orange)" : "var(--text-muted)";
            metrics.push('<span style="color:' + rdColor + '">' + esc(reviewDate) + '</span>');
        }
        if (metrics.length) h += '<div class="vendor-card-right">' + metrics.join('<span class="vendor-card-sep">·</span>') + '</div>';

        h += '</div>';
    });

    if (count === 0 && (q || sf)) {
        h += '<div class="empty-state">' + t("vendor.no_results") + '</div>';
    }

    return h;
}

function openVendor(idx) {
    _selectedVendor = parseInt(idx);
    _vendorTab = "info";
    renderPanel();
}
window.openVendor = openVendor;

// ═══════════════════════════════════════════════════════════════
// VENDOR DETAIL
// ═══════════════════════════════════════════════════════════════

function renderVendorDetail() {
    var v = D.vendors[_selectedVendor];
    if (!v) return renderVendorList();
    var tier = _getTier(v);
    // Compute risk scores for header
    var _hdrRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
    var _hdrInherent = 0, _hdrResidual = 0, _hdrDueDate = "";
    if (_hdrRisks.length > 0) {
        _hdrInherent = Math.max.apply(null, _hdrRisks.map(function(r) { return (r.impact || 1) * (r.likelihood || 1); }));
        _hdrResidual = Math.max.apply(null, _hdrRisks.map(function(r) {
            var ri = r.residual_impact || r.impact || 1;
            var rl = r.residual_likelihood || r.likelihood || 1;
            return ri * rl;
        }));
        (v.measures || []).filter(function(m) { return m.statut !== "termine"; }).forEach(function(m) {
            if (m.echeance && m.echeance > _hdrDueDate) _hdrDueDate = m.echeance;
        });
    }

    var h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">';
    h += '<button class="btn-add" data-click="backToVendors">&laquo; ' + t("nav.vendors") + '</button>';
    h += '<h2 style="margin:0">' + esc(v.name) + '</h2>';
    h += '<span class="tier-badge tier-' + tier + '">' + t("vendor.tier_" + tier) + '</span>';
    if (_isDoraICTCritical(v.classification)) h += '<span class="dora-badge">DORA</span>';
    if (v.classification && v.classification.gdpr_subprocessor) h += '<span class="dora-badge" style="background:#64748b">PII</span>';
    h += '<span style="flex:1"></span>';
    h += '<button class="btn-del" data-click="deleteVendor" data-args=\'' + _da(_selectedVendor) + '\'>' + t("vendor.delete") + '</button>';
    h += '</div>';
    // Info bar: threat level + risk scores
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    h += '<div id="vendor-info-bar" style="display:flex;align-items:center;gap:12px;margin-bottom:10px;font-size:0.82em;color:var(--text-muted);flex-wrap:wrap">';
    if (menace > 0) {
        h += '<span id="vendor-menace-display">' + t("vendor.threat_level") + ' <strong class="' + _exposureClass(menace) + '">' + menace + ' — ' + _exposureLabel(menace) + '</strong></span>';
    }
    if (_hdrRisks.length > 0) {
        if (menace > 0) h += '<span style="width:1px;height:14px;background:var(--border)"></span>';
        h += '<span>' + t("vendor.inherent_risk") + ' <strong class="' + _scoreClass(_hdrInherent) + '">' + _hdrInherent + '/25</strong></span>';
        h += '<span>' + t("vendor.residual_risk") + ' <strong class="' + _scoreClass(_hdrResidual) + '">' + _hdrResidual + '/25</strong></span>';
        if (_hdrDueDate) h += '<span>' + t("vendor.target_date") + ' <strong>' + esc(_hdrDueDate) + '</strong></span>';
    }
    h += '</div>';

    // Tabs
    h += '<div class="vendor-tabs">';
    ["info", "risks", "assessments", "documents"].forEach(function(tab) {
        h += '<button class="vendor-tab' + (_vendorTab === tab ? ' active' : '') + '" data-click="setVendorTab" data-args=\'' + _da(tab) + '\'>' + t("vendor.tab_" + tab) + '</button>';
    });
    h += '</div>';

    switch (_vendorTab) {
        case "info": h += _renderVendorForm(v); break;
        case "risks": h += _renderVendorRisks(v); break;
        // measures integrated into risks tab
        case "assessments": h += _renderVendorAssessments(v); break;
        case "documents": h += _renderVendorDocs(v); break;
    }
    return h;
}

function _renderVendorForm(v) {
    var c = v.classification || {};
    var ct = v.contract || {};
    var co = v.contact || {};
    var ic = v.internal_contact || {};
    var ex = v.exposure || {};
    var h = '<div class="tprm-form">';

    // ── Identity ──
    h += '<div class="form-grid">';
    h += _field("vendor.name", "v-name", v.name);
    h += _field("vendor.legal_entity", "v-legal", v.legal_entity);
    h += _field("vendor.country", "v-country", v.country);
    h += _field("vendor.sector", "v-sector", v.sector);
    h += _field("vendor.website", "v-website", v.website);
    h += _field("vendor.siret", "v-siret", v.siret);
    h += '</div>';
    // Logo
    h += '<div class="form-row"><label>' + t("vendor.logo") + '</label>';
    h += '<div style="display:flex;gap:8px;align-items:center">';
    h += _vendorAvatar(v);
    h += '<input type="url" id="v-logo-url" placeholder="https://example.com/logo.png" style="flex:1">';
    h += '<button class="btn-add" style="white-space:nowrap;margin:0" data-click="_fetchLogo">' + t("vendor.logo_fetch") + '</button>';
    h += '</div>';
    if (v.logo && v.logo.startsWith("data:")) {
        h += '<div style="font-size:0.72em;color:var(--green);margin-top:3px">' + t("vendor.logo_stored") + '</div>';
    }
    h += '</div>';

    // ── Status ──
    h += '<div class="form-grid">';
    h += _select("vendor.status", "v-status", v.status || "prospect", [
        ["prospect", t("vendor.status_prospect")], ["active", t("vendor.status_active")],
        ["review", t("vendor.status_review")], ["offboarded", t("vendor.status_offboarded")]
    ]);
    h += '</div>';

    // ── Vendor contact ──
    h += '<div class="form-section">' + t("vendor.section_contacts") + '</div>';
    h += '<div class="form-grid">';
    h += _field("vendor.contact_name", "v-cname", co.name);
    h += _field("vendor.contact_email", "v-cemail", co.email);
    h += '</div>';
    h += '<div class="form-grid">';
    h += _field("vendor.internal_contact_name", "v-icname", ic.name);
    h += _field("vendor.internal_contact_email", "v-icemail", ic.email);
    h += '</div>';

    // ── Contract ──
    h += '<div class="form-section">' + t("vendor.section_contract") + '</div>';
    h += '<div class="form-row"><label>' + t("vendor.services") + '</label>';
    h += '<textarea id="v-services" rows="3" class="w-full" data-input="_autoSaveVendorField">' + esc(ct.services || "") + '</textarea></div>';
    h += '<div class="form-grid">';
    h += _field("vendor.contract_start", "v-cstart", ct.start_date, "date");
    h += _field("vendor.contract_end", "v-cend", ct.end_date, "date");
    h += _field("vendor.review_date", "v-creview", ct.review_date, "date");
    h += '</div>';

    // ── Classification (2 columns: Dépendance | Pénétration) ──
    h += '<div class="form-section">' + t("vendor.section_classification") + '</div>';
    h += '<div class="cls-columns">';
    h += '<div class="cls-col">';
    h += '<div class="cls-col-title">' + t("vendor.dependance") + '</div>';
    h += _slider("vendor.cls_ops_impact", "v-cls-ops", c.ops_impact || 0, 4);
    h += _slider("vendor.cls_processes", "v-cls-proc", c.processes || 0, 4);
    h += _slider("vendor.cls_replace_difficulty", "v-cls-repl", c.replace_difficulty || 0, 4);
    h += '</div>';
    h += '<div class="cls-col">';
    h += '<div class="cls-col-title">' + t("vendor.penetration") + '</div>';
    h += _slider("vendor.cls_data_sensitivity", "v-cls-data", c.data_sensitivity || 0, 4);
    h += _slider("vendor.cls_integration", "v-cls-integ", c.integration || 0, 4);
    h += _slider("vendor.cls_regulatory", "v-cls-reg", c.regulatory_impact || 0, 4);
    h += '</div>';
    h += '</div>';

    // Hidden inputs for computed values used by _computeExposure
    var dep = _avgSliders([c.ops_impact, c.processes, c.replace_difficulty]);
    var pen = _avgSliders([c.data_sensitivity, c.integration, c.regulatory_impact]);
    h += '<input type="hidden" id="v-dep" value="' + dep + '">';
    h += '<input type="hidden" id="v-pen" value="' + pen + '">';
    h += '<input type="hidden" id="v-mat" value="' + (ex.maturite || 0) + '">';
    h += '<input type="hidden" id="v-conf" value="' + (ex.confiance || 0) + '">';

    // Threat level result
    var menace = _computeExposure({ dependance: dep, penetration: pen, maturite: ex.maturite || 0, confiance: ex.confiance || 0 });
    var clsScore = _computeClassificationScore(c);
    var isDoraCritical = _isDoraICTCritical(c);
    h += '<div class="exposure-result" id="threat-result">';
    h += '<span>' + t("vendor.threat_level") + ' : </span>';
    h += '<strong class="' + _exposureClass(menace) + '">' + menace + '/4</strong>';
    h += ' — <span class="' + _exposureClass(menace) + '">' + _exposureLabel(menace) + '</span>';
    if (isDoraCritical) h += ' <span class="dora-badge">' + t("vendor.dora_critical") + '</span>';
    h += '</div>';
    h += '<div style="font-size:0.78em;color:var(--text-muted);margin-top:2px">';
    h += t("vendor.dependance") + ' : <strong>' + dep + '/4</strong>';
    h += ' — ' + t("vendor.penetration") + ' : <strong>' + pen + '/4</strong>';
    if (ex.maturite || ex.confiance) {
        h += ' — ' + t("vendor.maturite") + ' : <strong>' + (ex.maturite || 0) + '/4</strong>';
        h += ' — ' + t("vendor.confiance") + ' : <strong>' + (ex.confiance || 0) + '/4</strong>';
    }
    h += '</div>';

    // GDPR checkbox only
    h += '<div style="margin:10px 0">';
    h += '<label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;font-size:0.85em;font-weight:600;margin:0">';
    h += '<input type="checkbox" id="v-gdpr"' + (c.gdpr_subprocessor ? ' checked' : '') + ' data-change="_autoSaveVendorField">';
    h += '<span>' + t("vendor.gdpr_subprocessor") + '</span>';
    h += '</label>';
    h += '</div>';

    // ── Notes ──
    h += '<div class="form-row"><label>' + t("vendor.notes") + '</label><textarea id="v-notes" rows="4" class="w-full" data-input="_autoSaveVendorField">' + esc(v.notes || "") + '</textarea></div>';

    // Auto-save — no save button needed
    h += '</div>';
    return h;
}

// ── Exposure helpers (same formula as PP in Risk) ──
function _computeExposure(ex) {
    if (!ex) return 0;
    var d = ex.dependance || 0, p = ex.penetration || 0, m = ex.maturite || 0, c = ex.confiance || 0;
    if (!d || !p || !m || !c) return 0;
    return Math.round((d * p) / (m * c) * 100) / 100;
}

function _refreshThreatDisplay() {
    var v = _selectedVendor !== null ? D.vendors[_selectedVendor] : null;
    if (!v) return;
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    // Update hidden inputs
    var matEl = document.getElementById("v-mat"); if (matEl) matEl.value = ex.maturite || 0;
    var confEl = document.getElementById("v-conf"); if (confEl) confEl.value = ex.confiance || 0;
    // Update threat display
    var threatEl = document.getElementById("threat-result");
    if (threatEl) {
        var cls = v.classification || {};
        var dora = _isDoraICTCritical(cls);
        threatEl.innerHTML = '<span>' + t("vendor.threat_level") + ' : </span>' +
            '<strong class="' + _exposureClass(menace) + '">' + menace + '</strong>' +
            ' — <span class="' + _exposureClass(menace) + '">' + _exposureLabel(menace) + '</span>' +
            (dora ? ' <span class="dora-badge">' + t("vendor.dora_critical") + '</span>' : '');
        var tier = menace >= 4 ? "critical" : menace >= 2 ? "high" : menace >= 1 ? "medium" : "low";
        var tierBadge = document.getElementById("header-tier-badge");
        if (tierBadge) { tierBadge.className = "tier-badge tier-" + tier; tierBadge.textContent = t("vendor.tier_" + tier); }
        var doraBadge = document.getElementById("header-dora-badge");
        if (doraBadge) doraBadge.style.display = dora ? "" : "none";
        var detailEl = threatEl.nextElementSibling;
        if (detailEl && detailEl.style && detailEl.style.fontSize === "0.78em") {
            detailEl.innerHTML = t("vendor.dependance") + ' : <strong>' + (ex.dependance || 0) + '/4</strong>' +
                ' — ' + t("vendor.penetration") + ' : <strong>' + (ex.penetration || 0) + '/4</strong>' +
                ' — ' + t("vendor.maturite") + ' : <strong>' + (ex.maturite || 0) + '/4</strong>' +
                ' — ' + t("vendor.confiance") + ' : <strong>' + (ex.confiance || 0) + '/4</strong>';
        }
    }
    // Update the info bar at top of vendor detail
    var menaceSpan = document.getElementById("vendor-menace-display");
    if (menaceSpan) {
        if (menace > 0) {
            menaceSpan.innerHTML = t("vendor.threat_level") + ' <strong class="' + _exposureClass(menace) + '">' + menace + ' — ' + _exposureLabel(menace) + '</strong>';
            menaceSpan.style.display = "";
        } else {
            menaceSpan.style.display = "none";
        }
    }
}

function _exposureClass(level) {
    if (level >= 4) return "score-critical";
    if (level >= 2) return "score-high";
    if (level >= 1) return "score-medium";
    return "score-low";
}

function _exposureLabel(level) {
    if (level >= 4) return t("vendor.exposure_critical");
    if (level >= 2) return t("vendor.exposure_high");
    if (level >= 1) return t("vendor.exposure_moderate");
    return t("vendor.exposure_low");
}

function _avgSliders(vals) {
    var sum = 0;
    vals.forEach(function(v) { sum += (v || 0); });
    return Math.round(sum / vals.length * 10) / 10;
}

function _computeClassificationScore(c) {
    if (!c) return 0;
    var all = [c.ops_impact, c.processes, c.replace_difficulty, c.data_sensitivity, c.integration, c.regulatory_impact];
    var sum = 0;
    all.forEach(function(v) { sum += (v || 0); });
    return Math.round(sum / all.length * 10) / 10;
}

function _isDoraICTCritical(c) {
    if (!c || !_isDoraEnabled()) return false;
    var th = _getDoraThresholds();
    var vals = [c.ops_impact || 0, c.processes || 0, c.replace_difficulty || 0, c.data_sensitivity || 0, c.integration || 0, c.regulatory_impact || 0];
    var maxed = vals.filter(function(v) { return v === 4; }).length;
    var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
    return maxed >= th.maxCriteria || avg >= th.avgScore;
}

function _slider(labelKey, id, value, max) {
    var h = '<div class="form-row">';
    h += '<label>' + t(labelKey) + '</label>';
    h += '<div style="display:flex;align-items:center;gap:8px">';
    h += '<input type="range" id="' + id + '" min="0" max="' + max + '" value="' + (value || 0) + '" class="slider-input" style="flex:1" data-invert data-input="_onSliderChange" data-pass-el>';
    h += '<span id="' + id + '-val" class="slider-label" style="min-width:20px">' + (value || 0) + '</span>';
    h += '</div></div>';
    return h;
}

function _onSliderChange(el) {
    var valSpan = document.getElementById(el.id + "-val");
    if (valSpan) valSpan.textContent = el.value;
    _applySliderStyle(el);
    // Recompute D/P from classification sliders and save to vendor
    var v = _selectedVendor !== null ? D.vendors[_selectedVendor] : null;
    if (v) {
        var _el = function(id) { var e = document.getElementById(id); return e ? parseInt(e.value) || 0 : 0; };
        var cls = {
            ops_impact: _el("v-cls-ops"), processes: _el("v-cls-proc"), replace_difficulty: _el("v-cls-repl"),
            data_sensitivity: _el("v-cls-data"), integration: _el("v-cls-integ"), regulatory_impact: _el("v-cls-reg")
        };
        v.classification = cls;
        if (!v.exposure) v.exposure = {};
        v.exposure.dependance = _avgSliders([cls.ops_impact, cls.processes, cls.replace_difficulty]);
        v.exposure.penetration = _avgSliders([cls.data_sensitivity, cls.integration, cls.regulatory_impact]);
        _refreshThreatDisplay();
    }
    _autoSaveVendorField();
}
window._onSliderChange = _onSliderChange;

var _vrefCounter = 1000;

function _renderVendorRisks(v) {
    if (!v.measures) v.measures = [];
    var risks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
    var h = '<div class="panel-desc" style="margin-bottom:10px;font-size:0.82em">' + t("risk.vendor_help") + '</div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    h += '<strong>' + t("risk.title") + ' (' + risks.length + ')</strong>';
    h += '<div style="display:flex;gap:6px">';
    if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
        h += '<button class="btn-add" style="background:var(--light-blue)" data-click="openAiRiskAssistant" data-args=\'' + _da(_selectedVendor) + '\'>&#129302; IA</button>';
    }
    h += '<button class="btn-add" data-click="addRiskForVendor" data-args=\'' + _da(v.id) + '\'>' + t("risk.add") + '</button>';
    h += '</div></div>';
    if (!risks.length) return h + '<div style="color:var(--text-muted);font-size:0.85em">' + t("risk.empty") + '</div>';

    // Split measures into "en place" (terminé) and "prévues" (planifié/en_cours)
    var measEnPlace = v.measures.filter(function(m) { return m.statut === "termine"; });
    var measPrevues = v.measures.filter(function(m) { return m.statut !== "termine"; });
    var optsEnPlace = measEnPlace.map(function(m) { return { id: m.id, label: (m.mesure || "").substring(0, 50) }; });
    var optsPrevues = measPrevues.map(function(m) { return { id: m.id, label: (m.mesure || "").substring(0, 50) }; });

    h += colsButton("vendor-risks-table");
    h += '<table id="vendor-risks-table"><thead><tr>';
    h += '<th' + hd("id") + '>ID</th>';
    h += '<th' + hd("title") + '>' + t("risk.risk_title") + '</th>';
    h += '<th' + hd("cat") + '>' + t("risk.category") + '</th>';
    h += '<th' + hd("impact") + ' style="width:40px">' + t("risk.impact_short") + '</th>';
    h += '<th' + hd("likelihood") + ' style="width:40px">' + t("risk.likelihood_short") + '</th>';
    h += '<th' + hd("initial") + ' style="width:40px">' + t("risk.initial") + '</th>';
    h += '<th' + hd("mip") + '>' + t("risk.measures_in_place") + '</th>';
    h += '<th' + hd("mpl") + '>' + t("risk.measures_planned") + '</th>';
    h += '<th' + hd("treat") + ' style="width:80px">' + t("risk.treatment") + '</th>';
    h += '<th' + hd("resi") + ' style="width:40px">' + t("risk.res_impact") + '</th>';
    h += '<th' + hd("resl") + ' style="width:40px">' + t("risk.res_likelihood") + '</th>';
    h += '<th' + hd("resscore") + ' style="width:40px">' + t("risk.residual") + '</th>';
    h += '<th style="width:30px"></th>';
    h += '</tr></thead><tbody>';

    risks.forEach(function(r) {
        var riskIdx = D.risks.indexOf(r);
        var sc = (r.impact || 1) * (r.likelihood || 1);

        // Split linked measures by status
        var linkedIds = (r.linked_measures || "").split(",").map(function(s) { return s.trim().split(" - ")[0].trim(); }).filter(Boolean);
        var inPlaceIds = [], prevueIds = [];
        linkedIds.forEach(function(id) {
            var m = v.measures.find(function(x) { return x.id === id; });
            if (m && m.statut === "termine") inPlaceIds.push(id);
            else prevueIds.push(id);
        });
        var inPlaceVal = inPlaceIds.map(function(id) { var m = v.measures.find(function(x) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }).join(", ");
        var prevueVal = prevueIds.map(function(id) { var m = v.measures.find(function(x) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }).join(", ");

        // Residual: user-defined if set, otherwise defaults to initial
        var resI = r.residual_impact || 0;
        var resL = r.residual_likelihood || 0;
        var resSc = resI && resL ? resI * resL : sc;

        // Detect if re-evaluation is needed: measures in place but residual not yet adjusted
        var needsReeval = inPlaceIds.length > 0 && (!resI || !resL);

        h += '<tr' + (needsReeval ? ' style="background:#fef9c3"' : '') + '>';
        h += '<td' + hd("id") + ' class="fw-600">' + esc(r.id) + '</td>';
        h += '<td' + hd("title") + '><input type="text" value="' + esc(r.title || "") + '" class="w-full" style="font-size:0.85em" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "title") + '\' data-pass-value></td>';
        h += '<td' + hd("cat") + '><select style="font-size:0.82em" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "category") + '\' data-pass-value>';
        ["CYBER","OPS","FIN","COMP","STRAT","REP","GEO"].forEach(function(cat) {
            h += '<option value="' + cat + '"' + (r.category === cat ? ' selected' : '') + '>' + cat + '</option>';
        });
        h += '</select></td>';

        // Impact initial (editable 1-5)
        h += '<td' + hd("impact") + '><select style="font-size:0.85em;font-weight:700;width:40px" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "impact") + '\' data-pass-value>';
        for (var ii = 1; ii <= 5; ii++) h += '<option value="' + ii + '"' + (r.impact == ii ? ' selected' : '') + '>' + ii + '</option>';
        h += '</select></td>';

        // Likelihood initial (editable 1-5)
        h += '<td' + hd("likelihood") + '><select style="font-size:0.85em;font-weight:700;width:40px" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "likelihood") + '\' data-pass-value>';
        for (var li = 1; li <= 5; li++) h += '<option value="' + li + '"' + (r.likelihood == li ? ' selected' : '') + '>' + li + '</option>';
        h += '</select></td>';

        // Inherent score (auto)
        h += '<td' + hd("initial") + ' class="' + _scoreClass(sc) + '" style="font-weight:700;text-align:center">' + sc + '</td>';

        // Measures in place
        var uidInPlace = "vref" + (_vrefCounter++);
        ctRefRegister(uidInPlace, {
            single: false,
            emptyText: t("measure.click_to_link"),
            labelFor: function(id) { var m = (v.measures || []).find(function(x) { return x.id === id; }); return m ? (m.mesure || "").substring(0, 50) : ""; },
            tagClick: function(u, optId) { var _mi = -1; if (v.measures) { for (var _k = 0; _k < v.measures.length; _k++) { if (v.measures[_k].id === optId) { _mi = _k; break; } } } if (_mi >= 0) editMeasure(_selectedVendor, _mi, "risks"); },
            onToggle: function() {},
            onRemove: function() {},
            onFlush: function() {},
        });
        h += '<td' + hd("mip") + ' style="min-width:120px">' + ctRefSelect(uidInPlace, inPlaceVal, optsEnPlace, { placeholder: t("measure.filter"), emptyText: t("measure.click_to_link"), tagClick: true }) + '</td>';

        // Measures planned + add + AI
        var uidPlanned = "vref" + (_vrefCounter++);
        ctRefRegister(uidPlanned, {
            single: false,
            emptyText: t("measure.click_to_link"),
            labelFor: function(id) { var m = (v.measures || []).find(function(x) { return x.id === id; }); return m ? (m.mesure || "").substring(0, 50) : ""; },
            tagClick: function(u, optId) { var _mi = -1; if (v.measures) { for (var _k = 0; _k < v.measures.length; _k++) { if (v.measures[_k].id === optId) { _mi = _k; break; } } } if (_mi >= 0) editMeasure(_selectedVendor, _mi, "risks"); },
            onToggle: (function(ri) { return function(u, ids, el) { var r = D.risks[ri]; if (!r) return; var vn = D.vendors[_selectedVendor]; var labels = ids.map(function(id) { var m = (vn && vn.measures || []).find(function(x) { return x.id === id; }); return id + " - " + (m ? (m.mesure || "").substring(0, 40) : ""); }); r.linked_measures = labels.join(", "); _autoSave(); }; })(riskIdx),
            onRemove: (function(ri) { return function(u, measureId) { var r = D.risks[ri]; if (!r) return; var parts = (r.linked_measures || "").split(",").map(function(s) { return s.trim(); }); parts = parts.filter(function(p) { return p.split(" - ")[0].trim() !== measureId; }); r.linked_measures = parts.join(", "); _autoSave(); renderPanel(); }; })(riskIdx),
            onFlush: function() { renderPanel(); },
        });
        h += '<td' + hd("mpl") + ' style="min-width:120px">';
        h += ctRefSelect(uidPlanned, prevueVal, optsPrevues, { placeholder: t("measure.filter"), emptyText: t("measure.click_to_link"), tagClick: true });
        h += '<div style="display:flex;gap:4px;margin-top:3px">';
        h += '<button class="btn-add btn-add-sm" data-click="addMeasureForRisk" data-args=\'' + _da(_selectedVendor, riskIdx) + '\'>' + t("measure.add") + '</button>';
        if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
            h += '<button class="btn-add btn-add-sm" style="background:var(--light-blue)" data-click="suggestMeasuresForRisk" data-args=\'' + _da(_selectedVendor, riskIdx) + '\'>AI</button>';
        }
        h += '</div></td>';

        // Treatment
        h += '<td' + hd("treat") + '><select style="font-size:0.78em" data-change="updateRiskField" data-args=\'' + _da(riskIdx, "treatment.response") + '\' data-pass-value>';
        ["mitigate","transfer","accept","avoid"].forEach(function(tr) {
            var sel = (r.treatment && r.treatment.response === tr) ? ' selected' : '';
            h += '<option value="' + tr + '"' + sel + '>' + t("risk.treatment_" + tr) + '</option>';
        });
        h += '</select></td>';

        // Residual impact (editable, capped at initial impact — locked for accept/avoid)
        var resIStyle = needsReeval ? 'background:#fef9c3;border:2px solid var(--orange)' : '';
        var treatmentLocked = r.treatment && (r.treatment.response === "accept" || r.treatment.response === "avoid");
        var maxResI = r.impact || 5;
        h += '<td' + hd("resi") + '><select style="font-size:0.85em;font-weight:700;width:40px;' + resIStyle + '"' + (treatmentLocked ? ' disabled title="' + esc(t("risk.locked_by_treatment")) + '"' : '') + ' data-change="updateRiskField" data-args=\'' + _da(riskIdx, "residual_impact") + '\' data-pass-value>';
        h += '<option value="0"' + (!resI ? ' selected' : '') + '>-</option>';
        for (var ri = 1; ri <= maxResI; ri++) h += '<option value="' + ri + '"' + (resI == ri ? ' selected' : '') + '>' + ri + '</option>';
        h += '</select></td>';

        // Residual likelihood (editable, capped at initial likelihood — locked for accept/avoid)
        var maxResL = r.likelihood || 5;
        h += '<td' + hd("resl") + '><select style="font-size:0.85em;font-weight:700;width:40px;' + resIStyle + '"' + (treatmentLocked ? ' disabled title="' + esc(t("risk.locked_by_treatment")) + '"' : '') + ' data-change="updateRiskField" data-args=\'' + _da(riskIdx, "residual_likelihood") + '\' data-pass-value>';
        h += '<option value="0"' + (!resL ? ' selected' : '') + '>-</option>';
        for (var rl = 1; rl <= maxResL; rl++) h += '<option value="' + rl + '"' + (resL == rl ? ' selected' : '') + '>' + rl + '</option>';
        h += '</select></td>';

        // Residual score (auto from residual I×L, or "⚠" if not set)
        if (resI && resL) {
            h += '<td' + hd("resscore") + ' class="' + _scoreClass(resSc) + '" style="font-weight:700;text-align:center">' + resSc + '</td>';
        } else if (needsReeval) {
            h += '<td' + hd("resscore") + ' style="text-align:center;font-size:1.1em" title="' + esc(t("risk.needs_reeval")) + '">⚠️</td>';
        } else {
            h += '<td' + hd("resscore") + ' style="text-align:center;color:var(--text-muted)">-</td>';
        }

        h += '<td><button class="btn-del" data-click="deleteRisk" data-args=\'' + _da(riskIdx) + '\'>✕</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';

    // Measures registry below the risk table
    if (v.measures.length > 0) {
        h += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">';
        h += '<strong style="font-size:0.85em">' + t("measure.registry") + ' (' + v.measures.length + ')</strong>';
        h += colsButton("vendor-measures-table");
        h += '<table id="vendor-measures-table" style="font-size:0.82em;margin-top:6px"><thead><tr>';
        h += '<th' + hd("id") + ' style="width:70px">ID</th><th' + hd("mesure") + '>' + t("measure.col_mesure") + '</th><th' + hd("type") + '>' + t("measure.col_type") + '</th>';
        h += '<th' + hd("statut") + '>' + t("measure.col_statut") + '</th><th' + hd("resp") + '>' + t("measure.col_responsable") + '</th>';
        h += '<th' + hd("deadline") + '>' + t("measure.col_echeance") + '</th><th style="width:30px"></th></tr></thead><tbody>';
        v.measures.forEach(function(m, mi) {
            var statColor = m.statut === "termine" ? "var(--green)" : m.statut === "en_cours" ? "var(--orange)" : "var(--text-muted)";
            h += '<tr><td' + hd("id") + ' class="fw-600">' + esc(m.id) + '</td>';
            h += '<td' + hd("mesure") + '><input type="text" value="' + esc(m.mesure || "") + '" class="w-full" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "mesure") + '\' data-pass-value></td>';
            h += '<td' + hd("type") + '><select style="font-size:0.9em" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "type") + '\' data-pass-value>';
            ["Contractuelle","Technique","Organisationnelle","Surveillance"].forEach(function(tp) {
                h += '<option value="' + tp + '"' + (m.type === tp ? ' selected' : '') + '>' + tp + '</option>';
            });
            h += '</select></td>';
            h += '<td' + hd("statut") + '><select style="font-size:0.9em" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "statut") + '\' data-pass-value>';
            [["planifie",t("measure.planifie")],["en_cours",t("measure.en_cours")],["termine",t("measure.termine")]].forEach(function(s) {
                h += '<option value="' + s[0] + '"' + (m.statut === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
            });
            h += '</select></td>';
            h += '<td' + hd("resp") + '><input type="text" value="' + esc(m.responsable || "") + '" style="width:80px" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "responsable") + '\' data-pass-value></td>';
            h += '<td' + hd("deadline") + '><input type="date" value="' + esc(m.echeance || "") + '" data-change="updateVendorMeasure" data-args=\'' + _da(_selectedVendor, mi, "echeance") + '\' data-pass-value></td>';
            h += '<td><button class="btn-del" data-click="deleteVendorMeasure" data-args=\'' + _da(_selectedVendor, mi) + '\'>✕</button></td></tr>';
        });
        h += '</tbody></table></div>';
    }

    return h;
}

function addMeasureForRisk(vendorIdx, riskIdx) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r) return;
    var desc = prompt(t("measure.prompt_new"));
    if (!desc) return;
    if (!v.measures) v.measures = [];
    var nextNum = v.measures.length + 1;
    var mId = v.id + "-M" + String(nextNum).padStart(2, "0");
    v.measures.push({
        id: mId, mesure: desc, details: "", type: "Contractuelle", statut: "planifie",
        responsable: "", echeance: "", ref_socle: "", effet: ""
    });
    // Link to risk
    var current = r.linked_measures || "";
    var newRef = mId + " - " + desc;
    r.linked_measures = current ? current + ", " + newRef : newRef;
    _autoSave();
    renderPanel();
}
window.addMeasureForRisk = addMeasureForRisk;

// ═══════════════════════════════════════════════════════════════
// MEASURES (same format as Risk ecosystem measures)
// ═══════════════════════════════════════════════════════════════

function addVendorMeasure(vendorIdx) {
    var v = D.vendors[vendorIdx];
    if (!v) return;
    if (!v.measures) v.measures = [];
    var nextNum = v.measures.length + 1;
    v.measures.push({
        id: v.id + "-M" + String(nextNum).padStart(2, "0"),
        mesure: "", details: "", type: "Contractuelle", statut: "planifie",
        responsable: "", echeance: "", ref_socle: "", effet: ""
    });
    _autoSave();
    renderPanel();
}
window.addVendorMeasure = addVendorMeasure;

function updateVendorMeasure(vendorIdx, measureIdx, field, value) {
    var v = D.vendors[vendorIdx];
    if (!v || !v.measures || !v.measures[measureIdx]) return;
    v.measures[measureIdx][field] = value;
    _autoSave();
    // Re-render panel when fields that affect timeline/matrix change
    if (field === "echeance" || field === "statut") {
        renderPanel();
    }
}
window.updateVendorMeasure = updateVendorMeasure;

function deleteVendorMeasure(vendorIdx, measureIdx) {
    var v = D.vendors[vendorIdx];
    if (!v || !v.measures) return;
    if (!confirm(t("measure.confirm_delete"))) return;
    v.measures.splice(measureIdx, 1);
    _autoSave();
    renderPanel();
}
window.deleteVendorMeasure = deleteVendorMeasure;

// ── AI: suggest measures for a vendor ──
function suggestVendorMeasures(vendorIdx) {
    var v = D.vendors[vendorIdx];
    if (!v || typeof _aiCallAPI !== "function") return;

    var ex = v.exposure || {};
    var risks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
    var existingMeasures = (v.measures || []).map(function(m) { return m.mesure; }).join(", ");

    var systemPrompt = "You are a third-party risk management expert. Propose measures to mitigate VENDOR-SPECIFIC risks. " +
        "Vendor risks = risks inherent to the vendor relationship (data breach at vendor, compliance loss, vendor lock-in, subcontractor failure, SLA violation, data sovereignty). " +
        "NOT generic IT risks (phishing, ransomware, insider threats — those belong in a risk assessment tool, not vendor management). " +
        "IMPORTANT: always include the vendor name '" + (v.name || "") + "' in each measure name. " +
        "Respond ONLY with valid JSON: " +
        '[{"mesure":"SHORT name max 8 words — ' + (v.name || "Vendor") + '","details":"DETAILED implementation steps, procedures, tools, frequency, responsible teams (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|Surveillance","responsable":"suggested owner"}]' +
        " Respond in " + (_locale === "en" ? "English" : "French") + ". Propose 3-5 measures.";

    var userPrompt = "Vendor: " + JSON.stringify({ name: v.name, sector: v.sector, services: (v.contract || {}).services }) +
        "\nExposure: " + JSON.stringify(ex) +
        "\nRisks: " + JSON.stringify(risks.map(function(r) { return { title: r.title, category: r.category, impact: r.impact, likelihood: r.likelihood }; })) +
        "\nExisting measures: " + (existingMeasures || "none") +
        "\nClassification: " + JSON.stringify(v.classification || {}) +
        "\nTier: " + _getTier(v) +
        (_isDoraICTCritical(v.classification) ? "\nDORA critical ICT provider: yes" : "") +
        (v.classification && v.classification.gdpr_subprocessor ? "\nGDPR subprocessor: yes" : "");

    showStatus(t("measure.ai_loading"));

    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        try {
            var suggestions = _aiParseJSON(raw);
            if (!Array.isArray(suggestions)) suggestions = [suggestions];
            if (!v.measures) v.measures = [];
            var count = 0;
            suggestions.forEach(function(s) {
                var nextNum = v.measures.length + 1;
                v.measures.push({
                    id: v.id + "-M" + String(nextNum).padStart(2, "0"),
                    mesure: s.mesure || s.measure || "", details: s.details || s.description || "",
                    type: s.type || "Contractuelle", statut: "planifie",
                    responsable: s.responsable || s.owner || "", echeance: "", ref_socle: "", effet: s.effet || ""
                });
                count++;
            });
            _autoSave();
            renderPanel();
            showStatus(count + " " + t("measure.ai_added"));
        } catch (e) {
            showStatus(t("measure.ai_error"));
        }
    }).catch(function(e) {
        showStatus(t("measure.ai_error") + ": " + e.message);
    });
}
window.suggestVendorMeasures = suggestVendorMeasures;

// Store context for accept handler
var _aiSuggestions = [];
var _aiSuggestContext = {};

function suggestMeasuresForRisk(vendorIdx, riskIdx) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r || typeof _aiCallAPI !== "function") return;

    _aiSuggestContext = { vendorIdx: vendorIdx, riskIdx: riskIdx, type: "risk_measures" };

    var systemPrompt = "You are a third-party risk management expert. Propose 2-3 measures to mitigate a VENDOR-SPECIFIC risk. " +
        "This risk is about the vendor relationship itself, not about generic IT threats. " +
        "Measures should address the vendor's practices, contractual obligations, monitoring, or alternatives. " +
        "IMPORTANT: always include the vendor name '" + (v.name || "") + "' in each measure name. " +
        "Respond ONLY with valid JSON: " +
        '[{"mesure":"SHORT name max 8 words — ' + (v.name || "Vendor") + '","details":"DETAILED implementation steps, procedures, tools, frequency, responsible teams (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|Surveillance","responsable":"suggested owner"}]' +
        " Respond in " + (_locale === "en" ? "English" : "French") + ".";

    var userPrompt = "Vendor: " + v.name + " (" + (v.sector || "") + ")" +
        "\nRisk to mitigate: " + JSON.stringify({ title: r.title, category: r.category, impact: r.impact, likelihood: r.likelihood, description: r.description }) +
        "\nExisting measures: " + ((v.measures || []).map(function(m) { return m.mesure; }).join(", ") || "none");

    _aiShowLoading("✨ " + t("measure.ai_suggest") + " — " + esc(r.title || r.id));

    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        var suggestions = _aiParseJSON(raw);
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e) {
        _aiShowError("AI", e.message);
    });
}
window.suggestMeasuresForRisk = suggestMeasuresForRisk;

function openAiRiskAssistant(vendorIdx) {
    var v = D.vendors[vendorIdx];
    if (!v) return;
    var risks = D.risks.filter(function(r) { return r.vendor_id === v.id; });

    var p = _aiEnsurePanel();
    p.title.textContent = "IA — " + v.name;

    var h = '<div style="padding:4px">';

    // Option 1: Propose risks
    h += '<div class="settings-section">';
    h += '<div class="settings-label">' + t("ai.option_risks") + '</div>';
    h += '<p class="fs-xs text-muted" style="margin-bottom:8px">' + t("ai.option_risks_hint") + '</p>';
    h += '<textarea class="settings-input" id="ai-risk-prompt" rows="2" placeholder="' + esc(t("ai.custom_prompt_placeholder")) + '" style="width:100%;margin-bottom:8px"></textarea>';
    h += '<button class="btn-add" style="background:var(--light-blue);width:100%" data-click="aiRunRiskSuggestion" data-args=\'' + _da(vendorIdx) + '\'>&#129302; ' + t("ai.generate_risks") + '</button>';
    h += '</div>';

    // Option 2: Add measures for a risk
    if (risks.length > 0) {
        h += '<div class="settings-section">';
        h += '<div class="settings-label">' + t("ai.option_measures") + '</div>';
        h += '<p class="fs-xs text-muted" style="margin-bottom:8px">' + t("ai.option_measures_hint") + '</p>';
        h += '<select class="settings-input" id="ai-risk-select" style="width:100%;margin-bottom:8px">';
        risks.forEach(function(r, i) {
            var rIdx = D.risks.indexOf(r);
            var score = (r.impact || 1) * (r.likelihood || 1);
            h += '<option value="' + rIdx + '">' + esc(r.id + ' — ' + r.title + ' (' + score + ')') + '</option>';
        });
        h += '</select>';
        h += '<textarea class="settings-input" id="ai-measure-prompt" rows="2" placeholder="' + esc(t("ai.custom_prompt_placeholder")) + '" style="width:100%;margin-bottom:8px"></textarea>';
        h += '<button class="btn-add" style="background:var(--light-blue);width:100%" data-click="aiRunMeasureSuggestion" data-args=\'' + _da(vendorIdx) + '\'>&#129302; ' + t("ai.generate_measures") + '</button>';
        h += '</div>';
    } else {
        h += '<div class="settings-section">';
        h += '<div class="settings-label">' + t("ai.option_measures") + '</div>';
        h += '<p class="fs-xs text-muted">' + t("ai.no_risks_yet") + '</p>';
        h += '</div>';
    }

    h += '</div>';

    p.body.innerHTML = h;
    p.footer.innerHTML = '<button class="ai-btn-close" id="ai-assist-close">' + t("common.close") + '</button>';
    _aiOpenPanel();
    document.getElementById("ai-assist-close").onclick = _aiClosePanel;
}
window.openAiRiskAssistant = openAiRiskAssistant;

function aiRunRiskSuggestion(vendorIdx) {
    var customPrompt = (document.getElementById("ai-risk-prompt") || {}).value || "";
    _aiClosePanel();
    if (customPrompt.trim()) {
        _aiSuggestRisksCustom(vendorIdx, customPrompt.trim());
    } else {
        aiSuggestRisksAndMeasures(vendorIdx);
    }
}
window.aiRunRiskSuggestion = aiRunRiskSuggestion;

function aiRunMeasureSuggestion(vendorIdx) {
    var riskIdx = parseInt((document.getElementById("ai-risk-select") || {}).value);
    var customPrompt = (document.getElementById("ai-measure-prompt") || {}).value || "";
    _aiClosePanel();
    if (customPrompt.trim()) {
        _aiSuggestMeasuresCustom(vendorIdx, riskIdx, customPrompt.trim());
    } else {
        suggestMeasuresForRisk(vendorIdx, riskIdx);
    }
}
window.aiRunMeasureSuggestion = aiRunMeasureSuggestion;

function _aiSuggestRisksCustom(vendorIdx, prompt) {
    var v = D.vendors[vendorIdx];
    if (!v || typeof _aiCallAPI !== "function") return;

    var systemPrompt = "You are a third-party risk management expert. The user has a specific request about vendor risks. " +
        "FOCUS ON CLIENT IMPACT: each risk must describe a concrete negative consequence FOR THE CLIENT'S ORGANIZATION if something goes wrong with this vendor. " +
        "GOOD risk titles: 'Patient data breach via vendor compromise', 'Production downtime due to vendor SLA failure', 'Regulatory fine due to vendor non-compliance with GDPR'. " +
        "BAD risk titles (do NOT use): 'Vendor lacks ISO 27001', 'Weak access controls at vendor', 'No MFA at vendor' — these are vendor WEAKNESSES, not risks for the client. A weakness becomes a risk only when you describe its IMPACT on the client. " +
        "IMPORTANT: include the vendor name '" + (v.name || "") + "' in measure names. " +
        "Respond ONLY with valid JSON: " +
        '[{"title":"risk title (client impact)","category":"CYBER|OPS|FIN|COMP|STRAT|REP|GEO","impact":1-5,"likelihood":1-5,"description":"...","measures":[{"mesure":"SHORT name max 8 words — ' + (v.name || "Vendor") + '","details":"DETAILED implementation steps (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|Surveillance","responsable":"owner"}]}]' +
        " Respond in " + (_locale === "en" ? "English" : "French") + ".";

    var userPrompt = "Vendor: " + v.name + " (" + (v.sector || "") + ")" +
        "\nServices: " + ((v.contract || {}).services || "") +
        "\nUser request: " + prompt;

    _aiSuggestContext = { vendorIdx: vendorIdx, type: "risks_and_measures" };
    _aiShowLoading("✨ " + esc(prompt.substring(0, 50)));

    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        var suggestions = _aiParseJSON(raw);
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e) { _aiShowError("AI", e.message); });
}

function _aiSuggestMeasuresCustom(vendorIdx, riskIdx, prompt) {
    var v = D.vendors[vendorIdx];
    var r = D.risks[riskIdx];
    if (!v || !r || typeof _aiCallAPI !== "function") return;

    var systemPrompt = "You are a third-party risk management expert. The user has a specific request about measures for a vendor risk. " +
        "Propose measures that address the vendor relationship specifically. " +
        "IMPORTANT: include the vendor name '" + (v.name || "") + "' in measure names. " +
        "Respond ONLY with valid JSON: " +
        '[{"mesure":"SHORT name max 8 words — ' + (v.name || "Vendor") + '","details":"DETAILED implementation steps, procedures, tools, frequency, responsible teams (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|Surveillance","responsable":"owner"}]' +
        " Respond in " + (_locale === "en" ? "English" : "French") + ".";

    var userPrompt = "Vendor: " + v.name +
        "\nRisk: " + r.title + " (impact: " + r.impact + ", likelihood: " + r.likelihood + ")" +
        "\nUser request: " + prompt;

    _aiSuggestContext = { vendorIdx: vendorIdx, riskIdx: riskIdx, type: "risk_measures" };
    _aiShowLoading("✨ " + esc(prompt.substring(0, 50)));

    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        var suggestions = _aiParseJSON(raw);
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e) { _aiShowError("AI", e.message); });
}

function aiSuggestRisksAndMeasures(vendorIdx) {
    var v = D.vendors[vendorIdx];
    if (!v || typeof _aiCallAPI !== "function") return;

    var existingRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });

    var systemPrompt = "You are a third-party risk management expert. Analyze the vendor and propose risks FOR THE CLIENT caused by using this vendor's services. " +
        "FOCUS ON CLIENT IMPACT: each risk must describe what could go wrong for the CLIENT (not the vendor's internal weaknesses). " +
        "GOOD risk examples: 'Patient data exposure following vendor breach', 'Service interruption impacting production due to vendor outage', 'Regulatory sanction due to vendor GDPR non-compliance', 'Vendor lock-in preventing migration', 'Supply chain attack via vendor update mechanism'. " +
        "BAD risk examples (do NOT suggest): 'Vendor lacks certifications', 'Weak vendor password policy', 'No MFA at vendor', 'Vendor has no SIEM' — these are vendor WEAKNESSES. Transform them into CLIENT RISKS by stating the consequence: 'Data breach risk due to weak vendor security controls'. " +
        "Also BAD: generic IT threats (phishing, ransomware, DDoS) that are not specific to the vendor relationship. " +
        "IMPORTANT: include the vendor name '" + (v.name || "") + "' in each measure name. " +
        "Respond ONLY with valid JSON: " +
        '[{"title":"client risk (consequence)","category":"CYBER|OPS|FIN|COMP|STRAT|REP|GEO","impact":1-5,"likelihood":1-5,"description":"explain how this vendor situation creates risk for the client","measures":[{"mesure":"SHORT name max 8 words — ' + (v.name || "Vendor") + '","details":"DETAILED implementation steps (2-5 sentences)","type":"Contractuelle|Technique|Organisationnelle|Surveillance","responsable":"owner"}]}]' +
        " Respond in " + (_locale === "en" ? "English" : "French") + ". Propose 2-4 risks with 1-2 measures each.";

    var userPrompt = "Vendor: " + JSON.stringify({ name: v.name, sector: v.sector, services: (v.contract || {}).services, website: v.website }) +
        "\nClassification: " + JSON.stringify(v.classification || {}) +
        "\nTier: " + _getTier(v) +
        (_isDoraICTCritical(v.classification) ? "\nDORA critical ICT provider: yes" : "") +
        (v.classification && v.classification.gdpr_subprocessor ? "\nGDPR subprocessor: yes" : "") +
        "\nExisting risks: " + (existingRisks.map(function(r) { return r.title; }).join(", ") || "none");

    _aiSuggestContext = { vendorIdx: vendorIdx, type: "risks_and_measures" };
    _aiShowLoading("✨ " + t("measure.ai_suggest") + " — " + esc(v.name));

    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        var suggestions = _aiParseJSON(raw);
        if (!Array.isArray(suggestions)) suggestions = [suggestions];
        _aiSuggestions = suggestions;
        _renderAiCards();
    }).catch(function(e) {
        _aiShowError("AI", e.message);
    });
}
window.aiSuggestRisksAndMeasures = aiSuggestRisksAndMeasures;

// ═══════════════════════════════════════════════════════════════
// AI SUGGESTION CARDS (slide-in panel like Risk)
// ═══════════════════════════════════════════════════════════════

function _renderAiCards() {
    var p = _aiEnsurePanel();
    if (!_aiSuggestions.length) {
        p.body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)">' + t("measure.ai_no_suggestions") + '</div>';
        p.footer.innerHTML = '<button class="ai-btn-close" id="ai-cards-close">' + t("common.close") + '</button>';
        _aiOpenPanel();
        document.getElementById("ai-cards-close").onclick = _aiClosePanel;
        return;
    }

    var isRiskMode = _aiSuggestContext.type === "risks_and_measures";
    var h = "";

    _aiSuggestions.forEach(function(s, i) {
        h += '<div class="ai-card" id="ai-card-' + i + '">';
        if (isRiskMode) {
            // Risk + measures card
            h += '<div class="ai-card-title" style="color:var(--red)">' + esc(s.title || "Risk " + (i + 1)) + '</div>';
            h += '<div style="font-size:0.8em;margin-bottom:4px">';
            h += '<span style="background:#dbeafe;padding:1px 6px;border-radius:3px">' + esc(s.category || "CYBER") + '</span>';
            h += ' Impact: ' + (s.impact || 3) + ' | ' + t("risk.likelihood") + ': ' + (s.likelihood || 3);
            h += '</div>';
            if (s.description) h += '<div class="ai-card-details">' + esc(s.description) + '</div>';
            if (s.measures && s.measures.length) {
                h += '<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">';
                h += '<div style="font-size:0.75em;font-weight:600;color:var(--text-muted);margin-bottom:4px">' + t("measure.title") + ':</div>';
                s.measures.forEach(function(m) {
                    h += '<div style="font-size:0.82em;padding:2px 0">• ' + esc(m.mesure || "") + ' <span style="color:var(--text-muted)">(' + esc(m.type || "") + ')</span></div>';
                });
                h += '</div>';
            }
        } else {
            // Measure card
            h += '<div class="ai-card-title">' + esc(s.mesure || s.measure || "Measure " + (i + 1)) + '</div>';
            if (s.details) h += '<div class="ai-card-details">' + esc(s.details) + '</div>';
            h += '<div style="font-size:0.78em;color:var(--text-muted);margin-top:4px">';
            if (s.type) h += '<span style="background:#dbeafe;padding:1px 6px;border-radius:3px;margin-right:4px">' + esc(s.type) + '</span>';
            if (s.responsable) h += esc(s.responsable);
            h += '</div>';
        }
        h += '<div style="display:flex;gap:6px;margin-top:8px">';
        h += '<button class="ai-btn-accept" data-click="acceptAiSuggestion" data-args=\'' + _da(i) + '\'>' + t("measure.accept") + '</button>';
        h += '<button class="ai-btn-ignore" data-click="ignoreAiSuggestion" data-args=\'' + _da(i) + '\'>' + t("measure.ignore") + '</button>';
        h += '</div>';
        h += '</div>';
    });

    p.body.innerHTML = h;
    p.footer.innerHTML = '<button class="ai-btn-all" data-click="acceptAllAiSuggestions">' + t("measure.accept_all") + '</button>' +
        '<button class="ai-btn-close" data-click="_aiClosePanel">' + t("common.close") + '</button>';
    _aiOpenPanel();
}

function acceptAiSuggestion(idx) {
    var s = _aiSuggestions[idx];
    if (!s) return;
    var ctx = _aiSuggestContext;
    var v = D.vendors[ctx.vendorIdx];
    if (!v) return;
    if (!v.measures) v.measures = [];

    if (ctx.type === "risks_and_measures") {
        // Create risk + linked measures
        var riskNum = D.risks.filter(function(r) { return r.vendor_id === v.id; }).length + 1;
        var riskId = v.id + "-R" + String(riskNum).padStart(2, "0");
        var risk = {
            id: riskId, vendor_id: v.id, title: s.title || "", description: s.description || "",
            category: s.category || "CYBER", impact: s.impact || 3, likelihood: s.likelihood || 3,
            treatment: { response: "mitigate", details: "", due_date: "" },
            residual_impact: 0, residual_likelihood: 0, status: "needs_treatment",
            linked_measures: ""
        };
        D.risks.push(risk);
        (s.measures || []).forEach(function(m) {
            var mNum = v.measures.length + 1;
            var mId = v.id + "-M" + String(mNum).padStart(2, "0");
            v.measures.push({
                id: mId, mesure: m.mesure || m.measure || "", details: m.details || "",
                type: m.type || "Contractuelle", statut: "planifie",
                responsable: m.responsable || "", echeance: "", ref_socle: "", effet: ""
            });
            var cur = risk.linked_measures || "";
            risk.linked_measures = cur ? cur + ", " + mId + " - " + (m.mesure || "") : mId + " - " + (m.mesure || "");
        });
    } else {
        // Create measure and link to risk
        var mNum = v.measures.length + 1;
        var mId = v.id + "-M" + String(mNum).padStart(2, "0");
        v.measures.push({
            id: mId, mesure: s.mesure || s.measure || "", details: s.details || "",
            type: s.type || "Contractuelle", statut: "planifie",
            responsable: s.responsable || "", echeance: "", ref_socle: "", effet: ""
        });
        if (ctx.riskIdx != null) {
            var r = D.risks[ctx.riskIdx];
            if (r) {
                var cur = r.linked_measures || "";
                r.linked_measures = cur ? cur + ", " + mId + " - " + (s.mesure || "") : mId + " - " + (s.mesure || "");
            }
        }
    }

    _autoSave();
    // Remove card from UI
    var card = document.getElementById("ai-card-" + idx);
    if (card) card.remove();
    showStatus(t("measure.accepted"));
    _checkAiEmpty();
    renderPanel();
}
window.acceptAiSuggestion = acceptAiSuggestion;

function ignoreAiSuggestion(idx) {
    var card = document.getElementById("ai-card-" + idx);
    if (card) card.remove();
    _checkAiEmpty();
}
window.ignoreAiSuggestion = ignoreAiSuggestion;

function acceptAllAiSuggestions() {
    for (var i = 0; i < _aiSuggestions.length; i++) {
        if (document.getElementById("ai-card-" + i)) {
            acceptAiSuggestion(i);
        }
    }
}
window.acceptAllAiSuggestions = acceptAllAiSuggestions;

function _checkAiEmpty() {
    var p = _aiEnsurePanel();
    if (p.body.querySelectorAll(".ai-card").length === 0) {
        p.body.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-muted)"><div style="font-size:2em;margin-bottom:8px">✓</div>' + t("measure.all_done") + '</div>';
        p.footer.innerHTML = '<button class="ai-btn-close" data-click="_aiClosePanel">' + t("common.close") + '</button>';
    }
}

// ── AI: suggest answers for a specific domain ──
function aiSuggestDomain(assessId, domain) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a || typeof _aiCallAPI !== "function") return;
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    var lang = typeof _locale !== "undefined" ? _locale : "fr";
    var questions = _getQuestions(v);
    var domainQuestions = questions.filter(function(q) { return q.domain === domain; });

    var systemPrompt = "You are a third-party security assessor. Based on public information about the vendor, " +
        "suggest answers for these security assessment questions. Respond in " + (lang === "en" ? "English" : "French") + ". " +
        "Return valid JSON: [{\"question_id\":\"Q01\",\"answer\":\"compliant|partial|non_compliant|na\",\"comment\":\"justification\"}]";

    var userPrompt = "Vendor: " + JSON.stringify({ name: (v || {}).name, sector: (v || {}).sector, website: (v || {}).website, certifications: (v || {}).certifications }) +
        "\nQuestions to assess:\n" + domainQuestions.map(function(q) { return q.id + ": " + (q["text_" + lang] || q.text_fr); }).join("\n");

    showStatus(t("measure.ai_loading"));
    _aiCallAPI(systemPrompt, userPrompt).then(function(raw) {
        try {
            var suggestions = _aiParseJSON(raw);
            if (!Array.isArray(suggestions)) suggestions = [suggestions];
            if (!a.responses) a.responses = [];
            suggestions.forEach(function(s) {
                var existing = a.responses.find(function(r) { return r.question_id === s.question_id; });
                if (existing) {
                    if (!existing.answer) existing.answer = s.answer;
                    if (!existing.comment) existing.comment = s.comment || "";
                } else {
                    a.responses.push({ question_id: s.question_id, answer: s.answer || "", comment: s.comment || "" });
                }
            });
            _autoSave();
            openAssessment(assessId);
            showStatus(suggestions.length + " " + t("assessment.ai_suggested"));
        } catch (e) {
            showStatus(t("measure.ai_error"));
        }
    }).catch(function(e) { showStatus(t("measure.ai_error") + ": " + e.message); });
}
window.aiSuggestDomain = aiSuggestDomain;

function _renderVendorAssessments(v) {
    var assessments = D.assessments.filter(function(a) { return a.vendor_id === v.id; });
    var h = '<div style="display:flex;justify-content:space-between;margin-bottom:10px">';
    h += '<strong>' + t("assessment.title") + ' (' + assessments.length + ')</strong>';
    h += '<button class="btn-add" data-click="newAssessment" data-args=\'' + _da(v.id) + '\'>' + t("assessment.new") + '</button>';
    h += '</div>';
    if (!assessments.length) return h + '<div style="color:var(--text-muted);font-size:0.85em">' + t("assessment.empty") + '</div>';
    assessments.forEach(function(a) {
        var comp = a.completion_rate != null ? a.completion_rate : 0;
        var compColor = comp === 100 ? "var(--green)" : comp > 50 ? "var(--orange)" : "var(--text-muted)";
        var scoreColor = a.score != null ? (a.score >= 80 ? "var(--green)" : a.score >= 50 ? "var(--orange)" : "var(--red)") : "var(--text-muted)";

        h += '<div class="question-card" style="cursor:pointer" data-click="openAssessmentFromVendor" data-args=\'' + _da(a.id, _selectedVendor) + '\'>';
        h += '<div style="display:flex;justify-content:space-between;align-items:center">';
        h += '<span style="font-weight:600">' + esc(a.id) + ' — ' + t("assessment.type_" + a.type) + '</span>';
        h += '<span style="font-size:0.82em;color:var(--text-muted)">' + esc(a.date || "") + '</span>';
        h += '</div>';
        // Progress bar + score
        h += '<div style="display:flex;align-items:center;gap:10px;margin-top:6px">';
        h += '<div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden">';
        h += '<div style="width:' + comp + '%;height:100%;background:' + compColor + ';border-radius:3px"></div>';
        h += '</div>';
        h += '<span style="font-size:0.78em;font-weight:600;color:' + compColor + '">' + comp + '%</span>';
        if (a.score != null) {
            h += '<span style="font-size:0.78em;font-weight:700;color:' + scoreColor + '"> ' + t("assessment.score") + ': ' + a.score + '%</span>';
        }
        h += '</div>';
        h += '</div>';
    });
    return h;
}

function _renderVendorDocs(v) {
    var docs = D.documents.filter(function(d) { return d.vendor_id === v.id; });
    var h = '<div style="display:flex;align-items:center;gap:10px"><strong>' + t("doc.title") + ' (' + docs.length + ')</strong>';
    h += '<button class="btn-add" style="font-size:0.78em;padding:3px 10px" data-click="addDocument">' + t("doc.add") + '</button>';
    if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
        h += '<button class="btn-add" style="font-size:0.78em;padding:3px 10px;background:var(--light-blue)" data-click="aiCollectDocs">' + t("ai.collect_docs") + '</button>';
    }
    h += '</div>';
    if (!docs.length) {
        h += '<div style="color:var(--text-muted);font-size:0.85em;margin-top:8px">' + t("doc.empty") + '</div>';
    } else {
        h += _renderDocsTable(docs);
    }
    // Global confidence selector
    var conf = (v.exposure && v.exposure.confiance != null) ? v.exposure.confiance : "";
    h += '<div style="margin-top:14px;padding:12px;background:var(--bg);border-radius:6px;display:flex;align-items:center;gap:10px">';
    h += '<label style="font-size:0.82em;font-weight:600;margin:0">' + t("doc.confidence") + '</label>';
    h += '<select data-change="updateVendorConfiance" data-pass-el style="font-size:0.85em;padding:4px 8px">';
    for (var i = 0; i <= 4; i++) {
        h += '<option value="' + i + '"' + (conf === i ? ' selected' : '') + '>' + i + ' — ' + esc(t("doc.confidence_" + i)) + '</option>';
    }
    h += '</select>';
    h += '<span style="font-size:0.78em;color:var(--text-muted)">' + t("doc.confidence_hint") + '</span>';
    h += '</div>';
    return h;
}

var _docsTableCounter = 0;
function _renderDocsTable(docs, tableId) {
    if (!tableId) tableId = "docs-table-" + (_docsTableCounter++);
    var h = colsButton(tableId);
    h += '<table id="' + tableId + '" style="margin-top:8px"><thead><tr>';
    h += '<th' + hd("name") + '>' + t("doc.name") + '</th><th' + hd("type") + '>' + t("doc.type") + '</th><th' + hd("url") + '>URL</th><th' + hd("expiry") + '>' + t("doc.expiry") + '</th><th></th>';
    h += '</tr></thead><tbody>';
    var docTypes = ["trust_center","audit_report","certification","dpa","privacy","whitepaper","status_page","bug_bounty","other"];
    docs.forEach(function(d) {
        var statusCls = "";
        if (d.expiry_date) {
            var exp = new Date(d.expiry_date), now = new Date();
            if (exp < now) statusCls = "doc-status-expired";
            else if (exp < new Date(now.getTime() + 30 * 86400000)) statusCls = "doc-status-expiring";
            else statusCls = "doc-status-valid";
        }
        h += '<tr>';
        // Name (editable)
        h += '<td' + hd("name") + '><input type="text" value="' + esc(d.name) + '" style="font-weight:600;border:none;background:transparent;width:100%;font-size:inherit;font-family:inherit" data-change="updateDocField" data-args=\'' + _da(d.id, "name") + '\' data-pass-value></td>';
        // Type (select)
        h += '<td' + hd("type") + '><select style="font-size:0.78em;border:1px solid var(--border);border-radius:4px;padding:2px 4px" data-change="updateDocField" data-args=\'' + _da(d.id, "type") + '\' data-pass-value>';
        docTypes.forEach(function(tp) {
            h += '<option value="' + tp + '"' + (d.type === tp ? ' selected' : '') + '>' + esc(_docTypeLabel(tp)) + '</option>';
        });
        h += '</select></td>';
        // URL (editable + link)
        h += '<td' + hd("url") + ' style="font-size:0.78em"><div style="display:flex;align-items:center;gap:4px">';
        h += '<input type="url" value="' + esc(d.url || "") + '" placeholder="https://..." style="flex:1;border:1px solid var(--border);border-radius:4px;padding:2px 4px;font-size:inherit;min-width:80px" data-change="updateDocField" data-args=\'' + _da(d.id, "url") + '\' data-pass-value>';
        if (d.url) h += '<a href="' + esc(d.url) + '" target="_blank" rel="noopener" style="color:var(--light-blue)" data-stop>&#8599;</a>';
        h += '</div></td>';
        // Expiry date
        h += '<td' + hd("expiry") + ' class="' + statusCls + '"><input type="date" value="' + esc(d.expiry_date || "") + '" style="font-size:0.85em;border:1px solid var(--border);border-radius:4px;padding:2px 4px" data-change="updateDocField" data-args=\'' + _da(d.id, "expiry_date") + '\' data-pass-value></td>';
        h += '<td><button class="btn-del" data-click="deleteDoc" data-args=\'' + _da(d.id) + '\'>&#10005;</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

function _docTypeLabel(type) {
    var map = {
        trust_center: "Trust Center", audit_report: "Rapport d'audit", certification: "Certification",
        dpa: "DPA", privacy: "Politique de confidentialite", whitepaper: "Whitepaper",
        status_page: "Status Page", bug_bounty: "Bug Bounty", other: "Autre"
    };
    return map[type] || type || "Autre";
}

function updateDocField(docId, field, value) {
    var doc = D.documents.find(function(d) { return d.id === docId; });
    if (!doc) return;
    doc[field] = value;
    _autoSave();
    if (field === "expiry_date") renderPanel();
}
window.updateDocField = updateDocField;

function addDocument() {
    var v = D.vendors[_selectedVendor];
    if (!v) return;
    var name = prompt(t("doc.prompt_name"));
    if (!name) return;
    var docId = "DOC-" + String(D.documents.length + 1).padStart(3, "0");
    D.documents.push({
        id: docId, vendor_id: v.id, name: name, type: "other",
        url: "", expiry_date: "", source: "manual"
    });
    _autoSave();
    renderPanel();
}
window.addDocument = addDocument;

function deleteDoc(docId) {
    D.documents = D.documents.filter(function(d) { return d.id !== docId; });
    _autoSave();
    renderPanel();
}
window.deleteDoc = deleteDoc;

function updateVendorConfiance(el) {
    var v = D.vendors[_selectedVendor];
    if (!v) return;
    if (!v.exposure) v.exposure = {};
    v.exposure.confiance = parseInt(el.value) || 0;
    _autoSave();
    _refreshThreatDisplay();
}
window.updateVendorConfiance = updateVendorConfiance;

// ═══════════════════════════════════════════════════════════════
// RISK LIST (global)
// ═══════════════════════════════════════════════════════════════

var _riskFilterVendor = "";
var _riskFilterCategory = "";
var _riskFilterStatus = "";
var _riskSearch = "";

function renderRiskList() {
    var h = '<h2>' + t("risk.title") + '</h2>';
    if (!D.risks.length) return h + '<div class="empty-state">' + t("risk.empty") + '</div>';

    // Filters bar
    h += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;align-items:center">';
    // Search
    h += '<input type="text" id="risk-search" placeholder="' + esc(t("common.search")) + '" value="' + esc(_riskSearch) + '" style="flex:1;min-width:150px;padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-input="_onRiskFilterChange">';
    // Vendor filter
    h += '<select id="risk-filter-vendor" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_vendors") + '</option>';
    D.vendors.forEach(function(v) {
        h += '<option value="' + esc(v.id) + '"' + (_riskFilterVendor === v.id ? ' selected' : '') + '>' + esc(v.name) + '</option>';
    });
    h += '</select>';
    // Category filter
    h += '<select id="risk-filter-category" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_categories") + '</option>';
    var cats = ["CYBER","OPS","FIN","COMP","STRAT","REP","GEO"];
    cats.forEach(function(c) { h += '<option value="' + c + '"' + (_riskFilterCategory === c ? ' selected' : '') + '>' + c + '</option>'; });
    h += '</select>';
    // Status filter
    h += '<select id="risk-filter-status" style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;font-size:0.85em" data-change="_onRiskFilterChange">';
    h += '<option value="">' + t("risk.all_statuses") + '</option>';
    ["needs_treatment","active","closed","archived"].forEach(function(s) {
        h += '<option value="' + s + '"' + (_riskFilterStatus === s ? ' selected' : '') + '>' + t("risk.status_" + s) + '</option>';
    });
    h += '</select>';
    h += '</div>';

    // Filter risks
    var filtered = D.risks.filter(function(r) {
        if (_riskFilterVendor && r.vendor_id !== _riskFilterVendor) return false;
        if (_riskFilterCategory && r.category !== _riskFilterCategory) return false;
        if (_riskFilterStatus && r.status !== _riskFilterStatus) return false;
        if (_riskSearch) {
            var q = _riskSearch.toLowerCase();
            var match = (r.title || "").toLowerCase().indexOf(q) >= 0 ||
                        (r.id || "").toLowerCase().indexOf(q) >= 0 ||
                        (r.description || "").toLowerCase().indexOf(q) >= 0 ||
                        _vendorName(r.vendor_id).toLowerCase().indexOf(q) >= 0;
            if (!match) return false;
        }
        return true;
    });

    if (!filtered.length) return h + '<div style="color:var(--text-muted);font-size:0.85em;padding:10px">' + t("vendor.no_results") + '</div>';

    h += colsButton("risk-list-table");
    h += '<div style="overflow-x:auto"><table id="risk-list-table"><thead><tr><th' + hd("id") + '>ID</th><th' + hd("vendor") + '>' + t("risk.vendor") + '</th><th' + hd("title") + '>' + t("risk.risk_title") + '</th>';
    h += '<th' + hd("cat") + '>' + t("risk.category") + '</th><th' + hd("inherent") + '>' + t("risk.inherent_score") + '</th>';
    h += '<th' + hd("residual") + '>' + t("risk.residual_score") + '</th><th' + hd("status") + '>' + t("risk.status") + '</th></tr></thead><tbody>';
    filtered.sort(function(a, b) { return (b.impact * b.likelihood) - (a.impact * a.likelihood); });
    filtered.forEach(function(r) {
        var sc = r.impact * r.likelihood;
        var rsc = (r.residual_impact || 0) * (r.residual_likelihood || 0);
        var vendorIdx = D.vendors.findIndex(function(v) { return v.id === r.vendor_id; });
        h += '<tr style="cursor:pointer" data-click="goToRisk" data-args=\'' + _da(r.vendor_id) + '\'>';
        h += '<td' + hd("id") + '>' + esc(r.id) + '</td><td' + hd("vendor") + '>' + esc(_vendorName(r.vendor_id)) + '</td>';
        h += '<td' + hd("title") + '>' + esc(r.title) + '</td><td' + hd("cat") + '>' + esc(r.category) + '</td>';
        h += '<td' + hd("inherent") + ' class="' + _scoreClass(sc) + '" style="font-weight:700">' + sc + '</td>';
        h += '<td' + hd("residual") + ' class="' + _scoreClass(rsc) + '">' + (rsc || "-") + '</td>';
        h += '<td' + hd("status") + '>' + esc(t("risk.status_" + r.status)) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div style="font-size:0.78em;color:var(--text-muted);margin-top:6px">' + filtered.length + '/' + D.risks.length + ' ' + t("nav.risks").toLowerCase() + '</div>';
    return h;
}

function _onRiskFilterChange() {
    _riskSearch = (document.getElementById("risk-search") || {}).value || "";
    _riskFilterVendor = (document.getElementById("risk-filter-vendor") || {}).value || "";
    _riskFilterCategory = (document.getElementById("risk-filter-category") || {}).value || "";
    _riskFilterStatus = (document.getElementById("risk-filter-status") || {}).value || "";
    var c = document.getElementById("content");
    if (c) c.innerHTML = renderRiskList();
}
window._onRiskFilterChange = _onRiskFilterChange;

function goToRisk(vendorId) {
    var idx = D.vendors.findIndex(function(v) { return v.id === vendorId; });
    if (idx < 0) return;
    _selectedVendor = idx;
    _vendorTab = "risks";
    _panel = "vendors";
    // Update sidebar active state
    document.querySelectorAll(".sidebar-item").forEach(function(el) {
        var args = el.getAttribute("data-args");
        if (args) { try { var a = JSON.parse(args); el.classList.toggle("active", a[0] === "vendors"); } catch(e) {} }
    });
    renderPanel();
}
window.goToRisk = goToRisk;

// ═══════════════════════════════════════════════════════════════
// ASSESSMENT LIST + DETAIL
// ═══════════════════════════════════════════════════════════════

function renderAssessmentList() {
    var h = '<h2>' + t("assessment.title") + '</h2>';
    if (!D.assessments.length) return h + '<div class="empty-state">' + t("assessment.empty") + '</div>';
    h += colsButton("assessment-list-table");
    h += '<table id="assessment-list-table"><thead><tr><th' + hd("id") + '>ID</th><th' + hd("vendor") + '>' + t("assessment.vendor") + '</th>';
    h += '<th' + hd("type") + '>' + t("assessment.type") + '</th><th' + hd("date") + '>' + t("assessment.date") + '</th>';
    h += '<th' + hd("completion") + '>' + t("assessment.completion") + '</th><th' + hd("score") + '>' + t("assessment.score") + '</th><th' + hd("status") + '>' + t("assessment.status") + '</th>';
    h += '<th></th></tr></thead><tbody>';
    D.assessments.forEach(function(a) {
        var comp = a.completion_rate != null ? a.completion_rate : 0;
        var compColor = comp === 100 ? "var(--green)" : comp > 50 ? "var(--orange)" : "var(--text-muted)";
        h += '<tr><td' + hd("id") + '>' + esc(a.id) + '</td><td' + hd("vendor") + '>' + esc(_vendorName(a.vendor_id)) + '</td>';
        h += '<td' + hd("type") + '>' + t("assessment.type_" + a.type) + '</td><td' + hd("date") + '>' + esc(a.date) + '</td>';
        h += '<td' + hd("completion") + ' style="color:' + compColor + ';font-weight:600">' + comp + '%</td>';
        h += '<td' + hd("score") + '>' + (a.score != null ? a.score + '%' : '-') + '</td>';
        h += '<td' + hd("status") + '>' + t("assessment.status_" + a.status) + '</td>';
        h += '<td><button class="btn-add" data-click="openAssessment" data-args=\'' + _da(a.id) + '\'>' + t("vendor.edit") + '</button>';
        h += ' <button class="btn-add" data-click="exportAssessmentExcel" data-args=\'' + _da(a.id) + '\'>' + t("assessment.export_excel") + '</button>';
        h += ' <button class="btn-del" data-click="deleteAssessment" data-args=\'' + _da(a.id) + '\'>' + t("vendor.delete") + '</button></td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    h += '<div style="margin-top:12px"><button class="btn-add" data-click="importAssessmentExcel">' + t("assessment.import_excel") + '</button></div>';
    return h;
}

function renderDocList() {
    var h = '<h2>' + t("doc.title") + '</h2>';
    if (!D.documents.length) return h + '<div class="empty-state">' + t("doc.empty") + '</div>';
    // Group by vendor
    var byVendor = {};
    D.documents.forEach(function(d) {
        if (!byVendor[d.vendor_id]) byVendor[d.vendor_id] = [];
        byVendor[d.vendor_id].push(d);
    });
    for (var vid in byVendor) {
        h += '<h3 style="margin:16px 0 6px;font-size:0.95em">' + esc(_vendorName(vid)) + '</h3>';
        h += _renderDocsTable(byVendor[vid]);
    }
    return h;
}

// ═══════════════════════════════════════════════════════════════
// ASSESSMENT DETAIL (Questionnaire)
// ═══════════════════════════════════════════════════════════════

function openAssessmentFromVendor(assessId, vendorIdx) {
    _assessReturnToVendor = vendorIdx;
    openAssessment(assessId);
}
window.openAssessmentFromVendor = openAssessmentFromVendor;

function openAssessment(assessId) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a) return;
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    var questions = _getQuestions(v);

    // Completion
    var answered = (a.responses || []).filter(function(r) { return r.answer; }).length;
    var totalQ = questions.length;
    var completion = totalQ > 0 ? Math.round(answered / totalQ * 100) : 0;
    var score = _computeAssessmentScore(a, questions);

    var h = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">';
    h += '<button class="btn-add" data-click="backToAssessments">&laquo; ' + t("nav.assessments") + '</button>';
    h += '<h2 style="flex:1">' + esc(a.id) + ' — ' + esc(_vendorName(a.vendor_id)) + '</h2>';
    h += '<div class="score-gauge"><span class="score-val ' + _scoreColorClass(score) + '">' + score + '%</span></div>';
    h += '</div>';

    // Completion bar
    h += '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">';
    h += '<div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden">';
    h += '<div style="width:' + completion + '%;height:100%;background:' + (completion === 100 ? 'var(--green)' : 'var(--light-blue)') + ';border-radius:4px;transition:width 0.3s"></div>';
    h += '</div>';
    h += '<span style="font-size:0.82em;font-weight:600;color:' + (completion === 100 ? 'var(--green)' : 'var(--text-muted)') + '">' + completion + '% (' + answered + '/' + totalQ + ')</span>';
    h += '</div>';

    // Group questions by domain for sub-section AI buttons
    var currentDomain = "";
    var lang = typeof _locale !== "undefined" ? _locale : "fr";

    questions.forEach(function(q) {
        var resp = (a.responses || []).find(function(r) { return r.question_id === q.id; }) || {};

        // Domain section header with AI button
        if (q.domain !== currentDomain) {
            currentDomain = q.domain;
            h += '<div style="display:flex;align-items:center;gap:8px;margin:14px 0 6px;padding-top:10px;border-top:1px solid var(--border)">';
            h += '<span style="font-size:0.75em;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:var(--text-muted)">' + esc(currentDomain.replace(/_/g, " ")) + '</span>';
            if (typeof _aiIsEnabled === "function" && _aiIsEnabled()) {
                h += '<button class="btn-add fs-xs" style="background:var(--light-blue);padding:2px 8px;margin-left:auto" data-click="aiSuggestDomain" data-args=\'' + _da(a.id, currentDomain) + '\'>AI</button>';
            }
            h += '</div>';
        }

        h += '<div class="question-card">';
        h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">';
        h += '<span class="question-id">' + q.id + '</span>';
        h += '<span class="question-domain">' + esc(q.domain) + '</span>';
        h += '</div>';
        h += '<div class="question-text">' + esc(q["text_" + lang] || q.text_fr) + '</div>';
        // Expected answer hint
        h += '<details style="margin:4px 0"><summary style="font-size:0.78em;color:var(--light-blue);cursor:pointer">' + t("assessment.expected") + '</summary>';
        h += '<div class="question-hint">' + esc(q["expected_" + lang] || q.expected_fr || "") + '</div>';
        h += '<div class="question-hint" style="color:var(--red)">' + t("assessment.red_flags") + ': ' + esc(q["red_flags_" + lang] || q.red_flags_fr || "") + '</div>';
        h += '</details>';
        // Answer pills
        h += '<div class="answer-pills">';
        ["compliant", "partial", "non_compliant", "na"].forEach(function(ans) {
            var sel = resp.answer === ans ? " selected" : "";
            h += '<div class="answer-pill ' + ans + sel + '" data-click="setAnswer" data-args=\'' + _da(a.id, q.id, ans) + '\'>' + t("assessment.answer_" + ans) + '</div>';
        });
        h += '</div>';
        // Comment — wider textarea
        h += '<div style="margin-top:6px"><textarea id="acomm-' + q.id + '" rows="3" class="w-full" style="font-size:0.85em" placeholder="' + t("assessment.comment") + '">' + esc(resp.comment || "") + '</textarea></div>';
        h += '</div>';
    });

    h += '<div class="form-actions">';
    h += '<button class="btn-add" data-click="saveAssessment" data-args=\'' + _da(a.id) + '\'>' + t("common.save") + '</button>';
    h += '</div>';
    var c = document.getElementById("content");
    c.innerHTML = h;
}
window.openAssessment = openAssessment;

function setAnswer(assessId, questionId, answer) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a) return;
    if (!a.responses) a.responses = [];
    var resp = a.responses.find(function(r) { return r.question_id === questionId; });
    if (!resp) { resp = { question_id: questionId }; a.responses.push(resp); }
    resp.answer = answer;
    // Update completion rate in real-time
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    var questions = _getQuestions(v);
    a.completion_rate = Math.round(((a.responses || []).filter(function(r) { return r.answer; }).length / questions.length) * 100);
    a.score = _computeAssessmentScore(a, questions);
    if (a.completion_rate === 100) a.status = "completed";
    else if (a.status === "draft") a.status = "in_progress";
    // Update vendor's cyber maturity from score
    if (v && a.score != null) {
        if (!v.exposure) v.exposure = {};
        v.exposure.maturite = _scoreToMaturite(a.score);
    }
    _autoSave();
    _refreshThreatDisplay();
    openAssessment(assessId);
}
window.setAnswer = setAnswer;

function saveAssessment(assessId) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a) return;
    // Save comments
    (a.responses || []).forEach(function(r) {
        var el = document.getElementById("acomm-" + r.question_id);
        if (el) r.comment = el.value.trim();
    });
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    var questions = _getQuestions(v);
    a.score = _computeAssessmentScore(a, questions);
    a.completion_rate = Math.round(((a.responses || []).filter(function(r) { return r.answer; }).length / questions.length) * 100);
    if (a.completion_rate === 100) a.status = "completed";
    // Update vendor's cyber maturity from latest assessment score
    if (v && a.score != null) {
        if (!v.exposure) v.exposure = {};
        // Convert score (0-100%) to maturity (0-4): 0-20%=0, 21-40%=1, 41-60%=2, 61-80%=3, 81-100%=4
        v.exposure.maturite = _scoreToMaturite(a.score);
    }

    _autoSave();
    _refreshThreatDisplay();
    showStatus(t("common.save") + " OK");
    // Return to vendor's assessments tab if we came from there
    if (_assessReturnToVendor !== null) {
        _selectedVendor = _assessReturnToVendor;
        _vendorTab = "assessments";
        _assessReturnToVendor = null;
        _panel = "vendors";
        renderPanel();
    } else {
        // Find vendor index from assessment
        var vendorIdx = D.vendors.findIndex(function(x) { return x.id === a.vendor_id; });
        if (vendorIdx >= 0) {
            _selectedVendor = vendorIdx;
            _vendorTab = "assessments";
            _panel = "vendors";
            renderPanel();
        } else {
            selectPanel("assessments");
        }
    }
}
window.saveAssessment = saveAssessment;

function _computeAssessmentScore(a, questions) {
    var total = 0, max = 0;
    (a.responses || []).forEach(function(r) {
        var q = questions.find(function(x) { return x.id === r.question_id; });
        if (!q || r.answer === "na") return;
        max += q.weight;
        if (r.answer === "compliant") total += q.weight;
        else if (r.answer === "partial") total += q.weight * 0.5;
    });
    return max > 0 ? Math.round((total / max) * 100) : 0;
}

function deleteAssessment(assessId) {
    if (!confirm(t("assessment.confirm_delete"))) return;
    _saveState();
    var idx = D.assessments.findIndex(function(a) { return a.id === assessId; });
    if (idx < 0) return;
    D.assessments.splice(idx, 1);
    _autoSave();
    renderPanel();
    showStatus(t("assessment.deleted"));
}
window.deleteAssessment = deleteAssessment;

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT / IMPORT (CSV fallback — no SheetJS dependency)
// ═══════════════════════════════════════════════════════════════

function exportAssessmentExcel(assessId) {
    var a = D.assessments.find(function(x) { return x.id === assessId; });
    if (!a) return;
    var v = D.vendors.find(function(x) { return x.id === a.vendor_id; });
    var questions = _getQuestions(v);
    var lang = typeof _locale !== "undefined" ? _locale : "fr";

    // Build CSV (Excel-compatible with BOM for accents)
    var sep = ";";
    var rows = [["ID", "Domaine", "Question", "Reponse attendue", "Reponse", "Commentaire", "Preuves"].join(sep)];
    questions.forEach(function(q) {
        var resp = (a.responses || []).find(function(r) { return r.question_id === q.id; }) || {};
        rows.push([
            q.id, q.domain,
            '"' + (q["text_" + lang] || q.text_fr).replace(/"/g, '""') + '"',
            '"' + (q["expected_" + lang] || q.expected_fr || "").replace(/"/g, '""') + '"',
            resp.answer || "",
            '"' + (resp.comment || "").replace(/"/g, '""') + '"',
            '"' + ((resp.documents || []).join(", ")).replace(/"/g, '""') + '"'
        ].join(sep));
    });

    var csv = "\uFEFF" + rows.join("\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "TPRM_" + (v ? v.name.replace(/\s/g, "_") : "assessment") + "_" + a.id + ".csv";
    link.click();
    URL.revokeObjectURL(url);
    showStatus(t("assessment.export_excel") + " OK");
}
window.exportAssessmentExcel = exportAssessmentExcel;

function importAssessmentExcel() {
    var fi = document.createElement("input");
    fi.type = "file";
    fi.accept = ".csv,.xlsx";
    fi.onchange = function() {
        if (!fi.files[0]) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            var text = e.target.result;
            var lines = text.replace(/^\uFEFF/, "").split("\n");
            if (lines.length < 2) return alert("Empty file");
            // Find assessment by matching question IDs
            var sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
            for (var i = 1; i < lines.length; i++) {
                var cols = _parseCSVLine(lines[i], sep);
                if (cols.length < 5) continue;
                var qId = cols[0].trim();
                var answer = cols[4].trim().toLowerCase();
                var comment = cols[5] ? cols[5].trim() : "";
                // Find or create assessment response
                // Try all assessments
                D.assessments.forEach(function(a) {
                    if (!a.responses) a.responses = [];
                    var resp = a.responses.find(function(r) { return r.question_id === qId; });
                    if (resp) {
                        if (answer) resp.answer = answer;
                        if (comment) resp.comment = comment;
                    } else if (answer) {
                        a.responses.push({ question_id: qId, answer: answer, comment: comment });
                    }
                });
            }
            _autoSave();
            showStatus(t("assessment.import_excel") + " OK");
            renderPanel();
        };
        reader.readAsText(fi.files[0], "UTF-8");
    };
    fi.click();
}
window.importAssessmentExcel = importAssessmentExcel;

function _parseCSVLine(line, sep) {
    var result = [], current = "", inQuotes = false;
    for (var i = 0; i < line.length; i++) {
        var c = line[i];
        if (c === '"') { inQuotes = !inQuotes; }
        else if (c === sep && !inQuotes) { result.push(current); current = ""; }
        else { current += c; }
    }
    result.push(current);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// CRUD OPERATIONS
// ═══════════════════════════════════════════════════════════════

function addVendor() {
    var name = prompt(t("vendor.prompt_name"));
    if (!name) return;
    var website = "";
    var aiEnabled = typeof _aiIsEnabled === "function" && _aiIsEnabled();
    var nextId = "PP-" + String(D.vendors.length + 1).padStart(3, "0");
    D.vendors.push({
        id: nextId, name: name, legal_entity: "", country: "", sector: "", website: website, siret: "",
        logo: "",
        contact: { name: "", email: "", phone: "" },
        internal_contact: { name: "", email: "" },
        contract: { services: "", start_date: "", end_date: "", review_date: "" },
        classification: {
            ops_impact: 0, processes: 0, replace_difficulty: 0,
            data_sensitivity: 0, integration: 0, regulatory_impact: 0,
            gdpr_subprocessor: false
        },
        exposure: { dependance: 0, penetration: 0, maturite: 0, confiance: 0 },
        certifications: [], dpa_signed: false, sub_contractors: [],
        status: "prospect",
        measures: [],
        notes: ""
    });
    _selectedVendor = D.vendors.length - 1;
    _vendorTab = "info";
    _autoSave();
    renderPanel();
    // Auto-collect via AI if enabled
    if (aiEnabled && (name || website)) {
        setTimeout(function() { aiCollectInfo(); }, 200);
    }
}
window.addVendor = addVendor;

var _vendorSaveTimer = null;

function _autoSaveVendorField() {
    // Debounced auto-save: collect all fields and save
    if (_vendorSaveTimer) clearTimeout(_vendorSaveTimer);
    _vendorSaveTimer = setTimeout(function() {
        var v = D.vendors[_selectedVendor];
        if (!v) return;
        var el = function(id) { var e = document.getElementById(id); return e ? e.value.trim() : ""; };
        var chk = function(id) { var e = document.getElementById(id); return e ? e.checked : false; };
        v.name = el("v-name");
        v.legal_entity = el("v-legal");
        v.country = el("v-country");
        v.sector = el("v-sector");
        v.website = el("v-website");
        v.siret = el("v-siret");
        // v.logo is managed by _fetchLogo (stored as base64)
        v.contact = { name: el("v-cname"), email: el("v-cemail") };
        v.internal_contact = { name: el("v-icname"), email: el("v-icemail") };
        v.contract = { services: el("v-services"), start_date: el("v-cstart"), end_date: el("v-cend"), review_date: el("v-creview") };
        v.classification = {
            ops_impact: parseInt(el("v-cls-ops")) || 0,
            processes: parseInt(el("v-cls-proc")) || 0,
            replace_difficulty: parseInt(el("v-cls-repl")) || 0,
            data_sensitivity: parseInt(el("v-cls-data")) || 0,
            integration: parseInt(el("v-cls-integ")) || 0,
            regulatory_impact: parseInt(el("v-cls-reg")) || 0,
            gdpr_subprocessor: chk("v-gdpr")
        };
        if (!v.exposure) v.exposure = {};
        var cc = v.classification;
        v.exposure.dependance = _avgSliders([cc.ops_impact, cc.processes, cc.replace_difficulty]);
        v.exposure.penetration = _avgSliders([cc.data_sensitivity, cc.integration, cc.regulatory_impact]);
        v.exposure.maturite = parseInt(el("v-mat")) || 0;
        v.exposure.confiance = parseInt(el("v-conf")) || 0;
        v.status = el("v-status");
        v.notes = el("v-notes");
        _autoSave();
        // Update header subtitle
        var sub = document.getElementById("header-subtitle");
        if (sub) sub.textContent = v.name || "";
    }, 400);
}
window._autoSaveVendorField = _autoSaveVendorField;

// Keep saveVendor for backward compat but it just triggers immediate save
function saveVendor() { _autoSaveVendorField(); }
window.saveVendor = saveVendor;

function deleteVendor(idx) {
    if (!confirm(t("vendor.confirm_delete"))) return;
    var v = D.vendors[idx];
    if (v) {
        D.risks = D.risks.filter(function(r) { return r.vendor_id !== v.id; });
        D.assessments = D.assessments.filter(function(a) { return a.vendor_id !== v.id; });
    }
    D.vendors.splice(idx, 1);
    _selectedVendor = null;
    _autoSave();
    renderPanel();
}
window.deleteVendor = deleteVendor;

function addRiskForVendor(vendorId) {
    var riskCount = D.risks.filter(function(r) { return r.vendor_id === vendorId; }).length;
    var riskId = vendorId + "-R" + String(riskCount + 1).padStart(2, "0");
    D.risks.push({
        id: riskId, vendor_id: vendorId, title: "", description: "",
        category: "CYBER", impact: 3, likelihood: 3,
        treatment: { response: "mitigate", details: "", due_date: "" },
        residual_impact: 0, residual_likelihood: 0,
        status: "needs_treatment"
    });
    _autoSave();
    renderPanel();
}
window.addRiskForVendor = addRiskForVendor;

function updateRiskField(riskIdx, field, value) {
    var r = D.risks[riskIdx];
    if (!r) return;
    if (field === "treatment.response") {
        if (!r.treatment) r.treatment = { response: "mitigate", details: "", due_date: "" };
        r.treatment.response = value;
        if (value === "accept") {
            r.residual_impact = r.impact || 0;
            r.residual_likelihood = r.likelihood || 0;
        } else if (value === "avoid") {
            r.residual_impact = 1;
            r.residual_likelihood = 1;
        }
    } else if (field === "impact" || field === "likelihood" || field === "residual_impact" || field === "residual_likelihood") {
        var val = parseInt(value) || 0;
        r[field] = val;
        // Cap residual to initial
        if (field === "impact" && r.residual_impact > val) r.residual_impact = val;
        if (field === "likelihood" && r.residual_likelihood > val) r.residual_likelihood = val;
        if (field === "residual_impact" && val > (r.impact || 5)) r.residual_impact = r.impact || 5;
        if (field === "residual_likelihood" && val > (r.likelihood || 5)) r.residual_likelihood = r.likelihood || 5;
    } else {
        r[field] = value;
    }
    _autoSave();
    renderPanel();
}
window.updateRiskField = updateRiskField;

function deleteRisk(riskIdx) {
    if (!confirm(t("risk.confirm_delete"))) return;
    D.risks.splice(riskIdx, 1);
    _autoSave();
    renderPanel();
}
window.deleteRisk = deleteRisk;

function newAssessment(vendorId) {
    // Propose choice: manual or import
    _showModal(
        '<h3>' + t("assessment.new") + '</h3>' +
        '<p style="font-size:0.85em;color:var(--text-muted);margin-bottom:12px">' + esc(_vendorName(vendorId)) + '</p>' +
        '<div style="display:flex;gap:8px">' +
        '<button class="btn-add" data-click="_newAssessmentManual" data-args=\'' + _da(vendorId) + '\'>' + t("assessment.manual") + '</button>' +
        '<button class="btn-add" style="background:var(--light-blue)" data-click="_newAssessmentImport" data-args=\'' + _da(vendorId) + '\'>' + t("assessment.import_excel") + '</button>' +
        '</div>'
    );
}
window.newAssessment = newAssessment;

function _newAssessmentManual(vendorId) {
    closeModal();
    var assessId = "EVAL-" + String(D.assessments.length + 1).padStart(3, "0");
    D.assessments.push({
        id: assessId, vendor_id: vendorId, type: "periodic",
        date: new Date().toISOString().split("T")[0],
        status: "draft", responses: [], score: null, completion_rate: 0
    });
    _autoSave();
    if (_selectedVendor !== null) _assessReturnToVendor = _selectedVendor;
    openAssessment(assessId);
}
window._newAssessmentManual = _newAssessmentManual;

function _newAssessmentImport(vendorId) {
    closeModal();
    // Create assessment then import CSV into it
    var assessId = "EVAL-" + String(D.assessments.length + 1).padStart(3, "0");
    D.assessments.push({
        id: assessId, vendor_id: vendorId, type: "periodic",
        date: new Date().toISOString().split("T")[0],
        status: "in_progress", responses: [], score: null, completion_rate: 0
    });
    _autoSave();
    // Trigger file import
    var fi = document.createElement("input");
    fi.type = "file";
    fi.accept = ".csv,.xlsx";
    fi.onchange = function() {
        if (!fi.files[0]) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            var text = e.target.result;
            var lines = text.replace(/^\uFEFF/, "").split("\n");
            if (lines.length < 2) { alert("Empty file"); return; }
            var sep = lines[0].indexOf(";") >= 0 ? ";" : ",";
            var a = D.assessments.find(function(x) { return x.id === assessId; });
            if (!a) return;
            for (var i = 1; i < lines.length; i++) {
                var cols = _parseCSVLine(lines[i], sep);
                if (cols.length < 2) continue;
                var qId = cols[0].trim();
                var answer = (cols[1] || "").trim().toLowerCase();
                if (answer === "conforme" || answer === "compliant" || answer === "c") answer = "compliant";
                else if (answer === "partiel" || answer === "partial" || answer === "p") answer = "partial";
                else if (answer === "non conforme" || answer === "non_compliant" || answer === "nc") answer = "non_compliant";
                else if (answer === "na" || answer === "n/a") answer = "na";
                else continue;
                var comment = cols.length > 2 ? cols[2].trim() : "";
                var existing = a.responses.find(function(r) { return r.question_id === qId; });
                if (existing) { existing.answer = answer; if (comment) existing.comment = comment; }
                else a.responses.push({ question_id: qId, answer: answer, comment: comment });
            }
            _autoSave();
            if (_selectedVendor !== null) _assessReturnToVendor = _selectedVendor;
            openAssessment(assessId);
            showStatus(t("assessment.imported"));
        };
        reader.readAsText(fi.files[0]);
    };
    fi.click();
}
window._newAssessmentImport = _newAssessmentImport;

function backToVendors() { _selectedVendor = null; renderPanel(); }
window.backToVendors = backToVendors;

// ═══════════════════════════════════════════════════════════════
// QUESTIONNAIRE TEMPLATES
// ═══════════════════════════════════════════════════════════════
//
// Data model (mono-language, stored in D.questionnaire_templates):
//   {
//     id, name, description, language, version,
//     created_at, updated_at,
//     sections: [
//       {
//         id, title, description,
//         questions: [
//           {
//             id, type, text, description, expected,
//             weight, criticality, options
//           }
//         ]
//       }
//     ]
//   }
//
// Question types: yes_no, scale_1_5, single_choice, multi_choice,
// free_text, file_upload
// Criticality: info, major, blocker
// ═══════════════════════════════════════════════════════════════

var _editingTemplateId = null;

var QUESTION_TYPES = ["yes_no", "scale_1_5", "single_choice", "multi_choice", "free_text", "file_upload"];
var CRITICALITY_LEVELS = ["info", "major", "blocker"];

function _nextTemplateId() {
    var n = (D.questionnaire_templates || []).length + 1;
    var id;
    do {
        id = "TPL-" + String(n).padStart(3, "0");
        n++;
    } while ((D.questionnaire_templates || []).some(function(t0) { return t0.id === id; }));
    return id;
}

function _nextSectionId(tpl) {
    var n = (tpl.sections || []).length + 1;
    var id;
    do {
        id = "SEC-" + String(n).padStart(3, "0");
        n++;
    } while ((tpl.sections || []).some(function(s) { return s.id === id; }));
    return id;
}

function _nextQuestionId(section) {
    var n = (section.questions || []).length + 1;
    var id;
    do {
        id = "Q-" + String(n).padStart(3, "0");
        n++;
    } while ((section.questions || []).some(function(q) { return q.id === id; }));
    return id;
}

function _today() { return new Date().toISOString().split("T")[0]; }

// Migrate legacy TPRM_QUESTIONS into a default template on first load.
// Called from renderPanel before rendering templates (or any assessments).
function _ensureDefaultTemplate() {
    if (!D.questionnaire_templates) D.questionnaire_templates = [];
    if (D.questionnaire_templates.length > 0) return;
    if (typeof TPRM_QUESTIONS === "undefined" || !TPRM_QUESTIONS.length) return;

    var lang = (typeof _locale === "string" && _locale === "en") ? "en" : "fr";
    var tpl = {
        id: "TPL-001",
        name: lang === "en" ? "Standard vendor questionnaire" : "Questionnaire fournisseur standard",
        description: lang === "en"
            ? "Default security questionnaire (30 essential questions covering governance, access, cloud, DORA, etc.)."
            : "Questionnaire de securite par defaut (30 questions essentielles couvrant gouvernance, acces, cloud, DORA, etc.).",
        language: lang,
        version: 1,
        created_at: _today(),
        updated_at: _today(),
        sections: []
    };

    // Domain → section title mapping
    var domainTitles = {
        governance:     { fr: "Gouvernance et organisation",      en: "Governance and organization" },
        access:         { fr: "Controle d'acces",                 en: "Access control" },
        network:        { fr: "Securite reseau",                  en: "Network security" },
        dev:            { fr: "Developpement securise",           en: "Secure development" },
        data:           { fr: "Protection des donnees",           en: "Data protection" },
        endpoint:       { fr: "Securite des postes",              en: "Endpoint security" },
        detection:      { fr: "Detection et supervision",         en: "Detection and monitoring" },
        continuity:     { fr: "Continuite d'activite",            en: "Business continuity" },
        supply_chain:   { fr: "Chaine d'approvisionnement",       en: "Supply chain" },
        audit:          { fr: "Audit et conformite",              en: "Audit and compliance" },
        hr:             { fr: "Ressources humaines",              en: "Human resources" },
        physical:       { fr: "Securite physique",                en: "Physical security" },
        cloud:          { fr: "Securite cloud",                   en: "Cloud security" },
        incidents:      { fr: "Gestion des incidents",            en: "Incident management" },
        compliance:     { fr: "Conformite reglementaire",         en: "Regulatory compliance" },
        dora:           { fr: "DORA - Prestataire TIC critique",  en: "DORA - Critical ICT provider" }
    };

    var sectionMap = {}; // domain → section index
    TPRM_QUESTIONS.forEach(function(q) {
        var domain = q.domain || "other";
        if (!sectionMap.hasOwnProperty(domain)) {
            var title = (domainTitles[domain] && domainTitles[domain][lang]) || domain;
            tpl.sections.push({
                id: "SEC-" + String(tpl.sections.length + 1).padStart(3, "0"),
                title: title,
                description: "",
                questions: []
            });
            sectionMap[domain] = tpl.sections.length - 1;
        }
        var section = tpl.sections[sectionMap[domain]];
        section.questions.push({
            id: "Q-" + String(section.questions.length + 1).padStart(3, "0"),
            type: "free_text",
            text: lang === "en" ? (q.text_en || q.text_fr || "") : (q.text_fr || q.text_en || ""),
            description: "",
            expected: lang === "en" ? (q.expected_en || "") : (q.expected_fr || ""),
            weight: q.weight || 5,
            criticality: "major",
            options: []
        });
    });

    D.questionnaire_templates.push(tpl);
}

// ── List view ──────────────────────────────────────────────────
function renderTemplateList() {
    _ensureDefaultTemplate();
    var templates = D.questionnaire_templates || [];
    var h = '<div class="tpl-header">';
    h += '<h2>' + t("template.title") + '</h2>';
    h += '<button class="btn-add" data-click="createTemplate">' + t("template.new") + '</button>';
    h += '</div>';
    h += '<p class="panel-desc">' + t("template.intro") + '</p>';

    if (!templates.length) {
        return h + '<div class="empty-state">' + t("template.empty") + '</div>';
    }

    templates.forEach(function(tpl) {
        var qCount = (tpl.sections || []).reduce(function(acc, s) { return acc + (s.questions || []).length; }, 0);
        var sCount = (tpl.sections || []).length;
        h += '<div class="tpl-card">';
        h += '<div class="tpl-card-icon">&#x1F4CB;</div>';
        h += '<div class="tpl-card-body">';
        h += '<div class="tpl-card-name">' + esc(tpl.name || "") + '</div>';
        h += '<div class="tpl-card-desc">' + esc(tpl.description || tpl.id) + '</div>';
        h += '</div>';
        h += '<div class="tpl-card-stats">';
        h += '<span><strong>' + sCount + '</strong> ' + t("template.col_sections").toLowerCase() + '</span>';
        h += '<span><strong>' + qCount + '</strong> ' + t("template.col_questions").toLowerCase() + '</span>';
        h += '<span>' + esc((tpl.language || "").toUpperCase()) + '</span>';
        h += '<span>v' + (tpl.version || 1) + '</span>';
        h += '</div>';
        h += '<div class="tpl-card-actions">';
        h += '<button class="tpl-icon-btn" data-click="editTemplate" data-args=\'' + _da(tpl.id) + '\' title="' + esc(t("common.edit")) + '" data-tooltip="' + esc(t("common.edit")) + '" aria-label="' + esc(t("common.edit")) + '">&#x270E;</button>';
        h += '<button class="tpl-icon-btn" data-click="duplicateTemplate" data-args=\'' + _da(tpl.id) + '\' title="' + esc(t("common.duplicate")) + '" data-tooltip="' + esc(t("common.duplicate")) + '" aria-label="' + esc(t("common.duplicate")) + '">&#x2398;</button>';
        h += '<button class="tpl-icon-btn danger" data-click="deleteTemplate" data-args=\'' + _da(tpl.id) + '\' title="' + esc(t("common.delete")) + '" data-tooltip="' + esc(t("common.delete")) + '" aria-label="' + esc(t("common.delete")) + '">&#x1F5D1;</button>';
        h += '</div>';
        h += '</div>';
    });
    return h;
}

function createTemplate() {
    var lang = (typeof _locale === "string" && _locale === "en") ? "en" : "fr";
    var tpl = {
        id: _nextTemplateId(),
        name: lang === "en" ? "New template" : "Nouveau template",
        description: "",
        language: lang,
        version: 1,
        created_at: _today(),
        updated_at: _today(),
        sections: []
    };
    if (!D.questionnaire_templates) D.questionnaire_templates = [];
    D.questionnaire_templates.push(tpl);
    _autoSave();
    _editingTemplateId = tpl.id;
    renderPanel();
}
window.createTemplate = createTemplate;

function editTemplate(tplId) {
    _editingTemplateId = tplId;
    renderPanel();
}
window.editTemplate = editTemplate;

function duplicateTemplate(tplId) {
    var src = (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
    if (!src) return;
    var copy = JSON.parse(JSON.stringify(src));
    copy.id = _nextTemplateId();
    copy.name = src.name + " (copy)";
    copy.version = 1;
    copy.created_at = _today();
    copy.updated_at = _today();
    D.questionnaire_templates.push(copy);
    _autoSave();
    renderPanel();
}
window.duplicateTemplate = duplicateTemplate;

function deleteTemplate(tplId) {
    if (!confirm(t("template.confirm_delete"))) return;
    D.questionnaire_templates = (D.questionnaire_templates || []).filter(function(tp) { return tp.id !== tplId; });
    _autoSave();
    renderPanel();
}
window.deleteTemplate = deleteTemplate;

// ── Editor view ────────────────────────────────────────────────
function renderTemplateEditor(tplId) {
    var tpl = (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
    if (!tpl) { _editingTemplateId = null; return renderTemplateList(); }

    var h = '<div class="tpl-header">';
    h += '<button class="btn-add" data-click="closeTemplateEditor">&laquo; ' + t("template.back") + '</button>';
    h += '<h2>' + esc(tpl.name || "") + '</h2>';
    h += '<span class="tpl-meta">' + esc(tpl.id) + ' &middot; v' + (tpl.version || 1) + '</span>';
    h += '</div>';

    // Template metadata block — reuse .tprm-form design from vendor/measure forms
    h += '<div class="tprm-form tpl-editor-meta">';
    h += '<div class="form-grid">';
    h += '<div class="form-row"><label>' + t("template.name") + '</label>';
    h += '<input type="text" value="' + esc(tpl.name || "") + '" data-input="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "name") + '\' data-pass-value></div>';
    h += '<div class="form-row"><label>' + t("template.language") + '</label>';
    h += '<select data-change="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "language") + '\' data-pass-value>';
    h += '<option value="fr"' + (tpl.language === "fr" ? " selected" : "") + '>Francais</option>';
    h += '<option value="en"' + (tpl.language === "en" ? " selected" : "") + '>English</option>';
    h += '</select></div>';
    h += '</div>';
    h += '<div class="form-row"><label>' + t("template.description") + '</label>';
    h += '<textarea rows="3" data-input="_onTemplateFieldChange" data-args=\'' + _da(tpl.id, "description") + '\' data-pass-value>' + esc(tpl.description || "") + '</textarea></div>';
    h += '</div>';

    // Sections header + add button
    var sections = tpl.sections || [];
    h += '<div class="tpl-header" style="margin-top:18px;margin-bottom:10px">';
    h += '<span class="tpl-section-count">' + t("template.sections") + ' &middot; ' + sections.length + '</span>';
    h += '<span style="flex:1"></span>';
    h += '<button class="btn-add" data-click="addSection" data-args=\'' + _da(tpl.id) + '\'>' + t("template.add_section") + '</button>';
    h += '</div>';

    if (!sections.length) {
        h += '<div class="empty-state">' + t("template.no_sections") + '</div>';
    } else {
        sections.forEach(function(section, si) {
            h += _renderTemplateSection(tpl, section, si, sections.length);
        });
    }

    return h;
}

function _renderTemplateSection(tpl, section, si, total) {
    var h = '<div class="tpl-section">';
    // Section header
    h += '<div class="tpl-section-header">';
    h += '<span class="tpl-section-id">' + esc(section.id) + '</span>';
    h += '<input type="text" class="tpl-section-title" value="' + esc(section.title || "") + '" placeholder="' + esc(t("template.section_title")) + '" data-input="_onSectionFieldChange" data-args=\'' + _da(tpl.id, section.id, "title") + '\' data-pass-value>';
    h += '<button class="tpl-icon-btn"' + (si === 0 ? ' disabled' : '') + ' data-click="moveSection" data-args=\'' + _da(tpl.id, section.id, -1) + '\' title="' + esc(t("common.move_up")) + '">&uarr;</button>';
    h += '<button class="tpl-icon-btn"' + (si === total - 1 ? ' disabled' : '') + ' data-click="moveSection" data-args=\'' + _da(tpl.id, section.id, 1) + '\' title="' + esc(t("common.move_down")) + '">&darr;</button>';
    h += '<button class="tpl-icon-btn danger" data-click="deleteSection" data-args=\'' + _da(tpl.id, section.id) + '\' title="' + esc(t("common.delete")) + '">&#x1F5D1;</button>';
    h += '</div>';
    // Section description
    h += '<textarea class="tpl-section-desc" rows="1" placeholder="' + esc(t("template.section_description")) + '" data-input="_onSectionFieldChange" data-args=\'' + _da(tpl.id, section.id, "description") + '\' data-pass-value>' + esc(section.description || "") + '</textarea>';

    // Questions
    var questions = section.questions || [];
    h += '<div class="tpl-section-questions-header">';
    h += '<span class="tpl-section-questions-label">' + t("template.questions") + ' &middot; ' + questions.length + '</span>';
    h += '<button class="btn-add" style="font-size:0.75em;padding:4px 10px" data-click="addQuestion" data-args=\'' + _da(tpl.id, section.id) + '\'>' + t("template.add_question") + '</button>';
    h += '</div>';

    if (!questions.length) {
        h += '<div style="color:var(--text-muted);font-size:0.8em;padding:12px;text-align:center;background:var(--bg);border-radius:4px">' + t("template.no_questions") + '</div>';
    } else {
        questions.forEach(function(q, qi) {
            h += _renderTemplateQuestion(tpl, section, q, qi, questions.length);
        });
    }

    h += '</div>';
    return h;
}

function _renderTemplateQuestion(tpl, section, q, qi, total) {
    var h = '<div class="tpl-question">';
    // Header row: id + type + criticality + weight + controls
    h += '<div class="tpl-question-header">';
    h += '<span class="tpl-question-id">' + esc(q.id) + '</span>';
    h += '<select data-change="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "type") + '\' data-pass-value>';
    QUESTION_TYPES.forEach(function(ty) {
        h += '<option value="' + ty + '"' + (q.type === ty ? " selected" : "") + '>' + esc(t("qtype." + ty)) + '</option>';
    });
    h += '</select>';
    var critClass = "tpl-criticality crit-" + (q.criticality || "major");
    h += '<select class="' + critClass + '" data-change="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "criticality") + '\' data-pass-value>';
    CRITICALITY_LEVELS.forEach(function(cr) {
        h += '<option value="' + cr + '"' + (q.criticality === cr ? " selected" : "") + '>' + esc(t("criticality." + cr)) + '</option>';
    });
    h += '</select>';
    h += '<label class="tpl-question-weight">' + t("template.weight");
    h += '<input type="number" min="0" max="100" value="' + (q.weight || 0) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "weight") + '\' data-pass-value>';
    h += '</label>';
    h += '<span style="flex:1"></span>';
    h += '<button class="tpl-icon-btn"' + (qi === 0 ? ' disabled' : '') + ' data-click="moveQuestion" data-args=\'' + _da(tpl.id, section.id, q.id, -1) + '\' title="' + esc(t("common.move_up")) + '">&uarr;</button>';
    h += '<button class="tpl-icon-btn"' + (qi === total - 1 ? ' disabled' : '') + ' data-click="moveQuestion" data-args=\'' + _da(tpl.id, section.id, q.id, 1) + '\' title="' + esc(t("common.move_down")) + '">&darr;</button>';
    h += '<button class="tpl-icon-btn danger" data-click="deleteQuestion" data-args=\'' + _da(tpl.id, section.id, q.id) + '\' title="' + esc(t("common.delete")) + '">&times;</button>';
    h += '</div>';
    // Question text
    h += '<textarea class="tpl-question-text" rows="2" placeholder="' + esc(t("template.question_text")) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "text") + '\' data-pass-value>' + esc(q.text || "") + '</textarea>';
    // Expected answer / evidence
    h += '<textarea class="tpl-question-expected" rows="1" placeholder="' + esc(t("template.question_expected")) + '" data-input="_onQuestionFieldChange" data-args=\'' + _da(tpl.id, section.id, q.id, "expected") + '\' data-pass-value>' + esc(q.expected || "") + '</textarea>';
    // Options editor for choice types
    if (q.type === "single_choice" || q.type === "multi_choice") {
        h += '<div class="tpl-question-options">';
        h += '<div class="tpl-question-options-label">' + t("template.options") + '</div>';
        (q.options || []).forEach(function(opt, oi) {
            h += '<div class="tpl-question-option">';
            h += '<input type="text" value="' + esc(opt) + '" data-input="_onOptionChange" data-args=\'' + _da(tpl.id, section.id, q.id, oi) + '\' data-pass-value>';
            h += '<button class="tpl-icon-btn danger" data-click="deleteOption" data-args=\'' + _da(tpl.id, section.id, q.id, oi) + '\' title="' + esc(t("common.delete")) + '">&times;</button>';
            h += '</div>';
        });
        h += '<button class="btn-add" style="font-size:0.75em;padding:3px 10px;margin-top:4px" data-click="addOption" data-args=\'' + _da(tpl.id, section.id, q.id) + '\'>+ ' + t("template.add_option") + '</button>';
        h += '</div>';
    }
    h += '</div>';
    return h;
}

function closeTemplateEditor() {
    _editingTemplateId = null;
    renderPanel();
}
window.closeTemplateEditor = closeTemplateEditor;

// ── Template/section/question edit handlers ────────────────────
function _findTemplate(tplId) {
    return (D.questionnaire_templates || []).find(function(tp) { return tp.id === tplId; });
}
function _findSection(tpl, sectionId) {
    if (!tpl || !tpl.sections) return null;
    return tpl.sections.find(function(s) { return s.id === sectionId; });
}
function _findQuestion(section, questionId) {
    if (!section || !section.questions) return null;
    return section.questions.find(function(q) { return q.id === questionId; });
}
function _touchTemplate(tpl) {
    tpl.updated_at = _today();
    _autoSave();
}

function _onTemplateFieldChange(tplId, field, value) {
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    tpl[field] = value;
    _touchTemplate(tpl);
    // Update title in header live
    if (field === "name") {
        var h2 = document.querySelector("#content h2");
        if (h2) h2.textContent = value;
    }
}
window._onTemplateFieldChange = _onTemplateFieldChange;

function _onSectionFieldChange(tplId, sectionId, field, value) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    section[field] = value;
    _touchTemplate(tpl);
}
window._onSectionFieldChange = _onSectionFieldChange;

function _onQuestionFieldChange(tplId, sectionId, questionId, field, value) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    var q = _findQuestion(section, questionId);
    if (!q) return;
    if (field === "weight") {
        var n = parseInt(value, 10);
        q.weight = isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
    } else {
        q[field] = value;
    }
    _touchTemplate(tpl);
    // Re-render only on type change (options editor appears/disappears)
    if (field === "type") renderPanel();
}
window._onQuestionFieldChange = _onQuestionFieldChange;

function addSection(tplId) {
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    if (!tpl.sections) tpl.sections = [];
    tpl.sections.push({
        id: _nextSectionId(tpl),
        title: t("template.new_section"),
        description: "",
        questions: []
    });
    _touchTemplate(tpl);
    renderPanel();
}
window.addSection = addSection;

function deleteSection(tplId, sectionId) {
    if (!confirm(t("template.confirm_delete_section"))) return;
    var tpl = _findTemplate(tplId);
    if (!tpl) return;
    tpl.sections = tpl.sections.filter(function(s) { return s.id !== sectionId; });
    _touchTemplate(tpl);
    renderPanel();
}
window.deleteSection = deleteSection;

function moveSection(tplId, sectionId, delta) {
    var tpl = _findTemplate(tplId);
    if (!tpl || !tpl.sections) return;
    var idx = tpl.sections.findIndex(function(s) { return s.id === sectionId; });
    var newIdx = idx + delta;
    if (idx < 0 || newIdx < 0 || newIdx >= tpl.sections.length) return;
    var tmp = tpl.sections[idx];
    tpl.sections[idx] = tpl.sections[newIdx];
    tpl.sections[newIdx] = tmp;
    _touchTemplate(tpl);
    renderPanel();
}
window.moveSection = moveSection;

function addQuestion(tplId, sectionId) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    if (!section.questions) section.questions = [];
    section.questions.push({
        id: _nextQuestionId(section),
        type: "free_text",
        text: "",
        description: "",
        expected: "",
        weight: 5,
        criticality: "major",
        options: []
    });
    _touchTemplate(tpl);
    renderPanel();
}
window.addQuestion = addQuestion;

function deleteQuestion(tplId, sectionId, questionId) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section) return;
    section.questions = section.questions.filter(function(q) { return q.id !== questionId; });
    _touchTemplate(tpl);
    renderPanel();
}
window.deleteQuestion = deleteQuestion;

function moveQuestion(tplId, sectionId, questionId, delta) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    if (!section || !section.questions) return;
    var idx = section.questions.findIndex(function(q) { return q.id === questionId; });
    var newIdx = idx + delta;
    if (idx < 0 || newIdx < 0 || newIdx >= section.questions.length) return;
    var tmp = section.questions[idx];
    section.questions[idx] = section.questions[newIdx];
    section.questions[newIdx] = tmp;
    _touchTemplate(tpl);
    renderPanel();
}
window.moveQuestion = moveQuestion;

function addOption(tplId, sectionId, questionId) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    var q = _findQuestion(section, questionId);
    if (!q) return;
    if (!q.options) q.options = [];
    q.options.push("");
    _touchTemplate(tpl);
    renderPanel();
}
window.addOption = addOption;

function deleteOption(tplId, sectionId, questionId, optionIdx) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    var q = _findQuestion(section, questionId);
    if (!q || !q.options) return;
    q.options.splice(optionIdx, 1);
    _touchTemplate(tpl);
    renderPanel();
}
window.deleteOption = deleteOption;

function _onOptionChange(tplId, sectionId, questionId, optionIdx, value) {
    var tpl = _findTemplate(tplId);
    var section = _findSection(tpl, sectionId);
    var q = _findQuestion(section, questionId);
    if (!q || !q.options) return;
    q.options[optionIdx] = value;
    _touchTemplate(tpl);
}
window._onOptionChange = _onOptionChange;

// ═══════════════════════════════════════════════════════════════
// GLOBAL MEASURES REGISTRY
// ═══════════════════════════════════════════════════════════════

var _editingMeasure = null; // { vendorIdx, measureIdx, returnTo }

function renderGlobalMeasures() {
    // Editing a specific measure?
    if (_editingMeasure) return _renderMeasureEditForm();

    var allMeasures = [];
    D.vendors.forEach(function(v, vi) {
        (v.measures || []).forEach(function(m, mi) {
            allMeasures.push({ vendor: v.name, vendorIdx: vi, measureIdx: mi, measure: m });
        });
    });

    // Count unlinked measures
    var unlinkedCount = 0;
    D.vendors.forEach(function(v) {
        var vendorRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
        var allLinkedIds = {};
        vendorRisks.forEach(function(r) {
            (r.linked_measures || "").split(",").forEach(function(s) { var id = s.trim().split(" - ")[0].trim(); if (id) allLinkedIds[id] = true; });
        });
        (v.measures || []).forEach(function(m) { if (!allLinkedIds[m.id]) unlinkedCount++; });
    });

    var h = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">';
    h += '<h2>' + t("nav.measures") + ' (' + allMeasures.length + ')</h2>';
    if (unlinkedCount > 0) {
        h += '<button class="btn-del" data-click="deleteUnlinkedMeasures">' + t("measure.delete_unlinked") + ' (' + unlinkedCount + ')</button>';
    }
    h += '</div>';
    if (!allMeasures.length) return h + '<div class="empty-state">' + t("measure.empty") + '</div>';

    h += colsButton("global-measures-table");
    h += '<table id="global-measures-table"><thead><tr>';
    h += '<th' + hd("vendor") + '>' + t("nav.vendors") + '</th>';
    h += '<th' + hd("id") + '>ID</th>';
    h += '<th' + hd("mesure") + '>' + t("measure.col_mesure") + '</th>';
    h += '<th' + hd("type") + '>' + t("measure.col_type") + '</th>';
    h += '<th' + hd("statut") + '>' + t("measure.col_statut") + '</th>';
    h += '<th' + hd("resp") + '>' + t("measure.col_responsable") + '</th>';
    h += '<th' + hd("deadline") + '>' + t("measure.col_echeance") + '</th>';
    h += '</tr></thead><tbody>';

    allMeasures.forEach(function(item) {
        var m = item.measure;
        var _statutMap = {"termine":"green","en_cours":"orange","planifie":"blue","completed":"green"};
        h += '<tr style="cursor:pointer" data-click="editMeasure" data-args=\'' + _da(item.vendorIdx, item.measureIdx, "measures") + '\'>';
        h += '<td' + hd("vendor") + ' class="fw-600">' + esc(item.vendor) + '</td>';
        h += '<td' + hd("id") + '>' + esc(m.id) + '</td>';
        h += '<td' + hd("mesure") + '>' + esc(m.mesure || "") + '</td>';
        h += '<td' + hd("type") + '>' + esc(m.type || "") + '</td>';
        h += '<td' + hd("statut") + '>' + ctBadge(t("measure." + (m.statut || "planifie")), _statutMap[m.statut] || "gray") + '</td>';
        h += '<td' + hd("resp") + '>' + esc(m.responsable || "") + '</td>';
        h += '<td' + hd("deadline") + '>' + esc(m.echeance || "") + '</td>';
        h += '</tr>';
    });
    h += '</tbody></table>';
    return h;
}

function deleteUnlinkedMeasures() {
    var count = 0;
    D.vendors.forEach(function(v) {
        if (!v.measures || !v.measures.length) return;
        var vendorRisks = D.risks.filter(function(r) { return r.vendor_id === v.id; });
        var allLinkedIds = {};
        vendorRisks.forEach(function(r) {
            (r.linked_measures || "").split(",").forEach(function(s) {
                var id = s.trim().split(" - ")[0].trim();
                if (id) allLinkedIds[id] = true;
            });
        });
        var before = v.measures.length;
        v.measures = v.measures.filter(function(m) { return allLinkedIds[m.id]; });
        count += before - v.measures.length;
    });
    if (count > 0) {
        _autoSave();
        renderPanel();
        showStatus(count + " " + t("measure.deleted_unlinked"));
    }
}
window.deleteUnlinkedMeasures = deleteUnlinkedMeasures;

function editMeasure(vendorIdx, measureIdx, returnTo) {
    _editingMeasure = { vendorIdx: vendorIdx, measureIdx: measureIdx, returnTo: returnTo || "measures" };
    if (returnTo === "risks") {
        // Stay on vendor detail, just re-render
        renderPanel();
    } else {
        _panel = "measures";
        renderPanel();
    }
}
window.editMeasure = editMeasure;

function _renderMeasureEditForm() {
    var em = _editingMeasure;
    var v = D.vendors[em.vendorIdx];
    if (!v || !v.measures || !v.measures[em.measureIdx]) { _editingMeasure = null; return renderGlobalMeasures(); }
    var m = v.measures[em.measureIdx];

    var h = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">';
    h += '<button class="btn-add" data-click="saveMeasureEdit">&laquo; ' + t("common.save") + '</button>';
    h += '<h2 style="flex:1">' + esc(m.id) + ' — ' + esc(v.name) + '</h2>';
    h += '</div>';

    h += '<div class="tprm-form">';
    h += '<div class="form-row"><label>' + t("measure.col_mesure") + '</label>';
    h += '<input type="text" id="me-name" value="' + esc(m.mesure || "") + '" class="w-full" style="font-weight:600"></div>';

    h += '<div class="form-row"><label>' + t("measure.details") + '</label>';
    h += '<textarea id="me-details" rows="4" class="w-full">' + esc(m.details || "") + '</textarea></div>';

    h += '<div class="form-grid">';
    h += '<div class="form-row"><label>' + t("measure.col_type") + '</label><select id="me-type">';
    ["Contractuelle","Technique","Organisationnelle","Surveillance"].forEach(function(tp) {
        h += '<option value="' + tp + '"' + (m.type === tp ? ' selected' : '') + '>' + tp + '</option>';
    });
    h += '</select></div>';

    h += '<div class="form-row"><label>' + t("measure.col_statut") + '</label><select id="me-statut">';
    [["planifie",t("measure.planifie")],["en_cours",t("measure.en_cours")],["termine",t("measure.termine")]].forEach(function(s) {
        h += '<option value="' + s[0] + '"' + (m.statut === s[0] ? ' selected' : '') + '>' + s[1] + '</option>';
    });
    h += '</select></div>';
    h += '</div>';

    h += '<div class="form-grid">';
    h += '<div class="form-row"><label>' + t("measure.col_responsable") + '</label><input type="text" id="me-resp" value="' + esc(m.responsable || "") + '"></div>';
    h += '<div class="form-row"><label>' + t("measure.col_echeance") + '</label><input type="date" id="me-date" value="' + esc(m.echeance || "") + '"></div>';
    h += '</div>';

    h += '<div class="form-row"><label>' + t("measure.ref_socle") + '</label><input type="text" id="me-ref" value="' + esc(m.ref_socle || "") + '" class="w-full" placeholder="ISO 27001 A.x.x, ANSSI #xx..."></div>';
    h += '<div class="form-row"><label>' + t("measure.effet") + '</label><textarea id="me-effet" rows="2" class="w-full">' + esc(m.effet || "") + '</textarea></div>';

    h += '</div>';
    return h;
}

function saveMeasureEdit() {
    var em = _editingMeasure;
    if (!em) return;
    var v = D.vendors[em.vendorIdx];
    if (!v || !v.measures || !v.measures[em.measureIdx]) { _editingMeasure = null; renderPanel(); return; }
    var m = v.measures[em.measureIdx];

    m.mesure = document.getElementById("me-name").value.trim();
    m.details = document.getElementById("me-details").value.trim();
    m.type = document.getElementById("me-type").value;
    m.statut = document.getElementById("me-statut").value;
    m.responsable = document.getElementById("me-resp").value.trim();
    m.echeance = document.getElementById("me-date").value;
    m.ref_socle = document.getElementById("me-ref").value.trim();
    m.effet = document.getElementById("me-effet").value.trim();

    _autoSave();
    var returnTo = em.returnTo;
    _editingMeasure = null;

    if (returnTo === "risks") {
        _vendorTab = "risks";
        renderPanel();
    } else {
        _panel = "measures";
        renderPanel();
    }
    showStatus(t("measure.saved"));
}
window.saveMeasureEdit = saveMeasureEdit;

var _assessReturnToVendor = null;

function backToAssessments() {
    if (_assessReturnToVendor !== null) {
        _selectedVendor = _assessReturnToVendor;
        _vendorTab = "assessments";
        _assessReturnToVendor = null;
        _panel = "vendors";
        renderPanel();
    } else {
        selectPanel("assessments");
    }
}
window.backToAssessments = backToAssessments;

function setVendorTab(tab) { _vendorTab = tab; renderPanel(); }
window.setVendorTab = setVendorTab;

// ═══════════════════════════════════════════════════════════════
// PP EXPORT / IMPORT (EBIOS RM interop)
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// EXCEL EXPORT
// ═══════════════════════════════════════════════════════════════

var _excelJSLoaded = false;
function _loadExcelJS() {
    return new Promise(function(resolve, reject) {
        if (_excelJSLoaded) { resolve(); return; }
        var s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
        s.crossOrigin = "anonymous";
        s.onload = function() { _excelJSLoaded = true; resolve(); };
        s.onerror = function() { reject(new Error("ExcelJS load error")); };
        document.head.appendChild(s);
    });
}

function exportExcel() {
    _loadExcelJS().then(function() {
        showStatus(t("menu_export_excel") + "...");
        var wb = new ExcelJS.Workbook();
        wb.creator = "CISO Toolbox — Vendor";
        var org = D.metadata.organization || "";

        // ── Colors ──
        var headerFill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
        var headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
        var borderThin = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

        function _applyHeaders(ws) {
            var row = ws.getRow(1);
            row.eachCell(function(cell) {
                cell.fill = headerFill;
                cell.font = headerFont;
                cell.border = borderThin;
                cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            });
            row.height = 28;
        }

        // ════════════════════════════════════════════════════════
        // Sheet 1: Fournisseurs
        // ════════════════════════════════════════════════════════
        var ws1 = wb.addWorksheet(t("nav.vendors"));
        ws1.columns = [
            { header: "ID", key: "id", width: 10 },
            { header: t("vendor.name"), key: "name", width: 25 },
            { header: t("vendor.status"), key: "status", width: 12 },
            { header: t("vendor.sector"), key: "sector", width: 20 },
            { header: t("vendor.country"), key: "country", width: 12 },
            { header: t("vendor.website"), key: "website", width: 25 },
            { header: t("vendor.contact_name"), key: "contact", width: 18 },
            { header: t("vendor.contact_email"), key: "email", width: 22 },
            { header: t("vendor.cls_ops_impact"), key: "ops", width: 10 },
            { header: t("vendor.cls_processes"), key: "proc", width: 10 },
            { header: t("vendor.cls_replace_difficulty"), key: "repl", width: 10 },
            { header: t("vendor.cls_data_sensitivity"), key: "data", width: 10 },
            { header: t("vendor.cls_integration"), key: "integ", width: 10 },
            { header: t("vendor.cls_regulatory"), key: "reg", width: 10 },
            { header: t("vendor.dependance"), key: "dep", width: 12 },
            { header: t("vendor.penetration"), key: "pen", width: 12 },
            { header: t("vendor.maturite"), key: "mat", width: 10 },
            { header: t("vendor.confiance"), key: "conf", width: 10 },
            { header: t("vendor.threat_level"), key: "menace", width: 12 },
            { header: t("vendor.tier"), key: "tier", width: 12 },
            { header: t("vendor.gdpr_subprocessor"), key: "gdpr", width: 10 },
            { header: "DORA", key: "dora", width: 8 },
            { header: t("vendor.contract_start"), key: "start", width: 14 },
            { header: t("vendor.contract_end"), key: "end", width: 14 },
            { header: t("vendor.review_date"), key: "review", width: 14 },
            { header: t("vendor.notes"), key: "notes", width: 30 }
        ];
        D.vendors.forEach(function(v, i) {
            var c = v.classification || {};
            var ex = v.exposure || {};
            var ct = v.contract || {};
            var co = v.contact || {};
            var row = i + 2;
            ws1.addRow({
                id: v.id, name: v.name, status: t("vendor.status_" + (v.status || "prospect")),
                sector: v.sector, country: v.country, website: v.website,
                contact: co.name, email: co.email,
                ops: c.ops_impact || 0, proc: c.processes || 0, repl: c.replace_difficulty || 0,
                data: c.data_sensitivity || 0, integ: c.integration || 0, reg: c.regulatory_impact || 0,
                dep: null, pen: null, mat: ex.maturite || 0, conf: ex.confiance || 0,
                menace: null, tier: null,
                gdpr: c.gdpr_subprocessor ? t("common.yes") || "Oui" : "",
                dora: _isDoraICTCritical(c) ? "Oui" : "",
                start: ct.start_date, end: ct.end_date, review: ct.review_date,
                notes: v.notes
            });
            // Formulas: Dep = AVG(ops, proc, repl), Pen = AVG(data, integ, reg)
            var depCol = "O", penCol = "P", matCol = "Q", confCol = "R", menaceCol = "S", tierCol = "T";
            ws1.getCell(depCol + row).value = { formula: "ROUND(AVERAGE(I" + row + ",J" + row + ",K" + row + ")*10,0)/10" };
            ws1.getCell(penCol + row).value = { formula: "ROUND(AVERAGE(L" + row + ",M" + row + ",N" + row + ")*10,0)/10" };
            ws1.getCell(menaceCol + row).value = { formula: "IF(AND(" + matCol + row + ">0," + confCol + row + ">0),ROUND((" + depCol + row + "*" + penCol + row + ")/(" + matCol + row + "*" + confCol + row + ")*100,0)/100,0)" };
            ws1.getCell(tierCol + row).value = { formula: 'IF(' + menaceCol + row + '>=4,"' + t("vendor.exposure_critical") + '",IF(' + menaceCol + row + '>=2,"' + t("vendor.exposure_high") + '",IF(' + menaceCol + row + '>=1,"' + t("vendor.exposure_moderate") + '","' + t("vendor.exposure_low") + '")))' };
        });
        _applyHeaders(ws1);
        ws1.autoFilter = { from: "A1", to: "Z" + (D.vendors.length + 1) };

        // ════════════════════════════════════════════════════════
        // Sheet 2: Risques
        // ════════════════════════════════════════════════════════
        var ws2 = wb.addWorksheet(t("nav.risks"));
        ws2.columns = [
            { header: "ID", key: "id", width: 14 },
            { header: t("risk.vendor"), key: "vendor", width: 20 },
            { header: t("risk.risk_title"), key: "title", width: 30 },
            { header: t("risk.category"), key: "cat", width: 12 },
            { header: t("risk.impact"), key: "impact", width: 8 },
            { header: t("risk.likelihood"), key: "likelihood", width: 12 },
            { header: t("risk.inherent_score"), key: "score", width: 12 },
            { header: t("risk.treatment"), key: "treatment", width: 12 },
            { header: t("risk.residual_impact"), key: "resi", width: 10 },
            { header: t("risk.residual_likelihood"), key: "resl", width: 12 },
            { header: t("risk.residual_score"), key: "resscore", width: 12 },
            { header: t("risk.status"), key: "status", width: 12 },
            { header: t("risk.description"), key: "desc", width: 40 }
        ];
        D.risks.forEach(function(r, i) {
            var row = i + 2;
            ws2.addRow({
                id: r.id, vendor: _vendorName(r.vendor_id), title: r.title,
                cat: r.category, impact: r.impact, likelihood: r.likelihood,
                score: null, treatment: r.treatment ? t("risk.treatment_" + r.treatment.response) : "",
                resi: r.residual_impact || "", resl: r.residual_likelihood || "",
                resscore: null, status: t("risk.status_" + (r.status || "active")),
                desc: r.description
            });
            // Formulas: inherent = I*L, residual = rI*rL
            ws2.getCell("G" + row).value = { formula: "E" + row + "*F" + row };
            ws2.getCell("K" + row).value = { formula: 'IF(AND(I' + row + '<>"",J' + row + '<>""),I' + row + "*J" + row + ',"")'};
            // Color inherent score
            ws2.getCell("G" + row).fill = null;
        });
        _applyHeaders(ws2);
        ws2.autoFilter = { from: "A1", to: "M" + (D.risks.length + 1) };

        // ════════════════════════════════════════════════════════
        // Sheet 3: Mesures
        // ════════════════════════════════════════════════════════
        var ws3 = wb.addWorksheet(t("nav.measures"));
        ws3.columns = [
            { header: "ID", key: "id", width: 14 },
            { header: t("risk.vendor"), key: "vendor", width: 20 },
            { header: t("measure.col_mesure"), key: "mesure", width: 35 },
            { header: t("measure.col_type"), key: "type", width: 16 },
            { header: t("measure.col_statut"), key: "statut", width: 12 },
            { header: t("measure.col_responsable"), key: "resp", width: 18 },
            { header: t("measure.col_echeance"), key: "echeance", width: 14 },
            { header: t("measure.ref_socle"), key: "ref", width: 20 },
            { header: t("measure.details"), key: "details", width: 40 },
            { header: t("measure.effet"), key: "effet", width: 30 }
        ];
        D.vendors.forEach(function(v) {
            (v.measures || []).forEach(function(m) {
                ws3.addRow({
                    id: m.id, vendor: v.name, mesure: m.mesure,
                    type: m.type, statut: t("measure." + (m.statut || "planifie")),
                    resp: m.responsable, echeance: m.echeance,
                    ref: m.ref_socle, details: m.details, effet: m.effet
                });
            });
        });
        _applyHeaders(ws3);
        ws3.autoFilter = { from: "A1", to: "J" + (ws3.rowCount) };

        // ════════════════════════════════════════════════════════
        // Sheet 4: Evaluations
        // ════════════════════════════════════════════════════════
        var ws4 = wb.addWorksheet(t("nav.assessments"));
        ws4.columns = [
            { header: "ID", key: "id", width: 12 },
            { header: t("risk.vendor"), key: "vendor", width: 20 },
            { header: t("assessment.type"), key: "type", width: 14 },
            { header: t("assessment.date"), key: "date", width: 14 },
            { header: t("assessment.status"), key: "status", width: 14 },
            { header: t("assessment.score"), key: "score", width: 10 },
            { header: t("assessment.completion"), key: "completion", width: 12 }
        ];
        D.assessments.forEach(function(a) {
            ws4.addRow({
                id: a.id, vendor: _vendorName(a.vendor_id),
                type: t("assessment.type_" + (a.type || "periodic")),
                date: a.date, status: t("assessment.status_" + (a.status || "draft")),
                score: a.score != null ? a.score + "%" : "", completion: (a.completion_rate || 0) + "%"
            });
        });
        _applyHeaders(ws4);

        // ════════════════════════════════════════════════════════
        // Sheet 5: Documents
        // ════════════════════════════════════════════════════════
        var ws5 = wb.addWorksheet(t("nav.documents"));
        ws5.columns = [
            { header: "ID", key: "id", width: 10 },
            { header: t("risk.vendor"), key: "vendor", width: 20 },
            { header: t("doc.name"), key: "name", width: 30 },
            { header: t("doc.type"), key: "type", width: 16 },
            { header: "URL", key: "url", width: 35 },
            { header: t("doc.expiry"), key: "expiry", width: 14 },
            { header: t("doc.status"), key: "status", width: 12 }
        ];
        D.documents.forEach(function(d, i) {
            var row = i + 2;
            var statusLabel = "";
            if (d.expiry_date) {
                var exp = new Date(d.expiry_date), now = new Date();
                statusLabel = exp < now ? t("doc.status_expired") : exp < new Date(now.getTime() + 30 * 86400000) ? t("doc.status_expiring") : t("doc.status_valid");
            }
            ws5.addRow({
                id: d.id, vendor: _vendorName(d.vendor_id), name: d.name,
                type: _docTypeLabel(d.type), url: d.url, expiry: d.expiry_date, status: statusLabel
            });
        });
        _applyHeaders(ws5);

        // ════════════════════════════════════════════════════════
        // Sheet 6: Tableau de bord (formulas)
        // ════════════════════════════════════════════════════════
        var ws6 = wb.addWorksheet(t("nav.dashboard"));
        ws6.getColumn(1).width = 30;
        ws6.getColumn(2).width = 15;
        var kpis = [
            [t("dashboard.total_vendors"), { formula: "COUNTA(" + t("nav.vendors") + "!A2:A1000)" }],
            [t("dashboard.critical_vendors"), { formula: 'COUNTIF(' + t("nav.vendors") + '!T2:T1000,"' + t("vendor.exposure_critical") + '")' }],
            [t("dashboard.open_risks"), { formula: 'COUNTIFS(' + t("nav.risks") + '!L2:L1000,"<>"&"' + t("risk.status_closed") + '",' + t("nav.risks") + '!L2:L1000,"<>")' }],
            [t("dashboard.pending_assessments"), { formula: 'COUNTIFS(' + t("nav.assessments") + '!E2:E1000,"<>"&"' + t("assessment.status_completed") + '",' + t("nav.assessments") + '!E2:E1000,"<>")' }],
            ["", ""],
            [t("risk.category") + " CYBER", { formula: 'COUNTIF(' + t("nav.risks") + '!D2:D1000,"CYBER")' }],
            [t("risk.category") + " OPS", { formula: 'COUNTIF(' + t("nav.risks") + '!D2:D1000,"OPS")' }],
            [t("risk.category") + " COMP", { formula: 'COUNTIF(' + t("nav.risks") + '!D2:D1000,"COMP")' }],
            [t("risk.category") + " FIN", { formula: 'COUNTIF(' + t("nav.risks") + '!D2:D1000,"FIN")' }],
            [t("risk.category") + " STRAT", { formula: 'COUNTIF(' + t("nav.risks") + '!D2:D1000,"STRAT")' }],
            ["", ""],
            [t("measure.planifie"), { formula: 'COUNTIF(' + t("nav.measures") + '!E2:E1000,"' + t("measure.planifie") + '")' }],
            [t("measure.en_cours"), { formula: 'COUNTIF(' + t("nav.measures") + '!E2:E1000,"' + t("measure.en_cours") + '")' }],
            [t("measure.termine"), { formula: 'COUNTIF(' + t("nav.measures") + '!E2:E1000,"' + t("measure.termine") + '")' }]
        ];
        kpis.forEach(function(kpi, i) {
            var row = ws6.getRow(i + 1);
            row.getCell(1).value = kpi[0];
            row.getCell(1).font = { bold: true, size: 10 };
            row.getCell(2).value = kpi[1];
            row.getCell(2).font = { size: 11 };
            row.getCell(2).alignment = { horizontal: "center" };
        });

        // ── Download ──
        wb.xlsx.writeBuffer().then(function(buf) {
            var blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
            var a = document.createElement("a");
            a.href = URL.createObjectURL(blob);
            a.download = "TPRM_" + (org || "export").replace(/\s/g, "_") + ".xlsx";
            a.click();
            URL.revokeObjectURL(a.href);
            showStatus(t("menu_export_excel") + " ✓");
        });
    }).catch(function(e) {
        alert("Excel export error: " + e.message);
    });
}
window.exportExcel = exportExcel;

function exportPP() {
    var pp = D.vendors.map(function(v) {
        var ex = v.exposure || {};
        return {
            id: v.id, nom: v.name, type: v.sector || "Prestataire",
            dependance: Math.round(ex.dependance || 0),
            penetration: Math.round(ex.penetration || 0),
            maturite: Math.round(ex.maturite || 0),
            confiance: Math.round(ex.confiance || 0),
            measures: (v.measures || []).map(function(m) {
                return { mesure: m.mesure || "", details: m.details || "", type: m.type || "", statut: m.statut || "", responsable: m.responsable || "", echeance: m.echeance || "" };
            })
        };
    });
    var data = JSON.stringify({ pp_export: pp, source: "CISO Toolbox — Vendor TPRM" }, null, 2);
    var blob = new Blob([data], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = "tprm_pp_export.json"; a.click();
    URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════
// IMPORT FROM RISK (EBIOS RM)
// ═══════════════════════════════════════════════════════════════

function triggerImportRisk() {
    document.getElementById("risk-import-input").click();
}
window.triggerImportRisk = triggerImportRisk;

function importRiskFile(event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = JSON.parse(e.target.result);
            // Support pp_export format or full EBIOS RM file
            var ppList = data.pp_export || data.pp || [];
            if (!ppList.length) { showStatus(t("vendor.import_risk.no_pp")); return; }
            // Build measure lookup from Risk data: measures indexed by ID
            var riskMeasures = {};
            (data.measures || []).forEach(function(m) { riskMeasures[m.id] = m; });
            // Build eco lookup: PP ID → list of measure IDs (existing + complementary)
            var ecoMeasures = {};
            (data.eco || []).forEach(function(ec) {
                var ppId = (ec.pp_id || "").split(" - ")[0].trim();
                if (!ppId) return;
                var mIds = [];
                [ec.mesures_existantes, ec.mesures_complementaires].forEach(function(str) {
                    if (!str) return;
                    str.split(",").forEach(function(ref) {
                        var mId = ref.trim().split(" - ")[0].trim();
                        if (mId && riskMeasures[mId]) mIds.push(mId);
                    });
                });
                ecoMeasures[ppId] = mIds;
            });

            _saveState();
            var addedV = 0, addedR = 0, addedM = 0, skipped = 0;

            ppList.forEach(function(pp) {
                var nom = pp.nom || pp.name || "";
                var dep = pp.dependance || 0;
                var pen = pp.penetration || 0;
                var mat = pp.maturite || 0;
                var conf = pp.confiance || 0;

                // Find existing vendor or create new one
                var existing = D.vendors.find(function(v) { return v.name === nom; });
                var vendor, vid;
                if (existing) {
                    vendor = existing;
                    vid = existing.id;
                } else {
                    vid = "PP-" + String(D.vendors.length + 1).padStart(3, "0");
                    vendor = {
                        id: vid, name: nom, legal_entity: "", country: "", sector: pp.type || pp.categorie || "Prestataire",
                        website: "", siret: "", status: "active",
                        contact: { name: "", email: "" },
                        internal_contact: { name: "", email: "" },
                        contract: { start_date: "", end_date: "", review_date: "" },
                        classification: {
                            ops_impact: Math.round(dep), processes: Math.round(dep), replace_difficulty: Math.round(dep),
                            data_sensitivity: Math.round(pen), integration: Math.round(pen), regulatory_impact: Math.round(pen)
                        },
                        exposure: { dependance: dep, penetration: pen, maturite: mat, confiance: conf },
                        certifications: [], dpa_signed: false, sub_contractors: [], measures: [], notes: ""
                    };
                    D.vendors.push(vendor);
                    addedV++;
                }
                if (!vendor.measures) vendor.measures = [];

                // Import measures from pp_export format AND eco table
                var mIds = ecoMeasures[pp.id] || [];
                var ppMeasures = pp.measures || [];
                var vendorMeasureRefs = [];
                var latestDue = "";

                ppMeasures.forEach(function(m) {
                    var mid = vid + "-M" + String(addedM + 1).padStart(2, "0");
                    vendor.measures.push({
                        id: mid, mesure: m.mesure || "", details: m.details || "", type: m.type || "",
                        statut: m.statut || "a_lancer", responsable: m.responsable || "", echeance: m.echeance || ""
                    });
                    vendorMeasureRefs.push(mid + " - " + (m.mesure || "").substring(0, 40));
                    if (m.echeance && m.echeance > latestDue) latestDue = m.echeance;
                    addedM++;
                });
                mIds.forEach(function(mId) {
                    var m = riskMeasures[mId];
                    if (!m) return;
                    var mid = vid + "-M" + String(addedM + 1).padStart(2, "0");
                    vendor.measures.push({
                        id: mid, mesure: m.mesure || "", details: m.details || "", type: m.type || "",
                        statut: m.statut === "Terminé" ? "termine" : m.statut === "En cours" ? "en_cours" : "a_lancer",
                        responsable: m.responsable || "", echeance: m.echeance || ""
                    });
                    vendorMeasureRefs.push(mid + " - " + (m.mesure || "").substring(0, 40));
                    if (m.echeance && m.echeance > latestDue) latestDue = m.echeance;
                    addedM++;
                });

                // Create a global EBIOS risk for this vendor with linked measures
                var menace = (mat && conf) ? Math.round((dep * pen) / (mat * conf) * 100) / 100 : 0;
                var impact = Math.min(Math.max(Math.round(dep), 1), 5);
                var likelihood = Math.min(Math.max(Math.round(menace), 1), 5);
                var rid = vid + "-R01";
                D.risks.push({
                    id: rid, vendor_id: vid,
                    title: t("vendor.import_risk.risk_title", {name: nom}),
                    description: t("vendor.import_risk.risk_desc", {name: nom, dep: dep, pen: pen, mat: mat, conf: conf, menace: menace}),
                    category: "CYBER", impact: impact, likelihood: likelihood,
                    treatment: { response: vendorMeasureRefs.length ? "mitigate" : "accept", details: "", due_date: latestDue },
                    residual_impact: 0, residual_likelihood: 0, status: "active",
                    linked_measures: vendorMeasureRefs.join(", ")
                });
                addedR++;
            });

            _autoSave();
            renderPanel();
            showStatus(t("vendor.import_risk.success", {vendors: addedV, risks: addedR, measures: addedM, skipped: skipped}));
        } catch(err) {
            showStatus(t("vendor.import_risk.error", {msg: err.message}));
        }
    };
    reader.readAsText(file);
    event.target.value = "";
}
window.importRiskFile = importRiskFile;

// ═══════════════════════════════════════════════════════════════
// FILE MENU (save/load)
// ═══════════════════════════════════════════════════════════════

window.exportPP = exportPP;

// saveJSON and openFile are provided by cisotoolbox.js (with AES-256 encryption)

function _importPP(ppList) {
    ppList.forEach(function(pp) {
        var exists = D.vendors.find(function(v) { return v.id === pp.id; });
        if (!exists) {
            D.vendors.push({
                id: pp.id, name: pp.nom, sector: pp.type || "", status: "active",
                classification: { gdpr_subprocessor: false },
                exposure: {
                    dependance: pp.dependance || 0, penetration: pp.penetration || 0,
                    maturite: pp.maturite || 0, confiance: pp.confiance || 0
                },
                contact: {}, internal_contact: {}, contract: {}, certifications: [],
                measures: [],
                notes: "Importe depuis EBIOS RM\nDependance: " + (pp.dependance || "-") + " | Penetration: " + (pp.penetration || "-") + " | Maturite: " + (pp.maturite || "-") + " | Confiance: " + (pp.confiance || "-")
            });
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function _getTier(v) {
    var ex = v.exposure || {};
    var menace = _computeExposure(ex);
    if (menace >= 4) return "critical";
    if (menace >= 2) return "high";
    if (menace >= 1) return "medium";
    return "low";
}

function _scoreToMaturite(score) {
    return score >= 80 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : score >= 20 ? 1 : 0;
}

function _getQuestions(v) {
    // Use custom questionnaire if defined, otherwise default + DORA
    if (D._custom_questionnaire && D._custom_questionnaire.length > 0) {
        return D._custom_questionnaire;
    }
    return TPRM_QUESTIONS.concat(v && _isDoraICTCritical(v.classification) ? TPRM_DORA_QUESTIONS : []);
}

function _verifyAndAddDoc(vendorId, doc) {
    // Verify URL server-side (HEAD request, no CORS issues, real HTTP status)
    if (typeof VendorAPI !== "undefined" && VendorAPI.verifyUrl) {
        VendorAPI.verifyUrl(doc.url).then(function(result) {
            if (!result.reachable) return;
            var alreadyExists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === vendorId; });
            if (alreadyExists) return;
            D.documents.push({
                id: "DOC-" + String(D.documents.length + 1).padStart(3, "0"),
                vendor_id: vendorId,
                name: doc.name,
                type: doc.type || "other",
                url: doc.url,
                expiry_date: "",
                source: "ai",
                verified: true
            });
            if (typeof _autoSave === "function") _autoSave();
        }).catch(function() {});
    } else {
        // Fallback: no-cors fetch for opensource version
        fetch(doc.url, { method: "GET", mode: "no-cors", redirect: "follow" }).then(function() {
            var alreadyExists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === vendorId; });
            if (alreadyExists) return;
            D.documents.push({
                id: "DOC-" + String(D.documents.length + 1).padStart(3, "0"),
                vendor_id: vendorId,
                name: doc.name,
                type: doc.type || "other",
                url: doc.url,
                expiry_date: "",
                source: "ai",
                verified: true
            });
            if (typeof _autoSave === "function") _autoSave();
        }).catch(function() {});
    }
}

function _fetchLogo() {
    if (_selectedVendor === null) return;
    var v = D.vendors[_selectedVendor];
    if (!v) return;
    var urlEl = document.getElementById("v-logo-url");
    var url = urlEl ? urlEl.value.trim() : "";
    if (!url) return;

    showStatus(t("vendor.logo_loading"));
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = function() {
        // Resize to max 64x64 and convert to base64
        var canvas = document.createElement("canvas");
        var size = 64;
        var w = img.width, h = img.height;
        if (w > h) { canvas.width = size; canvas.height = Math.round(h * size / w); }
        else { canvas.height = size; canvas.width = Math.round(w * size / h); }
        var ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        v.logo = canvas.toDataURL("image/png");
        _autoSave();
        renderPanel();
        showStatus(t("vendor.logo_saved"));
    };
    img.onerror = function() {
        showStatus(t("vendor.logo_error"));
    };
    img.src = url;
}
window._fetchLogo = _fetchLogo;

function _vendorInitials(name) {
    if (!name) return "?";
    var words = name.trim().split(/\s+/);
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
}

function _vendorAvatar(v) {
    var initials = _vendorInitials(v.name);
    if (v.logo) {
        return '<img class="vendor-logo-img" src="' + esc(v.logo) + '" data-initials="' + esc(initials) + '" alt="">';
    }
    return '<span class="vendor-initials">' + esc(initials) + '</span>';
}

function _vendorName(id) {
    var v = D.vendors.find(function(x) { return x.id === id; });
    return v ? v.name : id;
}

function _scoreClass(score) {
    if (score >= 16) return "score-critical";
    if (score >= 10) return "score-high";
    if (score >= 5) return "score-medium";
    return "score-low";
}

function _scoreColorClass(pct) {
    if (pct >= 80) return "score-low";
    if (pct >= 60) return "score-medium";
    if (pct >= 40) return "score-high";
    return "score-critical";
}

function _field(labelKey, id, value, type) {
    return '<div class="form-row"><label>' + t(labelKey) + '</label><input type="' + (type || "text") + '" id="' + id + '" value="' + esc(value || "") + '" data-input="_autoSaveVendorField"></div>';
}

function _select(labelKey, id, value, options) {
    var h = '<div class="form-row"><label>' + t(labelKey) + '</label><select id="' + id + '" data-change="_autoSaveVendorField">';
    options.forEach(function(o) {
        h += '<option value="' + o[0] + '"' + (value === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    });
    h += '</select></div>';
    return h;
}

function _showModal(content) {
    var existing = document.getElementById("tprm-modal");
    if (existing) existing.remove();
    var bg = document.createElement("div");
    bg.id = "tprm-modal";
    bg.className = "pwd-overlay";
    bg.style.display = "flex";
    bg.innerHTML = '<div class="pwd-panel" style="max-width:460px;width:90%">' + content + '</div>';
    bg.onclick = function(e) { if (e.target === bg) closeModal(); };
    document.body.appendChild(bg);
}

function closeModal() {
    var m = document.getElementById("tprm-modal");
    if (m) m.remove();
}
window.closeModal = closeModal;


// ═══════════════════════════════════════════════════════════════
// SETTINGS (placeholder — uses shared ai_common.js pattern)
// ═══════════════════════════════════════════════════════════════

// openSettings is provided by ai_common.js (loaded after this file)

function _isDoraEnabled() {
    return localStorage.getItem("tprm_dora_enabled") !== "false";
}

function _getDoraThresholds() {
    return {
        maxCriteria: parseInt(localStorage.getItem("tprm_dora_max_criteria")) || 3,
        avgScore: parseFloat(localStorage.getItem("tprm_dora_avg_score")) || 3.5
    };
}

function _doraSettingsHTML() {
    var th = _getDoraThresholds();
    var doraOn = _isDoraEnabled();
    return '<div class="settings-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">' +
        '<div class="settings-label">' + t("settings.dora_section") + '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">' +
            '<label class="settings-toggle"><input type="checkbox" id="settings-dora-toggle"' + (doraOn ? " checked" : "") + '><span class="settings-toggle-slider"></span></label>' +
            '<span class="fs-sm">' + t("settings.dora_enable") + '</span>' +
        '</div>' +
        '<div id="settings-dora-fields" style="' + (doraOn ? '' : 'display:none') + '">' +
            '<p class="fs-xs text-muted" style="margin-bottom:8px">' + t("settings.dora_hint") + '</p>' +
            '<div style="display:flex;gap:12px">' +
                '<div style="flex:1"><div class="settings-label fs-sm" style="margin-bottom:4px">' + t("settings.dora_max_criteria") + '</div>' +
                '<input type="number" class="settings-input" id="settings-dora-criteria" value="' + th.maxCriteria + '" min="1" max="6" step="1" style="width:100%"></div>' +
                '<div style="flex:1"><div class="settings-label fs-sm" style="margin-bottom:4px">' + t("settings.dora_avg_score") + '</div>' +
                '<input type="number" class="settings-input" id="settings-dora-avg" value="' + th.avgScore + '" min="0.5" max="4" step="0.5" style="width:100%"></div>' +
            '</div>' +
        '</div>' +
    '</div>';
}

function _wireDoraSettings() {
    var toggle = document.getElementById("settings-dora-toggle");
    if (toggle) toggle.onchange = function() {
        document.getElementById("settings-dora-fields").style.display = this.checked ? "" : "none";
    };
}

function _saveDoraSettings() {
    var toggle = document.getElementById("settings-dora-toggle");
    if (toggle) localStorage.setItem("tprm_dora_enabled", toggle.checked ? "true" : "false");
    var c = document.getElementById("settings-dora-criteria");
    var a = document.getElementById("settings-dora-avg");
    if (c) localStorage.setItem("tprm_dora_max_criteria", c.value);
    if (a) localStorage.setItem("tprm_dora_avg_score", a.value);
}

// _autoSave, _loadAutoSave, newAnalysis provided by cisotoolbox.js

function _initDataAndRender(cb) {
    // Handle PP import (file opened via openFile but contains pp_export)
    if (D && D.pp_export && !D.vendors) {
        var backup = D.pp_export;
        D = JSON.parse(JSON.stringify(TPRM_INIT_DATA));
        _loadAutoSave();
        _importPP(backup);
    }
    _panel = "dashboard";
    _selectedVendor = null;
    renderAll();
    if (cb) cb();
}

// ═══════════════════════════════════════════════════════════════
// AI ASSISTANT — Auto-collect vendor information
// ═══════════════════════════════════════════════════════════════

window.AI_APP_CONFIG = {
    storagePrefix: "tprm",
    settingsExtraHTML: function() { return _doraSettingsHTML() + _customQuestionnaireHTML(); },
    onSettingsRendered: function() { _wireDoraSettings(); _wireCustomQuestionnaire(); },
    onSettingsSaved: function() { _saveDoraSettings(); renderAll(); }
};

// ── Custom questionnaire (admin only) ─────────────────────────

function _customQuestionnaireHTML() {
    // In backend mode: admin only. In opensource mode (no _currentUser): show to everyone
    if (window._currentUser && window._currentUser.role !== "admin") return "";
    if (typeof _isAdmin === "function" && !_isAdmin()) return "";
    var count = (D._custom_questionnaire || []).length;
    var h = '<div class="settings-section" style="margin-top:16px;border-top:1px solid var(--border);padding-top:16px">';
    h += '<div class="settings-label">' + t("settings.custom_questionnaire") + '</div>';
    if (count > 0) {
        h += '<p class="fs-xs" style="color:var(--green);margin-bottom:8px">\u2713 ' + t("settings.custom_questionnaire_active", {count: count}) + '</p>';
        h += '<button class="ai-btn-ignore" id="settings-clear-questionnaire" style="font-size:0.78em;margin-bottom:8px">' + t("settings.custom_questionnaire_clear") + '</button> ';
    }
    h += '<div style="display:flex;gap:6px;align-items:center">';
    h += '<input type="file" id="settings-questionnaire-file" accept=".csv,.tsv,.txt" class="settings-input" style="flex:1;font-family:inherit">';
    h += '</div>';
    h += '<p class="fs-xs text-muted" style="margin-top:4px">' + t("settings.custom_questionnaire_hint") + '</p>';
    h += '<a href="#" style="font-size:0.78em;color:var(--light-blue)" data-click="downloadQuestionnaireTemplate">' + t("settings.custom_questionnaire_template") + '</a>';
    h += '</div>';
    return h;
}

function _wireCustomQuestionnaire() {
    var fileEl = document.getElementById("settings-questionnaire-file");
    if (fileEl) fileEl.onchange = function() {
        if (!fileEl.files[0]) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            _importCustomQuestionnaire(e.target.result);
        };
        reader.readAsText(fileEl.files[0]);
    };
    var clearBtn = document.getElementById("settings-clear-questionnaire");
    if (clearBtn) clearBtn.onclick = function() {
        D._custom_questionnaire = [];
        _autoSave();
        if (typeof openSettings === "function") openSettings();
        showStatus(t("settings.custom_questionnaire_cleared"));
    };
}

function _importCustomQuestionnaire(csvText) {
    var firstLine = csvText.split("\n")[0];
    var sep = firstLine.includes("\t") ? "\t" : firstLine.includes(";") ? ";" : ",";
    var lines = csvText.split("\n").map(function(l) { return l.trim(); }).filter(Boolean);
    if (lines.length < 2) { showStatus(t("settings.custom_questionnaire_error")); return; }

    var headers = lines[0].split(sep).map(function(h) { return h.trim().toLowerCase().replace(/^["']|["']$/g, ""); });
    var idIdx = headers.indexOf("id");
    var domainIdx = headers.indexOf("domain");
    if (domainIdx < 0) domainIdx = headers.indexOf("domaine");
    var textIdx = headers.indexOf("question");
    if (textIdx < 0) textIdx = headers.indexOf("text");
    var expectedIdx = headers.indexOf("expected");
    if (expectedIdx < 0) expectedIdx = headers.indexOf("attendu");
    var redIdx = headers.indexOf("red_flags");
    if (redIdx < 0) redIdx = headers.indexOf("alertes");
    var evidenceIdx = headers.indexOf("evidence");
    if (evidenceIdx < 0) evidenceIdx = headers.indexOf("preuves");
    var weightIdx = headers.indexOf("weight");
    if (weightIdx < 0) weightIdx = headers.indexOf("poids");

    if (textIdx < 0) { showStatus(t("settings.custom_questionnaire_error_col")); return; }

    var questions = [];
    for (var i = 1; i < lines.length; i++) {
        var cols = lines[i].split(sep).map(function(c) { return c.replace(/^["']|["']$/g, "").trim(); });
        if (cols.length <= textIdx || !cols[textIdx]) continue;
        questions.push({
            id: idIdx >= 0 && cols[idIdx] ? cols[idIdx] : "CQ" + String(i).padStart(2, "0"),
            domain: domainIdx >= 0 ? cols[domainIdx] : "custom",
            text_fr: cols[textIdx],
            text_en: cols[textIdx],
            expected_fr: expectedIdx >= 0 ? (cols[expectedIdx] || "") : "",
            expected_en: expectedIdx >= 0 ? (cols[expectedIdx] || "") : "",
            red_flags_fr: redIdx >= 0 ? (cols[redIdx] || "") : "",
            red_flags_en: redIdx >= 0 ? (cols[redIdx] || "") : "",
            evidence_fr: evidenceIdx >= 0 ? (cols[evidenceIdx] || "") : "",
            evidence_en: evidenceIdx >= 0 ? (cols[evidenceIdx] || "") : "",
            weight: weightIdx >= 0 ? (parseInt(cols[weightIdx]) || 10) : 10
        });
    }

    if (questions.length === 0) { showStatus(t("settings.custom_questionnaire_error")); return; }

    _saveState();
    D._custom_questionnaire = questions;
    _autoSave();
    if (typeof openSettings === "function") openSettings();
    showStatus(t("settings.custom_questionnaire_imported", {count: questions.length}));
}

function downloadQuestionnaireTemplate() {
    var header = "id;domain;question;expected;red_flags;evidence;weight";
    var ex1 = "CQ01;governance;Politique de securite (PSSI);PSSI formalisee et approuvee;Pas de PSSI;PSSI signee;15";
    var ex2 = "CQ02;access;Gestion des acces et SSO;SSO SAML/OIDC deploye;Comptes partages;Configuration SSO;10";
    var csv = header + "\n" + ex1 + "\n" + ex2 + "\n";
    var blob = new Blob(["\uFEFF" + csv], {type: "text/csv;charset=utf-8"});
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "questionnaire_template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
}
window.downloadQuestionnaireTemplate = downloadQuestionnaireTemplate;

var _AI_SYSTEM_PROMPT = "Tu es un expert en securite et gestion des risques tiers (TPRM). " +
    "On te donne le nom et/ou le site web d'un fournisseur. " +
    "Recherche et rassemble un maximum d'informations sur ce fournisseur. " +
    "Pour chaque certification ou document de conformite, fournis l'URL publique si elle existe " +
    "(page trust/security du fournisseur, portail de conformite, registre de certification). " +
    "Reponds UNIQUEMENT en JSON valide avec cette structure :\n" +
    '{\n' +
    '  "legal_entity": "nom legal complet",\n' +
    '  "country": "code pays (FR, US, DE...)",\n' +
    '  "sector": "secteur d\'activite",\n' +
    '  "website": "url du site",\n' +
    '  "services": "description des services principaux",\n' +
    '  "certifications": ["ISO 27001", "SOC 2 Type II", ...],\n' +
    '  "public_docs": [\n' +
    '    {"name": "Page Trust / Security", "url": "https://...", "type": "trust_center"},\n' +
    '    {"name": "SOC 2 Type II Report", "url": "https://...", "type": "audit_report"},\n' +
    '    {"name": "ISO 27001 Certificate", "url": "https://...", "type": "certification"},\n' +
    '    {"name": "Data Processing Agreement", "url": "https://...", "type": "dpa"},\n' +
    '    {"name": "Privacy Policy", "url": "https://...", "type": "privacy"},\n' +
    '    {"name": "Security Whitepaper", "url": "https://...", "type": "whitepaper"},\n' +
    '    {"name": "Status Page", "url": "https://...", "type": "status_page"},\n' +
    '    {"name": "Bug Bounty / Responsible Disclosure", "url": "https://...", "type": "bug_bounty"}\n' +
    '  ],\n' +
    '  "dpa_available": true/false,\n' +
    '  "data_location": "UE/US/Global",\n' +
    '  "known_incidents": "incidents de securite connus ou null",\n' +
    '  "sub_contractors": ["principaux sous-traitants connus"],\n' +
    '  "security_assessment": {\n' +
    '    "governance": "compliant/partial/non_compliant/unknown",\n' +
    '    "access_management": "...",\n' +
    '    "privileged_access": "...",\n' +
    '    "vulnerability_mgmt": "...",\n' +
    '    "dev_security": "...",\n' +
    '    "data_protection": "...",\n' +
    '    "endpoint_protection": "...",\n' +
    '    "continuity": "...",\n' +
    '    "supply_chain": "...",\n' +
    '    "audit": "..."\n' +
    '  },\n' +
    '  "risks": [\n' +
    '    {"title": "...", "category": "CYBER/OPS/FIN/COMP/STRAT/REP/GEO", "impact": 1-5, "likelihood": 1-5, "description": "..."}\n' +
    '  ],\n' +
    '  "notes": "autres informations pertinentes"\n' +
    '}\n\n' +
    "IMPORTANT pour public_docs : ne fournis QUE des URLs que tu connais reellement " +
    "(pages trust center, portails de conformite, pages security du fournisseur). " +
    "Ne fabrique pas d'URLs. Si tu ne connais pas l'URL exacte, omets l'entree. " +
    "Les types possibles sont : trust_center, audit_report, certification, dpa, privacy, whitepaper, status_page, bug_bounty.\n\n" +
    "Base-toi sur tes connaissances de cette entreprise. " +
    "Si tu ne connais pas une information, mets null ou unknown. " +
    "JSON uniquement, pas de markdown.";

function aiCollectInfo() {
    if (!_selectedVendor && _selectedVendor !== 0) return;
    var v = D.vendors[_selectedVendor];
    if (!v) return;

    var apiKey = typeof _aiGetApiKey === "function" ? _aiGetApiKey() : "";
    if (!apiKey) {
        _showModal('<h3>' + t("ai.not_configured") + '</h3><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
        return;
    }

    if (!v.name || !v.name.trim()) {
        alert(t("vendor.name") + " required");
        return;
    }

    var query = v.name;
    if (v.website) query += " (" + v.website + ")";
    if (v.sector) query += " — " + v.sector;
    if (v.contract && v.contract.services) query += " — Services: " + v.contract.services;

    // Show loading state
    _showModal('<div style="text-align:center;padding:30px"><div style="font-size:2em;margin-bottom:10px">&#129302;</div><div style="font-weight:600">' + t("ai.collecting") + '...</div><div style="font-size:0.85em;color:var(--text-muted);margin-top:6px">' + esc(v.name) + '</div></div>');

    var lang = typeof _locale !== "undefined" ? _locale : "fr";
    var systemPrompt = _AI_SYSTEM_PROMPT;
    if (lang === "en") {
        systemPrompt = systemPrompt
            .replace("Tu es un expert en securite et gestion des risques tiers (TPRM).", "You are a security and third-party risk management (TPRM) expert.")
            .replace("On te donne le nom et/ou le site web d'un fournisseur.", "You are given the name and/or website of a vendor.")
            .replace("Recherche et rassemble un maximum d'informations sur ce fournisseur.", "Research and gather as much information as possible about this vendor.")
            .replace("Reponds UNIQUEMENT en JSON valide avec cette structure", "Respond ONLY with valid JSON using this structure")
            .replace("Base-toi sur tes connaissances de cette entreprise.", "Use your knowledge of this company.")
            .replace("Si tu ne connais pas une information, mets null ou unknown.", "If you don't know something, use null or unknown.")
            .replace("JSON uniquement, pas de markdown.", "JSON only, no markdown.");
    }

    _aiCallAPI(systemPrompt, (lang === "en" ? "Vendor: " : "Fournisseur: ") + query).then(function(response) {
        closeModal();
        if (!response) {
            showStatus(t("ai.error"));
            _showModal('<h3 style="color:var(--red)">' + t("ai.error") + '</h3><p style="font-size:0.85em">La requete IA n\'a pas retourne de reponse. Verifiez la cle API dans les parametres.</p><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
            return;
        }
        try {
            var text = response.trim();
            // Strip markdown code blocks if present
            if (text.indexOf("```") >= 0) {
                var blocks = text.split("```");
                for (var b = 1; b < blocks.length; b += 2) {
                    var block = blocks[b];
                    if (block.substring(0, 4) === "json") block = block.substring(4);
                    text = block.trim();
                    break;
                }
            }
            var data = JSON.parse(text);
            _applyAiData(v, data);
            _autoSave();
            renderPanel();
            // If AI didn't find the website, ask the user and re-run
            if (!v.website && (!data.website || data.website === "null")) {
                var userWebsite = prompt(t("vendor.ai_no_website"));
                if (userWebsite && userWebsite.trim()) {
                    v.website = userWebsite.trim();
                    _autoSave();
                    renderPanel();
                    setTimeout(function() { aiCollectInfo(); }, 200);
                    return;
                }
            }
            showStatus(t("ai.collected"));
        } catch (e) {
            showStatus(t("ai.error"));
            _showModal('<h3 style="color:var(--red)">' + t("ai.error") + '</h3><p style="font-size:0.85em">' + esc(e.message) + '</p><details style="margin-top:8px"><summary style="cursor:pointer;font-size:0.82em">Reponse IA brute</summary><pre style="font-size:0.75em;max-height:200px;overflow:auto;background:var(--bg);padding:8px;border-radius:4px;margin-top:4px">' + esc(response.substring(0, 1000)) + '</pre></details><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
        }
    }).catch(function(err) {
        closeModal();
        showStatus(t("ai.error"));
        _showModal('<h3 style="color:var(--red)">' + t("ai.error") + '</h3><p style="font-size:0.85em">' + esc(String(err)) + '</p><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
    });
}
window.aiCollectInfo = aiCollectInfo;

var _DOC_TAXONOMY = [
    { type: "trust_center", label: "Trust Center / Security page" },
    { type: "certification", label: "ISO 27001 certificate" },
    { type: "certification", label: "SOC 2 Type II report" },
    { type: "certification", label: "HDS (Hebergeur de Donnees de Sante) certificate" },
    { type: "certification", label: "SecNumCloud qualification" },
    { type: "certification", label: "PCI DSS attestation" },
    { type: "certification", label: "CSA STAR listing" },
    { type: "privacy", label: "Privacy policy" },
    { type: "dpa", label: "Data Processing Agreement (DPA / GDPR)" },
    { type: "dpa", label: "Sub-processors list" },
    { type: "status_page", label: "Status page (uptime monitoring)" },
    { type: "bug_bounty", label: "Bug bounty / Responsible disclosure program" },
    { type: "bug_bounty", label: "security.txt (/.well-known/security.txt)" },
    { type: "whitepaper", label: "Security whitepaper / architecture overview" },
    { type: "audit_report", label: "Penetration test summary / third-party audit" }
];

function aiCollectDocs() {
    if (!_selectedVendor && _selectedVendor !== 0) return;
    var v = D.vendors[_selectedVendor];
    if (!v || !v.name || !v.name.trim()) return;

    var apiKey = typeof _aiGetApiKey === "function" ? _aiGetApiKey() : "";
    if (!apiKey) {
        _showModal('<h3>' + t("ai.not_configured") + '</h3><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
        return;
    }

    var existingUrls = D.documents.filter(function(d) { return d.vendor_id === v.id; }).map(function(d) { return d.url; }).filter(Boolean);
    var vendorId = v.id;

    _showModal('<div style="text-align:center;padding:30px"><div style="font-size:2em;margin-bottom:10px">&#128269;</div><div style="font-weight:600">' + t("ai.collecting_docs") + '</div><div style="font-size:0.85em;color:var(--text-muted);margin-top:6px">' + esc(v.name) + '</div><div id="doc-collect-status" style="font-size:0.78em;color:var(--text-muted);margin-top:12px"></div></div>');

    var statusEl = function() { return document.getElementById("doc-collect-status"); };
    var totalAdded = 0;

    // Phase 1: Probe common URL patterns on vendor website (fast, server-side)
    var probePromise;
    if (v.website && typeof VendorAPI !== "undefined" && VendorAPI.probeVendorUrls) {
        if (statusEl()) statusEl().textContent = t("ai.docs_phase_probe");
        probePromise = VendorAPI.probeVendorUrls(v.website).then(function(results) {
            results.forEach(function(r) {
                if (existingUrls.indexOf(r.url) >= 0) return;
                existingUrls.push(r.url);
                _verifyAndAddDoc(vendorId, { url: r.url, name: r.name, type: r.type });
                totalAdded++;
            });
        }).catch(function() {});
    } else {
        probePromise = Promise.resolve();
    }

    // Phase 2: Ask AI for specific documents (after probe, to avoid duplicates)
    probePromise.then(function() {
        if (statusEl()) statusEl().textContent = t("ai.docs_phase_ai");

        var query = v.name;
        if (v.website) query += " (" + v.website + ")";
        if (v.sector) query += " — " + v.sector;

        var docList = _DOC_TAXONOMY.map(function(d) { return "- " + d.label + " (type: " + d.type + ")"; }).join("\n");

        var systemPrompt = "You are a TPRM documentation research expert. " +
            "Your job is to find REAL, VERIFIED public URLs for vendor security documentation. " +
            "You must ONLY return URLs you are certain exist. " +
            "If you are not sure a URL exists, DO NOT include it. " +
            "An empty array is better than fabricated URLs.";

        var lang = typeof _locale !== "undefined" ? _locale : "fr";
        var userPrompt = (lang === "en" ? "Vendor: " : "Fournisseur : ") + query + "\n\n" +
            (lang === "en" ? "Find the public URLs for each of these document types:\n" : "Trouve les URLs publiques pour chacun de ces types de documents :\n") +
            docList + "\n\n" +
            (existingUrls.length ? (lang === "en" ? "Already found (do NOT repeat):\n" : "Deja trouves (NE PAS repeter) :\n") + existingUrls.join("\n") + "\n\n" : "") +
            (lang === "en"
                ? "RULES:\n" +
                  "1. Only return URLs you KNOW exist (from your training data)\n" +
                  "2. Prefer official vendor domains over third-party sources\n" +
                  "3. Common patterns: /trust, /security, /privacy, /compliance, /dpa, status.domain.com\n" +
                  "4. For certifications, link to the vendor's compliance page, NOT the certifying body\n" +
                  "5. If the vendor has no public page for a document type, omit it\n\n"
                : "REGLES :\n" +
                  "1. Ne retourne QUE des URLs que tu SAIS exister (depuis tes donnees d'entrainement)\n" +
                  "2. Privilegier les domaines officiels du fournisseur aux sources tierces\n" +
                  "3. Patterns courants : /trust, /security, /privacy, /compliance, /dpa, status.domaine.com\n" +
                  "4. Pour les certifications, lier la page compliance du fournisseur, PAS l'organisme certificateur\n" +
                  "5. Si le fournisseur n'a pas de page publique pour un type de document, ne l'inclus pas\n\n") +
            "JSON array only, no markdown:\n" +
            '[{"name": "Trust Center", "type": "trust_center", "url": "https://..."}, ...]';

        return _aiCallAPI(systemPrompt, userPrompt);
    }).then(function(response) {
        if (!response) { closeModal(); showStatus(totalAdded + " " + t("ai.docs_found")); return; }
        try {
            var text = response.trim();
            if (text.indexOf("```") >= 0) {
                var blocks = text.split("```");
                for (var b = 1; b < blocks.length; b += 2) {
                    var block = blocks[b];
                    if (block.substring(0, 4) === "json") block = block.substring(4);
                    text = block.trim();
                    break;
                }
            }
            var docs = JSON.parse(text);
            if (!Array.isArray(docs)) docs = [];
            docs.forEach(function(doc) {
                if (!doc.url || !doc.name) return;
                if (existingUrls.indexOf(doc.url) >= 0) return;
                existingUrls.push(doc.url);
                _verifyAndAddDoc(vendorId, doc);
                totalAdded++;
            });
        } catch (e) {
            showStatus("AI doc parse error: " + e.message);
        }
        closeModal();
        _autoSave();
        renderPanel();
        showStatus(totalAdded + " " + t("ai.docs_found"));
    }).catch(function(err) {
        closeModal();
        showStatus(t("ai.error"));
        _showModal('<h3 style="color:var(--red)">' + t("ai.error") + '</h3><p style="font-size:0.85em">' + esc(String(err)) + '</p><div style="margin-top:12px"><button class="btn-add" data-click="closeModal">' + t("common.close") + '</button></div>');
    });
}
window.aiCollectDocs = aiCollectDocs;

function aiAddVendor() {
    var input = prompt(t("ai.enter_vendor_name"));
    if (!input || !input.trim()) return;
    // Parse name and optional website: "AWS" or "AWS https://aws.amazon.com"
    var parts = input.trim().split(/\s+(https?:\/\/)/);
    var name = parts[0].trim();
    var website = parts.length > 2 ? parts[1] + parts[2] : "";

    var nextId = "PP-" + String(D.vendors.length + 1).padStart(3, "0");
    D.vendors.push({
        id: nextId, name: name, legal_entity: "", country: "", sector: "", website: website, siret: "",
        contact: { name: "", email: "", phone: "" },
        contract: { services: "", start_date: "", end_date: "", review_date: "" },
        classification: { gdpr_subprocessor: false },
        certifications: [], dpa_signed: false, sub_contractors: [],
        status: "prospect", notes: ""
    });
    _selectedVendor = D.vendors.length - 1;
    _vendorTab = "info";
    _panel = "vendors";
    _autoSave();
    renderPanel();
    // Trigger AI collect after a tick (DOM needs to update)
    setTimeout(aiCollectInfo, 100);
}
window.aiAddVendor = aiAddVendor;

function _applyAiData(v, data) {
    // logo_url from AI is unreliable — we use favicon from website instead
    if (data.legal_entity && !v.legal_entity) v.legal_entity = data.legal_entity;
    if (data.country && !v.country) v.country = data.country;
    if (data.sector && !v.sector) v.sector = data.sector;
    if (data.website && !v.website) v.website = data.website;
    if (data.services && (!v.contract || !v.contract.services)) {
        if (!v.contract) v.contract = {};
        v.contract.services = data.services;
    }
    if (data.certifications && data.certifications.length) {
        if (!v.certifications) v.certifications = [];
        data.certifications.forEach(function(c) {
            if (!v.certifications.find(function(x) { return x.name === c; })) {
                v.certifications.push({ name: c, expiry_date: "" });
            }
        });
    }
    if (data.dpa_available != null) v.dpa_signed = data.dpa_available;
    if (data.sub_contractors && data.sub_contractors.length) {
        v.sub_contractors = data.sub_contractors;
    }
    if (data.notes) v.notes = (v.notes ? v.notes + "\n\n" : "") + "IA: " + data.notes;
    if (data.known_incidents) v.notes = (v.notes ? v.notes + "\n\n" : "") + "Incidents connus: " + data.known_incidents;
    if (data.data_location) v.notes = (v.notes ? v.notes + "\n\n" : "") + "Localisation des donnees: " + data.data_location;

    // Public documentation links → verify each URL then add to documents
    if (data.public_docs && data.public_docs.length) {
        data.public_docs.forEach(function(doc) {
            if (!doc.url || !doc.name) return;
            var exists = D.documents.find(function(d) { return d.url === doc.url && d.vendor_id === v.id; });
            if (exists) return;
            // Verify URL exists with a HEAD request
            _verifyAndAddDoc(v.id, doc);
        });
    }

    // Pre-fill security assessment as questionnaire responses
    if (data.security_assessment) {
        var domainToQuestion = {
            governance: "Q01", access_management: "Q02", privileged_access: "Q03",
            vulnerability_mgmt: "Q04", dev_security: "Q05", data_protection: "Q06",
            endpoint_protection: "Q07", continuity: "Q08", supply_chain: "Q09", audit: "Q10"
        };
        // Find or create an assessment
        var assessment = D.assessments.find(function(a) { return a.vendor_id === v.id && a.status !== "completed"; });
        if (!assessment) {
            var assessId = "EVAL-" + String(D.assessments.length + 1).padStart(3, "0");
            assessment = { id: assessId, vendor_id: v.id, type: "onboarding", date: new Date().toISOString().split("T")[0], status: "in_progress", responses: [], score: null, completion_rate: 0 };
            D.assessments.push(assessment);
        }
        for (var domain in data.security_assessment) {
            var qId = domainToQuestion[domain];
            if (!qId) continue;
            var answer = data.security_assessment[domain];
            if (answer === "unknown") continue;
            var existing = assessment.responses.find(function(r) { return r.question_id === qId; });
            if (!existing) {
                assessment.responses.push({ question_id: qId, answer: answer, comment: "IA: auto-evaluation" });
            }
        }
    }

    // Create risks from AI suggestions
    if (data.risks && data.risks.length) {
        data.risks.forEach(function(r) {
            var riskCount = D.risks.filter(function(x) { return x.vendor_id === v.id; }).length;
            D.risks.push({
                id: v.id + "-R" + String(riskCount + 1).padStart(2, "0"),
                vendor_id: v.id, title: r.title, description: r.description || "",
                category: r.category || "CYBER",
                impact: r.impact || 3, likelihood: r.likelihood || 3,
                treatment: { response: "mitigate", details: "", due_date: "" },
                residual_impact: 0, residual_likelihood: 0,
                status: "needs_treatment"
            });
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// IMPORT PP FROM EBIOS RM
// ═══════════════════════════════════════════════════════════════

function importPPFromRisk() {
    var fi = document.createElement("input");
    fi.type = "file"; fi.accept = ".json";
    fi.onchange = function() {
        if (!fi.files[0]) return;
        var reader = new FileReader();
        reader.onload = function(e) {
            try {
                var data = JSON.parse(e.target.result);
                var imported = 0;
                // Support both pp_export format and full EBIOS RM data
                var ppList = data.pp_export || data.pp || [];
                // Also look for PP in EBIOS RM full format (atelier 3)
                if (!ppList.length && data.srov) {
                    // Extract unique PP from scenarios
                }
                if (!ppList.length && data.parties_prenantes) {
                    ppList = data.parties_prenantes;
                }
                ppList.forEach(function(pp) {
                    var exists = D.vendors.find(function(v) { return v.id === pp.id || v.name === pp.nom; });
                    if (exists) return;
                    D.vendors.push({
                        id: pp.id || "PP-" + String(D.vendors.length + 1).padStart(3, "0"),
                        name: pp.nom || pp.name || "",
                        sector: pp.type || "",
                        status: "active",
                        classification: { gdpr_subprocessor: false },
                        exposure: {
                            dependance: pp.dependance || 0, penetration: pp.penetration || 0,
                            maturite: pp.maturite || 0, confiance: pp.confiance || 0
                        },
                        contact: {}, internal_contact: {}, contract: {}, certifications: [], measures: [],
                        notes: "Importe depuis EBIOS RM\nDependance: " + (pp.dependance || "-") + " | Penetration: " + (pp.penetration || "-") + " | Maturite: " + (pp.maturite || "-") + " | Confiance: " + (pp.confiance || "-")
                    });
                    imported++;
                });
                _autoSave();
                showStatus(t("pp.imported", { count: imported }));
                selectPanel("vendors");
            } catch (err) { alert("Invalid JSON: " + err.message); }
        };
        reader.readAsText(fi.files[0]);
    };
    fi.click();
}
window.importPPFromRisk = importPPFromRisk;

// ═══════════════════════════════════════════════════════════════
// HELP
// ═══════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

function renderAll() {
    var tr = document.getElementById("toolbar-right");
    if (tr) tr.innerHTML = _getSettingsButtonHTML();
    _applyStaticTranslations();
    renderPanel();
}

// Init: if catalog is present, defer to _appInitCallback; otherwise render directly
window.selectPanel = selectPanel;
if (typeof window._appInitCallback === "function") {
    window._appInitCallback();
} else {
    renderAll();
    _checkAutoSaveBanner();
}
