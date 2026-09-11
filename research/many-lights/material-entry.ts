import { runMaterials } from './material-probe';
(globalThis as unknown as { runManyLights: typeof runMaterials }).runManyLights = runMaterials;
document.body.innerHTML = '<p id="status">Full material parity</p>';
