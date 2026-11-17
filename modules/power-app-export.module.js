/* Copy for the Power App (Scott, 2026-11-17).
 *
 * The Development Coaching Power App keeps Scott's records in SharePoint. This
 * puts one year of his team's records and figures on the clipboard as JSON for
 * the app's Import screen to paste. Nothing is written to the PC and nothing is
 * sent anywhere: the clipboard is the only way out.
 *
 * Every number comes from the same lookups the Year-End and Quarterly pages
 * use, so the app shows what this site shows:
 * - the year to date row is getLatestYearPeriodForEmployee's (a real YTD
 *   upload first), and its call count is used only when it is a real count
 *   (a YTD file's "calls" is often the survey count),
 * - quarters come from quarterTrend.buildYearQuarters,
 * - wins and focus areas from buildYearEndMetricSnapshot, the on/off result
 *   from calculateYearEndOnOffMirror, the quarter story from
 *   quarterReview.buildProgressionBlock (without hours).
 * A survey metric with no surveys behind it goes over blank, never 0, and so
 * does a 0 second handle time.
 *
 * Record keys match the app's own, so pasting again overwrites rather than
 * doubles. The app decides what an import may overwrite (it never overwrites
 * a review that was edited in the app).
 */
(function () {
    'use strict';

    window.DevCoachModules = window.DevCoachModules || {};

    var VERSION = 1;
    var PART_CHARS = 60000;

    // Website metric key -> SharePoint column in Coaching Figures.
    var METRIC_COLUMNS = {
        scheduleAdherence: 'ScheduleAdherence',
        cxRepOverall: 'RepSat',
        fcr: 'FCR',
        overallExperience: 'OverallExperience',
        transfers: 'Transfers',
        totalCalls: 'TotalCalls',
        transfersCount: 'TransfersCount',
        overallSentiment: 'OverallSentiment',
        positiveWord: 'PositiveWord',
        negativeWord: 'NegativeWord',
        managingEmotions: 'ManagingEmotions',
        aht: 'AHT',
        acw: 'ACW',
        holdTime: 'HoldTime',
        reliability: 'Reliability'
    };
    var SURVEY_FIELDS = { cxRepOverall: 'repSurveyTotal', fcr: 'fcrSurveyTotal', overallExperience: 'surveyTotal' };
    var OUTREACH_KINDS = { highfive: 'High five', checkinround: 'Check-in' };
    var COACH_SOURCE_KINDS = { call: 'Call coaching', today: 'Teams message', coach: 'Coaching email', trend: 'Coaching email' };
    var TEXT_CAP = 4000;

    /* ── Sources: the live app by default, swapped for made-up data in tests ── */

    function defaultSources() {
        var w = window;
        var dc = w.DevCoachModules || {};
        return {
            team: function () { return typeof w.getYearEndEmployees === 'function' ? w.getYearEndEmployees() : []; },
            email: function (name) {
                var su = dc.sharedUtils;
                return su && typeof su.resolveAssociateEmail === 'function' ? su.resolveAssociateEmail(name) : '';
            },
            nickname: function (name) { return typeof w.getEmployeeNickname === 'function' ? w.getEmployeeNickname(name) : ''; },
            store: function (key) {
                try { return dc.storage && dc.storage.readStore ? dc.storage.readStore(key) : undefined; } catch (e) { return undefined; }
            },
            latestPeriod: function (name, year) {
                return typeof w.getLatestYearPeriodForEmployee === 'function' ? w.getLatestYearPeriodForEmployee(name, year) : null;
            },
            quarters: function (year) {
                var qt = dc.quarterTrend;
                return qt && typeof qt.buildYearQuarters === 'function' ? (qt.buildYearQuarters(year) || []) : [];
            },
            findInQuarter: function (qa, name) {
                var qt = dc.quarterTrend;
                return qt && typeof qt.findEmployee === 'function' ? qt.findEmployee(qa, name) : null;
            },
            hasRealCallCount: function (row) {
                var dp = dc.dataParsing;
                if (dp && typeof dp.hasRealCallCount === 'function') return dp.hasRealCallCount(row);
                var calls = parseFloat(row && row.totalCalls);
                var surveys = parseFloat(row && row.surveyTotal);
                return Number.isFinite(calls) && calls > 0 && (!Number.isFinite(surveys) || calls > surveys);
            },
            snapshot: function (rec, year, meta) {
                return typeof w.buildYearEndMetricSnapshot === 'function' ? w.buildYearEndMetricSnapshot(rec, year, meta) : null;
            },
            metricLine: function (entry) {
                var ye = dc.yearEnd;
                return ye && typeof ye.metricLine === 'function' ? ye.metricLine(entry) : String(entry && entry.label || '');
            },
            onOff: function (rec, year) {
                return typeof w.calculateYearEndOnOffMirror === 'function' ? w.calculateYearEndOnOffMirror(rec, year) : null;
            },
            praise: function (name, year, opportunities) {
                var yc = dc.yearEndComments;
                return yc && typeof yc.buildYearEndPraiseLines === 'function'
                    ? (yc.buildYearEndPraiseLines(name, year, opportunities) || []) : [];
            },
            progression: function (name, year) {
                var qr = dc.quarterReview;
                return qr && typeof qr.buildProgressionBlock === 'function'
                    ? (qr.buildProgressionBlock(name, year, { reliability: false }) || '') : '';
            },
            targets: function (year) {
                var mp = dc.metricProfiles;
                return mp && typeof mp.getTargetsForYear === 'function' ? (mp.getTargetsForYear(year) || {}) : {};
            },
            metricLabel: function (key) {
                var reg = w.METRICS_REGISTRY || {};
                return reg[key] && reg[key].label ? reg[key].label : key;
            },
            cc: function () {
                var su = dc.sharedUtils;
                return su && typeof su.getCoachingCcEmail === 'function' ? su.getCoachingCcEmail() : '';
            },
            now: function () { return new Date(); }
        };
    }

    /* ── Small helpers ── */

    function norm(name) { return String(name || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

    function cap(text) {
        var s = String(text == null ? '' : text);
        return s.length > TEXT_CAP ? s.slice(0, TEXT_CAP) : s;
    }

    function isoDate(value) {
        if (!value) return '';
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
        var d = value instanceof Date ? value : new Date(value);
        if (isNaN(d.getTime())) {
            var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value));
            if (!m) return '';
            d = new Date(+m[3], +m[1] - 1, +m[2]);
        }
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
    }

    function isoDateTime(value) {
        if (!value) return '';
        var d = new Date(value);
        return isNaN(d.getTime()) ? '' : d.toISOString();
    }

    function yearOf(isoDay) { return isoDay ? parseInt(isoDay.slice(0, 4), 10) : NaN; }

    function num(value) {
        if (value === null || value === undefined || value === '' || value === 'N/A') return null;
        var n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    // One associate's figures as Coaching Figures columns. Blank, never 0, for
    // a survey metric with no surveys and for a 0 second handle time.
    function figureColumns(rec, options) {
        var opts = options || {};
        var out = {};
        Object.keys(METRIC_COLUMNS).forEach(function (key) {
            if (key === 'reliability' && !opts.withReliability) return;
            if (key === 'totalCalls') return;
            var v = num(rec && rec[key]);
            if (v !== null && SURVEY_FIELDS[key]) {
                var count = num(rec[SURVEY_FIELDS[key]]);
                if (count === null && key !== 'overallExperience') count = num(rec.surveyTotal);
                if (count === 0) v = null;
            }
            if (v === 0 && key === 'aht') v = null;
            out[METRIC_COLUMNS[key]] = v;
        });
        out.TotalCalls = opts.calls === undefined ? null : opts.calls;
        out.Surveys = num(rec && rec.surveyTotal);
        return out;
    }

    /* ── The export ── */

    function buildExport(year, sources) {
        var src = Object.assign(defaultSources(), sources || {});
        var y = parseInt(year, 10);
        var names = (src.team() || []).filter(function (n) { return String(n || '').trim(); });
        var byNorm = {};
        var people = names.map(function (name) {
            var email = String(src.email(name) || '').trim().toLowerCase();
            var person = { name: name, email: email, preferred: src.nickname(name) || '' };
            byNorm[norm(name)] = person;
            return person;
        }).filter(function (p) { return p.email; });
        var find = function (name) { return byNorm[norm(name)] || null; };

        var out = {
            v: VERSION, kind: 'dct-export', year: y, exportedAt: src.now().toISOString(),
            associates: [], log: [], reviews: [], figures: [], settings: [],
            skipped: names.length - people.length
        };

        people.forEach(function (p) {
            out.associates.push({ key: p.email, name: p.name, preferred: p.preferred, email: p.email });
        });

        addLog(out, y, src, find);
        addReviews(out, y, src, people);
        addFigures(out, y, src, people);

        var targets = src.targets(y) || {};
        var targetRow = { key: 'target:' + y + ':all', name: '(targets)', email: 'all', year: y, ptype: 'Target',
            label: y + ' targets', start: '', end: '' };
        Object.keys(METRIC_COLUMNS).forEach(function (key) {
            var t = targets[key];
            if (t && t.value !== undefined && t.value !== null) targetRow[METRIC_COLUMNS[key]] = num(t.value);
        });
        out.figures.push(targetRow);

        var cc = src.cc();
        if (cc) out.settings.push({ key: 'CcEmail', value: cc });
        // Stored as { text, updatedAt } per year (year-end-comments). A year
        // with nothing saved reads the default there, so nothing goes over.
        var openings = src.store('yearEndOpening') || {};
        var opening = openings[y];
        var openingText = String((opening && typeof opening === 'object' ? opening.text : opening) || '').trim();
        if (openingText) out.settings.push({ key: 'YearEndOpening:' + y, value: openingText });
        return out;
    }

    function logRow(person, y, fields) {
        return Object.assign({ name: person.name, email: person.email, year: y, subject: '', message: '',
            metrics: '', status: 'Logged', channel: 'Logged only', sentAt: '', details: '' }, fields);
    }

    function addLog(out, y, src, find) {
        var push = function (person, row) {
            if (!person || !row.date || yearOf(row.date) !== y) return;
            row.key = String(row.key).slice(0, 255);
            row.message = cap(row.message);
            out.log.push(logRow(person, y, row));
        };

        var history = src.store('coachingHistory') || {};
        Object.keys(history).forEach(function (name) {
            var person = find(name);
            (Array.isArray(history[name]) ? history[name] : []).forEach(function (e) {
                if (!e) return;
                var date = isoDate(e.generatedAt || e.weekEnding);
                var kind = COACH_SOURCE_KINDS[e.source] || 'Coaching email';
                push(person, {
                    key: 'old:coach:' + (person && person.email) + ':' + (e.dedupeKey || e.generatedAt || e.weekEnding),
                    date: date, kind: kind, subject: kind,
                    message: (e.suggestions || []).map(function (s) { return s && s.text; }).filter(Boolean).join('\n'),
                    metrics: (e.metricsCoached || []).map(src.metricLabel).join(', '),
                    sentAt: isoDateTime(e.generatedAt)
                });
            });
        });

        var calls = src.store('callListeningLogs') || {};
        Object.keys(calls).forEach(function (name) {
            var person = find(name);
            (Array.isArray(calls[name]) ? calls[name] : []).forEach(function (c) {
                if (!c) return;
                var parts = [];
                if (c.whatWentWell) parts.push('What went well: ' + c.whatWentWell);
                if (c.improvementAreas) parts.push('To work on: ' + c.improvementAreas);
                if (c.managerNotes) parts.push('Notes: ' + c.managerNotes);
                if (!parts.length && c.copilotSummary) parts.push(c.copilotSummary);
                push(person, {
                    key: 'old:call:' + (person && person.email) + ':' + (c.id || c.listenedOn + ' ' + (c.callTime || '')),
                    date: isoDate(c.listenedOn || c.createdAt), kind: 'Call listening', subject: 'Call listening',
                    message: parts.join('\n'),
                    details: JSON.stringify({ callReference: c.callReference || '', callTime: c.callTime || '' })
                });
            });
        });

        var follow = (src.store('followUpHistory') || {}).entries || [];
        follow.forEach(function (f) {
            if (!f) return;
            var person = find(f.associateName || f.name || f.employee);
            if (f.kind === 'qa') {
                var qaDate = isoDate(f.emailedAt || f.evalDate || f.dueDate);
                push(person, {
                    key: 'old:qa:' + (person && person.email) + ':' + (f.dedupeKey || f.sessionId || qaDate),
                    date: qaDate, kind: 'QA coaching', subject: 'QA coaching', channel: f.emailedAt ? 'Email' : 'Logged only',
                    status: f.readAt ? 'Read' : (f.emailedAt ? 'Sent' : 'Logged'), sentAt: isoDateTime(f.emailedAt),
                    message: f.reasonKey ? 'Reason: ' + f.reasonKey : '',
                    details: JSON.stringify({ sessionId: f.sessionId || '', verintAt: f.verintAt || '', readAt: f.readAt || '' })
                });
                return;
            }
            // Customer names and account numbers stay behind.
            var fDate = isoDate(f.sentAt);
            push(person, {
                key: 'old:followup:' + (person && person.email) + ':' + (f.id || f.sentAt),
                date: fDate, kind: 'Follow up', subject: f.todoType ? 'Follow up: ' + f.todoType : 'Follow up',
                channel: 'Email', status: 'Sent', sentAt: isoDateTime(f.sentAt),
                message: [f.declineReason ? 'What happened: ' + f.declineReason : '',
                    f.correctProcess ? 'Correct process: ' + f.correctProcess : ''].filter(Boolean).join('\n')
            });
        });

        var ones = src.store('oneOnOneMeetings') || {};
        Object.keys(ones).forEach(function (name) {
            var person = find(name);
            (Array.isArray(ones[name]) ? ones[name] : []).forEach(function (m) {
                if (!m) return;
                var d = isoDate(m.date);
                push(person, { key: 'old:1on1:' + (person && person.email) + ':' + d, date: d, kind: '1:1',
                    subject: '1:1', message: m.notes || '' });
            });
        });

        // Intelligence keeps these on its Year-to-Date Summary row, keyed
        // 'ytd-summary', with no date or year of their own. They go over under
        // the year being copied: dated today for this year, December 31 for a
        // past one. A key that is a week (start|end) is dated by its last day.
        var now = src.now();
        var summaryDate = now.getFullYear() === y ? isoDate(now) : y + '-12-31';
        var exec = src.store('executiveSummaryNotes') || {};
        Object.keys(exec).forEach(function (name) {
            var person = find(name);
            var weeks = exec[name] || {};
            Object.keys(weeks).forEach(function (weekKey) {
                var note = weeks[weekKey] || {};
                var d = isoDate(String(weekKey).split('|').sort().pop()) || summaryDate;
                if (note.redFlags && String(note.redFlags).trim()) {
                    push(person, { key: 'old:redflag:' + (person && person.email) + ':' + y + ':' + weekKey, date: d,
                        kind: 'Red flag', subject: 'Red flag', message: note.redFlags });
                }
                if (note.phishing && String(note.phishing).trim()) {
                    push(person, { key: 'old:phishing:' + (person && person.email) + ':' + y + ':' + weekKey, date: d,
                        kind: 'Note', subject: 'Phishing', message: note.phishing });
                }
            });
        });

        var outreach = src.store('dailyOutreachSent') || {};
        Object.keys(outreach).forEach(function (k) {
            var e = outreach[k] || {};
            var bits = String(k).split('|');
            var person = find(e.employee || bits[bits.length - 1]);
            var plan = e.plan || bits[0];
            var kind = OUTREACH_KINDS[plan] || 'Teams message';
            push(person, { key: 'old:outreach:' + (person && person.email) + ':' + k, date: isoDate(e.at),
                kind: kind, subject: kind, channel: 'Teams chat', status: 'Sent', sentAt: isoDateTime(e.at) });
        });

        var recaps = src.store('quarterRecapEmails') || {};
        Object.keys(recaps).forEach(function (k) {
            var bits = String(k).split('|');
            var events = Array.isArray(recaps[k]) ? recaps[k] : [];
            var last = events[events.length - 1];
            if (!last || parseInt(bits[1], 10) !== y) return;
            var status = { sent: 'Sent', drafted: 'Drafted', skipped: 'Skipped', unsent: 'Drafted' }[last.event] || 'Logged';
            push(find(bits[0]), { key: 'old:recap:' + k, date: isoDate(last.at), kind: 'Quarterly recap',
                subject: last.subject || (bits[2] + ' recap'), channel: 'Email', status: status,
                sentAt: last.event === 'sent' ? isoDateTime(last.at) : '' });
        });
    }

    function addReviews(out, y, src, people) {
        var drafts = src.store('yearEndDraftEntries') || {};
        var goals = src.store('yearEndAnnualGoals') || {};
        var mids = src.store('midYearMeta') || {};
        var qnotes = src.store('quarterReviewNotes') || {};
        var lookup = function (map, key) {
            var want = norm(key);
            var hit = Object.keys(map).find(function (k) { return norm(k) === want; });
            return hit ? map[hit] : undefined;
        };

        people.forEach(function (p) {
            var d = lookup(drafts, y + '::' + p.name) || {};
            var g = lookup(goals, y + '::' + p.name) || {};
            var typed = ['positivesText', 'improvementsText', 'managerContext', 'copilotResponse', 'verbalSummary']
                .some(function (f) { return String(d[f] || '').trim(); });
            out.reviews.push({
                key: 'yearend:' + y + ':' + p.email, name: p.name, email: p.email, year: y, type: 'Year-End',
                status: typed ? 'Drafting' : 'Not started', track: d.trackStatus || '',
                positives: d.positivesText || '', improvements: d.improvementsText || '', context: d.managerContext || '',
                goals: Object.keys(g).length ? JSON.stringify(g) : '', rating: d.performanceRating || '',
                merit: d.meritDetails || '', bonus: d.bonusAmount || '', verbal: d.verbalSummary || '',
                copilot: d.copilotResponse || '', notes: '', posted: false,
                facts: JSON.stringify(yearEndFacts(p.name, y, src))
            });

            var m = lookup(mids, p.name + '|' + y);
            if (m) {
                out.reviews.push({ key: 'midyear:' + y + ':' + p.email, name: p.name, email: p.email, year: y,
                    type: 'Mid-Year', status: m.posted ? 'Posted' : (String(m.notes || '').trim() ? 'Drafting' : 'Not started'),
                    track: m.statusOverride && m.statusOverride !== 'auto' ? m.statusOverride : '',
                    notes: m.notes || '', posted: !!m.posted });
            }
            for (var q = 1; q <= 4; q++) {
                var note = lookup(qnotes, p.name + '|' + y + '|Q' + q);
                if (note && String(note).trim()) {
                    out.reviews.push({ key: 'q' + q + ':' + y + ':' + p.email, name: p.name, email: p.email, year: y,
                        type: 'Q' + q, status: 'Drafting', notes: String(note) });
                }
            }
        });
    }

    function yearEndFacts(name, y, src) {
        var latest = src.latestPeriod(name, y);
        if (!latest || !latest.employeeRecord) return { asOf: '', wins: [], focus: [] };
        var meta = latest.period && latest.period.metadata;
        var snap = src.snapshot(latest.employeeRecord, y, meta) || { wins: [], opportunities: [] };
        var onOff = src.onOff(latest.employeeRecord, y) || {};
        var wins = snap.wins || [];
        return {
            asOf: isoDate(meta && meta.endDate) || isoDate(latest.endDate),
            periodLabel: latest.label || '',
            source: latest.sourceName === 'ytdData' ? 'YTD upload' : 'latest uploaded period',
            targetYear: snap.targetProfileYear || null,
            wins: wins.map(src.metricLine),
            focus: (snap.opportunities || []).map(src.metricLine),
            // Only when nothing is at goal: a metric at goal is the praise.
            praise: wins.length ? [] : (src.praise(name, y, snap.opportunities || []) || []),
            onOff: onOff.trackLabel || '',
            onOffValue: onOff.trackStatusValue || '',
            ratingAverage: Number.isFinite(onOff.ratingAverage) ? Math.round(onOff.ratingAverage * 100) / 100 : null,
            progression: src.progression(name, y) || ''
        };
    }

    function addFigures(out, y, src, people) {
        var quarters = (src.quarters(y) || []).filter(function (qa) { return qa && !qa.empty; });
        people.forEach(function (p) {
            var latest = src.latestPeriod(p.name, y);
            if (latest && latest.employeeRecord) {
                var rec = latest.employeeRecord;
                var meta = (latest.period && latest.period.metadata) || {};
                var end = isoDate(meta.endDate) || isoDate(latest.endDate);
                var isYtd = latest.sourceName === 'ytdData';
                var calls = src.hasRealCallCount(rec) ? num(rec.totalCalls) : null;
                out.figures.push(Object.assign({
                    key: (isYtd ? 'ytd:' : 'latest:') + end + ':' + p.email, name: p.name, email: p.email, year: y,
                    ptype: isYtd ? 'YTD' : 'Latest', label: latest.label || (isYtd ? 'Year to date' : 'Latest period'),
                    start: isoDate(meta.startDate), end: end
                }, figureColumns(rec, { withReliability: isYtd, calls: calls })));
            }
            quarters.forEach(function (qa) {
                var emp = src.findInQuarter(qa, p.name);
                if (!emp) return;
                out.figures.push(Object.assign({
                    key: 'quarter:' + y + '-Q' + qa.quarter + ':' + p.email, name: p.name, email: p.email, year: y,
                    ptype: 'Quarter', label: qa.label || ('Q' + qa.quarter + ' ' + y),
                    start: isoDate(qa.spanStart || qa.startDate), end: isoDate(qa.spanEnd || qa.endDate)
                }, figureColumns(emp, { withReliability: false, calls: num(emp.totalCalls) })));
            });
        });
    }

    /* Split into parts small enough to paste. Each part stands alone (same
     * header, its own slice of the rows), so they can be pasted in any order. */
    function splitParts(exp, maxChars) {
        var limit = maxChars || PART_CHARS;
        var header = { v: exp.v, kind: exp.kind, year: exp.year, exportedAt: exp.exportedAt };
        var lists = ['associates', 'settings', 'figures', 'reviews', 'log'];
        var parts = [];
        var blank = function () {
            var p = Object.assign({}, header);
            lists.forEach(function (l) { p[l] = []; });
            return p;
        };
        var cur = blank();
        var size = JSON.stringify(cur).length + 40;
        lists.forEach(function (l) {
            (exp[l] || []).forEach(function (row) {
                var len = JSON.stringify(row).length + 1;
                if (size + len > limit && size > JSON.stringify(blank()).length + 40) {
                    parts.push(cur);
                    cur = blank();
                    size = JSON.stringify(cur).length + 40;
                }
                cur[l].push(row);
                size += len;
            });
        });
        parts.push(cur);
        return parts.map(function (p, i) {
            p.part = i + 1;
            p.parts = parts.length;
            return JSON.stringify(p);
        });
    }

    function defaultYear(now) {
        var d = now || new Date();
        // January and February are review season for the year just ended.
        return d.getMonth() <= 1 ? d.getFullYear() - 1 : d.getFullYear();
    }

    /* ── The Sync & Backup panel ── */

    var lastParts = [];

    function renderResult(box, exp, parts) {
        var counts = exp.associates.length + ' people, ' + exp.log.length + ' coaching records, '
            + exp.reviews.length + ' reviews, ' + exp.figures.length + ' figure rows';
        var how = parts.length === 1
            ? 'Copied. Paste it into the Import screen of the Power App.'
            : 'Too big for one paste, so it is in ' + parts.length + ' parts. Copy and paste each one into the Import screen.';
        var skipped = exp.skipped ? ' ' + exp.skipped + ' on the team had no email address and were left out.' : '';
        box.textContent = '';
        var p = document.createElement('div');
        p.textContent = counts + '. ' + how + skipped;
        box.appendChild(p);
        if (parts.length > 1) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;';
            parts.forEach(function (_, i) {
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'btn-secondary';
                b.textContent = 'Copy part ' + (i + 1) + ' of ' + parts.length;
                b.setAttribute('data-power-app-part', String(i));
                row.appendChild(b);
            });
            box.appendChild(row);
        }
    }

    function copyText(text, button) {
        if (typeof window.copyToClipboard === 'function') return window.copyToClipboard(text, { button: button, silent: true });
        return Promise.resolve(false);
    }

    function onClick(ev) {
        var target = ev.target;
        if (!target || !target.closest) return;
        var button = target.closest('button');
        var main = button && button.id === 'powerAppExportBtn' ? button : null;
        var partBtn = target.closest('[data-power-app-part]');
        var box = document.getElementById('powerAppExportResult');
        if (main && box) {
            var yearInput = document.getElementById('powerAppExportYear');
            var year = parseInt(yearInput && yearInput.value, 10) || defaultYear();
            var exp = buildExport(year);
            lastParts = splitParts(exp);
            renderResult(box, exp, lastParts);
            if (lastParts.length === 1) copyText(lastParts[0], main);
        } else if (partBtn && lastParts.length) {
            var i = parseInt(partBtn.getAttribute('data-power-app-part'), 10);
            if (lastParts[i]) copyText(lastParts[i], partBtn);
        }
    }

    function init() {
        if (init.done || typeof document === 'undefined') return;
        init.done = true;
        document.addEventListener('click', onClick);
        var yearInput = document.getElementById('powerAppExportYear');
        if (yearInput && !yearInput.value) yearInput.value = String(defaultYear());
    }

    init();

    window.DevCoachModules.powerAppExport = {
        VERSION: VERSION,
        METRIC_COLUMNS: METRIC_COLUMNS,
        buildExport: buildExport,
        splitParts: splitParts,
        figureColumns: figureColumns,
        defaultYear: defaultYear,
        init: init
    };
})();
