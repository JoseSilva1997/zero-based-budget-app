/* ============================================================
   The object row: a thing, and what is true of it.

   A tile or avatar on the left, the thing's name with a line of detail under
   it, and its figure on the right. It is the shape the Wallet is built out of
   almost entirely, and the one a household reads most often in this app, so
   it is worth being a single object rather than a shape each list redraws.
   ============================================================ */
import { cx } from '../lib/index.js';

/* Three sizes, and the size says how deep the row sits rather than how
   important it is: `lg` is a summary standing on its own in a stack, the
   default is a row in a list, and `sm` is a row nested inside another row.
   The figure steps down that ladder and the name follows it.

   The slots, left to right:
     lead       an avatar or a tinted tile; absent on a nested row
     name       what the thing is called. Always clipped to one line: a name
                that wrapped would make one row in a list taller than its
                neighbours, which is worse than an ellipsis
     chip       a pill sitting beside the name rather than under it
     sub        one line of detail, clipped the same way
     meta       a run of small facts: a count, a bar, an amount, a pill
     trail      a control between the text and the figure, e.g. a caret
     figure     the amount, with figureSub as its footnote

   `sub` and `meta` are both second lines and are deliberately not one slot:
   a sub is prose about the thing and a meta is a row of separate readings, and
   they set differently because of it. */
function ObjectRow({
  size = "md",
  lead, name, chip, sub, meta, trail, figure, figureSub,
  as: Tag = "div", className, ...rest
}) {
  /* The two modifiers are spelled out rather than built from `size`: a class
     assembled at runtime is a class no grep can find, and everything else in
     this renderer can be found by searching for it. */
  return (
    <Tag className={cx("object-row", size === "lg" && "is-lg", size === "sm" && "is-sm", className)} {...rest}>
      {lead}
      <div className="object-row-grow">
        {/* With a chip the name needs a flex row to sit the two on one
            baseline, so the ellipsis moves onto the name's own span. Without
            one the name is the whole block and can carry it itself. */}
        <div className={cx("object-row-name", chip && "has-chip", !chip && "truncate")}>
          {chip ? <span className="truncate">{name}</span> : name}
          {chip}
        </div>
        {sub && <div className="object-row-sub truncate">{sub}</div>}
        {meta && <div className="object-row-meta">{meta}</div>}
      </div>
      {trail}
      {figure != null && (
        <div className="object-row-figs">
          <div className="num object-row-figure">{figure}</div>
          {figureSub && <div className="num object-row-figure-sub">{figureSub}</div>}
        </div>
      )}
    </Tag>
  );
}

export { ObjectRow };
