---
name: House Budget
description: A local-first, zero-based budgeting app for households, drawn as a ledger read by lamplight.
colors:
  board: "#000000"
  raised: "#141418"
  well: "#060607"
  panel: "#1c1b1c"
  nav-hover: "#2a2a2a"
  nav-active: "#353435"
  ink: "#f4f4f7"
  ink-2: "#bdbdc6"
  muted: "oklch(0.678 0.016 285.9)"
  faint: "oklch(0.599 0.015 285.8)"
  on-ink: "#141418"
  rule: "oklch(0.434 0.016 285.3)"
  rule-strong: "oklch(0.500 0.019 285.3)"
  rule-faint: "oklch(0.389 0.010 285.6)"
  accent: "oklch(0.62 0.21 293)"
  accent-btn: "oklch(0.585 0.21 293)"
  accent-soft: "oklch(0.31 0.11 293)"
  accent-ink: "oklch(0.82 0.15 293)"
  accent-text: "color-mix(in srgb, var(--accent-ink) 45%, var(--ink))"
  on-accent: "#ffffff"
  bar-plan: "color-mix(in srgb, var(--accent) 50%, transparent)"
  wash-head: "color-mix(in srgb, var(--accent) 13%, var(--board))"
  wash-open: "color-mix(in srgb, var(--accent) 6%, var(--raised))"
  wash-tray: "color-mix(in srgb, var(--accent) 5%, var(--board))"
  wash-breach: "color-mix(in srgb, var(--breach) 8%, var(--board))"
  breach: "oklch(0.63 0.20 27)"
  breach-soft: "oklch(0.31 0.10 27)"
  breach-ink: "oklch(0.80 0.15 27)"
  info: "oklch(0.72 0.13 240)"
  info-soft: "oklch(0.31 0.08 240)"
typography:
  display:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  body:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.45
  label:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.06em"
  section-label:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    letterSpacing: "0.09em"
  figure:
    fontFamily: "Plus Jakarta Sans, system-ui, -apple-system, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    fontFeature: "tnum, lnum"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SF Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  3xs: "6px"
  2xs: "8px"
  sm: "10px"
  base: "14px"
  lg: "20px"
  pill: "999px"
spacing:
  "1": "4px"
  "2": "6px"
  "3": "8px"
  "4": "10px"
  "5": "12px"
  "6": "16px"
  "7": "22px"
  "8": "30px"
  gap: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent-btn}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-secondary:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-secondary-sm:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "6px 10px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-ghost-hover:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.breach-ink}"
    rounded: "{rounded.sm}"
    padding: "9px 15px"
  button-icon:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.2xs}"
    width: "30px"
    height: "30px"
  card:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.lg}"
  input-inline:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.figure}"
    rounded: "{rounded.2xs}"
    padding: "5px 8px"
  input-inline-hover:
    backgroundColor: "{colors.well}"
  input-inline-focus:
    backgroundColor: "{colors.raised}"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.2xs}"
    padding: "10px 12px"
  nav-item-hover:
    backgroundColor: "{colors.nav-hover}"
    textColor: "{colors.ink}"
  nav-item-active:
    backgroundColor: "{colors.nav-active}"
    textColor: "{colors.ink}"
  pill-diff:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  pill-diff-ontrack:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-2}"
  pill-diff-breach:
    backgroundColor: "{colors.breach-soft}"
    textColor: "{colors.breach-ink}"
  tile:
    backgroundColor: "{colors.well}"
    textColor: "{colors.faint}"
    rounded: "9px"
    width: "34px"
    height: "34px"
  group-header:
    backgroundColor: "{colors.wash-head}"
    textColor: "{colors.ink}"
    padding: "16px 8px"
  group-header-over:
    backgroundColor: "{colors.wash-breach}"
    textColor: "{colors.breach-ink}"
  keycap:
    backgroundColor: "{colors.well}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.3xs}"
    padding: "2px 7px"
---

# Design System: House Budget

## Overview

**Creative North Star: "The Ledger at Night"**

House Budget is a household ledger read by lamplight. The canvas is genuinely black, not a dark grey standing in for one, and almost everything drawn on it is a figure or the rule that keeps figures in line. The single violet in the system behaves like a lamp rather than a paint: it is carried to the one thing being worked on, it names the one column that reports what actually happened, and it is otherwise put away. Nothing on a screen is bright unless it is the reason you opened the screen.

