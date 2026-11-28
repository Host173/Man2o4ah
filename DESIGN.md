---
name: "Voyara — Design System"
description: "Warm cream surfaces, deep navy frames, and dusk photography with one orange action color for the Voyara travel platform."
---

# Voyara Design System

The single source of truth for how Voyara looks, behaves and is built on the frontend. It is taken
from the approved Voyara mockups (six screens: Home, Search results, Destination details, Plan your
trip, Booking summary, My trips). Tokens live in `frontend/src/shared/styles/tokens.css`
(Appendix A). If a rule you need is missing, ask the team lead, then add it here in the same PR.

Companion documents: _Frontend pages and flows_ (pages P01 to P52, features X01 to X10, flows) and
_Frontend diagrams_. This file says how pages look. It never changes what they contain.

**Scope rule:** this file only describes what the mockups show, plus the form and feedback controls
every page needs, drawn from the same tokens. Anything the pages document asks for that the mockups
do not show is listed in section 17 as _not yet designed_. It gets a design first, then a section
here. Nobody invents a component in the meantime.

**Status:** palette, type, spacing, components and the six screen recipes are defined. Nothing is
built yet. Items marked _Proposed_ wait for the team lead's confirmation.

---

## 1. Principles

The photograph is the page. Dusk photography of real destinations carries the emotion.
The interface around it remains quiet: cream surfaces, a navy frame and one orange
action color.

One clear next step. Each section has at most one primary (orange) action.

Data is dynamic. Prices, counts, ratings, availability, destinations, hotels,
airlines, itineraries, traveller counts and booking information are supplied by
the backend. Design documentation never defines business data values except as
examples.

Soft and rounded, never fussy. Large radii, soft shadows and generous spacing.
No borders heavier than 1px and no decorative elements outside the approved system.

One system for every role. Public, traveller, moderator and admin interfaces use
the same tokens and component library.

Built to be tested. Every component is keyboard accessible, labelled for assistive
technologies and exposes stable selectors for testing.

## 2. Visual direction: Voyara at dusk

Light content on a warm cream page, framed by deep navy, with the photo-led hero and one orange
accent. This is the look in the mockups, written down as rules.

- **Frame:** the side menu is navy (`navy-800`); the Plan page is fully navy (`navy-900`) with the
  night photo behind it; everything else sits on cream (`page`) with off-white (`surface`) cards.
- **Hero (Home):** a full-bleed dusk photo inside a 28px-radius container. The header sits on the
  photo, transparent. The left side fades to `navy-900` so the headline reads. A **wave** of the
  cream page curves up into the bottom of the photo, and the "Popular Destinations" section starts
  on it.
- **Headline:** "Dream. Plan. Travel." in the serif, white, very large, one color, one weight.
- **Search pill:** a white pill with three fields (where, date, travellers) and a round orange arrow
  button at the end. The one round orange button in the product.
- **Photo cards:** rounded photo with a navy scrim at the bottom, the name, star rating and price
  on the scrim in white,  a round outlined arrow button bottom right.
- **Polaroid (Plan page):** Polaroid
One tilted polaroid photo with the place handwritten on it, displayed on the right side of the Plan page.
  page only. It is an illustration, not a component.
- **Logo:** the compass-star mark in soft orange line, then "Voyara" in the serif. Always together,
  never recolored.
- **Never:** a second accent color, emoji as icons, stock illustrations, text on photos except the
  scrim captions and the hero, auto-playing carousels, parallax, a different palette per role.

## 3. Color

Hex values exist only in `tokens.css` and in this table. Everywhere else uses `var(--color-*)`.
Values were sampled from the mockups, with the orange darkened so white text passes AA.

### 3.1 Tokens

| Role              | Token                       | Hex                   | Use                                                                 |
| ----------------- | --------------------------- | --------------------- | ------------------------------------------------------------------- |
| Navy deep         | `navy-900`                  | `#151d33`             | Hero left fade, Plan page background                                |
| Navy              | `navy-800`                  | `#1e263a`             | Side menu, photo scrim base, selected checkbox, text                |
| Navy raised       | `navy-700`                  | `#2a3552`             | Active and hover menu item, upgrade card, links                     |
| Navy soft         | `navy-600`                  | `#3a4770`             | Focus ring on light                                                 |
| Orange            | `accent`                    | `#c2531a`             | Primary button, search arrow button, slider, active tab underline   |
| Orange (hover)    | `accent-hover`              | `#a94515`             | Primary button hover and pressed                                    |
| Orange soft       | `accent-soft`               | `#e9894f`             | Logo mark and info icons only, never text                           |
| Orange tint       | `accent-tint`               | `#fbe4d5`             | Highlight of typed text in suggestions                              |
| Page              | `page`                      | `#f5ede8`             | Page background, wave, tag and inset-panel background               |
| Card              | `surface`                   | `#fffaf6`             | Cards, panels, search pill, inputs                                  |
| Sunken            | `surface-sunken`            | `#ece6e4`             | Hover on light buttons, skeletons, disabled controls                |
| Border            | `line`                      | `#e4d9d3`             | Card, panel and divider borders                                     |
| Control border    | `line-strong`               | `#8b8794`             | Checkbox outline, input borders                                     |
| Text              | `ink` / `ink-soft`          | `#1e263a` / `#3f475c` | Headings, prices / body text                                        |
| Muted text        | `ink-mute`                  | `#5b6377`             | Captions, counts, placeholders. Lightest allowed text               |
| Text on navy      | `on-dark` / `on-dark-mute`  | `#ffffff` / `#cfd5e6` | Text and icons on navy and photos / secondary text there            |
| Star on dark      | `star-on-dark`              | `#f6b33d`             | Rating star on photo scrims only                                    |
| Star on light     | `star`                      | `#b45f06`             | Rating star on cream and cards                                      |
| Success           | `success-700` / `success-50` | `#1d6b45` / `#e1f6e7` | "Confirmed" badge, saved                                            |
| Warning           | `warning-700` / `warning-50` | `#8a4b08` / `#fdebc8` | Pending, low availability                                           |
| Danger            | `danger-600` / `danger-50`  | `#b3261e` / `#fce4e1` | Errors, destructive buttons                                         |
| Info              | `info-700` / `info-50`      | `#1d4fa3` / `#dce8fa` | Neutral hints                                                       |
| Focus             | `focus` / `focus-on-dark`   | `#3a4770` / `#ffffff` | 2px focus ring on light / on navy and photos                        |
| Scrim             | `scrim`                     | `rgb(21 29 51 / 0.55)` | Behind dialogs and drawers                                          |

