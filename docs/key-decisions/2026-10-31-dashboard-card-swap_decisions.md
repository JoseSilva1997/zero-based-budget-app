# 2026-10-31 key decisions: dashboard card swap

**Related:** [dashboard](../features/dashboard_feature.md) · builds on [dashboard cards](2026-10-31-dashboard-cards_decisions.md), decision 2

**Engineer** is the person who works on the app. The **Coding Agent** built it.

The first grid refused any move onto another card. The Engineer asked that the two cards simply swap places instead.

## 1. Each card takes the other's top-left cell and keeps its size

- **Context:** cards on the grid can be different sizes, so "swap places" has more than one meaning when they are.
- **Decision:** the two cards exchange top-left cells and each keeps its own width and height. Two cards the same size swap exactly. For different sizes the swap is made only if both still fit inside the grid, clear of each other and of every other card; otherwise nothing changes, as with any move that does not fit.
- **Alternatives:** swap the rectangles, so each card takes the other's size too; push other cards aside to make a swap fit.
- **Why:** a card's size is a choice the household made about how much that stat matters (decision 2 of the cards change), so a move should not undo it. Pushing other cards would move cards the household did not touch.
- **Decided by:** Engineer (swap); Coding Agent (sizes kept, refused when it does not fit).

## 2. A drag swaps when the pointer is over another card

- **Context:** a drag shifts the card by the cells the pointer has moved, so a large card can overlap a neighbour while the pointer is still over itself or a free cell.
- **Decision:** dropping with the pointer over another card swaps with that card. Otherwise the card shifts as before. While dragging, the card's own landing place is outlined, and a swap adds a dashed outline where the other card would go. With the keyboard, an arrow that would move a card onto exactly one other card swaps the two.
- **Alternatives:** swap with whichever card the shifted rectangle overlaps most.
- **Why:** the pointer is the clearest statement of "this card": what is under it is what gets swapped, and the second outline shows the result before letting go.
- **Decided by:** Coding Agent.
