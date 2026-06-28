import { describe, expect, it } from 'vitest';
import { createTarstateDemoSnapshot } from './demo.js';

describe('tarstate demo data', () => {
  it('evaluates the seed query and applies the writer patches', async () => {
    const snapshot = await createTarstateDemoSnapshot();

    expect(snapshot.queryResult.diagnostics).toEqual([]);
    expect(snapshot.queryResult.rows).toEqual([
      { id: 'todo-a', text: 'Sketch relation schema', done: true, writer: 'Mina' },
      { id: 'todo-b', text: 'Evaluate a query over object rows', done: false, writer: undefined },
      { id: 'todo-c', text: 'Apply writer patches', done: false, writer: 'Jules' }
    ]);
    expect(snapshot.writeResult).toEqual({ patches: 3, applied: 3, diagnostics: [] });
    expect(snapshot.nextRows.todos).toEqual([
      { id: 'todo-a', text: 'Sketch relation schema', done: true },
      { id: 'todo-b', text: 'Evaluate a query over object rows', done: true },
      { id: 'todo-c', text: 'Apply writer patches', done: false },
      { id: 'todo-d', text: 'Leave Automerge as a planned adapter', done: false }
    ]);
    expect(snapshot.patchLog.map((entry) => entry.op)).toEqual(['update', 'insert', 'upsert']);
  });
});
