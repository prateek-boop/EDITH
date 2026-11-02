# EDITH UI contract

## Business-context sources

| Concern | Source | UI consequence |
| --- | --- | --- |
| Product scope | README.md; src/lib/api.ts | Clearly label example workspaces and simulated execution. |
| Identity | README.md Google authentication | Demo entry is explicit; production Google credentials need backend verification. |
| Data lifecycle | README.md local project behavior | Edits and deletes affect session memory; no disk-write claim. |
| Approval boundary | src/store/useEdithStore.ts | Demo pauses for approval; approve/reject preserve the existing state machine. |
| Billing/legal | No service contract implemented | No billing or legal claims introduced. |

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
| --- | --- | --- | --- | --- |
| Navigation | Sidebar.tsx; Workspace.tsx | This contract | Sidebar / bottom navigation | Browser viewport matrix; Back/Forward |
| Search | ui/SearchField.tsx | This contract | Immediate, bounded local filtering | Search / no results / clear |
| Select/Listbox | Native HTML select in ProfilePanel | DESIGN.md | OS-owned popup | Native keyboard behavior |
| Form | FilesView; MemoryView | This contract | Session create / rename / memory edit | CRUD browser tests |
| Scrollbar | src/production.css | DESIGN.md | Global baseline | Computed browser styles |
| Dialog | ui/Dialog.tsx | This contract | Create / rename / deletion | Focus / Escape / cancel / confirm |
| CRUD | useEdithStore.ts | Existing session domain behavior | In-place session updates | Note full-flow and memory browser tests |
| Feedback | Inline status/error text | This contract | status / error / offline | Browser tests |
| Recovery | ui/ErrorBoundary.tsx | This contract | Workspace retry / decorative fallback | Failure-path browser test |

## Flow ledger

- Demo entry → example picker → initializing → agent view.
- Folder picker: busy action disabled; failure preserves picker with retry instructions. No upload or disk persistence is promised.
- Note creation and rename close their shared dialog after valid session updates. Empty names cannot submit. File deletion confirms the named object and folder scope; cancel preserves data.
- Memory edit keeps the current list and filters; Forget confirms session removal.
- Search is local and transient, intentionally excluded from URLs because project filenames and memory content are private session context. Clear resets immediately and returns focus.
- View changes keep workspace context. Escape closes open panels before returning to the agent; dialogs and text editing own Escape first.
- Profile and History are non-modal, named utility panels. They do not trap focus. Explicit close buttons and Escape are available.
- Run goal is disabled while a demo run is in progress. Store guards duplicate submission and duplicate approval. Demo status remains visible during execution.
- Offline status explains available local editing. No backend retry or synchronization policy is claimed.
- Sign out clears user identity, transient panels, command history, and session memory.

## Verification scope

Chromium desktop, tablet, phone, and short landscape layouts are exercised by tests/workspace.spec.ts. Automated axe checks target WCAG A/AA across primary views. Full cross-browser, assistive technology, live OAuth, backend, disk persistence, and Electron packaging remain outside this frontend verification.
