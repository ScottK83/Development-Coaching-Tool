# Handoff

Last updated 2026-10-21, version 2026.10.21.1, suite at 9189 passing.

## Where things stand
- In progress: restyle to match the Downloader Bot (Scott, 2026-10-21: "Dark only. Sidebar nav."). Done: 1/6 tokens and controls (dark only, bot palette, buttons, inputs, tabs by `.is-active`), 2/6 sidebar (`modules/sidebar.module.js` drives the old hidden nav buttons; page title from the sidebar). Next: 3/6 Today, 4/6 People, 5/6 Center + Upload + Settings sweeps (replace about 2,000 hard-coded colours and 44 gradients with tokens), 6/6 checks and screenshots.
- Scott is working through the Today page's private round on real data and sending notes.
- Latest change: the private standings block names both placings for every metric ("93rd in the Call Center, 11th on our team"), with no "N people ahead of you" counts and no top 15 bar. A last place (Call Center or team) is left off. The team note no longer has a built-in default; nothing is added unless Scott writes and saves one.
- Before that (10/14): every associate message, call or metric, carries real praise. Calls use a praise floor in `call-transcript` (`addFloorPraise`); metric messages use `messageVoice.truePositive`.

## Next
- See TASKS.md.
