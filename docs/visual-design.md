# Workspace visual system

Workspace uses a quiet desktop-tool aesthetic. The interface should feel native, legible, and deliberate before it feels customizable.

## Information hierarchy

- A **Space** is a root folder. It is selected or switched; it is not a peer navigation surface.
- **Files** is the first working surface inside the selected Space.
- Primary surfaces are Files, Skills, Extensions, Chats, Library, and History.
- Provider, model, and authentication controls live in Settings under Assistant; Assistant is not a rail group.
- The first rail item opens the Space manager and identifies the selected root folder. The persistent header above the left pane repeats that Space identity; the selected rail item identifies the current surface.

## Iconography

- Use Fluent System Icons for shell navigation, commands, status, and empty states.
- Use regular icons at rest and the matching filled icon for a selected navigation item.
- Use 16px icons for inline actions, 20px for navigation and section markers, and no more than 24px for empty states.
- Material file-type icons are the one deliberate exception because file recognition benefits from familiar type colors.
- Do not mix icon libraries within one control group. The Space glyph may repeat only where it communicates inherited root context: the root selector, Space identity header, switcher, cards, and Space-bound tabs.
- Space color may appear as a small avatar accent or active indicator, never as a frame around the application.

## Typography and spacing

- The default is Segoe UI Variable Text with 15px body copy and weights 400, 600, and 700.
- User-selected fonts and text sizes may change type, but must not change shell geometry or push controls out of bounds.
- Use the 4, 8, 12, 16, 24, and 32px spacing scale.
- Controls are 36–40px tall with 6–8px radii.
- Avoid all-caps labels, weight 800+, text shadows, ornamental whole-app gradients, and oversized hero headers.

## Layout

- Navigation uses compact, aligned rows with text labels and one subtle selected state.
- A 90px identity header sits above every left-pane surface. Its centered icon-over-name lockup represents the selected Space, not the active page. Files, Skills, Extensions, Chats, Library, and History keep the quick Space switcher; the Spaces-management surface omits that redundant switcher.
- Space banners stay inside the identity header and appearance previews. They do not wallpaper the right work surface or recolor structural borders; interaction color and shell structure remain part of the global application system.
- Color and icon identity inherit through Space-bound cards, chat groups, tabs, surfaces, and chat empty states. Content belonging to another Space carries that Space's own identity rather than the currently selected one.
- Forms use stacked labels and hints with an explicit action row.
- Notices use `icon | copy | action` and stack only when their own pane becomes narrow.
- Empty states are centered, restrained, and no wider than 440px.
- Resizable panes must adapt to their own width; prefer container queries to viewport-only breakpoints.

## Visual acceptance

Before a handoff, exercise every primary surface and every Settings section in light and dark themes at 1440×900, 1280×800, and a tall/narrow desktop window. Reject the candidate for:

- overlapping or concatenated copy;
- clipped labels or controls;
- horizontal page overflow;
- full-width buttons without an intentional form layout;
- mixed shell icon weights or sizes;
- repeated decorative identity graphics;
- empty states that leave unexplained split-pane chrome;
- focus, hover, active, and disabled states that are not visually distinct.

## Appearance scopes

- **Settings → Appearance** controls the application theme, font, and text size.
- **Customize Space** controls one Space's accent, compact banner, and Fluent identity icon.
- Customize Space is opened from the Space card and lives in one right-side appearance tab per Space. Changes repaint every identity consumer immediately.
- Per-Space appearance is personal application state. It is not written into the user's ordinary folder and does not travel with shared files.
- A custom image is resized and compressed before local storage. Unsafe image formats and malformed stored values are rejected.
- Every Space appearance control updates a live preview, saves immediately, and offers a single Reset action.
