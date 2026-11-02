# EDITH UI refinement — verification

Verified on 2026-10-23. This report supersedes the earlier visual-only v0.4 report.

## Delivered behavior

- Graphite surfaces, coral primary actions, a consistent type hierarchy, labeled desktop navigation, and phone bottom navigation.
- Refined entry, example picker, agent, file editor, graph, memory, activity, history, and profile surfaces.
- Shared search fields with accessible labels, clear controls, and no-results states.
- App-owned dialogs with native modal focus containment, Escape cancellation, safe initial focus, and viewport bounds.
- Note and folder names reject invalid/reserved names and duplicates. Folder renames update descendants. Deleting a folder clears an open descendant. Cancel preserves data.
- Session autosave status and Ctrl/Cmd+S. Opening a file after saving reads the latest file tree.
- Demo execution rejects overlapping submissions and repeated approval. Approval scope and verification are explicitly simulated.
- View-level recovery, optional visualization fallback, offline feedback, keyboard graph browsing, and reduced-motion preferences.
- Sign out clears transient identity, files, history, memory, graph context, and private graph filters.
- Route splitting keeps editor and 3D dependencies out of the initial app bundle.

## Checks and results

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run build` | Passed with Vite 7.3.7; optional editor/3D chunk warnings remain |
| `npm run qa:a11y` | Passed after explicit waits for fully loaded views; 32.4 seconds |
| `git diff --check` | Passed |
| Premium UI auditor, `--mode strict` | Passed: 0 errors, 0 warnings |
| DESIGN.md official CLI lint | Passed: 0 errors; 5 unused-color-reference warnings |
| `npm audit fix` | Compatible patches applied; audit reported 0 vulnerabilities |
| Browser scenarios in `tests/workspace.spec.ts` | All 11 distinct scenarios passed across the main run and targeted reruns |
| Axe checks | No A/AA violations in tested entry, picker, primary views, approval, invalid-name dialog, mobile agent/graph, and profile preferences states |

The 30-transition responsive matrix exceeded its original 45-second total timeout during a concurrent build. With a 90-second CI budget and the build complete, it passed in 32.6 seconds. The final targeted preference/sign-out check passed in 17.4 seconds. No retries suppress failing assertions.

## Browser scenario coverage

1. Entry and accessibility across all five workspace views.
2. Navigation visibility and document overflow at 1440×1000, 1024×768, 768×1024, 390×844, 320×568, and 844×390.
3. Memory search, no results, clear, editing, confirmation cancellation, and removal.
4. Note creation, rename, cancelled deletion, and deletion.
5. Demo execution, busy-state duplicate prevention, approval, history, and offline status.
6. Invalid filenames and duplicate-note errors preserve the dialog and expose accessible field errors.
7. Failed lazy-view loading shows an app-owned reload recovery action.
8. Mobile accessibility, keyboard graph filtering, clear-focus restoration, native toggle behavior, and reduced motion.
9. Folder rename updates descendant paths, rapid file navigation preserves edits, and folder deletion clears its open descendant. Cancel receives initial focus.
10. Browser Back restores views; the graph's non-drag list opens files.
11. Profile switches work with the keyboard; reduced-motion class updates; sign-out clears history for the next session.

Chromium ran through Playwright using the system browser. `scripts/inspect-ui.mjs` captures desktop and phone screenshots into `/tmp` and performed an additional mobile axe pass after waiting for each view to finish loading on Workspace, Graph, Memory, and Activity.

## Bundle evidence

Initial application JS is approximately 376 kB raw / 121 kB gzip, compared with approximately 1,187 kB raw before route splitting. Optional editor and Möbius chunks remain approximately 789 kB and 868 kB raw. Their size warnings are retained rather than hidden by increasing Vite's warning threshold.

## Release boundaries

This is a refined and tested frontend, not a completed production AI service. Agent execution and test outcomes are simulated; edits remain in session memory and are lost on reload. Production authentication requires server-side Google credential verification. Persistent storage, real model/tool execution, and Electron packaging still need implementation.

Automated axe checks are not a full accessibility certification. Safari, Firefox, assistive technology, touch devices, live Google OAuth, and real backend failure paths were not covered. The screenshot/browser pass used Chromium with software WebGL; actual GPU performance needs device testing. No universal zero-defect claim is made.
