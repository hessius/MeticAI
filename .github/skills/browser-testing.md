# Agent Skill: Pre-Release Browser Testing Protocol

This skill defines the manual browser testing protocol to run against a live Docker container before each release. Run this **after** all automated tests pass and **before** the final version bump.

## Prerequisites

1. Docker container running with the latest code:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache
   docker rm -f meticai 2>/dev/null; docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
   ```
2. Container healthy: `docker exec meticai curl -sf http://localhost:3550/health`
3. Browser tool available (VS Code MCP browser, Playwright, or manual browser at `http://localhost:3550`)

## Test Protocol

Execute each section in order. Record PASS/FAIL for each item.

### 1. Start Screen

- [ ] Page loads without errors (check console)
- [ ] Version banner shows correct version (e.g., `2.3.0-beta.1`)
- [ ] Profile count displays correctly
- [ ] All navigation buttons visible: Generate, Catalogue, Run/Schedule, Dial-In Guide, Pour Over, Shot Analysis, Settings
- [ ] Light/dark mode toggle works and persists on reload
- [ ] MeticAI logo navigates to start screen

### 2. Profile Catalogue

- [ ] Opens and loads profiles with images
- [ ] Profile count matches start screen count
- [ ] Profile cards show name, author, date, description preview
- [ ] Download JSON and Delete buttons present on each card
- [ ] Filter by tags button present
- [ ] Manage machine profiles (sync) button present
- [ ] Clicking a profile opens detail view

### 3. Profile Detail

- [ ] Profile name, date, and image display correctly
- [ ] Edit profile button (pencil icon) present next to name
- [ ] "Shot History & Analysis" and "Run/Schedule" action buttons present
- [ ] Description, Preparation, Why This Works, Special Notes sections render with formatted content
- [ ] Notes section with "Add note" button
- [ ] Profile details sidebar: temperature, target weight, variables
- [ ] Profile image section: Upload and Generate buttons
- [ ] Export as Image/JSON buttons

### 4. Shot History & Analysis

- [ ] Loading screen with progress bar and percentage
- [ ] Shot list loads with profile-specific shots
- [ ] Each shot shows: profile name, date/time, duration, yield weight
- [ ] "Search for new shots" button works
- [ ] Last updated timestamp shown

### 5. Shot Detail

- [ ] Stats header: Duration, Yield, Temperature
- [ ] **Replay tab**: Extraction graph with Flow, Grav. Flow, Pressure, Weight series, stage overlays, tooltip on hover, playback controls
- [ ] **Compare tab**: Loads and allows shot comparison
- [ ] **Analyze tab**:
  - Shot summary (weight, duration, max pressure, max flow)
  - Shot vs Profile Target chart
  - Stage-by-stage breakdown with targets, limits, and status
  - "Fetch AI Analysis" button (if AI enabled)
  - Export as Image button
- [ ] Star rating (1-5 stars) and notes section below tabs

### 6. Shot Analysis View (from start screen)

- [ ] "Recent" and "By Profile" tab toggle
- [ ] Recent shots list with profile names, dates, metrics, analysis icon
- [ ] By Profile view groups shots under profile headers
- [ ] Clicking a shot opens shot detail

### 7. Dial-In Guide (Wizard)

- [ ] **Step 1 (Coffee Details)**: Roast level buttons, origin input, process buttons, roast date, profile name
- [ ] **Step 2 (Select Profile)**: Machine profile list or manual name input, skip option
- [ ] **Step 3 (Preparation)**: Checklist (grind, weigh, distribute, tamp, flush), ready/skip buttons
- [ ] **Step 4 (Brew)**: Coffee cup icon, "Shot done" button
- [ ] **Step 5 (Taste)**: Taste Compass (2D, draggable), descriptor chips (8 positive + 8 negative), submit button enables when moved
- [ ] **Step 6 (Recommendations)**: AI-generated recommendations displayed (or rule-based fallback), "Adjust & try again" and "Finish" buttons
- [ ] **Step 7 (Finish)**: Returns to start screen with toast notification
- [ ] Progress bar updates at each step (14%, 29%, 43%, 57%, 71%, 86%, 100%)
- [ ] Back button navigates to previous step
- [ ] All text translated to selected language

### 8. Taste Compass (in Dial-In and Shot Analysis)

- [ ] SVG compass renders with 4 labeled axes (Sour/Bitter/Strong/Weak)
- [ ] Draggable dot responds to click/drag
- [ ] Color quadrants with gradient
- [ ] Descriptor chips: 8 positive (Sweet, Clean, Complex, Juicy, Smooth, Balanced, Floral, Fruity) and 8 negative (Astringent, Muddy, Flat, Chalky, Harsh, Watery, Burnt, Grassy)
- [ ] Selecting a descriptor activates it visually
- [ ] Reset button appears after first interaction

### 9. Run / Schedule

- [ ] Profile selector dropdown loads machine profiles
- [ ] Selected profile shows name, temperature, target weight
- [ ] Preheat toggle works
- [ ] Schedule toggle works
- [ ] "Run now" button enables when profile selected
- [ ] Variable adjustment panel appears when profile has adjustable variables (sliders/inputs)

### 10. Settings

- [ ] "About MeticAI" collapsible section
- [ ] Language selector with selected language highlighted
- [ ] Gemini API key field (shows configured/not configured status)
- [ ] "Enable AI features" toggle
- [ ] "Hide AI controls when unavailable" toggle
- [ ] Machine IP input field
- [ ] All labels translated to selected language

### 11. Accessibility

- [ ] Skip navigation links present ("Skip to main content", "Skip to navigation")
- [ ] Landmarks: `banner`, `main`, `navigation`
- [ ] ARIA labels on all icon-only buttons
- [ ] Live regions (aria-live) for wizard step changes, loading states
- [ ] Star rating buttons have descriptive labels ("1 star", "2 star", etc.)

### 12. Cross-Cutting Concerns

- [ ] No unhandled JavaScript errors in console (warnings OK)
- [ ] All pages load within 5 seconds (excluding shot history search)
- [ ] Navigation between all views works (no dead-end states)
- [ ] Back button behavior consistent (returns to previous view)
- [ ] Toast notifications appear for user actions (success/error)

## Recording Results

Create a markdown table with results:

```markdown
| # | Area | Status | Notes |
|---|------|--------|-------|
| 1 | Start Screen | PASS | |
| 2 | Profile Catalogue | PASS | |
| ... | ... | ... | ... |
```

Post the results as a comment on the version PR.

## When to Run

- **Required**: Before every version bump to a non-beta release (e.g., `2.3.0-rc.1` or `2.3.0`)
- **Recommended**: After significant feature additions on a beta branch
- **After**: All automated tests pass, CI green, Docker container rebuilt