```yaml
colors:
  navy-900: "#151d33"
  navy-800: "#1e263a"
  navy-700: "#2a3552"
  navy-600: "#3a4770"
  accent: "#c2531a"
  on-accent: "#ffffff"
  accent-hover: "#a94515"
  accent-soft: "#e9894f"
  accent-tint: "#fbe4d5"
  page: "#f5ede8"
  surface: "#fffaf6"
  surface-sunken: "#ece6e4"
  line: "#e4d9d3"
  line-strong: "#8b8794"
  ink: "#1e263a"
  ink-soft: "#3f475c"
  ink-mute: "#5b6377"
  on-dark: "#ffffff"
  on-dark-mute: "#cfd5e6"
  star: "#b45f06"
  star-on-dark: "#f6b33d"
  success-700: "#1d6b45"
  success-50: "#e1f6e7"
  warning-700: "#8a4b08"
  warning-50: "#fdebc8"
  danger-600: "#b3261e"
  danger-50: "#fce4e1"
  info-700: "#1d4fa3"
  info-50: "#dce8fa"
  focus: "#3a4770"
  focus-on-dark: "#ffffff"
```

### 3.2 Allowed pairs (measured contrast)

Use only these combinations for text. If a pair is not listed, it is not allowed.

| Text            | On                                           | Ratio                 |
| --------------- | -------------------------------------------- | --------------------- |
| `ink`           | `page`, `surface`, `accent-tint`             | 13.0, 14.5, 12.3      |
| `ink-soft`      | `page`, `surface`                            | 8.0, 8.9              |
| `ink-mute`      | `page`, `surface`, `surface-sunken`          | 5.2, 5.8, 4.9         |
| `navy-700`      | `page`, `surface`                            | 10.5, 11.7            |
| `on-dark`       | `navy-900`, `navy-800`, `navy-700`           | 16.7, 15.1, 12.1      |
| `on-dark`       | `accent`, `accent-hover`, `danger-600`       | 4.6, 5.9, 6.5         |
| `on-dark-mute`  | `navy-900`, `navy-800`, `navy-700`           | 11.4, 10.3, 8.3       |
| `success-700`   | `success-50`                                 | 5.7                   |
| `warning-700`   | `warning-50`                                 | 5.8                   |
| `danger-600`    | `danger-50`, `surface`                       | 5.4, 6.3              |
| `info-700`      | `info-50`                                    | 6.3                   |

Non-text graphics need 3:1: `line-strong` on `surface` 3.4, on `page` 3.0; `star` on `surface`
4.6. Text on photos is `on-dark` and only over a scrim (section 8); check it against the brightest
photo. `accent` on `surface` is 4.5, so orange is never used as small text; `star-on-dark` is 1.8 on
light and must never leave a scrim.

### 3.3 Rules

- No raw hex, no `rgb()`, no named colors in components. Tokens only.
- **Orange is for the next step.** Primary buttons, the search arrow, the slider, the active tab.
  Links are navy (`navy-700`).
- **Status colors mean status.** Success, warning, danger, info are never decoration. Orange and navy
  never mean success or error.
- **Meaning is never color-only.** Every status has a word and usually an icon.
### Dynamic data rule

Design specifications describe appearance and layout only.

The following values must always come from backend data:

- Prices
- Ratings
- Review counts
- Booking references
- Flight durations
- Passenger counts
- Availability
- Hotel information
- Airline information
- Destination names
- Dates
- Currencies
- Status values

The design system may show examples but components must never hardcode them.
## 4. Typography

Two families from Google Fonts:

- **Cormorant Garamond** (500, 600), `'Cormorant Garamond', 'Iowan Old Style', Georgia, serif`. For
  the logo word, headlines, page titles, place names on detail pages, section titles and box titles.
  Always 28px or larger, because it is thin at small sizes.
- **Plus Jakarta Sans** (400, 500, 600, 700), `'Plus Jakarta Sans', system-ui, -apple-system,
  'Segoe UI', Roboto, Arial, sans-serif`. For everything you read, fill in or compare: body, labels,
  buttons, captions, prices, card captions, tables.

No third family. Base size 16px. Title case is used only where the mockups use it for fixed UI
labels ("Book This Trip", "Proceed to Payment", "View Details", "Add Activity"); all other text is
sentence case.

