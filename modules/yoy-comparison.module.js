/**
 * Year-over-Year Comparison Module
 * Lets the user paste a 2025 baseline (full-year stats) and compare it
 * against the current year's best-available data, per employee, per metric.
 * Shows who increased, who dropped, and by how much — in a sortable table
 * with an optional 2025 column.
 */
(function () {
    'use strict';

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var BASELINE_KEY = STORAGE_PREFIX + 'yoyBaseline2025';
    var BASELINE_YEAR = 2025;
    var BASELINE_START = '2025-01-01';
    var BASELINE_END = '2025-12-31';

    // ── Metrics offered in the comparison dropdown (in display order) ──
    var COMPARE_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions',
        'transfers', 'transfersCount', 'aht', 'acw', 'holdTime', 'reliability', 'totalCalls'
    ];

    // ── Module state ──
    var _selectedMetric = 'scheduleAdherence';
    var _show2025 = true;
    var _myTeamOnly = false;
    var _viewMode = 'single'; // 'single' (one metric, change cols) | 'allKpis' (rankings-style side-by-side)
    var _sort = { key: 'improvement', dir: 'desc' };
    var _allKpiSort = { key: 'name', dir: 'asc' };

    // ── Small helpers ──
    function _escapeHtml(str) {
        var mod = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        if (mod && mod.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _formatMetricDisplay(key, value) {
        if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) return '--';
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    function _metricMeta(key) {
        var reg = window.METRICS_REGISTRY || {};
        return reg[key] || { key: key, label: key, icon: '', isReverse: false, unit: '' };
    }
    function _isReverse(key) {
        return typeof window.isReverseMetric === 'function' ? window.isReverseMetric(key) : false;
    }
    function _getYtdData() { return typeof ytdData !== 'undefined' ? ytdData : {}; }
    function _getWeeklyData() { return typeof weeklyData !== 'undefined' ? weeklyData : {}; }

    function _num(v) {
        var n = parseFloat(v);
        return isNaN(n) ? null : n;
    }

    // Is there a team selection to filter by? (controls whether the checkbox
    // can do anything — if no team is selected, "my team only" would be empty.)
    function _teamFilterContext() {
        var tf = window.DevCoachModules && window.DevCoachModules.teamFilter;
        if (!tf || !tf.getTeamSelectionContext) return null;
        try { return tf.getTeamSelectionContext(); } catch (_e) { return null; }
    }
    function _inMyTeam(name, ctx) {
        var tf = window.DevCoachModules && window.DevCoachModules.teamFilter;
        if (!tf || !tf.isAssociateIncludedByTeamFilter) return true;
        return tf.isAssociateIncludedByTeamFilter(name, ctx);
    }

    // ── Baseline (2025) storage ──
    function _loadBaseline() {
        try {
            var raw = localStorage.getItem(BASELINE_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !Array.isArray(parsed.employees)) return null;
            return parsed;
        } catch (_e) { return null; }
    }

    function _saveBaseline(employees) {
        var payload = {
            employees: employees,
            metadata: {
                year: BASELINE_YEAR,
                startDate: BASELINE_START,
                endDate: BASELINE_END,
                count: employees.length
            }
        };
        try {
            localStorage.setItem(BASELINE_KEY, JSON.stringify(payload));
            return true;
        } catch (_e) {
            return false;
        }
    }

    function _clearBaseline() {
        try { localStorage.removeItem(BASELINE_KEY); } catch (_e) { /* ignore */ }
    }

    // ── Current-year data: newest real YTD for the current year, else newest
    //    weekly upload with the most employees, else best of anything. Mirrors
    //    the "one period, no merging" approach used by Center Rankings. ──
    function _getCurrentYearData() {
        var currentYear = new Date().getFullYear();
        var yData = _getYtdData();
        var wData = _getWeeklyData();

        function endYearOf(key, meta) {
            var endStr = (meta && meta.endDate) || (key.indexOf('|') >= 0 ? key.split('|')[1] : '');
            return parseInt(String(endStr).split('-')[0], 10);
        }

        var best = null, bestTime = -1, bestLabel = '';

        // Prefer real (non-auto) YTD for the current year.
        Object.keys(yData).forEach(function (key) {
            var d = yData[key];
            var meta = (d && d.metadata) || {};
            if (meta.autoGeneratedYtd) return;
            if (endYearOf(key, meta) !== currentYear) return;
            var count = (d && d.employees ? d.employees.length : 0);
            if (count < 2) return;
            var t = meta.uploadedAt ? new Date(meta.uploadedAt).getTime() : 0;
            if (t > bestTime) {
                best = d; bestTime = t; bestLabel = meta.label || ('YTD through ' + (meta.endDate || ''));
            }
        });

        // Fall back to the largest current-year weekly/custom upload.
        if (!best) {
            var bestCount = -1;
            Object.keys(wData).forEach(function (key) {
                var d = wData[key];
                var meta = (d && d.metadata) || {};
                if (endYearOf(key, meta) !== currentYear) return;
                var count = (d && d.employees ? d.employees.length : 0);
                if (count < 2) return;
                if (count > bestCount) {
                    bestCount = count; best = d; bestLabel = meta.label || key;
                }
            });
        }

        if (!best) return null;
        return { employees: best.employees || [], label: bestLabel, year: currentYear };
    }

    // ── Build comparison rows: match 2025 baseline to current data by name ──
    function _buildRows(metricKey) {
        var baseline = _loadBaseline();
        var current = _getCurrentYearData();
        if (!baseline || !current) return null;

        var priorByName = {};
        baseline.employees.forEach(function (e) {
            if (e && e.name) priorByName[e.name] = e;
        });

        var reverse = _isReverse(metricKey);
        var teamCtx = _myTeamOnly ? _teamFilterContext() : null;
        var rows = [];

        current.employees.forEach(function (cur) {
            if (!cur || !cur.name) return;
            if (_myTeamOnly && !_inMyTeam(cur.name, teamCtx)) return;
            var prior = priorByName[cur.name];
            if (!prior) return; // only show reps present in BOTH years

            var priorVal = _num(prior[metricKey]);
            var curVal = _num(cur[metricKey]);
            if (priorVal === null && curVal === null) return;

            var delta = (priorVal !== null && curVal !== null) ? (curVal - priorVal) : null;
            var pct = (delta !== null && priorVal !== null && priorVal !== 0)
                ? (delta / Math.abs(priorVal)) * 100 : null;
            // Signed improvement: positive = moved the right direction for this metric.
            var improvement = (delta === null) ? null : (reverse ? -delta : delta);

            rows.push({
                name: cur.name,
                prior: priorVal,
                current: curVal,
                delta: delta,
                pct: pct,
                improvement: improvement
            });
        });

        return {
            rows: rows,
            currentLabel: current.label,
            priorCount: baseline.employees.length,
            matched: rows.length
        };
    }

    // ── Render ──
    function renderYoYComparison() {
        var container = document.getElementById('subSectionTaYoY');
        if (!container) return;

        var baseline = _loadBaseline();
        var html = '';

        // Header
        html += '<div style="margin-bottom: 16px; padding: 15px; background: #ede7f6; border-radius: 8px; border-left: 4px solid #5e35b1;">';
        html += '<strong>📊 Year-over-Year</strong> &mdash; compare 2025 vs ' + new Date().getFullYear() + ' per rep.';
        html += '<br><span style="color: #666; font-size: 0.85em;">Plug in your 2025 full-year numbers below, then pick a metric to see who climbed and who slipped.</span>';
        html += '</div>';

        // ── 2025 baseline input panel ──
        html += '<div style="margin-bottom: 18px; padding: 14px; background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        if (baseline) {
            html += '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">';
            html += '<span style="font-weight:600; color:#2e7d32;">✓ 2025 baseline loaded</span>';
            html += '<span style="color:#666; font-size:0.9em;">' + baseline.employees.length + ' employees</span>';
            html += '<button type="button" id="yoyToggleInput" class="btn-secondary" style="font-size:0.85em; padding:5px 12px;">Replace data</button>';
            html += '<button type="button" id="yoyClearBaseline" class="btn-secondary" style="background:#c62828; color:#fff; font-size:0.85em; padding:5px 12px;">Clear</button>';
            html += '</div>';
            html += '<div id="yoyInputArea" style="display:none; margin-top:12px;">';
        } else {
            html += '<div style="font-weight:600; margin-bottom:8px;">Plug in 2025 stats</div>';
            html += '<div id="yoyInputArea">';
        }
        html += '<p style="margin:0 0 8px 0; color:#666; font-size:0.85em;">Paste your 2025 full-year data (include the header row with <strong>Name</strong>) — same format as a YTD upload.</p>';
        html += '<textarea id="yoyPasteBox" rows="6" style="width:100%; box-sizing:border-box; font-family:monospace; font-size:0.82em; padding:8px; border:1px solid #ccc; border-radius:6px;" placeholder="Name&#9;Total Calls&#9;..."></textarea>';
        html += '<div style="margin-top:8px; display:flex; gap:10px; align-items:center; flex-wrap:wrap;">';
        html += '<button type="button" id="yoySaveBaseline" class="btn-primary" style="padding:6px 16px;">Save 2025 Baseline</button>';
        html += '<span id="yoyParseStatus" style="font-size:0.85em; color:#c62828;"></span>';
        html += '</div>';
        html += '</div>'; // input area
        html += '</div>'; // panel

        container.innerHTML = html;
        _bindInputPanel();

        if (!baseline) return; // nothing to compare yet

        // ── Controls + table ──
        var controls = document.createElement('div');
        controls.id = 'yoyControlsWrap';
        container.appendChild(controls);
        _renderControlsAndTable();
    }

    function _bindInputPanel() {
        var toggle = document.getElementById('yoyToggleInput');
        if (toggle) {
            toggle.addEventListener('click', function () {
                var area = document.getElementById('yoyInputArea');
                if (area) area.style.display = (area.style.display === 'none') ? 'block' : 'none';
            });
        }
        var clearBtn = document.getElementById('yoyClearBaseline');
        if (clearBtn) {
            clearBtn.addEventListener('click', function () {
                if (!window.confirm('Clear the 2025 baseline? You will need to paste it again to compare.')) return;
                _clearBaseline();
                renderYoYComparison();
            });
        }
        var saveBtn = document.getElementById('yoySaveBaseline');
        if (saveBtn) {
            saveBtn.addEventListener('click', _onSaveBaseline);
        }
    }

    function _onSaveBaseline() {
        var box = document.getElementById('yoyPasteBox');
        var status = document.getElementById('yoyParseStatus');
        if (!box) return;
        var text = box.value || '';
        if (!text.trim()) {
            if (status) { status.style.color = '#c62828'; status.textContent = 'Paste your 2025 data first.'; }
            return;
        }
        var parser = window.DevCoachModules && window.DevCoachModules.dataParsing;
        if (!parser || !parser.parsePastedData) {
            if (status) { status.style.color = '#c62828'; status.textContent = 'Parser unavailable — reload the page and try again.'; }
            return;
        }
        var employees;
        try {
            employees = parser.parsePastedData(text, BASELINE_START, BASELINE_END);
        } catch (err) {
            if (status) { status.style.color = '#c62828'; status.textContent = (err && err.message) ? err.message : 'Could not parse that data.'; }
            return;
        }
        if (!employees || !employees.length) {
            if (status) { status.style.color = '#c62828'; status.textContent = 'No employee rows found in that paste.'; }
            return;
        }
        if (!_saveBaseline(employees)) {
            if (status) { status.style.color = '#c62828'; status.textContent = 'Could not save (storage full?).'; }
            return;
        }
        renderYoYComparison();
    }

    function _renderControlsAndTable() {
        var wrap = document.getElementById('yoyControlsWrap');
        if (!wrap) return;

        var reg = window.METRICS_REGISTRY || {};
        var available = COMPARE_METRICS.filter(function (k) { return reg[k]; });
        if (available.indexOf(_selectedMetric) < 0) _selectedMetric = available[0] || 'scheduleAdherence';

        var html = '<div style="margin-bottom:14px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">';
        html += '<label style="font-weight:600; color:#555; font-size:0.9em;">View:</label>';
        html += '<select id="yoyViewSelect" style="padding:6px 10px; border:1px solid #ccc; border-radius:6px; font-size:0.9em;">';
        html += '<option value="single"' + (_viewMode === 'single' ? ' selected' : '') + '>Single metric</option>';
        html += '<option value="allKpis"' + (_viewMode === 'allKpis' ? ' selected' : '') + '>All KPIs side-by-side</option>';
        html += '</select>';
        var metricDisp = (_viewMode === 'single') ? '' : ' style="display:none;"';
        html += '<span id="yoyMetricControl"' + metricDisp + '>';
        html += '<label style="font-weight:600; color:#555; font-size:0.9em; margin-right:8px;">Metric:</label>';
        html += '<select id="yoyMetricSelect" style="padding:6px 10px; border:1px solid #ccc; border-radius:6px; font-size:0.9em; min-width:220px;">';
        available.forEach(function (k) {
            var m = _metricMeta(k);
            var sel = (k === _selectedMetric) ? ' selected' : '';
            html += '<option value="' + _escapeHtml(k) + '"' + sel + '>' + _escapeHtml((m.icon ? m.icon + ' ' : '') + m.label) + '</option>';
        });
        html += '</select></span>';
        html += '<label style="font-size:0.9em; color:#555; cursor:pointer; user-select:none;">';
        html += '<input type="checkbox" id="yoyMyTeam"' + (_myTeamOnly ? ' checked' : '') + ' style="vertical-align:middle; margin-right:5px;">My team only';
        html += '</label>';
        html += '<label style="font-size:0.9em; color:#555; cursor:pointer; user-select:none;">';
        html += '<input type="checkbox" id="yoyShow2025"' + (_show2025 ? ' checked' : '') + ' style="vertical-align:middle; margin-right:5px;">Show 2025 numbers';
        html += '</label>';
        html += '<button type="button" id="yoySummaryBtn" class="btn-primary" style="margin-left:auto; padding:6px 14px;">📋 Summarize for my leader</button>';
        html += '</div>';
        html += '<div id="yoyTableWrap"></div>';

        wrap.innerHTML = html;

        var viewSel = document.getElementById('yoyViewSelect');
        if (viewSel) viewSel.addEventListener('change', function () {
            _viewMode = viewSel.value;
            var mc = document.getElementById('yoyMetricControl');
            if (mc) mc.style.display = (_viewMode === 'single') ? '' : 'none';
            _renderTable();
        });
        var sel = document.getElementById('yoyMetricSelect');
        if (sel) sel.addEventListener('change', function () {
            _selectedMetric = sel.value;
            _renderTable();
        });
        var chk = document.getElementById('yoyShow2025');
        if (chk) chk.addEventListener('change', function () {
            _show2025 = chk.checked;
            _renderTable();
        });
        var teamChk = document.getElementById('yoyMyTeam');
        if (teamChk) teamChk.addEventListener('change', function () {
            _myTeamOnly = teamChk.checked;
            _renderTable();
        });
        var sumBtn = document.getElementById('yoySummaryBtn');
        if (sumBtn) sumBtn.addEventListener('click', _showSummaryModal);

        _renderTable();
    }

    function _renderTable() {
        if (_viewMode === 'allKpis') { _renderAllKpiTable(); return; }
        var wrap = document.getElementById('yoyTableWrap');
        if (!wrap) return;

        var data = _buildRows(_selectedMetric);
        if (!data) {
            wrap.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:30px;">Upload current-year data to compare against your 2025 baseline.</p>';
            return;
        }
        if (!data.rows.length) {
            wrap.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:30px;">No matching employees between 2025 and ' + new Date().getFullYear() + '. Names must match across both data sets.</p>';
            return;
        }

        var metric = _metricMeta(_selectedMetric);
        var reverse = _isReverse(_selectedMetric);

        // Summary counts (only rows with a real delta)
        var improved = 0, declined = 0, flat = 0;
        data.rows.forEach(function (r) {
            if (r.improvement === null) return;
            if (r.improvement > 1e-9) improved++;
            else if (r.improvement < -1e-9) declined++;
            else flat++;
        });

        var html = '';
        html += '<div style="margin-bottom:12px; padding:10px 14px; background:#f5f5f5; border-radius:8px; font-size:0.9em;">';
        html += '<strong>' + _escapeHtml(metric.label) + '</strong> &mdash; ';
        html += '<span style="color:#2e7d32; font-weight:600;">▲ ' + improved + ' improved</span> · ';
        html += '<span style="color:#c62828; font-weight:600;">▼ ' + declined + ' declined</span> · ';
        html += '<span style="color:#777;">' + flat + ' flat</span>';
        html += '<span style="color:#999; font-size:0.85em;"> &nbsp;|&nbsp; ' + data.matched + ' reps matched · ' + _escapeHtml(data.currentLabel) + '</span>';
        if (_myTeamOnly) {
            var ctx = _teamFilterContext();
            if (!ctx || !ctx.isFiltering) {
                html += '<br><span style="color:#e65100; font-size:0.8em;">⚠ "My team only" is on, but no team is selected — showing everyone. Pick your team via the team filter to narrow this.</span>';
            }
        }
        html += reverse ? '<br><span style="color:#999; font-size:0.8em;">Lower is better for this metric — a drop counts as an improvement.</span>' : '';
        html += '</div>';

        // Sort
        var sorted = _sortRows(data.rows.slice());

        var thBase = 'padding:8px 6px; border-bottom:2px solid #ddd; cursor:pointer; user-select:none; font-size:0.85em;';
        function arrow(key) {
            if (key !== _sort.key) return ' <span style="opacity:0.3;">&#8597;</span>';
            return _sort.dir === 'asc' ? ' <span style="color:#5e35b1;">&#9650;</span>' : ' <span style="color:#5e35b1;">&#9660;</span>';
        }

        html += '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.88em;">';
        html += '<thead><tr style="background:#f5f5f5;">';
        html += '<th class="yoy-sort" data-sort="name" style="' + thBase + ' text-align:left;">Name' + arrow('name') + '</th>';
        if (_show2025) html += '<th class="yoy-sort" data-sort="prior" style="' + thBase + ' text-align:right;">2025' + arrow('prior') + '</th>';
        html += '<th class="yoy-sort" data-sort="current" style="' + thBase + ' text-align:right;">' + new Date().getFullYear() + arrow('current') + '</th>';
        html += '<th class="yoy-sort" data-sort="delta" style="' + thBase + ' text-align:right;">Change' + arrow('delta') + '</th>';
        html += '<th class="yoy-sort" data-sort="pct" style="' + thBase + ' text-align:right;">% Change' + arrow('pct') + '</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(function (r, idx) {
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            var bg = idx % 2 === 0 ? (isDark ? '#1a1f2e' : '#fafafa') : 'transparent';
            html += '<tr style="background:' + bg + '; border-bottom:1px solid #eee;">';
            html += '<td style="padding:6px; white-space:nowrap;">' + _escapeHtml(r.name) + '</td>';
            if (_show2025) html += '<td style="padding:6px; text-align:right; color:#777;">' + _formatMetricDisplay(_selectedMetric, r.prior) + '</td>';
            html += '<td style="padding:6px; text-align:right; font-weight:600;">' + _formatMetricDisplay(_selectedMetric, r.current) + '</td>';

            // Change cell — colored by improvement direction
            var changeCell = '--', pctCell = '--';
            if (r.delta !== null) {
                var good = r.improvement > 1e-9, bad = r.improvement < -1e-9;
                var color = good ? '#2e7d32' : bad ? '#c62828' : '#777';
                var sign = r.delta > 0 ? '+' : '';
                var icon = good ? '▲ ' : bad ? '▼ ' : '';
                var deltaDisp = _formatDelta(_selectedMetric, r.delta);
                changeCell = '<span style="color:' + color + '; font-weight:600;">' + icon + sign + deltaDisp + '</span>';
                if (r.pct !== null) {
                    var pctSign = r.pct > 0 ? '+' : '';
                    pctCell = '<span style="color:' + color + ';">' + pctSign + r.pct.toFixed(1) + '%</span>';
                }
            }
            html += '<td style="padding:6px; text-align:right;">' + changeCell + '</td>';
            html += '<td style="padding:6px; text-align:right;">' + pctCell + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        wrap.innerHTML = html;

        wrap.querySelectorAll('.yoy-sort').forEach(function (th) {
            th.addEventListener('click', function () {
                var key = th.dataset.sort;
                if (_sort.key === key) {
                    _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    _sort.key = key;
                    // Text sorts ascending by default; numeric sorts descending.
                    _sort.dir = (key === 'name') ? 'asc' : 'desc';
                }
                _renderTable();
            });
        });
    }

    // ── All-KPIs side-by-side (rankings-style): one row per rep, one column
    //    per KPI, each cell showing 2026 value with the 2025 value + delta. ──
    function _buildAllKpiRows() {
        var baseline = _loadBaseline();
        var current = _getCurrentYearData();
        if (!baseline || !current) return null;

        var priorByName = {};
        baseline.employees.forEach(function (e) { if (e && e.name) priorByName[e.name] = e; });

        var teamCtx = _myTeamOnly ? _teamFilterContext() : null;
        var reg = window.METRICS_REGISTRY || {};
        var metrics = COMPARE_METRICS.filter(function (k) { return reg[k]; });
        var rows = [];

        current.employees.forEach(function (cur) {
            if (!cur || !cur.name) return;
            if (_myTeamOnly && !_inMyTeam(cur.name, teamCtx)) return;
            var prior = priorByName[cur.name];
            if (!prior) return;

            var cells = {};
            metrics.forEach(function (k) {
                var pv = _num(prior[k]), cv = _num(cur[k]);
                var delta = (pv !== null && cv !== null) ? (cv - pv) : null;
                var pct = (delta !== null && pv !== null && pv !== 0) ? (delta / Math.abs(pv)) * 100 : null;
                var improvement = (delta === null) ? null : (_isReverse(k) ? -delta : delta);
                cells[k] = { prior: pv, current: cv, delta: delta, pct: pct, improvement: improvement };
            });
            rows.push({ name: cur.name, metrics: cells });
        });

        return { rows: rows, metrics: metrics, currentLabel: current.label, matched: rows.length };
    }

    function _renderAllKpiTable() {
        var wrap = document.getElementById('yoyTableWrap');
        if (!wrap) return;

        var data = _buildAllKpiRows();
        if (!data) {
            wrap.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:30px;">Upload current-year data to compare against your 2025 baseline.</p>';
            return;
        }
        if (!data.rows.length) {
            wrap.innerHTML = '<p style="color:#94a3b8; text-align:center; padding:30px;">No matching employees between 2025 and ' + new Date().getFullYear() + '. Names must match across both data sets.</p>';
            return;
        }

        // Sort
        var sk = _allKpiSort.key, sd = _allKpiSort.dir;
        var sorted = data.rows.slice().sort(function (a, b) {
            if (sk === 'name') {
                var c = String(a.name).localeCompare(String(b.name));
                return sd === 'asc' ? c : -c;
            }
            var nl = sd === 'asc' ? Infinity : -Infinity;
            var av = a.metrics[sk] ? a.metrics[sk].improvement : null;
            var bv = b.metrics[sk] ? b.metrics[sk].improvement : null;
            av = (av === null || av === undefined || isNaN(av)) ? nl : av;
            bv = (bv === null || bv === undefined || isNaN(bv)) ? nl : bv;
            return sd === 'asc' ? (av - bv) : (bv - av);
        });

        var curYear = new Date().getFullYear();
        var thBase = 'padding:8px 6px; border-bottom:2px solid #ddd; cursor:pointer; user-select:none; font-size:0.8em; white-space:nowrap;';
        function arrow(key) {
            if (key !== _allKpiSort.key) return ' <span style="opacity:0.3;">&#8597;</span>';
            return _allKpiSort.dir === 'asc' ? ' <span style="color:#5e35b1;">&#9650;</span>' : ' <span style="color:#5e35b1;">&#9660;</span>';
        }

        var html = '';
        html += '<div style="margin-bottom:12px; padding:10px 14px; background:#f5f5f5; border-radius:8px; font-size:0.85em; color:#555;">';
        html += '<strong>2025 → ' + curYear + ' side-by-side</strong> &mdash; ' + data.matched + ' reps · click a KPI header to sort by who moved most. Click a value to see 2025 vs ' + curYear + '.';
        html += '</div>';

        html += '<div style="overflow-x:auto;"><table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
        html += '<thead><tr style="background:#f5f5f5;">';
        html += '<th class="yoyk-sort" data-sort="name" style="' + thBase + ' text-align:left; position:sticky; left:0; background:#f5f5f5;">Name' + arrow('name') + '</th>';
        data.metrics.forEach(function (k) {
            var m = _metricMeta(k);
            html += '<th class="yoyk-sort" data-sort="' + _escapeHtml(k) + '" style="' + thBase + ' text-align:center;" title="' + _escapeHtml(m.label) + '">' + _escapeHtml((m.icon || '') + ' ' + m.label) + arrow(k) + '</th>';
        });
        html += '</tr></thead><tbody>';

        sorted.forEach(function (r, idx) {
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            var bg = idx % 2 === 0 ? (isDark ? '#1a1f2e' : '#fafafa') : (isDark ? 'transparent' : '#fff');
            html += '<tr style="background:' + bg + '; border-bottom:1px solid #eee;">';
            html += '<td style="padding:6px; white-space:nowrap; font-weight:600; position:sticky; left:0; background:' + bg + ';">' + _escapeHtml(r.name) + '</td>';
            data.metrics.forEach(function (k) {
                var c = r.metrics[k] || {};
                var curDisp = _formatMetricDisplay(k, c.current);
                var sub = '';
                if (c.delta !== null) {
                    var good = c.improvement > 1e-9, bad = c.improvement < -1e-9;
                    var color = good ? '#2e7d32' : bad ? '#c62828' : '#777';
                    var icon = good ? '▲' : bad ? '▼' : '–';
                    var sign = c.delta > 0 ? '+' : '';
                    var deltaDisp = _formatDelta(k, c.delta);
                    var priorPart = _show2025 ? ('<span style="color:#999;">' + _formatMetricDisplay(k, c.prior) + '</span> ') : '';
                    sub = '<div style="font-size:0.76em; margin-top:1px;">' + priorPart + '<span style="color:' + color + ';">' + icon + sign + deltaDisp + '</span></div>';
                } else if (_show2025 && c.prior !== null && c.prior !== undefined) {
                    sub = '<div style="font-size:0.76em; margin-top:1px; color:#999;">' + _formatMetricDisplay(k, c.prior) + ' →</div>';
                }
                html += '<td style="padding:6px 8px; text-align:center; white-space:nowrap;"><div style="font-weight:600;">' + curDisp + '</div>' + sub + '</td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        wrap.innerHTML = html;

        wrap.querySelectorAll('.yoyk-sort').forEach(function (th) {
            th.addEventListener('click', function () {
                var key = th.dataset.sort;
                if (_allKpiSort.key === key) {
                    _allKpiSort.dir = _allKpiSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    _allKpiSort.key = key;
                    _allKpiSort.dir = (key === 'name') ? 'asc' : 'desc';
                }
                _renderAllKpiTable();
            });
        });
    }

    // Format a raw delta using the metric's natural units, without a sign
    // (the sign/arrow is applied by the caller). Percent metrics show points.
    function _formatDelta(key, delta) {
        var meta = _metricMeta(key);
        var abs = Math.abs(delta);
        if (meta.unit === '%') return abs.toFixed(1) + ' pts';
        if (meta.unit === 'sec') return Math.round(abs) + 's';
        if (meta.unit === 'hrs') return abs.toFixed(1) + 'h';
        if (meta.unit === '#') return Math.round(abs).toString();
        return abs.toFixed(1);
    }

    function _sortRows(rows) {
        var key = _sort.key, dir = _sort.dir;
        var nullLast = dir === 'asc' ? Infinity : -Infinity;
        return rows.sort(function (a, b) {
            if (key === 'name') {
                var cmp = String(a.name).localeCompare(String(b.name));
                return dir === 'asc' ? cmp : -cmp;
            }
            var av = a[key], bv = b[key];
            av = (av === null || av === undefined || (typeof av === 'number' && isNaN(av))) ? nullLast : av;
            bv = (bv === null || bv === undefined || (typeof bv === 'number' && isNaN(bv))) ? nullLast : bv;
            return dir === 'asc' ? (av - bv) : (bv - av);
        });
    }

    // ── Leader summary: plain-text recap of how each rep moved, built to be
    //    spoken to a leader or pasted into an AI tool. Respects "My team only". ──
    function _changePhrase(key, c, improved) {
        var m = _metricMeta(key);
        var arrow = improved ? '↑' : '↓';
        var pctStr = (c.pct !== null) ? (' [' + (c.pct > 0 ? '+' : '') + c.pct.toFixed(1) + '%]') : '';
        return m.label + ' ' + arrow + _formatDelta(key, c.delta) +
            ' (' + _formatMetricDisplay(key, c.prior) + ' → ' + _formatMetricDisplay(key, c.current) + ')' + pctStr;
    }

    function _buildSummaryText() {
        var data = _buildAllKpiRows();
        var curYear = new Date().getFullYear();
        if (!data || !data.rows.length) {
            return 'No year-over-year comparison data available. Load a 2025 baseline and current-year data first.';
        }

        var lines = [];
        lines.push('Year-over-Year Performance Summary — 2025 vs ' + curYear);
        lines.push('Scope: ' + (_myTeamOnly ? 'My team' : 'All reps') + ' (' + data.matched + ' reps matched) | Current data: ' + data.currentLabel);
        lines.push('Note: "improved/declined" already accounts for lower-is-better metrics (AHT, ACW, Hold Time, Reliability, Transfers).');
        lines.push('');

        // Cross-metric highlights, ranked by direction-aware % change so points
        // and seconds are comparable.
        var entries = [];
        data.rows.forEach(function (r) {
            data.metrics.forEach(function (k) {
                var c = r.metrics[k];
                if (!c || c.delta === null || c.pct === null) return;
                entries.push({ name: r.name, key: k, c: c, sip: _isReverse(k) ? -c.pct : c.pct });
            });
        });
        var ups = entries.filter(function (e) { return e.sip > 0.0001; }).sort(function (a, b) { return b.sip - a.sip; });
        var downs = entries.filter(function (e) { return e.sip < -0.0001; }).sort(function (a, b) { return a.sip - b.sip; });

        lines.push('TOP IMPROVEMENTS:');
        if (ups.length) ups.slice(0, 5).forEach(function (e) { lines.push('  • ' + e.name + ' — ' + _changePhrase(e.key, e.c, true)); });
        else lines.push('  (none)');
        lines.push('');
        lines.push('TOP DECLINES:');
        if (downs.length) downs.slice(0, 5).forEach(function (e) { lines.push('  • ' + e.name + ' — ' + _changePhrase(e.key, e.c, false)); });
        else lines.push('  (none)');
        lines.push('');
        lines.push('BY REP:');
        lines.push('');

        data.rows.slice().sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); }).forEach(function (r) {
            var up = [], down = [];
            data.metrics.forEach(function (k) {
                var c = r.metrics[k];
                if (!c || c.delta === null) return;
                if (c.improvement > 1e-9) up.push(_changePhrase(k, c, true));
                else if (c.improvement < -1e-9) down.push(_changePhrase(k, c, false));
            });
            lines.push(r.name + ' — ' + up.length + ' up / ' + down.length + ' down');
            if (up.length) lines.push('  Improved: ' + up.join('; '));
            if (down.length) lines.push('  Declined: ' + down.join('; '));
            lines.push('');
        });

        return lines.join('\n');
    }

    function _showSummaryModal() {
        var text = _buildSummaryText();
        var existing = document.getElementById('yoySummaryOverlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.id = 'yoySummaryOverlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:10000; display:flex; align-items:center; justify-content:center; padding:20px;';

        var box = document.createElement('div');
        box.style.cssText = 'background:#fff; color:#222; border-radius:10px; max-width:780px; width:100%; max-height:88vh; display:flex; flex-direction:column; box-shadow:0 10px 40px rgba(0,0,0,0.35);';

        var head = document.createElement('div');
        head.style.cssText = 'padding:14px 18px; border-bottom:1px solid #eee; display:flex; align-items:center; justify-content:space-between;';
        head.innerHTML = '<strong style="font-size:1.05em;">📋 Leader Summary</strong>' +
            '<span style="font-size:0.82em; color:#777;">Review, then copy &amp; paste into your notes or an AI tool.</span>';

        var body = document.createElement('div');
        body.style.cssText = 'padding:14px 18px; overflow:auto;';
        var ta = document.createElement('textarea');
        ta.id = 'yoySummaryText';
        ta.style.cssText = 'width:100%; box-sizing:border-box; height:50vh; font-family:monospace; font-size:0.82em; line-height:1.4; padding:10px; border:1px solid #ccc; border-radius:6px; white-space:pre; resize:vertical;';
        ta.value = text;
        body.appendChild(ta);

        var foot = document.createElement('div');
        foot.style.cssText = 'padding:12px 18px; border-top:1px solid #eee; display:flex; gap:10px; justify-content:flex-end; align-items:center;';
        foot.innerHTML =
            '<span id="yoyCopyStatus" style="font-size:0.85em; color:#2e7d32; margin-right:auto;"></span>' +
            '<button type="button" id="yoyCopyBtn" class="btn-primary" style="padding:7px 16px;">Copy to clipboard</button>' +
            '<button type="button" id="yoyCloseSummary" class="btn-secondary" style="padding:7px 16px;">Close</button>';

        box.appendChild(head);
        box.appendChild(body);
        box.appendChild(foot);
        overlay.appendChild(box);
        document.body.appendChild(overlay);

        function close() { overlay.remove(); }
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.getElementById('yoyCloseSummary').addEventListener('click', close);

        document.getElementById('yoyCopyBtn').addEventListener('click', function () {
            var status = document.getElementById('yoyCopyStatus');
            var val = ta.value;
            function ok() { if (status) status.textContent = '✓ Copied'; }
            function fail() {
                ta.focus(); ta.select();
                try { document.execCommand('copy'); ok(); }
                catch (_e) { if (status) { status.style.color = '#c62828'; status.textContent = 'Press Ctrl+C to copy'; } }
            }
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(val).then(ok).catch(fail);
            } else {
                fail();
            }
        });
    }

    // ── Export ──
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.yoyComparison = {
        renderYoYComparison: renderYoYComparison,
        hasBaseline: function () { return !!_loadBaseline(); }
    };
    window.renderYoYComparison = renderYoYComparison;
})();
