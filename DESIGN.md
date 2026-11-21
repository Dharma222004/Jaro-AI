# DESIGN.md — JARO AI Institutional Equity Design System

> **Product:** JARO AI  
> **Category:** Institutional Equity Intelligence, Quantitative Confluence Engine & Autonomous Financial Research  
> **Design Philosophy:** *Bloomberg Terminal meets Modern AI Interface* — ultra-crisp dark-mode ergonomics, institutional data density without clutter, zero-overlap layouts, and deterministic transparency.  
> **Version:** 2.0.0 (Institutional Standard)

---

## 1. Product Overview & Design Vision

JARO AI is an institutional-grade investment decision and company intelligence platform engineered for Indian equities (NSE & BSE). It combines real-time multi-timeframe exchange data, universal company entity resolution, and the deterministic **QTVT Method v2** (Quality · Trend · Value · Trigger) confluence engine.

### Core Experience Attributes
- **Corporate Dark-First Canvas:** Built primarily for intensive financial market research and desktop execution, with seamless mobile responsiveness.
- **Deterministic Transparency:** The UI clearly separates code-computed levels (entry zones, structural stops, multi-target clusters) from LLM explanations.
- **Zero Ambiguity & Non-Overlapping Layouts:** Strict grid and flex structures ensure metrics, progress bars, and badges never clip or collide.
- **Institutional Trust:** High-contrast data presentation, verified source tags, and regulatory disclosures embedded naturally.

---

## 2. Color Palette & Design Tokens

### 2.1 Surfaces & Canvas (Dark Theme Hierarchy)
```css
/* Base Canvas & Backgrounds */
--bg-lowest:          #070A0F;  /* Deepest contrast, backdrop */
--bg-base:            #0B0F14;  /* Primary application background */
--bg-sidebar:         #0E131B;  /* Navigation sidebar container */
--bg-surface:         #121A25;  /* Main workspace container / panel */
--bg-card:            #172231;  /* Standard card surface */
--bg-elevated:        #1C2838;  /* Elevated card / hover state / popover */
--bg-overlay:         #223247;  /* Modal overlay / active drawer */

/* Borders & Dividers */
--border-subtle:      #1C2838;  /* Subtle dividers, hairline separators */
--border-default:     #273548;  /* Card borders, inputs, default outlines */
--border-strong:      #3B4D66;  /* Focused inputs, active cards, highlighted zones */
```

### 2.2 Brand Signature Accents
- **Electric Cobalt (Primary):** `#3B82F6` | Hover: `#2563EB` | Subtle Dim: `rgba(59, 130, 246, 0.14)`  
  *Used for primary actions, focus rings, interactive toggles, active navigation, and technical chart indicators.*
- **Alpha Jade (Secondary / Confluence):** `#22C55E` | Hover: `#16A34A` | Subtle Dim: `rgba(34, 197, 94, 0.14)`  
  *Used for high fundamental quality, verified gates, bullish triggers, and actionable trade setups.*

### 2.3 Financial Semantic Colors
- **Positive / Bullish / Actionable:** `#22C55E` (Emerald) | Dim: `rgba(34, 197, 94, 0.15)`
- **Wait / Developing / Pullback:** `#F59E0B` (Amber) | Dim: `rgba(245, 158, 11, 0.15)`
- **Negative / Avoid / Invalidation:** `#EF4444` (Crimson) | Dim: `rgba(239, 68, 68, 0.15)`
- **Neutral / Watchlist / Informative:** `#38BDF8` (Sky Blue) | Dim: `rgba(56, 189, 248, 0.15)`
- **Insufficient Data / Stale:** `#94A3B8` (Slate Gray) | Dim: `rgba(148, 163, 184, 0.15)`

### 2.4 Typography Colors
- **Primary Text:** `#F8FAFC` (High emphasis, numbers, titles, scores)
- **Secondary Text:** `#CBD5E1` (Standard descriptions, explanations, table data)
- **Muted Text:** `#94A3B8` (Labels, timestamps, captions, field headings)
- **Accent Text:** `#60A5FA` (Interactive links, active filter pills)

---

## 3. Typography & Font System

### 3.1 Font Families
- **Primary Interface Font:** `'Varela Round', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`  
  *Smooth, legible, modern aesthetic that softens technical complexity.*
- **Financial & Numerical Monospace:** `'Geist Mono', 'SFMono-Regular', Consolas, monospace`  
  *Used strictly for currency figures (₹), stock tickers, percentages, moving averages, and quantitative tabular data.*

### 3.2 Type Scale
| Level | Font Size | Weight | Line Height | Usage |
| :--- | :--- | :--- | :--- | :--- |
| **Display** | 2.25rem (36px) | 700 Bold | 1.15 | Hero headings, ticker title |
| **Heading 1** | 1.50rem (24px) | 700 Bold | 1.25 | Section headers, major modal titles |
| **Heading 2** | 1.15rem (18px) | 600 SemiBold | 1.35 | Card titles, trade plan sections |
| **Heading 3** | 0.95rem (15px) | 600 SemiBold | 1.40 | Score card titles, sub-level headings |
| **Body** | 0.85rem (13.6px) | 400 Regular | 1.50 | Research paragraphs, explanations |
| **Body Small** | 0.78rem (12.5px) | 400 Regular | 1.45 | Card descriptions, secondary text |
| **Caption / Chip** | 0.68rem (11px) | 500 Medium | 1.20 | Metric chips, source badges, status pills |
| **Mono Numbers** | 0.82rem – 1.1rem | 700 Bold | 1.00 | Prices, targets, scores (`85/100`) |

