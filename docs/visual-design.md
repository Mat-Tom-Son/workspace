# Workspace visual system

Workspace uses a quiet desktop-tool aesthetic. The interface should feel native, legible, and deliberate before it feels customizable.

## Information hierarchy

- A **Space** is a root folder. It is selected or switched; it is not a peer navigation surface.
- **Files** is the first working surface inside the selected Space.
- Primary surfaces are Files, Chats, Library, and History.
- Assistant surfaces are Setup, Skills, and Extensions.
- The current Space appears once as an explicit root selector. Page headers identify the current surface and may show the Space name as secondary context.

## Iconography

- Use Fluent System Icons for shell navigation, commands, status, and empty states.
- Use regular icons at rest and the matching filled icon for a selected navigation item.
- Use 16px icons for inline actions, 20px for navigation and section markers, and no more than 24px for empty states.
- Material file-type icons are the one deliberate exception because file recognition benefits from familiar type colors.
- Do not mix icon libraries within one control group. Do not repeat the Space glyph as a page icon.
- Space color may appear as a small avatar accent or active indicator, never as a frame around the application.

## Typography and spacing

- The shell uses Segoe UI Variable Text with 14px body copy and weights 400, 600, and 700.
- Alternative reading fonts may affect document or chat content, but must not change shell geometry.
- Use the 4, 8, 12, 16, 24, and 32px spacing scale.
- Controls are 36–40px tall with 6–8px radii.
- Avoid all-caps labels, weight 800+, text shadows, ornamental gradients, and oversized hero headers.

## Layout

- Navigation uses compact, aligned rows with text labels and one subtle selected state.
- Page headers are 48–56px horizontal rows, not cards or banners.
- Forms use stacked labels and hints with an explicit action row.
- Notices use `icon | copy | action` and stack only when their own pane becomes narrow.
- Empty states are centered, restrained, and no wider than 440px.
- Resizable panes must adapt to their own width; prefer container queries to viewport-only breakpoints.

## Visual acceptance

Before a handoff, exercise every primary and Assistant surface in light and dark themes at 1440×900, 1280×800, and a tall/narrow desktop window. Reject the candidate for:

- overlapping or concatenated copy;
- clipped labels or controls;
- horizontal page overflow;
- full-width buttons without an intentional form layout;
- mixed shell icon weights or sizes;
- repeated decorative identity graphics;
- empty states that leave unexplained split-pane chrome;
- focus, hover, active, and disabled states that are not visually distinct.
