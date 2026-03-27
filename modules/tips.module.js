// ============================================
// TIPS MANAGEMENT
// ============================================

const EMBEDDED_TIPS_CSV = `Metric,Tip
scheduleAdherence,Log in 2-3 minutes early to avoid system lag delays
scheduleAdherence,Set phone reminders 5 minutes before breaks end
scheduleAdherence,Keep a visible timer on your desk for break times
scheduleAdherence,Put break end times in Outlook calendar with pop-up alerts
scheduleAdherence,If you're consistently late from breaks - set a timer for 2 minutes before break ends
scheduleAdherence,Review your Verint schedule every Sunday night so you know your week
scheduleAdherence,Keep your workstation logged in during breaks to avoid login delays
scheduleAdherence,Have your supervisor's number saved - call immediately if you'll be late
scheduleAdherence,Plan bathroom breaks during natural call lulls - don't wait until urgent
scheduleAdherence,If system issues make you late - report it immediately for exception coding
fcr,Take 10 extra seconds to confirm you fully answered the question before ending call
fcr,Ask 'Is there anything else I can help you with today?' and wait for actual response
fcr,Use teach-back method: 'Let me make sure I explained that clearly...' to catch confusion
fcr,Don't rush the close - customers will call back if they're still confused
fcr,If you're unsure you resolved it - say 'If you have any issues call back and reference ticket X'
fcr,Check account notes from previous calls - often tells you what customer REALLY needs
fcr,Ask clarifying questions upfront: 'Just to make sure I help you completely - is this about X or Y?'
fcr,Before ending call - summarize what you did: 'So I've updated X and you should see Y'
fcr,If customer says 'I guess that works' - dig deeper - they're not satisfied yet
fcr,Keep a list of your personal callbacks - identify your patterns and fix root causes
transfers,Before transferring - take 10 seconds to check knowledge base - customers prefer waiting over restarting
transfers,Say 'Let me see if I can help you with that first' before defaulting to transfer
transfers,Memorize which department handles top 5 transfer reasons to route correctly first time
transfers,If you do transfer - give customer the direct number in case call drops
transfers,Warm transfer when possible - brief the next rep so customer doesn't repeat story
transfers,Learn the 5 things you transfer most - make those your study priority this month
transfers,Before transferring billing issues - verify you can't do a simple payment arrangement first
transfers,If customer asks for supervisor - try to resolve first: 'I'd love to help you - let me see what I can do'
transfers,Keep a transfer log - track why you transferred - find your knowledge gaps
transfers,If you transfer more than 2 times in one shift - review those calls to understand why
aht,Use quick reference card while talking - it's faster than searching knowledge base mid-call
aht,Memorize top 5 most common customer questions to avoid looking up every time
aht,Practice your greeting and closing to get under 10 seconds each
aht,Type account notes WHILE talking - not in silence after
aht,Have frequently-used links bookmarked and organized in toolbar
aht,Use dual monitors if available - one for customer info - one for tools
aht,Learn keyboard shortcuts for your main programs - mouse clicking adds 5-10 seconds per call
aht,Don't over-explain simple things - 'Your payment is due the 15th' not a 3-minute explanation of billing cycles
aht,If you're searching for something - tell customer what you're doing so silence doesn't feel awkward
aht,Review your longest calls weekly - find your time-wasters and eliminate them
acw,Start documentation DURING the call not after - fill in account notes while talking
acw,Use text expander shortcuts for common phrases like 'Customer called regarding billing question'
acw,Have your wrap-up template ready to go - fill in blanks rather than typing from scratch
acw,Use consistent abbreviations so you type faster - create your own shorthand system
acw,Don't write a novel - brief accurate notes are better than essays
acw,If call was simple - notes can be simple: 'Changed due date to 20th per customer request'
acw,Use drop-down options in CRM when available - faster than typing
acw,Practice typing without looking - every second counts in ACW
acw,If your ACW is high - time yourself on next 5 calls to see where seconds go
acw,Set a personal ACW goal - try to beat your own time each day
holdTime,Put customer on hold BEFORE looking things up not after - Say 'Let me pull that up one moment' then hit hold button
holdTime,Keep frequently used screens already open in browser tabs
holdTime,Learn keyboard shortcuts for your main tools - mouse clicking adds 5-10 seconds per call
holdTime,Ask ALL your questions before putting customer on hold - don't hold multiple times
holdTime,If you need to research - estimate time: 'This may take 2-3 minutes - are you able to hold?'
holdTime,Check in every 30-45 seconds during long holds: 'Still researching - appreciate your patience'
holdTime,Have your knowledge base search open in separate tab - ready to use instantly
holdTime,Learn where information lives in systems - don't hunt around while customer waits
holdTime,If hold will be long - offer callback instead of making customer wait
holdTime,Practice navigation - the faster you move through screens the less customers wait
overallSentiment,Smile while talking - customers hear it in your voice even on the phone
overallSentiment,Use customer's name at least twice during call - beginning and end
overallSentiment,Match the customer's energy level - if they're calm be calm - if concerned show empathy
overallSentiment,Lead with empathy on difficult calls: 'I understand this is frustrating - let me help'
overallSentiment,Sound genuinely interested - not robotic - vary your tone
overallSentiment,Use their words back: If they say 'bill is confusing' say 'Let me clarify that confusing bill'
overallSentiment,End on positive note even if you couldn't do everything: 'I'm glad I could at least help with X'
overallSentiment,Acknowledge their effort: 'I appreciate you calling in about this instead of letting it slide'
overallSentiment,Avoid dead air - if you're thinking say 'Let me think about best way to help you here'
overallSentiment,Thank them for patience if call took longer: 'Thanks for bearing with me on that'
positiveWord,Replace 'problem' with 'situation' - it sounds less negative
positiveWord,Say 'I'd be happy to help you with that' instead of 'I can help you'
positiveWord,Use 'absolutely' instead of 'yes' - it's more enthusiastic
positiveWord,Say 'Let me find that information' not 'I don't have that information'
positiveWord,Replace 'You need to' with 'The next step is' - sounds less demanding
positiveWord,Say 'I can' instead of 'I can't' - focus on what you CAN do
positiveWord,Use 'opportunity' instead of 'issue' when appropriate
positiveWord,Say 'Let me get that handled for you' instead of 'Let me fix that problem'
positiveWord,Replace 'Your account shows' with 'I see here that' - sounds more collaborative
positiveWord,Say 'moving forward' instead of 'from now on' - sounds more optimistic
negativeWord,Replace 'unfortunately' with 'what I can do is...' to focus on solutions
negativeWord,Never say 'I don't know' - say 'Great question let me find that answer for you'
negativeWord,Avoid 'but' - use 'and' or 'however' to sound less contradictory
negativeWord,Don't say 'That's not my department' - say 'Let me connect you with the right team'
negativeWord,Replace 'You'll have to' with 'The next step is' - sounds less harsh
negativeWord,Avoid 'policy won't allow' - say 'Here's what I can offer instead'
negativeWord,Don't say 'That's impossible' - say 'Let me see what options we have'
negativeWord,Replace 'You're wrong' with 'Let me clarify what happened here'
negativeWord,Avoid 'There's nothing I can do' - always offer SOMETHING even if small
negativeWord,Don't say 'You didn't' - say 'It looks like this step was missed'
managingEmotions,Take a 3-second breath before responding to frustrated customers
managingEmotions,Use phrases like 'I understand your frustration' before solving - validate first
managingEmotions,Lower your voice volume slightly when customer raises theirs - it naturally de-escalates
managingEmotions,Don't take angry words personally - they're frustrated with situation not you
managingEmotions,Stay solution-focused: 'I hear you - let me see what I can do to help'
managingEmotions,Acknowledge their feelings: 'I can tell this has been really frustrating for you'
managingEmotions,Give yourself 30 seconds between difficult calls to reset mentally
managingEmotions,If customer is yelling - let them vent for 20-30 seconds then redirect calmly
managingEmotions,Use 'we' language: 'Let's figure this out together' - creates partnership feeling
managingEmotions,If you're getting triggered - put on hold for 10 seconds and breathe - then come back calm
reliability,Review your Verint time entries to make sure you're marked correctly - coding errors can inflate your hours
reliability,Pre-schedule any planned time off in advance so it doesn't count against reliability
reliability,If time off is listed as Same Day use PTOST - you're given 40 hours of PTOST so use them
reliability,Alert your supervisor if you see any discrepancies in your reliability hours - they can investigate and get corrections made
cxRepOverall,Listen for the REAL issue behind the question - sometimes billing question is actually payment plan need
cxRepOverall,End every call with specific next steps - don't leave customer wondering what happens next
cxRepOverall,Follow up on promises - if you said you'd call back - call back
cxRepOverall,Take ownership of the customer's issue - don't pass the buck
cxRepOverall,Be proactive - if you see a potential issue on account - address it before they ask
cxRepOverall,Make customer feel heard - repeat back their concern to show you listened
cxRepOverall,Go one step beyond - if they ask about bill also mention upcoming due date
cxRepOverall,Show you care about resolution not just call completion
cxRepOverall,Use their communication style - if they're chatty engage - if they're rushed be efficient
cxRepOverall,End with confidence: 'You're all set - reach out if you need anything else'`;