The voice is measured, quiet and exact. Every rung in this system was solved rather than chosen: the ink ramp is stated in OKLCH with its lightness worked out so that each grade clears 4.5:1 on the busiest surface it lands on, the rules are graded by what they carry (3:1 if they are the boundary of something interactive, lower if they are only structure), and the type scale is named after its own pixel values so that a size cannot quietly drift into its neighbour. That precision is the aesthetic, not a constraint on it. The design reads engineered because the numbers behind it are defensible, and the file that holds them says so out loud.

What the system refuses is as load-bearing as what it states. Zero-based budgeting means an envelope spent exactly to plan is the success, so the settled state gets no colour at all: colour is spent on failure and nothing else, and there is no green anywhere in the app. Money not yet allocated is drawn by absence, a hollow stretch of an outlined track, because a budget that has not been written yet is not an error and the app should not open the first of the month by shouting. The confirmed anti-reference is the playful money app: no mascots, no confetti on save, no congratulatory copy, no pastel cards. This is a tool a household trusts with the actual numbers, and it earns that by being quiet.

**Key Characteristics:**
- True-black OLED canvas with a faint violet radial wash, and a surface ramp that layers upward from it.
- One accent, spent sparingly: the brand tile, the active work, the "Actual" column, and quantity fills.
- Exactly one hue for failure, and no hue at all for success.
- Money set in the UI face with true tabular figures, never in a code face.
- Contrast solved and tested rather than eyeballed, with floors enforced by `tests/tokens-electron.cjs`.
- Depth from tonal layering and accent washes; shadow used to rank, not to decorate.
- Every control redrawn here, including native selects, scrollbars and the option list.

## Colors

A single-theme palette (`obsidian`), built as a black room with one violet lamp in it, one red for things that have gone wrong, and one cold blue reserved for "shared".

### Primary
- **Lamplight Violet** (`accent`): the app's only accent, at full strength. It appears on the brand tile, the focus ring, spending that actually moved on the month bar, the mini progress fill, the drag drop line, and the toast's draining edge. Nowhere else.
- **Deep Lamplight** (`accent-btn`): the accent darkened until Filament White on it clears 4.5:1. Fills for the primary button and the Wallet's mark, and nothing that is not a fill carrying text.
- **Violet Glow** (`accent-ink`): the accent as foreground on a dark surface, for the Wallet button's glyph and amount and for the "ACTIVE" caption on a theme card.
- **Lamplight Text** (`accent-text`): Violet Glow blended 45% toward Page White, for accent-tinted running text, which is item names in the budget rows, the "Actual" column label, and group totals. Full-strength accent ink across a whole month of rows reads too loud; this sits closer to the text around it while staying unmistakably the accent.
- **Violet Shade** (`accent-soft`): the accent's dark tint, used only for live drag affordances and the selected copy-option card.
- **Half-Light** (`bar-plan`): the accent at 50%, meaning money that has a job on paper. One hue, two weights, on both the month bar and the dashboard's planned-against-spent bars.

### Secondary
- **Ember Red** (`breach`), **Ember Shade** (`breach-soft`), **Ember Glow** (`breach-ink`): the failure ramp, and the only other hue in the system. It carries two jobs on purpose: over budget, and the ordinary red of an error affordance (a refused value, a failed read, a destructive action). A second red would look identical to this one and only be confusing.

### Tertiary
- **Cold Signal Blue** (`info`) and **Signal Shade** (`info-soft`): reserved for "shared", which in this app means an account no single member owns. It is the one place a third hue is allowed, because shared-ness is a fact about ownership rather than a state of the money.

