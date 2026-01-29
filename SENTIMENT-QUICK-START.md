# Sentiment Feature - Quick Start Guide

## How to Use the Sentiment Coaching Feature

### Step 1: Prepare Your Files
Create three CSV or Excel files with sentiment data:

**Positive Words Report** (`positive-words.csv`):
```
Total calls analyzed: 50
"Thank you for your patience" (45/50)
"I really appreciate that" (38/50)
"Happy to help with that" (42/50)
```

**Negative Words Report** (`negative-words.csv`):
```
Total calls analyzed: 50
"That's not possible" (8/50)
"I can't do that" (5/50)
"You'll have to contact" (12/50)
```

**Managing Emotions Report** (`emotions.csv`):
```
Total calls analyzed: 50
"Rushed or hurried tone" (3/50)
"Confident and calm" (47/50)
"Professional and courteous" (45/50)
```

### Step 2: Navigate to Sentiment Section
1. Click the **💬 Sentiment** button in the navigation bar
2. You'll see the sentiment analysis interface

### Step 3: Upload Reports
1. Click the file input under **➕ Positive Words Report**
   - Status shows: "✅ Loaded: 50 calls, 3 phrases"
2. Upload **Negative Words Report**
   - Status shows: "✅ Loaded: 50 calls, 3 phrases"
3. Upload **Managing Emotions Report**
   - Status shows: "✅ Loaded: 50 calls, 3 phrases"

### Step 4: Select Employee
1. In the **Select Employee** dropdown, choose an employee
2. System populates from your uploaded weekly data

### Step 5: Generate Coaching Prompt
1. Click **💬 Generate Sentiment Coaching Prompt**
2. System generates a ChatGPT prompt that:
   - Includes the mandatory disclaimer
   - Lists your uploaded sentiment data
   - Provides structure for coaching output
   - Includes all required sections

### Step 6: Copy to ChatGPT
1. Click **🤖 Copy to CoPilot**
2. System automatically:
   - Copies the prompt to clipboard
   - Opens ChatGPT Copilot in new tab
3. Paste prompt into ChatGPT chat

### Step 7: Generate Coaching Email
In ChatGPT, the AI will generate a personalized coaching email with:
- ✅ Subject line
- ✅ Opening appreciation
- ✅ Positive language highlights
- ✅ Areas for improvement
- ✅ Specific language suggestions
- ✅ Emotional tone guidance
- ✅ Focus areas for next week
- ✅ Closing support statement

### Step 8: Send to Employee
1. Copy the ChatGPT output
2. Send via email to employee
3. Ready to use as-is (no emojis, professional tone)

---

## File Format Requirements

Each file should contain:
- **Header line**: "Total calls analyzed: [number]"
- **Data lines**: One per phrase in format:
  - `"phrase text" (X/Y)` or
  - `phrase text (X/Y)` or  
  - `phrase text X/Y`

Where:
- `X` = number of calls where phrase was used
- `Y` = total calls analyzed

## Example Workflow

```
1. Sales Manager uploads 3 sentiment reports from conversation analytics
2. Selects employee "Sarah Chen" from dropdown
3. Clicks "Generate Sentiment Coaching Prompt"
4. System combines sentiment data into coaching prompt
5. Manager clicks "Copy to CoPilot" 
6. ChatGPT tab opens, prompt is in clipboard
7. Manager pastes into ChatGPT chat
8. AI generates warm, specific coaching message
9. Manager copies output and sends to Sarah
```

## Tips for Best Results

1. **Use Recent Data**: Upload reports from the same period you're coaching about
2. **All Three Categories**: For best results, upload all three report types
3. **Accurate Counts**: Ensure X/Y counts accurately reflect usage
4. **Clear Phrases**: Use specific, actual phrases from conversations
5. **Let ChatGPT Rewrite**: The AI will creatively incorporate the data

## Troubleshooting

**No prompt generated?**
- ✅ Have you selected an employee?
- ✅ Have you uploaded at least one report?

**Files not uploading?**
- ✅ Use CSV or Excel (.csv, .xlsx, .xls) format
- ✅ Check file includes "Total calls analyzed: X" header

**ChatGPT tab not opening?**
- ✅ Check if pop-ups are blocked in browser
- ✅ Try clicking "Copy to CoPilot" again

**Status shows error?**
- ✅ File format incorrect - check phrase parsing
- ✅ Try reformatting with "phrase (X/Y)" format

---

**Version**: 1.0  
**Last Updated**: January 2026  
**Status**: Ready for Production
