# QZ — Think fast. Prove it.

QZ is a browser-based quiz experience with a dark, high-contrast interface, quiz categories, and a focused quiz/result flow.

## Run

This project is currently structured as a static HTML/CSS/JavaScript app. Open `index.html` through a local static server (such as VS Code Live Server) for the most consistent browser behavior.

## Before deploying

- [ ] Verify every category card opens the intended quiz.
- [ ] Complete a quiz with all correct answers, all incorrect answers, and a mixture.
- [ ] Confirm score, question counter, progress indicator and final result agree.
- [ ] Confirm answer options cannot be selected repeatedly after a question is locked.
- [ ] Test restart, close/back, empty question sets and malformed/unavailable question data.
- [ ] Test custom quiz setup with missing fields, unusual question counts and no selected category.
- [ ] Check external/news question sources for licensing, attribution, timeouts and API failure handling.
- [ ] Verify that any daily challenge is actually date-aware and does not claim fresh news when the source is stale.
- [ ] Test keyboard-only navigation, visible focus, screen-reader labels and reduced motion.
- [ ] Test narrow Android screens and a slow/unstable connection.

## Product priorities

1. Correctness first: deterministic scoring and resilient question loading.
2. Learning value: explanations and references after each answer.
3. Progress: topic-level results and a review list for missed questions.
4. Trust: source attribution, clear timestamps for news questions, and graceful API error states.
5. Performance: avoid blocking the first render on optional external question sources.

## Status

This README records the release checklist; it does not claim that every item has passed. Run the checks against the deployed build before advertising the app as production-ready.
