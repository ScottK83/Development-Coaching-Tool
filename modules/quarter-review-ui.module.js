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
        notes: {}
    };

    function _defaultYear() {
        return new Date().getFullYear();
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

        if (state.year === null) state.year = _defaultYear();
        if (!Object.keys(state.notes).length) state.notes = _loadNotes();

        state.quarters = qt.buildYearQuarters(state.year);
        var elapsed = state.quarters.map(function (q) { return q.quarter; });
        if (!elapsed.length) {
            host.innerHTML = _shell(_emptyYear());
            _bindTopControls();
            return;
        }
        if (elapsed.indexOf(state.quarter) < 0) state.quarter = elapsed[elapsed.length - 1];

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

        var quarterButtons = (state.quarters || []).map(function (q) {
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
        return _progressionTable(ctx) + _notesPanel(ctx, notes, note);
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
            var meets = m.target ? (m.target.type === 'min' ? p.value >= m.target.value : p.value <= m.target.value) : null;
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
            prompt: qr.buildPrompt(ctx, { notes: note })
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
