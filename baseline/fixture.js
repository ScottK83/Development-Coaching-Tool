/**
 * Fixed sample dataset for the behaviour baseline.
 *
 * Every value here is chosen, not random. The associates sit deliberately at,
 * just above, and just below each 2026 target and each rating-band boundary,
 * because a threshold that moves by a tenth only shows up in a diff if some
 * associate is standing on the line when it moves.
 *
 * 2026 reference points (metric-profiles.module.js):
 *
 *   metric              goal    stretch(3)   floor(2)
 *   scheduleAdherence   93      >=94.5       >=92.5
 *   cxRepOverall        82      >=84         >=81.5
 *   overallSentiment    88      >=90         >=87.5
 *   aht                 426     <=414        <=434
 *   reliability         18      <=18         <=24
 *
 * Nothing in this file may depend on the clock or on Math.random.
 */
'use strict';

// A complete employee record with neutral, mid-range values. Individual
// associates override only the fields their case is about, so the intent of
// each row stays legible.
function base(name, over) {
    return Object.assign({
        name: name,
        firstName: name.split(' ')[0],
        scheduleAdherence: 93.5,
        cxRepOverall: 83,
        fcr: 74,
        overallExperience: 76,
        overallExperienceTop3: 85,
        transfers: 5.5,
        transfersCount: 11,
        aht: 420,
        talkTime: 300,
        acw: 55,
        holdTime: 25,
        reliability: 12,
        overallSentiment: 89,
        positiveWord: 87,
        negativeWord: 84,
        managingEmotions: 96,
        surveyTotal: 40,
        repSurveyTotal: 40,
        fcrSurveyTotal: 40,
        totalCalls: 200
    }, over || {});
}

// The nine cases. Names are deliberately boring and sort predictably.
const EMPLOYEES_2026 = [
    // Every KPI at or beyond the stretch mark -> all five score 3.
    base('Ada Stretch', {
        scheduleAdherence: 95.2, cxRepOverall: 85, overallSentiment: 91,
        aht: 405, reliability: 4
    }),

    // Every KPI exactly on its goal. Four score 2, reliability scores 3,
    // because reliability is the one metric whose goal is also its stretch.
    base('Ben Ongoal', {
        scheduleAdherence: 93, cxRepOverall: 82, overallSentiment: 88,
        aht: 426, reliability: 18
    }),

    // Exactly on the score-2 floor. All five score 2, and not one has met its
    // goal. This is the row that separates "not off track" from "met goal".
    base('Cara Floor', {
        scheduleAdherence: 92.5, cxRepOverall: 81.5, overallSentiment: 87.5,
        aht: 434, reliability: 24
    }),

    // A hair under the floor on every KPI -> all five score 1.
    base('Dan Under', {
        scheduleAdherence: 92.4, cxRepOverall: 81.4, overallSentiment: 87.4,
        aht: 435, reliability: 24.1
    }),

    // The rounding case. 92.46 rounds to 92.5 at display precision, so the
    // year-aware scorer says 2 and any raw comparison says 1.
    base('Eve Rounding', {
        scheduleAdherence: 92.46, cxRepOverall: 81.46, overallSentiment: 87.46,
        aht: 434.4, reliability: 24.004
    }),

    // Mixed: two beyond stretch, one below goal, two below floor.
    base('Fay Mixed', {
        scheduleAdherence: 96, cxRepOverall: 85.5, overallSentiment: 87,
        aht: 450, reliability: 6
    }),

    // Took almost no calls. Below MIN_CALLS_TO_JUDGE (20), with a 0% transfer
    // rate that reads as perfect unless the volume floor is applied.
    base('Gus Nocalls', {
        totalCalls: 3, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0,
        transfers: 0, transfersCount: 0, cxRepOverall: '', fcr: '',
        overallExperience: '', overallExperienceTop3: ''
    }),

    // Blank cells, exactly as the parser writes them. Blank max-type metrics
    // are the ones that coerce to 0 in an unguarded comparison.
    base('Hal Blanks', {
        aht: '', acw: '', holdTime: '', overallSentiment: '',
        positiveWord: '', negativeWord: '', managingEmotions: ''
    }),

    // Only three of the five scored KPIs present. Separates the scorer that
    // refuses a verdict from the one that averages over what it has.
    base('Ida Partial', {
        cxRepOverall: '', overallSentiment: '',
        scheduleAdherence: 93.8, aht: 418, reliability: 9
    })
];

