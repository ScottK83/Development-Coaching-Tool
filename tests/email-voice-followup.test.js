'use strict';

/**
 * THE COACHING FOLLOW-UP EMAIL AND THE TREND PICTURE (Center > Trends)
 *
 * Scott, 2026-10-14. The follow-up goes straight into an Outlook draft, and
 * it read as a cold report: ALL-CAPS headers, "96.24" and "604.2" with no
 * units, ">= 93", "Thanks," with no name, a week's reliability hours listed
 * as a win, and the weakest metric put in focus even at goal (Maria was told
 * to work on 96.2% adherence against a 93% goal).
 *
 * The picture the associate is sent carried nine or more emojis, a falling
 * chart on handle time coming DOWN, "+1.1%" for a rate that moved 1.1
 * points, and a reliability note that was a disclaimer and quoted the wrong
 * threshold.
 */

const { suite } = require('./harness');

function load(t, options = {}) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.weeklyData = options.weeklyData || {};
    global.ytdData = options.ytdData || {};
    global.DEBUG = false;
    global.getMetricTips = (key) => [`A tip for ${key}`];
    global.loadCallCenterAverages = () => options.centerAverages || {};
    if (options.ytdReliability) {
        global.window.DevCoachModules.periodCompare = { latestYtdReliability: () => options.ytdReliability };
    }
    return t.loadModule('modules/metric-trends.module.js').metricTrends;
}

