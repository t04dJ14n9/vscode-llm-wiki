# Floating Ask PDF Inspector Design

## Status

Approved by the user on 2026-07-15. This refines the existing Ask PDF design: discussion content is no longer presented in a fixed document sidebar.

## Interaction contract

Each PDF discussion annotation owns a floating inspector. Its visible transcript, draft, position, size, attachment mode, and minimized state are associated with that annotation rather than with the PDF document as a whole. Only one inspector is foregrounded at a time; selecting another numbered marker foregrounds that annotation's inspector and restores its own saved geometry.

For a new selection, the inspector appears beside the selected rectangle. It prefers the right side, then the left, below, or above, and is clamped inside the PDF viewport. Before the user moves it, the inspector remains attached to the selection as the PDF scrolls. Dragging its header detaches it and gives it a viewport-relative position. A reset-position action reattaches it.

The inspector is resizable from its edges and corners. Its default size is 380 × 520 CSS pixels, minimum size is 320 × 260, and maximum size is constrained by both 560 × 720 and the available viewport. Geometry is saved in VS Code webview state per annotation. When a draft becomes a durable annotation, its geometry is migrated to the annotation ID.

Minimize hides the inspector while retaining the blue selection outline and numbered marker. Clicking that marker restores the same annotation inspector. Escape minimizes an annotation inspector. The toolbar discussion count opens a floating document-level overview; selecting an overview entry opens that annotation's inspector.

Below 620 CSS pixels, the inspector becomes a clamped near-full-width overlay while preserving annotation ownership. Dragging and edge resizing are disabled in this narrow mode. Keyboard resize controls, visible focus, screen-reader names, ARIA live streaming updates, and reduced-motion behavior remain available.

## Visual direction

The inspector keeps the existing scholarly-marginalia language: quiet VS Code surfaces, a thin blue provenance edge, compact monospaced labels, and a white source crop. The annotation relationship is the signature element: a short blue leader points toward the selected passage while attached. The window uses a restrained border and shadow, not chat bubbles or a generic modal treatment.

## Page-state correctness

Programmatic navigation and continuous-scroll observation must agree on the current physical PDF page. Intersection visibility is tracked across all observed pages instead of choosing from only the latest observer callback batch. Opening a page-2 annotation must leave the canvas, toolbar, source label, and portable link on page 2.

## Boundaries

- The PDF bytes and annotation sidecar schema are unchanged.
- Multiple inspectors are not simultaneously visible in v1; their state is still independently preserved per annotation.
- Hover/minimize behavior applies identically to the combined and standalone PDF extensions.
- No unrelated editor refactor or worktree cleanup is included.
