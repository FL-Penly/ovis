/**
 * Downstream (FL-Penly/ovis, DOWNSTREAM.md): whether a test harness drives this browser. Upstream's
 * browser scripts are written for upstream's defaults, so under them the fork's own defaults step
 * aside: the classic sidebar, the strip's + opening a shell at once, and upstream's key bar on a
 * touch screen. A person's browser never sets `navigator.webdriver`.
 */
export const drivenByTests = typeof navigator !== "undefined" && navigator.webdriver === true;
