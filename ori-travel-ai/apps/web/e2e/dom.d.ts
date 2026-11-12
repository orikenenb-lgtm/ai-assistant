// The e2e project is compiled with the Node tsconfig (no DOM lib). Callbacks passed to `page.evaluate()` run in the
// browser, so they need the DOM types. This ambient reference adds them for every file under e2e/.
/// <reference lib="dom" />
