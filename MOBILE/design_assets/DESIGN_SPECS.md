# TradeQuip Mobile App - Design Specifications

## 1. Overview
*   **App Name**: TradeQuip
*   **Theme**: Dark Mode, Financial/Trading, Glassmorphism, Premium.
*   **Target Device**: Android (Mobile).

## 2. Color Palette

### Backgrounds
*   **Main Background**: Deep Radial Gradient.
    *   Center: `#0e1a35`
    *   Edges: `#050914`
*   **Surface/Cards**: Glassmorphism.
    *   Fill: `rgba(255, 255, 255, 0.03)`
    *   Border: `1px solid rgba(255, 255, 255, 0.1)`
    *   Shine/Glow: Top-left subtle white highlight.

### Accents
*   **Primary Action**: Electric Blue / Cyan Gradient.
    *   From `#00E5FF` to `#2979FF`
*   **Success (Profit)**: Neon Green `#00E676` or `#69F0AE` - *Text and Icons ONLY. NO Green Backgrounds/Cards.*
*   **Error (Loss)**: Soft Red `#FF5252` or `#FF4081` - *Text and Icons ONLY.*

### Typography Colors
*   **Primary Text**: `#FFFFFF` (100% opacity)
*   **Secondary Text**: `#B0BEC5` (70% opacity)
*   **Disabled**: `#546E7A` (40% opacity)

## 3. Typography System
*   **Font Family**: `Inter` or `Roboto` (System default sans-serif).
*   **Hierarchy**:
    *   **H1 (Portfolio Value)**: 40px, Bold (700).
    *   **H2 (Section Titles)**: 20px, Semi-Bold (600).
    *   **H3 (Card Titles)**: 16px, Medium (500).
    *   **Body**: 14px, Regular (400).
    *   **Caption**: 12px, Regular (400), Secondary Color.

## 4. Components

### A. Glass Card
*   **Border Radius**: 24px.
*   **Backdrop Filter**: Blur 12px.
*   **Shadow**: `0 8px 32px 0 rgba(0, 0, 0, 0.37)`.

### B. Primary Button
*   **Height**: 56px.
*   **Radius**: Full pill shape (28px).
*   **Background**: Linear Gradient (Cyan to Blue).
*   **Text**: White, Semi-Bold, Uppercase or Title Case.
*   **Shadow**: Glowing drop shadow (`box-shadow: 0 0 15px rgba(0, 229, 255, 0.5)`).

### C. Input Fields
*   **Background**: Translucent Dark (`rgba(0, 0, 0, 0.2)`).
*   **Border**: 1px solid `rgba(255, 255, 255, 0.1)`.
*   **Radius**: 12px.
*   **Text**: White.
*   **Placeholder**: Gray (`#78909C`).

## 5. Screen Layouts

### Sign In
*   Centered content.
*   Logo at the top.
*   Inputs: Email, Password.
*   Action: Sign In Button.
*   Footer: Social Login, Sign Up Link.

### Sign Up
*   Similar to Sign In.
*   Additional Inputs: Full Name, Confirm Password.

### Dashboard
*   **Top Bar**: Menu Icon (Left), Logo (Center), Notifications/Settings (Right).
*   **Portfolio Card**: Large visually dominant card showing total value.
*   **Quick Stats**: Grid of 2x2 small glass cards (Equity, Margin, P&L, Positions).
*   **Action Button**: "Quick Trade" bright button.
*   **Active Positions**: List view of current trades with logos and live P&L.
*   **Bottom Navigation**: Glass bar with 5 icons (**Quotes**, **Charts**, **Trade**, **History**, **Account**). Order must be strictly followed.

### Strict Theme Alignment (Charts, History, Profile)
*   **Backgrounds**: MUST be Deep Navy/Black Gradient (`#050914` to `#0e1a35`). **ABSOLUTELY NO GREEN BACKGROUNDS.**
*   **Cards**: Glassmorphism with dark tint.
*   **Charts Screen**: Full screen dark mode. Candles are Green/Red, but grid/background is Dark.
*   **History Screen**: List items must be on dark glass cards. Profit amounts are green text, NOT green card backgrounds.
*   **Profile/Settings**: Clean dark list items. No colorful backgrounds for the header.

## 6. Icons & Logos
*   Use simple, stroke-based icons (App bar, Bottom nav).
*   TradeQuip Logo: Stylized "TQ" or "T" with an upward arrow.
