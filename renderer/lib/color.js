/* ============================================================
   Colour arithmetic the stylesheet cannot do for itself.

   A member and an account each carry a colour of their own, chosen from a
   fixed palette and stored with the record. That colour arrives as a hex
   string at runtime, so anything derived from it has to be computed here
   rather than declared as a token: color-mix() in CSS can only reach a value
   the stylesheet already knows the name of.
   ============================================================ */

/* The fill under a glyph that is drawn in `hex` at full strength: the same
   hue at a fifth opacity, so the tile reads as a tint of its own icon rather
   than as a second colour beside it. Takes a hex literal only, which is what
   the palettes store; a CSS var() has no channels to read. */
function hexToSoft(hex) {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.20)`;
}

export { hexToSoft };
