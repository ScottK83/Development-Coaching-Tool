# Handoff

Last updated 2026-10-21, version 2026.10.21.8, suite at 9222 passing.

## Where things stand
- Done: restyle to match the Downloader Bot (Scott, 2026-10-21: "Dark only. Sidebar nav."). Dark-only tokens, `modules/sidebar.module.js`, the KIT classes in styles-v2.css, every page swept off hard-coded colours, the old forced dark layer removed, Teams cards shown light on screen. Build new UI with the KIT; never hard-code colours. Scott has not reviewed it yet.
- Scott is working through the Today page's private round on real data and sending notes.
- Latest change: the private standings block names both placings for every metric ("93rd in the Call Center, 11th on our team"), with no "N people ahead of you" counts and no top 15 bar. A last place (Call Center or team) is left off. The team note no longer has a built-in default; nothing is added unless Scott writes and saves one.
- Before that (10/14): every associate message, call or metric, carries real praise. Calls use a praise floor in `call-transcript` (`addFloorPraise`); metric messages use `messageVoice.truePositive`.

## Next
- See TASKS.md.
