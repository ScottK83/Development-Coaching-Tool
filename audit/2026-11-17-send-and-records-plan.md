# Rebuild in Power Apps (plan, 2026-11-17)

Scott asked (2026-11-17):

- Click "Email" and it sends from Outlook. The same for coachings, red flags, Teams messages and Teams channel posts.
- Store what he puts in, in SharePoint lists, so he can look at it again at year end. Saving again overwrites, it does not duplicate.
- Make the year-end review easy to reach and easy to write. Reviews are coming up.

His picks (2026-11-17):

- **Rebuild in Power Apps.** He chose this over keeping the website and adding a flow.
- **Preview, then Send.**
- **The lists are private to him.**
- **Year-end and sending are built together.**

**Status: Phase 1 proposed, waiting for Scott's OK.** This file is in a public repo, so it names no associates, tenant addresses or links.

## The picture

```text
Power App "Development Coaching" (built at home, imported at work as a solution, only Scott uses it)
   |-- SharePoint lists in a private team site (only Scott is a member)
   |-- Office 365 Outlook: emails sent from Scott's own mailbox
   |-- Microsoft Teams: 1:1 chats as Scott, posts in his team channel
   '-- small flows only where a canvas app can't do the job alone (one-time list setup, the Teams 1:1 if needed)
```

All of these are standard connectors. There is no Premium licence, no Dataverse and no Cloudflare in the new app.

## The size, plainly

- The website is 46 modules with over 10,000 checks. A full rebuild is a months-long job, so it is done in phases.
- The website keeps running for whatever hasn't moved yet, and is retired in the last phase.
- Phase 1 is the part needed for reviews.

## Phase 1: reviews, sending and records (built together)

### Screens

1. **Home.** Shows Scott's team, each person's year-end status (Not started, Drafting, Done, Posted) and their last coaching date. It has quick buttons for Send a message, Red flag and Year-end.
2. **Associate: the year at a glance.**
   - Figures by quarter and year to date.
   - Every coaching, call, red flag, QA coaching, follow-up, 1:1, quarterly note and mid-year note, by month, with counts.
3. **Compose and Send.**
   - Pick the associate or associates, or the team channel. Pick a template, or **paste text made in the old tool**.
   - The preview shows To, CC, subject and the message, all editable. **Send now** sends by email, Teams chat or channel post, and files it in the Coaching Log.
   - This means anything the old tool writes can be sent and filed from day one, before its own screen is rebuilt.
4. **Red Flag coaching.** The website's form and email, rebuilt, now saved and filed. Coaching Hub's red flag screen and templates are a head start.
5. **Year-End review**, for one associate:
   - status, the annual APS goals (Met or Not Met, with a note), positives, improvement areas, context, the opening, rating, merit, bonus and verbal summary
   - Copy Copilot prompt and a box to paste the response
   - final notes and the Posted to Success Factors tick

   It saves as he types, to one Reviews row that is overwritten each time. Mid-Year and quarterly notes show beside it, read only.
6. **Import from the old tool.** Paste what the website's new "Copy for the Power App" button copies. It holds Scott's team only and covers:
   - this year's coaching log, calls (summaries, not transcripts), QA and follow-ups, 1:1s
   - quarterly, Mid-Year and Year-End drafts
   - the figures per quarter and year to date

   It can be pasted again any time. Rows are matched by record key and overwritten, never doubled.
