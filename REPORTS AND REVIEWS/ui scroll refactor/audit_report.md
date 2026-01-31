# TradeScreen Flickering Audit Report

## Executive Summary
The persistent flickering on the Trade Screen during header collapse is caused by a **layout hysteresis loop** involving the vertical scrollbar, the collapsible header, and the responsive table logic. 

The previous fix addressed the animation smoothness but did not resolve the fundamental layout instability where the scrollbar's appearance/disappearance triggers a feedback cycle.

## Root Cause Analysis

### 1. The Scrollbar Hysteresis Loop (Primary Cause)
The flickering is an infinite loop caused by the interaction between the collapsible header height and the container's overflow behavior.

**The Loop Mechanism:**
1.  **User Scrolls Down**: The `onScroll` handler fires, triggering `applyTradeHeaderCollapse`.
2.  **Header Shrinks**: The header height is reduced (e.g., from 200px to 60px).
3.  **Viewport Expands**: The main content area (`flex-1` container) grows vertically by ~140px.
4.  **Content Fits**: If the content (e.g., table rows) was only slightly taller than the *original* small viewport, it typically **fits entirely** within the *new* larger viewport.
5.  **Scrollbar Disappears**: Since `overflow-auto` is used (Line 1299), the browser removes the vertical scrollbar because it's no longer needed.
6.  **Layout Shift**:
    *   **Width Change**: Removing the scrollbar increases the available width (usually by ~15px).
    *   **Scroll Reset**: When the scrollbar disappears, the browser implicitly resets `scrollTop` to 0 (or clamps it), because the content is no longer scrollable.
7.  **Loop Trigger**:
    *   **Width Change** triggers the `ResizeObserver` (Line 197), causing a state update (`setPositionsContainerWidth`) and a React re-render.
    *   **Scroll Reset** triggers `applyTradeHeaderCollapse(0)`, which **expands the header** back to full size.
8.  **Revert**: With the header expanded, the viewport shrinks -> content no longer fits -> scrollbar reappears -> `scrollTop` is restored -> `applyTradeHeaderCollapse` runs -> Loop repeats.

### 2. Secondary Contributors
*   **ResizeObserver Thrashing**: The column-tuning logic (lines 432-533) listens to container width. The scrollbar flickering causes the width to oscillate, triggering expensive re-calculations of table columns on every frame of the flicker.
*   **Height Animation Reflows**: Modifying `shell.style.height` forces a browser layout reflow (calculation of positions) rather than just a repaint, making the flicker more visually jarring.

## Code Evidence
*   **File**: `client/src/pages/TradeScreen.tsx`
*   **Line 1299**: `className="flex-1 min-h-0 overflow-auto overscroll-contain"`
    *   `overflow-auto` allows the scrollbar to toggle on/off.
*   **Line 334**: `shell.style.height = ...`
    *   Direct manipulation of height changes the flex container size immediately.
*   **Line 197**: `const observer = new ResizeObserver(...)`
    *   Observes the container width, which changes when the scrollbar toggles.

## Recommendations

### 1. Stabilize Scrollbar (Critical Fix)
Prevent the scrollbar from disappearing when content fits. This breaks the feedback loop.
*   **Action**: Change `overflow-auto` to `overflow-scroll` or use `scrollbar-gutter: stable`.
*   **Effect**: The scrollbar track remains visible even when not needed, preventing width changes and scroll position resets.

### 2. Isolate Layout Updates
Avoid changing the physical height of the header shell if possible, or ensure the content container does not react to it in a way that creates a loop.
*   **Action**: Use `position: sticky` or CSS transforms for the visual collapse, avoiding layout thrashing. However, given the current "fixed header" design, stabilizing the scrollbar is the most direct fix.

### 3. Debounce Resize Logic
The responsive table logic (column hiding) is sensitive.
*   **Action**: Debounce the `ResizeObserver` updates for `setPositionsContainerWidth` to avoid reacting to rapid/transient width changes.

## Conclusion
The system is working "correctly" but creating an unstable equilibrium. The minimal safe fix is to **force the vertical scrollbar to be stable**, preventing the layout shift that drives the loop.
