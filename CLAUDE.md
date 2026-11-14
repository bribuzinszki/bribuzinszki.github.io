# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal design portfolio (Learning Experience Design / AI literacy) served by GitHub Pages at https://bribuzinszki.github.io/. It is a plain static site built on the **Phantom** template by HTML5 UP (CCA 3.0, attribution comment kept at the top of every page). There is no package.json, no build pipeline, no tests and no linter; pushing to `main` deploys.

Local preview: `python3 -m http.server` from the repo root, then open http://localhost:8000/.

## Page structure

Every page is a standalone HTML file at the repo root that repeats the same shell: `<head>` meta/OG tags (with absolute `https://bribuzinszki.github.io/...` URLs), `#header` with logo and contact icons, the `#menu` nav, `#main`, `#footer`, then the template scripts (`jquery.min.js`, `browser.min.js`, `breakpoints.min.js`, `util.js`, `main.js`). There are no includes or templates, so **changes to the header, menu, footer or contact links must be made in every HTML file.**

Page types:
- `index.html`: landing page with three `.tiles` sections (`#try-it`, `#case-studies`, `#frameworks`). Each tile is an `<article class="styleN">` with an image and a link; tiles pointing at `generic.html` are placeholders. A commented-out block holds tiles that are hidden for now.
- `case-*.html`: case studies using the `cs-*` classes (`.cs-lead`, `.cs-overview`, `.cs-shot`/`.cs-shot-bar` browser-frame screenshot, `.cs-facts`, `.cs-pager` back/next links). The pager links form a chain between case studies, so adding or reordering one means updating its neighbours.
- `framework-*.html`: framework write-ups.
- `*-exercise.html` and `eu-ai-act-high-risk.html`: self-contained interactive modules. Each has its own scoped `<style>` block and inline `<script>` inside `#main`; their CSS is namespaced under a module id (e.g. `#aia-module` with `--aia-*` custom properties) so it doesn't leak into the template styles.
- `agents-course.html` + `agents-module-*.html`: the story-based course "Working with AI Agents" (fictional product Taskzilla, company BestSolutions). The landing tile and menu point to the course page, which links to each module. Unlike the other interactive pages, these share one stylesheet, `assets/css/agents-course.css` (everything scoped under `#tz`); each page keeps its own inline script. Modules are single scrolling pages (no click-to-reveal), with a sticky contents list and independent activities. Progress is saved in `localStorage` under `tz-agents-course` (try/catch) and read by the course page. Modules 1 and 2 exist so far; the course script lives in a separate review doc, not in this repo.
- `privacy.html`: privacy notice in English and Brazilian Portuguese (LGPD), linked from the footer `.copyright` list on every page, not from the menu. It has a "Delete my saved progress" button that clears every `localStorage` key the site uses.
- `elements.html` / `generic.html`: original template reference pages.

When adding a page, also add it to the `#menu` list in every file and, if relevant, a tile on `index.html` (tile images live in `images/tile-*.jpg`, heroes in `images/hero-*.jpg`).

## Privacy

The site sets no cookies, runs no analytics and loads nothing from other servers; the font (Source Sans Pro) is self-hosted in `assets/webfonts/` with `@font-face` rules at the top of `main.css` / `main.scss`. Keep it that way, or update `privacy.html` in the same change:
- a new `localStorage` key goes into both tables on `privacy.html` (EN and PT) and into its `KEYS` list;
- any third-party request (fonts, scripts, embeds, analytics, iframes) needs a section in both languages, and cookies or analytics would need consent under the LGPD.

## EU AI Act module

`eu-ai-act-high-risk.html` is bilingual. All text lives in two JSON blocks with identical structure: `<script type="application/json" id="aia-content">` (German original) and `id="aia-content-en"` (English translation). Any content change must be made in both. Language is chosen by the DE | EN switch, `?lang=de` / `?lang=en`, or the choice remembered in `localStorage` (default English). `?review` highlights corrected and new texts. Progress is stored in `localStorage` with try/catch fallbacks to memory.

## Styles

Source Sass lives in `assets/sass/` (`main.scss` imports `libs/`, `base/`, `components/`, `layout/`); custom additions include `components/_case-study.scss`. The browser loads only the compiled `assets/css/main.css`, which is committed. No Sass build is configured in the repo, so when changing a partial, apply the same change to `assets/css/main.css` (or recompile with the `sass` CLI) and keep the two in sync. Page-specific styling for interactive modules goes in that page's inline `<style>` instead.
