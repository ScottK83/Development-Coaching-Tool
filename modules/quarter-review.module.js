(function () {
    'use strict';

    // ============================================
    // QUARTER REVIEW MODULE
    //
    // The document that goes into an associate's record at a quarterly
    // check-in. Two things come out of here off one set of facts:
    //
    //   buildNotes()   finished text, written here, paste ready
    //   buildPrompt()  the same facts handed to Copilot to reword
    //
    // Everything else in the review path emits a prompt and nothing else, so
    // the wording of a record document depends on what a model felt like
    // saying that morning. The numbers in a personnel file should not vary
    // between runs, so the figures, the direction of each one and the sentence
    // that carries them are built here. Copilot stays available for when a
    // particular associate needs the tone moved.
    //
    // House rules this copy has to hold to, all of them enforced by tests:
    //   - No dash characters of any kind in a string. Commas and full stops.
    //   - No rating vocabulary. Associates are not shown the internal scale,
    //     so no "on track", "off track", "exceptional", "successful", "tier",
    //     or a score named as a number. review-tier-vocabulary.test.js sweeps
    //     these files for it.
    //   - Third person, about the associate, never "you". This is a file note,
    //     not a letter to them.
    //   - No "only X away from" phrasing. The gap is a number and stands.
    //   - Missed hours are the year's running total, never the quarter's.
    //   - No caveats about the data in associate facing copy.
    // ============================================

    /* The metrics a quarterly check-in speaks to, in the order a supervisor
     * would raise them: the two that describe the work, then how customers
     * rated it, then attendance. */
    var REVIEW_METRICS = [
        'aht',
        'scheduleAdherence',
        'overallSentiment',
        'cxRepOverall',
        'fcr',
        'overallExperience',
        'transfers',
        'reliability'
    ];

    // Missed hours are described against the year, so they never take part in
    // the quarter by quarter prose the other metrics get.
    var RELIABILITY = 'reliability';

    // Fewer responses than this behind a survey quarter and the quarter is not
    // quoted as a movement. Three is the floor the year end scoring already
    // uses, and a quarter swinging on two surveys is noise in a record.
    var MIN_SURVEYS_FOR_TREND = 3;

    /* ── Access to the rest of the app ── */

    function _qt() { return (window.DevCoachModules || {}).quarterTrend || null; }
    function _registry() { return window.METRICS_REGISTRY || {}; }
    function _profiles() { return (window.DevCoachModules || {}).metricProfiles || {}; }

    function _label(metricKey) {
        var def = _registry()[metricKey];
        return (def && def.label) || metricKey;
    }

    function _display(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') {
            return window.formatMetricDisplay(metricKey, value);
        }
        return String(value);
    }

    /* How much a metric MOVED, which is not how a metric READS.
     *
     * A rate that goes from 91.2% to 94.1% moved 2.9 percentage points, and
     * calling that "2.9% better" is the ambiguity that makes a reader wonder
     * whether it means 2.9 points or 2.9 percent of 91.2. A record should not
     * make anyone work that out, so a movement gets a plain unit word and only
     * a level keeps the % sign.
     */
    function _movementAmount(metricKey, size) {
        var def = _registry()[metricKey] || {};
        var n = Math.round(size * 10) / 10;
        if (def.unit === 'sec') return Math.round(size) + (Math.round(size) === 1 ? ' second' : ' seconds');
        if (def.unit === 'hrs') return n + (n === 1 ? ' hour' : ' hours');
        if (def.unit === '%') return n + (n === 1 ? ' point' : ' points');
        return String(n);
    }

    function _targetFor(metricKey, year) {
        var byYear = _profiles().TARGETS_BY_YEAR || {};
        var forYear = byYear[parseInt(year, 10)] || {};
        if (forYear[metricKey]) return forYear[metricKey];
        var def = _registry()[metricKey];
        return (def && def.target) || null;
    }

    function _meetsTarget(target, value) {
        if (!target || !Number.isFinite(value)) return null;
        return target.type === 'min' ? value >= target.value : value <= target.value;
    }

    function _firstName(name) {
        if (typeof window.getEmployeeNickname === 'function') {
            var nick = window.getEmployeeNickname(name);
            if (nick) return nick;
        }
        return String(name || '').split(' ')[0] || name;
    }

    // A record carries dates the way the business writes them. Done here
    // rather than through the app's shared helper because this module is also
    // the one thing in the review path that has to produce finished copy with
    // nothing else loaded.
    function _formatDate(dateText) {
        var parts = String(dateText || '').split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return parts[1] + '/' + parts[2] + '/' + parts[0];
        }
        return dateText || '';
    }

    function _round1(n) {
        return Math.round(n * 10) / 10;
    }

    /* ── Building the facts ── */

    /* One associate, one year, every quarter that has started.
     *
     * The quarter aggregates are built once by the caller and passed in, so a
     * whole team can be prepared without reading the store once per person.
     */
    function buildContext(employeeName, year, options) {
        var opts = options || {};
        var qt = _qt();
        if (!qt || !employeeName) return null;

        var quarters = opts.quarters || qt.buildYearQuarters(year, opts);
        if (!quarters || !quarters.length) return null;

        var throughQuarter = opts.throughQuarter
            || quarters[quarters.length - 1].quarter;
        var scoped = quarters.filter(function (q) { return q.quarter <= throughQuarter; });
        if (!scoped.length) return null;

        var current = scoped[scoped.length - 1];
        var metrics = [];

        REVIEW_METRICS.forEach(function (metricKey) {
            if (metricKey === RELIABILITY) return;
            var series = qt.buildMetricSeries(employeeName, metricKey, scoped);
            if (!series.measuredCount) return;

            var target = _targetFor(metricKey, year);
            var latest = series.last;
            var usable = _usablePoints(metricKey, series);

            metrics.push({
                metricKey: metricKey,
                label: _label(metricKey),
                series: series,
                usablePoints: usable,
                target: target,
                latestValue: latest ? latest.value : null,
                latestQuarter: latest ? latest.name : null,
                meetsTarget: latest ? _meetsTarget(target, latest.value) : null,
                gap: _gap(target, latest),
                direction: series.overall.direction,
                latestMove: series.latestMove.direction,
                movedAcross: _spanChange(metricKey, usable),
                isReverse: !!(_registry()[metricKey] || {}).isReverse
            });
        });

        return {
            name: employeeName,
            firstName: _firstName(employeeName),
            year: parseInt(year, 10),
            quarter: current.quarter,
            quarterLabel: current.label,
            quarters: scoped,
            current: current,
            metrics: metrics,
            reliability: _reliabilityFacts(employeeName, year, scoped),
            coverage: _coverageFacts(scoped),
            preparedOn: opts.preparedOn || _today()
        };
    }

    function _today() {
        var d = new Date();
        return d.getFullYear() + '-'
            + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-'
            + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }

    /* Points solid enough to quote as a movement.
     *
     * A survey rate resting on one or two responses is not a quarter's worth
     * of customer opinion, and putting it in a record as "slipped to 74%"
     * treats two people as a trend.
     */
    function _usablePoints(metricKey, series) {
        var fields = window.SURVEY_WEIGHT_FIELD || {};
        var isSurvey = !!fields[metricKey];
        return series.measured.filter(function (p) {
            if (!isSurvey) return true;
            return p.surveyCount >= MIN_SURVEYS_FOR_TREND;
        });
    }

    function _gap(target, point) {
        if (!target || !point || !point.hasValue) return null;
        var diff = point.value - target.value;
        return {
            signed: diff,
            size: Math.abs(diff),
            meets: _meetsTarget(target, point.value)
        };
    }

    /* How far the metric moved from its first usable quarter to its last, with
     * the metric's polarity applied so "better" means better. */
    function _spanChange(metricKey, usable) {
        if (!usable || usable.length < 2) return null;
        var first = usable[0];
        var last = usable[usable.length - 1];
        var mm = (window.DevCoachModules || {}).metricMovement;
        var better = mm && typeof mm.performanceDelta === 'function'
            ? mm.performanceDelta(metricKey, last.value, first.value)
            : last.value - first.value;
        return {
            from: first,
            to: last,
            raw: last.value - first.value,
            size: Math.abs(last.value - first.value),
            improved: Number.isFinite(better) ? better > 0 : null,
            quartersApart: usable.length
        };
    }

    /* Missed hours, as the year's running total at the close of each quarter.
     *
     * The quarter's own hours are what the aggregate carries, so the running
     * figure is those hours accumulated forward. Stated this way the trend is
     * still visible without ever putting a single quarter's hours in front of
     * an associate as though that were the number that counts.
     */
    function _reliabilityFacts(employeeName, year, quarters) {
        var target = _targetFor(RELIABILITY, year);
        var running = 0;
        var any = false;
        var checkpoints = quarters.map(function (qa) {
            var emp = qa.employees ? qa.employees[employeeName] : null;
            var accrued = emp ? parseFloat(emp.reliabilityAccrued) : NaN;
            if (Number.isFinite(accrued)) {
                running += accrued;
                any = true;
            }
            return {
                quarter: qa.quarter,
                name: qa.name,
                label: qa.label,
                accrued: Number.isFinite(accrued) ? _round1(accrued) : null,
                runningTotal: any ? _round1(running) : null,
                hasValue: Number.isFinite(accrued)
            };
        });
        var total = any ? _round1(running) : null;
        return {
            target: target,
            checkpoints: checkpoints,
            yearToDate: total,
            hasValue: any,
            meetsTarget: any ? _meetsTarget(target, total) : null,
            overBy: (any && target && total > target.value) ? _round1(total - target.value) : 0
        };
    }

    function _coverageFacts(quarters) {
        var measured = quarters.filter(function (q) { return !q.empty; });
        return {
            quartersWithData: measured.length,
            quartersRequested: quarters.length,
            missing: quarters.filter(function (q) { return q.empty; })
                .map(function (q) { return q.name; }),
            spanStart: measured.length ? measured[0].spanStart || measured[0].startDate : null,
            spanEnd: measured.length ? measured[measured.length - 1].spanEnd || measured[measured.length - 1].endDate : null
        };
    }

    /* ── Sorting the facts into the two boxes ── */

    /* Box 1 takes what is going well: at target, or moved the right way by
     * enough to be worth naming. Box 2 takes what is not, worst first, where
     * worst means below target and still going the wrong way.
     */
    function splitForBoxes(ctx) {
        var strengths = [];
        var focus = [];

        ctx.metrics.forEach(function (m) {
            var moved = m.movedAcross;
            var improving = moved && moved.improved === true;
            var declining = moved && moved.improved === false;

            if (m.meetsTarget === true) {
                strengths.push(Object.assign({}, m, {
                    why: improving ? 'improved-and-met' : 'met'
                }));
                return;
            }
            if (m.meetsTarget === false) {
                focus.push(Object.assign({}, m, {
                    why: declining ? 'missed-and-falling' : improving ? 'missed-but-rising' : 'missed'
                }));
                return;
            }
            // No target configured. A clear improvement is still worth saying.
            if (improving && moved.size > 0) {
                strengths.push(Object.assign({}, m, { why: 'improved' }));
            }
        });

        // Missed hours sit in whichever box the year's total puts them.
        var rel = ctx.reliability;
        if (rel.hasValue && rel.target) {
            if (rel.meetsTarget) {
                strengths.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'met', reliability: rel });
            } else {
                focus.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'missed', reliability: rel });
            }
        }

        var focusRank = { 'missed-and-falling': 0, 'missed': 1, 'missed-but-rising': 2 };
        focus.sort(function (a, b) {
            var ra = focusRank[a.why] === undefined ? 1 : focusRank[a.why];
            var rb = focusRank[b.why] === undefined ? 1 : focusRank[b.why];
            if (ra !== rb) return ra - rb;
            // Reliability outranks a rate when both are behind: missed hours
            // are the one of these with a hard ceiling on them.
            if (a.metricKey === RELIABILITY) return -1;
            if (b.metricKey === RELIABILITY) return 1;
            return 0;
        });

        var strengthRank = { 'improved-and-met': 0, 'met': 1, 'improved': 2 };
        strengths.sort(function (a, b) {
            var ra = strengthRank[a.why] === undefined ? 1 : strengthRank[a.why];
            var rb = strengthRank[b.why] === undefined ? 1 : strengthRank[b.why];
            return ra - rb;
        });

        return { strengths: strengths, focus: focus };
    }

    /* ── The sentences ── */

    /* "451s in Q1, 438s in Q2, and 421s in Q3" */
    function progressionPhrase(metricKey, points) {
        var parts = points.map(function (p) {
            return _display(metricKey, p.value) + ' in ' + p.name;
        });
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] + ' and then ' + parts[1];
        return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    }

    function targetPhrase(metricKey, target) {
        if (!target) return '';
        var goal = _display(metricKey, target.value);
        return target.type === 'min'
            ? 'against a goal of ' + goal + ' or better'
            : 'against a goal of ' + goal + ' or lower';
    }

    /* Where the metric sat against goal in each quarter, as a shape.
     *
     * Movement alone is not the story a record needs. A rate that fell five
     * points while staying above goal and a rate that fell five points THROUGH
     * the goal are different facts, and the second one is the one that belongs
     * in a file. Describing only the movement says "five points further from
     * goal" about a metric that started above it, which is simply untrue.
     */
    function _goalStory(m) {
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        if (!m.target || points.length === 0) return { shape: 'unknown', points: points };
        var met = points.map(function (p) { return _meetsTarget(m.target, p.value); });
        var firstMet = met[0];
        var lastMet = met[met.length - 1];

        if (met.every(Boolean)) return { shape: 'always', points: points, met: met };
        if (met.every(function (v) { return v === false; })) return { shape: 'never', points: points, met: met };

        if (!firstMet && lastMet) {
            var upAt = met.indexOf(true);
            return { shape: 'crossed-up', points: points, met: met, at: points[upAt] };
        }
        if (firstMet && !lastMet) {
            var downAt = met.indexOf(false);
            var firstBelow = points[downAt];
            var onlyLast = met.lastIndexOf(true) === met.length - 2;
            return {
                shape: 'crossed-down', points: points, met: met,
                at: firstBelow, onlyLast: onlyLast
            };
        }
        return { shape: 'mixed', points: points, met: met };
    }

    /* One metric, as prose.
     *
     * Three depths, because a box that gives every metric the same three
     * sentences reads as a form someone filled in rather than notes someone
     * wrote. The metric that matters most gets the movement, the amount and
     * the standing; the next gets the movement and the standing; the rest are
     * a clause apiece.
     */
    function metricSentence(m, ctx, depth) {
        if (m.metricKey === RELIABILITY) return reliabilitySentence(ctx.reliability, ctx);

        var style = depth || 'lead';
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        if (!points.length) return '';
        var label = m.label.toLowerCase();
        var story = _goalStory(m);
        var moved = m.movedAcross;
        var lines = [];

        if (points.length < 2) {
            lines.push(_cap(label) + ' for ' + points[0].name + ' was '
                + _display(m.metricKey, points[0].value) + ', '
                + targetPhrase(m.metricKey, m.target) + '.');
            return lines.join(' ');
        }

        var movementWord;
        if (!moved || moved.size === 0) movementWord = 'held steady';
        else if (moved.improved === true) movementWord = m.isReverse ? 'came down in each quarter this year' : 'improved across the year';
        else if (moved.improved === false) movementWord = m.isReverse ? 'climbed across the year' : 'slipped across the year';
        else movementWord = 'moved across the year';

        if (style === 'brief') {
            lines.push(_cap(label) + ' went from '
                + _display(m.metricKey, points[0].value) + ' in ' + points[0].name
                + ' to ' + _display(m.metricKey, points[points.length - 1].value)
                + ' in ' + points[points.length - 1].name + _goalTail(story, m, 'brief') + '.');
            return lines.join(' ');
        }

        // Support depth closes on the same sentence. Split off into its own it
        // becomes "Which moved it inside the goal in Q2", a fragment, and three
        // of those in a row is what makes a document read as generated.
        if (style !== 'lead') {
            lines.push(_cap(label) + ' ' + movementWord + ', '
                + progressionPhrase(m.metricKey, points) + _goalTail(story, m, 'support') + '.');
            return lines.join(' ');
        }

        lines.push(_cap(label) + ' ' + movementWord + ', '
            + progressionPhrase(m.metricKey, points) + '.');

        if (moved && moved.size > 0) {
            lines.push('That is ' + _movementAmount(m.metricKey, moved.size)
                + (moved.improved === true ? ' better than' : ' off')
                + ' where ' + ctx.firstName + ' started the year'
                + _goalTail(story, m, 'lead') + '.');
        } else {
            var tail = _goalTail(story, m, 'support');
            if (tail) lines.push(_cap(tail.replace(/^,\s*(and\s+)?/, '')) + '.');
        }

        return lines.join(' ');
    }

    /* The clause that says where the movement left it against goal.
     *
     * Worded differently at each depth on purpose. The same clause repeated
     * down a box is the tell that nobody wrote it.
     */
    function _goalTail(story, m, style) {
        if (!m.target) return '';
        var goal = _display(m.metricKey, m.target.value);
        var last = story.points[story.points.length - 1];
        var lastName = last ? last.name : m.latestQuarter;

        switch (story.shape) {
            case 'always':
                if (style === 'brief') return ', both inside the ' + goal + ' goal';
                if (style === 'support') return ', every quarter of it inside the ' + goal + ' goal';
                return ', and it has stayed inside the ' + goal + ' goal all year';
            case 'never':
                var short = _movementAmount(m.metricKey, m.gap ? m.gap.size : 0);
                if (style === 'brief') return ', still short of the ' + goal + ' goal';
                if (style === 'support') return ', leaving it ' + short + ' short of the ' + goal + ' goal';
                return ', and it is still ' + short + ' short of the ' + goal + ' goal';
            case 'crossed-up':
                if (style === 'brief') return ', clearing the ' + goal + ' goal in ' + story.at.name;
                if (style === 'support') return ', and it has been inside the ' + goal + ' goal since ' + story.at.name;
                return ', which moved it inside the ' + goal + ' goal in ' + story.at.name;
            case 'crossed-down':
                if (story.onlyLast) {
                    if (style === 'brief') return ', dropping under the ' + goal + ' goal in ' + lastName;
                    return ', and ' + lastName + ' is the first quarter under the ' + goal + ' goal';
                }
                if (style === 'brief') return ', under the ' + goal + ' goal since ' + story.at.name;
                return ', and it has been under the ' + goal + ' goal since ' + story.at.name;
            case 'mixed':
                if (m.meetsTarget) return ', and it is back inside the ' + goal + ' goal';
                return ', and it is under the ' + goal + ' goal';
            default:
                return '';
        }
    }

    function _cap(text) {
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }

    /* Missed hours, always as the year's running total.
     *
     * The per quarter figures are the running total at each quarter's close,
     * not the hours belonging to that quarter, so the sentence reads as one
     * number growing rather than three separate ones.
     */
    function reliabilitySentence(rel, ctx) {
        if (!rel || !rel.hasValue) return '';
        var name = ctx.firstName;
        var target = rel.target;
        var goalText = target ? _display(RELIABILITY, target.value) : '';
        var lines = [];

        lines.push(name + ' has missed ' + _display(RELIABILITY, rel.yearToDate)
            + ' for the year to date'
            + (target ? ', against an allowance of ' + goalText + ' for the year' : '') + '.');

        var withValues = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
        if (withValues.length >= 2) {
            var parts = withValues.map(function (c) {
                return _display(RELIABILITY, c.runningTotal) + ' through ' + c.name;
            });
            lines.push('That was '
                + (parts.length === 2
                    ? parts[0] + ' and ' + parts[1]
                    : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1])
                + '.');
        }

        if (rel.meetsTarget === false && rel.overBy > 0) {
            lines.push('That puts the year ' + _display(RELIABILITY, rel.overBy)
                + ' over the allowance with ' + _quartersLeftPhrase(ctx) + ' to go.');
        }
        return lines.join(' ');
    }

    function _quartersLeftPhrase(ctx) {
        var left = 4 - ctx.quarter;
        if (left <= 0) return 'the year closed';
        return left === 1 ? 'one quarter' : left + ' quarters';
    }

    /* ── The finished notes ── */

    /* Two boxes of finished prose, plus the header a file note carries.
     *
     * The caller gets the boxes separately because Success Factors takes them
     * as two fields, and the joined version because the whole thing is also
     * worth having on a clipboard.
     */
    function buildNotes(ctx, options) {
        var opts = options || {};
        var split = splitForBoxes(ctx);
        var name = ctx.firstName;

        // Depth falls away down the list. The first strength is the one the
        // supervisor would lead with in the room, and the fourth is a clause.
        var strengthLines = split.strengths.slice(0, 4)
            .map(function (m, i) {
                return metricSentence(m, ctx, i === 0 ? 'lead' : i === 1 ? 'support' : 'brief');
            })
            .filter(Boolean);
        var focusLines = split.focus.slice(0, 2)
            .map(function (m, i) { return metricSentence(m, ctx, i === 0 ? 'lead' : 'support'); })
            .filter(Boolean);

        var box1 = strengthLines.length
            ? strengthLines.join(' ')
            : name + ' held the quarter steady with no metric moving far in either direction.';

        var box2Parts = [];
        if (focusLines.length) {
            box2Parts.push(focusLines.join(' '));
            box2Parts.push(_focusClose(split.focus, ctx));
        } else {
            box2Parts.push('Every tracked metric is at goal for ' + ctx.quarterLabel
                + '. The focus for the rest of the year is holding that through '
                + _quartersLeftPhrase(ctx) + '.');
        }
        var box2 = box2Parts.filter(Boolean).join(' ');

        if (opts.notes) {
            box1 = box1 + ' ' + String(opts.notes).trim();
        }

        var header = buildHeader(ctx);
        return {
            header: header,
            box1: box1,
            box2: box2,
            strengths: split.strengths,
            focus: split.focus,
            full: header + '\n\nPROGRESS AND STRENGTHS\n' + box1
                + '\n\nAREAS OF FOCUS\n' + box2 + '\n'
        };
    }

    /* The expectation line. Direct about what has to move, without naming a
     * consequence the supervisor has not decided on. */
    function _focusClose(focus, ctx) {
        if (!focus.length) return '';
        var name = ctx.firstName;
        var lead = focus[0];
        var left = _quartersLeftPhrase(ctx);
        if (lead.why === 'missed-and-falling') {
            return 'This is the one to move first. ' + name
                + ' and I will work it in our one to ones, and the expectation is visible movement over '
                + left + '.';
        }
        if (lead.why === 'missed-but-rising') {
            return name + ' is already moving this the right way, and the expectation is that it reaches goal over '
                + left + '.';
        }
        return 'The expectation is steady progress toward goal over ' + left + '.';
    }

    /* The two lines that make it a file note rather than a paragraph: who and
     * when, then what window the numbers below actually came from. */
    function buildHeader(ctx) {
        var lines = [];
        lines.push(ctx.quarterLabel + ' Check In: ' + ctx.name);
        var second = 'Prepared ' + _formatDate(ctx.preparedOn);
        var cov = ctx.coverage;
        if (cov.spanStart && cov.spanEnd) {
            second += '. Covers ' + _formatDate(cov.spanStart) + ' through ' + _formatDate(cov.spanEnd);
        }
        lines.push(second + '.');
        return lines.join('\n');
    }

    /* ── The facts, as lines ──
     *
     * One line per measure, quarter by quarter, with the goal and where it
     * stands. Shared rather than inlined into the prompt because the year-end
     * generator wants the same block: a year-end review that says how the year
     * MOVED is a better record than one that quotes a single closing figure.
     */
    function factLines(ctx) {
        var out = [];
        ctx.metrics.forEach(function (m) {
            var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
            if (!points.length) return;
            var line = '- ' + m.label + ': '
                + points.map(function (p) { return p.name + ' ' + _display(m.metricKey, p.value); }).join(', ');
            if (m.target) {
                line += ' (goal ' + _display(m.metricKey, m.target.value)
                    + (m.target.type === 'min' ? ' or better)' : ' or lower)');
            }
            if (m.meetsTarget === true) line += ', at goal';
            else if (m.meetsTarget === false && m.gap) line += ', ' + _display(m.metricKey, m.gap.size) + ' off goal';
            out.push(line);
        });

        var rel = ctx.reliability;
        if (rel.hasValue) {
            var relLine = '- ' + _label(RELIABILITY) + ': ' + _display(RELIABILITY, rel.yearToDate)
                + ' missed for the year';
            if (rel.target) relLine += ' (allowance ' + _display(RELIABILITY, rel.target.value) + ' for the year)';
            var pts = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
            if (pts.length >= 2) {
                relLine += ', running at ' + pts.map(function (c) {
                    return _display(RELIABILITY, c.runningTotal) + ' through ' + c.name;
                }).join(', ');
            }
            out.push(relLine);
        }
        return out;
    }

    /* The same block as a ready made string, for a prompt built elsewhere.
     * Returns an empty string when there is nothing to say, so a caller can
     * append it unconditionally.
     */
    function buildProgressionBlock(employeeName, year, options) {
        var ctx = buildContext(employeeName, year, options);
        if (!ctx) return '';
        var lines = factLines(ctx);
        if (!lines.length) return '';
        return 'How each measure moved across the quarters of ' + ctx.year + ':\n'
            + lines.join('\n');
    }

    /* ── The Copilot prompt ──
     *
     * Same facts, handed over for rewording. First person, help me polish my
     * notes: a "you are a supervisor evaluating an employee" persona trips
     * Copilot's guardrail on individualised employee evaluation and comes back
     * as a refusal. on-off-tracker learned that one the hard way.
     */
    function buildPrompt(ctx, options) {
        var opts = options || {};
        var notes = buildNotes(ctx, opts);
        var split = { strengths: notes.strengths, focus: notes.focus };
        var name = ctx.firstName;
        var out = [];

        out.push('I am a call center supervisor and I have written up my quarterly check in notes for '
            + name + '. I need help polishing them into the two boxes our review system takes. '
            + 'This is a ' + ctx.quarterLabel + ' check in, so the year is still running.');
        out.push('');
        out.push('Here is how each measure has moved across the quarters this year:');
        factLines(ctx).forEach(function (line) { out.push(line); });

        out.push('');
        out.push('What I want recognised:');
        if (split.strengths.length) {
            split.strengths.slice(0, 4).forEach(function (m) { out.push('- ' + m.label); });
        } else {
            out.push('- Steady performance with nothing moving far either way');
        }

        out.push('');
        out.push('What I want them working on:');
        if (split.focus.length) {
            split.focus.slice(0, 2).forEach(function (m) { out.push('- ' + m.label); });
        } else {
            out.push('- Holding the current level through the rest of the year');
        }

        if (opts.notes) {
            out.push('');
            out.push('My own notes on what ' + name + ' has been working on. Work this in naturally, do not quote it:');
            out.push(String(opts.notes).trim());
        }

        out.push('');
        out.push('My draft, which you are welcome to rewrite:');
        out.push('');
        out.push('Progress and strengths: ' + notes.box1);
        out.push('');
        out.push('Areas of focus: ' + notes.box2);
        out.push('');
        out.push('Please tighten this into two boxes I can paste in. Requirements:');
        out.push('- Write about ' + name + ' in the third person. These are my notes for a record, not a letter to them, so do not use "you"');
        out.push('- Keep every number and every quarter comparison exactly as I have given it. Do not round differently and do not invent a figure');
        out.push('- Show the movement across the quarters, since that is the point of the document');
        out.push('- Present tense for where things stand, since the year is still running');
        out.push('- Plain, factual and specific, the way a supervisor writes a file note. Warm is fine, flowery is not');
        out.push('- Be direct about what needs to improve, and say what is expected, without naming any consequence');
        out.push('- Use the % symbol rather than the word percent');
        out.push('- Do not use dashes of any kind. Use commas and full stops');
        out.push('- Do not grade the overall performance or use any rating words');
        out.push('- About 4 to 7 sentences per box');
        out.push('- Return exactly this format and nothing else:');
        out.push('Progress & Strengths:');
        out.push('[text]');
        out.push('');
        out.push('Areas of Focus:');
        out.push('[text]');

        return out.join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.quarterReview = {
        REVIEW_METRICS: REVIEW_METRICS,
        MIN_SURVEYS_FOR_TREND: MIN_SURVEYS_FOR_TREND,
        buildContext: buildContext,
        splitForBoxes: splitForBoxes,
        progressionPhrase: progressionPhrase,
        metricSentence: metricSentence,
        reliabilitySentence: reliabilitySentence,
        buildHeader: buildHeader,
        buildNotes: buildNotes,
        buildPrompt: buildPrompt,
        factLines: factLines,
        buildProgressionBlock: buildProgressionBlock
    };
})();
