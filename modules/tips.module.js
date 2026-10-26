// ============================================
// TIPS MANAGEMENT
// ============================================

const EMBEDDED_TIPS_CSV = `Metric,Tip
scheduleAdherence,Set phone reminders 5 minutes before breaks end.
scheduleAdherence,Put break end times in Outlook calendar with pop-up alerts.
scheduleAdherence,When a new schedule posts, check every start time and break in Verint, not just the days.
scheduleAdherence,Lock your screen at breaks instead of logging all the way out. You come back ready instead of waiting on a full login.
scheduleAdherence,If you're running late, tell your supervisor before your start time, the way the call out process says.
scheduleAdherence,If system issues make you late, report it right away so we can give you next steps.
scheduleAdherence,Set a daily alarm for 10 minutes before your shift starts, same time every day.
scheduleAdherence,Log out of personal apps before break ends so you're ready to take calls.
scheduleAdherence,Open your first screens while you log in, so you're ready when your schedule starts.
scheduleAdherence,When your break ends, that's the cue to sit down and go available, not to finish one more thing.
scheduleAdherence,Keep a quick note of any day you got back late from a break and why. The pattern tells you what to fix.
scheduleAdherence,If weather affects your commute, leave 15 minutes earlier on bad days.
scheduleAdherence,Put your personal phone on Do Not Disturb while you're on the phones.
scheduleAdherence,Set your status to Available within 30 seconds of schedule start. Don't coast in.
scheduleAdherence,Practice a consistent morning routine, same wake time same prep time.
scheduleAdherence,Treat your schedule like an appointment with yourself. Commit to it.
scheduleAdherence,Decide the night before what your first 30 minutes look like, no scrambling once you're on the clock.
scheduleAdherence,Your schedule is built around when calls actually arrive, so ten minutes off moves that work onto someone else.
scheduleAdherence,Treat your lunch time like a meeting you can't be late for. Routine beats willpower.
scheduleAdherence,Ask for a schedule change early, last minute requests are the hardest to cover.
scheduleAdherence,If your headset acts up, report it or swap it right away instead of fighting it call after call.
scheduleAdherence,Restart your PC at the end of shift so the morning login is quick.
scheduleAdherence,Know your exact start time to the minute, not roughly.
scheduleAdherence,If a call ends right before break, take the break, don't squeeze in one more.
scheduleAdherence,Small misses add up. Two minutes late back from four breaks is eight minutes out of adherence.
scheduleAdherence,If a call runs into your break, let your supervisor know so we can give you next steps.
scheduleAdherence,Look at tomorrow's schedule before you log off tonight.
scheduleAdherence,Coffee and water refilled before you go available, not after.
scheduleAdherence,If you swap a shift, check that it actually landed in Verint before you count on it.
scheduleAdherence,Use the right aux code so your time reads the way it really happened.
scheduleAdherence,If you get pulled into a meeting, make sure it shows on your schedule.
scheduleAdherence,Early is not the same as on time, and on time is not the same as ready.
scheduleAdherence,Watch the pattern not the day, one rough morning is noise, three is a habit forming.
scheduleAdherence,If the commute is the problem, change the leave time, not the wake time.
scheduleAdherence,Come back from lunch on the minute. It's the longest break, so it's the easiest one to run over.
scheduleAdherence,Stay available until your scheduled end time. The end of a shift counts the same as the start.
scheduleAdherence,Adherence means doing what your schedule says when it says it, not just being at your desk.
scheduleAdherence,Decide what you'll do with your break before it starts, so it doesn't run long.
scheduleAdherence,Know your break and lunch times for the day before your first call.
scheduleAdherence,If a meeting or training runs over, tell your supervisor right then so we can give you next steps.
fcr,Take 10 extra seconds to confirm you fully answered the question before ending call.
fcr,Ask 'Is there anything else I can help you with today?' and wait for actual response.
fcr,Check that it landed: 'Let me make sure I explained that clearly...' catches confusion before they hang up.
fcr,Don't rush the close. Customers will call back if they're still confused.
fcr,If you're unsure you resolved it, work it out on this call, look it up or ask a peer rather than letting them call back.
fcr,Ask clarifying questions upfront: 'Just to make sure I help you completely, is this about X or Y?'
fcr,Before ending call, summarize what you did: 'So I've updated X and you should see Y'.
fcr,If the customer says 'I guess that works', dig deeper. They're not satisfied yet.
fcr,When someone calls back on something you handled, work out what got missed the first time.
fcr,Skim the last few notes while you're verifying them, the history usually tells you why they're calling.
fcr,Ask 'What have you tried so far?' so you don't repeat steps they already did.
fcr,If you need to escalate, do it inside the call, while they're still on the line.
fcr,Verify understanding with 'Tell me in your own words what we're doing next'.
fcr,Tell the customer what to do if it happens again so they can handle it without calling back.
fcr,When account notes are unclear, ask someone who knows that call type instead of guessing at what happened.
fcr,Build a personal 'gotcha list' of things that tripped you up. Review it weekly.
fcr,If the customer mentions two issues, tackle the bigger one first but take care of both before you hang up.
fcr,If you don't know the answer say 'Give me one moment to confirm that', never guess.
fcr,Confirm the payment details before you end a billing call, so they don't have to call back.
fcr,If there's a known outage, mention it up front so the customer doesn't call back confused.
fcr,Ask 'Have I answered all your questions today?' and wait for a real answer.
fcr,Fix what caused it not just what they noticed. A bill they still don't understand is another call next month.
fcr,Check the date on notes from prior reps. Outdated info causes wrong fixes.
fcr,On a high bill call, explain what drove it before you offer a payment plan, the why is what stops the callback.
fcr,Check the meter read dates, a bill covering extra days explains itself.
fcr,If there's a pending disconnect on the account, say so, don't let them find out later.
fcr,When you set up a payment arrangement, say the exact dates and amounts out loud.
fcr,If they say they already paid, find where the payment landed before you explain anything else.
fcr,Confirm how they get their bill, someone who never sees it will call every month.
fcr,Tell them what the next bill should look like, surprises are callbacks.
fcr,If weather drove the usage, say it plainly, hotter month means more running time means a higher bill.
fcr,When you change a due date, say which bill it takes effect on.
fcr,If they may qualify for assistance, get that referral done on this call.
fcr,A customer who says 'so what do I do now' hasn't been given a next step.
fcr,If you promise a credit, say when they'll see it and on which bill.
fcr,If the account is in someone else's name, sort out who can do what before you go further.
fcr,On move in and move out calls, read the date and the address back to them.
fcr,Ask whether they have other accounts in their name and handle them together.
fcr,If they're on autopay, tell them what will draft and when.
fcr,If an outage caused it, tell them what's already been reported and what happens next.
fcr,Never end a billing call without saying the balance and the due date.
fcr,If you can't finish it today, say exactly what happens next and who does it.
fcr,If you spot something wrong on the account, tell them and fix it while you're both on the call.
fcr,On a solar bill, walk them through what they used from APS and what they sent back. Most solar callbacks come from not knowing which line is which.
fcr,When they ask how long a payment takes to post, check how and when they paid before you answer. Don't guess a time.
fcr,On a rate plan change, check which bill the new plan starts on and tell them. A surprise on the next bill is a callback.
fcr,If the bill was estimated, say so plainly and tell them what you can see about the next actual read.
fcr,On a reconnect call, check where the payment stands before you say anything about timing, then tell them exactly what happens next.
transfers,Before transferring, take 10 seconds to look it up. Customers would rather wait than start over with someone new.
transfers,Say 'Let me see if I can help you with that first' before defaulting to transfer.
transfers,If you do transfer, tell them who they're going to and why, a dropped call shouldn't start from zero.
transfers,Learn the 5 things you transfer most. Make those your study priority this month.
transfers,Before transferring billing issues, verify you can't do a simple payment arrangement first.
transfers,If the customer asks for a supervisor, try to resolve it first: 'I'd love to help you. Let me see what I can do.'
transfers,If you transfer more than twice in a shift, jot down why for each one.
transfers,Stay on the line until the next agent picks up. Don't abandon them in transfer purgatory.
transfers,If a transfer drops, note the account so whoever they reach next can pick up where you left off.
transfers,Build relationships with other departments so warm transfers are smoother.
transfers,Know what your department can and can't do, over-transferring costs you ownership.
transfers,Reach out to a peer with low transfers to see how they're handling them.
transfers,If you keep transferring because you think you don't have access, check first, then ask your supervisor whether you can get that access.
transfers,Apologize in advance for any wait: 'They may have a short wait, thanks for hanging in'.
transfers,Before transferring ask yourself 'Have I done everything I can to help them?'
transfers,Some transfers are the right call. Don't feel bad about sending one where it belongs.
transfers,Warm transfer when you can, and give the next rep a 20 second brief: the customer's name, the issue and what you've already tried.
transfers,A high bill question is yours, not another team's.
transfers,Learn everything you can do on a payment arrangement before you hand one off.
transfers,If you're transferring because you're unsure, say what you're unsure about first, someone may answer it in ten seconds.
transfers,Check whether the team you're about to send them to is even open.
transfers,If they've already been transferred once today, work harder to keep it.
transfers,Ask what they were told last time before you send them back to the same place.
transfers,If the answer is sitting in the notes, don't transfer for it.
transfers,A transfer to the wrong team costs the customer twice.
transfers,If you're sending them to credit or collections, explain what will happen there.
transfers,Sending someone back to the automated line still feels like a transfer to them.
transfers,Same transfer three times in a week is a training request, not a habit.
transfers,Ownership means you know where it went and that it landed.
transfers,Ask a peer first, most of the time the answer is somewhere on your floor.
transfers,A transfer you can explain is fine, a transfer you can't is a knowledge gap.
transfers,If you're transferring to get out of a hard conversation, that's the call worth staying on.
transfers,Don't promise what the next team will do, tell them what the next team handles.
transfers,If the customer is upset, warn the next rep, walking in blind makes it worse.
transfers,A downed line, sparks or smoke is a safety call. Tell them to stay well away and follow the emergency steps right away.
transfers,A safety call is never one to hold on to. Follow the emergency steps right away, even if it means a transfer.
transfers,Before you transfer, tell the customer the one thing the next team will need from them, so it's ready.
transfers,When a call needs another team for one piece, do every piece you can first, then transfer for the rest.
transfers,If the customer asks to be transferred, find out why first. Often it's something you can do.
aht,Keep a quick reference sheet where you can see it. Faster than searching mid-call.
aht,Memorize top 5 most common customer questions to avoid looking up every time.
aht,Practice your greeting and closing so they flow without stalling. Smooth pace beats fumbling through them.
aht,Type account notes while you're talking, not in silence after.
aht,Work both monitors on every call. Account and notes on one. Your lookup tools on the other. Alt-tabbing costs you seconds every single call.
aht,Learn keyboard shortcuts for your main programs. Mouse clicking adds 5-10 seconds per call.
aht,Answer the question they asked. A due date question gets the date. A 'why is it higher' question gets the one reason, like the extra days on this bill.
aht,When a call runs long, notice what made it long. That's the step to practice.
aht,Don't type a full sentence when a phrase will do. Notes are for you not a novel.
aht,Identify your 2 slowest tasks and find a faster way. Almost all of your time savings will come from those two.
aht,Pull up the account while you greet them, then ask for verification, so there's no quiet stretch after the hello.
aht,If the call came in authorized, the name is all you need to verify. Don't re-ask for what the notes already spell out.
aht,Keep the things you look up most within one click. Hunting for them is pure handle time.
aht,If the customer is rambling, gently redirect: 'So what I'm hearing is X. Let me solve that.'
aht,Avoid over-apologizing. One genuine 'I'm sorry for the wait' is enough.
aht,Have a ready opener for the answers you know cold. 'Great question, here's how that works', so you're not stalling while you get your thoughts together.
aht,If you realize mid-call you took the wrong path, switch right away instead of finishing the wrong one.
aht,If you need to look up 3 things, look them all up in one trip instead of bouncing back and forth between screens.
aht,Wrap counts in your handle time. A short accurate note costs you less than a long one.
aht,On simple calls, close what you don't need. Fewer windows means less hunting.
aht,Keep a notepad of your common call types and the notes you use for them. Beats retyping the same thing every call.
aht,Listen fully the first time so the customer doesn't have to repeat themselves.
aht,Ask your supervisor for time to role-play your top call type with a peer.
aht,Handle time isn't talking fast, it's not repeating steps.
aht,Ask the one question that tells you what kind of call this is, then go straight to it.
aht,Long calls usually start with a slow first minute.
aht,If you're explaining a bill three different ways, pick the number that matters and lead with it.
aht,Read the last note before you ask them to walk you through the history.
aht,Say the numbers once clearly instead of three times quickly.
aht,Once they've finished explaining and you know the answer, go straight to it.
aht,Tell them what you're doing, not how you're doing it, they don't need the clicks.
aht,Have the amounts and dates in front of you before you start explaining them.
aht,When someone needs to vent about the bill, let them, then bring it back to one thing.
aht,Your longest calls are usually two calls stacked, name both up front and take them in order.
aht,If the same screen is slow every day, log it so we can push on it.
aht,Same greeting every time, no thinking required.
aht,Check your work once, carefully, before you tell them it's done. Then move on.
aht,If they've gone quiet they're reading, ask instead of waiting.
aht,Think about what your quickest high bill call did differently from your slowest one, and do more of that.
aht,Lead with the number and the date, then give the one reason behind it.
aht,Saying it straight takes less time than talking around it.
acw,Start your notes during the call, not after. Fill in the account notes while you're talking.
acw,Keep your common note phrases saved somewhere you can paste from. 'Customer called regarding billing question' shouldn't be retyped 20 times a day.
acw,Write the note in the same order every time. Your hands stop deciding what comes next.
acw,Use the abbreviations everyone on the floor knows, so you type less and the next rep can still read it.
acw,Don't write a novel. Brief accurate notes are better than essays.
acw,If the call was simple, the note can be simple: 'Changed due date to 20th per customer request.'
acw,Write the note for the next person who opens this account, not for yourself.
acw,Resist rewriting a note you already finished. Your first pass is usually good enough.
acw,If your after-call work is running long, time yourself on the next five calls to see where the seconds go.
acw,Set a personal goal for after-call work and try to beat your own time each day.
acw,If you promised the customer something, write that part of the note first while the wording is still exact.
acw,Close unneeded windows between calls. Don't hunt through 10 tabs during wrap.
acw,Be consistent with your wrap codes. The same situation should get the same code every time.
acw,If your after-call work crept up over the past week, look at what changed in how you wrap up.
acw,On a repeat caller the prior note gives you the background, yours only has to say what changed.
acw,Stuck on wording? Write what you did and what happens next. That is the whole note.
acw,If the call needs a follow-up step, do the step first and write the note second.
acw,Finish the note before you go available. One you come back to takes twice as long.
acw,Don't overthink the perfect note. Good enough beats perfect and late.
acw,Decide your wrap code during the call not after it.
acw,Review your saved note phrases monthly. Delete anything that's out of date.
acw,Log any system issues that slow you down. Once we can show a pattern we can push to get it fixed.
acw,Three lines is usually plenty, what they called about, what you did, what's next.
acw,Dates and amounts belong in the note, adjectives don't.
acw,If the note takes longer than the fix, the note is too long.
acw,Don't retype what the system already recorded on its own.
acw,Name the plan or program exactly, the next rep shouldn't have to guess which one.
acw,If you left something open, say who owns it.
acw,Skip the greeting and the pleasantries, nobody reads those.
acw,If the note has to be long, say why in the first line.
acw,A note nobody can act on is time spent for nothing.
acw,Don't save the hard note for last, write it while it's fresh.
acw,Look at your after-call work every time you get your numbers, not just at the end of the month.
acw,If wrap runs past a minute, the note is doing too much.
acw,The note is a record, write it like someone will read it back to you.
acw,If you don't know which wrap code fits, ask once and remember it, instead of guessing every time.
acw,Type the amounts and dates as you confirm them with the customer, so the note is half done when you hang up.
acw,Use wrap for the note and the code only. Reading and catching up can wait for your break.
acw,Before you go available, read your note once. If it says what happened and what's next, you're done.
acw,On a payment arrangement, put the dates and amounts in the note exactly as you said them.
holdTime,Default to narrating instead of holding for lookups. 'I'm pulling up your account now' keeps them with you, reserve hold for when you genuinely can't talk through it.
holdTime,Ask all your questions before you put the customer on hold, so you only hold once.
holdTime,If you truly need a hold, ask first and keep it short: 'Can I place you on a brief hold while I check that?'
holdTime,Check in every 30-45 seconds during long holds: 'Still researching, appreciate your patience'.
holdTime,Keep your lookup tools open in their own tab. Ready before you need them.
holdTime,Learn where information lives in your systems. Don't hunt around while the customer waits.
holdTime,Use hold only for the account work. Everything else waits for your break.
holdTime,Set a mental timer: 90 seconds on hold feels like 5 minutes to the customer.
holdTime,If the customer doesn't want to hold, talk them through what you're doing.
holdTime,Come back with what you found. 'Thanks for holding, here's what I've got' beats a second apology.
holdTime,Pull up the account while you verify, so you don't need to hold later.
holdTime,If the customer asks a second question while you're already searching, jot it down and answer both.
holdTime,Don't hold to think. Think out loud instead: 'Let me look at the options here.'
holdTime,If the system is slow, acknowledge it: 'My system is loading, thanks for your patience'.
holdTime,Hold music is not connection. Always check in. Silence means they hang up.
holdTime,If you were trained to hold for a certain task, check whether you can actually do that task while still talking to the customer.
holdTime,Tell them how long, then beat it.
holdTime,Two short holds feel longer to them than one honest one.
holdTime,Coming back with nothing is worse than never leaving.
holdTime,Don't hold to read a note you could have read during the greeting.
holdTime,If you need a second hold, explain why before you go.
holdTime,Give them something to do while you're gone, having the account number ready keeps them with you.
holdTime,If they're angry, hold makes it worse, keep talking.
holdTime,A long hold on a billing call means it got complicated, tell them that.
holdTime,Come back inside your estimate even if you're not done, then give a new one.
holdTime,Practice the three lookups you do most until they don't need a hold at all.
holdTime,If you're holding to ask a peer, tell them that's what you're doing.
holdTime,Time your next five holds. They're usually longer than they feel.
holdTime,If it's going to take five minutes, say so up front and talk them through what you're doing instead of leaving them on hold.
holdTime,Tell them what you're checking before you hold. A hold with a reason feels shorter.
holdTime,Ask before every hold, even a short one. It's their time you're spending.
holdTime,Holds add up fast on a billing call. Have the balance, the due date and the last payment up before you need them.
holdTime,Know the payment arrangement steps well enough to set one up without a hold.
holdTime,If you hold to ask a peer the same question twice, learn that answer this week.
holdTime,Most of your hold time comes from a few call types. Find yours and learn those lookups.
holdTime,A hold in the middle of explaining a bill breaks their train of thought. Get everything first, then explain.
holdTime,When you come back from a hold, check they're still with you: 'Thank you for holding, are you still there?'
holdTime,On an outage call, have the outage details up before you answer, so you never hold to find them.
holdTime,On a move in or move out, gather the date, the address and the contact info before you start the order, so you don't hold halfway through.
overallSentiment,Smile while talking. Customers hear it in your voice even on the phone.
overallSentiment,Use the customer's name at least twice, at the start and at the end.
overallSentiment,Match the customer's energy level, if they're calm be calm. If concerned show empathy.
overallSentiment,Lead with empathy by naming the specific thing. Not 'I understand' but 'I hear you on that double charge, let's get it fixed.' Generic empathy sounds scripted.
overallSentiment,Sound genuinely interested, not robotic. Vary your tone.
overallSentiment,If they say the bill is confusing, say 'Let's make sure this bill makes sense before we hang up.'
overallSentiment,End on a positive note even when you couldn't do everything: 'I was glad to help with the payment today. Enjoy the rest of your day.'
overallSentiment,Acknowledge their effort: 'I appreciate you calling in about this instead of letting it slide'.
overallSentiment,Don't go quiet. If you're thinking say 'Let me think about the best way to help you here'.
overallSentiment,If the call ran long, say 'Thank you for being so patient with me.'
overallSentiment,Greet the customer with genuine energy. Your first 5 seconds set the tone.
overallSentiment,Mirror it back: 'I can hear how much this has worn on you, and I'm here to help.'
overallSentiment,Use open-ended acknowledgment like 'Tell me more about that'.
overallSentiment,Don't interrupt, even if you know the answer. Let them finish.
overallSentiment,Ask 'What can I do for you to make this right?' on escalated calls. It gives them a say.
overallSentiment,Thank them for being a customer. Specific if you can.
overallSentiment,If the customer shares something personal, acknowledge it briefly before moving on.
overallSentiment,Laugh when they joke. Don't stay corporate-robot in casual moments.
overallSentiment,End calls with warmth: 'Have a wonderful day' or 'Enjoy the rest of your day' beats 'Have a good day'.
overallSentiment,Be conversational. 'Yeah absolutely' sounds human, not robotic.
overallSentiment,Use inclusive 'we' language instead of 'you'. Feels like teamwork.
overallSentiment,If they're worried about money, don't sound casual about the amount.
overallSentiment,Slow down for the numbers, speed up for the small talk.
overallSentiment,If they've called before, acknowledge it, 'I see you called last week' goes a long way.
overallSentiment,Don't sound like you're reading the account, sound like you understand it.
overallSentiment,Give them a number they won't like, then stop and let them react.
overallSentiment,If they mention a fixed income, that changes how you talk about the amount.
overallSentiment,A customer who feels rushed remembers the rush, not the fix.
overallSentiment,Warmth isn't length, a short call can be a kind one.
overallSentiment,Ask before you explain, some people want the number and nothing else.
overallSentiment,If they apologize for being upset, tell them they're fine.
overallSentiment,Say it the way you'd want it said to you about your own bill.
overallSentiment,If they thank you, take it, don't wave it off with 'just doing my job'.
overallSentiment,Talk about the bill like it's their money, because it is.
overallSentiment,If they mention a hard week, one line of acknowledgment then help.
overallSentiment,End with what happens next, certainty is what people actually want.
overallSentiment,Never say 'Calm down'. It escalates every time. Say 'I'm here to help, let's get this fixed.'
overallSentiment,Replace 'You're wrong' with 'Let me show you what I'm seeing, I'm happy to walk through it.'
overallSentiment,Don't say 'You didn't'. Say 'It looks like this step was missed, let's get it done now.'
overallSentiment,Replace 'You should have' with 'Here's what we can do going forward.'
overallSentiment,Avoid 'actually' as a correction. It puts them on the defensive. Say 'Here's what I'm seeing' instead.
overallSentiment,Drop the word 'just'. 'Just click there' makes light of what the customer is going through.
overallSentiment,Never say 'no one else has complained'. It tells them their problem doesn't count. Say 'Let's make sure we get to the bottom of this.'
overallSentiment,Never say 'you signed up for that', explain what they signed up for.
overallSentiment,Don't say 'everyone's bill went up', talk about theirs.
overallSentiment,Don't say 'it's only', nothing is only to the person paying it.
overallSentiment,Skip 'obviously' and 'clearly', both tell them they should have known.
overallSentiment,Avoid 'that's just how the billing works', give them the actual reason.
positiveWord,Say 'No problem at all' when they thank you or apologize for asking. It tells them they're no trouble.
positiveWord,Say 'I'd be happy to help you with that' as soon as they tell you why they called.
positiveWord,Use 'absolutely' instead of 'yes'. It's more enthusiastic.
positiveWord,Say 'Let me see what I can do' instead of 'I don't have that information'.
positiveWord,Replace 'You need to' with 'I can work with you on that'. It sounds less demanding.
positiveWord,Say 'Here's what we can do' instead of 'I can't'. Lead with what you can do.
positiveWord,Say 'Let's get that fixed for you' instead of 'Let me fix that problem'.
positiveWord,After you explain the bill, ask 'Have I answered your questions?' It catches confusion before they hang up.
positiveWord,'Let's make sure everything is set before we hang up' gives the call a clear finish.
positiveWord,Say 'My pleasure' instead of 'You're welcome' at the close.
positiveWord,'You got it' beats 'okay' when they ask for something simple.
positiveWord,When you can do it, say 'I can definitely do that for you' instead of 'I'll try'.
positiveWord,'I'm here to help you sort this out' tells them you're on their side before you get into the account.
positiveWord,Say 'I'll take care of this for you' instead of 'I can put in a request'.
positiveWord,When they sound anxious about the bill, say 'Don't worry, I'll walk you through it'.
positiveWord,When they're hunting for an account number, say 'Take your time' instead of waiting in silence.
positiveWord,Say 'I can help with that' before you start asking questions, so they know they're in the right place.
positiveWord,Once it's done, say 'I took care of that for you' so they know it's finished.
positiveWord,Repeated 'great' sounds fake. Mix in 'perfectly', 'certainly' and 'you bet'.
positiveWord,Avoid 'obviously'. Customers don't like feeling talked down to. 'Of course' is the warmer way to agree.
positiveWord,Ask 'What can I help you with today?' rather than 'What's going on?'
positiveWord,Make them a partner with 'Let's get' or 'Let's make sure': 'Let's get this figured out together.'
positiveWord,Open with 'How can I help you today?' and let them talk.
positiveWord,Use 'of course' instead of 'sure'. Sounds more professional and warm.
positiveWord,Start your greeting with positive words: 'Thank you for being a part of APS, my name is [your name], how may I help you today?' Then, once they tell you why they called, answer with 'Absolutely, I can definitely help with that.'
positiveWord,End with 'Enjoy the rest of your day'. The close is one of the easiest places to add positive words.
positiveWord,'Let's get that set up for you' beats 'you'll need to set that up'.
positiveWord,When there's good news, call it good news. A new home or a paid-off balance earns a 'Congratulations'.
positiveWord,Before you close, ask 'Do you have any other questions or concerns?'
positiveWord,'Let me see what we can do' works for anything you can start during the call.
positiveWord,'That's all taken care of' beats 'I have gone ahead and processed that'.
positiveWord,'You're all set, have a wonderful day' is worth saying out loud at the end. 'Have a lovely day' works too.
positiveWord,'Happy to look' beats 'let me check'.
positiveWord,Don't skip 'Is there anything else I can help you with?' even on a quick call.
positiveWord,Put 'for you' on the end of what you do: 'I can do that for you right now'.
positiveWord,'We appreciate your business' is a good close when they've been a customer a long time.
positiveWord,If they've waited or repeated themselves, 'Thank you for being so patient' lands better than 'sorry for the wait'.
positiveWord,'Let's get this taken care of together' invites them in, and 'Let's make sure we get this right' keeps them with you.
positiveWord,If they're moving or closing the account, end with 'I wish you all the best'.
positiveWord,On a close, 'Thank you for being an APS customer' is worth the extra second.
positiveWord,'Glad to help' and 'Happy to assist' are easy to say at the close, and both land warmly.
positiveWord,Ask 'Is there anything else I can do for you?' before you close, then wait for the answer.
positiveWord,'It was a pleasure helping you' is a warm last line, especially after a long call.
negativeWord,Replace 'unfortunately' with 'what I can do is...' to focus on solutions.
negativeWord,'Yes, but' cancels the yes. Say 'Yes, and here's how it works'.
negativeWord,Don't say 'That's not my problem'. Say 'Let me see what I can do,' then do it.
negativeWord,Avoid 'our policy doesn't allow that', say 'Here's what I can offer instead'.
negativeWord,Don't say 'There's no way to do that'. Say 'Let me see what options we have'.
negativeWord,Don't say 'I can't find it'. Say 'Let me look another way'.
negativeWord,'I'm sorry you feel that way' sounds like blame. Say 'I'm sorry this happened, let me help'.
negativeWord,'I'm trying to help you' sounds defensive. 'I'm here to help' says the same thing and sounds like you're on their side.
negativeWord,Drop 'sorry but'. Say sorry and stop, then say what you can do.
negativeWord,Instead of 'I can't tell you that', say 'Here's what I can share'.
negativeWord,Swap 'I can't see that' for 'Here's what I'm seeing'.
negativeWord,'I'm unable to help with that' ends the conversation. Say 'Here's what I can do' and name one thing.
negativeWord,Avoid 'there are no notes on this'. Say what you can see and what you're doing next.
negativeWord,Avoid 'like I said' and 'as I said before'. Repeating info isn't the customer's fault.
negativeWord,Instead of 'I can't do that', start with 'Here's what I can do.'
negativeWord,Replace 'We can't provide that' with 'Here's what I can get you'.
negativeWord,Instead of 'I don't see any notes', say what you do see: 'Here's what's on the account'.
negativeWord,Instead of 'There was an error', say 'Here's what happened and here's the fix'.
negativeWord,Instead of 'I can't give you a credit', say 'Here's what I can do for you'.
negativeWord,'We can't' sounds final. Lead with what we can do instead.
negativeWord,'I'm not sure' makes them doubt everything after it. Say 'Let me check on that for you'.
negativeWord,Don't send them off with 'You need to go online for that'. Walk them through it while you have them.
negativeWord,Skip 'don't do that' when they explain what they tried. Say 'Next time, this way is quicker'.
negativeWord,'There's nothing we can do' is never the whole answer. Name one thing you can do.
negativeWord,'We don't have a record of that' sounds like a dead end. Say 'I'm not finding it yet, let me check one more place'.
negativeWord,'I understand, but' tells them you're about to disagree. Try 'I understand, and here's what I can do'.
negativeWord,On a high bill call, skip 'there's no way that's right', even to agree. Say 'Let's get to the bottom of it.'
negativeWord,On a disconnect call, skip 'we can't stop it'. Tell them what you can do today.
negativeWord,'I'm not sure when that posts' sounds like a guess. Check when it posted, then tell them what you found.
negativeWord,On a deposit or a fee, 'our policy' sounds like a wall. Give the reason in plain words instead.
negativeWord,'I can't find your payment' scares people. Say 'Let me check where that payment went.'
negativeWord,On an outage call, skip 'I can't tell you when it'll be back'. Tell them what you can see right now.
negativeWord,'We don't have that option' closes the door. Say 'Here are the options that fit you.'
negativeWord,'I can't give you more time' ends the talk. Say 'Here's the arrangement I can set up today.'
negativeWord,Skip 'unfortunately' before a balance. Say the balance plainly, then the options.
negativeWord,On a repeat caller, skip 'there are no notes from your last call'. Ask what they were told and take it from there.
negativeWord,If a payment is missing, don't stop at 'there was an error'. Say where the payment is now and what you're doing about it.
negativeWord,'I can't see why it's high' sounds like you gave up. Say 'Here's what I'm seeing on this bill.'
negativeWord,'I'm unable to help with the bill amount' isn't the whole answer. Name what you can do: an arrangement, budget billing or a referral.
negativeWord,'I understand, but the bill is correct' sounds like a brush off. Say 'I understand, and here's what makes up this bill.'
negativeWord,'I can't do anything about the rate' stops the conversation. Say what they can change: when they use power or which plan fits.
managingEmotions,Lower your voice slightly when the customer raises theirs. It brings the temperature down.
managingEmotions,Stay solution-focused: 'I hear you, let me see what I can do to help'.
managingEmotions,Acknowledge it in your own words: 'That sounds like a rough week. I'll take care of this for you.'
managingEmotions,After a hard call, take one slow breath before you answer the next one, and save the longer reset for your break.
managingEmotions,If the customer is yelling, let them vent for 20 to 30 seconds, then redirect calmly.
managingEmotions,Use 'we' language: 'Let's figure this out together', creates partnership feeling.
managingEmotions,If you're getting triggered, take a slow breath while the customer is still talking, don't add a hold to manage your own emotions.
managingEmotions,After difficult calls, stand up and move. Resets your nervous system.
managingEmotions,Keep water at your desk. A sip creates a 3-second pause to regroup.
managingEmotions,Develop a mental mantra: 'This is their bad day not mine'.
managingEmotions,Don't check email or texts between calls on tough shifts. Stay present.
managingEmotions,Write down what went well each day. Combats the negativity bias.
managingEmotions,Pair up with a peer for venting sessions during breaks not during calls.
managingEmotions,Remind yourself you chose to be here today. It puts you back in the driver's seat instead of feeling like the shift is happening to you.
managingEmotions,If a customer is abusive you don't have to take it, follow the steps for ending the call and tell your supe.
managingEmotions,After swearing or yelling calls, talk to your supe for a reset. Don't absorb it.
managingEmotions,Practice 'name it to tame it'. Notice 'I'm feeling frustrated' and intensity drops.
managingEmotions,Use posture. Sit up straight. Body language affects voice tone.
managingEmotions,If a call gets personal, redirect: 'Let's focus on the solution to X'.
managingEmotions,Have a finish-strong ritual for the last hour of shift. The tiredness is real.
managingEmotions,A high bill brings real fear, that's what you're hearing, not anger at you.
managingEmotions,If they're scared of a shut off, tell them what will actually happen, facts calm people.
managingEmotions,Don't match their volume, match their urgency.
managingEmotions,Your voice is the only thing they have, keep it steady even when theirs isn't.
managingEmotions,If your heart rate is up, slow the sentence down and the rest follows.
managingEmotions,It isn't personal even when the words are personal.
managingEmotions,Say the hard part plainly, talking around it makes people more anxious.
managingEmotions,Don't carry the last call into this one, this customer didn't do it.
managingEmotions,When someone cries, quiet is fine, then one steady sentence.
managingEmotions,If you notice you're arguing, you've stopped helping, reset.
managingEmotions,Keep one good call a week in your head for the days you need it.
managingEmotions,If a shift breaks you a little, tell your supe before it ends, not next week.
managingEmotions,You can't fix someone's money, you can be the calm part of their day.
managingEmotions,If the same call type gets you every time, say that out loud to someone.
managingEmotions,Panic and anger sound alike on the phone, treat the panic first.
managingEmotions,Say 'concern' instead of 'complaint'. 'Complaint' flags the call as emotional even when you're the one saying it.
managingEmotions,Show empathy with 'I'm so sorry that happened'. 'I can't believe that happened' and 'that's horrible' flag the call as emotional, even from you.
managingEmotions,Own a mistake with 'That's on us, let me fix it'. 'That was our fault' flags the call as emotional.
managingEmotions,Never say 'It's not my fault', even to agree with them. It flags the call as emotional and sounds like blame.
managingEmotions,Don't call it 'ridiculous', even to agree with them. It flags the call from your side too. Say 'I see why that caught you off guard.'
managingEmotions,'I cannot believe that happened' flags the call the same as 'can't'. Say 'Let's get this fixed for you.'
managingEmotions,Don't echo 'totally unacceptable' back, even to agree. Say 'You're right to call about this, let's make it right.'
managingEmotions,'I can tell you're very unhappy' repeats a phrase that flags the call. Say 'I hear you, and I want to get this right.'
managingEmotions,Don't say 'that's not good enough' about APS, even when you agree. It flags the call. Say 'You deserve a clear answer, here's what I can do.'
managingEmotions,Keep 'stupid' and 'stupidity' off your side of the call, even about a rule or the system. Both flag the call. Say 'That part is confusing, let me explain it.'
managingEmotions,Don't ask 'Are you threatening me?' The word flags the call from your side too. Follow the steps for ending the call and tell your supervisor.
managingEmotions,If they call APS a monopoly, don't repeat the word back, it flags the call. Say 'I hear you, let's look at what I can do on this bill.'
managingEmotions,Don't say they got 'screwed', even to take their side. It flags the call. Say 'I see why that felt unfair. Let me see what I can do.'
managingEmotions,Never say 'you people', even about a group like solar customers. It flags the call from your side too. Say 'customers on solar' instead.
managingEmotions,'I'm not angry' still flags the call. If they ask whether you're upset with them, say 'Not at all, I'm here to help.'
reliability,If time off is listed as Same Day use PTOST, you're given 40 hours of PTOST so use them.
reliability,Alert your supervisor if you see any discrepancies in your reliability hours. They can investigate and get corrections made.
reliability,If you have FMLA paperwork submit it proactively, don't wait for a covered absence.
reliability,Track your own PTOST balance. Don't assume the system tracks perfectly.
reliability,Use scheduled PTO for appointments when possible. Planned beats unplanned.
reliability,If you're sick more than 2 consecutive days, check with HR about short-term leave.
reliability,Write down the time and what happened during any system outage, and report it the same day.
reliability,Know the difference between excused and occurrence absences in your policy.
reliability,If transportation is an ongoing issue, talk to your supe about flex scheduling.
reliability,Bundle medical appointments into single days when possible.
reliability,Check your time entries after every pay period, so a coding mistake gets caught while it's easy to fix.
reliability,Flag a coding error as soon as you spot it. The longer it sits the harder it is to correct.
reliability,Sign up for weather alerts. Plan for storms before they become day-of scramble.
reliability,Review the attendance policy once a year. Rules change.
reliability,If you need an accommodation, request it formally not informally.
reliability,Keep a personal attendance journal. Notice your own patterns.
reliability,Put time off in as early as you can, planned time protects your number.
reliability,If you know at 4am you can't make it, report it then, the way the call out process says, not at start time.
reliability,Learn what counts and what doesn't before you need to know.
reliability,If you can make part of a shift, tell your supervisor what you can do.
reliability,Look at your own hours monthly, don't wait for a review to see them.
reliability,Keep the confirmation for anything you submit.
reliability,If you're out several days, start the paperwork on day one.
reliability,Learn the difference between PTO and PTOST before the morning you need it.
reliability,If a shift is consistently hard to make, talk to your supe about the shift itself.
reliability,One planned day off beats three unplanned hours.
reliability,Don't assume a schedule change went through, go look.
reliability,If you're close to a threshold, you should be the first to know that.
reliability,Know who to tell and how before the morning you need to call out.
reliability,Keep your supervisor's contact info where you can find it at 5am.
reliability,If something at home is making shifts hard to make, talk to your supervisor early so we can talk through next steps.
reliability,Know your PTO balance before you plan a trip, not after.
reliability,If you leave early for any reason, make sure it's coded the way it really happened.
cxRepOverall,Listen for the real issue behind the question. Sometimes a billing question is really a need for a payment arrangement.
cxRepOverall,End every call with specific next steps. Don't leave the customer wondering what happens next.
cxRepOverall,Take ownership of the customer's issue, don't pass the buck.
cxRepOverall,Be proactive. If you spot a problem on the account, tell them and fix it before they have to ask.
cxRepOverall,Make the customer feel heard. Repeat back their concern to show you listened.
cxRepOverall,Go one step further. If they ask about the bill, also mention the next due date.
cxRepOverall,Show you care about resolution not just call completion.
cxRepOverall,Use their communication style. If they're chatty engage, if they're rushed be efficient.
cxRepOverall,End with confidence: 'You're all set. Is there anything else I can help you with today?'
cxRepOverall,Treat every call like it's your only call, rushed customers feel it.
cxRepOverall,Only promise what you can finish on the call, then finish it while they're still on the line.
cxRepOverall,Use the customer's preferred name, ask 'Is it Mike or Michael?' early.
cxRepOverall,Show expertise: 'Here's what usually works in situations like yours'.
cxRepOverall,When giving bad news, lead with what you can do.
cxRepOverall,Give the reference or confirmation number whenever there is one. Customers feel more secure with something to hold on to.
cxRepOverall,Check that the contact info on the account is current before you hang up.
cxRepOverall,Mention a program only when it genuinely fits. Budget billing for someone fighting big swings. Never as a script.
cxRepOverall,If the call turns up an unrelated issue, take care of it now instead of leaving them to call back.
cxRepOverall,If you're stumped, acknowledge it: 'Great question. Let me find the right answer'.
cxRepOverall,Thank customers for their patience specifically, not generically.
cxRepOverall,If the customer seems rushed, give them the short version: what you did and what happens next.
cxRepOverall,Use the one-more-thing close: 'Before we wrap, anything else on your mind?'
cxRepOverall,Don't read scripts robotically. Internalize them then speak naturally.
cxRepOverall,They rate the whole experience, not just the fix, and that includes how sure you sounded.
cxRepOverall,Say what you're doing before you go quiet.
cxRepOverall,Give them one thing to remember, the date, the amount, or the next step.
cxRepOverall,If you can't give them what they want, give them the clearest no you can with an option next to it.
cxRepOverall,Check it landed by asking what they'll see on the next bill, then ask 'Do you have any other questions or concerns?'
cxRepOverall,Use their words for their problem, not the internal name for it.
cxRepOverall,If the bill is the problem, don't just explain it, tell them what could change it.
cxRepOverall,Confirm the phone number and email so outage alerts actually reach them.
cxRepOverall,If they mention they're moving, handle it now instead of next call.
cxRepOverall,When they're right, say so plainly.
cxRepOverall,Offer the option that fits them, not the one that's quickest to set up.
cxRepOverall,Tell them what will arrive in writing and when.
cxRepOverall,Close the loop out loud, here's what we did and here's what happens next.
cxRepOverall,If they sound unsure at the end, they are, ask again.
cxRepOverall,A customer who understands the bill doesn't have to like it to rate you well.
cxRepOverall,Say your name at the end too, ownership is memorable.
cxRepOverall,Don't oversell the fix, say exactly what it does.
cxRepOverall,Ask what would make this easier for them, then do that if you can.
cxRepOverall,Verify the APS way: the caller's name plus the last four of the social, a driver's license or the password on the account. If the call came in authorized, the name is enough.
cxRepOverall,Verify before you share anything on the account, even the balance. A date of birth or a security question doesn't count. Ask for the last four of the social, a driver's license or the account password.
cxRepOverall,If someone is calling for the account holder, check they're authorized on the account before you share anything.
cxRepOverall,If they mention a downed line, sparks or smoke, it's a safety call. Follow the emergency steps right away, before anything else.
overallExperience,Open with 'I'd be happy to help you with that,' then verify. It sets a welcoming tone from the first line.
overallExperience,Don't leave them in silence. If you're looking something up, say so: 'I'm pulling up your account now' or 'Let me check the latest notes here.'
overallExperience,On a high bill call, walk them through the usage, not just the total. Seeing where it went makes a high bill feel fair.
overallExperience,If they're worried about a disconnect, tell them plainly what will and won't happen, and when. Certainty is what makes the call feel good.
overallExperience,Before you set up a payment arrangement, ask what they can really pay. An arrangement they can keep feels better than one they can't.
overallExperience,If there's something they can set up so this doesn't happen again, like autopay, offer to walk them through it now.
overallExperience,End on what you did for them, not on the policy: 'You're all set, the payment is posted and your next bill will show it.'
overallExperience,When they're upset with APS, not with you, let them say it. Then show them what you can change today.
overallExperience,If they ask why rates went up, don't argue the decision. Explain what it means for their bill and what they can do about it.
overallExperience,On a rate plan question, look at how they actually use power before you suggest anything. A plan that fits their day feels like help, not a sales pitch.
overallExperience,Solar customers usually call because the bill isn't what they expected. Find the line that surprised them and start there.
overallExperience,Don't rush a solar customer. They made a big investment and want to understand it, so walk the bill with them.
overallExperience,If they got a call demanding payment by gift card to stop a shut off, check the real balance with them on this call. Seeing what they really owe ends the panic.
overallExperience,On a scam call, thank them for checking with us first. It was the right move, and saying so leaves them feeling smart, not fooled.
overallExperience,If they're unsure a call was really from APS, tell them they can always hang up and call the number on their bill.
overallExperience,When the power is off for nonpayment, start with what gets it back on, not with what went wrong.
overallExperience,On a deposit, explain why it's there and what gets it back, in plain words. A deposit with a reason feels fair, one without feels like a penalty.
overallExperience,On an outage call, ask if they've signed up for outage alerts. Next time they'll know before they have to call.
overallExperience,If they waited a long time to reach you, acknowledge the wait before anything else. It resets the call.
overallExperience,If the bill is high and money is tight, mention assistance before they have to ask. Offering help first changes how the whole call feels.
overallExperience,On a budget billing question, explain how it works on their account before they sign up, including what happens if their usage changes.
overallExperience,When someone is starting service, welcome them to APS. The first call sets what they expect from us.
overallExperience,On a move out, ask if they're staying in the area. If they are, set up service at the new place on the same call.
overallExperience,On a move in, congratulate them on the new place. It's a big day, and the call can feel like part of it.
overallExperience,If they've been with APS for years, notice it out loud. Long time customers want to feel known.
overallExperience,When a big bill is coming, help them plan before it arrives. Talking about next month early feels like looking out for them.
overallExperience,On a start service call, read the start date back and tell them what to expect on the first bill.
overallExperience,On a high bill call, compare it to the same month last year, not just last month. It's the fairer comparison, and they'll feel the difference.
overallExperience,On an outage call, ask if they're safe and comfortable before anything else, especially in the summer heat.
overallExperience,Don't sound rushed even when the queue is long. They can't see the queue, they only hear you.
overallExperience,If they're new to Arizona, give them a heads up about summer bills and mention budget billing if it fits. Knowing ahead turns a shock into a plan.
overallExperience,On a fee they didn't expect, explain what it's for in plain words first. People take a fee better once it makes sense.
overallExperience,When the bill is right but still high, say so kindly, then help them with the next one. Honest and helpful is what they rate.
overallExperience,If the automated line wore them out, say 'Thank you for being so patient, I've got it from here.'
overallExperience,Treat every question like it matters, even when you've answered it fifty times today. It's their first time asking.
overallExperience,If they're calling about a disconnect notice, explain the notice before the numbers. A notice they understand is less scary.
overallExperience,If they can't pay it all, talk about this month first, then next month. Two steps feel doable, one big number doesn't.
overallExperience,If they mention they work nights or odd hours, keep that in mind when you talk about plans or due dates.
overallExperience,Ask what matters most to them: 'Is it the amount or the due date that's hardest?' Then solve that one first.
overallExperience,Be honest about why the bill changed. If it's the rate, say it's the rate. If it's usage, say it's usage.`;

