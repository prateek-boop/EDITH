---
version: alpha
name: EDITH
description: A graphite project workspace with a spatial intelligence core and coral actions.
colors:
  primary: '#f06a62'
  background: '#101114'
  surface: '#15171b'
  elevated: '#1c1f25'
  text: '#f1f3f5'
  secondary: '#b3bac5'
  muted: '#969eac'
  border: '#2b3038'
  success: '#7bdcb0'
  warning: '#efc078'
  danger: '#ff8e86'
typography:
  sans:
    fontFamily: "Segoe UI, -apple-system, BlinkMacSystemFont, sans-serif"
  display:
    fontFamily: "Avenir Next, Segoe UI, sans-serif"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
rounded:
  DEFAULT: '8px'
  sm: '6px'
  md: '12px'
  lg: '16px'
spacing:
  section-gap: '24px'
  page-max: '880px'
components:
  button:
    height: '32px'
    backgroundColor: '{colors.primary}'
    textColor: '#191414'
  card:
    rounded: '9px'
    backgroundColor: '{colors.surface}'
    textColor: '{colors.secondary}'
  dialog:
    rounded: '14px'
    backgroundColor: '{colors.elevated}'
    textColor: '{colors.text}'
---

# EDITH Design System

## Overview

### Creative North Star

A focused engineering studio: graphite instrument panels, quiet chrome, legible working surfaces, and a single sculptural Möbius core. Preserve the existing spatial identity while giving actual project work priority.

### Product context and register

- Audience: people inspecting, editing, and reasoning about local software projects.
- Source: README.md and the frontend contract in src/lib/api.ts. This is a browser session prototype; agent execution and verification are simulated.
- Product register throughout. The entry screen introduces the product without implying production authentication.
- English UI; browser-local date/time formatting. No Japan-specific product or market requirements are established.
- Desktop-first with compact side navigation at tablet widths and labeled bottom navigation on phones. Electron packaging is future work.
- Signature: the Möbius core, isolated from task controls. No added illustrative assets or external font dependency.
- Avoid saturated neon dashboards, illegible tiny chrome, and marketing cards inside operational views.
- Runtime token owner: src/production.css :root. This document mirrors those values. src/styles.css supplies existing feature geometry; production.css is imported afterward to resolve legacy drift.

## Colors

Background, surface, and elevated tokens form three visible layers. Coral is reserved for the brand and primary actions. Success is mint, warning is amber, and danger uses light coral with explicit labels. Secondary and muted text remain readable on the dark surfaces. Scrollbars use shared thumb, track, hover, and active tokens; forced colors restore system behavior.

## Typography

System sans fonts keep startup stable and work offline. Display headings use Avenir Next when present, falling back to Segoe UI. Technical values use the existing monospace stack. Prose uses sentence case; small uppercase labels identify context. Headings scale with viewport width. Long filenames and goals wrap or truncate with full names in action labels.

## Layout

The desktop shell uses a 64px header, 224px sidebar, 36px status bar, and a content region with an independent scroll owner. Agent content is limited to 880px. Below 1100px suggestions stack; below 760px navigation becomes compact; below 600px navigation moves beneath content and the file explorer stacks above the editor. Short windows retain scrolling. Safe-area padding applies to phone navigation. Standard views grow naturally inside their content scroller.

## Elevation & Depth

Tonal layers and single borders establish hierarchy. Shadows are reserved for the entry card, composer, and dialogs. The main workspace is matte. Dialog backdrops isolate destructive decisions. Non-modal history and settings panels preserve workspace context.

## Shapes

Controls use 6–8px corners, composer 12px, entry card 16px, and dialogs 14px. No pill treatment for primary actions. Lucide icons retain their existing outline stroke.

## Components

### Foundational visual states

All interactive elements have pointer, hover, pressed, keyboard focus, disabled, and busy states. Busy execution blocks another goal. Suspense uses a stable labeled loading region. Render failures show recovery actions; an optional failed core has a static fallback.

### Buttons and actions

Coral fill is the primary Run goal action. Secondary actions remain quiet. Destructive actions are isolated in confirmation dialogs with a clearly labeled final verb. Cancel receives initial focus for deletion.

### Navigation and data display

One sidebar owns all five views. Active state uses background, border, icon, and aria-current. Breadcrumb labels identify project and view. Example workspaces are labeled as sample data. Browser Back and Forward restore view state.

### Forms and overlays

SearchField owns local search labels and keyboard-accessible clearing. Native selects remain platform-owned; this is intentional for model preferences. Dialog uses native showModal with app styling, focus containment, Escape, inert background, and focus restoration. History and profile are explicitly non-modal panels with labeled close controls. No browser alert/confirm/prompt UI.

### Iconography

Lucide React, generally 14–18px, paired with text except named utility controls. File actions have a visible overflow button for keyboard and touch users.

### Motion

Use short transitions for feedback. Respect system reduced motion; the core switches to demand rendering. No decorative motion on primary controls. Optional ambient visualization must never block editing.

### Content and data visualization

Plain task-oriented copy. State that execution is a demo, local edits are session-only, and attachments are reference-only. Never describe a simulated result as evidence of actual tests on the user's project.

## Do's and Don'ts

- Do preserve all five navigation destinations on narrow screens.
- Do use shared search and dialog owners for recurring behavior.
- Don't hide scrolling to make an idle composition fit.
- Don't imply backend authentication, durable disk writes, or real agent execution.