| Class                 | Family | Size / line height | Weight | Use                                                |
| --------------------- | ------ | ------------------ | ------ | -------------------------------------------------- |
| `.type-display`       | serif  | 92 / 88            | 500    | Hero headline on Home only (-0.01em)               |
| `.type-page-title`    | serif  | 44 / 48            | 600    | One `h1` per page ("Search Results", "Plan Your Perfect Trip") |
| `.type-place`         | serif  | 48 / 52            | 600    |Primary entity name on detail pages          |
| `.type-section-title` | serif  | 34 / 40            | 600    | "Popular Destinations"                             |
| `.type-box-title`     | serif  | 28 / 32            | 600    | "Booking Summary", "My Trips"   |
| `.type-body`          | sans   | 16 / 24            | 400    | Paragraphs                                         |
| `.type-body-sm`       | sans   | 14 / 20            | 400    | Descriptions, helper text, filter labels           |
| `.type-label`         | sans   | 14 / 20            | 600    | Buttons, tabs, filter headings, menu items         |
| `.type-card-name`     | sans   | 15 / 22            | 600    | Name on a photo card                               |
| `.type-caption`       | sans   | 12 / 16            | 500    | Counts, dates, "From", meta (`ink-mute`)           |
| `.type-price-lg`      | sans   | 36 / 40            | 700    | Price on the details price card                    |
| `.type-price`         | sans   | 24 / 28            | 700    | Total on the booking summary                       |

- Below 1000px: `.type-display` 64/62, below 640px 52/52; `.type-page-title` 34/38 below 640px.
- **Numbers:** every price, date, rating and count uses `.num` (`font-variant-numeric:
  tabular-nums`). Check that Plus Jakarta Sans renders tabular figures through the font loader
  before merging; if not, ask before changing the family.
- Paragraphs stay within 56 characters of width on cards and 68 elsewhere.
- Headlines are one color. No word of a headline in another color or italic.

Icons: lucide

```yaml
typography:
  display:
    fontFamily: "Cormorant Garamond"
    fontSize: 92px
    fontWeight: 500
    lineHeight: 88px
    letterSpacing: -0.01em
  display-mobile:
    fontFamily: "Cormorant Garamond"
    fontSize: 32px
    fontWeight: 500
    lineHeight: 36px
    letterSpacing: -0.01em
  page-title:
    fontFamily: "Cormorant Garamond"
    fontSize: 44px
    fontWeight: 600
    lineHeight: 48px
  page-title-mobile:
    fontFamily: "Cormorant Garamond"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 36px
  place:
    fontFamily: "Cormorant Garamond"
    fontSize: 48px
    fontWeight: 600
    lineHeight: 52px
  place-mobile:
    fontFamily: "Cormorant Garamond"
    fontSize: 32px
    fontWeight: 600
    lineHeight: 36px
  section-title:
    fontFamily: "Cormorant Garamond"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 40px
  section-title-mobile:
    fontFamily: "Cormorant Garamond"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 32px
  box-title:
    fontFamily: "Cormorant Garamond"
    fontSize: 28px
    fontWeight: 600
    lineHeight: 32px
  body:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  body-sm:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
  card-name:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 22px
  caption:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
  price-lg:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 36px
    fontWeight: 700
    lineHeight: 40px
  price-lg-mobile:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 32px
  price:
    fontFamily: "Plus Jakarta Sans"
    fontSize: 24px
    fontWeight: 700
    lineHeight: 28px
```

## 5. Spacing and sizing

- **4px grid.** Tokens: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40,
  `-12` 48, `-16` 64. No other values.
- **Screen padding:** 48px on Home, 32px inside the app frame (side menu screens), 20px below 640px.
- **Control heights:** menu item 44px, button 44px (52px for the full-width primary and the search
  button), input pill 44px, select 40px, checkbox row 32px with a 44px hit area.
- **Touch targets:** at least 44 by 44px. A smaller visual ( the 34px arrow) gets
  padding to reach 44px of hit area.
- **Widths:** container 1280px; side menu 220px; filter panel 230px; details side panel 240px;
detail media block 200px; itinerary column 460px; search pill 640px.
- **Grids:** destination cards 4 columns on Home, 3 in search results; gap 16px.

```yaml
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  5: 20px
  6: 24px
  8: 32px
  10: 40px
  12: 48px
  16: 64px
```

## 6. Radius, borders and depth

| Token              | Value | Use                                                                 |
| ------------------ | ----- | ------------------------------------------------------------------- |
| `--radius-control` | 12px  | Selects, filter button, checkbox row groups, inset panels           |
| `--radius-card`    | 18px  | Photo cards, filter panel, itinerary day cards, photos              |
| `--radius-box`     | 20px  | Booking summary and My Trips boxes                                  |
| `--radius-screen`  | 28px  | The screen container and the hero                                   |
| `--radius-full`    | pill  | Buttons, search pill, tags, badges, avatars, arrow buttons          |
| `--radius-xs`      | 5px   | Checkboxes                                                          |

Borders are 1px `line`. Depth has two levels: **flat** (cards inside a screen, panels, side menu) and
**raised** `--shadow-raised` (the screen container, the overlay card on the details photo, the
booking and trip boxes, the search pill, dropdowns, dialogs). One gradient is allowed: the navy
scrim on photos (section 8) and the hero's left fade. No other gradients, no blur, no glass.

```yaml
rounded:
  xs: 5px
  DEFAULT: 12px
  control: 12px
  card: 18px
  box: 20px
  screen: 28px
  full: 9999px
```

## 7. Iconography

Line icons on a 24px grid, 1.75 stroke, round caps, `currentColor`, shown at 20px (16px inside
buttons and meta rows). One set only (_Proposed:_ lucide-react through `shared/ui/Icons.tsx`).
Decorative icons get `aria-hidden="true"`; icon-only buttons need a label.

Icons the mockups use, with fixed meanings: compass-star mark (logo), search,  bell
(notifications), home, compass (explore), calendar (my trips, dates), user (profile), users
(travellers), arrow-right (go, continue), arrow-left (back), chevron-down (menus), plus (add),
check (selected, included), filter, clock (best time), plane (flight duration), coin (currency),
star (rating, filled).

## 8. Imagery

