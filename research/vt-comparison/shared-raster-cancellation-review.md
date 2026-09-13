# Shared raster authority cancellation

Two new page-source regressions hold lazy raster authority behind a promise,
start two reads, then cancel one before resolving the shared image. One case
aborts a read on a single page source; the other closes one page source while a
second page source waits on the same authority.

Both cases verify that the cancelled read rejects with `AbortError`, creates no
page canvas, and does not prevent the surviving read from drawing the authority.
Exactly one canvas is allocated. Closing that page shrinks its canvas to 1×1.
Closing either page source never closes the shared authority bitmap, whose
lifetime belongs to the decoded-source owner.

Review traced the post-load `closed || signal.aborted` check before construction
of the detail page source. That ordering prevents a cancelled continuation from
allocating page resources after the authority resolves. The read's signal is
also independent of the shared authority loader's lifetime, allowing the other
read to finish. No production correction was needed.

The automatic-source and raster-preview suites pass 32 tests together; root type
checking and the edited test's whitespace check pass. This is a deterministic
ownership regression using canvas mocks, not a GPU or process-memory benchmark.
No production or benchmark changes were made, and everything remains uncommitted.
