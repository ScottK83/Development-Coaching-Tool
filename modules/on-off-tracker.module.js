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

        if (metricKey === 'aht') {
            return value <= 419 ? 3 : (value <= 460 ? 2 : 1);
        }
        if (metricKey === 'scheduleAdherence') {
            return value >= 94.5 ? 3 : (value >= 92.5 ? 2 : 1);
        }
        if (metricKey === 'overallSentiment') {
            return value >= 90.1 ? 3 : (value >= 87.5 ? 2 : 1);
        }
        if (metricKey === 'cxRepOverall') {
            return value > 82 ? 3 : (value >= 79.5 ? 2 : 1);
        }
        if (metricKey === 'reliability') {
            return value > 24.1 ? 1 : (value >= 16.1 ? 2 : 3);
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
                associateOverallSource: associateOverallPick.source
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
            associateOverallSource: associateOverallPick.source
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

    function buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata) {
        return [
            {
                label: 'AHT',
                valueText: result.values.aht === null ? 'N/A' : _formatMetricDisplay('aht', result.values.aht),
                goalText: resolveOnOffGoalText(goalSource, bands, 'aht', 'aht', 'aht', reviewYear, periodMetadata),
                score: result.scores.aht
            },
            {
                label: 'Adherence',
                valueText: result.values.adherence === null ? 'N/A' : _formatMetricDisplay('scheduleAdherence', result.values.adherence),
                goalText: resolveOnOffGoalText(goalSource, bands, 'scheduleAdherence', 'scheduleAdherence', 'scheduleAdherence', reviewYear, periodMetadata),
                score: result.scores.adherence
            },
            {
                label: 'Overall Sentiment',
                valueText: result.values.sentiment === null ? 'N/A' : _formatMetricDisplay('overallSentiment', result.values.sentiment),
                goalText: resolveOnOffGoalText(goalSource, bands, 'overallSentiment', 'overallSentiment', 'overallSentiment', reviewYear, periodMetadata),
                score: result.scores.sentiment
            },
            {
                label: 'Associate Overall (Surveys)',
                valueText: result.values.associateOverall === null ? 'N/A' : _formatMetricDisplay('overallExperience', result.values.associateOverall),
                goalText: resolveOnOffGoalText(goalSource, bands, 'cxRepOverall', 'cxRepOverall', 'overallExperience', reviewYear, periodMetadata),
                score: result.scores.associateOverall
            },
            {
                label: 'Reliability',
                valueText: result.values.reliability === null ? 'N/A' : _formatMetricDisplay('reliability', result.values.reliability),
                goalText: resolveOnOffGoalText(goalSource, bands, 'reliability', 'reliability', 'reliability', reviewYear, periodMetadata),
                score: result.scores.reliability
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
                            <td style="padding: 8px; border: 1px solid #e3d7f7; text-align: center; ${getOnOffScoreCellStyle(row.score)}">${row.score === null ? 'N/A' : row.score}</td>
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
                        <th style="text-align: center; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Rating Average</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="3">${ratingText}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Overall Status</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="3">${statusText}</td>
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
                <div style="font-size: 0.85em; color: #8d6e00;">Score 2: \u2265 ${score2} and &lt; ${score3}</div>
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
        updateOnOffTrackerDisplay
    };
})();
