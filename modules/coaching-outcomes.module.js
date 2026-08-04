(function () {
    'use strict';

    // ============================================
    // COACHING OUTCOMES MODULE
    //
    // Joins the two halves the app already had and never connected: the log
    // of what was coached and when, and the weekly metrics that followed.
    //
    // Every coaching event records { employeeId, weekEnding, metricsCoached },
    // and nothing ever read it back against later data. So the app could tell
    // you what you said, but never whether it landed — and across 126 reps
    // that is the difference between a generator and something that gets
    // better the longer it runs.
    //
    // Measurement is week over week: the week the coaching was based on
    // against the next uploaded week. That is how Scott reviews, so that is
    // what is measured. It is deliberately a short window — it is noisy per
    // event, which is why the value is in the aggregate across many events
    // rather than in any single verdict.
    //
    // On "did it work": rather than bake one definition in, each outcome
    // stores the facts and lets the reader judge —
    //   moved      : did the metric move beyond the noise band, the right way
    //   beatTeam   : did it move better than the team median that same week
    //   reachedTarget : did it cross from missing to meeting
    // beatTeam matters because a week where everyone improved is not evidence
    // your coaching did anything.
    // ============================================

    var UNCOACHABLE = { totalCalls: true, transfersCount: true, reliability: true };

    function _mm() {
        return window.DevCoachModules && window.DevCoachModules.metricMovement;
    }
    function _weeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _coachingHistory() {
        return typeof coachingHistory !== 'undefined' ? coachingHistory : {};
    }
    function _label(metricKey) {
        var reg = (window.METRICS_REGISTRY || {})[metricKey];
        return (reg && reg.label) || metricKey;
    }
    function _escapeHtml(s) {
        var u = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        return u && u.escapeHtml ? u.escapeHtml(s) : String(s == null ? '' : s);
    }
    function _fmt(metricKey, value) {
        return typeof window.formatMetricDisplay === 'function'
            ? window.formatMetricDisplay(metricKey, value)
            : String(value);
    }

    /* ── Periods ── */

    function _endDate(key) {
        var p = _weeklyData()[key];
        return (p && p.metadata && p.metadata.endDate)
            || (key.indexOf('|') !== -1 ? key.split('|')[1] : key);
    }

    // True weekly uploads only, oldest first. A month or quarter upload spans
    // a coaching event on both sides of itself and would compare a week to a
    // quarter, which measures nothing.
    function _weekKeys() {
        var wData = _weeklyData();
        return Object.keys(wData)
            .filter(function (k) {
                var t = (wData[k] && wData[k].metadata && wData[k].metadata.periodType) || 'week';
                return t === 'week';
            })
            .sort(function (a, b) { return String(_endDate(a)).localeCompare(String(_endDate(b))); });
    }

    function _employeeIn(key, name) {
        var p = _weeklyData()[key];
        if (!p || !p.employees) return null;
        for (var i = 0; i < p.employees.length; i++) {
            if (p.employees[i] && p.employees[i].name === name) return p.employees[i];
        }
        return null;
    }

    function _value(key, name, metricKey) {
        var emp = _employeeIn(key, name);
        if (!emp) return null;
        var v = parseFloat(emp[metricKey]);
        return isFinite(v) ? v : null;
    }

    /* ── The join ── */

    // The week the coaching was based on: the last week ending on or before
    // the event's weekEnding, falling back to the day it was generated when
    // an older entry carries a label instead of a date.
    function _baselineKeyFor(entry, keys) {
        var anchor = /^\d{4}-\d{2}-\d{2}$/.test(String(entry.weekEnding || ''))
            ? entry.weekEnding
            : String(entry.generatedAt || '').slice(0, 10);
        if (!anchor) return null;
        var found = null;
        for (var i = 0; i < keys.length; i++) {
            if (String(_endDate(keys[i])) <= anchor) found = keys[i];
            else break;
        }
        return found;
    }

    // Median so one rep with a wild swing can't drag the comparison.
    function _median(nums) {
        if (!nums.length) return null;
        var s = nums.slice().sort(function (a, b) { return a - b; });
        var mid = Math.floor(s.length / 2);
        return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
    }

    // How the rest of the team moved on this metric over the same two weeks.
    // Cached per metric+week pair — a rep coached on four metrics would
    // otherwise recompute the whole team four times.
    function _teamDelta(metricKey, fromKey, toKey, exclude, cache) {
        var ck = metricKey + '|' + fromKey + '|' + toKey;
        if (cache[ck] !== undefined) return cache[ck];
        var mm = _mm();
        var from = _weeklyData()[fromKey];
        var deltas = [];
        if (mm && from && from.employees) {
            from.employees.forEach(function (emp) {
                if (!emp || !emp.name || emp.name === exclude) return;
                var a = _value(fromKey, emp.name, metricKey);
                var b = _value(toKey, emp.name, metricKey);
                if (a === null || b === null) return;
                var d = mm.performanceDelta(metricKey, b, a);
                if (d !== null) deltas.push(d);
            });
        }
        cache[ck] = deltas.length >= 3 ? _median(deltas) : null;
        return cache[ck];
    }

    function _meetsTarget(metricKey, value) {
        if (value === null) return null;
        if (typeof window.metricMeetsTarget === 'function') {
            try { return !!window.metricMeetsTarget(metricKey, value); } catch (e) { /* fall through */ }
        }
        var reg = (window.METRICS_REGISTRY || {})[metricKey];
        var target = reg && reg.target;
        if (!target || typeof target.value !== 'number') return null;
        return target.type === 'min' ? value >= target.value : value <= target.value;
    }

    /**
     * Every coaching event joined to what happened the following week.
     * Newest first.
     */
    function buildOutcomes(employeeName) {
        var mm = _mm();
        if (!mm) return [];

        var keys = _weekKeys();
        var history = _coachingHistory();
        var names = employeeName ? [employeeName] : Object.keys(history);
        var cache = {};
        var out = [];

        names.forEach(function (name) {
            (history[name] || []).forEach(function (entry) {
                var baselineKey = _baselineKeyFor(entry, keys);
                if (!baselineKey) return;
                var idx = keys.indexOf(baselineKey);
                var outcomeKey = idx > -1 && idx + 1 < keys.length ? keys[idx + 1] : null;

                (entry.metricsCoached || []).forEach(function (metricKey) {
                    if (UNCOACHABLE[metricKey]) return;

                    var before = _value(baselineKey, name, metricKey);
                    var after = outcomeKey ? _value(outcomeKey, name, metricKey) : null;

                    var base = {
                        employee: name,
                        metricKey: metricKey,
                        label: _label(metricKey),
                        coachedAt: entry.generatedAt || null,
                        baselineKey: baselineKey,
                        baselineEnd: _endDate(baselineKey),
                        outcomeKey: outcomeKey,
                        outcomeEnd: outcomeKey ? _endDate(outcomeKey) : null,
                        beforeValue: before,
                        afterValue: after
                    };

                    if (before === null || after === null) {
                        out.push(Object.assign(base, {
                            verdict: 'pending',
                            reason: !outcomeKey ? 'no week uploaded yet since coaching' : 'no data for this metric that week',
                            delta: null, movement: null, teamDelta: null,
                            beatTeam: null, reachedTarget: null
                        }));
                        return;
                    }

                    var resolved = mm.resolveDirection(metricKey, after, before);
                    var teamDelta = _teamDelta(metricKey, baselineKey, outcomeKey, name, cache);
                    var metBefore = _meetsTarget(metricKey, before);
                    var metAfter = _meetsTarget(metricKey, after);

                    out.push(Object.assign(base, {
                        delta: resolved.delta,
                        movement: mm.describe(metricKey, resolved.direction, resolved.delta),
                        teamDelta: teamDelta,
                        beatTeam: teamDelta === null ? null : resolved.delta > teamDelta,
                        reachedTarget: metBefore === false && metAfter === true,
                        slippedOffTarget: metBefore === true && metAfter === false,
                        verdict: resolved.direction === 'improving' ? 'moved'
                            : resolved.direction === 'declining' ? 'went backwards'
                            : 'held flat'
                    }));
                });
            });
        });

        return out.sort(function (a, b) {
            return String(b.coachedAt || '').localeCompare(String(a.coachedAt || ''));
        });
    }

    /**
     * Which metrics your coaching actually moves, across everyone.
     * The point of the whole module: stop re-sending advice that never lands.
     */
    function summarizeByMetric(outcomes) {
        var rows = {};
        (outcomes || []).forEach(function (o) {
            if (o.verdict === 'pending') return;
            var r = rows[o.metricKey] || (rows[o.metricKey] = {
                metricKey: o.metricKey, label: o.label,
                total: 0, moved: 0, backwards: 0, flat: 0, beatTeam: 0, comparable: 0, reachedTarget: 0
            });
            r.total++;
            if (o.verdict === 'moved') r.moved++;
            else if (o.verdict === 'went backwards') r.backwards++;
            else r.flat++;
            if (o.beatTeam !== null) { r.comparable++; if (o.beatTeam) r.beatTeam++; }
            if (o.reachedTarget) r.reachedTarget++;
        });
        return Object.keys(rows)
            .map(function (k) {
                var r = rows[k];
                r.moveRate = r.total ? r.moved / r.total : 0;
                // Only meaningful with enough comparable events behind it.
                r.beatTeamRate = r.comparable >= 3 ? r.beatTeam / r.comparable : null;
                return r;
            })
            .sort(function (a, b) { return b.total - a.total || b.moveRate - a.moveRate; });
    }

    /* ── Rendering ── */

    var VERDICT_STYLE = {
        'moved': { bg: 'var(--green-soft)', color: 'var(--green-text)', icon: '✅', text: 'Moved' },
        'went backwards': { bg: 'var(--red-soft)', color: 'var(--red-text)', icon: '⚠️', text: 'Went backwards' },
        'held flat': { bg: 'var(--bg-surface-sunken)', color: 'var(--text-secondary)', icon: '➖', text: 'No change' },
        'pending': { bg: 'var(--bg-surface-sunken)', color: 'var(--text-tertiary)', icon: '⏳', text: 'Waiting on data' }
    };

    function _shortDate(iso) {
        if (!iso) return '';
        try {
            return new Date(String(iso).slice(0, 10) + 'T00:00:00')
                .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) { return String(iso).slice(0, 10); }
    }

    function _outcomeRowHtml(o) {
        var style = VERDICT_STYLE[o.verdict] || VERDICT_STYLE.pending;
        var detail;
        if (o.verdict === 'pending') {
            detail = _escapeHtml(o.reason || '');
        } else {
            detail = _escapeHtml(_fmt(o.metricKey, o.beforeValue)) + ' → ' +
                _escapeHtml(_fmt(o.metricKey, o.afterValue)) +
                ' <span style="color:var(--text-tertiary);">(week ending ' + _escapeHtml(_shortDate(o.outcomeEnd)) + ')</span>';
        }

        var notes = [];
        if (o.reachedTarget) notes.push('crossed to target');
        if (o.slippedOffTarget) notes.push('slipped off target');
        // Only worth saying when it disagrees with the raw verdict, or
        // confirms it against a moving team.
        if (o.beatTeam === true && o.verdict !== 'moved') notes.push('still beat the team');
        else if (o.beatTeam === false && o.verdict === 'moved') notes.push('but the team moved more');
        else if (o.beatTeam === true && o.verdict === 'moved') notes.push('beat the team');

        return '<div style="display:flex; gap:10px; align-items:flex-start; padding:8px 0; border-bottom:1px solid var(--border);">' +
            '<span style="flex:0 0 auto; font-size:0.78em; font-weight:600; padding:2px 8px; border-radius:10px; background:' +
                style.bg + '; color:' + style.color + ';">' + style.icon + ' ' + style.text + '</span>' +
            '<div style="flex:1; min-width:0; font-size:0.86em;">' +
                '<div style="color:var(--text-primary);"><strong>' + _escapeHtml(o.label) + '</strong> ' +
                    '<span style="color:var(--text-tertiary);">coached ' + _escapeHtml(_shortDate(o.coachedAt)) + '</span></div>' +
                '<div style="color:var(--text-secondary); margin-top:2px;">' + detail + '</div>' +
                (notes.length
                    ? '<div style="color:var(--text-tertiary); font-size:0.92em; margin-top:2px;">' + _escapeHtml(notes.join(' • ')) + '</div>'
                    : '') +
            '</div></div>';
    }

    function renderForEmployee(container, employeeName) {
        if (!container) return;
        if (!employeeName) { container.innerHTML = ''; container.style.display = 'none'; return; }

        var outcomes = buildOutcomes(employeeName);
        if (!outcomes.length) {
            container.style.display = '';
            container.innerHTML = '<div style="font-size:0.85em; color:var(--text-tertiary);">' +
                'No coaching logged for ' + _escapeHtml(employeeName) + ' yet. Generate a coaching email and the result will show up here next week.</div>';
            return;
        }

        var settled = outcomes.filter(function (o) { return o.verdict !== 'pending'; });
        var moved = settled.filter(function (o) { return o.verdict === 'moved'; }).length;
        var headline = settled.length
            ? moved + ' of ' + settled.length + ' coached metrics moved the right way the following week'
            : 'Coaching logged — waiting on the next weekly upload';

        container.style.display = '';
        container.innerHTML =
            '<div style="margin-top:16px; padding:14px 16px; background:var(--bg-surface-raised); border:1px solid var(--border); border-radius:8px;">' +
                '<div style="font-weight:700; color:var(--text-primary); margin-bottom:2px;">📉 Did it land?</div>' +
                '<div style="font-size:0.85em; color:var(--text-secondary); margin-bottom:10px;">' + _escapeHtml(headline) + '</div>' +
                outcomes.slice(0, 12).map(_outcomeRowHtml).join('') +
            '</div>';
    }

    function renderTeamSummary(container) {
        if (!container) return;
        var rows = summarizeByMetric(buildOutcomes());
        if (!rows.length) {
            container.innerHTML = '<div style="font-size:0.85em; color:var(--text-tertiary);">' +
                'Not enough coaching history yet to tell which topics land.</div>';
            return;
        }
        container.innerHTML =
            '<div style="padding:14px 16px; background:var(--bg-surface-raised); border:1px solid var(--border); border-radius:8px;">' +
            '<div style="font-weight:700; color:var(--text-primary); margin-bottom:2px;">Which coaching lands</div>' +
            '<div style="font-size:0.82em; color:var(--text-tertiary); margin-bottom:10px;">' +
                'Share of coached metrics that moved the right way the following week.</div>' +
            rows.map(function (r) {
                var pct = Math.round(r.moveRate * 100);
                var vsTeam = r.beatTeamRate === null
                    ? '<span style="color:var(--text-tertiary);">not enough to compare</span>'
                    : Math.round(r.beatTeamRate * 100) + '% beat the team';
                return '<div style="display:flex; justify-content:space-between; gap:12px; padding:6px 0; border-bottom:1px solid var(--border); font-size:0.86em;">' +
                    '<span style="color:var(--text-primary);">' + _escapeHtml(r.label) + '</span>' +
                    '<span style="color:var(--text-secondary); white-space:nowrap;">' +
                        r.moved + '/' + r.total + ' moved (' + pct + '%) &nbsp;•&nbsp; ' + vsTeam +
                    '</span></div>';
            }).join('') +
            '</div>';
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.coachingOutcomes = {
        buildOutcomes: buildOutcomes,
        summarizeByMetric: summarizeByMetric,
        renderForEmployee: renderForEmployee,
        renderTeamSummary: renderTeamSummary
    };
})();
