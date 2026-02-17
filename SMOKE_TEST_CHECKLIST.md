# Post-Deploy Smoke Test Checklist

Run this checklist after each deploy to quickly verify core workflows.

## 1) App Loads
- [ ] Open https://development-coaching-tool.pages.dev
- [ ] Confirm footer version displays and matches latest expected format `YYYY.MM.DD.N`
- [ ] Confirm no immediate browser errors in DevTools console

## 2) Upload + Data Availability
- [ ] Go to **Upload Data**
- [ ] Load a known-good sample dataset (paste or Excel)
- [ ] Confirm success message appears
- [ ] Confirm period selectors populate

## 3) Generate Coaching
- [ ] Go to **Generate Coaching**
- [ ] Select employee + period
- [ ] Confirm metrics populate
- [ ] Generate prompt/email flow and verify output appears

## 4) Metric Trends
- [ ] Open **Metric Trends**
- [ ] Select period and employee
- [ ] Confirm call-center average inputs load
- [ ] Confirm target values appear in labels and hints
- [ ] Generate trend email successfully

## 5) Data Operations
- [ ] Export backup (Excel/JSON as applicable)
- [ ] Re-import backup
- [ ] Confirm key data is preserved

## 6) Executive / Dashboard
- [ ] Open Employee Dashboard and verify records render
- [ ] Open Executive Summary and confirm prompt generation works

## Pass Criteria
- [ ] No blocking errors
- [ ] All critical flows complete end-to-end
- [ ] Version and behavior match expected release