### Neutral
- **Midnight Board** (`board`): the canvas, true black. Under it sits **The Night Gradient** (`canvas-wash`), a faint violet-tinted radial lightest at the top.
- **Lamplit Slate** (`raised`): cards, popovers, sheets and modals. The busiest text backdrop in the app, and the surface the ink ramp is measured against.
- **Inkwell** (`well`): insets. Trays, progress tracks, input fills, quiet chips. Darker than the board, so an inset genuinely reads as cut into the surface.
- **Nightstand Grey** (`panel`): the sidebar's own surface, deliberately off the board ramp and lighter than the cards, because a true-black canvas has nowhere to go but up. **Nightstand Lift** (`nav-hover`) and **Nightstand Hold** (`nav-active`) are its two states.
- **Page White** (`ink`) and **Pencil Grey** (`ink-2`): primary and secondary text.
- **Margin Grey** (`muted`) and **Watermark Grey** (`faint`): captions, sub-lines and labels. Both solved against Lamplit Slate at 6.28:1 and 4.64:1, so the ramp is a real ladder (4.64 / 6.28 / 9.85 / 16.74) rather than three near-identical greys.
- **Reverse Ink** (`on-ink`): the foreground for anything filled with Page White, which is the toast, the tooltip and the arithmetic preview chip.
- **Ruled Line** (`rule`), **Drawn Edge** (`rule-strong`), **Ghost Rule** (`rule-faint`): the three-grade hairline set, described in Shapes.
- **Washed Band** (`wash-head`), **Opened Wash** (`wash-open`), **Tray Wash** (`wash-tray`), **Ember Wash** (`wash-breach`): the accent-presence washes, described in Elevation & Depth.

### Named Rules

**The One Failure Rule.** Exactly one state in this app earns a hue, and it is the failure. An envelope spent to plan is the success in zero-based budgeting, so the settled state gets no colour: it is the resting state. Never paint under-spending, on-track, or any other settled state green, or any other colour at all.

**The Hollow Remainder Rule.** Money not yet allocated is drawn by absence: the month bar starts as an outlined, empty track and allocating fills it. Never colour the unallocated remainder, and never treat an unwritten budget as an error.

**The One Red Rule.** Ember Red means both "over budget" and "something failed". Do not introduce a second red, an amber warning tier, or a distinct destructive palette.

**The Rationed Accent Rule.** Lamplight Violet is a lamp, not a wash. It goes on the brand tile, the focus ring, the object currently being worked on, quantity fills, and the "Actual" column. If a screen has two loud violet objects competing, one of them is wrong: the topbar pair is the reference, where "New month" is solid and the Wallet button beside it keeps its accent in the glyph and the amount only.

**The Fixed Amber Rule.** The current find-match marker is a fixed pair (`#ffd84d` on `#161006`), deliberately outside the theme system. A found-match marker is a tool, not decoration, and reads instantly because it is the colour every browser's own find already uses.

## Typography

**Display / Body Font:** Plus Jakarta Sans (with `system-ui`, `-apple-system`, `sans-serif`)
**Figure Font:** Plus Jakarta Sans, with `tabular-nums lining-nums`
**Mono Font:** IBM Plex Mono (with `ui-monospace`, `SF Mono`, `monospace`)

Both faces are bundled as woff2 and subset, never fetched: the app makes no outbound request at startup, and a face that failed to arrive would fall back to `system-ui` at different metrics inside a pixel-fixed layout. `ss01` and `cv01` are on globally.

**Character:** One humanist grotesque doing nearly all the work, warm enough for a household but with true tabular lining figures, so a column of amounts aligns to the pixel while still reading as money rather than as code. IBM Plex Mono is kept for the two things that genuinely are code: keycaps and an error string.

### Hierarchy
- **Display** (600, 34px, line-height 1, -0.025em): the month numeral in the topbar and the page title. One per screen.
- **Headline** (600, 22px, -0.02em): a modal's own title. The startup error screen sets 21px for the same job.
- **Title** (600, 15px): a card heading, a settings row's name, a group name, a chart title. 16px at the head of a sheet.
- **Body** (500, 13px, line-height 1.45): the app's default reading size. Prose in dialogs sets 14px with a 1.5 line-height and a measure of roughly 460px.
- **Label** (600, 11px, uppercase, 0.06em): the micro-label over a list, a column, a nav group or a popover.
- **Section label** (600, 13px, uppercase, 0.09em): the heading over a whole section of a page.
- **Figure** (600, tabular lining figures): every amount in the app, at whatever rung its context sets (10px in a nested sub-figure, 13-15px in a row, 20px on a card, 30px where the figure is the whole of a surface, 16-18px on the month bar).
- **Mono** (400, 11px): keycaps and raw error strings only.