- **Photo cards:** destination photos at 4:5, `object-fit: cover`, 18px radius. A navy scrim covers
  the bottom 55% (`navy-800` at 88% to 0%) and holds the caption. The arrow button sits on
  the photo.
- **Details photo:** full-width, 340px high, with a soft top-to-bottom scrim of 35%; "Back to
  Explore" sits on it. The overlay card overlaps the photo by 90px.
- **Hero photo:** 78% of the hero width on the right; the left fades to `navy-900`.
- **Plan page:** the night photo at 55% opacity behind the right half, fading into `navy-900`.
- **Itinerary thumbnails:** 64 by 56px, 10px radius. **About photo:** 4:3, 14px radius. **Booking
  and trip thumbnails:** 84 by 72px and 96 by 80px, 12px radius.
- **Avatars:** the member photo, circular, 40px with a 2px white-60% ring on the photo, or white on
  cream.
- **Missing photo:** a `surface-sunken` box of the same size with a 32px image icon in `ink-mute`.
  Never a broken image.
- **Alt text:** the place name. Thumbnails beside a visible name use `alt=""`.
- **Loading:** reserve the box, show a `surface-sunken` skeleton, `loading="lazy"` below the fold;
  the hero image loads first.
- **Photographs are real photographs of that place.** Do not substitute a different city.

## 9. Motion

Motion explains a change; it never decorates. `--duration-fast` 120ms (hover, press, color),
`--duration-base` 200ms (open, close, card image zoom to 1.03 on hover). Allowed: color transitions,
the card image hover zoom, overlay open and close, skeleton shimmer. Not allowed: entrance
animations, parallax, bouncing, auto-playing carousels. `prefers-reduced-motion: reduce` turns
transitions off globally.

```yaml
motion:
  fast:
    duration: 120ms
    delay: 0ms
    timingFunction: ease-out
  base:
    duration: 200ms
    delay: 0ms
    timingFunction: cubic-bezier(0.2, 0, 0, 1)
```

## 10. Layout and responsive behavior

| Name    | Width        | Cards | Key changes                                                                   |
| ------- | ------------ | ----- | ----------------------------------------------------------------------------- |
| Mobile  | below 640    | 1     | Side menu hidden (menu button), filters in a drawer, search pill stacks       |
| Tablet  | 640 to 999   | 2     | Side menu hidden, details card and about stack to one column                  |
| Desktop | 1000 to 1279 | 3 to 4 | Side menu 220px visible, filter panel 230px beside the grid                   |
| Wide    | 1280 and up  | 4     | Container stops at 1280px                                                     |

Build mobile first. Check every page at 360, 768, 1024 and 1280. On mobile the main action stays
reachable with a thumb (sticky bottom bar with the price and the primary button on details and
booking summary).

## 11. Interaction patterns

| Need                         | Use                                                              | Not                                  |
| ---------------------------- | ---------------------------------------------------------------- | ------------------------------------ |
| Filters and sort             | Applied at once and stored in the URL query                      | An "Apply" button for every change   |
| Filters on mobile            | A drawer with a sticky "Show {resultCount} results" button                 | A long page of filters above results |
| Quick result (saved)         | A toast, 4s                                                      | A dialog                             |
| A problem the user must fix  | Inline message under the field or at the top of the form         | A toast that disappears              |
| Guest tries a protected step | Redirect to login with `?next=` and return afterwards            | A disabled button with no reason     |
| Something loads              | A skeleton shaped like the content; spinner inside buttons       | A full-page spinner                  |

Every action shows progress and a visible result. Nothing fails silently.

## 12. States

| Kind             | States it must render                                                          |
| ---------------- | ------------------------------------------------------------------------------ |
| Interactive      | default, hover, focus-visible, pressed, disabled, loading (where it does work) |
| Lists and cards  | loading, empty (with the next action), error (with retry), populated           |
| Pages            | loading, loaded, empty, error, not found, no access                            |
| Photo card       | normal, no photo, no rating yet, long name (2 lines)
| Trip status      | confirmed (success badge), pending (warning badge), cancelled (neutral badge)  |
| Itinerary day    | empty, with activities                                                         |

## 13. Accessibility floor (WCAG 2.2 AA)

- Visible focus on every interactive element: 2px outline, 2px offset (`focus` on light,
  `focus-on-dark` on navy and photos). Never `outline: none` without a replacement.
- Every input has a visible label or an `aria-label` (the search pill fields are labelled).
- Full keyboard use in a logical order; "Skip to content" is the first focusable element.
- Tabs follow the tabs pattern; the sort and duration selects are native or follow the listbox
  pattern.
- Landmarks: one `header`, `nav`, `main`; one `h1`; headings never skip a level. The side menu is a
  `nav` with `aria-current="page"` on the active item.
- Ratings have text: "Rated {rating} out of 5 from {reviewCount} reviews".
- Works at 200% zoom and 360px wide without horizontal scrolling.
- Contrast: only the pairs in section 3.2.

## 14. Content and copy

English, plain and specific.

Fixed interface labels are defined here.

Business content is dynamic and comes from APIs.

Examples shown in mockups do not represent implementation requirements.

Use placeholders when defining layouts:

{destinationName}
{hotelName}
{airlineName}
{price}
{rating}
{reviewCount}
{travelerCount}
{date}
{status}

## 15. Components

Each component below appears in the mockups. The last column says where.

### 15.1 Components

