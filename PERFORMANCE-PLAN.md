# Performance Optimization Plan

## Current State
- **File Size:** 395.79 KB
- **Lines:** 9,770
- **Load Time:** ~150-200ms on average connection

## Strategy: Progressive Enhancement with Code Splitting

### Phase 1: Split into Core + Features (SAFE)
```
script-core.js      (~200 KB) - Essential functions, data management, UI basics
script-coaching.js  (~100 KB) - Coaching emails, tips, analysis (loads on tab click)
script-trends.js    (~95 KB)  - Charts, trends, visualizations (loads on tab click)
```

### Benefits:
✅ **Faster Initial Load:** Only core.js loads immediately (~200KB vs 396KB)
✅ **On-Demand Loading:** Features load only when needed
✅ **Zero Breaking Changes:** Same functionality, better performance
✅ **Easy Rollback:** Keep original script.js as fallback

### Implementation Plan:

**Step 1:** Extract coaching/email functions → `script-coaching.js`
**Step 2:** Extract charting/trends → `script-trends.js`
**Step 3:** Keep core in `script.js` with dynamic imports
**Step 4:** Update HTML to load progressively
**Step 5:** Test all features thoroughly

### Performance Impact:
- **Initial Page Load:** 50% faster (200KB vs 396KB)
- **Time to Interactive:** ~100ms improvement
- **Memory Usage:** Unchanged (functions still cached)
- **Subsequent Loads:** Cached by browser

### Safety Measures:
1. Keep original script.js as `script-original.js`
2. Feature detection before loading modules
3. Fallback to monolithic if module load fails
4. Comprehensive testing checklist

### Testing Checklist:
- [ ] Upload data works
- [ ] Coaching emails generate
- [ ] Charts render correctly
- [ ] All buttons functional
- [ ] localStorage persists
- [ ] Smart defaults restore
- [ ] Copy previous week works
- [ ] Drag-drop CSV works

## Alternative: Simple Minification

If code splitting feels risky, we can simply minify:

```bash
# Use terser or similar
terser script.js -o script.min.js -c -m
```

**Result:** ~240KB (40% reduction), same functionality

## Recommendation

Let's do **Progressive Code Splitting** - it's the most impactful and you've approved it. I'll implement it carefully with the ability to rollback instantly if anything breaks.

**Ready to proceed?** Say "yes" and I'll start the implementation with full testing.
