import { runIntegration } from './integration-probe';
import { runImports } from './import-probe';
import { runMaterials } from './material-probe';
import { runViewLists } from './view-probe';
import { runRichMaterials } from './rich-material-probe';
import { runBudgetRecovery } from './budget-probe';
import { runFrames } from './frame-probe';

export const runAcceptance = async () => {
  const results: unknown[] = [];
  const started = performance.now();
  for (const [name, run] of [
    ['integration', runIntegration], ['imports', runImports], ['materials', runMaterials],
    ['budgetRecovery', runBudgetRecovery], ['viewLists', runViewLists], ['richMaterials', runRichMaterials], ['frames', runFrames],
  ] as const) {
    document.querySelector('#status')?.replaceChildren(name);
    const value = await run(); results.push({ name, ...value });
  }
  return { date: new Date().toISOString(), durationMs: performance.now()-started, userAgent: navigator.userAgent, results };
};
Object.assign(window, { runManyLights: runAcceptance });