| Component         | Spec                                                                                                                                                                                                     | Mockup screen       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `Logo`            | Compass-star mark (30px, `accent-soft` line) + "Voyara" in the serif at 28px, white on navy and photos                                                                                                    | all                 |
| `HeroHeader`      | Transparent header over the photo: logo, nav ("Flights ▾", "Hotels ▾", "Explore ▾","Blog ▾",), search icon button, avatar. Nav items 14px 600 white, underline on hover                      | Home                |
| `Hero`            | Photo container, left fade to `navy-900`, `.type-display` headline, subtitle, `SearchPill`, cream `Wave` at the bottom                                                                                    | Home                |
| `Wave`            | One curved cream edge rising into the hero's bottom. Used under the hero only                                                                                                                             | Home                |
| `SearchPill`      | White pill (`surface`, raised shadow, max 640px): search field "Where do you want to go?", then "Any Date" (calendar icon), "2 Travelers" (users icon), each separated by a 1px `line` rule, then the round orange `GoButton`. Fields are 44px high | Home                |
| `GoButton`        | 52px round `accent` button with a white arrow-right icon, hover `accent-hover`. Label "Search"                                                                                                            | Home                |
| `SideMenu`        | 220px, `navy-800`. Logo on top, items (Home, Explore, My Trips, Profile) at 44px, 12px radius, icon + label, `on-dark-mute`; active and hover `navy-700` with `on-dark`. `aria-current="page"` on the active item | Search, Details, Plan |
| `TopBar`          | In the app frame: `SearchInput` (pill, max 420px, "Search..."),  bell and avatar buttons at the end                                                                               | Search              |
| `PhotoCard`       | 4:5 photo, 18px radius, bottom navy scrim with `.type-card-name`, star + rating + count, and (in results) "From {price}". outlined round arrow button bottom right (Home). Whole card is one link. Hover: image zooms to 1.03, name underlined | Home, Search        |
| `RatingStars`     | Star icon filled `star-on-dark` on photos and `star` on light surfaces, then the rating (14px 600) and the count in `.num`                                                                                | Home, Search, Details |
| `SortSelect`      | 40px, 12px radius, `surface` with `line` border, "Sort by: Most Popular", chevron-down                                                                                                                    | Search              |
| `FilterButton`    | Same look as `SortSelect` with the filter icon and "Filter"                                                                                                                                               | Search              |
| `FilterPanel`     | 230px, `surface`, 18px radius, 1px `line`, 20px padding, 20px between groups. Group headings `.type-label`. Groups: Price Range, Rating, Trip Type, Duration                                              | Search              |
| `PriceRange`      | Label "$200 – $2000+" in `.num`, a 3px track in `line`, filled `accent` between two 16px white thumbs with a 2px `accent` border. Keyboard: arrows move the focused thumb                                  | Search              |
| `CheckboxRow`     | 32px row, 18px box, 5px radius, 1.5px `line-strong`; checked = `navy-800` fill with a white check. Whole row clickable                                                                                    | Search, Booking     |
| `SelectField`     | Same look as `SortSelect`, full width, "Any duration"                                                                                                                                                      | Search              |
| `InfoRow`         | Icon (22px, `accent-soft`) + caption label + value 600: Flight Duration,                                                                                                      | Details             |
| `Button`          | Pill, 44px (52px full-width), 14px 600. `primary` = `accent` with white text, hover `accent-hover`. `secondary` = `surface`, 1px `line`, `ink`, hover `surface-sunken`. `outline` (on navy) = transparent, white 55% border, white text. Disabled = `surface-sunken` with grey text. Icon at the end for continue actions | all                 |
| `PlanInput`       | White 92% pill, 52px, max 460px, "Add a destination..." with a plus icon at the end                                                                                                                       | Plan                |
| `DayTimeline`     | Vertical list of `DayCard`s joined by a 2px dashed white-30% rail with a 12px dot per day, max 460px                                                                                                      | Plan                |
| `DayCard`         | Translucent white 7% with a white 12% border, 16px radius, 10px padding: 64 by 56px thumbnail, small caption "Day {dayNumber}", bold title {activityTitle}, caption line {activityDescription}         | Plan                |
| `Polaroid`        | One tilted polaroid photo with the place handwritten and a  right side of the Plan page. A fixed illustration; not interactive                                                                      | Plan                |
| `BookingSummary`  | `surface`, 20px radius, raised shadow, 24px padding: box title, "{travelerCount} Travelers • {tripLength} Days", trip row (84 by 72px photo, name, dates, `.type-price` total at the end), "Included Services" with `CheckboxRow`s in a `page` inset panel, full-width primary "Proceed to Payment →" | Booking summary     |
| `TripCard`        | Same box. Row: 96 by 80px photo, name, dates, `StatusBadge` at the end; below, secondary button "View Details →". Header row has the box title and "View all →"                                           | My trips            |
| `StatusBadge`     | Pill, 26px high, 12px 700. Confirmed = `success-700` on `success-50` with a check icon. Pending and Cancelled use the warning and neutral pairs with a word and an icon                                    | My trips            |
| `Avatar`          | Circular member photo 40px (ring on photos). Initials on `page` with `navy-800` text when there is no photo                                                                                                | all                 |
| `IconButton`      | 44px round, transparent, icon `currentColor`; hover white 12% on navy, `surface-sunken` on light. Label required                                                                                          | all                 |
| `TextLink`        | `navy-700` 14px 600, arrow-right icon at 16px, underline on hover and focus                                                                                                                                | all                 |
| `TextField`       | `44px` height, `12px` radius, `surface` fill, `1px line-strong` border, `16px` horizontal padding, `.type-body-sm` text, `ink-mute` placeholder. Visible `.type-label` above; `danger-600` border + inline `role="alert"` message below on error; `surface-sunken` when disabled | Auth, Checkout, Settings |
| `TextArea`        | Same styling as `TextField` with `min-height: 96px`, `12px` vertical padding, vertical resize only                                                                                                         | Checkout, Blog, Settings |
| `DateRangePicker` | `surface` popover (`20px` radius, `--shadow-raised`, `1px line`). Month grid with `44px` day cells; selected range endpoints `navy-800` (`on-dark`), in-range days `accent-tint` (`ink`)                | Home, Search        |
| `TravelersPicker` | `surface` popover (`20px` radius, `--shadow-raised`, `1px line`, `280px` wide). Rows for Adults, Children, Infants with `44px` `-` / `+` `IconButton`s (`1px line` border) and `.num` count             | Home, Search        |
| `Dialog`          | Centered `surface` box (`20px` radius, `--shadow-raised`, `max 480px`, `24px` padding) over `scrim` (`rgb(21 29 51 / 0.55)`). `.type-box-title` heading, `.type-body` copy, right-aligned `secondary` + `primary` (or `danger-600` for destructive) `Button`s. Focus-trapped, closes on `Escape` | Bookings, Settings  |
| `Toast`           | `navy-800` pill/card (`12px` radius, `--shadow-raised`, `12px 16px` padding) with `on-dark` text, semantic icon (`success-50` check or `danger-50` alert), auto-dismisses in 4s (`aria-live="polite"`) | all                 |
| `Skeleton`        | `surface-sunken` (`#ece6e4`) blocks matching target card/row radius (`18px` card, `12px` text bar), subtle opacity pulse disabled under `prefers-reduced-motion`                                          | all                 |
| `EmptyState`      | Centered `surface` or `page` container (`max 420px`, `32px` padding), `32px` `ink-mute` icon, `.type-box-title` heading, `.type-body-sm` guidance, and one primary `Button`                             | Search, My Trips, System |
| `ErrorBanner`     | `danger-50` fill, `1px danger-600/30` border, `12px` radius, `16px` padding, `danger-600` icon + `.type-body-sm` message + inline "Try again" `Button`                                                  | all                 |