7. **Settings.** The signature (flow and connector emails don't get the Outlook signature), the CC mailbox, the team channel, and the team list.

### SharePoint lists

Every list has a hidden **Record key** that decides overwrite versus new row.

| List | One row is | Key example |
|---|---|---|
| Associates | a person on Scott's team (name, preferred name, email, active) | email |
| Coaching Log | one thing sent or logged (kind, how, date, subject, message, metrics, status) | `redflag:<email>:<date>` |
| Reviews | one associate's review for one period (Q1 to Q4, Mid-Year, Year-End) | `yearend:2026:<email>` |
| Figures | one associate's numbers for one period (each KPI, calls, surveys, the as-of date) | `ytd:2026-11-14:<email>` |
| Templates | a message template by kind | kind |
| Settings | one row of settings | (single row) |

### What Phase 1 leaves in the website for now

- Uploads and the maths.
- Today's daily messages (high five round, check-in round, shout-outs, day posts).
- Calls, QA Coaching and PA Down Payment paste reading.
- Rankings, Teams, Pace, Contest, Trends, Team Performance and Attendance.

Their text can still be sent and filed through Compose (paste, then Send).

### The one website change in Phase 1

A "Copy for the Power App" button under Settings > Sync & Backup, in a new module. It puts Scott's team's records and figures on the clipboard as JSON. It writes no file.

## Later phases

- **Phase 2, the daily work:**
  - Paste-in uploads (weekly, year to date, daily) into Figures.
  - Today's messages, with the message rules.
  - QA Coaching and PA Down Payment paste.
  - 1:1s, Quarterly and Mid-Year as full screens.
- **Phase 3, the center pages:** Rankings, Teams, Pace, Contest, Trends, Team Performance, Calls (transcript reading) and Attendance (payroll).
- **Phase 4, retire the website:** move the remaining history out of R2, then lock the site and clear R2 the way Scott chooses.

## Rules carried over

These are the website's associate-facing rules, now written into the app's formulas, with a check script run on the app source before every release:

- praise first, no em or en dashes, at most 2 emojis, and moves in words
- no reliability or hours in focus areas
- a survey metric with no surveys is never 0%
- a 0 second handle time means no calls, not a win
- never a simple average of metrics

## How it gets built

- **Home (Claude, with Scott's Studio tab open):**
  - The app is built in the home environment through the canvas authoring tool. Scott opens the app in Studio with coauthoring on and keeps that tab open, then saves and publishes at the end of the session. A rename in the tree view proves the writes are landing.
  - Lists and flows are made by script in the home sandbox, with made-up people only.
  - The solution is exported under the neutral "APS Tools" publisher.
- **Work (Scott, once per release):**
  1. Create the private team (first time only).
  2. Import the solution and pick the connections.
  3. Press "Set up lists" (first time only).
  4. Paste from the old tool on the Import screen.

## Risks

- **Teams 1:1 as Scott:** this uses Teams' own Graph action (find or open the 1:1 chat, then post). Others have it working, and it is proved at home first. The fallback is sending from the Workflows bot.
- **Power Apps limits:**
  - 2,000 rows per query. That's fine for one team's year.
  - The import paste size. If one paste is too big, it is split per associate.
  - A canvas app can't read an Excel file. That's why data is pasted.
- **Building needs Scott at home with Studio open.** That sets the pace.

## Reference: what the website sends today (inventory, 2026-11-17)

Every one of these needs a home in the new app, in Phase 1 (through Compose) or its own screen later.

| Where | Today | Recipient and channel |
|---|---|---|
| Coach: Outlook email, Send Metrics, Coaching Follow-up | Outlook draft, or a draft plus a picture | associate, CC |
| Calls: Outlook email | Outlook draft | associate, CC |
| Follow Up: follow-up draft, QA Coaching, PA Down Payment | Outlook draft or copy | associate, CC |
| Follow Up: Red Flag Coaching | copy, then a blank email; **not saved anywhere** | associate, CC |
| Reviews: quarterly recap email | Outlook draft | associate, CC |
| Rankings: month and year summaries | Outlook draft and a picture | associate, CC |
| Attendance: corrections email | Outlook draft | WFM |
| Today: day posts, private round, one-person tones, growth check | copy | Teams 1:1 |
| Today: high five round, check-in round | copy (copy = sent) | Teams 1:1 |
| Today: shout-out and beat-a-target posts | copy | team channel |
| Today: Snapshot, Contest graphic | picture copy | team channel |
| Verint and Copilot copies | copy | stay as copy (no way in) |

The website's stores and their keys (for the import button):

- `coachingHistory` (dedupeKey), `callListeningLogs`, `followUpHistory` (QA dedupeKey; follow-ups have none, so the key is built from name and date), `oneOnOneMeetings` (name and date)
- `quarterReviewNotes` and `quarterRecapEmails` (Name|Year|Qn), `midYearMeta` (Name|Year)
- `yearEndDraftEntries` and `yearEndAnnualGoals` (Year::Name), `yearEndOpening` (year)
- `dailyOutreachSent` (plan|week|name)