async function loadServerTips() {
    try {
        const csv = EMBEDDED_TIPS_CSV;
        const lines = csv.split('\n').map(line => line.trim()).filter(line => line);
        const dataLines = lines.slice(1);

        const tips = {};
        const tipsWithOriginalIndex = {};

        dataLines.forEach((line) => {
            const match = line.match(/^([^,]+),"?([^"]*)"?$/);
            if (match) {
                const metric = match[1].trim();
                const tip = match[2].trim();

                if (!tips[metric]) {
                    tips[metric] = [];
                    tipsWithOriginalIndex[metric] = [];
                }
                const originalIndex = tips[metric].length;
                tips[metric].push(tip);
                tipsWithOriginalIndex[metric].push({ tip, originalIndex });
            }
        });

        const modifiedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'modifiedServerTips') || '{}');
        Object.keys(modifiedServerTips).forEach(metricKey => {
            if (tipsWithOriginalIndex[metricKey]) {
                Object.keys(modifiedServerTips[metricKey]).forEach(index => {
                    const originalIdx = parseInt(index, 10);
                    const tipObj = tipsWithOriginalIndex[metricKey].find(t => t.originalIndex === originalIdx);
                    if (tipObj) {
                        tipObj.tip = modifiedServerTips[metricKey][index];
                    }
                });
            }
        });

        const deletedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'deletedServerTips') || '{}');
        Object.keys(deletedServerTips).forEach(metricKey => {
            if (tipsWithOriginalIndex[metricKey]) {
                const deletedIndices = deletedServerTips[metricKey] || [];
                tipsWithOriginalIndex[metricKey] = tipsWithOriginalIndex[metricKey].filter(
                    item => !deletedIndices.includes(item.originalIndex)
                );
            }
        });

        window._serverTipsWithIndex = tipsWithOriginalIndex;

        const simpleTips = {};
        Object.keys(tipsWithOriginalIndex).forEach(metricKey => {
            simpleTips[metricKey] = tipsWithOriginalIndex[metricKey].map(item => item.tip);
        });

        return simpleTips;
    } catch (error) {
        console.error('Error loading tips:', error);
        window._serverTipsWithIndex = {};
        return {};
    }
}