// The same roster a year earlier, against 2025 goals (adherence 93,
// cxRepOverall 80, sentiment 88, aht 440, reliability 16). Same names, so
// year-over-year comparisons have something to match on.
const EMPLOYEES_2025 = [
    base('Ada Stretch', {
        scheduleAdherence: 94.8, cxRepOverall: 83, overallSentiment: 91,
        aht: 425, reliability: 5
    }),
    base('Ben Ongoal', {
        scheduleAdherence: 93, cxRepOverall: 80, overallSentiment: 88,
        aht: 440, reliability: 16
    }),
    base('Cara Floor', {
        scheduleAdherence: 92.5, cxRepOverall: 79.5, overallSentiment: 87.5,
        aht: 448, reliability: 22
    }),
    base('Dan Under', {
        scheduleAdherence: 91, cxRepOverall: 78, overallSentiment: 86,
        aht: 460, reliability: 26
    }),
    base('Eve Rounding', {
        scheduleAdherence: 92.46, cxRepOverall: 79.46, overallSentiment: 87.46,
        aht: 448.4, reliability: 22.004
    }),
    base('Fay Mixed', {
        scheduleAdherence: 95, cxRepOverall: 82, overallSentiment: 86.5,
        aht: 465, reliability: 7
    }),
    base('Gus Nocalls', { totalCalls: 2, surveyTotal: 0, transfers: 0, transfersCount: 0 }),
    base('Hal Blanks', { aht: '', overallSentiment: '' }),
    base('Ida Partial', { cxRepOverall: '', overallSentiment: '' })
];

function period(startDate, endDate, periodType, employees) {
    return {
        employees: employees,
        metadata: {
            startDate: startDate,
            endDate: endDate,
            label: periodType + ' ending ' + endDate,
            periodType: periodType,
            yearEndTargetProfile: 'auto',
            yearEndReviewYear: parseInt(endDate.slice(0, 4), 10),
            uploadedAt: endDate + 'T12:00:00.000Z'
        }
    };
}

// Weeks run Monday to Sunday, matching period-index.mondayOf.
const weeklyData = {
    '2026-06-01|2026-06-07': period('2026-06-01', '2026-06-07', 'week', EMPLOYEES_2026),
    '2026-06-08|2026-06-14': period('2026-06-08', '2026-06-14', 'week', EMPLOYEES_2026),
    '2026-06-15|2026-06-21': period('2026-06-15', '2026-06-21', 'week', EMPLOYEES_2026),
    '2026-05-01|2026-05-31': period('2026-05-01', '2026-05-31', 'month', EMPLOYEES_2026),
    '2026-01-01|2026-03-31': period('2026-01-01', '2026-03-31', 'quarter', EMPLOYEES_2026),
    '2026-06-22|2026-06-24': period('2026-06-22', '2026-06-24', 'week-in-progress', EMPLOYEES_2026)
};

const ytdData = {
    '2026-01-01|2026-06-21': period('2026-01-01', '2026-06-21', 'ytd', EMPLOYEES_2026),
    '2025-01-01|2025-12-31': period('2025-01-01', '2025-12-31', 'ytd', EMPLOYEES_2025)
};

const dailyData = {
    '2026-06-23|2026-06-23': period('2026-06-23', '2026-06-23', 'daily', EMPLOYEES_2026)
};

const ALL_NAMES = EMPLOYEES_2026.map(function (e) { return e.name; });

// Team membership is seeded for every fixture period. Without it the app falls
// back to its built-in default roster of real associate names, and the baseline
// would then mix real people with invented numbers.
const myTeamMembers = {};
Object.keys(weeklyData).forEach(function (k) { myTeamMembers[k] = ALL_NAMES.slice(); });
Object.keys(ytdData).forEach(function (k) { myTeamMembers[k] = ALL_NAMES.slice(); });
Object.keys(dailyData).forEach(function (k) { myTeamMembers[k] = ALL_NAMES.slice(); });

module.exports = {
    EMPLOYEES_2026: EMPLOYEES_2026,
    EMPLOYEES_2025: EMPLOYEES_2025,
    weeklyData: weeklyData,
    ytdData: ytdData,
    dailyData: dailyData,
    myTeamMembers: myTeamMembers,
    ALL_NAMES: ALL_NAMES,
    LATEST_WEEK_KEY: '2026-06-15|2026-06-21',
    YTD_KEY_2026: '2026-01-01|2026-06-21',
    YTD_KEY_2025: '2025-01-01|2025-12-31'
};