## FlightResultCard

Purpose: Display a flight returned from search results.
Spec: `surface` card, `18px` radius, `1px line` border, `20px` padding. Airline logo (`32px`), airline name (`.type-card-name`), departure/arrival times and duration in `.num`, stops badge, `.type-price` total, and one `Button` (`primary` or `secondary`).
States: loading (`Skeleton`), populated, unavailable (`surface-sunken`, muted), error (`ErrorBanner`).
Desktop: horizontal row; Mobile: stacked card.

## FlightDetails

Purpose: Display detailed flight information.
Spec: `surface` box (`20px` radius, `--shadow-raised`, `24px` padding) with `.type-place` route (`{departureAirport} → {arrivalAirport}`), `.num` times/duration, `InfoRow` strip (`20px` `accent-soft` icons), and `CabinCard` list below.
Primary action: Select cabin.

## CabinCard

Spec: `surface` card, `18px` radius, `1px line` border, `20px` padding. Cabin type (`.type-card-name`), seat availability (`.type-caption`), baggage & refund policy (`.type-body-sm`), `.type-price`, and `Button` ("Select Cabin →"). One card per section may use `primary` orange; others use `secondary`.

## HotelCard

Spec: `surface` card, `18px` radius, `1px line` border, overflow hidden. 4:3 hotel image (`14px` inner radius or full-bleed top), hotel name (`.type-card-name`), `RatingStars`, location (`.type-caption`), `.type-price` per night, and `Button` ("View Details →").

## RoomCard

Spec: `surface` card, `18px` radius, `1px line` border, `20px` padding. `96x80px` `12px`-radius thumbnail, room type (`.type-card-name`), occupancy & amenities (`.type-body-sm`), availability (`.type-caption`), `.type-price` per night, and `Button` ("Select Room →").

## BookingCard

Spec: `surface` box, `20px` radius, `1px line` border, `20px` padding. Booking reference in `.num`, `StatusBadge`, date (`.type-caption`), product summary, `.type-price` total, and secondary `Button` ("View Details →").

## HoldTimer

Purpose: Reservation hold countdown.
Spec: `warning-50` banner, `12px` radius, `12px 16px` padding, `clock` icon in `warning-700`, remaining time in `.num` (`warning-700` 600). Supports live `aria-live="polite"` countdown updates.

## PaymentBanner

Purpose: Display incomplete payment state.
Spec: `warning-50` or `danger-50` inset banner (`12px` radius, `16px` padding) with payment reminder, outstanding amount in `.num`, and primary `Button` ("Proceed to Payment →").

## BlogPostCard

Spec: `surface` card, `18px` radius, `1px line` border, overflow hidden. 16:9 cover image, title (`.type-card-name`), author `Avatar` (`24px`) + publish date (`.type-caption`), 2-line summary (`.type-body-sm`), and `TextLink` ("Read more →").

## CommentThread

Spec: `page` or `surface` inset container (`12px` radius, `16px` padding) with author `Avatar` (`32px`), date (`.type-caption`), comment text (`.type-body-sm`, max `68ch`), and nested replies indented by `24px` with a `1px line` left border.

## NotificationPanel

Spec: `surface` popover (`20px` radius, `--shadow-raised`, `1px line`, `max 360px`). Unread items show a `8px` `accent` dot + `accent-tint` subtle highlight; timestamp in `.type-caption`. Actions: "Mark read" and "Mark all read" (`TextLink`).

## DataTable

Used by: Moderator and Admin pages.
Spec: Inside a `surface` `20px` box with `1px line` border. Header row on `page` (`#f5ede8`) with `.type-label` (`ink`), `48px` row height, `1px line` row dividers, hover `surface-sunken`, `.num` on numeric columns. Supports sorting, filtering, search, bulk selection (`CheckboxRow`), and `Pagination`. Horizontal scroll wrapper on mobile.

## Pagination

Spec: Horizontal flex row (`items-center justify-between`, `gap 8px`) with secondary `Button`s (`40px` height, `12px` radius) for Previous/Next and `.num` page indicator (`.type-body-sm`). Keyboard accessible with `aria-current="page"` on active page.

