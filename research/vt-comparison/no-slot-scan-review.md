# Scheduler no-slot scan review

No runtime change is retained. A proposed shortcut would stop scanning a
resource's remaining demand after the shared atlas cannot supply a slot. The
current scheduler continues to later pages, so a synthetic resource with many
missing pages and a fully protected atlas could repeat the same unsuccessful
slot search. Coarse preview replacement needs an exception: a later request
can reuse its existing resident slot despite other cells being protected.

Before adding that branch, temporary instrumentation recorded actual slot
lookups across the 183 runtime tests. The [observation](no-slot-scan-observation.json)
contains 4,620 lookups. Only 37 fail to find a slot, all for authored resources
with exactly one demanded page and no coarse preview. Returning early would
skip no later demand in those calls. Larger demand sets occur, including 81
pages, but their observed slot lookups succeed. Admission already limits
demand before the scheduler visits it; the full-atlas queue-release regression
also remains green.

This does not prove the proposed shortcut can never help. These are unit-test
workloads with fake GL, not representative application timings. It does mean
that the existing evidence does not justify adding a hot-path branch and a
preview exception. A future optimization should first reproduce multiple
unsuccessful slot searches in one scheduling visit under a real workload.

The instrumentation preserved the existing branch behavior and was restored
byte-for-byte after the run. All 183 instrumented tests and the subsequent
uninstrumented verification pass. Console-based
attempts yielded no observations; an earlier file-based attempt failed because
the temporary filesystem was full and is excluded. The successful observation
writes to the workspace cache. No performance or GC claim is made from this
instrumented run, and no commit was made.