const WEEK_META = { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' };

const MARIA = {
    name: 'Maria Lopez', scheduleAdherence: 96.24, transfers: 7.5, aht: 604.2, holdTime: 41, acw: 55,
    overallExperience: 0, cxRepOverall: 0, fcr: 0, surveyTotal: 0,
    overallSentiment: 89.1, positiveWord: 90, negativeWord: 85, managingEmotions: 96, reliability: 8
};
const MARIA_BEFORE = {
    name: 'Maria Lopez', scheduleAdherence: 95.1, transfers: 7.9, aht: 640, holdTime: 38, acw: 57,
    overallExperience: 0, cxRepOverall: 0, fcr: 0, surveyTotal: 0,
    overallSentiment: 88, positiveWord: 88, negativeWord: 84, managingEmotions: 95, reliability: 4
};

function followUp(mt, employee, before) {
    const analysis = mt.analyzeTrendMetrics(employee, { adherence: 92 }, 2026, before, {});
    // The bundle's filtering, which also hands the email its weakest metric.
    const metrics = mt.coachableTrendMetrics(analysis.allMetrics, employee, before);
    const picked = mt.pickWeakestAndTrending(metrics);
    // Handed the UNFILTERED weakest on purpose: the email has to hold the
    // line on its own, whatever it is given.
    return mt.buildCoachingEmailBody('Maria Lopez', analysis.allMetrics, analysis.weakest, picked.trendingDown,
        ['Keep a quick reference sheet where you can see it'], [], WEEK_META);
}

function focusLines(body) {
    const at = body.indexOf('work on next:');
    return at === -1 ? [] : body.slice(at).split('\n').filter((line) => line.startsWith('- '));
}

suite('email voice, follow-up: only what is below goal is focus', (t) => {
    const mt = load(t);
    const body = followUp(mt, MARIA, MARIA_BEFORE);
    const focus = focusLines(body);

    t.check('adherence at 96.2% is not something to work on', !focus.some((line) => /Schedule Adherence/.test(line)));
    t.check('at most two focus areas', focus.length > 0 && focus.length <= 2);
    t.check('handle time, below goal, is', focus.some((line) => /Average Handle Time/.test(line)));
    t.check('each with one tip', focus.every((line) => (line.match(/One thing to try:/g) || []).length === 1));
});

suite('email voice, follow-up: praise first, numbers a person can read', (t) => {
    const mt = load(t);
    const body = followUp(mt, MARIA, MARIA_BEFORE);

    t.check('greets her', body.startsWith('Hi Maria,'));
    t.check('praise comes before the coaching', body.search(/nice work/i) > -1 && body.search(/nice work/i) < body.indexOf('work on next'));
    t.check('never the awkward "and first, nice work"', !/, and first, nice work/.test(body));
    t.check('says how many goals she hit', /You hit \d+ of your \d+ goals/.test(body));
    t.check('at most three wins', body.split('work on next')[0].split('\n').filter((line) => line.startsWith('- ')).length <= 3);
    t.check('handle time in seconds', /604s/.test(body));
    t.check('no raw decimals', !/604\.2|96\.24/.test(body));
    t.check('goals in words', /goal is 426s or lower/.test(body) && !/[<>]=/.test(body));
    t.check('a gain is credited from and to', /down from 640s the week before/.test(body));
    t.check('no ALL-CAPS headers', !/^[A-Z][A-Z ]{5,}:/m.test(body));
    t.check('no bare "Thanks," sign-off', !/Thanks,\s*$/.test(body));
    t.check('ends warm', /here to help/.test(body));
    t.check('names the week by its first day', /the week of Oct 5/.test(body));
    t.check('past tense for a finished week', /came in at/.test(body));
    t.check('no em dashes', !/[—–]/.test(body));
});

suite('email voice, follow-up: no reliability, no zero-survey coaching', (t) => {
    const mt = load(t);
    const body = followUp(mt, MARIA, MARIA_BEFORE);

    t.check('reliability is not a win or a focus', !/Reliability/.test(body));
    t.check('no Overall Experience with no surveys', !/Overall Experience/.test(body));
    t.check('no Rep Satisfaction with no surveys', !/Rep Sat/i.test(body));
    t.check('no First Call Resolution with no surveys', !/First Call/.test(body));
    t.check('no 0% anywhere', !/\b0(\.0)?%/.test(body));

    t.equal('the subject has no raw date', mt.buildCoachingFollowupSubject('Maria', WEEK_META), 'Following up on the week of Oct 5');
    t.equal('the picture subject too', mt.buildTrendEmailSubject(WEEK_META, 'Maria'), 'Weekly metrics for Maria, week of Oct 5');
});

suite('email voice, follow-up: the trend prompt keeps reliability out of strengths', (t) => {
    const mt = load(t);
    const analysis = mt.analyzeTrendMetrics(MARIA, { adherence: 92 }, 2026, MARIA_BEFORE, {});
    // All metrics, reliability included, as another caller might hand them.
    const prompt = mt.buildTrendCoachingPrompt('Maria', analysis.weakest, analysis.trendingDown, [], [], '', null, analysis.allMetrics);
    const strengths = prompt.slice(prompt.indexOf('What I want to praise first:'), prompt.indexOf('\n\n', prompt.indexOf('What I want to praise first:')));
    t.check('reliability is not a strength', !/Reliability/.test(strengths));
    t.check('nor anywhere in the data', !/- Reliability/.test(prompt));
    t.check('the emoji budget is set', /At most 2 emojis/.test(prompt));
    t.check('warm and goal focused', /genuinely proud of them/.test(prompt) && /Goal focused/.test(prompt));
    t.check('rate changes in points', !/by \d+(\.\d)?% vs previous/.test(prompt));
});

function fakeCtx() {
    const texts = [];
    return {
        texts,
        fillText: (text) => texts.push(String(text)),
        fillRect() {},
        strokeRect() {},
        measureText: (text) => ({ width: String(text).length * 7 }),
        createLinearGradient: () => ({ addColorStop() {} })
    };
}

suite('email voice, trend picture: two emojis, words for direction', (t) => {
    const weekKey = '2026-10-05|2026-10-09';
    const period = { metadata: WEEK_META, employees: [MARIA] };
    const mt = load(t, {
        weeklyData: { [weekKey]: period },
        // A year-to-date file ending the same day, so the YTD column has a source.
        ytdData: { '2026-01-01|2026-10-09': { metadata: { periodType: 'ytd', endDate: '2026-10-09' }, employees: [{ ...MARIA, reliability: 26.5 }] } },
        centerAverages: { [weekKey]: { adherence: 92, aht: 500, transfers: 6, holdTime: 35 } },
        ytdReliability: { 'Maria Lopez': 26.5 }
    });
    const voice = global.window.DevCoachModules.messageVoice;

    const context = mt.buildTrendEmailContext(weekKey, period, MARIA, MARIA_BEFORE);
    const ctx = fakeCtx();
    mt.drawTrendEmailCanvasSections(ctx, 'Maria', MARIA, MARIA_BEFORE, context);
    const all = ctx.texts.join('\n');

    t.check('the picture drew its text', ctx.texts.length > 20);
    t.check(`at most 2 emojis in the picture (${voice.countEmojis(all)})`, voice.countEmojis(all) <= 2);
    t.check('no reliability note', !/Reliability Note|believe this is an error|16 hours/.test(all));
    t.check('reliability is the year total', /26\.5 hrs/.test(all) && /So far this year/.test(all));
    t.check('not the week\'s own hours', !ctx.texts.some((text) => text === '8 hrs'));
    t.check('no caveat about missing data', !/not available|not provided/i.test(all));
    t.check('no zero-survey 0% shown', !ctx.texts.some((text) => /^0(\.0)?%$/.test(text)));

    // Handle time came down 36 seconds: an improvement, in green, in words.
    const aht = mt.resolveTrendDirectionDisplay(604.2, 640, true, 'aht', 'week');
    t.equal('handle time coming down reads as improved', aht.text, 'Improved 36 seconds');
    t.equal('and is green', aht.color, '#28a745');
    const adherence = mt.resolveTrendDirectionDisplay(96.24, 95.1, false, 'scheduleAdherence', 'week');
    t.equal('a rate moves in points', adherence.text, 'Improved 1.1 points');
    const slip = mt.resolveTrendDirectionDisplay(41, 38, true, 'holdTime', 'week');
    t.equal('hold time going up reads as slipped', slip.text, 'Slipped 3 seconds');
    t.equal('in red', slip.color, '#dc3545');

    t.equal('the gap to the center is in points too',
        mt.resolveTrendCenterComparisonDisplay(96.2, 92, true, 'scheduleAdherence', true).text, '+4.2 points');
    t.equal('one point is singular', mt.formatTrendChange('scheduleAdherence', 1.02), '1 point');
});

/* Tone audit 2026-10-25: the follow-up email was one fixed text, word for
   word, for everybody, every week. The wording is chosen off the person and
   the period now: the same draft rebuilt reads the same, and the team does
   not all get the same sentences. */
suite('email voice, follow-up: not one fixed text for everybody', (t) => {
    const mt = load(t);
    const analysis = mt.analyzeTrendMetrics(MARIA, { adherence: 92 }, 2026, MARIA_BEFORE, {});
    const metrics = mt.coachableTrendMetrics(analysis.allMetrics, MARIA, MARIA_BEFORE);
    const picked = mt.pickWeakestAndTrending(metrics);
    const bodyFor = (name) => mt.buildCoachingEmailBody(name, metrics, picked.weakest, picked.trendingDown,
        ['Keep a quick reference sheet where you can see it'], [], WEEK_META);
    t.equal('the same person and week read the same', bodyFor('Maria Lopez'), bodyFor('Maria Lopez'));
    const names = ['Maria Lopez', 'Ada Park', 'Bo Chen', 'Cy Diaz', 'Di Evans', 'Ed Fox', 'Flo Gray', 'Gus Hill'];
    const shapes = new Set(names.map((n) => bodyFor(n).split('\n').slice(1).join('\n').replace(/^Hi \w+,/, '')));
    t.check('eight people do not all get the same email (' + shapes.size + ' wordings)', shapes.size >= 3);
});