### 15.2 Layout

| Layout        | Spec                                                                                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `HomeLayout`  | `Hero` (with `HeroHeader`) then a 48px-padded cream section                                                                                                  |
| `AppLayout`   | 28px-radius screen: `SideMenu` (220px) + main column with 32px padding; `TopBar` on list pages. Details uses the photo edge to edge with the card overlapping  |
| `PlanLayout`  | `AppLayout` on `navy-900` with the night photo behind the right half and the `Polaroid`                                                                       |
| `BoxLayout`   | Two `surface` boxes side by side (booking summary, my trips); one column below 1000px                                                                         |

## 16. Page recipes

**Home**

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ✦ Voyara   Flights ▾  Hotels ▾  Explore ▾ Blog ▾         ⌕  🔔  (avatar) │
│ navy fade ▒▒▒▒ photo                                                     │
│ Dream. Plan.                                  (display, white)           │
│ Travel.                                                                  │
│ Your next adventure is just a search away.                               │
│ ┌ ⌕ Where do you want to go? │ ▢ Any Date │ ☺ {travelerCount} Travelers │ (→) ┐        │
│ ~~~~~~~~~~~~~~~~~~~~~~~~~~ cream wave ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~ │
│ Home

Hero

Trip Search

Popular Destinations

Public Itineraries

Latest Blog Posts

