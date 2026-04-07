(function() {
    'use strict';

    // ============================================
    // CELEBRATIONS MODULE
    // Detects team members who rank in the top N
    // across the center on individual metrics or
    // composite score, and generates emoji-filled
    // Teams shout-out messages.
    // ============================================

    var STORAGE_KEY = 'devCoachingTool_celebrationsThreshold';
    var DEFAULT_TIERS = [1, 5, 10];

    // Metric rank keys from center-ranking module → friendly labels
    var METRIC_RANK_LABELS = {
        aht: { label: 'Average Handle Time', icon: '\u23F1\uFE0F', registry: 'aht' },
        adherence: { label: 'Schedule Adherence', icon: '\uD83D\uDCC5', registry: 'scheduleAdherence' },
        sentiment: { label: 'Overall Sentiment', icon: '\uD83D\uDCAD', registry: 'overallSentiment' },
        associateOverall: { label: 'Rep Satisfaction', icon: '\uD83D\uDE0A', registry: 'cxRepOverall' },
        reliability: { label: 'Reliability', icon: '\uD83C\uDFAF', registry: 'reliability' }
    };

    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function _getFirstName(fullName) {
        if (typeof getEmployeeNickname === 'function') return getEmployeeNickname(fullName);
        return String(fullName).split(/[\s,]+/)[0];
    }

    // --- Settings ---

    function getCustomThreshold() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return null;
            var val = parseInt(raw, 10);
            return val > 0 ? val : null;
        } catch (e) { return null; }
    }

    function saveCustomThreshold(val) {
        try {
            if (val && parseInt(val, 10) > 0) {
                localStorage.setItem(STORAGE_KEY, String(parseInt(val, 10)));
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) { /* ok */ }
    }

    function getActiveTiers() {
        var tiers = DEFAULT_TIERS.slice();
        var custom = getCustomThreshold();
        if (custom && !tiers.includes(custom)) {
            tiers.push(custom);
            tiers.sort(function(a, b) { return a - b; });
        }
        return tiers;
    }

    // --- Detection ---

    /**
     * Scans center rankings for team members who hit notable thresholds.
     * Returns array of { name, firstName, achievements[] } where each achievement is:
     *   { type: 'metric'|'composite', key, label, icon, rank, tier, tierLabel, totalEmployees, value }
     */
    function detectCelebrations() {
        var centerRanking = window.DevCoachModules?.centerRanking;
        if (!centerRanking?.buildCenterRankings) return [];

        var data = centerRanking.buildCenterRankings();
        if (!data || !data.rankings.length) return [];

        var tiers = getActiveTiers();
        var maxTier = tiers[tiers.length - 1];
        var results = [];

        data.rankings.forEach(function(r) {
            if (!data.teamMembers.has(r.name)) return;

            var achievements = [];

            // Check composite rank
            if (r.rank <= maxTier) {
                var tier = getTierForRank(r.rank, tiers);
                achievements.push({
                    type: 'composite',
                    key: 'composite',
                    label: 'Overall Composite',
                    icon: '\uD83C\uDFC6',
                    rank: r.rank,
                    tier: tier.value,
                    tierLabel: tier.label,
                    totalEmployees: data.totalEmployees,
                    value: r.compositeScore.toFixed(1)
                });
            }

            // Check each individual metric rank
            Object.keys(METRIC_RANK_LABELS).forEach(function(metricKey) {
                var metricRank = r.metricRanks?.[metricKey];
                if (!metricRank || metricRank > maxTier) return;

                var meta = METRIC_RANK_LABELS[metricKey];
                var tier = getTierForRank(metricRank, tiers);
                var metricValue = metricKey === 'reliability' ? r.reliability : (r.values?.[metricKey] ?? null);

                achievements.push({
                    type: 'metric',
                    key: metricKey,
                    label: meta.label,
                    icon: meta.icon,
                    rank: metricRank,
                    tier: tier.value,
                    tierLabel: tier.label,
                    totalEmployees: data.totalEmployees,
                    value: metricValue
                });
            });

            if (achievements.length > 0) {
                // Sort: composite first, then by rank
                achievements.sort(function(a, b) {
                    if (a.type !== b.type) return a.type === 'composite' ? -1 : 1;
                    return a.rank - b.rank;
                });
                results.push({
                    name: r.name,
                    firstName: _getFirstName(r.name),
                    achievements: achievements
                });
            }
        });

        // Sort by best single achievement (lowest rank)
        results.sort(function(a, b) {
            var bestA = Math.min.apply(null, a.achievements.map(function(x) { return x.rank; }));
            var bestB = Math.min.apply(null, b.achievements.map(function(x) { return x.rank; }));
            return bestA - bestB;
        });

        return results;
    }

    function getTierForRank(rank, tiers) {
        if (rank === 1) return { value: 1, label: '#1 in Center' };
        for (var i = 0; i < tiers.length; i++) {
            if (rank <= tiers[i]) {
                return { value: tiers[i], label: 'Top ' + tiers[i] };
            }
        }
        return { value: rank, label: 'Top ' + rank };
    }

    // --- Shout-out message generation ---

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    var SHOUTOUT_OPENERS = [
        function(name) { return '\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89 HUGE shout-out to ' + name + '! \uD83C\uDF89\uD83C\uDF89\uD83C\uDF89'; },
        function(name) { return '\uD83D\uDE80\uD83C\uDF1F ' + name + ' is CRUSHING it! \uD83C\uDF1F\uD83D\uDE80'; },
        function(name) { return '\uD83D\uDCA5 Everyone give it up for ' + name + '! \uD83D\uDCA5'; },
        function(name) { return '\uD83C\uDFC6\u2B50 Let\'s hear it for ' + name + '! \u2B50\uD83C\uDFC6'; },
        function(name) { return '\uD83D\uDD25\uD83D\uDD25 ' + name + ' is on FIRE! \uD83D\uDD25\uD83D\uDD25'; }
    ];

    var NUMBER_ONE_LINES = [
        function(label) { return '\uD83E\uDD47 Ranked #1 in the ENTIRE center for ' + label + '!'; },
        function(label) { return '\uD83D\uDC51 Number ONE out of everyone for ' + label + '!'; },
        function(label) { return '\uD83C\uDFC6 THE top performer for ' + label + ' in the whole center!'; }
    ];

    var TOP_LINES = [
        function(label, rank, total) { return '\uD83C\uDFC5 Ranked #' + rank + ' out of ' + total + ' for ' + label + '!'; },
        function(label, rank, total) { return '\u2B50 Top ' + rank + ' out of ' + total + ' in ' + label + '!'; },
        function(label, rank, total) { return '\uD83D\uDCAA #' + rank + ' out of ' + total + ' in ' + label + '! That\'s elite!'; }
    ];

    var SHOUTOUT_CLOSERS = [
        '\uD83D\uDE4C Keep up the amazing work!',
        '\uD83D\uDCAF That\'s the kind of excellence we love to see!',
        '\uD83C\uDF1F You\'re setting the standard!',
        '\uD83D\uDE80 Sky\'s the limit! Keep pushing!',
        '\uD83D\uDD25 Absolutely incredible work!',
        '\uD83C\uDFC6 We see you and we appreciate you!',
        '\u2B50 The whole team is better because of you!'
    ];

    var BATCH_INTRO = [
        '\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89 SHOUT-OUT TIME! \uD83C\uDF89\uD83C\uDF89\uD83C\uDF89\n\nSome AMAZING performances from the team! Let\'s celebrate these wins:\n\n',
        '\uD83D\uDD25 TEAM WINS ALERT \uD83D\uDD25\n\nI\'ve got some incredible achievements to share. These folks are KILLING it:\n\n',
        '\u2B50 CELEBRATION TIME \u2B50\n\nLook at what this team is doing! So proud of these performers:\n\n',
        '\uD83C\uDFC6 TOP PERFORMERS SPOTLIGHT \uD83C\uDFC6\n\nLet me brag about some of our people for a minute:\n\n'
    ];

    var BATCH_CLOSERS = [
        '\n\uD83D\uDE4C Amazing work everyone! Let\'s keep this energy going!',
        '\n\uD83D\uDCAF This team is something special. Proud of each and every one of you!',
        '\n\uD83D\uDE80 The bar keeps rising and you all keep clearing it. Incredible!',
        '\n\uD83D\uDD25 This is what happens when a great team shows up and shows out!'
    ];

    function formatMetricValue(key, value) {
        if (value === null || value === undefined) return '';
        var registryKey = METRIC_RANK_LABELS[key]?.registry || key;
        var reg = window.METRICS_REGISTRY?.[registryKey];
        if (!reg) return String(value);
        if (reg.unit === 'sec') return Math.round(value) + 's';
        if (reg.unit === 'hrs') return parseFloat(value).toFixed(1) + ' hrs';
        if (reg.unit === '%') return parseFloat(value).toFixed(1) + '%';
        return String(value);
    }

    function generateShoutOut(person, dateRange) {
        var lines = [];
        lines.push(pick(SHOUTOUT_OPENERS)(person.firstName));
        lines.push('');

        person.achievements.forEach(function(a) {
            var valStr = a.value !== null && a.value !== undefined ? ' (' + formatMetricValue(a.key, a.value) + ')' : '';
            if (a.rank === 1) {
                lines.push(pick(NUMBER_ONE_LINES)(a.label) + valStr);
            } else {
                lines.push(pick(TOP_LINES)(a.label, a.rank, a.totalEmployees) + valStr);
            }
        });

        if (dateRange) {
            lines.push('');
            lines.push('\uD83D\uDCC5 ' + dateRange);
        }

        lines.push('');
        lines.push(pick(SHOUTOUT_CLOSERS));

        return lines.join('\n');
    }

    function generateAllShoutOuts(celebrations, dateRange) {
        if (!celebrations.length) return 'No celebrations to report right now.';

        var msg = pick(BATCH_INTRO);

        celebrations.forEach(function(person, idx) {
            if (idx > 0) msg += '\n\n---\n\n';

            var emoji = person.achievements.some(function(a) { return a.rank === 1; }) ? '\uD83D\uDC51' : '\uD83C\uDFC5';
            msg += emoji + ' ' + person.firstName + '\n';

            person.achievements.forEach(function(a) {
                var valStr = a.value !== null && a.value !== undefined ? ' (' + formatMetricValue(a.key, a.value) + ')' : '';
                if (a.rank === 1) {
                    msg += '   \uD83E\uDD47 #1 in ' + a.label + valStr + '\n';
                } else {
                    msg += '   \u2B50 #' + a.rank + ' of ' + a.totalEmployees + ' in ' + a.label + valStr + '\n';
                }
            });
        });

        if (dateRange) {
            msg += '\n\uD83D\uDCC5 ' + dateRange;
        }

        msg += pick(BATCH_CLOSERS);

        return msg;
    }

    // --- UI Rendering ---

    function getTierBadge(tier) {
        if (tier === 1) return { bg: '#ffd700', color: '#7c5c00', text: '#1', glow: '0 0 8px rgba(255,215,0,0.6)' };
        if (tier <= 5) return { bg: '#c0c0c0', color: '#444', text: 'Top 5', glow: '0 0 6px rgba(192,192,192,0.5)' };
        if (tier <= 10) return { bg: '#cd7f32', color: '#fff', text: 'Top 10', glow: '0 0 6px rgba(205,127,50,0.4)' };
        return { bg: '#667eea', color: '#fff', text: 'Top ' + tier, glow: 'none' };
    }

    function getDateRangeFromRankings() {
        var centerRanking = window.DevCoachModules?.centerRanking;
        if (!centerRanking?.buildCenterRankings) return '';
        var data = centerRanking.buildCenterRankings();
        if (!data) return '';
        var key = data.periodKey || '';
        if (key.includes('|')) {
            var parts = key.split('|');
            return formatDateFriendly(parts[0]) + ' - ' + formatDateFriendly(parts[1]);
        }
        return data.source || '';
    }

    function formatDateFriendly(dateStr) {
        try {
            var d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) { return dateStr; }
    }

    function renderCelebrations(container) {
        if (!container) return;

        var celebrations = detectCelebrations();
        var dateRange = getDateRangeFromRankings();
        var customThreshold = getCustomThreshold();
        var tiers = getActiveTiers();

        var html = '';

        // Settings bar
        html += '<div style="margin-bottom:16px; padding:12px 16px; background:#fff; border:1px solid #e0e7ff; border-radius:10px; display:flex; align-items:center; gap:16px; flex-wrap:wrap;">';
        html += '<div style="font-weight:600; color:#475569; font-size:0.9em;">Threshold:</div>';
        html += '<div style="display:flex; gap:6px; align-items:center;">';
        DEFAULT_TIERS.forEach(function(t) {
            html += '<span style="padding:4px 10px; background:#e0e7ff; border-radius:12px; font-size:0.85em; font-weight:600; color:#4338ca;">Top ' + t + '</span>';
        });
        html += '</div>';
        html += '<div style="display:flex; align-items:center; gap:8px;">';
        html += '<label for="celebrationCustomThreshold" style="font-size:0.85em; color:#64748b;">Custom:</label>';
        html += '<input type="number" id="celebrationCustomThreshold" min="1" max="999" placeholder="e.g. 15" value="' + (customThreshold || '') + '" style="width:70px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85em;">';
        html += '<button type="button" id="celebrationSaveThreshold" style="padding:6px 12px; background:#4338ca; color:#fff; border:none; border-radius:6px; font-size:0.85em; cursor:pointer;">Save</button>';
        html += '</div>';
        if (dateRange) {
            html += '<div style="margin-left:auto; font-size:0.85em; color:#64748b;">\uD83D\uDCC5 ' + _escapeHtml(dateRange) + '</div>';
        }
        html += '</div>';

        if (!celebrations.length) {
            html += '<div style="text-align:center; padding:60px 20px; color:#94a3b8;">';
            html += '<div style="font-size:3em; margin-bottom:16px;">\uD83C\uDFC6</div>';
            html += '<h3 style="color:#64748b; margin:0 0 8px 0;">No Celebrations Yet</h3>';
            html += '<p style="margin:0;">Upload center-wide data to see if your team members rank in the top ' + tiers[tiers.length - 1] + '.<br>Rankings are based on the On/Off Track scoring system (AHT, Adherence, Sentiment, Rep Satisfaction, Reliability).</p>';
            html += '</div>';
            container.innerHTML = html;
            bindCelebrationControls(container, dateRange);
            return;
        }

        // Generate All button
        html += '<div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">';
        html += '<button type="button" id="celebrationGenerateAll" style="padding:12px 24px; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:#fff; border:none; border-radius:8px; font-weight:bold; font-size:1em; cursor:pointer; box-shadow:0 2px 8px rgba(234,88,12,0.3);">';
        html += '\uD83C\uDF89 Generate All Shout-Outs</button>';
        html += '<div style="display:flex; align-items:center; gap:8px; color:#64748b; font-size:0.9em;">';
        html += '\uD83C\uDFC5 ' + celebrations.length + ' team member' + (celebrations.length !== 1 ? 's' : '') + ' with achievements';
        html += '</div>';
        html += '</div>';

        // Celebration cards
        html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:16px;">';

        celebrations.forEach(function(person) {
            var bestRank = Math.min.apply(null, person.achievements.map(function(a) { return a.rank; }));
            var bestBadge = getTierBadge(bestRank <= 1 ? 1 : bestRank <= 5 ? 5 : bestRank <= 10 ? 10 : bestRank);
            var cardBorder = bestRank === 1 ? '#ffd700' : bestRank <= 5 ? '#c0c0c0' : '#cd7f32';

            html += '<div class="celebration-card" style="background:#fff; border-radius:10px; border:2px solid ' + cardBorder + '; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:' + bestBadge.glow + ';">';

            // Header
            html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
            html += '<div style="font-weight:700; font-size:1.1em; color:#1a1a2e;">' + _escapeHtml(person.firstName) + '</div>';
            html += '<div style="display:flex; gap:4px;">';
            // Show unique tier badges
            var shownTiers = {};
            person.achievements.forEach(function(a) {
                var tierKey = a.rank === 1 ? 1 : a.tier;
                if (!shownTiers[tierKey]) {
                    shownTiers[tierKey] = true;
                    var badge = getTierBadge(tierKey);
                    html += '<span style="padding:3px 10px; background:' + badge.bg + '; color:' + badge.color + '; border-radius:12px; font-size:0.8em; font-weight:700;">' + badge.text + '</span>';
                }
            });
            html += '</div></div>';

            // Date range
            if (dateRange) {
                html += '<div style="font-size:0.8em; color:#64748b;">\uD83D\uDCC5 ' + _escapeHtml(dateRange) + '</div>';
            }

            // Achievement list
            html += '<div style="display:flex; flex-direction:column; gap:6px;">';
            person.achievements.forEach(function(a) {
                var valStr = a.value !== null && a.value !== undefined ? ' <span style="color:#64748b;">(' + _escapeHtml(formatMetricValue(a.key, a.value)) + ')</span>' : '';
                var rankEmoji = a.rank === 1 ? '\uD83E\uDD47' : a.rank <= 5 ? '\uD83E\uDD48' : '\uD83E\uDD49';
                var bg = a.rank === 1 ? '#fffbeb' : a.rank <= 5 ? '#f0f9ff' : '#faf5ff';
                var border = a.rank === 1 ? '#fbbf24' : a.rank <= 5 ? '#93c5fd' : '#c4b5fd';

                html += '<div style="padding:8px 12px; background:' + bg + '; border-left:3px solid ' + border + '; border-radius:4px; font-size:0.9em;">';
                html += rankEmoji + ' <strong>' + _escapeHtml(a.label) + '</strong> - #' + a.rank + ' of ' + a.totalEmployees + valStr;
                html += '</div>';
            });
            html += '</div>';

            // Action buttons
            html += '<div style="display:flex; gap:8px; margin-top:auto;">';
            html += '<button type="button" class="celebration-shoutout-btn" data-employee="' + _escapeHtml(person.name) + '" ' +
                'style="flex:1; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">' +
                '\uD83C\uDF89 Shout-Out</button>';
            html += '<button type="button" class="celebration-dm-btn" data-employee="' + _escapeHtml(person.name) + '" ' +
                'style="flex:1; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">' +
                '\uD83D\uDCAC Message</button>';
            html += '</div>';

            html += '</div>';
        });

        html += '</div>';

        container.innerHTML = html;
        bindCelebrationControls(container, dateRange);
        bindCelebrationButtons(container, celebrations, dateRange);
    }

    function bindCelebrationControls(container, dateRange) {
        var saveBtn = container.querySelector('#celebrationSaveThreshold');
        var input = container.querySelector('#celebrationCustomThreshold');
        if (saveBtn && input) {
            saveBtn.addEventListener('click', function() {
                saveCustomThreshold(input.value);
                renderCelebrations(container);
                if (typeof showToast === 'function') showToast('Threshold saved!', 2000);
            });
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    saveCustomThreshold(input.value);
                    renderCelebrations(container);
                    if (typeof showToast === 'function') showToast('Threshold saved!', 2000);
                }
            });
        }
    }

    function bindCelebrationButtons(container, celebrations, dateRange) {
        // Generate All
        var genAllBtn = container.querySelector('#celebrationGenerateAll');
        if (genAllBtn) {
            genAllBtn.addEventListener('click', function() {
                var msg = generateAllShoutOuts(celebrations, dateRange);
                showShoutOutModal('Team Shout-Outs', msg, function() {
                    return generateAllShoutOuts(celebrations, dateRange);
                });
            });
        }

        // Individual shout-out buttons
        container.querySelectorAll('.celebration-shoutout-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var empName = this.dataset.employee;
                var person = celebrations.find(function(c) { return c.name === empName; });
                if (!person) return;
                var msg = generateShoutOut(person, dateRange);
                showShoutOutModal(person.firstName + ' - Shout-Out', msg, function() {
                    return generateShoutOut(person, dateRange);
                });
            });
        });

        // Individual DM buttons (generates a personal congratulations)
        container.querySelectorAll('.celebration-dm-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var empName = this.dataset.employee;
                var person = celebrations.find(function(c) { return c.name === empName; });
                if (!person) return;
                var msg = generateDirectMessage(person, dateRange);
                showShoutOutModal(person.firstName + ' - Direct Message', msg, function() {
                    return generateDirectMessage(person, dateRange);
                });
            });
        });
    }

    // --- Direct message (personal, not team-wide) ---

    var DM_OPENERS = [
        function(name) { return 'Hey ' + name + '! \uD83C\uDF1F'; },
        function(name) { return name + '! \uD83C\uDF89'; },
        function(name) { return 'Hey ' + name + ', wanted to reach out real quick! \u2B50'; },
        function(name) { return name + '! Got something great to share with you! \uD83D\uDE0A'; }
    ];

    var DM_CLOSERS = [
        'Seriously, great work. I wanted to make sure you knew how much I appreciate what you\'re doing. \uD83D\uDE4F',
        'Just wanted you to know I see the effort and the results. Keep being awesome! \uD83D\uDCAA',
        'You should be really proud of this. I know I am! \uD83D\uDE0A',
        'This is the kind of performance that stands out. Keep it up! \uD83D\uDE80',
        'Wanted to make sure you heard this from me directly. Outstanding work! \uD83C\uDFC6'
    ];

    function generateDirectMessage(person, dateRange) {
        var lines = [];
        lines.push(pick(DM_OPENERS)(person.firstName));
        lines.push('');
        lines.push('I was looking at the numbers and I had to reach out because you are doing incredible things:');
        lines.push('');

        person.achievements.forEach(function(a) {
            var valStr = a.value !== null && a.value !== undefined ? ' (' + formatMetricValue(a.key, a.value) + ')' : '';
            if (a.rank === 1) {
                lines.push('\uD83E\uDD47 You\'re ranked #1 in the entire center for ' + a.label + '!' + valStr);
            } else {
                lines.push('\uD83C\uDFC5 You\'re #' + a.rank + ' out of ' + a.totalEmployees + ' in ' + a.label + '!' + valStr);
            }
        });

        if (dateRange) {
            lines.push('');
            lines.push('\uD83D\uDCC5 ' + dateRange);
        }

        lines.push('');
        lines.push(pick(DM_CLOSERS));

        return lines.join('\n');
    }

    // --- Modal ---

    function showShoutOutModal(title, message, regenerateFn) {
        // Copy to clipboard immediately
        try {
            navigator.clipboard.writeText(message);
            if (typeof showToast === 'function') showToast('Copied to clipboard!', 2000);
        } catch (e) { /* ok */ }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px;';

        overlay.innerHTML =
            '<div style="background:#fff; border-radius:12px; max-width:600px; width:100%; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="padding:16px 20px; border-bottom:1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center;">' +
                    '<h3 style="margin:0; color:#1a1a2e;">\uD83C\uDF89 ' + _escapeHtml(title) + '</h3>' +
                    '<button type="button" id="shoutOutModalClose" style="background:none; border:none; font-size:1.5em; cursor:pointer; color:#999;">\u2715</button>' +
                '</div>' +
                '<div style="padding:20px; overflow-y:auto; flex:1;">' +
                    '<textarea id="shoutOutModalText" style="width:100%; min-height:250px; border:1px solid #e5e7eb; border-radius:8px; padding:12px; font-size:0.95em; font-family:inherit; resize:vertical; line-height:1.5;">' + _escapeHtml(message) + '</textarea>' +
                '</div>' +
                '<div style="padding:12px 20px; border-top:1px solid #e5e7eb; display:flex; gap:8px; justify-content:flex-end;">' +
                    '<button type="button" id="shoutOutModalRegenerate" style="padding:10px 16px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; cursor:pointer; font-weight:600;">\uD83D\uDD04 Regenerate</button>' +
                    '<button type="button" id="shoutOutModalCopy" style="padding:10px 16px; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600;">\uD83D\uDCCB Copy</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        overlay.querySelector('#shoutOutModalClose').addEventListener('click', function() { overlay.remove(); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#shoutOutModalCopy').addEventListener('click', function() {
            var textarea = overlay.querySelector('#shoutOutModalText');
            try {
                navigator.clipboard.writeText(textarea.value);
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            } catch (e) { textarea.select(); }
        });

        overlay.querySelector('#shoutOutModalRegenerate').addEventListener('click', function() {
            if (!regenerateFn) return;
            var newMessage = regenerateFn();
            var textarea = overlay.querySelector('#shoutOutModalText');
            if (textarea && newMessage) {
                textarea.value = newMessage;
                try {
                    navigator.clipboard.writeText(newMessage);
                    if (typeof showToast === 'function') showToast('Regenerated & copied!', 2000);
                } catch (e) { /* ok */ }
            }
        });
    }

    // --- Inner tab toggle ---

    var INNER_TAB_STORAGE_KEY = 'devCoachingTool_celebrationsInnerTab';

    function getActiveInnerTab() {
        try {
            var val = localStorage.getItem(INNER_TAB_STORAGE_KEY);
            return val === 'morningPulse' ? 'morningPulse' : 'celebrations';
        } catch (e) { return 'celebrations'; }
    }

    function saveActiveInnerTab(tab) {
        try { localStorage.setItem(INNER_TAB_STORAGE_KEY, tab); } catch (e) { /* ok */ }
    }

    function switchInnerTab(tab) {
        var celebrationsContainer = document.getElementById('celebrationsContainer');
        var pulseContainer = document.getElementById('morningPulseContainer');
        var btnCelebrations = document.getElementById('innerNavCelebrations');
        var btnPulse = document.getElementById('innerNavMorningPulse');

        if (tab === 'morningPulse') {
            if (celebrationsContainer) celebrationsContainer.style.display = 'none';
            if (pulseContainer) pulseContainer.style.display = 'block';
            if (btnCelebrations) { btnCelebrations.style.background = '#e2e8f0'; btnCelebrations.style.color = '#64748b'; btnCelebrations.style.borderBottom = '3px solid transparent'; }
            if (btnPulse) { btnPulse.style.background = 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)'; btnPulse.style.color = '#fff'; btnPulse.style.borderBottom = '3px solid #2563eb'; }
            // Initialize morning pulse
            if (window.DevCoachModules?.morningPulse?.renderMorningPulse) {
                window.DevCoachModules.morningPulse.renderMorningPulse(pulseContainer);
            }
        } else {
            if (pulseContainer) pulseContainer.style.display = 'none';
            if (celebrationsContainer) celebrationsContainer.style.display = 'block';
            if (btnPulse) { btnPulse.style.background = '#e2e8f0'; btnPulse.style.color = '#64748b'; btnPulse.style.borderBottom = '3px solid transparent'; }
            if (btnCelebrations) { btnCelebrations.style.background = 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'; btnCelebrations.style.color = '#fff'; btnCelebrations.style.borderBottom = '3px solid #ea580c'; }
            renderCelebrations(celebrationsContainer);
        }
        saveActiveInnerTab(tab);
    }

    function bindInnerNav() {
        var btnCelebrations = document.getElementById('innerNavCelebrations');
        var btnPulse = document.getElementById('innerNavMorningPulse');

        if (btnCelebrations && !btnCelebrations._celebBound) {
            btnCelebrations._celebBound = true;
            btnCelebrations.addEventListener('click', function() { switchInnerTab('celebrations'); });
        }
        if (btnPulse && !btnPulse._celebBound) {
            btnPulse._celebBound = true;
            btnPulse.addEventListener('click', function() { switchInnerTab('morningPulse'); });
        }
    }

    // --- Initialization ---

    function initializeCelebrations() {
        bindInnerNav();
        var activeTab = getActiveInnerTab();
        switchInnerTab(activeTab);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.celebrations = {
        initializeCelebrations: initializeCelebrations,
        renderCelebrations: renderCelebrations,
        detectCelebrations: detectCelebrations,
        generateShoutOut: generateShoutOut,
        generateAllShoutOuts: generateAllShoutOuts,
        generateDirectMessage: generateDirectMessage,
        getCustomThreshold: getCustomThreshold,
        saveCustomThreshold: saveCustomThreshold
    };
})();
