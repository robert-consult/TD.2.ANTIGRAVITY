# TradeQuip Trading Platform - Design Guidelines

## Design Approach
**Reference-Based:** Professional trading platforms (Bloomberg Terminal, Interactive Brokers, TradingView)
**Principle:** Information density with visual hierarchy, instant data recognition, zero cognitive friction

## Core Design Elements

### Typography
- **Primary Font:** Inter (via Google Fonts CDN)
- **Monospace:** JetBrains Mono for numerical data, prices, time stamps
- **Hierarchy:**
  - Large prices/PnL: text-3xl to text-4xl, font-bold
  - Section headers: text-sm, font-semibold, uppercase tracking-wide
  - Data labels: text-xs, font-medium, opacity-70
  - Live prices: text-lg to text-2xl, font-mono
  - Regular text: text-sm

### Layout System
**Spacing Units:** Tailwind 2, 3, 4, 6, 8 for consistency
- Component padding: p-4, p-6
- Section gaps: gap-4, gap-6
- Tight data rows: py-2, py-3
- Generous panel spacing: p-8

### Application Structure

**Top Navigation Bar (h-16):**
- Logo left, account metrics center (balance, equity, margin), user profile/settings right
- Real-time PnL badge prominently displayed
- Fixed position, z-index hierarchy

**Sidebar Navigation (w-16 collapsed, w-64 expanded):**
- Icon-based: Dashboard, Markets, Portfolio, Orders, History, Analytics
- Collapsible with hover expansion
- Active state with left border accent

**Main Trading Grid (12-column):**
- **Left Panel (3 cols):** Watchlist with real-time prices, % changes, sparkline charts
- **Center Area (6 cols):** Primary trading chart (TradingView-style), technical indicators, timeframe selector
- **Right Panel (3 cols):** Order entry form, position details, recent trades

**Bottom Status Bar (h-12):**
- Connection status, market hours, data feed indicators

### Component Library

**Price Display Cards:**
- Large price with animated transitions on value change
- Green flash on price increase, red on decrease (subtle 200ms fade)
- Previous close, bid/ask spreads beneath
- Compact card style: rounded-lg, border border-white/5

**Chart Container:**
- Full-height centerpiece with dark canvas background
- Grid overlays at 10% opacity
- Candlestick charts with volume bars below
- Integrated drawing tools toolbar above chart
- Timeframe pills: 1m, 5m, 15m, 1h, 4h, 1D, 1W

**Order Entry Panel:**
- Tabbed interface: Market, Limit, Stop Loss
- Large input fields for amount/price
- BUY (green accent) / SELL (red accent) buttons - full width, h-12
- Risk calculator showing potential PnL below inputs
- Stop loss/take profit fields inline

**Data Tables:**
- Zebra striping with subtle row hover (#1A1A1A)
- Column headers sticky, uppercase text-xs
- Monospace for all numerical columns
- Color-coded PnL columns
- Compact row height (h-10 to h-12)

**Position Cards:**
- Current positions with entry price, current price, PnL
- Visual progress bar showing position size
- Close/modify action buttons inline
- Red/green border-l-4 based on profit/loss

### Visual Treatments

**Backgrounds:**
- App base: #0F0F0F
- Panels/cards: #1A1A1A
- Hover states: #242424
- Inputs: #0A0A0A with border-white/10

**Status Colors:**
- Profit green: #10B981
- Loss red: #EF4444
- Neutral/pending: #6B7280
- Warning: #F59E0B
- Info blue: #3B82F6

**Borders & Dividers:**
- Default: border-white/5
- Active elements: border-white/10
- Emphasis: border-white/20

**Data Visualization:**
- Candlestick up: green fill
- Candlestick down: red fill
- Volume bars: gradient from accent to transparent
- Grid lines: white at 5% opacity

### Animations
**Minimal, purposeful only:**
- Price updates: 200ms color flash
- Panel transitions: 150ms ease-in-out
- No decorative animations
- Loading states: subtle pulse on data refresh

### Icons
**Heroicons via CDN** - outline style for navigation, solid for status indicators

### Images
**No hero section or marketing images.** This is a functional trading dashboard. Use chart data visualizations and real-time numerical displays exclusively.

### Accessibility
- High contrast text (white/70 minimum on dark)
- All interactive elements min 44px touch target
- Keyboard navigation for all trading actions
- Screen reader labels for live price updates
- Focus indicators visible on all inputs

### Performance Considerations
- Lazy load non-visible panels
- Virtualize long watchlists/order histories
- Debounce real-time updates to 100ms
- WebSocket for live data, not polling