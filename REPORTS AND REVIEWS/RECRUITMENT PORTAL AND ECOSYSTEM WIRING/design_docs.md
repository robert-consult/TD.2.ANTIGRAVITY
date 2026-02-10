# Partner Portal - Identity & Institutional Profile Design Enhancements

## Problem
The current "Identity & Institutional Profile" section is a long, monolithic form that can be overwhelming. Users struggle to differentiate between various types of information (Identity vs. Legal vs. Operations).

## Design Goal
Use **color-coded sections** and **distinct visual grouping** to guide the user's eye and mentally categorize information without breaking the flow.

## Proposed Design Specs (Colorwise & Structural)

The design will split the single long form into **5 Distinct Zones**. Each zone will have a subtle background tint and a color-coded accent border.

### 1. Core Identity Zone (Theme: Slate/Blue)
*Focus: Who are they?*
- **Fields**: Fund Name, Legal Entity Name, Trading Name (DBA), Entity Type, Fund Logo.
- **Visuals**: 
    - Border: `border-l-4 border-l-blue-500`
    - Background: `bg-blue-500/5`
    - Header Icon: 🏢 (Building/Entity)

### 2. Digital & Communication Zone (Theme: Indigo/Violet)
*Focus: How to reach/view them?*
- **Fields**: Website URL, Social Profiles, General Emails, Points of Contact.
- **Visuals**:
    - Border: `border-l-4 border-l-indigo-500`
    - Background: `bg-indigo-500/5`
    - Header Icon: 🌐 (Globe/Network)

### 3. Location & Jurisdiction Zone (Theme: Teal/Cyan)
*Focus: Where are they legally?*
- **Fields**: HQ Location, Domicile Country, Incorporation Country, Registration Countries, Addresses.
- **Visuals**:
    - Border: `border-l-4 border-l-teal-500`
    - Background: `bg-teal-500/5`
    - Header Icon: 🗺️ (Map/Location)

### 4. Operations & Strategy Zone (Theme: Amber/Orange)
*Focus: What do they do?*
- **Fields**: AUM Range, Strategy Tags, Business Description, Base Currency, Primary Timezone, Inception Year, Employee Count.
- **Visuals**:
    - Border: `border-l-4 border-l-amber-500`
    - Background: `bg-amber-500/5`
    - Header Icon: 📈 (Chart/Growth)

### 5. Regulatory & Service Providers Zone (Theme: Rose/Red or Neutral)
*Focus: Compliance & Trust*
- **Fields**: Regulators, SEC/CRD/NFA IDs, Tax ID, LEI, Service Providers (Prime Broker, Auditor, etc.).
- **Visuals**:
    - Border: `border-l-4 border-l-rose-500` (or Neutral-600 for strictly formal)
    - Background: `bg-rose-500/5` (or `bg-neutral-500/5`)
    - Header Icon: ⚖️ (Scales/Legal)

## Implementation Details (Tailwind CSS)

Instead of a single `grid md:grid-cols-2`, wrap each zone in a container:

```jsx
<section className="group relative rounded-md border border-neutral-800 bg-neutral-900/50 overflow-hidden">
  <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500" /> {/* Accent Bar */}
  <div className="p-4">
    <h3 className="text-sm font-semibold text-blue-200 mb-3 flex items-center gap-2">
      <BuildingIcon className="w-4 h-4" /> Core Identity
    </h3>
    <div className="grid gap-3 md:grid-cols-2">
      {/* Inputs... */}
    </div>
  </div>
</section>
```


## Additional Tabs Design Specs

### 6. Legal & Approval (Theme: Rose/Red)
*Focus: Compliance & Binding Agreements*
- **Visuals**: `border-l-4 border-l-rose-500`, `bg-rose-500/5`
- **Structure**:
    - **Compliance Doc Block**: KYB URL input.
    - **Attestation Block**: Checkboxes for Master Allocation & NDA.
    - **Action Block**: Request Contact / Submit Legal buttons grouped at the bottom right.

### 7. Trader Access Zones
The Trader Access section is divided into functional sub-tabs. Each should have a distinct theme to separate the "mode" of work.

#### A. Data Room (Theme: Sky/Cyan)
*Focus: Analysis & Discovery*
- **Layout**: Split View (List | Detail).
- **List Panel (Candidates)**: `bg-neutral-900` with sticky header. Rows highlight on `hover:bg-sky-500/10`.
- **Detail Panel (Tear Sheet)**: "Sticky" card on the right. `border-l-2 border-l-sky-500`.
- **Metrics**: Highlights (Sharpe, PnL) should pop against the dark background.

#### B. Simulations (Theme: Violet/Purple)
*Focus: Testing & Projections (The "Lab")*
- **Input Card ("Parameters")**: `border-l-4 border-l-violet-500`. clearly separates inputs (HashId, Notional, Horizon) from results.
- **Result Card ("Projection")**: 
    - Gradient background for high confidence/positive result (`bg-gradient-to-br from-violet-500/10 to-emerald-500/10`).
    - Large typography for Projected PnL.

#### C. Allocations (Theme: Emerald/Green)
*Focus: Real Money / Capital Deployment*
- **Create Card ("Deployment")**: `border-l-4 border-l-emerald-500`.
- **Table ("Active Book")**: Green accent headers. Status badges for "ACTIVE" (Green) vs "STOPPED" (Red/Gray).

#### D. Comms (Theme: Amber/Orange)
*Focus: Support & Inquiries*
- **Compose Card ("Secure Channel")**: `border-l-4 border-l-amber-500`.
- **History Card ("Message Log")**: `bg-neutral-900`.
- **Inbox Info**: Highlight the encryption status and key availability.
