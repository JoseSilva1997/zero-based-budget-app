/* ============================================================
   The two icon sets, and the two wrappers that draw them.

   Icons is the app's own stroke set, drawn on a 24x24 canvas at stroke 1.7.
   MsIcons is Material Symbols, used by the sidebar nav alone. They are kept
   apart because they are drawn on different canvases and cannot share a
   wrapper; see Ms below.
   ============================================================ */

/* ---- the stroke set -----------------------------------------------------
   Every icon here is decorative: it sits next to a label, or inside a button
   that carries its own name. Hiding the svg keeps assistive tech from reading
   an unnamed graphic beside the name that already says the same thing. The
   attribute goes before the spread so a caller can still opt back in. */
function Ic({ d, size = 18, fill, children, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={fill || "none"} stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children ?? (Array.isArray(d) ? d.map((x, i) => <path key={i} d={x} />) : <path d={d} />)}
    </svg>
  );
}
/* ---- Material Symbols (sidebar nav only) --------------------------------
   The nav was drawn with Material Symbols Outlined, and the active item with
   the family's FILL axis turned on. Rather than load the icon font - which
   would be a network request in an app that deliberately has none, or a
   multi-megabyte variable font to self-host for four glyphs - the eight paths
   are lifted from @material-symbols/svg-400, a devDependency used purely as
   an asset source. Exactly the arrangement @fontsource/plus-jakarta-sans
   already has: npm supplies the asset, nothing is imported at runtime.

   These are filled shapes on Material's own 0 -960 960 960 canvas, not 24x24
   stroke paths, so they cannot go through Ic above. fill="currentColor" is
   what lets .nav-item's colour rules reach them, the same way stroke
   ="currentColor" does for the stroke set. */
function Ms({ d, size = 22, ...p }) {
  return (
    <svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor"
      aria-hidden="true" {...p}><path d={d} /></svg>
  );
}
const MsIcons = {
  dashboard: (p) => <Ms {...p} d="M510-570v-270h330v270H510ZM120-450v-390h330v390H120Zm390 330v-390h330v390H510Zm-390 0v-270h330v270H120Zm60-390h210v-270H180v270Zm390 330h210v-270H570v270Zm0-450h210v-150H570v150ZM180-180h210v-150H180v150Zm210-330Zm180-120Zm0 180ZM390-330Z" />,
  dashboardFill: (p) => <Ms {...p} d="M510-570v-270h330v270H510ZM120-450v-390h330v390H120Zm390 330v-390h330v390H510Zm-390 0v-270h330v270H120Z" />,
  calendar: (p) => <Ms {...p} d="M180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Zm0-490h600v-130H180v130Zm0 0v-130 130Zm300 230q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240Z" />,
  calendarFill: (p) => <Ms {...p} d="M480-400q-17 0-28.5-11.5T440-440q0-17 11.5-28.5T480-480q17 0 28.5 11.5T520-440q0 17-11.5 28.5T480-400Zm-188.5-11.5Q280-423 280-440t11.5-28.5Q303-480 320-480t28.5 11.5Q360-457 360-440t-11.5 28.5Q337-400 320-400t-28.5-11.5ZM640-400q-17 0-28.5-11.5T600-440q0-17 11.5-28.5T640-480q17 0 28.5 11.5T680-440q0 17-11.5 28.5T640-400ZM480-240q-17 0-28.5-11.5T440-280q0-17 11.5-28.5T480-320q17 0 28.5 11.5T520-280q0 17-11.5 28.5T480-240Zm-188.5-11.5Q280-263 280-280t11.5-28.5Q303-320 320-320t28.5 11.5Q360-297 360-280t-11.5 28.5Q337-240 320-240t-28.5-11.5ZM640-240q-17 0-28.5-11.5T600-280q0-17 11.5-28.5T640-320q17 0 28.5 11.5T680-280q0 17-11.5 28.5T640-240ZM180-80q-24 0-42-18t-18-42v-620q0-24 18-42t42-18h65v-60h65v60h340v-60h65v60h65q24 0 42 18t18 42v620q0 24-18 42t-42 18H180Zm0-60h600v-430H180v430Z" />,
  /* history has no fill variant: the two files in the package are byte for
     byte the same glyph, so the active state carries only the ink change. */
  history: (p) => <Ms {...p} d="M477-120q-149 0-253-105.5T120-481h60q0 125 86 213t211 88q127 0 215-89t88-216q0-124-89-209.5T477-780q-68 0-127.5 31T246-667h105v60H142v-208h60v106q52-61 123.5-96T477-840q75 0 141 28t115.5 76.5Q783-687 811.5-622T840-482q0 75-28.5 141t-78 115Q684-177 618-148.5T477-120Zm128-197L451-469v-214h60v189l137 134-43 43Z" />,
  settings: (p) => <Ms {...p} d="m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-18l20-127h184l20 126q19 7 40.5 18.5T669-710l118-54 93 164-108 77q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l108 78-93 164-118-54q-16 13-36.5 25.5T592-206L572-80H388Zm48-60h88l14-112q33-8 62.5-25t53.5-41l106 46 40-72-94-69q4-17 6.5-33.5T715-480q0-17-2-33.5t-7-33.5l94-69-40-72-106 46q-23-26-52-43.5T538-708l-14-112h-88l-14 112q-34 7-63.5 24T306-642l-106-46-40 72 94 69q-4 17-6.5 33.5T245-480q0 17 2.5 33.5T254-413l-94 69 40 72 106-46q24 24 53.5 41t62.5 25l14 112Zm44-210q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Zm0-130Z" />,
  settingsFill: (p) => <Ms {...p} d="m388-80-20-126q-19-7-40-19t-37-25l-118 54-93-164 108-79q-2-9-2.5-20.5T185-480q0-9 .5-20.5T188-521L80-600l93-164 118 54q16-13 37-25t40-18l20-127h184l20 126q19 7 40.5 18.5T669-710l118-54 93 164-108 77q2 10 2.5 21.5t.5 21.5q0 10-.5 21t-2.5 21l108 78-93 164-118-54q-16 13-36.5 25.5T592-206L572-80H388Zm92-270q54 0 92-38t38-92q0-54-38-92t-92-38q-54 0-92 38t-38 92q0 54 38 92t92 38Z" />,
};