### Named Rules

**The Named Rung Rule.** Every font-size in the stylesheet is a rung of a scale whose names are its pixel values (`--text-13` is 13px and means nothing else). There is no type literal anywhere in `renderer/styles`. A new size arriving is a new rung, never a rounding into the nearest old one. T-shirt names are rejected on purpose: they force a judgement at every call site at exactly the moment it is least visible.

**The Tabular Column Rule.** Tabular figures live on `.num` and nowhere else. Never put `tnum` on `body`: it would force tabular figures on every word of running prose and leave gaps around every digit in a sentence.

**The Money Is Not Code Rule.** Amounts are set in Plus Jakarta Sans, never in IBM Plex Mono. The mono face gives the comma and the full stop a full character cell, so "$1,500.00" sets as if spaced apart, and its slashed zero lands at 12-14px as a line struck through the number, so "$500" reads as a cancelled figure rather than a saved one.

**The Two Tiers Rule.** There are exactly two tiers of small-caps label, 11px/0.06em for an object and 13px/0.09em for a section, and no third rung between them. A third would be a size with no meaning. The tracking is what makes them legible: uppercase at 11px sets tight, and 0.06em opens it back up.

**The Ink Belongs To The Call Site Rule.** The small-caps label utility carries shape only, never colour. Ink is a contrast decision made where the label lands: Margin Grey on the sidebar's panel, Watermark Grey inside a popover or over a column of figures, Pencil Grey where the label leads a block of text.

## Layout

**The shell** is a two-column CSS grid: a fixed sidebar track (`--sidebar-w`, 240px) beside `1fr`. Collapsing the panel animates the grid column itself rather than transforming the panel, so the main column is genuinely laid out at every width along the way and nothing has to be corrected at the end. The collapsed rail is 64px at every window size, set on the app element so it beats any breakpoint.

**The canvas** scrolls independently, capped at `--maxw` (1440px) and centred, with 30px 38px 80px of padding. The cap exists only so an ultra-wide monitor does not stretch table rows to arm's length; at the app's default 1280px window it never engages. Content spans the window rather than sitting in a narrow well.

**The budget grid** is the app's signature table and is stated once, as `--budget-cols` (`1fr 150px 158px 150px 78px`), drawn by five call sites: the column head, the item row, the group header, and the two rows inside an opened item's entry tray. Rows are `--row-h` (50px) minimum, padded 7px 8px with a 10px gap. The column head carries one extra leading track for the 26px drag handle the rows sit beside.

**The spacing scale** steps 4, 6, 8, 10, 12, 16, 22, 30, widening as it grows, because a 2px difference is real between a chip's padding and a row's and invisible between two block gaps. `--gap` (16px) is deliberately not merged with the 16px rung: one names a role, the other names a length.

**Breakpoints** are placed where this layout actually breaks, not at device sizes:
- **≥1200px**: five columns, full sidebar (240px). Name column 272px.
- **<1200px**: the Difference column is dropped, sidebar 208px, page padding 26px 28px.
- **<1024px**: money columns give up their slack too, sidebar 184px, the brand and nav items shrink a rung, the month numeral drops to 28px. Reached mainly through the View menu's zoom rather than a window size, so it is a graceful-degradation tier.

Vertical rhythm on a page is deliberately uneven: the topbar closes with 42px, the low-stakes strips (Income, Quick entry) sit at a tighter 20px from each other, and Allocations, the page's actual work surface, takes 42px above it. The break says what the page is for before a single row is on screen.

### Named Rules

**The Fifth Column Rule.** Below 1200px the Difference column is the one that goes, because it is the only derived column on the row (allocated minus actual), both of its inputs stay on screen beside it, and the mini bar already says the same thing. Drop the derived column, never an input.

**The Spacing Scale Does Not Cover Everything Rule.** The renderer uses lengths this ladder has no rung for (14, 18, 20, 24, 26, and a scatter of 1, 2 and 3). Filling those gaps would take the scale past sixty tokens, at which point the vocabulary is the problem again with a `var()` wrapped round it. A length with no rung keeps its literal in CSS.

## Elevation & Depth

