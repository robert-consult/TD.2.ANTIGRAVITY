# Research Report: Maximizing Screen Real Estate in TradeQuip

## 1. Executive Summary
The logical next step for TradeQuip’s mobile experience is to transition from a "stacked web layout" to a **"native-app-like" implementation**. Currently, three separate sticky headers (Branding, Admin, Navigation) occupy approximately **150-180px** of vertical space, leaving insufficient room for data-dense trading tables on mobile screens.

We propose a **"Progressive Reduction" strategy**:
1.  **Consolidate**: Merge separate header rows into one.
2.  **Retreat**: Move navigation to the bottom (standard for financial apps).
3.  **Hide**: Use scroll mechanics to auto-hide branding while keeping critical data (Balance) accessible.

## 2. Current State Analysis
**Identified Components Contributing to "Staticness":**
-   **Top Bar (`Header.tsx`)**: Contains Logo, User Menu. ~60px height.
-   **Admin/Data Bar (`Dashboard.tsx`)**: Contains "Enable Admin Mode" and "Balance". ~50px height.
-   **Navigation Strip (`Navigation.tsx`)**: Horizontally scrolling list of tabs. ~50px height.

**Impact**: On a typical mobile screen, these stack to consume **20-25% of the viewport**.

## 3. Core Strategy: Adaptive Navigation
**Goal**: Native feel on mobile, Professional workstation feel on Desktop.

### 3.1 Mobile (< 768px)
*   **Bottom Navigation Bar**: Fixed at the bottom of the screen.
*   **Items**: Quotes, Chart, Trade, History, Account.
*   **Reasoning**: "Thumb zone" accessibility; clears the top header area entirely.

### 3.2 Desktop / Large Tablet (> 768px)
*   **Sidebar Navigation**: Fixed left vertical sidebar.
*   **Header**: Full-width, persistent top bar with full wording (Logo + "TradeQuip").
*   **Reasoning**: Maximizes horizontal space for charts/tables; matches professional trading terminal layouts.

## 4. Specific Strategy: The Trade Screen ("Data Density" Problem)
The Trade Screen faces a unique challenge: It requires displaying **Account Metrics** (Balance, Equity, Margin) AND **Live Market Data** AND **Active/Pending Positions** simultaneously.

### 4.1 The "Collapsible Account Ticker"
Instead of a static block that pushes content down:
*   **Initial State**: Full Grid (Balance, Equity, Free Margin, Used Margin).
*   **Scroll Behavior**: As the user scrolls down to see positions, the Account Grid **collapses** into a single-line "Ticker" or "Marquee" fixed at the top.
    *   *Collapsed View*: `Bal: $10k  |  Eq: $10.5k  |  Mrg: $500` (Horizontally scrollable or auto-scrolling).
*   **Interaction**: Tapping the ticker expands it back to the full grid.

### 4.2 "Card View" for Positions (Mobile)
Current tables use "hidden columns" on small screens, which hides critical info.
*   **Proposal**: Transform rows into **Cards** on mobile.
    *   **Desktop**: Standard Table Row.
    *   **Mobile**:
        ```
        [ EURUSD  |  BUY 1.0  |  +$50.00 ]
        [ 1.0850 -> 1.0860    |  TP/SL   ]
        ```
    * This ensures ALL data is visible without horizontal scrolling, just vertical scrolling.

### 4.3 Handling "Static" Elements
*   **Symbol Header**: Make it sticky but smaller.
    *   *Scroll Down*: `EURUSD 1.0850` (Small Bar)
    *   *Top*: Full Symbol Name + Daily Change + Spread Details.

## 5. Mockup Concept (Updated)

**Desktop (Sidebar):**
```
[ Logo ] [ Balance $1,000,000                        ]
|      |---------------------------------------------|
|      |  [ Active Positions Table (Full)          ] |
| Nav  |  [                                        ] |
|      |  [                                        ] |
|      |---------------------------------------------|
```

**Mobile (Bottom Nav + Collapsible Header):**
```
[ TradeQuip  $1M  (Avatar) ]  <-- Sticky Top Bar
-----------------------------
[ Bal: $1M  Eq: $1.1M ...  ]  <-- Account Ticker (Scrolls away or sticks compact)
-----------------------------
[ EURUSD Buy 1.0   +$500   ]  <-- Card View Item 1
[ 1.200 -> 1.205           ]
-----------------------------
[ GBPUSD Sell 0.5  -$20    ]  <-- Card View Item 2
-----------------------------
[ (Q)  (C)  (T)  (H)  (A)  ]  <-- Fixed Bottom Nav
```

## 6. Implementation Notes
1.  **`AppShell` Component**:
    *   Implement `media-query` logic (or Tailwind `hidden md:flex`) to swap between `SideNavigation` (Desktop) and `BottomNavigation` (Mobile).
2.  **`TradeScreen` Refactor**:
    *   Wrap Account Metrics in a `CollapsibleHeader` component that listens to window scroll.
    *   Update `Table` components to support a `mobileCard` prop that renders a `div` stack instead of `tr/td` on small screens.