const Icons = {
  /* Rounded rects need rx, which a stroke path cannot carry, so grid and
     calendar pass elements through Ic rather than d strings. */
  grid: (p) => <Ic {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.8" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.8" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.8" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.8" />
  </Ic>,
  calendar: (p) => <Ic {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M8 3v4" /><path d="M16 3v4" /><path d="M3.5 10.5h17" />
  </Ic>,
  budget: (p) => <Ic {...p} d={["M3 7h18v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z","M3 7l2-3h14l2 3","M16 12h2"]} />,
  history: (p) => <Ic {...p} d={["M3 12a9 9 0 1 0 3-6.7L3 8","M3 4v4h4","M12 8v4l3 2"]} />,
  settings: (p) => <Ic {...p} d={["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z","M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 6.6 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 4.6 14H4.5a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.1-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 11 4.6V4.5a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 19.4 11h.1a2 2 0 1 1 0 4h-.1Z"]} />,
  left: (p) => <Ic {...p} d="M15 18l-6-6 6-6" />,
  right: (p) => <Ic {...p} d="M9 18l6-6-6-6" />,
  down: (p) => <Ic {...p} d="M6 9l6 6 6-6" />,
  up: (p) => <Ic {...p} d="M18 15l-6-6-6 6" />,
  plus: (p) => <Ic {...p} d={["M12 5v14","M5 12h14"]} />,
  trash: (p) => <Ic {...p} d={["M3 6h18","M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2","M6 6l1 14a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-14"]} />,
  x: (p) => <Ic {...p} d={["M18 6 6 18","M6 6l12 12"]} />,
  check: (p) => <Ic {...p} d="M20 6 9 17l-5-5" />,
  drag: (p) => <Ic {...p} d={["M9 6h.01","M15 6h.01","M9 12h.01","M15 12h.01","M9 18h.01","M15 18h.01"]} />,
  move: (p) => <Ic {...p} d={["M13 5V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-6a1 1 0 0 1-1-1v-1","M3 12h11","M10 8l4 4-4 4"]} />,
  download: (p) => <Ic {...p} d={["M12 3v12","M7 10l5 5 5-5","M5 21h14"]} />,
  upload: (p) => <Ic {...p} d={["M12 21V9","M7 14l5-5 5 5","M5 3h14"]} />,
  folder: (p) => <Ic {...p} d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
  sun: (p) => <Ic {...p} d={["M12 4V2","M12 22v-2","M4 12H2","M22 12h-2","M5.6 5.6 4.2 4.2","M19.8 19.8l-1.4-1.4","M18.4 5.6l1.4-1.4","M4.2 19.8l1.4-1.4","M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z"]} />,
  moon: (p) => <Ic {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  monitor: (p) => <Ic {...p} d={["M3 5h18v11H3z","M8 21h8","M12 16v5"]} />,
  alert: (p) => <Ic {...p} d={["M12 9v4","M12 17h.01","M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"]} />,
  coins: (p) => <Ic {...p} d={["M8 8a5 3 0 1 0 0-6 5 3 0 0 0 0 6Z","M3 5v6c0 1.7 2.2 3 5 3s5-1.3 5-3V5","M3 11c0 1.7 2.2 3 5 3","M16 10c2.8 0 5 1.3 5 3v6c0 1.7-2.2 3-5 3s-5-1.3-5-3v-3"]} />,
  user: (p) => <Ic {...p} d={["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z","M5 21a7 7 0 0 1 14 0"]} />,
  plant: (p) => <Ic {...p} d={["M12 22V11","M12 11c0-3 2-6 6-6 0 3-2 6-6 6Z","M12 14c0-2.6-1.7-5-5-5 0 2.6 1.7 5 5 5Z"]} />,
  edit: (p) => <Ic {...p} d={["M12 20h9","M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z"]} />,
  copy: (p) => <Ic {...p} d={["M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1Z","M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"]} />,
  bell: (p) => <Ic {...p} d={["M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z","M10.5 19a1.8 1.8 0 0 0 3 0"]} />,
  wallet: (p) => <Ic {...p} d={["M21 12V7H5a2 2 0 0 1 0-4h14v4","M3 5v14a2 2 0 0 0 2 2h16v-5","M18 12a2 2 0 0 0 0 4h4v-4h-4Z"]} />,
  search: (p) => <Ic {...p} d={["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z","M20 20l-4.2-4.2"]} />,
};

export { Icons, MsIcons };
