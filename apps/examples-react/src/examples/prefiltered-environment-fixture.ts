import { prefilteredEnvironment } from '@royal/react/scene';

// Minimal valid packed-R11 KTX1 artifact used only to exercise browser transport,
// SH diffuse lighting, cubemap sampling, and source/version observation.
const source = 'data:application/octet-stream;base64,q0tUWCAxMbsNChoKAQIDBDuMAAAEAAAABxkAADqMAAAHGQAAAgAAAAIAAAAAAAAAAAAAAAYAAAACAAAAtAAAALAAAAByb3lhbC5lbnZpcm9ubWVudC52MQB7InByb3ZlbmFuY2UiOiJSb3lhbCAycHggYnJvd3NlciBwcm9vZiIsInNoIjpbWzAuODg2MjI2OSwxLjI0MDcxNzcsMS43NzI0NTM5XSxbMCwwLDBdLFswLDAsMF0sWzAsMCwwXSxbMCwwLDBdLFswLDAsMF0sWzAsMCwwXSxbMCwwLDBdLFswLDAsMF1dLCJ2ZXJzaW9uIjoxfRAAAADAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHnjAAx54wAMeeMADHngEAAAAwAMeeMADHnjAAx54wAMeeMADHnjAAx54';

export const browserProofPrefilteredEnvironment = prefilteredEnvironment({
  radianceScaleNits: 1.25,
  src: source,
  version: 'browser-proof-v1',
});