function loadUserTips() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'userCustomTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

function saveUserTips(tips) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'userCustomTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
    }
}

function loadCustomMetrics() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'customMetrics');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading custom metrics:', error);
        return {};
    }
}

function saveCustomMetrics(metrics) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'customMetrics', JSON.stringify(metrics));
    } catch (error) {
        console.error('Error saving custom metrics:', error);
    }
}

function normalizeMetricKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ============================================
// TIPS MANAGEMENT UI
// ============================================

async function renderTipsManagement() {
    const container = document.getElementById('tipsContainer');
    if (!container) return;

    const customMetrics = loadCustomMetrics();

    const metricNames = {};
    Object.entries(METRICS_REGISTRY).forEach(([key, metric]) => {
        metricNames[key] = metric.label;
    });
    Object.assign(metricNames, customMetrics);

    const sortedCategories = Object.keys(metricNames)
        .sort((a, b) => metricNames[a].localeCompare(metricNames[b]));

    let html = '<div style="margin-bottom: 20px;">';
    html += '<p>Select a tip category below to expand and manage its coaching tips.</p>';
    html += '</div>';

    html += '<div id="manageCategorySection" style="margin-bottom: 25px; padding: 20px; background: white; border-radius: 8px; border: 2px solid #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<label for="categoriesSelector" style="font-weight: bold; color: #2196F3; font-size: 1.1em; margin: 0;">Select Tip Category:</label>';
    html += '<button id="newMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">+ New Category</button>';
    html += '</div>';
    html += '<select id="categoriesSelector" style="width: 100%; padding: 12px; border: 2px solid #2196F3; border-radius: 4px; font-size: 1em; cursor: pointer;">';
    html += '<option value="">-- Choose a category --</option>';
    sortedCategories.forEach(metricKey => {
        html += `<option value="${metricKey}">${metricNames[metricKey]}</option>`;
    });
    html += '</select>';
    html += '</div>';

    html += '<div id="createMetricSection" style="display: none; margin-bottom: 25px; padding: 20px; background: #f0f8ff; border-radius: 8px; border: 2px dashed #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<h3 style="color: #2196F3; margin: 0;">➕ Create New Category</h3>';
    html += '<button id="backToManageBtn" style="background: #6c757d; color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">Back</button>';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricName" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">Category Name:</label>';
    html += '<input type="text" id="newMetricName" placeholder="e.g., Accuracy, Compliance, Efficiency" style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; box-sizing: border-box;">';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricTip" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">First Tip:</label>';
    html += '<textarea id="newMetricTip" placeholder="Enter a coaching tip for this new category..." style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; resize: vertical; box-sizing: border-box;" rows="2"></textarea>';
    html += '</div>';
    html += '<button id="createMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-weight: bold;">Create Category</button>';
    html += '</div>';

    html += '<div id="tipsDisplayArea" style="display: none;"></div>';

    container.innerHTML = html;

    function switchToCreateMode() {
        document.getElementById('manageCategorySection').style.display = 'none';
        document.getElementById('createMetricSection').style.display = 'block';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('categoriesSelector').value = '';
        document.getElementById('newMetricName').value = '';
        document.getElementById('newMetricTip').value = '';
        document.getElementById('newMetricName').focus();
    }

    function switchToManageMode() {
        document.getElementById('manageCategorySection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('categoriesSelector').value = '';
    }

    document.getElementById('newMetricBtn')?.addEventListener('click', switchToCreateMode);
    document.getElementById('backToManageBtn')?.addEventListener('click', switchToManageMode);

    document.getElementById('createMetricBtn')?.addEventListener('click', async () => {
        const nameInput = document.getElementById('newMetricName');
        const tipInput = document.getElementById('newMetricTip');
        const metricName = nameInput.value.trim();
        const initialTip = tipInput.value.trim();

        if (!metricName) {
            alert('⚠️ Please enter a metric name');
            return;
        }

        if (!initialTip) {
            alert('⚠️ Please enter at least one tip');
            return;
        }

        const metricKey = normalizeMetricKey(metricName);
        if (metricNames[metricKey]) {
            alert('⚠️ A metric with this name already exists');
            return;
        }

        const updated = loadCustomMetrics();
        updated[metricKey] = metricName;
        saveCustomMetrics(updated);

        const tips = loadUserTips();
        if (!tips[metricKey]) {
            tips[metricKey] = [];
        }
        tips[metricKey].push(initialTip);
        saveUserTips(tips);

        showToast('✅ Metric created successfully!');
        switchToManageMode();
        await renderTipsManagement();
    });

    document.getElementById('categoriesSelector')?.addEventListener('change', async (e) => {
        const metricKey = e.target.value;
        const displayArea = document.getElementById('tipsDisplayArea');

        if (!metricKey) {
            displayArea.style.display = 'none';
            return;
        }

        document.getElementById('manageCategorySection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';

        displayArea.style.display = 'block';
        await loadServerTips();
        const currentUserTips = loadUserTips();
        const serverTipsWithIndex = (window._serverTipsWithIndex && window._serverTipsWithIndex[metricKey]) || [];
        const userTipsForMetric = currentUserTips[metricKey] || [];
        const displayMetricName = metricNames[metricKey];

        let tipsHtml = `<div style="padding: 20px; background: #f8f9fa; border-radius: 8px;">`;
        tipsHtml += `<h3 style="color: #2196F3; margin-top: 0; border-bottom: 2px solid #2196F3; padding-bottom: 10px;">📂 ${displayMetricName}</h3>`;
        tipsHtml += '<div style="margin: 20px 0;"><h4 style="color: #1976D2; margin-bottom: 12px;">📋 Tips</h4>';

        if (serverTipsWithIndex.length > 0) {
            serverTipsWithIndex.forEach((tipObj) => {
                if (!tipObj || typeof tipObj.originalIndex === 'undefined') {
                    return;
                }
                const tip = tipObj.tip;
                const originalIndex = tipObj.originalIndex;
                tipsHtml += `
                    <div style="margin-bottom: 12px; padding: 15px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 130px; align-items: start; gap: 12px;">
                            <textarea id="editServerTip_${metricKey}_${originalIndex}" style="width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; border: 1px solid #1976D2; border-radius: 4px; font-size: 0.95em; resize: vertical; min-height: 60px; background: white;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px; width: 130px;">
                                <button class="updateServerTipBtn" data-metric="${metricKey}" data-index="${originalIndex}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button class="deleteServerTipBtn" data-metric="${metricKey}" data-index="${originalIndex}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (userTipsForMetric.length > 0) {
            userTipsForMetric.forEach((tip, index) => {
                tipsHtml += `
                    <div style="margin-bottom: 12px; padding: 15px; background: white; border-left: 4px solid #28a745; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 130px; align-items: start; gap: 12px;">
                            <textarea id="editTip_${metricKey}_${index}" style="width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; border: 1px solid #28a745; border-radius: 4px; font-size: 0.95em; resize: vertical; min-height: 60px;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px; width: 130px;">
                                <button class="updateTipBtn" data-metric="${metricKey}" data-index="${index}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button class="deleteTipBtn" data-metric="${metricKey}" data-index="${index}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (serverTipsWithIndex.length === 0 && userTipsForMetric.length === 0) {
            tipsHtml += '<div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;"><em>No tips found for this metric</em></div>';
        }

        tipsHtml += '</div>';

        tipsHtml += `
            <div style="margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 2px dashed #28a745;">
                <textarea id="newTip_${metricKey}" placeholder="Enter a new custom coaching tip for ${displayMetricName}..." style="width: 100%; padding: 12px; border: 2px solid #28a745; border-radius: 4px; font-size: 0.95em; resize: vertical; margin-bottom: 10px;" rows="3"></textarea>
                <button class="addTipBtn" data-metric="${metricKey}" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; font-weight: bold;">➕ Add Tip</button>
            </div>
        `;
        tipsHtml += '</div>';
        displayArea.innerHTML = tipsHtml;
    });

    const displayArea = document.getElementById('tipsDisplayArea');
    if (!displayArea.dataset.bound) {
        displayArea.addEventListener('click', (e) => {
            const actionButton = e.target.closest('button');
            if (!actionButton) return;

            if (actionButton.classList.contains('updateServerTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                updateServerTip(metric, index);
            } else if (actionButton.classList.contains('deleteServerTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                deleteServerTip(metric, index);
            } else if (actionButton.classList.contains('updateTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                updateTip(metric, index);
            } else if (actionButton.classList.contains('deleteTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                deleteTip(metric, index);
            } else if (actionButton.classList.contains('addTipBtn')) {
                const metric = actionButton.dataset.metric;
                addTip(metric);
            }
        });
        displayArea.dataset.bound = 'true';
    }
}

async function rerenderTipsManagementAndRestoreSelection(metricKey) {
    await renderTipsManagement();
    const selector = document.getElementById('categoriesSelector');
    if (selector && metricKey) {
        selector.value = metricKey;
        selector.dispatchEvent(new Event('change'));
    }
}

window.addTip = async function(metricKey) {
    const textarea = document.getElementById(`newTip_${metricKey}`);
    if (!textarea) {
        console.error('Textarea not found for add operation');
        return;
    }

    const tip = textarea.value.trim();

    if (!tip) {
        alert('⚠️ Please enter a tip first');
        return;
    }

    const userTips = loadUserTips();
    if (!userTips[metricKey]) {
        userTips[metricKey] = [];
    }

    if (!Array.isArray(userTips[metricKey])) {
        console.error('userTips[metricKey] is not an array, resetting');
        userTips[metricKey] = [];
    }

    userTips[metricKey].push(tip);
    saveUserTips(userTips);

    textarea.value = '';
    showToast('✅ Tip added successfully!');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.updateTip = async function(metricKey, index) {
    const textarea = document.getElementById(`editTip_${metricKey}_${index}`);
    if (!textarea) {
        console.error('Textarea not found for edit operation');
        return;
    }

    const updatedTip = textarea.value.trim();

    if (!updatedTip) {
        alert('⚠️ Tip cannot be empty');
        return;
    }

    const userTips = loadUserTips();
    if (userTips[metricKey] && userTips[metricKey][index] !== undefined) {
        userTips[metricKey][index] = updatedTip;
        saveUserTips(userTips);

        showToast('✅ Tip updated successfully!');

        await rerenderTipsManagementAndRestoreSelection(metricKey);
    } else {
        showToast('⚠️ Could not update tip - please refresh the page');
    }
};

window.updateServerTip = async function(metricKey, index) {
    const textarea = document.getElementById(`editServerTip_${metricKey}_${index}`);
    if (!textarea) {
        console.error('Textarea not found for server tip edit operation');
        showToast('⚠️ Could not update tip - please refresh the page');
        return;
    }

    const updatedTip = textarea.value.trim();

    if (!updatedTip) {
        alert('⚠️ Tip cannot be empty');
        return;
    }

    if (typeof index !== 'number' && isNaN(parseInt(index, 10))) {
        console.error('Invalid index for server tip update:', index);
        showToast('⚠️ Could not update tip - invalid index');
        return;
    }

    let modifiedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'modifiedServerTips') || '{}');

    if (!modifiedServerTips[metricKey]) {
        modifiedServerTips[metricKey] = {};
    }

    modifiedServerTips[metricKey][index] = updatedTip;
    localStorage.setItem(STORAGE_PREFIX + 'modifiedServerTips', JSON.stringify(modifiedServerTips));

    showToast('✅ Server tip updated!');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.deleteServerTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this server tip? This will hide it from the list.')) {
        return;
    }

    let deletedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'deletedServerTips') || '{}');

    if (!deletedServerTips[metricKey]) {
        deletedServerTips[metricKey] = [];
    }

    if (!deletedServerTips[metricKey].includes(index)) {
        deletedServerTips[metricKey].push(index);
    }

    localStorage.setItem(STORAGE_PREFIX + 'deletedServerTips', JSON.stringify(deletedServerTips));

    showToast('🗑️ Server tip deleted');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.deleteTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }

    const userTips = loadUserTips();
    if (userTips[metricKey] && Array.isArray(userTips[metricKey])) {
        if (index < 0 || index >= userTips[metricKey].length) {
            showToast('⚠️ Could not delete tip - please refresh the page');
            return;
        }

        userTips[metricKey].splice(index, 1);
        if (userTips[metricKey].length === 0) {
            delete userTips[metricKey];
        }
        saveUserTips(userTips);

        showToast('🗑️ Tip deleted');
    } else {
        showToast('⚠️ Could not delete tip - please refresh the page');
        return;
    }

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

// -----------------------------------------------------------------------------
// UTILITY FEATURE - MANAGE TIPS - DO NOT DELETE
// -----------------------------------------------------------------------------

const DEFAULT_METRIC_TIPS = {
    "Schedule Adherence": [
        "Set a phone alarm 2 minutes before your shift, breaks, and lunch end so you're logged in and ready right on time.",
        "Log into your systems and open your tools before your shift starts so you're taking calls the moment the clock hits.",
        "If you need to step away unexpectedly, message your supervisor immediately and put yourself in the correct aux code.",
        "After break, don't stop at the vending machine or chat on the way back. Head straight to your desk and log in first.",
        "Build a pre-shift checklist: headset on, systems open, water bottle filled, aux ready to switch. Do it the same way every day."
    ],
    "Rep Satisfaction": [
        "After resolving the issue, ask 'Is there anything else I can help with today?' to show you're not rushing them off the call.",
        "Use the customer's name at least twice during the call and mirror their language to build rapport.",
        "When explaining a process, say 'Let me walk you through this step by step' instead of jumping straight to the answer.",
        "If there's a hold or wait, set expectations: 'This will take about 2 minutes, and here's what I'm doing for you.'",
        "End every call with a brief recap: 'So just to confirm, we've taken care of [X] for you today.'"
    ],
    "First Call Resolution": [
        "Before you start fixing the issue, ask 'Is there anything else going on with your account I should look at while I have you?' to catch everything in one call.",
        "When you're unsure, use your resources (knowledge base, job aids) on the call rather than guessing. Getting it right the first time beats a callback.",
        "Before ending the call, ask 'Does that fully resolve everything for you today?' to make sure nothing was missed.",
        "If the fix involves a timeline (like a credit posting), tell them exactly when and what to expect so they don't call back to check.",
        "When you see a related issue on the account (past due, pending order), proactively mention it. Fixing two things now prevents a second call later."
    ],
    "Overall Experience": [
        "Open the call with 'I'd be happy to help you with that' instead of jumping straight into verification. It sets a welcoming tone.",
        "When there's bad news, lead with what you CAN do: 'Here's what I can do for you right now' before explaining any limitations.",
        "Avoid dead air. If you're researching, narrate: 'I'm pulling up your account now' or 'Let me check the latest notes here.'",
        "Before ending, summarize clearly: 'So here's what we did today and what happens next.' Customers remember the ending most.",
        "Match the customer's energy. If they're chatty, take a moment to connect. If they're in a hurry, get to the point quickly."
    ],
    "Transfers": [
        "Before transferring, ask yourself: 'Can I find this answer using my tools or knowledge base?' Check your resources first.",
        "If you're unsure but think you might be able to help, message a colleague or your supervisor to confirm before transferring.",
        "When you do transfer, stay on the line for a warm handoff. Introduce the customer and explain what's already been done.",
        "Keep a personal cheat sheet of which call types you CAN handle vs. which truly need another department.",
        "After a transfer, note what the call was about. If you see the same type often, ask your supervisor for training on handling it yourself."
    ],
    "Overall Sentiment": [
        "When a customer is upset, pause and say 'I hear you, and I want to make sure we get this right' before jumping into problem-solving.",
        "Lower your voice slightly and slow your pace when a customer raises theirs. It naturally de-escalates the conversation.",
        "Avoid the word 'unfortunately.' Replace it with 'Here's what I can do' or 'What I'd recommend is...'",
        "If the call is getting heated, say 'I understand this is frustrating. Let's work through this together.' It resets the dynamic.",
        "After a tough call, take 10 seconds to breathe before answering the next one. Carrying frustration forward hurts your sentiment on the next call too."
    ],
    "Positive Word": [
        "Swap 'I can't do that' with 'What I can do is...' It says the same thing but the customer hears a solution, not a wall.",
        "Use phrases like 'Great question,' 'Absolutely,' and 'Happy to help' naturally throughout the call. They add up.",
        "When confirming actions, say 'I've taken care of that for you' instead of just 'Done.' It sounds more personal.",
        "Thank the customer for specific things: 'Thanks for your patience while I looked into that' instead of a generic 'Thank you.'",
        "Close with something warm and specific: 'I'm glad we got that sorted out for you today' instead of a flat 'Anything else?'"
    ],
    "Avoid Negative Words": [
        "Replace 'You have to' with 'You'll want to' or 'The next step would be.' It removes the commanding tone.",
        "Instead of 'That's not my department,' say 'Let me connect you with the team that specializes in this.'",
        "Swap 'No, we can't' with 'Here's what we can offer instead.' Always redirect to the positive alternative.",
        "Avoid 'The problem is...' and use 'What I'm seeing is...' It sounds investigative instead of blaming.",
        "Don't say 'You should have called sooner.' Instead: 'I'm glad you reached out, let's take care of this now.'"
    ],
    "Managing Emotions": [
        "When you feel yourself getting frustrated, mute for 2 seconds, take a breath, then unmute and respond. That pause makes all the difference.",
        "Remember: the customer is upset at the situation, not at you personally. Separating that mentally helps you stay steady.",
        "If a customer is yelling, let them finish before responding. Then say calmly: 'I understand. Let me help fix this.'",
        "Keep a 'reset phrase' ready for tough calls. Something like 'Let's start fresh and get this resolved for you.'",
        "After a difficult interaction, stand up, stretch, or take a sip of water before the next call. A 15-second reset prevents emotional carry-over."
    ],
    "Average Handle Time": [
        "Open with a clear purpose question: 'What can I help you with today?' to avoid 2 minutes of back-and-forth figuring out the issue.",
        "While the customer explains, start pulling up their account and navigating to the relevant screen. Multitask the listen + lookup.",
        "Know your top 5 call types and have the steps memorized. If you handle 80% of calls without searching, your AHT drops naturally.",
        "Avoid over-explaining. Once the issue is resolved, confirm and close. You don't need to re-explain the entire process.",
        "If you're stuck and researching for more than 60 seconds, ask a teammate via chat rather than spending 3 minutes searching alone."
    ],
    "After Call Work": [
        "Type your notes while the customer is talking. Capture key details (account number, issue, resolution) during the call, not after.",
        "Create shorthand for common dispositions. If you handle a billing call 20 times a day, have a template ready to paste.",
        "Set a personal ACW target: aim to wrap up notes in 30 seconds or less. Time yourself for a few calls to build awareness.",
        "If a call was complex, jot bullet points during the call and convert them to proper notes in ACW. Don't start from scratch.",
        "Close out all tabs and screens from the previous call before the next one comes in. Clean workspace = faster documentation."
    ],
    "Hold Time": [
        "Before placing a hold, gather all the information you'll need upfront: account number, issue details, verification. Don't hold to ask for more info.",
        "Tell the customer exactly what you're doing: 'I'm going to check your last 3 statements, this should take about 30 seconds.'",
        "Check in every 30-45 seconds during long holds: 'Still researching, appreciate your patience. Almost there.'",
        "If you know it'll take more than 2 minutes, offer a callback: 'I want to make sure I get this right. Can I call you back in 10 minutes?'",
        "Keep your most-used resources bookmarked and organized. Faster lookups = shorter holds."
    ],
    "Reliability": [
        "Submit PTO and time-off requests at least 2 weeks in advance when possible. Last-minute requests create coverage gaps for the team.",
        "If you're running late, call or message your supervisor before your shift starts, not after. Early communication shows accountability.",
        "Set up your morning routine so you arrive 10 minutes early. That buffer prevents most tardies from traffic, weather, or parking.",
        "If you have recurring appointments, work with your supervisor to adjust your schedule rather than calling out each time.",
        "Track your own attendance. If you notice a pattern (e.g., calling out on Mondays), address it proactively before it becomes a bigger issue."
    ]
};

function initializeDefaultTips() {
    const stored = localStorage.getItem(STORAGE_PREFIX + 'metricCoachingTips');
    if (stored) {
        return;
    }

    loadServerTips().then(serverTips => {
        if (Object.keys(serverTips).length > 0) {
            localStorage.setItem(STORAGE_PREFIX + 'metricCoachingTips', JSON.stringify(serverTips));
        } else {
            localStorage.setItem(STORAGE_PREFIX + 'metricCoachingTips', JSON.stringify(DEFAULT_METRIC_TIPS));
        }
    }).catch(() => {
        localStorage.setItem(STORAGE_PREFIX + 'metricCoachingTips', JSON.stringify(DEFAULT_METRIC_TIPS));
    });
}

function getMetricTips(metricName) {
    // Load base tips (server/default)
    const stored = localStorage.getItem(STORAGE_PREFIX + 'metricCoachingTips');
    const allBaseTips = stored ? JSON.parse(stored) : DEFAULT_METRIC_TIPS;
    var baseTips = (allBaseTips[metricName] || []).slice();

    // Apply server tip modifications (edits and deletions)
    try {
        const modifications = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'modifiedServerTips') || '{}');
        const deletions = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'deletedServerTips') || '{}');
        const metricMods = modifications[metricName] || {};
        const metricDels = deletions[metricName] || [];

        // Apply edits
        Object.keys(metricMods).forEach(function(idx) {
            var i = parseInt(idx, 10);
            if (i >= 0 && i < baseTips.length) {
                baseTips[i] = metricMods[idx];
            }
        });

        // Remove deleted tips (iterate in reverse to preserve indices)
        if (Array.isArray(metricDels)) {
            var delsSet = new Set(metricDels.map(Number));
            baseTips = baseTips.filter(function(_, i) { return !delsSet.has(i); });
        }
    } catch(e) {}

    // Append user custom tips
    const userTips = loadUserTips();
    const userTipsForMetric = userTips[metricName] || [];

    return baseTips.concat(userTipsForMetric);
}
