# Writing Lab UI system

## Product direction

The interface is designed as a serious learning product rather than a collection of disconnected forms. A persistent white workspace rail holds the main information architecture. The canvas and cards use white or neutral grey surfaces, with restrained indigo reserved for actions, teal for verified or progressing states, and gold only for task taxonomy. The user-facing product is intentionally light-only for maximum writing contrast.

The design workflow now uses the Sites plugin capability path against the existing application. Production HTML, CSS and browser behaviour are the single source of truth; the previous Figma draft is archived and is no longer required for design delivery.

## Foundations

| Token | Value | Role |
|---|---|---|
| Canvas | `#F7F8FB` | Neutral application background |
| Surface | `#FFFFFF` | Cards and controls |
| Ink | `#13203B` | Primary text |
| Navigation | `#FFFFFF` | Persistent workspace rail |
| Brand | `#5364EE` | Primary actions and focus |
| Teal | `#087F76` | Verified, Task 1 and progress states |
| Gold | `#B66A05` | Task taxonomy and classification |
| Error | `#B5473C` | Blocking and review states |

The main geometry uses 8/11/14/16/22 px radii, a 4/8/12/16/24/32/48 spacing scale and three restrained elevation levels. Inter is the preferred UI face; the browser stack falls back to system sans-serif fonts.

## Components

- Primary, secondary and dark action buttons with visible focus states.
- Search, select and textarea controls sharing one border/focus language.
- Task, module, source and score badges with semantic colour rather than decorative colour.
- Prompt cards that display taxonomy before title and source.
- A split writing studio with prompt/collapsible plan/full-width editor on the left and references/scoring on the right.
- A compact timer inside the editor toolbar, so the essay never loses horizontal writing space.
- A writing focus mode that hides navigation, supporting metadata and the assistant rail while keeping the prompt and draft visible.
- Criterion reports that reveal `当前表现 → 分数边界 → 全文模式 → 原文证据 → 下一次修改`.
- Feedback repair and human-review notices that never imply an official IELTS result.

## Product screens

1. Learning dashboard — current task, four task categories, library counts and a weekly goal.
2. Practice library — seven filters, 30-item incremental rendering and a two-task mock entry.
3. Writing studio — task image or letter prompt, planning fields, editor, timer and frozen-score workflow.
4. Score report — Overall, four independent criteria, exact quotations and faithful before/after revision.
5. Teacher feedback and expression collection — retained as downstream learning surfaces.

## Responsive behaviour

- At 1260 px, the rail narrows and dense card grids simplify.
- At 980 px, the rail becomes a top navigation strip, the writing split becomes one column and filters use two columns.
- At 720 px, controls and actions become full-width and criterion patterns stack vertically.