Depth is tonal first, and shadow only ranks. The surface ramp (Midnight Board → Lamplit Slate → Inkwell, with Nightstand Grey on its own separate sidebar ramp) is what separates one plane from another, and every card takes the same Lamplit Slate fill so cards read as surfaces sitting on a darker board rather than as boxes drawn with borders. Hairlines stay hairlines.

Accent presence is the second, independent depth channel, and it is what makes the three-level Allocations table legible where hairlines alone could not carry that much depth. A group header is the only washed band on the page (Washed Band, plus an inset top highlight so it reads lit from above rather than merely tinted). An opened item and the entry tray it opens share a lighter wash, which is what makes them read as one object instead of two neighbours. Everything else is neutral. Ember Wash replaces the accent on a header that is over, so the loudest surface on the page is always the one that needs attention, and it is deliberately weaker than the violet wash, because red carries far more perceived weight at the same mix.

### Shadow Vocabulary
- **Furniture** (`box-shadow: 0 1px 2px rgba(0,0,0,0.4), 0 1px 1px rgba(0,0,0,0.3)`): the resting shadow of ordinary cards, buttons, month steppers, tiles and chips.
- **Ranked** (`0 8px 24px -10px rgba(0,0,0,0.6), 0 2px 8px -4px rgba(0,0,0,0.45)`): the one lifted object on a screen, a button under the pointer, a popover menu, the feature cards at the top of Settings.
- **Floating** (`0 30px 70px -22px rgba(0,0,0,0.75), 0 10px 28px -14px rgba(0,0,0,0.55)`): anything genuinely off the page, which is the modal, the sheet, the find bar, the toast and the suggestion list.
- **Accent glow** (`--glow-sm` / `--glow-md`): reserved for surfaces filled with the accent, where a black shadow would do nothing. The primary button rests at the small glow and brightens to the medium one on hover.
- **Inset highlight** (`inset 0 1px 0` at 6-26% white): a top-edge lift on filled and feature surfaces, so depth comes from light rather than from a gradient.

### Named Rules

**The One Lifted Object Rule.** One object per screen rests at the ranked shadow. On Month Budget that is the group envelope. If everything is raised, nothing is.

**The Flat Fill Rule.** Filled buttons are flat, never gradients. A gradient's light end drops the label under AA in a quarter of the accent pairs tested; depth comes from the inset highlight and the accent glow instead, and hover brightens the glow rather than the fill.

**The Wash Is Depth Rule.** Accent presence, not shadow, carries the Allocations table's three levels. Never add a shadow between a group header, its item rows and an entry tray; the wash and the hairline already say it.

## Shapes

Corners follow the box rather than the call site, on a five-step ramp read smallest-first: 6px, 8px, 10px, 14px, 20px, plus a pill.

- **20px** frames a card: any `.panel`, a modal, a sheet.
- **14px** is the app's base radius, for objects that float over the page: the toast and the find bar.
- **10px** is a control: buttons, banners, alert banners, the move menu, theme cards, restore alerts.
- **8px** is a small control or an inset: icon buttons, nav items, inline fields, chip trays, tiles at the small size.
- **6px** is a chip or a badge: the arithmetic preview, keycaps, segmented chips.
- **999px** is a pill: the month bar's track and fills, the difference chip, the account chip, progress tracks, avatars, the group drop line.

Borders are a graded set of three, and the grade is chosen by what the line carries rather than by taste. **Drawn Edge** (3:1 on Lamplit Slate) is the boundary or the state of something interactive, which per WCAG 1.4.11 has a real floor: buttons, month steppers, the active nav item, the account chip, keycaps, the sidebar and sheet edges. **Ruled Line** (2.30:1) is structure: card outlines, dividers, the progress track. **Ghost Rule** (1.90:1) is a rule between rows that already identify themselves. The lower two carry no WCAG floor but sit where they sit rather than lower, below which a hairline is invisible rather than subtle.

Two recurring geometries are worth naming. The **dissolving hairline** is a horizontal rule strongest at its centre and dissolving toward both edges, accent-tinted: it frames a chart on the Dashboard and grounds the Allocations column labels, standing in for axis spines the charts do not draw. The **drawn vessel** is the month bar's track, a full pill outlined by a pseudo-element rather than an inset shadow, so the ring runs unbroken around the whole bar and the fills are simply what is inside it.

### Named Rules

