(function () {
    'use strict';

    // ============================================
    // QUARTER RECAP MODULE
    //
    // The short email an associate gets after their quarterly check-in: where
    // each of the four KPIs sat in Q1, Q2 and Q3, the hours missed against the
    // year's allowance, and a picture of the four KPIs. Plus the log of which
    // ones went out, because eighteen of these in a week is a list, and a list
    // needs ticking off.
    //
    // The facts are quarter-review's buildContext, the same ones the check-in
    // document and the talking points are written from, so what the associate
    // is sent cannot disagree with what was said in the room or put on file.
    // A survey quarter too thin to quote there is not quoted here either.
    //
    // Written TO the associate, so second person, unlike the file note. The
    // house rules hold all the same, and the tests sweep for them:
    //   - No dash characters of any kind in a string.
    //   - No rating vocabulary and no placings. This goes to the associate.
    //   - Hours missed are the year's running total against the allowance,
    //     said as a fact in one line of text, never as something to work on,
    //     and never in the picture: a pasted picture cannot be edited, and
    //     an hours figure sometimes needs taking out before it goes.
    //   - No caveats about the data. What cannot be shown cleanly is left
    //     out, and Scott is told in the panel instead.
    // ============================================

    // The four a check-in is about, in the order the document raises them.
    // Read from quarter-review so the two can never disagree; the literal is
    // only for a load order where it is missing.
    var FALLBACK_KPIS = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];
    var RELIABILITY = 'reliability';
    var STORE = 'quarterRecapEmails';
    // How long a clipboard write gets before it is treated as failed. A write
    // that never settles otherwise leaves the button doing nothing at all.
    var COPY_TIMEOUT_MS = 4000;
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    function _mod(name) { return (window.DevCoachModules || {})[name] || null; }
    function _registry() { return window.METRICS_REGISTRY || {}; }

    function _coreKpis() {
        var qr = _mod('quarterReview');
        return (qr && Array.isArray(qr.CORE_METRICS) && qr.CORE_METRICS.length)
            ? qr.CORE_METRICS.slice() : FALLBACK_KPIS.slice();
    }

    function _display(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') {
            return window.formatMetricDisplay(metricKey, value);
        }
        return String(Math.round(value * 10) / 10);
    }

    // A goal or an allowance is a round number somebody set, so it is written
    // as one: "93%" and "18 hrs", not "93.0%" and "18.0 hrs". The hours total
    // reads the same way. Measured KPI values keep the app's precision,
    // because the at goal mark is judged on exactly the number printed.
    function _round(metricKey, value) {
        return String(_display(metricKey, value)).replace(/\.0(?=(%|s| hrs)?$)/, '');
    }

    // Judged on the number as it is printed, so a tile never sits unticked
    // under a value that reads exactly the goal.
    function _meets(metricKey, value, target) {
        if (!target || !Number.isFinite(value)) return null;
        var profiles = _mod('metricProfiles') || {};
        if (typeof profiles.valueMeetsTarget === 'function') {
            return profiles.valueMeetsTarget(metricKey, value, target);
        }
        return target.type === 'max' ? value <= target.value : value >= target.value;
    }

    function _stableBand(metricKey) {
        var qr = _mod('quarterReview');
        if (qr && typeof qr.stableBand === 'function') return qr.stableBand(metricKey);
        var unit = (_registry()[metricKey] || {}).unit;
        return unit === 'sec' ? 8 : unit === 'hrs' ? 0.5 : 1;
    }

    // "30 seconds", "4.5 points". The check-in document's wording, so a move
    // reads the same in the email as on file.
    function _movementAmount(metricKey, size) {
        var qr = _mod('quarterReview');
        if (qr && typeof qr.movementAmount === 'function') return qr.movementAmount(metricKey, size);
        var unit = (_registry()[metricKey] || {}).unit;
        var n = Math.round(size * 10) / 10;
        if (unit === 'sec') return Math.round(size) + (Math.round(size) === 1 ? ' second' : ' seconds');
        if (unit === '%') return n + (n === 1 ? ' point' : ' points');
        return String(n);
    }

    // The same move, short enough for the picture: "30s", "4.5 pts".
    function _shortAmount(metricKey, size) {
        var unit = (_registry()[metricKey] || {}).unit;
        var n = Math.round(size * 10) / 10;
        if (unit === 'sec') return Math.round(size) + 's';
        if (unit === '%') return n + (n === 1 ? ' pt' : ' pts');
        return String(n);
    }

    // Positive when `now` is better than `before`, with the metric's polarity.
    function _betterBy(metricKey, now, before, isReverse) {
        var mm = _mod('metricMovement');
        if (mm && typeof mm.performanceDelta === 'function') {
            var d = mm.performanceDelta(metricKey, now, before);
            if (Number.isFinite(d)) return d;
        }
        return isReverse ? before - now : now - before;
    }

    function _goalText(metricKey, target) {
        if (!target || !Number.isFinite(target.value)) return '';
        return _round(metricKey, target.value) + (target.type === 'max' ? ' or lower' : ' or better');
    }

    // "Q3", "Q2 and Q3", "Q1, Q2 and Q3".
    function _listNames(names) {
        if (names.length <= 1) return names[0] || '';
        return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    }

    // "2026-10-05" as "October 5".
    function _monthDay(iso) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
        if (!m) return '';
        var name = MONTHS[Number(m[2]) - 1];
        return name ? name + ' ' + Number(m[3]) : '';
    }

    /* ── The facts ── */

    /* One associate's quarters, shaped for the email and the picture.
     *
     * The columns run from the first quarter this associate has a reading in
     * through the check-in quarter. Someone who joined in April gets Q2 and
     * Q3, not an empty Q1 they were never in.
     */
    function buildRecapModel(ctx) {
        if (!ctx || !Array.isArray(ctx.quarters) || !ctx.quarters.length) return null;

        var byKey = {};
        (ctx.metrics || []).forEach(function (m) { byKey[m.metricKey] = m; });

        // Per KPI, the quarters solid enough to quote. For a survey metric
        // that leaves out a quarter resting on one or two responses, the same
        // rule the check-in document holds to; for the rest it is every
        // quarter measured.
        var raw = _coreKpis().map(function (key) {
            var m = byKey[key];
            if (!m) return null;
            var shown = {};
            (m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured)
                .forEach(function (p) {
                    if (p && p.hasValue && Number.isFinite(p.value)) shown[p.quarter] = p;
                });
            return { m: m, shown: shown };
        }).filter(function (k) { return k && Object.keys(k.shown).length; });
        if (!raw.length) return null;

        var current = ctx.current || ctx.quarters[ctx.quarters.length - 1];
        var firstWithData = null;
        ctx.quarters.forEach(function (q) {
            if (firstWithData !== null) return;
            if (raw.some(function (k) { return !!k.shown[q.quarter]; })) firstWithData = q.quarter;
        });
        var columns = ctx.quarters.filter(function (q) {
            return q.quarter >= firstWithData && q.quarter <= current.quarter;
        }).map(function (q) { return { quarter: q.quarter, name: q.name }; });

        var kpis = raw.map(function (k) {
            var m = k.m;
            var target = m.target && Number.isFinite(m.target.value)
                ? { value: m.target.value, type: m.target.type } : null;
            var points = columns.map(function (col) {
                var p = k.shown[col.quarter];
                return p ? {
                    quarter: col.quarter, name: col.name, value: p.value,
                    display: _display(m.metricKey, p.value),
                    meets: _meets(m.metricKey, p.value, target),
                    shown: true
                } : { quarter: col.quarter, name: col.name, value: null, display: '', meets: null, shown: false };
            });
            var shownPoints = points.filter(function (p) { return p.shown; });
            var nowPoint = points.filter(function (p) { return p.quarter === current.quarter && p.shown; })[0] || null;

            // The check-in quarter had a reading, but too few surveys to
            // quote. The email cannot say so, so it simply carries no mark,
            // and Scott is told in the panel.
            var seriesNow = (m.series.points || []).filter(function (p) { return p.quarter === current.quarter; })[0];
            var thinNow = (!nowPoint && seriesNow && seriesNow.hasValue)
                ? { surveys: seriesNow.surveyCount || 0 } : null;

            return {
                metricKey: m.metricKey,
                label: m.label,
                target: target,
                goalText: _goalText(m.metricKey, target),
                isReverse: !!m.isReverse,
                points: points,
                // The mark judges the check-in quarter and nothing older. A
                // Q3 email that ticks a KPI on its Q2 number tells someone
                // whose Q3 was poor that it was fine.
                verdict: nowPoint ? nowPoint.meets : null,
                thinNow: thinNow,
                improvement: _improvement(m.metricKey, shownPoints, !!m.isReverse)
            };
        });

        var quartersShown = columns.filter(function (col) {
            return kpis.some(function (k) {
                return k.points.some(function (p) { return p.shown && p.quarter === col.quarter; });
            });
        }).map(function (col) { return col.name; });

        return {
            name: ctx.name,
            firstName: ctx.firstName,
            year: ctx.year,
            quarter: current.quarter,
            quarterName: current.name,
            columns: columns,
            quartersShown: quartersShown,
            kpis: kpis,
            hours: _hoursFacts(ctx)
        };
    }

    /* A move worth saying in words, or null.
     *
     * Only when the newest quarter is clearly better than the first one shown
     * AND the newest step did not go back the wrong way by more than noise.
     * Handle time of 618s, 510s, 589s is better than January and worse than
     * the quarter before, and "down 29 seconds" would tell that associate their
     * Q3 improved. The check-in document calls that path "moved around".
     */
    function _improvement(metricKey, shown, isReverse) {
        if (!shown || shown.length < 2) return null;
        var first = shown[0];
        var last = shown[shown.length - 1];
        var prev = shown[shown.length - 2];
        var band = _stableBand(metricKey);

        var overall = _betterBy(metricKey, last.value, first.value, isReverse);
        if (!(overall > 0) || Math.abs(last.value - first.value) <= band) return null;
        var step = _betterBy(metricKey, last.value, prev.value, isReverse);
        if (step < 0 && Math.abs(last.value - prev.value) > band) return null;

        var size = Math.abs(last.value - first.value);
        var way = last.value < first.value ? 'down ' : 'up ';
        return {
            words: way + _movementAmount(metricKey, size),
            short: way + _shortAmount(metricKey, size),
            since: first.name
        };
    }

    /* Hours missed: the year's total, the allowance, and the date it runs to.
     *
     * The total is the check-in's own figure, which already takes the year to
     * date upload over a sum of quarters. No quarter's own hours appear, and
     * nothing here says better or worse: a total only goes up.
     */
    function _hoursFacts(ctx) {
        var rel = ctx.reliability;
        if (!rel || !rel.hasValue || !Number.isFinite(rel.yearToDate)) return null;
        var allowance = rel.target && Number.isFinite(rel.target.value) ? rel.target.value : null;
        var missing = (rel.checkpoints || []).filter(function (c) { return !c.hasValue; })
            .map(function (c) { return c.name; });
        return {
            total: rel.yearToDate,
            display: _round(RELIABILITY, rel.yearToDate),
            zero: Math.round(rel.yearToDate * 10) === 0,
            allowance: allowance,
            allowanceDisplay: allowance !== null ? _round(RELIABILITY, allowance) : '',
            through: rel.through || null,
            // No year to date figure and a quarter with no hours in it. That
            // is either a part year or a quarter nobody uploaded, and nothing
            // here can tell which, so the hours are not sent at all.
            partialYear: !!rel.partialYear,
            missingQuarters: missing,
            fromYtd: !!rel.fromYtdUpload,
            summed: Number.isFinite(rel.summedFromQuarters) ? rel.summedFromQuarters : null
        };
    }

    /* ── The email ── */

    // ✅ at goal in the check-in quarter, 🔸 not yet, nothing when the check-in
    // quarter has no number to judge. Two marks, matching the picture's two
    // states. 📈 was tried and dropped: on handle time a rising chart reads
    // as "went up".
    function _kpiLine(k) {
        var mark = k.verdict === true ? '✅ ' : k.verdict === false ? '🔸 ' : '';
        var numbers = k.points.filter(function (p) { return p.shown; }).map(function (p) {
            return p.name + ' ' + p.display;
        }).join(', ');
        return mark + k.label + ': ' + numbers
            + (k.improvement ? ', ' + k.improvement.words : '')
            + (k.goalText ? ' (goal ' + k.goalText + ')' : '');
    }

    /* One line on where the check-in quarter left them, in the same spirit as
     * the closes on the year to date email. Counted over the KPIs the
     * check-in quarter actually judged, and never over hours. */
    function _countLine(model) {
        var judged = model.kpis.filter(function (k) { return k.verdict !== null; });
        if (!judged.length) return '';
        var met = judged.filter(function (k) { return k.verdict === true; }).length;
        var last = model.quarter >= 4;
        var nextQ = 'Q' + (model.quarter + 1);
        if (met === judged.length && judged.length === model.kpis.length) {
            return 'All of these are at goal in ' + model.quarterName + '. That is a great way to '
                + (last ? 'finish the year' : 'head into ' + nextQ) + ' 🌟';
        }
        if (met * 2 > judged.length) {
            return 'Most of these are at goal in ' + model.quarterName + '. Keep it going 💪';
        }
        if (met > 0) {
            return 'Some of these are already at goal, and '
                + (last ? 'next year is a fresh start for the rest.' : nextQ + ' is a full quarter to bring the rest along.');
        }
        return last
            ? 'Next year is a fresh start on these, and I\'m here to help.'
            : nextQ + ' is a full quarter to move these, and I\'m here to help.';
    }

    // "Reliability: 14.5 hrs missed in 2026 through October 5 (allowance 18 hrs)."
    function _hoursLine(model) {
        var h = model.hours;
        if (!h || h.partialYear) return '';
        var through = h.through ? _monthDay(h.through) : '';
        return 'Reliability: ' + (h.zero ? 'no hours' : h.display) + ' missed in ' + model.year
            + (through ? ' through ' + through : '')
            + (h.allowance !== null ? ' (allowance ' + h.allowanceDisplay + ')' : '') + '.';
    }

    function _href(to, cc, subject, body) {
        return 'mailto:' + encodeURIComponent(to || '')
            + '?' + (cc ? 'cc=' + encodeURIComponent(cc) + '&' : '')
            + 'subject=' + encodeURIComponent(subject)
            + '&body=' + encodeURIComponent(body);
    }

    function _recipient(name) {
        var utils = _mod('sharedUtils');
        if (utils && typeof utils.resolveAssociateEmail === 'function') {
            try { return utils.resolveAssociateEmail(name) || ''; } catch (e) { return ''; }
        }
        return '';
    }

    function _cc() {
        var utils = _mod('sharedUtils');
        if (utils && typeof utils.getCoachingCcEmail === 'function') {
            try { return utils.getCoachingCcEmail() || ''; } catch (e) { return ''; }
        }
        return '';
    }

    /* Short on purpose. The text carries the numbers in a form that survives
     * any mail client and can be edited before sending; the picture carries
     * the shape of the year at a glance.
     *
     * One line per KPI rather than anything laid out: a mailto body is plain
     * text and Outlook collapses runs of spaces, so a spaced table arrives as
     * a wall of words (center-ranking found that out twice). Nothing forward
     * looking follows the hours line, so it cannot read as the thing to fix.
     *
     * options.includeHours: false leaves the hours line out, for an
     * associate whose figure Scott wants checked first.
     */
    function buildRecapEmail(ctx, options) {
        var opts = options || {};
        var model = opts.model || buildRecapModel(ctx);
        if (!model || !model.kpis.length) return null;

        var lines = [];
        lines.push('Hi ' + model.firstName + ',');
        lines.push('');
        lines.push('Thanks for sitting down with me for your ' + model.quarterName + ' check-in. '
            + 'Here\'s where you were in ' + _listNames(model.quartersShown) + ':');
        lines.push('');
        model.kpis.forEach(function (k) { lines.push(_kpiLine(k)); });
        var count = _countLine(model);
        if (count) {
            lines.push('');
            lines.push(count);
        }
        var hours = opts.includeHours === false ? '' : _hoursLine(model);
        if (hours) {
            lines.push('');
            lines.push(hours);
        }
        lines.push('');
        lines.push('Happy to walk through any of it.');

        var body = lines.join('\n');
        var subject = 'Your ' + model.quarterName + ' check-in recap';
        var to = opts.to !== undefined ? opts.to : _recipient(model.name);
        var cc = opts.cc !== undefined ? opts.cc : _cc();
        return {
            to: to,
            cc: cc,
            subject: subject,
            body: body,
            href: _href(to, cc, subject, body),
            includedHours: !!hours,
            model: model
        };
    }

    /* What Scott should know before this one goes, said in the panel and
     * never in the email or the picture. Each is something the email quietly
     * left out or a number worth a second look. */
    function buildRecapNotes(model, options) {
        if (!model) return [];
        var opts = options || {};
        var notes = [];
        var first = model.firstName;
        var h = model.hours;
        if (h && h.partialYear) {
            notes.push('Hours are left out of ' + first + '\'s email. There is no year to date figure, and '
                + _listNames(h.missingQuarters) + (h.missingQuarters.length === 1 ? ' has' : ' have')
                + ' no hours uploaded, so the total could be short. Add them by hand if you have the number.');
        } else if (h && opts.includeHours !== false) {
            if (h.allowance !== null && h.total > h.allowance * 2) {
                notes.push(h.display + ' is more than twice the ' + h.allowanceDisplay
                    + ' allowance. If any of it is protected leave, untick Include the hours line.');
            }
            if (h.fromYtd && h.summed !== null && Math.abs(h.summed - h.total) > 0.5) {
                notes.push('The year to date file says ' + h.display + ', and the quarters add up to '
                    + _round(RELIABILITY, h.summed) + '. The email uses the year to date figure.');
            }
        }
        model.kpis.forEach(function (k) {
            if (!k.thinNow) return;
            var n = k.thinNow.surveys;
            notes.push(k.label + ' has no ' + model.quarterName + ' number in the email: '
                + (n === 1 ? 'one survey' : n + ' surveys') + ' in ' + model.quarterName + ', too few to quote.');
        });
        return notes;
    }

    /* ── The picture ──
     *
     * A scoreboard: one row per KPI, one tile per quarter, the number big,
     * green with a tick when it is at goal. Line charts were tried first and
     * dropped. Three points auto scaled to fill a panel made a 0.3 point
     * wobble in adherence look like a climb or a crash, which on the real Q3
     * data was most of the team, and handle time had to be drawn upside down.
     * A row turning green by Q3 is the progress in one look, for every KPI
     * the same way round.
     *
     * Drawn straight onto a canvas with its own colours, like the year card,
     * so the app's dark theme can never reach it. The layout is worked out
     * separately from the drawing so what goes into the picture can be
     * asserted; a canvas can only be looked at.
     */

    var IMG_FONT = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
    var COLORS = {
        ink: '#0f2a4a',
        text: '#26364a',
        muted: '#6b7887',
        faint: '#c3ccd6',
        header: '#0f2a4a',
        headerSub: '#9fc0e4',
        rule: '#eef2f7',
        tileBorder: '#d5dde6',
        emptyFill: '#f8fafc',
        emptyBorder: '#e3e8ee',
        meetsFill: '#e4f3e8',
        meetsBorder: '#b9dfc4',
        meetsInk: '#1a6b32',
        meetsMark: '#2e7d32'
    };

    // Sizes in CSS pixels. 640 wide sits inside a mail reading pane.
    function layoutRecapCard(model) {
        if (!model || !model.kpis || !model.kpis.length || !model.columns || !model.columns.length) return null;
        var W = 640, padX = 24, headerH = 72;
        var labelW = 170, changeW = 86, sectionGap = 12, tileGap = 8;
        var n = model.columns.length;
        var tilesSpace = W - padX * 2 - labelW - changeW - sectionGap * 2;
        var tileW = Math.min(120, (tilesSpace - tileGap * (n - 1)) / n);
        var tileH = 46, rowH = 58;
        var tilesX = padX + labelW + sectionGap;
        var changeX = tilesX + n * tileW + (n - 1) * tileGap + sectionGap;
        var colHeadY = headerH + 22;
        var rowTop = colHeadY + 14;
        var rows = model.kpis.map(function (k, i) {
            return { metricKey: k.metricKey, y: rowTop + i * rowH };
        });
        var H = rowTop + rows.length * rowH + 30;
        return {
            W: W, H: H, padX: padX, headerH: headerH,
            labelW: labelW, tilesX: tilesX, tileW: tileW, tileH: tileH, tileGap: tileGap,
            changeX: changeX, changeW: changeW, colHeadY: colHeadY, rowH: rowH, rows: rows,
            // The first name is the biggest thing on the card on purpose: it
            // is the last check that the right person's picture was pasted.
            titleSize: 22,
            valueSize: Math.min(21, Math.max(15, Math.floor(tileW * 0.21))),
            footerY: H - 15
        };
    }

    function _roundRect(g, x, y, w, h, r) {
        g.beginPath();
        g.moveTo(x + r, y);
        g.lineTo(x + w - r, y);
        g.arcTo(x + w, y, x + w, y + r, r);
        g.lineTo(x + w, y + h - r);
        g.arcTo(x + w, y + h, x + w - r, y + h, r);
        g.lineTo(x + r, y + h);
        g.arcTo(x, y + h, x, y + h - r, r);
        g.lineTo(x, y + r);
        g.arcTo(x, y, x + r, y, r);
        g.closePath();
    }

    /* options.scale: pixels per CSS pixel. The copy that goes on the
     * clipboard is drawn at 1, because Outlook places a pasted picture at its
     * pixel size and a 2x card lands twice as wide as the email. The one on
     * screen can be drawn at the screen's own density. */
    function drawRecapCard(model, options) {
        var layout = layoutRecapCard(model);
        if (!layout) return null;
        var opts = options || {};
        var doc = opts.document || (typeof document !== 'undefined' ? document : null);
        if (!doc || typeof doc.createElement !== 'function') return null;
        var canvas = doc.createElement('canvas');
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        var g = canvas.getContext('2d');
        if (!g) return null;

        var scale = Number(opts.scale) > 0 ? Math.min(3, Number(opts.scale)) : 1;
        var W = layout.W, H = layout.H;
        canvas.width = Math.round(W * scale);
        canvas.height = Math.round(H * scale);
        if (canvas.style) {
            canvas.style.width = W + 'px';
            canvas.style.height = H + 'px';
        }
        if (typeof g.scale === 'function') g.scale(scale, scale);

        var text = function (str, x, y, size, color, weight, align) {
            g.font = (weight || '400') + ' ' + size + 'px ' + IMG_FONT;
            g.fillStyle = color;
            g.textAlign = align || 'left';
            g.textBaseline = 'middle';
            g.fillText(String(str), x, y);
        };

        // White underneath everything, so nothing transparent reaches Office.
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, W, H);

        // ── Header ──
        g.fillStyle = COLORS.header;
        g.fillRect(0, 0, W, layout.headerH);
        var cols = model.columns;
        var span = cols.length > 1 ? cols[0].name + ' to ' + cols[cols.length - 1].name : cols[0].name;
        text(model.firstName + '\'s ' + model.year + ', quarter by quarter', layout.padX, 30, layout.titleSize, '#ffffff', '700');
        text('Each KPI against its goal, ' + span, layout.padX, 54, 13, COLORS.headerSub);
        text(model.quarterName + ' check-in', W - layout.padX, 30, 13, COLORS.headerSub, '600', 'right');

        var tileX = function (i) { return layout.tilesX + i * (layout.tileW + layout.tileGap); };

        // ── Quarter headings ──
        cols.forEach(function (col, i) {
            var isNow = col.quarter === model.quarter;
            text(col.name, tileX(i) + layout.tileW / 2, layout.colHeadY, 12,
                isNow ? COLORS.ink : COLORS.muted, '700', 'center');
        });

        // ── One row per KPI ──
        model.kpis.forEach(function (k, r) {
            var y = layout.rows[r].y;
            if (r > 0) {
                g.fillStyle = COLORS.rule;
                g.fillRect(layout.padX, y - 6, W - layout.padX * 2, 1);
            }
            text(k.label, layout.padX, y + 17, 14, COLORS.ink, '700');
            if (k.goalText) text('Goal ' + k.goalText, layout.padX, y + 35, 11.5, COLORS.muted);

            k.points.forEach(function (p, i) {
                var x = tileX(i), ty = y;
                var w = layout.tileW, h = layout.tileH;
                if (!p.shown) {
                    g.fillStyle = COLORS.emptyFill;
                    _roundRect(g, x, ty, w, h, 7);
                    g.fill();
                    g.strokeStyle = COLORS.emptyBorder;
                    g.lineWidth = 1;
                    g.stroke();
                    text('·', x + w / 2, ty + h / 2, 18, COLORS.faint, '700', 'center');
                    return;
                }
                var atGoal = p.meets === true;
                g.fillStyle = atGoal ? COLORS.meetsFill : '#ffffff';
                _roundRect(g, x, ty, w, h, 7);
                g.fill();
                g.strokeStyle = atGoal ? COLORS.meetsBorder : COLORS.tileBorder;
                g.lineWidth = 1;
                g.stroke();
                text(p.display, x + w / 2, ty + h / 2 + 1, layout.valueSize,
                    atGoal ? COLORS.meetsInk : COLORS.text, '700', 'center');
                // Colour never carries the meaning alone: at goal also wears
                // a tick, and the key under the card says what it means.
                if (atGoal) text('✓', x + w - 9, ty + 10, 11, COLORS.meetsMark, '700', 'center');
            });

            if (k.improvement) {
                text(k.improvement.short, layout.changeX, y + 17, 13, COLORS.meetsInk, '700');
                text('since ' + k.improvement.since, layout.changeX, y + 34, 11, COLORS.muted);
            }
        });

        text('✓ Green tiles are at goal.', layout.padX, layout.footerY, 11.5, COLORS.muted);
        return canvas;
    }

    function _reason(err) {
        if (!err) return 'The browser refused without saying why.';
        var name = err.name ? String(err.name) : '';
        var msg = err.message ? String(err.message) : String(err);
        return name && msg.indexOf(name) !== 0 ? name + ': ' + msg : msg;
    }

    /* Put the picture on the clipboard.
     *
     * The ClipboardItem is built with the blob PROMISE, synchronously, so it
     * is made inside the click and keeps the user activation the clipboard
     * demands; waiting for toBlob first loses it. Nothing is ever saved to the
     * computer as a fallback: the work PC does not allow it.
     *
     * Resolves { state: 'copied' | 'unsupported' | 'failed', reason }, with
     * the browser's own words in reason, because there is no console to read
     * them in. Never rejects.
     */
    function copyCardImage(canvas, options) {
        var timeoutMs = (options && options.timeoutMs) || COPY_TIMEOUT_MS;
        if (!canvas || typeof canvas.toBlob !== 'function') {
            return Promise.resolve({ state: 'failed', reason: 'There is no picture to copy.' });
        }
        var nav = typeof navigator !== 'undefined' ? navigator : null;
        if (!(window.ClipboardItem && nav && nav.clipboard && typeof nav.clipboard.write === 'function')) {
            return Promise.resolve({ state: 'unsupported', reason: 'This browser cannot put a picture on the clipboard.' });
        }
        var blob = new Promise(function (resolve, reject) {
            canvas.toBlob(function (b) { if (b) resolve(b); else reject(new Error('The picture could not be made.')); }, 'image/png');
        });
        var write;
        try {
            var item = new window.ClipboardItem({ 'image/png': blob });
            write = nav.clipboard.write([item]);
        } catch (err) {
            return Promise.resolve({ state: 'failed', reason: _reason(err) });
        }
        var timer = null;
        var timedOut = new Promise(function (resolve) {
            timer = setTimeout(function () {
                resolve({ state: 'failed', reason: 'The clipboard did not answer within ' + Math.round(timeoutMs / 1000) + ' seconds.' });
            }, timeoutMs);
        });
        var written = Promise.resolve(write).then(
            function () { return { state: 'copied', reason: '' }; },
            function (err) { return { state: 'failed', reason: _reason(err) }; });
        return Promise.race([written, timedOut]).then(function (result) {
            clearTimeout(timer);
            return result;
        });
    }

    /* ── The log of what went out ──
     *
     * { "Name|2026|Q3": [ { event, at, ... } ] }, where event is one of
     *   drafted   the email was opened (to, subject, hours: whether the hours
     *             line was in it)
     *   sent      Scott marked it sent
     *   skipped   Scott marked it as not being sent
     *   unsent    Undo of either of those
     *   hoursOff / hoursOn   the Include the hours line switch
     *
     * Events, never a flag that gets overwritten. The store merges two
     * machines' copies entry by entry, so a send marked at work and another
     * marked at home both survive, and an Undo is an event of its own rather
     * than a deletion the merge would bring straight back.
     *
     * Drafted is recorded when the email opens; sent only when Scott says so.
     * The app cannot see Outlook, and a draft closed without sending is not a
     * sent email.
     */
    function recapKey(name, year, quarter) {
        return String(name == null ? '' : name).trim() + '|' + parseInt(year, 10) + '|Q' + parseInt(quarter, 10);
    }

    // Read when asked, never at load: modules load before the stores are
    // hydrated, and a log read then would be empty.
    function readLog() {
        var storage = _mod('storage');
        if (storage && typeof storage.readStore === 'function') {
            try {
                var saved = storage.readStore(STORE);
                if (saved && typeof saved === 'object' && !Array.isArray(saved)) return saved;
            } catch (e) { /* an unreadable store reads as empty */ }
        }
        return {};
    }

    // Copies, never edits: readStore hands back the live cache, and editing it
    // in place would show a change that a refused save then loses on reload.
    function _append(name, year, quarter, event, details, options) {
        if (!String(name || '').trim()) return null;
        var storage = _mod('storage');
        if (!storage || typeof storage.saveWithSizeCheck !== 'function') return null;
        var opts = options || {};
        var at = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();
        var entry = { event: event, at: at };
        var d = details || {};
        if (d.to) entry.to = String(d.to);
        if (d.subject) entry.subject = String(d.subject);
        if (typeof d.hours === 'boolean') entry.hours = d.hours;

        var log = readLog();
        var key = recapKey(name, year, quarter);
        var next = Object.assign({}, log);
        next[key] = (Array.isArray(log[key]) ? log[key].slice() : []).concat([entry]);
        return storage.saveWithSizeCheck(STORE, next) === false ? null : entry;
    }

    function recordDrafted(name, year, quarter, details, options) {
        return _append(name, year, quarter, 'drafted', details, options);
    }
    function markSent(name, year, quarter, details, options) {
        return _append(name, year, quarter, 'sent', details, options);
    }
    function markSkipped(name, year, quarter, options) {
        return _append(name, year, quarter, 'skipped', null, options);
    }
    // Takes back a sent or a not sending mark.
    function undoSent(name, year, quarter, options) {
        return _append(name, year, quarter, 'unsent', null, options);
    }
    function setIncludeHours(name, year, quarter, include, options) {
        return _append(name, year, quarter, include ? 'hoursOn' : 'hoursOff', null, options);
    }

    var EVENTS = ['drafted', 'sent', 'skipped', 'unsent', 'hoursOff', 'hoursOn'];

    /* Where one associate's recap stands: 'sent', 'skipped', 'drafted' or
     * 'none', and whether the hours line is in. The newest event decides, by
     * time rather than by position, because a merge can interleave two
     * machines' entries. */
    function statusFor(name, year, quarter, log) {
        var list = (log || readLog())[recapKey(name, year, quarter)];
        var events = (Array.isArray(list) ? list : []).filter(function (e) {
            return e && typeof e.at === 'string' && EVENTS.indexOf(e.event) > -1;
        }).map(function (e, i) { return { e: e, i: i }; }).sort(function (a, b) {
            return a.e.at < b.e.at ? -1 : a.e.at > b.e.at ? 1 : a.i - b.i;
        }).map(function (x) { return x.e; });

        var outcome = null, drafted = null, includeHours = true;
        events.forEach(function (e) {
            if (e.event === 'sent' || e.event === 'skipped') outcome = e;
            else if (e.event === 'unsent') outcome = null;
            else if (e.event === 'drafted') drafted = e;
            else if (e.event === 'hoursOff') includeHours = false;
            else if (e.event === 'hoursOn') includeHours = true;
        });
        var base = { draftedAt: drafted ? drafted.at : null, includeHours: includeHours };
        if (outcome) return Object.assign({ state: outcome.event, at: outcome.at }, base);
        if (drafted) return Object.assign({ state: 'drafted', at: drafted.at }, base);
        return Object.assign({ state: 'none', at: null }, base);
    }

    // Every name's standing for one quarter, read off a single copy of the log.
    function rosterStatus(names, year, quarter) {
        var log = readLog();
        var rows = (names || []).map(function (name) {
            var s = statusFor(name, year, quarter, log);
            return { name: name, state: s.state, at: s.at };
        });
        var count = function (state) { return rows.filter(function (r) { return r.state === state; }).length; };
        return {
            rows: rows, total: rows.length,
            sent: count('sent'), skipped: count('skipped'), drafted: count('drafted'), none: count('none')
        };
    }

    // "10/07", read in local time, for a status chip.
    function shortDate(iso) {
        var d = new Date(iso);
        if (isNaN(d.getTime())) return '';
        return (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '/' + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.quarterRecap = {
        STORE: STORE,
        COPY_TIMEOUT_MS: COPY_TIMEOUT_MS,
        buildRecapModel: buildRecapModel,
        buildRecapEmail: buildRecapEmail,
        buildRecapNotes: buildRecapNotes,
        layoutRecapCard: layoutRecapCard,
        drawRecapCard: drawRecapCard,
        copyCardImage: copyCardImage,
        recapKey: recapKey,
        readLog: readLog,
        recordDrafted: recordDrafted,
        markSent: markSent,
        markSkipped: markSkipped,
        undoSent: undoSent,
        setIncludeHours: setIncludeHours,
        statusFor: statusFor,
        rosterStatus: rosterStatus,
        shortDate: shortDate
    };
})();
