(function () {
    'use strict';

    // ============================================
    // QUARTER REVIEW UI
    //
    // The Quarterly tab. Pick a quarter and an associate, see how each measure
    // moved across the quarters of the year, and take away the check-in
    // document for their record.
    //
    // This replaces a view that was wrong in a way nobody would notice from
    // looking at it. The old tab was built during Q1, when the year to date
    // and Q1 were the same range, so it read the newest year-to-date upload
    // and printed it under a column headed "Q1 Avg". That held until April and
    // has quietly been printing year to date figures under a Q1 heading ever
    // since. Nothing here reads a year-to-date row: a quarter is assembled
    // from the uploads that cover that quarter, and the table says which.
    // ============================================

    var CONTENT_ID = 'q1ReviewContent';
    var STORAGE_KEY = 'quarterReviewNotes';

    function _mod(name) { return (window.DevCoachModules || {})[name] || null; }
    function _qt() { return _mod('quarterTrend'); }
    function _qr() { return _mod('quarterReview'); }

    function _escape(str) {
        var utils = _mod('sharedUtils');
        if (utils && utils.escapeHtml) return utils.escapeHtml(str);
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function _display(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') {
            return window.formatMetricDisplay(metricKey, value);
        }
        return String(Math.round(value * 10) / 10);
    }

    function _copy(text, message) {
        var utils = _mod('uiUtils');
        if (utils && typeof utils.copyToClipboard === 'function') {
            return utils.copyToClipboard(text, { message: message });
        }
        if (typeof window.copyToClipboard === 'function') {
            return window.copyToClipboard(text, { message: message });
        }
        return null;
    }

    function _toast(message) {
        if (typeof window.showToast === 'function') window.showToast(message, 2600);
    }

    /* ── View state ──
     *
     * Kept on the module rather than read back out of the DOM, so a redraw
     * does not lose the quarter the supervisor picked.
     */
    var state = {
        year: null,
        quarter: null,
        employee: '',
        quarters: null,
        notes: {},
        // Stays open from one associate to the next, so a morning of back to
        // back check-ins is one click, not one per person.
        showTalking: false
    };

    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    /* The check-in the tab opens on: the newest quarter with at least half of
     * it uploaded.
     *
     * It used to open on the newest quarter to have started. From the first
     * of October that is a Q4 with nothing in it, so every Q3 check-in opened
     * on a document titled "Q4 2026 Check In" that closed on "going into next
     * year". Early in a quarter, the one worth talking about is the one that
     * just ended.
     */
    function _defaultQuarter(quarters) {
        var qt = _qt();
        for (var i = quarters.length - 1; i >= 0; i--) {
            var q = quarters[i];
            if (q.empty) continue;
            var b = qt.quarterBounds(q.year, q.quarter);
            var days = Math.round((b.endMs - b.startMs) / MS_PER_DAY) + 1;
            if ((q.coveredDays || 0) / days >= 0.5) return q.quarter;
        }
        return null;
    }

    /* The year and quarter to open on. In the first weeks of January the
     * current year has nothing worth a check-in, and last year's Q4 is the
     * one due. */
    function _openingCheckIn() {
        var qt = _qt();
        var year = new Date().getFullYear();
        var quarters = qt.buildYearQuarters(year);
        var pick = _defaultQuarter(quarters);
        if (pick !== null) return { year: year, quarter: pick, quarters: quarters };
        var lastYear = qt.buildYearQuarters(year - 1);
        var prior = _defaultQuarter(lastYear);
        if (prior !== null) return { year: year - 1, quarter: prior, quarters: lastYear };
        return { year: year, quarter: null, quarters: quarters };
    }

    // Quarters with nothing uploaded are not offered. A check-in for one would
    // carry an empty quarter's name over the numbers of the one before it.
    function _offeredQuarters() {
        return (state.quarters || []).filter(function (q) { return !q.empty; });
    }

    function _loadNotes() {
        var storage = _mod('storage');
        if (storage && typeof storage.readStore === 'function') {
            var saved = storage.readStore(STORAGE_KEY);
            if (saved && typeof saved === 'object') return saved;
        }
        return {};
    }

    function _saveNotes() {
        var storage = _mod('storage');
        if (storage && typeof storage.saveWithSizeCheck === 'function') {
            storage.saveWithSizeCheck(STORAGE_KEY, state.notes);
        }
    }

    function _noteKey() {
        return state.employee + '|' + state.year + '|Q' + state.quarter;
    }

    /* ── Rendering ── */

    function render() {
        var host = document.getElementById(CONTENT_ID);
        if (!host) return;

        // Both are needed to draw anything. Guarding only the first left the
        // second to throw halfway through a render, on a blank panel.
        if (!_qt() || !_qr()) {
            host.innerHTML = '<p style="padding:24px;color:var(--text-tertiary);">'
                + 'The quarterly review modules did not load. Reload the page, and if it persists the app needs a look.</p>';
            return;
        }
        var qt = _qt();

        if (!Object.keys(state.notes).length) state.notes = _loadNotes();

        if (state.year === null) {
            var opening = _openingCheckIn();
            state.year = opening.year;
            state.quarter = opening.quarter;
            state.quarters = opening.quarters;
        } else {
            state.quarters = qt.buildYearQuarters(state.year);
        }
        if (!state.quarters.length) {
            host.innerHTML = _shell(_emptyYear());
            _bindTopControls();
            return;
        }
        var offered = _offeredQuarters().map(function (q) { return q.quarter; });
        if (offered.indexOf(state.quarter) < 0) {
            var pick = _defaultQuarter(state.quarters);
            state.quarter = pick !== null ? pick
                : offered.length ? offered[offered.length - 1]
                    : state.quarters[state.quarters.length - 1].quarter;
        }

        var names = _namesWithData();
        if (state.employee && names.indexOf(state.employee) < 0) state.employee = '';

        var body = _coveragePanel()
            + _pickerPanel(names)
            + (state.employee ? _associatePanel() : _prompt());

        host.innerHTML = _shell(body);
        _bindTopControls();
        if (state.employee) _bindAssociateControls();
    }

    function _shell(inner) {
        return '<div style="display:flex;flex-direction:column;gap:16px;">' + inner + '</div>';
    }

    function _emptyYear() {
        return '<div style="padding:24px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">'
            + '<p style="margin:0;color:var(--text-secondary);">No quarter of '
            + _escape(state.year) + ' has started yet. Pick another year.</p>'
            + _yearControl() + '</div>';
    }

    function _yearControl() {
        return '<label style="display:inline-flex;align-items:center;gap:8px;margin-top:12px;">'
            + '<span style="font-weight:600;color:var(--text-primary);">Year</span>'
            + '<input type="number" id="quarterReviewYear" min="2020" max="2100" value="' + _escape(state.year)
            + '" style="width:110px;padding:6px 8px;border:1px solid var(--border);border-radius:4px;"></label>';
    }

    /* What each quarter of the year actually rests on. There is no console
     * here, so this panel is the answer to "do I have Q1 and Q2 loaded". */
    function _coveragePanel() {
        var report = _qt().quarterCoverageReport(state.year);
        var cells = report.map(function (q) {
            var tone = q.status === 'full' ? '#16a34a'
                : q.status === 'partial' ? '#d97706'
                    : q.status === 'thin' ? '#dc2626' : '#94a3b8';
            var detail;
            if (q.status === 'none') {
                detail = 'nothing uploaded';
            } else {
                detail = q.periodCount + ' ' + q.sourceLabel
                    + ', ' + q.coveredDays + ' of ' + q.elapsedDays + ' days';
            }
            return '<div style="flex:1 1 150px;min-width:150px;padding:10px 12px;border:1px solid var(--border);'
                + 'border-left:4px solid ' + tone + ';border-radius:6px;background:var(--bg-surface);">'
                + '<div style="font-weight:700;color:var(--text-primary);">' + _escape(q.name) + ' ' + _escape(state.year)
                + (q.complete ? '' : ' <span style="font-weight:400;font-size:0.82em;color:var(--text-tertiary);">(still running)</span>')
                + '</div>'
                + '<div style="font-size:0.85em;color:var(--text-secondary);margin-top:2px;">' + _escape(detail) + '</div>'
                + (q.headcount ? '<div style="font-size:0.8em;color:var(--text-tertiary);margin-top:2px;">'
                    + q.headcount + ' associates</div>' : '')
                + '</div>';
        }).join('');

        return '<div style="padding:14px 16px;background:var(--bg-surface-raised);border-radius:8px;border:1px solid var(--border);">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:10px;">'
            + '<h4 style="margin:0;color:var(--text-primary);">What each quarter is built from</h4>'
            + _yearControl() + '</div>'
            + '<div style="display:flex;gap:10px;flex-wrap:wrap;">' + cells + '</div></div>';
    }

    function _namesWithData() {
        var seen = {};
        (state.quarters || []).forEach(function (q) {
            Object.keys(q.employees || {}).forEach(function (n) { seen[n] = true; });
        });
        var names = Object.keys(seen);
        var tf = _mod('teamFilter');
        if (tf && tf.getTeamSelectionContext && tf.isAssociateIncludedByTeamFilter) {
            var ctx = tf.getTeamSelectionContext();
            names = names.filter(function (n) { return tf.isAssociateIncludedByTeamFilter(n, ctx); });
        }
        return names.sort();
    }

    function _pickerPanel(names) {
        var picker = _mod('associatePicker');
        var options = picker
            ? picker.optionsHtml(names, { selected: state.employee, placeholder: 'Pick an associate' })
            : '<option value="">Pick an associate</option>' + names.map(function (n) {
                return '<option value="' + _escape(n) + '"' + (n === state.employee ? ' selected' : '') + '>'
                    + _escape(n) + '</option>';
            }).join('');

        var quarterButtons = _offeredQuarters().map(function (q) {
            var active = q.quarter === state.quarter;
            return '<button type="button" class="quarter-review-q" data-quarter="' + q.quarter + '"'
                + ' style="padding:7px 16px;border-radius:6px;cursor:pointer;font-weight:600;'
                + 'border:1px solid ' + (active ? '#d84315' : 'var(--border)') + ';'
                + 'background:' + (active ? '#d84315' : 'var(--bg-surface)') + ';'
                + 'color:' + (active ? '#fff' : 'var(--text-primary)') + ';">'
                + _escape(q.name) + '</button>';
        }).join('');

        return '<div style="padding:14px 16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);'
            + 'display:flex;gap:16px;flex-wrap:wrap;align-items:flex-end;">'
            + '<div style="flex:1 1 260px;">'
            + '<label for="quarterReviewEmployee" style="display:block;font-weight:600;margin-bottom:6px;color:var(--text-primary);">Associate</label>'
            + '<select id="quarterReviewEmployee" style="width:100%;padding:8px;border:1px solid var(--border);border-radius:4px;">'
            + options + '</select></div>'
            + '<div><span style="display:block;font-weight:600;margin-bottom:6px;color:var(--text-primary);">Check-in for</span>'
            + '<div style="display:flex;gap:6px;">' + quarterButtons + '</div></div>'
            + '</div>';
    }

    function _prompt() {
        return '<div style="padding:40px;text-align:center;color:var(--text-tertiary);background:var(--bg-surface);'
            + 'border-radius:8px;border:1px dashed var(--border);">'
            + 'Pick an associate to build their check-in document.</div>';
    }

    /* ── The associate view ── */

    function _associatePanel() {
        var qr = _qr();
        var ctx = qr.buildContext(state.employee, state.year, {
            quarters: state.quarters,
            throughQuarter: state.quarter
        });
        if (!ctx) {
            return '<div style="padding:24px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);'
                + 'color:var(--text-secondary);">No quarter of ' + _escape(state.year) + ' carries data for '
                + _escape(state.employee) + '.</div>';
        }

        var note = state.notes[_noteKey()] || '';
        var notes = qr.buildNotes(ctx, { notes: note });
        return _talkingBar(ctx)
            + (state.showTalking ? _talkingPanel(qr.buildTalkingPoints(ctx, { notes: note })) : '')
            + _progressionTable(ctx) + _placingsPanel(ctx) + _notesPanel(ctx, notes, note);
    }

    /* ── Where they placed ──
     *
     * Scott's ask for the Q3 meetings: each quarter's placing in the five
     * KPIs against the call center, beside the goal, to see the climb and pick
     * a focus for the last quarter. For him, not the file: nothing here feeds
     * the document, the talking points or the Copilot prompt, and none of the
     * copy buttons pick it up.
     */
    function _placingsPanel(ctx) {
        var cr = _mod('centerRanking');
        if (!cr || typeof cr.buildQuarterPlacings !== 'function') return '';
        var model = cr.buildQuarterPlacings(ctx.name, ctx.year, ctx.quarters);
        if (!model || !model.rows.some(function (r) { return r.cells.some(function (c) { return c.rank !== null; }); })) {
            return '';
        }
        var ordinal = typeof cr.ordinal === 'function' ? cr.ordinal : function (n) { return String(n); };

        var head = ctx.quarters.map(function (q) {
            return '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">' + _escape(q.name) + '</th>';
        }).join('');

        // The whole year beside the quarters. Each quarter column is that
        // quarter alone; Scott needed the year as well, so it gets its own
        // column, read off the year to date upload and dated by it.
        var hasYear = model.rows.some(function (r) { return r.year && r.year.rank !== null; });
        var YEAR_STYLE = 'border-left:2px solid var(--border);background:var(--bg-surface-raised);';
        var through = _shortDate(model.yearThrough);
        var yearHead = hasYear
            ? '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);' + YEAR_STYLE + '">Year to date'
                + (through ? '<div style="font-weight:400;font-size:0.75em;color:var(--text-tertiary);">through ' + _escape(through) + '</div>' : '')
                + '</th>'
            : '';
        var firstName = ctx.quarters.length ? ctx.quarters[0].name : '';
        var lastName = ctx.quarters.length ? ctx.quarters[ctx.quarters.length - 1].name : '';

        var body = model.rows.map(function (row) {
            var isFocus = model.focus && model.focus.registry === row.registry;
            var cells = row.cells.map(function (c) { return _placingCell(c, ordinal); }).join('')
                + (hasYear ? (row.year ? _placingCell(row.year, ordinal, YEAR_STYLE)
                    : '<td style="padding:8px;text-align:center;color:var(--text-tertiary);' + YEAR_STYLE + '">-</td>') : '');
            return '<tr style="border-bottom:1px solid var(--border);' + (isFocus ? 'background:rgba(216,67,21,0.08);' : '') + '">'
                + '<td style="padding:8px;font-weight:600;">' + _escape(row.label)
                + (isFocus ? ' <span style="font-size:0.75em;font-weight:700;color:#d84315;">FOCUS</span>' : '') + '</td>'
                + cells
                + '<td style="padding:8px;text-align:center;color:var(--text-secondary);">' + _escape(_placingGoal(row)) + '</td>'
                + '<td style="padding:8px;text-align:center;">' + _placingMove(row.climbed) + '</td></tr>';
        }).join('');

        return '<div style="padding:16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">'
            + '<h4 style="margin:0 0 4px;color:var(--text-primary);">Where ' + _escape(ctx.firstName) + ' placed in the call center</h4>'
            + '<p style="margin:0 0 12px;font-size:0.85em;color:var(--text-tertiary);">'
            + 'For you, not the file. Each placing is inside that one KPI, against everyone measured, and 1st is best. '
            + 'Each quarter column is that quarter on its own'
            + (hasYear ? ', and Year to date is the whole year so far, from the year to date upload' : '')
            + '. Reliability is always hours missed for the year so far. '
            + 'Movement is counted over the people measured in both quarters, so a smaller field does not read as a climb.</p>'
            + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.9em;">'
            + '<thead><tr style="background:var(--bg-surface-raised);">'
            + '<th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--border);">KPI</th>'
            + head + yearHead
            + '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">Goal</th>'
            + '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">Moved'
            + (firstName && lastName && firstName !== lastName
                ? '<div style="font-weight:400;font-size:0.75em;color:var(--text-tertiary);">' + _escape(firstName) + ' to ' + _escape(lastName) + '</div>'
                : '')
            + '</th>'
            + '</tr></thead><tbody>' + body + '</tbody></table></div>'
            + _placingFocus(model.focus, ctx, ordinal)
            + '</div>';
    }

    // "2026-10-01" as "10/01", for the year column's heading.
    function _shortDate(dateText) {
        var parts = String(dateText || '').split('-');
        return parts.length === 3 ? parts[1] + '/' + parts[2] : '';
    }

    function _placingCell(c, ordinal, extraStyle) {
        var extra = extraStyle || '';
        if (c.rank === null) {
            return '<td style="padding:8px;text-align:center;color:var(--text-tertiary);' + extra + '">-</td>';
        }
        var colour = c.meets === true ? '#16a34a' : c.meets === false ? '#c2410c' : 'var(--text-primary)';
        var step = '';
        if (c.climbed !== null && c.climbed !== 0) {
            step = ' <span style="font-size:0.78em;font-weight:600;color:' + (c.climbed > 0 ? '#16a34a' : '#c2410c') + ';"'
                + ' title="Places ' + (c.climbed > 0 ? 'gained' : 'lost') + ' since the quarter before, among the people measured in both">'
                + (c.climbed > 0 ? '▲' : '▼') + Math.abs(c.climbed) + '</span>';
        }
        return '<td style="padding:8px;text-align:center;font-variant-numeric:tabular-nums;' + extra + '"'
            + (c.thin ? ' title="Too few surveys to join the field, so this is where the figure would sit"' : '') + '>'
            + '<div><strong style="font-size:1.05em;">' + _escape(ordinal(c.rank)) + '</strong>'
            + ' <span style="font-size:0.8em;color:var(--text-tertiary);">of ' + _escape(c.total) + '</span>' + step + '</div>'
            + '<div style="font-size:0.85em;font-weight:600;color:' + colour + ';">' + _escape(c.display)
            + (c.substituted ? ' <span title="Rep sat was blank or zero this quarter, so this is Overall Experience" style="color:#e65100;">OE</span>' : '')
            + (c.thin ? ' <span style="font-weight:400;color:var(--text-tertiary);">(few surveys)</span>' : '')
            + '</div></td>';
    }

    function _placingGoal(row) {
        var t = row.target;
        if (!t || !Number.isFinite(t.value)) return '-';
        var goal = _display(row.registry, t.value);
        if (row.registry === 'reliability') return goal + ' for the year';
        return goal + (t.type === 'max' ? ' or lower' : ' or better');
    }

    function _placingMove(climbed) {
        if (climbed === null || climbed === undefined) return '<span style="color:var(--text-tertiary);">-</span>';
        if (climbed === 0) return '<span style="color:var(--text-secondary);">held</span>';
        var up = climbed > 0;
        var n = Math.abs(climbed);
        return '<span style="color:' + (up ? '#16a34a' : '#c2410c') + ';font-weight:600;">'
            + (up ? '▲ up ' : '▼ down ') + n + (n === 1 ? ' place' : ' places') + '</span>';
    }

    function _placingFocus(focus, ctx, ordinal) {
        if (!focus) return '';
        var next = ctx.quarter < 4 ? 'Q' + (ctx.quarter + 1) : 'next year';
        var where = ordinal(focus.rank) + ' of ' + focus.total;
        var why = focus.belowGoal
            ? 'Below goal in ' + ctx.current.name + ', and the lowest placing of the KPIs below goal (' + where + ').'
            : 'Handle time, adherence, sentiment and rep sat are all at goal in ' + ctx.current.name + '. This is the lowest placing of those (' + where + '), so it has the most room to climb.';
        return '<div style="margin-top:12px;padding:10px 12px;border-left:4px solid #d84315;background:var(--bg-surface-raised);border-radius:4px;">'
            + '<div style="font-weight:700;color:var(--text-primary);">Suggested focus for ' + _escape(next) + ': ' + _escape(focus.label) + '</div>'
            + '<div style="font-size:0.9em;color:var(--text-secondary);margin-top:2px;">' + _escape(why) + '</div>'
            + '</div>';
    }

    /* ── Talking points ──
     *
     * The button Scott asked for: the associate is in the room, one click,
     * and the numbers are on the screen as things to say rather than as a
     * table to read out.
     */
    function _talkingBar(ctx) {
        var label = state.showTalking ? 'Hide talking points' : '🗣️ Talking points for the meeting';
        return '<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">'
            + '<button type="button" id="quarterReviewTalkToggle" aria-expanded="' + (state.showTalking ? 'true' : 'false') + '"'
            + ' style="background:#d84315;color:#fff;border:none;border-radius:8px;padding:11px 20px;cursor:pointer;'
            + 'font-weight:700;font-size:0.98em;">' + _escape(label) + '</button>'
            + (state.showTalking ? '' : '<span style="font-size:0.88em;color:var(--text-tertiary);">'
                + _escape(ctx.quarterLabel) + ' for ' + _escape(ctx.firstName)
                + ': what is working, what to work on, and questions to ask.</span>')
            + '</div>';
    }

    var TALK_TONES = {
        wins: '#16a34a',
        focus: '#c2410c',
        moreFocus: '#c2410c',
        watch: '#d97706',
        moreWins: '#16a34a',
        together: '#0f766e',
        ask: '#4f46e5',
        notes: '#64748b'
    };

    function _talkingPanel(tp) {
        return '<div style="padding:16px 18px;background:var(--bg-surface);border-radius:8px;border:2px solid #d84315;">'
            + '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px;">'
            + '<h4 style="margin:0;color:var(--text-primary);font-size:1.1em;">' + _escape(tp.title) + '</h4>'
            + _button('quarterReviewTalkCopy', 'Copy talking points', '#0f766e')
            + '</div>'
            + '<div id="quarterReviewTalkBody">' + _talkingSections(tp) + '</div>'
            + '</div>';
    }

    function _talkingSections(tp) {
        return tp.sections.map(function (s) {
            var tone = TALK_TONES[s.id] || 'var(--border)';
            var items = (s.items || []).map(function (item) {
                var aside = [item.goal, item.sample].filter(Boolean).join(', ');
                return '<div style="padding:7px 0;border-bottom:1px solid var(--border);">'
                    + '<div style="font-weight:700;color:var(--text-primary);">' + _escape(item.label)
                    + (aside ? ' <span style="font-weight:400;font-size:0.84em;color:var(--text-tertiary);">'
                        + _escape(aside) + '</span>' : '')
                    + '</div>'
                    + '<div style="font-size:0.95em;color:var(--text-primary);font-variant-numeric:tabular-nums;">'
                    + _escape(item.numbers) + '</div>'
                    + (item.said ? '<div style="font-size:0.92em;color:var(--text-secondary);margin-top:2px;">'
                        + _escape(item.said) + '</div>' : '')
                    + '</div>';
            }).join('');
            var lines = (s.lines || []).length
                ? '<ul style="margin:4px 0 0;padding-left:20px;">' + s.lines.map(function (line) {
                    return '<li style="padding:3px 0;font-size:0.94em;color:var(--text-primary);white-space:pre-wrap;">'
                        + _escape(line) + '</li>';
                }).join('') + '</ul>'
                : '';
            return '<div style="margin-top:12px;padding-left:12px;border-left:4px solid ' + tone + ';">'
                + '<div style="font-weight:700;font-size:0.8em;letter-spacing:0.04em;text-transform:uppercase;color:' + tone + ';">'
                + _escape(s.heading) + '</div>'
                + items + lines + '</div>';
        }).join('');
    }

    /* The table Scott asked for: one row per measure, one column per quarter,
     * the goal alongside, and which way it went. */
    function _progressionTable(ctx) {
        var qt = _qt();
        var headCells = ctx.quarters.map(function (q) {
            return '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">'
                + _escape(q.name)
                + (q.empty ? '<div style="font-weight:400;font-size:0.75em;color:var(--text-tertiary);">no data</div>' : '')
                + '</th>';
        }).join('');

        var rows = ctx.metrics.map(function (m) {
            return _metricRow(m, ctx);
        }).join('');

        var rel = ctx.reliability;
        if (rel.hasValue) rows += _reliabilityRow(rel, ctx);

        return '<div style="padding:16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">'
            + '<h4 style="margin:0 0 4px;color:var(--text-primary);">' + _escape(ctx.name)
            + ' across ' + _escape(state.year) + '</h4>'
            + '<p style="margin:0 0 12px;font-size:0.85em;color:var(--text-tertiary);">'
            + 'Each quarter is built from the uploads covering it, never from a year-to-date file.</p>'
            + '<div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:0.9em;">'
            + '<thead><tr style="background:var(--bg-surface-raised);">'
            + '<th style="padding:10px 8px;text-align:left;border-bottom:2px solid var(--border);">Measure</th>'
            + headCells
            + '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">Goal</th>'
            + '<th style="padding:10px 8px;text-align:center;border-bottom:2px solid var(--border);">Across the year</th>'
            + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    }

    function _metricRow(m, ctx) {
        var byQuarter = {};
        m.series.points.forEach(function (p) { byQuarter[p.quarter] = p; });
        var thin = {};
        (m.usablePoints || []).forEach(function (p) { thin[p.quarter] = true; });

        var cells = ctx.quarters.map(function (q) {
            var p = byQuarter[q.quarter];
            if (!p || !p.hasValue) {
                return '<td style="padding:8px;text-align:center;color:var(--text-tertiary);">-</td>';
            }
            // A survey quarter too thin to quote is shown, greyed, so the
            // supervisor can see it exists and see why the prose skipped it.
            var quoted = !m.usablePoints || !m.usablePoints.length || thin[q.quarter];
            var profiles = (window.DevCoachModules || {}).metricProfiles || {};
            var meets = !m.target ? null
                : typeof profiles.valueMeetsTarget === 'function'
                    ? profiles.valueMeetsTarget(m.metricKey, p.value, m.target)
                    : (m.target.type === 'min' ? p.value >= m.target.value : p.value <= m.target.value);
            var colour = !quoted ? 'var(--text-tertiary)' : meets === true ? '#16a34a' : meets === false ? '#c2410c' : 'var(--text-primary)';
            return '<td style="padding:8px;text-align:center;font-weight:600;color:' + colour + ';"'
                + (quoted ? '' : ' title="Too few survey responses to read as a trend"')
                + '>' + _escape(_display(m.metricKey, p.value))
                + (quoted ? '' : ' <span style="font-weight:400;">(thin)</span>') + '</td>';
        }).join('');

        return '<tr style="border-bottom:1px solid var(--border);">'
            + '<td style="padding:8px;">' + _escape(m.label) + '</td>'
            + cells
            + '<td style="padding:8px;text-align:center;color:var(--text-secondary);">'
            + (m.target ? _escape(_display(m.metricKey, m.target.value)) : '-') + '</td>'
            + '<td style="padding:8px;text-align:center;">' + _movementCell(m) + '</td></tr>';
    }

    function _movementCell(m) {
        var moved = m.movedAcross;
        if (!moved) return '<span style="color:var(--text-tertiary);">one quarter only</span>';
        if (moved.size === 0) return '<span style="color:var(--text-secondary);">held steady</span>';
        var good = moved.improved === true;
        var arrow = moved.raw > 0 ? '↑' : '↓';
        var colour = good ? '#16a34a' : '#c2410c';
        var amount = Math.round(Math.abs(moved.raw) * 10) / 10;
        return '<span style="color:' + colour + ';font-weight:600;">' + arrow + ' ' + amount
            + '</span> <span style="color:var(--text-tertiary);font-size:0.85em;">'
            + (good ? 'better' : 'worse') + '</span>';
    }

    /* Missed hours get their own row because they are the one measure shown as
     * the year's running total rather than the quarter's own figure. */
    function _reliabilityRow(rel, ctx) {
        var byQuarter = {};
        rel.checkpoints.forEach(function (c) { byQuarter[c.quarter] = c; });
        var cells = ctx.quarters.map(function (q) {
            var c = byQuarter[q.quarter];
            // When the year figure comes from a year-to-date upload covering
            // months these quarters do not, the per-quarter running totals
            // climb to a different number. Showing both would put two
            // different answers for the year on one row.
            if (!rel.checkpointsReconcile || !c || c.runningTotal === null) {
                return '<td style="padding:8px;text-align:center;color:var(--text-tertiary);">-</td>';
            }
            var over = rel.target && c.runningTotal > rel.target.value;
            return '<td style="padding:8px;text-align:center;font-weight:600;color:'
                + (over ? '#c2410c' : '#16a34a') + ';">'
                + _escape(_display('reliability', c.runningTotal)) + '</td>';
        }).join('');

        var summary;
        if (!rel.target) {
            // No allowance configured is not the same as being inside one.
            summary = '<span style="color:var(--text-tertiary);">no allowance set</span>';
        } else if (rel.partialYear) {
            // The allowance covers a year this associate has not worked, so
            // the hours are shown and the reading against it is not.
            summary = '<span style="color:#d97706;font-weight:600;">'
                + _escape(_display('reliability', rel.yearToDate)) + ' in '
                + (rel.quartersCovered === 1 ? '1 quarter' : rel.quartersCovered + ' quarters')
                + '</span>';
        } else if (rel.meetsTarget === false) {
            summary = '<span style="color:#c2410c;font-weight:600;">'
                + _escape(_display('reliability', rel.overBy)) + ' over</span>';
        } else if (rel.meetsTarget === true) {
            summary = '<span style="color:#16a34a;font-weight:600;">inside the allowance</span>';
        } else {
            summary = '<span style="color:var(--text-tertiary);">-</span>';
        }

        return '<tr style="border-bottom:1px solid var(--border);background:var(--bg-surface-raised);">'
            + '<td style="padding:8px;">Reliability'
            + '<div style="font-size:0.78em;color:var(--text-tertiary);font-weight:400;">'
            + (rel.fromYtdUpload
                ? 'year to date, ' + _escape(_display('reliability', rel.yearToDate)) + ' from the year-to-date upload'
                : rel.partialYear
                    ? 'running total, from ' + _escape(rel.firstQuarterWithData ? rel.firstQuarterWithData.name : 'their first quarter')
                    : 'year running total')
            + '</div></td>'
            + cells
            + '<td style="padding:8px;text-align:center;color:var(--text-secondary);">'
            + (rel.target ? _escape(_display('reliability', rel.target.value)) : '-') + '</td>'
            + '<td style="padding:8px;text-align:center;">' + summary + '</td></tr>';
    }

    function _notesPanel(ctx, notes, note) {
        return '<div style="padding:16px;background:var(--bg-surface);border-radius:8px;border:1px solid var(--border);">'
            + '<h4 style="margin:0 0 10px;color:var(--text-primary);">Check-in document</h4>'

            // Shown as well as copied. It is the line that makes the rest a
            // file note, so a supervisor should see what it says before it
            // goes into a record.
            + '<div style="padding:9px 11px;margin-bottom:12px;background:var(--bg-surface-raised);'
            + 'border-radius:6px;border:1px solid var(--border);font-size:0.88em;line-height:1.5;'
            + 'color:var(--text-secondary);white-space:pre-wrap;">' + _escape(notes.header) + '</div>'

            + '<label for="quarterReviewNotes" style="display:block;font-weight:600;margin-bottom:6px;color:var(--text-primary);">'
            + 'Your own notes for ' + _escape(ctx.firstName) + ' (optional)</label>'
            + '<textarea id="quarterReviewNotes" rows="2" placeholder="e.g. Took on the offline documents project. Finished the APS Percipio track."'
            + ' style="width:100%;padding:9px;border:1px solid var(--border);border-radius:4px;font-family:inherit;'
            + 'font-size:0.92em;resize:vertical;margin-bottom:14px;">' + _escape(note) + '</textarea>'

            + '<div style="display:grid;gap:12px;">'
            + _box('Progress & Strengths', 'quarterReviewBox1', notes.box1)
            + _box('Areas of Focus', 'quarterReviewBox2', notes.box2)
            + '</div>'

            + '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;">'
            + _button('quarterReviewCopyAll', 'Copy both boxes', '#16a34a')
            + _button('quarterReviewCopy1', 'Copy strengths', '#0f766e')
            + _button('quarterReviewCopy2', 'Copy focus', '#0f766e')
            + _button('quarterReviewCopilot', 'Reword in Copilot', '#4f46e5')
            + _button('quarterReviewCopyPrompt', 'Copy the Copilot prompt', '#64748b')
            + '</div>'
            + '<p style="margin:10px 0 0;font-size:0.82em;color:var(--text-tertiary);">'
            + 'The text above is written here from the numbers in the table, so it says the same thing every time. '
            + 'Copilot is there when a particular associate needs the tone moved.</p>'
            + '</div>';
    }

    function _box(title, id, text) {
        return '<div style="border:1px solid var(--border);border-radius:6px;overflow:hidden;">'
            + '<div style="padding:7px 11px;background:var(--bg-surface-raised);font-weight:700;font-size:0.88em;'
            + 'color:var(--text-primary);border-bottom:1px solid var(--border);">' + _escape(title) + '</div>'
            + '<div id="' + id + '" style="padding:11px;font-size:0.92em;line-height:1.55;color:var(--text-primary);'
            + 'white-space:pre-wrap;">' + _escape(text) + '</div></div>';
    }

    function _button(id, label, colour) {
        return '<button type="button" id="' + id + '" style="background:' + colour + ';color:#fff;border:none;'
            + 'border-radius:6px;padding:8px 15px;cursor:pointer;font-weight:600;font-size:0.87em;">'
            + _escape(label) + '</button>';
    }

    /* ── Wiring ── */

    function _on(id, event, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener(event, handler);
    }

    function _bindTopControls() {
        _on('quarterReviewYear', 'change', function (e) {
            var y = parseInt(e.target.value, 10);
            if (Number.isInteger(y)) {
                state.year = y;
                state.quarter = null;
                render();
            }
        });
        _on('quarterReviewEmployee', 'change', function (e) {
            state.employee = e.target.value;
            render();
        });
        Array.prototype.forEach.call(
            document.querySelectorAll('.quarter-review-q'),
            function (btn) {
                btn.addEventListener('click', function () {
                    state.quarter = parseInt(btn.dataset.quarter, 10);
                    render();
                });
            }
        );
    }

    function _bindAssociateControls() {
        // Saved on blur, and the two boxes are rewritten in place rather than
        // the panel being re-rendered.
        //
        // A full render here destroyed the element that was about to receive
        // the click that caused the blur, so typing a note and then clicking
        // Copy did nothing at all: the button was replaced between mousedown
        // and mouseup. Rewriting the text of two divs leaves every control
        // where it was.
        _on('quarterReviewNotes', 'blur', function (e) {
            var value = e.target.value || '';
            if (value === (state.notes[_noteKey()] || '')) return;
            state.notes[_noteKey()] = value;
            _saveNotes();
            _refreshBoxes();
        });

        _on('quarterReviewTalkToggle', 'click', function () {
            state.showTalking = !state.showTalking;
            render();
        });
        _on('quarterReviewTalkCopy', 'click', function () {
            var built = _currentDocument();
            if (built) _copy(built.talking.text, 'Talking points copied.');
        });

        // Rebuilt at click time rather than captured now, so a note typed
        // since the last render is in whatever gets copied.
        _on('quarterReviewCopyAll', 'click', function () {
            var built = _currentDocument();
            if (built) _copy(built.notes.full, 'Check-in document copied.');
        });
        _on('quarterReviewCopy1', 'click', function () {
            var built = _currentDocument();
            if (built) _copy(built.notes.box1, 'Progress and strengths copied.');
        });
        _on('quarterReviewCopy2', 'click', function () {
            var built = _currentDocument();
            if (built) _copy(built.notes.box2, 'Areas of focus copied.');
        });
        _on('quarterReviewCopyPrompt', 'click', function () {
            var built = _currentDocument();
            if (built) _copy(built.prompt, 'Copilot prompt copied.');
        });
        _on('quarterReviewCopilot', 'click', function () {
            var built = _currentDocument();
            if (!built) return;
            // openCopilotWithPrompt copies the prompt and raises its own
            // toast. Copying here as well put the same text on the clipboard
            // twice and stacked two notifications saying different things.
            if (typeof window.openCopilotWithPrompt === 'function') {
                window.openCopilotWithPrompt(built.prompt,
                    'Q' + state.quarter + ' check-in for ' + built.ctx.firstName);
            } else {
                _copy(built.prompt, 'Prompt copied. Paste it into Copilot.');
            }
        });
    }

    /* Rewrite just the two boxes, leaving every control in place. */
    function _refreshBoxes() {
        var built = _currentDocument();
        if (!built) return;
        var one = document.getElementById('quarterReviewBox1');
        var two = document.getElementById('quarterReviewBox2');
        if (one) one.textContent = built.notes.box1;
        if (two) two.textContent = built.notes.box2;
        // The note is the last section of the talking points too.
        var talk = document.getElementById('quarterReviewTalkBody');
        if (talk) talk.innerHTML = _talkingSections(built.talking);
    }

    function _currentDocument() {
        var qr = _qr();
        if (!qr || !state.employee) return null;
        var ctx = qr.buildContext(state.employee, state.year, {
            quarters: state.quarters,
            throughQuarter: state.quarter
        });
        if (!ctx) return null;
        var note = state.notes[_noteKey()] || '';
        return {
            ctx: ctx,
            notes: qr.buildNotes(ctx, { notes: note }),
            prompt: qr.buildPrompt(ctx, { notes: note }),
            talking: qr.buildTalkingPoints(ctx, { notes: note })
        };
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.quarterReviewUi = {
        render: render,
        state: state
    };
    // The Quarterly tab's entry point. script.js calls this when the tab opens.
    window.renderQuarterReview = render;
})();