**The Pill Tracks The Box Rule.** A pill is 999px, larger than any box it lands on, so the corner follows the element's own height instead of needing a value per control. A 99px spelling of a pill is this same token, not a different one.

**The Never Snap Rule.** A radius or a length with no rung keeps its own literal in CSS, which is a visible, greppable place for it to sit. Never snap a one-off value to a near rung, and never invent a value to fill a gap.

**The Corner Follows The Clip Rule.** A child sitting in a card's corner takes the card's curve on the corner it actually occupies and stays square on the three that are interior, at a radius 1px tighter than the card's, because the border is drawn outside what the card clips. The group card's drag handle is the reference implementation.

## Components

### Buttons
- **Shape:** a control corner (10px), padding 9px 15px, 13px label, 7px gap to an icon.
- **Primary:** Deep Lamplight fill with Filament White at weight 600, no border, resting on the small accent glow plus an 18% inset top highlight. Hover brightens the glow and the highlight; it never changes the fill.
- **Secondary (the default):** Lamplit Slate on a Drawn Edge border. The border is the whole of what says "this is a control", since the fill is only 1.17:1 against the page, which is why it takes the 3:1 grade. Hover moves the edge 45% toward the accent, lifts 1px and gains the ranked shadow.
- **Ghost:** transparent, Pencil Grey label, no shadow. Hover fills with Inkwell and lifts the label to Page White. A quiet variant rests at Margin Grey and holds it through hover, for afterthought actions under a list ("Add member", "Add group").
- **Danger:** Ember Glow label on the secondary shell; hover fills with Ember Shade and drops the border.
- **Icon:** a 30px square, transparent with a Margin Grey glyph, filling with Inkwell on hover. A 26px compact variant exists only for the item row's stacked pair, where 30px would add 5px to every row in the month.
- **Focus:** 2px solid accent at 2px offset, lifted to 3px on buttons and nav items. Inline fields override this with their own ring.

### Chips
- **Difference chip:** an outlined caption at 10px/0.06em uppercase on a Drawn Edge border, transparent by default, because the resting state of a budget row should not carry a fill. On track it fills quietly with Inkwell and drops its border: solid is fact, hollow is still in progress, and no colour arrives. Over budget it fills with Ember Shade on an Ember Red border.
- **Account chip:** a pill on Inkwell with a Ruled Line border and a 3px colour dot, holding an invisible native select stretched across it. Empty, it goes transparent with a dashed border. Focus puts the ring on the chip, because a ring on a zero-opacity select shows nothing.
- **Segmented tray:** a bordered Inkwell strip holding a radiogroup. The two trays in the app use different selection languages on purpose: the currency picker's chips are fixed 40px squares that fill solid with the accent and carry a tick inside the fill, and the backup options are content-width chips that lift into a Lamplit Slate card with the furniture shadow.

### Cards / Containers
- **Corner:** 20px. **Background:** Lamplit Slate, always. **Border:** a Ghost Rule hairline by default.
- **Shadow:** furniture at rest. Two modifiers move it: a raised card (the one ranked object on a screen) takes the Ruled Line border and the ranked shadow, and a feature card takes the ranked shadow plus a 6% inset top highlight.
- **Clipping is a separate axis from elevation** and named apart, so a call site can take one from each: a clipped card hides overflow so square-cornered rows stop at its curve, and an unclipped card keeps overflow visible and pushes the bottom curve onto whichever block ends up last.
- **Internal padding:** 20px 24px for a settings row, 12px 16px for a compact one, 30px 32px for a card holding a page's worth of text.

### Inputs / Fields
- **Style:** borderless and transparent, looking like plain text until engaged. 8px corner, 5px 8px padding, 14px. Money fields are right-aligned in the figure face; text fields sit at weight 500. A tray variant rests visibly boxed on Inkwell for the quick-entry row.
- **Hover:** fills with Inkwell and gains a Ruled Line border. The border is the point: a background change alone is 1.1:1 and cannot be seen.
- **Focus:** fills with Lamplit Slate, takes an accent border and the two-part ring (a 2px solid core carrying the indicator, plus a 26% soft outer band that is decoration on top of it and must never become the whole ring). These fields keep `:focus` rather than `:focus-visible` on purpose: the ring is the only thing that says which of forty cells is taking your typing, and that is as necessary after a click as after a Tab.
- **Error:** the border goes Ember Red and the ring is dropped, since a red edge plus a violet halo reads as two states at once. A refused commit keeps the field open holding what was typed, so the fix is one keystroke away.
- **The chip above a field:** the same box carries both the arithmetic preview ("= $52.50", Page White fill, Reverse Ink) and the reason a value was refused (Ember Shade fill, Ember Red border), so the field does not appear to change shape when a sum turns out to be unreadable. It is drawn above the field, because below is where the next row is.

