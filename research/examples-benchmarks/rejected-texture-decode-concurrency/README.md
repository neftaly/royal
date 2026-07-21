# Rejected texture decode concurrency

The physical Safari Bistro comparison in `ipad-bistro-exterior-8-decode-lanes.json`
changed only the root-local browser bitmap decode bound from four lanes to eight;
the asset-preparation, decoded-handoff, upload, GPU-memory, scene, and resolution
policies stayed unchanged.

Against exact clean commit `700e3ad0` at four lanes, Exterior reached first
usable content in 4.002 seconds and completed 202 textures in 41.700 seconds.
The dirty eight-lane build based on `73c2dde2` reached first usable content in
4.145 seconds and completed the same textures in 41.624 seconds. Persistent GPU
bytes, residency, failure counts, and admission counts were identical. The
0.2% completion difference is noise and does not justify doubling concurrent
browser decode work or its transient memory risk. Keep four lanes unless a new
browser/format profile produces measured counterevidence.