Footer                                     View all →     │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐   photo cards, caption on the scrim  │
└──────────────────────────────────────────────────────────────────────────┘
```

**Search results**

```text
┌────────┬─────────────────────────────────────────────────────────────────┐
│ ✦      │ [⌕ Search...]                                  🔔  (avatar)   │
│ Home   │ Search Results                 [Sort by: Most Popular ▾] [Filter]│
│ Explore│ {resultCount} results found                                      │
│ Trips  │ ┌ Price Range ┐ ┌──────┐ ┌──────┐ ┌──────┐                       │
│ Profile│ │ $200–$2000+ │ │ card │ │ card │ │ card │   3 columns           │
│        │ │ Rating      │ └──────┘ └──────┘ └──────┘                       │
│ │ Trip Type   │                                                  │
│ │ Duration    │                                                  │
└────────┴─────────────────────────────────────────────────────────────────┘
```

**Flight details**

```text
┌────────┬─────────────────────────────────────────────────────────────────┐
│ side   │ ← Back to Flights                                              │
│ menu   │                                                                │
│        │ {airlineName}                                                   │
│        │ {departureAirport} → {arrivalAirport}                          │
│        │ {departureTime} · {arrivalTime} · {duration}                   │
│        │                                                                │
│        │ Available Cabins                                               │
│        │ ┌ Economy ─────────────── {price} ─ [Select] ┐                │
│        │ ┌ Business ────────────── {price} ─ [Select] ┐                │
│        │ ┌ First ───────────────── {price} ─ [Select] ┐                │
└────────┴─────────────────────────────────────────────────────────────────┘
```

**Hotel details**

```text
┌────────┬─────────────────────────────────────────────────────────────────┐
│ side   │ ← Back to Hotels                                               │
│ menu   │                                                                │
│        │ {hotelName}                                                    │
│        │ ★ {rating} ({reviewCount} reviews)                             │
│        │ {description}                                                  │
│        │                                                                │
│        │ Overview | Rooms | Reviews | Location                          │
│        │                                                                │
│        │ Available Rooms                                                │
│        │ ┌ {roomType} ─────────── {pricePerNight} ─ [Select] ┐         │
│        │ ┌ {roomType} ─────────── {pricePerNight} ─ [Select] ┐         │
└────────┴─────────────────────────────────────────────────────────────────┘
```


**Plan your trip** (dark): title, subtitle, `PlanInput`, `DayTimeline` of three `DayCard`s, outline
button "Add Activity", the `Polaroid` on the right over the night photo.

**Booking summary and My trips**: two boxes side by side. Booking summary: trip row with total,
Included Services checklist, "Proceed to Payment". My trips: trip card with the "Confirmed" badge and
"View Details".

**Round-trip two-step flight selection (P02, P03)**: `AppLayout` with `SideMenu`, step indicator ("1. Outbound · 2. Return"), selected outbound summary strip (`surface`, `12px` radius, `1px line`), and `FlightResultCard` list for the active leg.

**Checkout & Passenger Details (P16–P18)**: `BoxLayout` inside `AppLayout`. Left column (`surface`, `20px` radius, `24px` padding): `HoldTimer` banner at top, passenger `TextField`s, baggage `CheckboxRow`s, and payment form. Right column: sticky `BookingSummary` with itemized total and full-width primary `Button` ("Confirm & Pay →").

**Booking Confirmation & E-Ticket (P19)**: `AppLayout` centered `surface` box (`max 640px`, `20px` radius, `--shadow-raised`, `24px` padding) with `StatusBadge` ("Confirmed"), booking reference in `.num`, itinerary summary row, and primary "Download E-Ticket" + secondary "View My Trips" buttons.

**Public Itineraries & Blog (P06–P10, P24–P26)**: `AppLayout` with `TopBar`. List views use a 3-column `BlogPostCard` / `PhotoCard` grid (`16px` gap). Detail views use a `surface` `20px` card with `max-w-prose` (68ch) `.type-body` copy and `CommentThread` below.

**Auth & Account Settings (P11–P15)**: Auth pages center a single `surface` box (`max 440px`, `20px` radius, `--shadow-raised`, `32px` padding) on `page` cream with `Logo` above, `TextField`s, one full-width primary `Button`, and `TextLink` for secondary navigation. Account settings uses `AppLayout` with grouped `surface` `20px` sections and destructive actions isolated in a `danger-50` bordered row at the bottom.

**Moderator & Admin Pages (P27–P47)**: `AppLayout` with `SideMenu` and `TopBar`, filter/search toolbar (`40px` `SelectField` + `SearchInput`), `DataTable` inside a `surface` `20px` box, and `Pagination` footer.

**System Pages (P48–P51)**: Centered `EmptyState` or `ErrorBanner` inside a `surface` `20px` box on `page` cream (`max 480px`), `.type-box-title` heading, `.type-body` explanation, and a single primary `Button` ("Back to Home").

## 17. Pending implementation details

All core shared controls, consumer flows (auth, checkout, confirmation, blog, public itineraries), moderator/admin data tables, and system pages are now specified in Sections 15 and 16 using Section 3 tokens. Only API-supplied business data (Section 14) and role-specific operational rules remain external to this design system.

## 18. Governance

**Adding or changing a component:** check that none of the above already does the job; ask the team
lead; add it to section 15 in the same PR with its states, keyboard support and labels.

**Definition of done for UI work:** tokens only; states from section 12; keyboard and screen-reader
labels; 44px targets; copy from section 14; at most one orange button per section; checked at 360,
768 and 1280; tests pass; `format`, `lint`, `build` pass.

**Changes to tokens or these rules** go through the team lead.

Backend ownership rule

Frontend components never define business values.

All operational data must be supplied through APIs.

Design specifications define:
- appearance
- layout
- interaction
- accessibility
- responsive behavior

Design specifications do not define:
- prices
- ratings
- review counts
- bookings
- destinations
- hotels
- airlines
- itineraries
- currencies
- availability
---

## Appendix A. `tokens.css`

```css
:root {
  --color-navy-900: #151d33;
  --color-navy-800: #1e263a;
  --color-navy-700: #2a3552;
  --color-navy-600: #3a4770;
  --color-accent: #c2531a;
  --color-accent-hover: #a94515;
  --color-accent-soft: #e9894f;
  --color-accent-tint: #fbe4d5;

  --color-page: #f5ede8;
  --color-surface: #fffaf6;
  --color-surface-sunken: #ece6e4;
  --color-line: #e4d9d3;
  --color-line-strong: #8b8794;
  --color-ink: #1e263a;
  --color-ink-soft: #3f475c;
  --color-ink-mute: #5b6377;
  --color-on-dark: #ffffff;
  --color-on-dark-mute: #cfd5e6;
  --color-star: #b45f06;
  --color-star-on-dark: #f6b33d;

  --color-success-700: #1d6b45;
  --color-success-50: #e1f6e7;
  --color-warning-700: #8a4b08;
  --color-warning-50: #fdebc8;
  --color-danger-600: #b3261e;
  --color-danger-50: #fce4e1;
  --color-info-700: #1d4fa3;
  --color-info-50: #dce8fa;
  --color-focus: #3a4770;
  --color-focus-on-dark: #ffffff;
  --color-scrim: rgb(21 29 51 / 0.55);

  --font-serif: 'Cormorant Garamond', 'Iowan Old Style', Georgia, serif;
  --font-sans: 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;

  --space-1: 4px;  --space-2: 8px;  --space-3: 12px; --space-4: 16px; --space-5: 20px;
  --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px; --space-16: 64px;

  --control-md: 44px;
  --control-lg: 52px;
  --sidebar-w: 220px;
  --container-max: 1280px;

  --radius-xs: 5px;
  --radius-control: 12px;
  --radius-card: 18px;
  --radius-box: 20px;
  --radius-screen: 28px;
  --radius-full: 9999px;
  --shadow-raised: 0 10px 28px rgb(21 29 51 / 0.13);
  --scrim-card: linear-gradient(to top, rgb(21 29 51 / 0.88), rgb(21 29 51 / 0));
  --hero-fade: linear-gradient(90deg, #151d33 0%, #151d33 26%, rgb(21 29 51 / 0.55) 48%, rgb(21 29 51 / 0) 72%);

  --duration-fast: 120ms;
  --duration-base: 200ms;
}
```

```css
html { font-family: var(--font-sans); font-size: 16px; line-height: 1.5; color: var(--color-ink);
  background: var(--color-page); -webkit-font-smoothing: antialiased; }
:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
.on-dark :focus-visible { outline-color: var(--color-focus-on-dark); }
.num { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

## Appendix B. Frontend stack for the UI

| Concern             | Choice                                                         | Status                       |
| ------------------- | -------------------------------------------------------------- | ---------------------------- |
| Framework           | As set in `frontend.md`                                        | Confirmed by the shell ticket |
| Component tests     | Vitest + Testing Library + jsdom                               | Confirmed                    |
| Styling             | CSS Modules + the variables in Appendix A                      | _Proposed_                   |
| Fonts               | Cormorant Garamond and Plus Jakarta Sans via the font loader   | _Proposed_                   |
| Icons               | lucide-react through `shared/ui/Icons.tsx`                     | _Proposed_ (new dependency)  |
| Currency display    | USD until the multi-currency backend exists                    | _Proposed_                   |

## Components

Component implementations live as individual HTML sticker sheet files in
`components/`. Each file contains the canonical, styled HTML components with
`<!-- COMPONENT: name -->` comment markers. Read each file before use.

- **Badge** → `@components/badge.html` — `badge-numeric`, `badge-dot`
- **Button** → `@components/button.html` — `button-primary`, `button-icon`, `button-with-icon`
- **Card** → `@components/card.html` — `card-elevated`, `card-action`, `card-interactive`, `card-interactive-2`
- **Input Field** → `@components/input-field.html` — `input-field-text`, `input-field-icon`
- **Typography** → `@components/typography.html` — `typography-display`, `typography-body`, `typography-label`