### Navigation
- The sidebar sits on its own surface ramp with a Ruled Line right edge, which does not have to do the separating on its own because the fill already does.
- **Nav item:** 8px corner, 10px 12px padding, 12px at weight 500 in Pencil Grey, with a 12px gap to a 20px icon that inherits the item's ink so the whole row lightens together. Hover fills Nightstand Lift; active fills Nightstand Hold and goes weight 700. Nothing else: a shadow or a border on top would be a third announcement of a state the weight change already makes plain.
- **Collapsed rail (64px):** nothing is re-laid-out and nothing is re-rendered. The same markup is present in both states, labels are simply not drawn, and every item that loses its label keeps its name on `aria-label` and `title`. Labels go at once rather than fading with the column, because text that shrinks with the panel spends the whole animation being crushed against an edge.

### The month bar (signature)
Full-bleed and structural, sitting directly on the board rather than inside a card, because it is neither furniture nor the one lifted object. A 34px pill track filled with Inkwell and outlined by a pseudo-element hairline, with regions stacked from the left edge: spent at full accent, allocated at Half-Light, and the remainder left bare inside the ring. Figures sit above and below on their baselines, with bullets that echo the bar's own paint (a solid dot, a washed dot, a hollow ring). The income mark is deliberately two elements, a 1px rule inside the track carrying precision and a pair of 4px ticks outside it carrying visibility, because one element cannot both be clipped by the track and be seen against the board.

### The toast (signature)
A floating strip on the board with a Drawn Edge border and the floating shadow, docked centred over the main column rather than the viewport. Its bottom hairline is consumed left to right over exactly the lifetime the store granted the message (2.6s for a confirmation, 6s when there is an Undo to catch), spanning precisely the straight run of the border between the two corner arcs, so what is revealed as it drains is the toast's own edge being eaten. Errors never expire and so carry no draining edge at all, which gives the two states a second, non-colour channel.

### The wallet (signature)
The Wallet opens as a **sheet**: a centred surface capped at 1120px and at the viewport less 56px, as tall as its own contents until it needs to scroll. It is the app's third overlay shape, between the modal (a question with two buttons under it) and nothing at all, and it exists because planning a month's transfers is a screen's worth of work rather than a dialog's. It takes the modal's veil, its `pop` keyframe and its focus trap unchanged.

Inside it, an account is drawn as the **wallet silhouette**: a card with a semicircular cut in its bottom edge, at a fixed 16px in from the left, and a 46px slot broken through the hairline beside it. The cut is a half-disc of the surface behind the card, laid over the card's own bottom border and carrying that border round the arc, so the shape is a real cut rather than a drawn circle. Together the cut and the slot are the whole of what says "wallet": there is no wallet drawing on the card, which leaves the tile at the top-left free to carry the account's own glyph.

The sheet is a **board**, not a card: what it holds is a screen's worth of cards, so the ramp inside it is the one a page uses (Midnight Board, Lamplit Slate cards, Inkwell insets) and the veil behind is what separates it from the page it floats over. A sheet filled as a card would leave every surface inside it a step up the ramp with nowhere to go, and every hairline grade a step below its own floor.

A wallet card therefore departs from the card rules above in exactly one place: its corner is a control's 10px rather than a card's 20px, because it is a button in a grid of buttons. It is a button in the other respect too, so its edge takes the Drawn Edge grade rather than a card's Ghost Rule. The detail panel beside it is read rather than pressed, so it is a plain `.panel` at a card's 20px. A single radial wash at a card's top-right is the only depth on it, and that wash is what turns accent on the selected wallet, so selection is carried by a fill as well as by the accent edge.

