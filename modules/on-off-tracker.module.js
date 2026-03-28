(function () {
    'use strict';

    /* ── Global helpers accessed via window ── */
    function _getMetricRatingScore(metricKey, value, year) {
        return window.getMetricRatingScore(metricKey, value, year);
    }

    function _formatMetricDisplay(key, value) {
        return window.formatMetricDisplay(key, value);
    }

    function _getYearEndTargetConfig(metricKey, reviewYear, periodMetadata) {
        return window.getYearEndTargetConfig(metricKey, reviewYear, periodMetadata);
    }

    function _getYearEndEmployees() {
        return window.getYearEndEmployees();
    }

    function _getLatestYearPeriodForEmployee(employeeName, reviewYear) {
        return window.getLatestYearPeriodForEmployee(employeeName, reviewYear);
    }

    function _formatDateMMDDYYYY(dateString) {
        return window.formatDateMMDDYYYY(dateString);
    }

    function _bindElementOnce(element, eventName, handler) {
        return window.bindElementOnce(element, eventName, handler);
    }

    /* ── Core helpers ── */

    function parseOnOffMirrorNumber(value) {
        if (value === null || value === undefined || value === '' || value === 'N/A') return null;
        const numeric = parseFloat(value);
        return Number.isNaN(numeric) ? null : numeric;
    }

    function isValidOnOffPercent(value) {
        return value !== null && value >= 0 && value <= 100;
    }

    function pickYearEndAssociateOverallValue(employeeRecord) {
        const overallExperienceVal = parseOnOffMirrorNumber(employeeRecord?.overallExperience);
        const cxRepOverallVal = parseOnOffMirrorNumber(employeeRecord?.cxRepOverall);

        if (isValidOnOffPercent(overallExperienceVal) && overallExperienceVal > 0) {
            return { value: overallExperienceVal, source: 'overallExperience' };
        }
        if (isValidOnOffPercent(cxRepOverallVal) && cxRepOverallVal > 0) {
            return { value: cxRepOverallVal, source: 'cxRepOverall' };
        }
        if (isValidOnOffPercent(overallExperienceVal)) {
            return { value: overallExperienceVal, source: 'overallExperience' };
        }
        if (isValidOnOffPercent(cxRepOverallVal)) {
            return { value: cxRepOverallVal, source: 'cxRepOverall' };
        }

        return { value: null, source: 'none' };
    }

    function buildYearEndOnOffValues(employeeRecord, associateOverallPick) {
        return {
            aht: parseOnOffMirrorNumber(employeeRecord?.aht),
            adherence: parseOnOffMirrorNumber(employeeRecord?.scheduleAdherence),
            sentiment: parseOnOffMirrorNumber(employeeRecord?.overallSentiment),
            associateOverall: associateOverallPick.value,
            reliability: parseOnOffMirrorNumber(employeeRecord?.reliability)
        };
    }

    function getYearEndOnOffScoreOrFallback(metricKey, value, scoreYear) {
        if (value === null) return null;

        const configuredScore = _getMetricRatingScore(metricKey, value, scoreYear);
        if (configuredScore !== null && configuredScore !== undefined) {
            return configuredScore;
        }

        // Fallback thresholds (used when no RATING_BANDS configured for the year)
        // Uses >= for min-type and <= for max-type, matching getRatingScore logic
        if (metricKey === 'aht') {
            return value <= 414 ? 3 : (value <= 434 ? 2 : 1);
        }
        if (metricKey === 'scheduleAdherence') {
            return value >= 94.5 ? 3 : (value >= 92.5 ? 2 : 1);
        }
        if (metricKey === 'overallSentiment') {
            return value >= 90 ? 3 : (value >= 87.5 ? 2 : 1);
        }
        if (metricKey === 'cxRepOverall') {
            return value >= 84 ? 3 : (value >= 81.5 ? 2 : 1);
        }
        if (metricKey === 'reliability') {
            return value <= 18 ? 3 : (value <= 24 ? 2 : 1);
        }

        return null;
    }

    function buildYearEndOnOffScores(values, scoreYear) {
        return {
            aht: getYearEndOnOffScoreOrFallback('aht', values.aht, scoreYear),
            adherence: getYearEndOnOffScoreOrFallback('scheduleAdherence', values.adherence, scoreYear),
            sentiment: getYearEndOnOffScoreOrFallback('overallSentiment', values.sentiment, scoreYear),
            associateOverall: getYearEndOnOffScoreOrFallback('cxRepOverall', values.associateOverall, scoreYear),
            reliability: getYearEndOnOffScoreOrFallback('reliability', values.reliability, scoreYear)
        };
    }

    function resolveYearEndOnOffTrackStatus(ratingAverage) {
        if (ratingAverage <= 1.79) {
            return { trackLabel: 'Off Track', trackStatusValue: 'off-track' };
        }
        if (ratingAverage <= 2.79) {
            return { trackLabel: 'On Track/Successful', trackStatusValue: 'on-track-successful' };
        }
        return { trackLabel: 'On Track/Exceptional', trackStatusValue: 'on-track-exceptional' };
    }

    /* ── Calculation ── */

    function calculateYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear()) {
        const associateOverallPick = pickYearEndAssociateOverallValue(employeeRecord);
        const values = buildYearEndOnOffValues(employeeRecord, associateOverallPick);
        const surveyTotal = parseInt(employeeRecord?.surveyTotal, 10);
        const surveyCount = Number.isInteger(surveyTotal) && surveyTotal > 0 ? surveyTotal : null;

        const scoreYear = parseInt(reviewYear, 10);
        const scores = buildYearEndOnOffScores(values, scoreYear);

        const scoreValues = Object.values(scores);
        const hasAllScores = scoreValues.every(score => score !== null);
        if (!hasAllScores) {
            return {
                isComplete: false,
                values,
                scores,
                ratingAverage: null,
                trackLabel: 'Insufficient KPI data to calculate On/Off Track',
                trackStatusValue: '',
                associateOverallSource: associateOverallPick.source,
                surveyCount: surveyCount
            };
        }

        const ratingAverage = scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length;
        const { trackLabel, trackStatusValue } = resolveYearEndOnOffTrackStatus(ratingAverage);

        return {
            isComplete: true,
            values,
            scores,
            ratingAverage,
            trackLabel,
            trackStatusValue,
            associateOverallSource: associateOverallPick.source,
            surveyCount: surveyCount
        };
    }

    /* ── Rendering helpers ── */

    function applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, goalSource, periodMetadata = null) {
        detailsEl.innerHTML = buildOnOffScoreTableHtml(result, reviewYear, {
            goalSource,
            periodMetadata
        });

        if (!result.isComplete) {
            summaryEl.textContent = '\u26A0\uFE0F Missing one or more KPI values. On/Off Track could not be calculated exactly.';
            return result;
        }

        summaryEl.textContent = `Rating Average: ${result.ratingAverage.toFixed(2)} \u2022 Calculated Status: ${result.trackLabel}`;
        return result;
    }

    function renderYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear(), periodMetadata = null) {
        const summaryEl = document.getElementById('yearEndOnOffSummary');
        const detailsEl = document.getElementById('yearEndOnOffDetails');
        if (!summaryEl || !detailsEl) return null;

        const result = calculateYearEndOnOffMirror(employeeRecord, reviewYear);
        return applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, 'onoff', periodMetadata);
    }

    function renderOnOffMirrorForElementIds(employeeRecord, summaryElementId, detailsElementId, reviewYear = new Date().getFullYear()) {
        const summaryEl = document.getElementById(summaryElementId);
        const detailsEl = document.getElementById(detailsElementId);
        if (!summaryEl || !detailsEl) return null;

        const result = calculateYearEndOnOffMirror(employeeRecord, reviewYear);
        return applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, 'onoff', null);
    }

    /* ── Goal text resolution ── */

    function resolveOnOffBandGoalText(bands, bandKey, formatKey) {
        const config = bands?.[bandKey];
        if (!config) return 'N/A';
        if (config.type === 'min') {
            const targetValue = config.score3?.min ?? config.score2?.min;
            return targetValue === undefined ? 'N/A' : `\u2265 ${_formatMetricDisplay(formatKey, targetValue)}`;
        }
        const targetValue = config.score3?.max ?? config.score2?.max;
        return targetValue === undefined ? 'N/A' : `\u2264 ${_formatMetricDisplay(formatKey, targetValue)}`;
    }

    function resolveMetricTrendsGoalText(metricKey, formatKey, reviewYear, periodMetadata) {
        const targetConfig = _getYearEndTargetConfig(metricKey, reviewYear, periodMetadata);
        if (!targetConfig || targetConfig.value === undefined || targetConfig.value === null) return 'N/A';
        const operator = targetConfig.type === 'min' ? '\u2265' : '\u2264';
        return `${operator} ${_formatMetricDisplay(formatKey, targetConfig.value)}`;
    }

    function resolveOnOffGoalText(goalSource, bands, targetMetricKey, bandMetricKey, formatKey, reviewYear, periodMetadata) {
        const annualGoalText = resolveMetricTrendsGoalText(targetMetricKey, formatKey, reviewYear, periodMetadata);
        if (annualGoalText !== 'N/A') {
            return annualGoalText;
        }
        return resolveOnOffBandGoalText(bands, bandMetricKey, formatKey);
    }

    /* ── Score table building ── */

    function buildStretchGoalText(bandConfig, formatKey) {
        if (!bandConfig) return '';
        if (bandConfig.type === 'min' && bandConfig.score3?.min != null) {
            return `\u2265 ${_formatMetricDisplay(formatKey, bandConfig.score3.min)}`;
        }
        if (bandConfig.type === 'max' && bandConfig.score3?.max != null) {
            return `\u2264 ${_formatMetricDisplay(formatKey, bandConfig.score3.max)}`;
        }
        return '';
    }

    function buildGapToNextText(score, val, bandConfig) {
        if (score === null || score === 3 || val === null || !bandConfig) return '';
        var hints = [];
        if (bandConfig.type === 'min') {
            if (score === 1) hints.push('+' + (bandConfig.score2.min - val).toFixed(1) + ' to score 2');
            if (score <= 2) hints.push('+' + (bandConfig.score3.min - val).toFixed(1) + ' to score 3');
        } else {
            if (score === 1) hints.push('-' + (val - bandConfig.score2.max).toFixed(1) + ' to score 2');
            if (score <= 2) hints.push('-' + (val - bandConfig.score3.max).toFixed(1) + ' to score 3');
        }
        return hints.join(' | ');
    }

    function buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata) {
        var ratingBands = (window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR || {})[parseInt(reviewYear, 10)] || {};
        var surveyLabel = 'Associate Overall (Surveys)';
        if (result.surveyCount !== null && result.surveyCount !== undefined) {
            surveyLabel = 'Associate Overall (' + result.surveyCount + ' survey' + (result.surveyCount !== 1 ? 's' : '') + ')';
        }
        return [
            {
                label: 'AHT',
                valueText: result.values.aht === null ? 'N/A' : _formatMetricDisplay('aht', result.values.aht),
                goalText: resolveOnOffGoalText(goalSource, bands, 'aht', 'aht', 'aht', reviewYear, periodMetadata),
                stretchText: buildStretchGoalText(ratingBands.aht, 'aht'),
                score: result.scores.aht,
                gapText: buildGapToNextText(result.scores.aht, result.values.aht, ratingBands.aht)
            },
            {
                label: 'Adherence',
                valueText: result.values.adherence === null ? 'N/A' : _formatMetricDisplay('scheduleAdherence', result.values.adherence),
                goalText: resolveOnOffGoalText(goalSource, bands, 'scheduleAdherence', 'scheduleAdherence', 'scheduleAdherence', reviewYear, periodMetadata),
                stretchText: buildStretchGoalText(ratingBands.scheduleAdherence, 'scheduleAdherence'),
                score: result.scores.adherence,
                gapText: buildGapToNextText(result.scores.adherence, result.values.adherence, ratingBands.scheduleAdherence)
            },
            {
                label: 'Overall Sentiment',
                valueText: result.values.sentiment === null ? 'N/A' : _formatMetricDisplay('overallSentiment', result.values.sentiment),
                goalText: resolveOnOffGoalText(goalSource, bands, 'overallSentiment', 'overallSentiment', 'overallSentiment', reviewYear, periodMetadata),
                stretchText: buildStretchGoalText(ratingBands.overallSentiment, 'overallSentiment'),
                score: result.scores.sentiment,
                gapText: buildGapToNextText(result.scores.sentiment, result.values.sentiment, ratingBands.overallSentiment)
            },
            {
                label: surveyLabel,
                valueText: result.values.associateOverall === null ? 'N/A' : _formatMetricDisplay('overallExperience', result.values.associateOverall),
                goalText: resolveOnOffGoalText(goalSource, bands, 'cxRepOverall', 'cxRepOverall', 'overallExperience', reviewYear, periodMetadata),
                stretchText: buildStretchGoalText(ratingBands.cxRepOverall, 'overallExperience'),
                score: result.scores.associateOverall,
                gapText: buildGapToNextText(result.scores.associateOverall, result.values.associateOverall, ratingBands.cxRepOverall)
            },
            {
                label: 'Reliability',
                valueText: result.values.reliability === null ? 'N/A' : _formatMetricDisplay('reliability', result.values.reliability),
                goalText: resolveOnOffGoalText(goalSource, bands, 'reliability', 'reliability', 'reliability', reviewYear, periodMetadata),
                stretchText: buildStretchGoalText(ratingBands.reliability, 'reliability'),
                score: result.scores.reliability,
                gapText: buildGapToNextText(result.scores.reliability, result.values.reliability, ratingBands.reliability)
            }
        ];
    }

    function getOnOffScoreCellStyle(score) {
        if (score === 1) return 'background: #ff1a1a; color: #fff; font-weight: bold;';
        if (score === 2) return 'background: #f0de87; color: #222; font-weight: bold;';
        if (score === 3) return 'background: #00b050; color: #fff; font-weight: bold;';
        return 'background: #eee; color: #666; font-weight: bold;';
    }

    function getOnOffStatusStyle(statusText) {
        return statusText === 'Off Track'
            ? 'background: #ff1a1a; color: #fff;'
            : statusText === 'On Track/Exceptional'
                ? 'background: #00b050; color: #fff;'
                : statusText === 'On Track/Successful'
                    ? 'background: #c8f7c5; color: #1b5e20;'
                    : 'background: #ddd; color: #222;';
    }

    function buildOnOffHeaderSummaryHtml(ratingText, statusText, statusStyle) {
        return `
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;">
            <div style="padding: 10px 14px; border-radius: 8px; border: 1px solid #d6c4f5; background: #f4effc;">
                <div style="font-size: 0.8em; color: #4a148c;">Rating Average</div>
                <div style="font-size: 1.4em; font-weight: bold; color: #4a148c;">${ratingText}</div>
                <div style="font-size: 0.75em; color: #6a1b9a;">Goal: 2.80+ (On Track/Exceptional)</div>
            </div>
            <div style="padding: 10px 14px; border-radius: 8px; border: 1px solid #d6c4f5; ${statusStyle} font-weight: bold;">
                ${statusText}
            </div>
        </div>
    `;
    }

    function buildOnOffRowsHtml(rows) {
        return rows.map(row => `
                        <tr>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.label}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.valueText}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.goalText}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7; font-size: 0.88em; color: #6a1b9a;">${row.stretchText || ''}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7; text-align: center; ${getOnOffScoreCellStyle(row.score)}">${row.score === null ? 'N/A' : row.score}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7; font-size: 0.85em; color: #555;">${row.gapText || (row.score === 3 ? '✓' : '')}</td>
                        </tr>
                    `).join('');
    }

    function buildOnOffScoreTableHtml(result, reviewYear = new Date().getFullYear(), options = {}) {
        const goalSource = options?.goalSource === 'metric-trends' ? 'metric-trends' : 'onoff';
        const periodMetadata = options?.periodMetadata || null;
        const { bands } = getOnOffTrackerLegendBandsByYear(reviewYear);
        const rows = buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata);

        const ratingText = result.ratingAverage === null ? 'N/A' : result.ratingAverage.toFixed(2);
        const statusText = result.trackLabel || 'N/A';
        const statusStyle = getOnOffStatusStyle(statusText);
        const summaryHtml = buildOnOffHeaderSummaryHtml(ratingText, statusText, statusStyle);
        const rowsHtml = buildOnOffRowsHtml(rows);

        return `
        ${summaryHtml}
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Metric</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Actual</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Annual Goal</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Stretch Goal</th>
                        <th style="text-align: center; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Score</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Gap to Next</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Rating Average</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="5">${ratingText}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Overall Status</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="5">${statusText}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
    }

    /* ── Legend ── */

    function getOnOffTrackerLegendBandsByYear(reviewYear) {
        const yearNum = parseInt(reviewYear, 10);
        const moduleBands = window?.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR?.[yearNum];
        if (moduleBands) {
            return {
                bands: moduleBands,
                sourceLabel: `${yearNum} rating profile`,
                usingFallback: false
            };
        }

        const METRIC_RATING_BANDS_BY_YEAR = window.METRIC_RATING_BANDS_BY_YEAR || {};
        const inlineBands = METRIC_RATING_BANDS_BY_YEAR?.[yearNum];
        if (inlineBands) {
            return {
                bands: inlineBands,
                sourceLabel: `${yearNum} inline rating bands`,
                usingFallback: false
            };
        }

        return {
            bands: {
                aht: { type: 'max', score3: { max: 419 }, score2: { max: 460 } },
                scheduleAdherence: { type: 'min', score3: { min: 94.5 }, score2: { min: 92.5 } },
                overallSentiment: { type: 'min', score3: { min: 90.1 }, score2: { min: 87.5 } },
                cxRepOverall: { type: 'min', score3: { min: 82 }, score2: { min: 79.5 } },
                reliability: { type: 'max', score3: { max: 16 }, score2: { max: 24 } }
            },
            sourceLabel: 'default mirror fallback bands',
            usingFallback: true
        };
    }

    function buildOnOffLegendMissingConfigCardHtml(label) {
        return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
                <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
                <div style="font-size: 0.85em; color: #666;">No rating bands configured for selected year.</div>
            </div>`;
    }

    function buildOnOffLegendMinTypeCardHtml(metricKey, label, config) {
        const score3 = _formatMetricDisplay(metricKey, config.score3.min);
        const score2 = _formatMetricDisplay(metricKey, config.score2.min);
        return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
                <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
                <div style="font-size: 0.85em; color: #1b5e20;">Score 3: \u2265 ${score3}</div>
                <div style="font-size: 0.85em; color: #8d6e00;">Score 2: &lt; ${score3} and \u2265 ${score2}</div>
                <div style="font-size: 0.85em; color: #b71c1c;">Score 1: &lt; ${score2}</div>
            </div>`;
    }

    function buildOnOffLegendMaxTypeCardHtml(metricKey, label, config) {
        const score3 = _formatMetricDisplay(metricKey, config.score3.max);
        const score2 = _formatMetricDisplay(metricKey, config.score2.max);
        return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
            <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
            <div style="font-size: 0.85em; color: #1b5e20;">Score 3: \u2264 ${score3}</div>
            <div style="font-size: 0.85em; color: #8d6e00;">Score 2: &gt; ${score3} and \u2264 ${score2}</div>
            <div style="font-size: 0.85em; color: #b71c1c;">Score 1: &gt; ${score2}</div>
        </div>`;
    }

    function buildOnOffLegendMetricCardHtml(metric, bands) {
        const config = bands?.[metric.key];
        if (!config) {
            return buildOnOffLegendMissingConfigCardHtml(metric.label);
        }
        if (config.type === 'min') {
            return buildOnOffLegendMinTypeCardHtml(metric.key, metric.label, config);
        }
        return buildOnOffLegendMaxTypeCardHtml(metric.key, metric.label, config);
    }

    function buildOnOffLegendContainerHtml(reviewYear, cardsHtml, sourceLabel, usingFallback) {
        return `
        <div style="font-weight: bold; color: #4a148c; margin-bottom: 8px;">\uD83C\uDFAF On/Off Tracker 3-Tier Scoring Legend (${reviewYear || 'N/A'})</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-bottom: 8px;">${cardsHtml}</div>
        <div style="font-size: 0.8em; color: #5e35b1;">Status bands: Off Track \u2264 1.79 \u00B7 On Track/Successful 1.80\u20132.79 \u00B7 On Track/Exceptional \u2265 2.80</div>
        <div style="font-size: 0.78em; color: #777; margin-top: 3px;">Source: ${sourceLabel}${usingFallback ? ' (used when selected year has no rating profile)' : ''}</div>
    `;
    }

    function renderOnOffTrackerLegend(reviewYear) {
        const legendEl = document.getElementById('onOffTrackerLegend');
        if (!legendEl) return;

        const { bands, sourceLabel, usingFallback } = getOnOffTrackerLegendBandsByYear(reviewYear);
        const legendMetrics = [
            { key: 'aht', label: 'AHT' },
            { key: 'scheduleAdherence', label: 'Adherence' },
            { key: 'overallSentiment', label: 'Overall Sentiment' },
            { key: 'cxRepOverall', label: 'Associate Overall (Surveys)' },
            { key: 'reliability', label: 'Reliability' }
        ];

        const cards = legendMetrics.map(metric => buildOnOffLegendMetricCardHtml(metric, bands)).join('');
        legendEl.innerHTML = buildOnOffLegendContainerHtml(reviewYear, cards, sourceLabel, usingFallback);
    }

    /* ── Panel / UI wiring ── */

    function populateOnOffTrackerEmployeeSelect(employeeSelect) {
        employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
        const employees = _getYearEndEmployees();
        employees.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            employeeSelect.appendChild(option);
        });
        return employees;
    }

    function resetOnOffTrackerPanel(panel, factsSummary, summary, details) {
        panel.style.display = 'none';
        factsSummary.textContent = '';
        summary.textContent = '';
        details.innerHTML = '';
    }

    function bindOnOffTrackerHandlers(employeeSelect, reviewYearInput, calculateBtn) {
        const calculate = () => updateOnOffTrackerDisplay();
        _bindElementOnce(employeeSelect, 'change', calculate);
        _bindElementOnce(reviewYearInput, 'input', calculate);
        _bindElementOnce(calculateBtn, 'click', calculate);
    }

    function resolveOnOffTrackerFactsSummaryText(latestPeriod) {
        const endDateText = latestPeriod.period?.metadata?.endDate
            ? _formatDateMMDDYYYY(latestPeriod.period.metadata.endDate)
            : _formatDateMMDDYYYY(latestPeriod.periodKey.split('|')[1] || latestPeriod.periodKey);
        const sourceText = latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'Latest period upload';
        return `${latestPeriod.label} \u2022 Source: ${sourceText} \u2022 End date: ${endDateText}`;
    }

    function initializeOnOffTracker() {
        const employeeSelect = document.getElementById('onOffTrackerEmployeeSelect');
        const reviewYearInput = document.getElementById('onOffTrackerReviewYear');
        const status = document.getElementById('onOffTrackerStatus');
        const panel = document.getElementById('onOffTrackerPanel');
        const factsSummary = document.getElementById('onOffTrackerFactsSummary');
        const summary = document.getElementById('onOffTrackerSummary');
        const details = document.getElementById('onOffTrackerDetails');
        const calculateBtn = document.getElementById('onOffTrackerCalculateBtn');

        if (!employeeSelect || !reviewYearInput || !status || !panel || !factsSummary || !summary || !details || !calculateBtn) return;

        if (!reviewYearInput.value) {
            reviewYearInput.value = String(new Date().getFullYear());
        }

        renderOnOffTrackerLegend(reviewYearInput.value);

        const employees = populateOnOffTrackerEmployeeSelect(employeeSelect);

        if (!employees.length) {
            status.textContent = 'No employee data found yet. Upload yearly metrics first.';
            status.style.display = 'block';
            panel.style.display = 'none';
            return;
        }

        status.textContent = `Loaded ${employees.length} associates. Select associate and review year.`;
        status.style.display = 'block';

        bindOnOffTrackerHandlers(employeeSelect, reviewYearInput, calculateBtn);
        resetOnOffTrackerPanel(panel, factsSummary, summary, details);

        var teamSummaryBtn = document.getElementById('onOffTeamSummaryBtn');
        if (teamSummaryBtn) {
            _bindElementOnce(teamSummaryBtn, 'click', function() {
                generateTeamOnOffSummary();
                var toggle = document.getElementById('onOffTeamSummaryToggle');
                var container = document.getElementById('onOffTeamSummaryContainer');
                if (toggle && container) {
                    toggle.style.display = 'inline-block';
                    toggle.textContent = 'Hide Summary';
                    container.style.display = 'block';
                }
            });
        }

        var teamSummaryToggle = document.getElementById('onOffTeamSummaryToggle');
        if (teamSummaryToggle) {
            _bindElementOnce(teamSummaryToggle, 'click', function() {
                var container = document.getElementById('onOffTeamSummaryContainer');
                if (!container) return;
                var hidden = container.style.display === 'none';
                container.style.display = hidden ? 'block' : 'none';
                teamSummaryToggle.textContent = hidden ? 'Hide Summary' : 'Show Summary';
            });
        }

        var checkinBtn = document.getElementById('onOffCheckinBtn');
        if (checkinBtn) {
            _bindElementOnce(checkinBtn, 'click', generateQuickCheckinPrompt);
        }
        var checkinCopyBtn = document.getElementById('onOffCheckinCopyBtn');
        if (checkinCopyBtn) {
            _bindElementOnce(checkinCopyBtn, 'click', function() {
                var text = document.getElementById('onOffCheckinText')?.textContent || '';
                navigator.clipboard.writeText(text).then(function() {
                    var toast = window.DevCoachModules?.uiUtils?.showToast;
                    if (toast) toast('Copied to clipboard! Paste into Copilot.', 3000);
                });
            });
        }
    }

    function updateOnOffTrackerDisplay() {
        const employeeName = document.getElementById('onOffTrackerEmployeeSelect')?.value;
        const reviewYear = document.getElementById('onOffTrackerReviewYear')?.value;
        const status = document.getElementById('onOffTrackerStatus');
        const panel = document.getElementById('onOffTrackerPanel');
        const factsSummary = document.getElementById('onOffTrackerFactsSummary');

        if (!status || !panel || !factsSummary) return;

        renderOnOffTrackerLegend(reviewYear);

        if (!employeeName || !reviewYear) {
            panel.style.display = 'none';
            status.textContent = 'Select associate and review year to calculate On/Off Track.';
            status.style.display = 'block';
            return;
        }

        const latestPeriod = _getLatestYearPeriodForEmployee(employeeName, reviewYear);
        if (!latestPeriod) {
            panel.style.display = 'none';
            status.textContent = `No ${reviewYear} data found for ${employeeName}. Upload ${reviewYear} metrics first.`;
            status.style.display = 'block';
            return;
        }

        factsSummary.textContent = resolveOnOffTrackerFactsSummaryText(latestPeriod);

        renderOnOffMirrorForElementIds(latestPeriod.employeeRecord, 'onOffTrackerSummary', 'onOffTrackerDetails', reviewYear);

        status.textContent = `On/Off tracker calculated for ${employeeName} (${reviewYear}).`;
        status.style.display = 'block';
        panel.style.display = 'block';
    }

    /* ── Quick Check-in Prompt ── */

    function generateQuickCheckinPrompt() {
        var employeeName = document.getElementById('onOffTrackerEmployeeSelect')?.value;
        var reviewYear = document.getElementById('onOffTrackerReviewYear')?.value;
        var output = document.getElementById('onOffCheckinOutput');
        var textEl = document.getElementById('onOffCheckinText');

        if (!employeeName || !reviewYear) {
            alert('Please select an associate first.');
            return;
        }

        var latestPeriod = _getLatestYearPeriodForEmployee(employeeName, reviewYear);
        if (!latestPeriod) {
            alert('No data found for ' + employeeName + '.');
            return;
        }

        var result = calculateYearEndOnOffMirror(latestPeriod.employeeRecord, reviewYear);
        var firstName = (typeof window.getEmployeeNickname === 'function' ? window.getEmployeeNickname(employeeName) : '') || employeeName.split(' ')[0] || employeeName;
        var registry = window.METRICS_REGISTRY || {};
        var ratingBands = (window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR || {})[parseInt(reviewYear, 10)] || {};

        // Build metrics context
        var metricMap = {
            aht: { key: 'aht', label: 'AHT', val: result.values.aht, score: result.scores.aht, unit: 'seconds' },
            adherence: { key: 'scheduleAdherence', label: 'Adherence', val: result.values.adherence, score: result.scores.adherence, unit: '%' },
            sentiment: { key: 'overallSentiment', label: 'Overall Sentiment', val: result.values.sentiment, score: result.scores.sentiment, unit: '%' },
            associateOverall: { key: 'cxRepOverall', label: 'Associate Overall (Surveys)', val: result.values.associateOverall, score: result.scores.associateOverall, unit: '%' },
            reliability: { key: 'reliability', label: 'Reliability', val: result.values.reliability, score: result.scores.reliability, unit: 'hours' }
        };

        var focusAreas = [];
        var strengths = [];

        Object.keys(metricMap).forEach(function(k) {
            var m = metricMap[k];
            if (m.score === null) return;
            if (m.score <= 1) {
                // Get tips
                var tips = [];
                if (typeof window.getRandomTipsForMetric === 'function') {
                    tips = window.getRandomTipsForMetric(m.key, 2) || [];
                }
                if (!tips.length) {
                    var def = registry[m.key];
                    if (def?.defaultTip) tips = [def.defaultTip];
                }
                // Get target (from TARGETS_BY_YEAR) and rating band thresholds
                var targets = (window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR || {})[parseInt(reviewYear, 10)] || {};
                var actualTarget = targets[m.key];
                var band = ratingBands[m.key];
                var targetText = '';
                var gapText = '';
                if (actualTarget && m.val !== null) {
                    var targetVal = actualTarget.value;
                    var gapToTarget = Math.abs(m.val - targetVal);
                    targetText = 'company target is ' + targetVal + ' ' + m.unit;
                    if (k === 'reliability') {
                        gapText = 'currently ' + gapToTarget.toFixed(1) + ' ' + m.unit + ' over target. This is about Verint coding and pre-scheduling time off, not working harder';
                    } else if (actualTarget.type === 'min') {
                        gapText = 'needs to improve by ' + gapToTarget.toFixed(1) + ' ' + m.unit + ' to hit target';
                    } else {
                        gapText = 'needs to reduce by ' + gapToTarget.toFixed(1) + ' ' + m.unit + ' to hit target';
                    }
                }
                // Add band as stretch/stepping stone
                var stretchText = '';
                if (band && m.val !== null && k !== 'reliability') {
                    var band2Val = band.type === 'min' ? band.score2.min : band.score2.max;
                    var gapToBand2 = Math.abs(m.val - band2Val);
                    if (band.type === 'min') {
                        stretchText = 'even improving by just ' + gapToBand2.toFixed(1) + ' ' + m.unit + ' (to ' + band2Val + ') would be a great first step';
                    } else {
                        stretchText = 'even reducing by just ' + gapToBand2.toFixed(1) + ' ' + m.unit + ' (to ' + band2Val + ') would be a great first step';
                    }
                }
                focusAreas.push({ label: m.label, val: m.val, unit: m.unit, targetText: targetText, gapText: gapText, stretchText: stretchText, tips: tips });
            } else if (m.score === 2) {
                // At score 2 - show gap to score 3 (exceptional)
                var band2 = ratingBands[m.key];
                var targets2 = (window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR || {})[parseInt(reviewYear, 10)] || {};
                var actualTarget2 = targets2[m.key];
                var gapText2 = '';
                var stretchText2 = '';
                // Check if meeting actual target
                if (actualTarget2 && m.val !== null) {
                    var meetsTarget = actualTarget2.type === 'min' ? (m.val >= actualTarget2.value) : (m.val <= actualTarget2.value);
                    if (!meetsTarget) {
                        var gapT = Math.abs(m.val - actualTarget2.value);
                        gapText2 = 'just ' + gapT.toFixed(1) + ' ' + m.unit + ' from company target of ' + actualTarget2.value;
                    }
                }
                if (band2 && m.val !== null) {
                    var target3b = band2.type === 'min' ? band2.score3.min : band2.score3.max;
                    var gap3b = Math.abs(m.val - target3b);
                    stretchText2 = 'only ' + gap3b.toFixed(1) + ' ' + m.unit + ' away from exceptional (' + target3b + ')';
                }
                focusAreas.push({ label: m.label, val: m.val, unit: m.unit, targetText: '', gapText: gapText2, stretchText: stretchText2, tips: [], isClose: true });
            } else {
                strengths.push({ label: m.label, val: m.val, unit: m.unit });
            }
        });

        // Build the prompt
        var prompt = 'You are a call center supervisor sending a quick, encouraging Teams message to ' + firstName + '.\n\n';
        prompt += 'IMPORTANT RULES:\n';
        prompt += '- Do NOT mention scores, ratings, "on track", "off track", or rating averages\n';
        prompt += '- Do NOT mention that you are using a tool or data system\n';
        prompt += '- Keep it casual, warm, and brief (3-5 sentences max for the main message)\n';
        prompt += '- Frame everything as growth opportunities, not deficiencies\n';
        prompt += '- Sound like a real person typing in Teams chat, not a formal email\n';
        prompt += '- Do NOT use em dashes (—) anywhere. Use commas or periods instead.\n';
        prompt += '- Include 1-2 relevant emojis to keep it friendly and casual\n\n';

        prompt += 'CONTEXT (use to inform tone, do not quote directly):\n';

        if (strengths.length) {
            prompt += '\nStrengths to acknowledge:\n';
            strengths.forEach(function(s) {
                prompt += '- ' + s.label + ': ' + s.val + ' ' + s.unit + ' (excellent)\n';
            });
        }

        if (focusAreas.length) {
            prompt += '\nAreas to focus the message on:\n';
            focusAreas.forEach(function(f) {
                var valText = f.val !== null ? f.val + ' ' + f.unit : 'no data';
                var line = '- ' + f.label + ': currently ' + valText;
                if (f.targetText) line += ', ' + f.targetText;
                if (f.gapText) line += ' (' + f.gapText + ')';
                prompt += line + '\n';
                if (f.stretchText) prompt += '  Stretch goal: ' + f.stretchText + '\n';
                if (f.isClose) prompt += '  (close to goal, just needs a nudge)\n';
                if (f.tips && f.tips.length) {
                    f.tips.forEach(function(tip) {
                        prompt += '  Coaching tip: ' + tip + '\n';
                    });
                }
            });
        }

        prompt += '\nWrite a Teams message that:\n';
        prompt += '1. Starts with a brief positive acknowledgment of what they\'re doing well\n';
        prompt += '2. Naturally transitions to the focal area(s) they should work on\n';
        prompt += '3. Tells them EXACTLY how far they are from the goal using the gap numbers above (e.g. "If you can shave off 134 seconds on your handle time..." or "Bring your adherence up just 2.4%...")\n';
        prompt += '4. Includes a specific, actionable suggestion from the coaching tips\n';
        prompt += '5. Ends with encouragement\n';
        prompt += '6. Feels like a quick check-in, not a performance review\n';

        if (textEl) textEl.textContent = prompt;
        if (output) output.style.display = 'block';

        // Auto-copy to clipboard
        navigator.clipboard.writeText(prompt).then(function() {
            var toast = window.DevCoachModules?.uiUtils?.showToast;
            if (toast) toast('Prompt copied to clipboard! Paste into Copilot.', 3000);
        }).catch(function() {});

        // Auto-open Copilot
        if (typeof window.openCopilotWithPrompt === 'function') {
            window.openCopilotWithPrompt(prompt, 'Quick Check-in for ' + firstName);
        }
    }

    /* ── Team Summary ── */

    function generateTeamOnOffSummary() {
        var container = document.getElementById('onOffTeamSummaryContainer');
        if (!container) return;

        var reviewYear = document.getElementById('onOffTrackerReviewYear')?.value || String(new Date().getFullYear());
        var employees = _getYearEndEmployees();

        if (!employees.length) {
            container.innerHTML = '<p style="color: #999; text-align: center;">No employees found. Upload data first.</p>';
            return;
        }

        var metricLabels = { aht: 'AHT', adherence: 'Adherence', sentiment: 'Sentiment', associateOverall: 'Assoc Overall', reliability: 'Reliability' };
        var results = [];

        employees.forEach(function(name) {
            var latestPeriod = _getLatestYearPeriodForEmployee(name, reviewYear);
            if (!latestPeriod) return;
            var result = calculateYearEndOnOffMirror(latestPeriod.employeeRecord, reviewYear);
            var firstName = name.split(' ')[0] || name;
            var sourceLabel = latestPeriod.label || latestPeriod.periodKey || '?';
            var isAuto = latestPeriod.period?.metadata?.autoGeneratedYtd ? ' (auto)' : '';
            // Determine which metrics scored 1 (off track metrics)
            var offMetrics = [];
            var metCount = 0;
            if (result.scores) {
                Object.keys(result.scores).forEach(function(k) {
                    if (result.scores[k] !== null) {
                        if (result.scores[k] >= 2) metCount++;
                        if (result.scores[k] === 1) offMetrics.push(metricLabels[k] || k);
                    }
                });
            }
            results.push({
                name: name,
                firstName: firstName,
                result: result,
                offMetrics: offMetrics,
                meetingCount: metCount,
                sourceLabel: sourceLabel + isAuto,
                sourceName: latestPeriod.sourceName
            });
        });

        if (!results.length) {
            container.innerHTML = '<p style="color: #999; text-align: center;">No ' + reviewYear + ' data found for any team member.</p>';
            return;
        }

        // Group by meeting count (5, 4, 3, 2, 1, 0)
        var groups = { 5: [], 4: [], 3: [], 2: [], 1: [], 0: [] };
        var offTrack = [];
        var onTrackSuccessful = [];
        var onTrackExceptional = [];

        results.forEach(function(r) {
            var bucket = Math.min(r.meetingCount, 5);
            if (!groups[bucket]) groups[bucket] = [];
            groups[bucket].push(r);
            if (r.result.trackStatusValue === 'off-track') offTrack.push(r);
            else if (r.result.trackStatusValue === 'on-track-exceptional') onTrackExceptional.push(r);
            else onTrackSuccessful.push(r);
        });

        // Build summary HTML
        var html = '<div style="background: #fff; border-radius: 12px; padding: 20px; border: 2px solid #6a1b9a; ' +
            'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif;">';

        // Header
        html += '<div style="border-bottom: 3px solid #6a1b9a; padding-bottom: 10px; margin-bottom: 16px;">' +
            '<div style="font-size: 1.2em; font-weight: 800; color: #4a148c;">Team On/Off Track Summary (' + reviewYear + ')</div>' +
            '<div style="font-size: 0.85em; color: #666; margin-top: 4px;">' + results.length + ' associates evaluated</div></div>';

        // Status counts bar
        html += '<div style="display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap;">';
        html += '<div style="flex: 1; min-width: 140px; padding: 12px; border-radius: 8px; background: #00b050; color: white; text-align: center;">' +
            '<div style="font-size: 1.8em; font-weight: 800;">' + onTrackExceptional.length + '</div>' +
            '<div style="font-size: 0.8em; font-weight: 600;">Exceptional</div></div>';
        html += '<div style="flex: 1; min-width: 140px; padding: 12px; border-radius: 8px; background: #c8f7c5; color: #2e7d32; text-align: center; border: 2px solid #66bb6a;">' +
            '<div style="font-size: 1.8em; font-weight: 800;">' + onTrackSuccessful.length + '</div>' +
            '<div style="font-size: 0.8em; font-weight: 600;">Successful</div></div>';
        html += '<div style="flex: 1; min-width: 140px; padding: 12px; border-radius: 8px; background: #ff1a1a; color: white; text-align: center;">' +
            '<div style="font-size: 1.8em; font-weight: 800;">' + offTrack.length + '</div>' +
            '<div style="font-size: 0.8em; font-weight: 600;">Off Track</div></div>';
        html += '</div>';

        // Off Track detail (who and why)
        if (offTrack.length > 0) {
            html += '<div style="margin-bottom: 16px; padding: 14px; background: #fff5f5; border-radius: 8px; border-left: 4px solid #ff1a1a;">';
            html += '<div style="font-weight: 700; color: #c62828; margin-bottom: 8px; font-size: 0.95em;">Off Track (' + offTrack.length + ')</div>';
            offTrack.forEach(function(r) {
                var avgText = r.result.ratingAverage !== null ? ' (avg: ' + r.result.ratingAverage.toFixed(2) + ')' : '';
                html += '<div style="padding: 6px 0; border-bottom: 1px solid #ffcdd2; font-size: 0.9em;">' +
                    '<span style="font-weight: 600; color: #b71c1c;">' + r.firstName + '</span>' + avgText +
                    (r.offMetrics.length ? ' — <span style="color: #e53935;">' + r.offMetrics.join(', ') + '</span>' : '') +
                    '</div>';
            });
            html += '</div>';
        }

        // Meeting count breakdown
        html += '<div style="margin-bottom: 16px;">';
        html += '<div style="font-weight: 700; color: #4a148c; margin-bottom: 10px; font-size: 0.95em;">Metrics Meeting Goal (score 2+)</div>';

        [5, 4, 3, 2, 1, 0].forEach(function(count) {
            var group = groups[count] || [];
            if (!group.length) return;
            var bgColor = count >= 4 ? '#e8f5e9' : count >= 3 ? '#fff8e1' : '#ffebee';
            var borderColor = count >= 4 ? '#66bb6a' : count >= 3 ? '#ffa726' : '#ef5350';
            var label = count === 5 ? 'All 5 metrics' : count + ' of 5 metrics';
            var names = group.map(function(r) { return r.firstName; }).join(', ');

            html += '<div style="padding: 10px 14px; margin-bottom: 6px; background: ' + bgColor + '; border-left: 4px solid ' + borderColor + '; border-radius: 4px;">' +
                '<span style="font-weight: 700; font-size: 0.9em;">' + label + '</span>' +
                '<span style="color: #666; font-size: 0.85em;"> (' + group.length + ')</span>' +
                '<div style="font-size: 0.85em; color: #555; margin-top: 4px;">' + names + '</div></div>';
        });

        html += '</div>';

        // Full table
        html += '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">';
        html += '<thead><tr style="background: #f3e5f5;">' +
            '<th style="padding: 8px; text-align: left; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Name</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">AHT</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Adh</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Sent</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Assoc</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Rel</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Avg</th>' +
            '<th style="padding: 8px; text-align: center; border-bottom: 2px solid #6a1b9a; color: #4a148c;">Status</th>' +
            '</tr></thead><tbody>';

        // Sort: off track first, then by rating avg ascending
        results.sort(function(a, b) {
            var aOff = a.result.trackStatusValue === 'off-track' ? 0 : 1;
            var bOff = b.result.trackStatusValue === 'off-track' ? 0 : 1;
            if (aOff !== bOff) return aOff - bOff;
            return (a.result.ratingAverage || 0) - (b.result.ratingAverage || 0);
        });

        results.forEach(function(r, idx) {
            var bg = idx % 2 === 0 ? '#fff' : '#fafafa';
            var scores = r.result.scores || {};
            var values = r.result.values || {};

            var bands = (window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR || {})[parseInt(reviewYear, 10)] || {};

            function formatVal(val, unit) {
                if (val === null || val === undefined) return '--';
                if (unit === 'sec') return Math.round(val) + 's';
                if (unit === 'hrs') return val.toFixed(1) + 'h';
                return val.toFixed(1) + '%';
            }

            function formatGap(gap, unit) {
                if (unit === 'sec') return Math.round(Math.abs(gap)) + 's';
                if (unit === 'hrs') return Math.abs(gap).toFixed(1) + 'h';
                return Math.abs(gap).toFixed(1) + '%';
            }

            function buildGapHint(score, val, metricKey, unit) {
                if (score === null || score === 3 || val === null) return '';
                var band = bands[metricKey];
                if (!band) return '';
                var hints = [];
                var sign = band.type === 'min' ? '+' : '-';
                if (score === 1) {
                    var gap2 = band.type === 'min' ? (band.score2.min - val) : (val - band.score2.max);
                    hints.push(sign + formatGap(gap2, unit) + ' to 2');
                }
                if (score <= 2) {
                    var gap3 = band.type === 'min' ? (band.score3.min - val) : (val - band.score3.max);
                    hints.push(sign + formatGap(gap3, unit) + ' to 3');
                }
                var hintColor = score === 2 ? '#666' : 'rgba(255,255,255,0.9)';
                return hints.length ? '<div style="font-size: 0.6em; line-height: 1.2; margin-top: 1px; font-weight: 400; color: ' + hintColor + ';">' + hints.join(' | ') + '</div>' : '';
            }

            function scoreCell(score, val, unit, metricKey) {
                var valDisplay = formatVal(val, unit);
                if (score === null) return '<td style="padding: 4px 6px; text-align: center; color: #999; border-bottom: 1px solid #eee;"><div style="font-size: 0.75em; color: #999;">' + valDisplay + '</div><div>--</div></td>';
                var cellBg = score === 3 ? '#00b050' : score === 2 ? '#f0de87' : '#d4544a';
                var cellColor = score === 2 ? '#333' : '#fff';
                var gapHint = buildGapHint(score, val, metricKey, unit);
                return '<td style="padding: 4px 6px; text-align: center; font-weight: 700; background: ' + cellBg + '; color: ' + cellColor + '; border-bottom: 1px solid #eee;">' +
                    '<div style="font-size: 0.75em; font-weight: 400;">' + valDisplay + '</div>' +
                    '<div>' + score + '</div>' + gapHint + '</td>';
            }

            var statusBg, statusColor;
            if (r.result.trackStatusValue === 'off-track') { statusBg = '#ff1a1a'; statusColor = '#fff'; }
            else if (r.result.trackStatusValue === 'on-track-exceptional') { statusBg = '#00b050'; statusColor = '#fff'; }
            else { statusBg = '#c8f7c5'; statusColor = '#2e7d32'; }

            var avgDisplay = r.result.ratingAverage !== null ? r.result.ratingAverage.toFixed(2) : '--';

            html += '<tr style="background: ' + bg + ';">' +
                '<td style="padding: 6px 8px; font-weight: 600; border-bottom: 1px solid #eee; white-space: nowrap;">' + r.firstName + '</td>' +
                scoreCell(scores.aht, values.aht, 'sec', 'aht') +
                scoreCell(scores.adherence, values.adherence, '%', 'scheduleAdherence') +
                scoreCell(scores.sentiment, values.sentiment, '%', 'overallSentiment') +
                scoreCell(scores.associateOverall, values.associateOverall, '%', 'cxRepOverall') +
                scoreCell(scores.reliability, values.reliability, 'hrs', 'reliability') +
                '<td style="padding: 6px; text-align: center; font-weight: 700; border-bottom: 1px solid #eee; color: #4a148c;">' + avgDisplay + '</td>' +
                '<td style="padding: 6px 10px; text-align: center; font-weight: 700; border-bottom: 1px solid #eee; ' +
                'background: ' + statusBg + '; color: ' + statusColor + '; border-radius: 4px; font-size: 0.8em;">' + r.result.trackLabel + '</td>' +
                '</tr>';
        });

        // Team average row
        var avgValues = { aht: 0, adherence: 0, sentiment: 0, associateOverall: 0, reliability: 0 };
        var avgCounts = { aht: 0, adherence: 0, sentiment: 0, associateOverall: 0, reliability: 0 };
        var totalRatingAvg = 0, ratingCount = 0;
        results.forEach(function(r) {
            var v = r.result.values || {};
            ['aht', 'adherence', 'sentiment', 'associateOverall', 'reliability'].forEach(function(k) {
                if (v[k] !== null && v[k] !== undefined) { avgValues[k] += v[k]; avgCounts[k]++; }
            });
            if (r.result.ratingAverage !== null) { totalRatingAvg += r.result.ratingAverage; ratingCount++; }
        });

        function teamAvgCell(key, unit) {
            if (avgCounts[key] === 0) return '<td style="padding: 6px; text-align: center; font-weight: 700; background: #ede7f6; color: #4a148c; border-top: 3px solid #6a1b9a;">--</td>';
            var avg = avgValues[key] / avgCounts[key];
            var display = unit === 'sec' ? Math.round(avg) + 's' : unit === 'hrs' ? avg.toFixed(1) + 'h' : avg.toFixed(1) + '%';
            return '<td style="padding: 6px; text-align: center; font-weight: 700; background: #ede7f6; color: #4a148c; border-top: 3px solid #6a1b9a;">' + display + '</td>';
        }

        var teamRatingAvg = ratingCount > 0 ? (totalRatingAvg / ratingCount).toFixed(2) : '--';
        html += '<tr>' +
            '<td style="padding: 6px 8px; font-weight: 800; background: #ede7f6; color: #4a148c; border-top: 3px solid #6a1b9a;">Team Avg</td>' +
            teamAvgCell('aht', 'sec') + teamAvgCell('adherence', '%') + teamAvgCell('sentiment', '%') +
            teamAvgCell('associateOverall', '%') + teamAvgCell('reliability', 'hrs') +
            '<td style="padding: 6px; text-align: center; font-weight: 700; background: #ede7f6; color: #4a148c; border-top: 3px solid #6a1b9a;">' + teamRatingAvg + '</td>' +
            '<td style="padding: 6px; background: #ede7f6; border-top: 3px solid #6a1b9a;"></td></tr>';

        html += '</tbody></table></div>';

        // Legend
        html += '<div style="display: flex; gap: 12px; margin-top: 10px; padding: 8px 12px; background: #f8fafc; border-radius: 6px; border: 1px solid #e2e8f0; flex-wrap: wrap; font-size: 0.75em;">' +
            '<span style="font-weight: 600; color: #334155;">Scores:</span>' +
            '<span><span style="display: inline-block; width: 14px; height: 14px; background: #00b050; border-radius: 2px; vertical-align: middle;"></span> 3 = Exceptional</span>' +
            '<span><span style="display: inline-block; width: 14px; height: 14px; background: #f0de87; border-radius: 2px; vertical-align: middle;"></span> 2 = Successful</span>' +
            '<span><span style="display: inline-block; width: 14px; height: 14px; background: #ff1a1a; border-radius: 2px; vertical-align: middle;"></span> 1 = Off Track</span>' +
            '</div>';

        html += '</div>';

        container.innerHTML = html;
    }

    /* ── Export ── */

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.onOffTracker = {
        parseOnOffMirrorNumber,
        isValidOnOffPercent,
        pickYearEndAssociateOverallValue,
        buildYearEndOnOffValues,
        getYearEndOnOffScoreOrFallback,
        buildYearEndOnOffScores,
        resolveYearEndOnOffTrackStatus,
        calculateYearEndOnOffMirror,
        applyOnOffMirrorResultToElements,
        renderYearEndOnOffMirror,
        renderOnOffMirrorForElementIds,
        resolveOnOffBandGoalText,
        resolveMetricTrendsGoalText,
        resolveOnOffGoalText,
        buildOnOffScoreRows,
        getOnOffScoreCellStyle,
        getOnOffStatusStyle,
        buildOnOffHeaderSummaryHtml,
        buildOnOffRowsHtml,
        buildOnOffScoreTableHtml,
        getOnOffTrackerLegendBandsByYear,
        buildOnOffLegendMissingConfigCardHtml,
        buildOnOffLegendMinTypeCardHtml,
        buildOnOffLegendMaxTypeCardHtml,
        buildOnOffLegendMetricCardHtml,
        buildOnOffLegendContainerHtml,
        renderOnOffTrackerLegend,
        populateOnOffTrackerEmployeeSelect,
        resetOnOffTrackerPanel,
        bindOnOffTrackerHandlers,
        resolveOnOffTrackerFactsSummaryText,
        initializeOnOffTracker,
        updateOnOffTrackerDisplay,
        generateTeamOnOffSummary,
        generateQuickCheckinPrompt
    };
})();