/*
 * Edits and deletions of the built-in tips.
 *
 * Both are keyed by the tip's own text as the CSV ships it, normalized, so a
 * saved change follows its tip when the CSV is reordered or grows. They used
 * to be keyed by the tip's position inside its metric, and any tip added or
 * removed above one re-pointed the change at a different tip.
 *
 *   modifiedServerTips  { metricKey: { "<tip key>": "edited text" } }
 *   deletedServerTips   { metricKey: ["<tip key>", ...] }
 *
 * A key that is only digits is an old position. A position no longer says
 * which tip it meant, so it is left in the store untouched but not applied to
 * whatever tip sits there now. (The real backup held none when this changed.)
 *
 * They are applied in exactly one place, buildServerTips. They used to be
 * applied when the pool loaded and again, by position, every time a tip was
 * read, so deleting one tip removed two.
 */
function tipEditKey(text) {
    return String(text == null ? '' : text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function isOldPositionKey(key) {
    return /^\d+$/.test(String(key));
}

let parsedEmbeddedTips = null;

/** The CSV as shipped: { metricKey: [tip, ...] } in file order. Parsed once. */
function parseEmbeddedTips() {
    if (parsedEmbeddedTips) return parsedEmbeddedTips;
    const byMetric = {};
    EMBEDDED_TIPS_CSV.split('\n').map(line => line.trim()).filter(line => line).slice(1).forEach((line) => {
        const match = line.match(/^([^,]+),"?([^"]*)"?$/);
        if (!match) return;
        const metric = match[1].trim();
        if (!byMetric[metric]) byMetric[metric] = [];
        byMetric[metric].push(match[2].trim());
    });
    parsedEmbeddedTips = byMetric;
    return byMetric;
}

/**
 * A tip store as an independent copy, or the fallback when it is missing or
 * unreadable. These live in IndexedDB, so they are read through the storage
 * module and never from localStorage, which only ever held a stale copy.
 * A copy, because in IndexedDB mode readStore hands back the live cache.
 */
function readTipStore(key, fallback) {
    try {
        const value = window.DevCoachModules?.storage?.readStore?.(key);
        if (value && typeof value === 'object') return JSON.parse(JSON.stringify(value));
    } catch (e) {
        console.warn('[tips] ' + key + ' is unreadable, treating it as empty:', e.message);
    }
    return fallback;
}

/**
 * The built-in pool with Scott's edits and deletions applied, once.
 * `simple` is { metricKey: [tip] }; `withIndex` adds each tip's position in
 * the shipped CSV, which is what the tips manager's buttons carry.
 */
function buildServerTips() {
    const shipped = parseEmbeddedTips();
    const edits = readTipStore('modifiedServerTips', {});
    const deletions = readTipStore('deletedServerTips', {});
    const simple = {};
    const withIndex = {};

    Object.keys(shipped).forEach((metricKey) => {
        const metricEdits = edits[metricKey] && typeof edits[metricKey] === 'object' && !Array.isArray(edits[metricKey])
            ? edits[metricKey] : {};
        const deleted = new Set((Array.isArray(deletions[metricKey]) ? deletions[metricKey] : [])
            .filter(key => !isOldPositionKey(key))
            .map(String));

        withIndex[metricKey] = [];
        shipped[metricKey].forEach((original, originalIndex) => {
            const key = tipEditKey(original);
            if (deleted.has(key)) return;
            const edited = Object.prototype.hasOwnProperty.call(metricEdits, key) ? metricEdits[key] : null;
            const tip = typeof edited === 'string' && edited.trim() ? edited : original;
            withIndex[metricKey].push({ tip, originalIndex, key });
        });
        simple[metricKey] = withIndex[metricKey].map(item => item.tip);
    });

    return { simple, withIndex };
}

/** Saves the edited pool for the readers that take it from the store. */
function saveBuiltPool() {
    const built = buildServerTips();
    if (Object.keys(built.simple).length > 0) {
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('metricCoachingTips', built.simple);
    }
    return built;
}

async function loadServerTips() {
    try {
        const built = buildServerTips();
        window._serverTipsWithIndex = built.withIndex;
        return built.simple;
    } catch (error) {
        console.error('Error loading tips:', error);
        window._serverTipsWithIndex = {};
        return {};
    }
}

function loadUserTips() {
    try {
        const saved = (function(){var v=window.DevCoachModules?.storage?.readStore?.('userCustomTips');return v===undefined||v===null?null:JSON.stringify(v);})();
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

// Tips typed in the app go into associate messages as written, so the dash
// rule applies to them too: an em or en dash, or a hyphen with spaces round
// it, becomes a comma. Applied on save, so what is stored is what is sent.
function stripDashesFromTip(value) {
    if (typeof value === 'string') {
        return value.replace(/\s*[\u2014\u2013]\s*/g, ', ').replace(/ - /g, ', ');
    }
    if (Array.isArray(value)) return value.map(stripDashesFromTip);
    if (value && typeof value === 'object') {
        const out = {};
        Object.keys(value).forEach((key) => { out[key] = stripDashesFromTip(value[key]); });
        return out;
    }
    return value;
}

function saveUserTips(tips) {
    try {
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('userCustomTips', stripDashesFromTip(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
    }
}

function loadCustomMetrics() {
    try {
        const saved = (function(){var v=window.DevCoachModules?.storage?.readStore?.('customMetrics');return v===undefined||v===null?null:JSON.stringify(v);})();
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading custom metrics:', error);
        return {};
    }
}

function saveCustomMetrics(metrics) {
    try {
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('customMetrics', metrics);
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

    html += '<div id="manageCategorySection" class="card" style="margin-bottom: 25px; padding: 20px;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<label for="categoriesSelector" class="text-primary" style="font-weight: bold; font-size: 1.1em; margin: 0;">Select Tip Category:</label>';
    html += '<button id="newMetricBtn" class="btn-secondary" style="padding: 10px 16px; font-weight: bold; font-size: 0.95em;">+ New Category</button>';
    html += '</div>';
    html += '<select id="categoriesSelector" style="width: 100%; padding: 12px; font-size: 1em; cursor: pointer;">';
    html += '<option value="">-- Choose a category --</option>';
    sortedCategories.forEach(metricKey => {
        html += `<option value="${escapeHtml(metricKey)}">${escapeHtml(metricNames[metricKey])}</option>`;
    });
    html += '</select>';
    html += '</div>';

    html += '<div id="createMetricSection" class="card" style="display: none; margin-bottom: 25px; padding: 20px;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<h3 class="card-title" style="margin: 0;">Create New Category</h3>';
    html += '<button id="backToManageBtn" class="btn-ghost" style="padding: 8px 16px; font-weight: bold; font-size: 0.95em;">Back</button>';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricName" style="font-weight: bold; display: block; margin-bottom: 5px;">Category Name:</label>';
    html += '<input type="text" id="newMetricName" placeholder="e.g., Accuracy, Compliance, Efficiency" style="width: 100%; padding: 10px; font-size: 0.95em; box-sizing: border-box;">';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricTip" style="font-weight: bold; display: block; margin-bottom: 5px;">First Tip:</label>';
    html += '<textarea id="newMetricTip" placeholder="Enter a coaching tip for this new category..." style="width: 100%; padding: 10px; font-size: 0.95em; resize: vertical; box-sizing: border-box;" rows="2"></textarea>';
    html += '</div>';
    html += '<button id="createMetricBtn" class="btn-primary" style="padding: 10px 20px; font-weight: bold;">Create Category</button>';
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

        let tipsHtml = `<div style="padding: 20px; background: var(--bg-surface-raised); border-radius: 8px;">`;
        tipsHtml += `<h3 class="card-title" style="margin-top: 0; border-bottom: 1px solid var(--border); padding-bottom: 10px;">${escapeHtml(displayMetricName)}</h3>`;
        tipsHtml += '<div style="margin: 20px 0;"><h4 class="text-secondary" style="margin-bottom: 12px;">Tips</h4>';

        if (serverTipsWithIndex.length > 0) {
            serverTipsWithIndex.forEach((tipObj) => {
                if (!tipObj || typeof tipObj.originalIndex === 'undefined') {
                    return;
                }
                const tip = tipObj.tip;
                const originalIndex = tipObj.originalIndex;
                tipsHtml += `
                    <div class="card-sunken" style="margin-bottom: 12px; padding: 15px;">
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 130px; align-items: start; gap: 12px;">
                            <textarea id="editServerTip_${metricKey}_${originalIndex}" style="width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; font-size: 0.95em; resize: vertical; min-height: 60px;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px; width: 130px;">
                                <button class="updateServerTipBtn btn-secondary" data-metric="${metricKey}" data-index="${originalIndex}" style="padding: 8px 12px; white-space: nowrap;">Save</button>
                                <button class="deleteServerTipBtn btn-danger" data-metric="${metricKey}" data-index="${originalIndex}" style="padding: 8px 12px; white-space: nowrap;">Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (userTipsForMetric.length > 0) {
            userTipsForMetric.forEach((tip, index) => {
                tipsHtml += `
                    <div class="card-sunken" style="margin-bottom: 12px; padding: 15px;">
                        <div style="display: grid; grid-template-columns: minmax(0, 1fr) 130px; align-items: start; gap: 12px;">
                            <textarea id="editTip_${metricKey}_${index}" style="width: 100%; min-width: 0; box-sizing: border-box; padding: 8px; font-size: 0.95em; resize: vertical; min-height: 60px;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px; width: 130px;">
                                <button class="updateTipBtn btn-secondary" data-metric="${metricKey}" data-index="${index}" style="padding: 8px 12px; white-space: nowrap;">Save</button>
                                <button class="deleteTipBtn btn-danger" data-metric="${metricKey}" data-index="${index}" style="padding: 8px 12px; white-space: nowrap;">Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }

        if (serverTipsWithIndex.length === 0 && userTipsForMetric.length === 0) {
            tipsHtml += '<div class="callout callout-warn" style="margin: 20px 0; padding: 15px;"><em>No tips found for this metric</em></div>';
        }

        tipsHtml += '</div>';

        tipsHtml += `
            <div class="card" style="margin-top: 15px; padding: 15px;">
                <textarea id="newTip_${metricKey}" placeholder="Enter a new custom coaching tip for ${displayMetricName}..." style="width: 100%; padding: 12px; font-size: 0.95em; resize: vertical; margin-bottom: 10px;" rows="3"></textarea>
                <button class="addTipBtn btn-primary" data-metric="${metricKey}" style="padding: 10px 20px; font-size: 1em; font-weight: bold;">Add Tip</button>
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
        showToast('⚠️ Could not update tip. Please refresh the page.');
    }
};

window.updateServerTip = async function(metricKey, index) {
    const textarea = document.getElementById(`editServerTip_${metricKey}_${index}`);
    if (!textarea) {
        console.error('Textarea not found for server tip edit operation');
        showToast('⚠️ Could not update tip. Please refresh the page.');
        return;
    }

    const updatedTip = textarea.value.trim();

    if (!updatedTip) {
        alert('⚠️ Tip cannot be empty');
        return;
    }

    // The button carries the tip's position in the shipped CSV; the change is
    // saved under the tip's own text, which survives a reordered CSV.
    const original = (parseEmbeddedTips()[metricKey] || [])[parseInt(index, 10)];
    if (typeof original !== 'string') {
        console.error('Invalid index for server tip update:', index);
        showToast('⚠️ Could not update tip: that tip was not found.');
        return;
    }

    const modifiedServerTips = readTipStore('modifiedServerTips', {});
    const current = modifiedServerTips[metricKey];
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        modifiedServerTips[metricKey] = {};
    }

    const key = tipEditKey(original);
    const cleaned = stripDashesFromTip(updatedTip);
    if (cleaned === original) {
        delete modifiedServerTips[metricKey][key];
    } else {
        modifiedServerTips[metricKey][key] = cleaned;
    }
    window.DevCoachModules?.storage?.saveWithSizeCheck?.('modifiedServerTips', modifiedServerTips);
    saveBuiltPool();

    showToast('✅ Server tip updated!');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.deleteServerTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this server tip? This will hide it from the list.')) {
        return;
    }

    const original = (parseEmbeddedTips()[metricKey] || [])[parseInt(index, 10)];
    if (typeof original !== 'string') {
        console.error('Invalid index for server tip delete:', index);
        showToast('⚠️ Could not delete tip. Please refresh the page.');
        return;
    }

    const deletedServerTips = readTipStore('deletedServerTips', {});
    if (!Array.isArray(deletedServerTips[metricKey])) {
        deletedServerTips[metricKey] = [];
    }

    const key = tipEditKey(original);
    if (!deletedServerTips[metricKey].includes(key)) {
        deletedServerTips[metricKey].push(key);
    }

    window.DevCoachModules?.storage?.saveWithSizeCheck?.('deletedServerTips', deletedServerTips);
    saveBuiltPool();

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
            showToast('⚠️ Could not delete tip. Please refresh the page.');
            return;
        }

        userTips[metricKey].splice(index, 1);
        if (userTips[metricKey].length === 0) {
            delete userTips[metricKey];
        }
        saveUserTips(userTips);

        showToast('🗑️ Tip deleted');
    } else {
        showToast('⚠️ Could not delete tip. Please refresh the page.');
        return;
    }

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

// -----------------------------------------------------------------------------
// UTILITY FEATURE - MANAGE TIPS - DO NOT DELETE
// -----------------------------------------------------------------------------


function initializeDefaultTips() {
    // Always refresh metricCoachingTips from the embedded CSV so edits
    // to the tip library propagate to callers that read the stored copy
    // (the dashboard's tip of the day). buildServerTips layers Scott's edits
    // and deletions on top of the CSV, so the refresh keeps them. User-authored
    // tips live in a separate key (userCustomTips) and are untouched here.
    loadServerTips().then(serverTips => {
        if (Object.keys(serverTips).length > 0) {
            saveBuiltPool();
            return;
        }
        // Loudly, because a silent fallback to a different set of tips is how
        // relevance matching looked broken when it was reading a pool of five
        // stale tips per metric instead of the five hundred in the CSV.
        console.error('[tips] The embedded tip CSV parsed to nothing. Tips will be empty until this is fixed.');
    }).catch((error) => {
        console.error('[tips] Could not load the embedded tip CSV:', error);
    });
}

/**
 * Everything that stores tips is keyed by metric key: the CSV, the server-tip
 * edits and deletions, the user's own tips, and custom metrics. A caller that
 * passes a display label instead used to get an empty list back and no error,
 * which is exactly how coaching emails went a long time with no tips in them.
 * Resolving a label here means the next caller to get it wrong is merely
 * inefficient rather than silently wrong.
 */
function resolveMetricTipKey(metricName) {
    const name = String(metricName == null ? '' : metricName).trim();
    if (!name) return name;
    const registry = window.METRICS_REGISTRY || {};
    if (registry[name]) return name;
    const match = Object.keys(registry).find(function (key) {
        return registry[key] && registry[key].label === name;
    });
    return match || name;
}

function getMetricTips(metricNameOrKey) {
    const metricName = resolveMetricTipKey(metricNameOrKey);
    // Built from the CSV with Scott's edits and deletions applied once, the
    // same list the tips manager shows. It used to read the saved pool, which
    // already had them applied, and then apply them again by position, so one
    // deletion removed two tips. Reading the CSV directly also means an edit
    // shows straight away rather than after the next reload.
    // No second pool to fall back on. There used to be one, a stale five per
    // metric, and because it only appeared when the store was empty or corrupt
    // it made the app quietly serve different advice than the tip library
    // everyone was editing.
    let baseTips = [];
    try {
        baseTips = (buildServerTips().simple[metricName] || []).slice();
    } catch (e) {
        console.error('[tips] Could not build the tip pool:', e.message);
    }

    // Append user custom tips
    const userTips = loadUserTips();
    const userTipsForMetric = userTips[metricName] || [];

    return baseTips.concat(userTipsForMetric);
}