### Motion
Transitions are short and property-scoped: 120-140ms on state (colour, background, border, transform), 180ms on a rotation, 300-350ms on a quantity settling into place. The four overlays (modal, sheet, find bar, toast) share one keyframe, an exponential ease-out with no overshoot (`cubic-bezier(.16, 1, .3, 1)`): fast out of the gate, long settle, nothing to recover from, because a dialog in a money app springing past where it means to land is not a texture this app wants. Reduced motion collapses every animation and transition, drops the two hover lifts, and holds the toast's edge full rather than emptying it a frame after it appears.

### Named Rules

**The Quiet Until Engaged Rule.** Controls rest as quietly as they can and answer only when touched. Fields look like plain text until hovered, row actions are invisible and unreachable until the row is hovered or focused (`pointer-events` as well as opacity, or a delete button is focusable while invisible), and the accent arrives on the object being worked on and leaves with it.

**The Second Channel Rule.** Colour is never the only signal. A mini bar that is over budget takes a diagonal hatch as well as the breach red, an expiring toast drains an edge while an error carries none, a settled difference chip changes texture rather than hue, and every bar carries an accessible name saying in words what it draws.

**The Redraw Everything Rule.** Native chrome is opted out of and redrawn here: selects lose their appearance and take the app's edge plus a matching chevron, option lists are repainted (they would otherwise open white-on-white on a dark theme), and scrollbars take a Drawn Edge thumb ringed in the surface behind them.

**The Inline Style Rule.** An inline `style` prop is permitted only for a value that cannot be known until runtime: a percentage from bar geometry, a member's own colour, a measured portal coordinate, a size derived from a prop. Everything else belongs in a class, taking a token if one exists at that exact value and keeping its own literal otherwise. This is enforced by `scripts/check-inline-styles.mjs` in `pretest`.

## Do's and Don'ts

### Do:
- **Do** spend the accent on one thing at a time. The brand tile, the focus ring, the object being edited, quantity fills, and the "Actual" column are its whole budget on a screen.
- **Do** state every font-size as a rung of the pixel-named scale, and add a new rung rather than rounding into an old one.
- **Do** put tabular figures on `.num` and every amount in Plus Jakarta Sans, never in the mono face.
- **Do** carry depth with the surface ramp and the accent washes first, and reach for a shadow only to rank one object above its neighbours.
- **Do** grade a hairline by what it carries: 3:1 (Drawn Edge) if it is the boundary or the state of something interactive, the lower grades if it is only structure.
- **Do** give every coloured state a second, non-colour channel: a hatch, a word, a texture change, an accessible name.
- **Do** let the first row in a stack draw no rule, and put the hairline between rows instead, or a card opens with a double line one pixel inside its own edge.
- **Do** keep a control's resting, hover and focus states distinguishable from each other by different properties (a fill for one, a border or a lift for the next), never by two shades of the same fill.
- **Do** redraw native controls, including the `option` list inside a select.
- **Do** run `tests/tokens-electron.cjs` after touching any colour token; the contrast floors this design depends on are enforced there, and `--report` reads the measured ratios back out.

### Don't:
- **Don't** introduce green, or any colour at all, for a settled or under-spent state. Under-spending is an unfinished allocation, not a win.
- **Don't** colour the unallocated remainder of a month. Absence is the signal.
- **Don't** add a second red, an amber warning tier, or a separate destructive palette alongside Ember Red.
- **Don't** put a gradient on a filled button. Flat fill, inset highlight, accent glow.
- **Don't** raise more than one object per screen to the ranked shadow.
- **Don't** add mascots, confetti, celebratory copy, pastel cards, or any other texture from the playful money app. This is a household's actual ledger.
- **Don't** write a length or a colour inline in JSX unless it genuinely cannot be known until runtime.
- **Don't** snap an unrunged value to a near rung, and don't invent a token to cover it. Leave the literal in CSS where it is greppable.
- **Don't** normalise two near-identical rules into one without checking the pixels: several pairs in this system differ by two or three declarations on purpose, and each of those differences is documented at the rule.
- **Don't** use blur or translucency as decoration. It appears twice, on the modal and sheet veils, and nowhere else.
- **Don't** add a third tier of small-caps label, or a fourth tile size, or a fourth shadow rung. Each of those ladders is closed on purpose.
