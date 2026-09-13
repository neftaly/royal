# Page-table replacement and clearing review

The retained implementation passes a new independent-oracle property test for
mixed insertion, slot replacement, relocation and complete resident removal.
No production change is needed. Earlier insertion tests compared incremental
patching with rebuilding, while the previous randomized ancestor test always
kept a coarse resident. This test also exercises holes with no resident ancestor
and reuses the same table storage after removal.

Twenty-four seeded rectangular manifests run 80 transitions each. Seven physical
slots and three atlas columns exercise both atlas coordinates. After every
transition, an oracle searches physical residents directly for each logical
page's nearest ancestor. It compares every table byte, including zeroed holes
and storage padding, without consulting parent table entries or calling either
production table-writing function to construct the expectation.

Two isolated mutations verify sensitivity. Removing the rebuild's initial clear
fails the new property at step 31; allowing coarse insertions to overwrite fine
descendants fails at step 8. Both mutations are restored byte-for-byte. The eight
residency/property tests pass before and after mutation, and root typechecking
passes. These checks establish CPU table semantics, not GPU publication order,
speed or allocation behavior. Existing GPU lifecycle evidence remains separate.

[Validation and source hashes](page-table-cycles-validation.json).
No commit was made.