---

## 4. Layout Architecture & Component Design

### 4.1 Global Layout Grid
- **Navigation Sidebar (Left):** 240px fixed width (collapsible to 68px icon rail on compact screens).
- **Main Workspace (Center):** Fluid width with max-width container `1440px`.
- **Research Drawer / Chat (Slide-out or Split):** 420px width on desktop for uninterrupted side-by-side analysis.

---

### 4.2 Score Cards Grid (`.decision-score-grid-v2`)
The core 4-pillar analysis panel displaying:
1. **Fundamentals** (`Building2` icon)
2. **Valuation** (`Scale` icon)
3. **Technical** (`Activity` icon)
4. **Risk Resilience** (`ShieldAlert` icon)

#### Visual & Spatial Rules:
- **Container:** 2-column CSS Grid (`grid-template-columns: repeat(2, minmax(0, 1fr))`) on desktop; 1-column on mobile (`< 768px`).
- **Card Padding:** `1.05rem 1.15rem` with `border-radius: 12px`, `background: #111827`, and `border: 1px solid #263244`.
- **Top-Right Score Badge:** Formatted as normal bold text (`85/100`) inside a subtle capsule badge (`background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.14)`).
- **Proportioned Progress Bar:** 4px height track positioned directly under the header row, strictly before description text to prevent any overlap.
- **Supporting Evidence Chips:** Up to 4 metric chips per card (e.g., `P/E: 24.5`, `SMA 50: ₹1,340`, `Pledge: 0.0%`).
- **Footer Strip:** Left-aligned Data Coverage badge (`100% DATA COVERAGE`) with right-aligned `View Details` expandable drawer.

---

### 4.3 JARO Method v2 — QTVT Trade Plan Card
The central execution component rendering the deterministic trade plan:
- **Verdict Header Banner:**
  - Pill badges for Verdict: `ACTIONABLE` (Green), `WAIT_FOR_ENTRY` (Amber), `WATCHLIST` (Cyan), `AVOID` (Rose).
  - Data Confidence badge (`High`, `Medium`, `Low` with percentage).
- **Price Architecture Matrix (3-Column / Responsive 1-Column):**
  1. **Entry Setup:** Confluence range (e.g. `₹1,180 – ₹1,205`), Trigger price (`Close > ₹1,260`), and Chase Limit $E_{max}$ (`₹1,220`).
  2. **Structural Stop-Loss:** Calculated from support low minus $0.75 \times \text{ATR}$ (e.g. `₹1,135` · 1.8 ATR / -5.8% risk). Includes trailing rules.
  3. **Multi-Target Cluster:**
     - **Target 1:** Nearest resistance (Book 40% · Net R: `1.8:1`).
     - **Target 2:** Measured Fibonacci extension (Book 30% · Net R: `2.8:1`).
     - **Target 3:** Trailing runner (Book 30% · Net R: `3.5:1`).
- **Net R/R Matrix:** Explicitly displays Net R/R at CMP, at Zone Midpoint, and Blended Net Expected R after statutory taxes and slippage.
- **Position Sizing Strip:** Suggested shares, planned loss budget (e.g. ₹10,000 / 1% capital), and active portfolio caps.
- **Confluence Gate Audit:** Collapsible 9-gate audit table (L0 to L8) with sequential gate states (`PASS`, `WAIT`, `UNVERIFIED`, `N/A`, `FAIL`).

---

### 4.4 Assistant Chat & Input Capsule
- **Composer Capsule:** Floating bottom bar with `background: rgba(18, 26, 37, 0.92)`, frosted backdrop blur (`16px`), and soft border `#273548`.
- **Capabilities:** Multiline auto-expanding textarea, file attachment button, horizon selector toggle (`SWING` vs `POSITION`), reasoning trace toggle, and instant submission button.

---

## 5. Responsive Design Breakpoints

| Breakpoint | Target Screen | Layout Behavior |
| :--- | :--- | :--- |
| **< 640px** | Mobile Portrait | Single column, score cards stacked, horizontal scroll chips, sticky bottom input. |
| **640px – 768px** | Mobile Landscape | Single column with compact headers, 52-week slider compressed. |
| **768px – 1024px** | Tablets / Small Laptops | 2-column score grid, sidebar collapses to icon rail (68px). |
| **1024px – 1440px** | Standard Desktop | Full 240px sidebar, 2-column score grid, 3-column target cards, floating chat drawer. |
| **> 1440px** | Ultra-wide Displays | Fixed 1440px container, multi-pane side-by-side terminal layout. |

---

## 6. Brand Assets Reference

When importing visual assets into UI design tools:
- **Primary Institutional Logo:** `public/jaro-institutional-logo.png` (512x512 Dark FinTech badge)
- **Vector Brand Mark:** `public/jaro-mark.svg` & `public/jaro-logo.svg`
- **Light Theme Vector Variant:** `public/jaro-logo-light.svg`
- **Sidebar Compact Mark:** `public/jaro-sidebar-logo.svg`
- **App Favicon:** `app/icon.svg`
