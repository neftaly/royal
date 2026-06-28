# Text visual diagnosis

The examples browser smoke records objective canvas text measurements without
adding DOM or raster overlays over renderer text.

Run the examples browser smoke with an optional JSON report:

```sh
EXAMPLES_TEXT_QA_REPORT=research/text-visual-diagnosis/text-smoke-report.json pnpm --filter @royal/examples-react test:browser
```

If `research/text-visual-diagnosis/text-smoke-oracle.json` exists, or
`EXAMPLES_TEXT_QA_ORACLE` points at another JSON file, the same measurements
become hard assertions. Until then the smoke prints provisional text-quality
warnings for the Text Prototype route. The checked-in example oracle is
intentionally inactive and stricter than the current synthetic canvas output.

The Text Prototype acceptance string is `AV office 108%.` because it exercises
kerning-sensitive pairs, counters/holes, punctuation, numerals, and lowercase.
