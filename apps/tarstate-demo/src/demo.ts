import {
  applyWrites,
  as,
  booleanField,
  defineSchema,
  eq,
  evaluate,
  from,
  fromObjectSource,
  idField,
  leftJoin,
  maybe,
  pipe,
  project,
  refField,
  relation,
  stringField,
  type MutableObjectSourceData,
  type Query,
  type QueryResult,
  type WriteApplyResult,
  type WritePatch
} from '@tarstate/core';

export type TodoRow = {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
};

export type WriterRow = {
  readonly id: string;
  readonly name: string;
};

export type TodoWriterRow = {
  readonly todoId: string;
  readonly writerId: string;
};

export type TodoDemoRow = {
  readonly id: string;
  readonly text: string;
  readonly done: boolean;
  readonly writer: string | undefined;
};

export type PatchLogEntry = {
  readonly op: WritePatch['op'];
  readonly relation: string;
  readonly summary: string;
};

export type TarstateDemoSnapshot = {
  readonly schema: readonly {
    readonly name: string;
    readonly key: string;
    readonly fields: readonly string[];
  }[];
  readonly sourceRows: MutableObjectSourceData;
  readonly query: Query<TodoDemoRow>;
  readonly queryResult: QueryResult<TodoDemoRow>;
  readonly patches: readonly WritePatch[];
  readonly patchLog: readonly PatchLogEntry[];
  readonly writeResult: WriteApplyResult;
  readonly nextRows: MutableObjectSourceData;
};

export const todoSchema = defineSchema({
  todos: relation<TodoRow>({
    key: 'id',
    fields: {
      id: idField('todo'),
      text: stringField(),
      done: booleanField()
    }
  }),
  writers: relation<WriterRow>({
    key: 'id',
    fields: {
      id: idField('writer'),
      name: stringField()
    }
  }),
  todoWriters: relation<TodoWriterRow>({
    key: 'todoId',
    fields: {
      todoId: refField('todos.id'),
      writerId: refField('writers.id')
    }
  })
});

const todo = as(todoSchema.todos, 'todo');
const todoWriter = as(todoSchema.todoWriters, 'todoWriter');
const writer = as(todoSchema.writers, 'writer');

export const todoQuery = pipe(
  from(todo),
  leftJoin(from(todoWriter), eq(todo.id, todoWriter.todoId)),
  leftJoin(from(writer), eq(todoWriter.writerId, writer.id)),
  project({
    id: todo.id,
    text: todo.text,
    done: todo.done,
    writer: maybe(writer.name)
  })
);

export function seedSourceRows(): MutableObjectSourceData {
  return {
    todos: [
      { id: 'todo-a', text: 'Sketch relation schema', done: true },
      { id: 'todo-b', text: 'Evaluate a query over object rows', done: false },
      { id: 'todo-c', text: 'Apply writer patches', done: false }
    ],
    todoWriters: [
      { todoId: 'todo-a', writerId: 'writer-mina' },
      { todoId: 'todo-c', writerId: 'writer-jules' }
    ],
    writers: [
      { id: 'writer-mina', name: 'Mina' },
      { id: 'writer-jules', name: 'Jules' }
    ]
  };
}

export function buildDemoPatches(): readonly WritePatch[] {
  return [
    { op: 'update', relation: todoSchema.todos, key: 'todo-b', changes: { done: true } },
    { op: 'insert', relation: todoSchema.todos, row: { id: 'todo-d', text: 'Leave Automerge as a planned adapter', done: false } },
    { op: 'upsert', relation: todoSchema.todoWriters, row: { todoId: 'todo-d', writerId: 'writer-mina' } }
  ];
}

export async function createTarstateDemoSnapshot(): Promise<TarstateDemoSnapshot> {
  const sourceRows = seedSourceRows();
  const queryResult = await evaluate(fromObjectSource(sourceRows), todoQuery);
  const patches = buildDemoPatches();
  const nextRows = cloneRows(sourceRows);
  const writeResult = applyWrites(nextRows, patches);

  return {
    schema: Object.values(todoSchema).map((relationRef) => ({
      name: relationRef.name,
      key: formatRelationKey(relationRef.key),
      fields: Object.keys(relationRef.fields)
    })),
    sourceRows,
    query: todoQuery,
    queryResult,
    patches,
    patchLog: patches.map(describePatch),
    writeResult,
    nextRows
  };
}

function formatRelationKey(key: unknown): string {
  return Array.isArray(key) ? key.join(', ') : String(key);
}

function cloneRows(rows: MutableObjectSourceData): MutableObjectSourceData {
  return Object.fromEntries(Object.entries(rows).map(([name, values]) => [name, values.map((value) => ({ ...(value as Record<string, unknown>) }))]));
}

function describePatch(patch: WritePatch): PatchLogEntry {
  switch (patch.op) {
    case 'insert':
      return { op: patch.op, relation: patch.relation.name, summary: `insert ${JSON.stringify(patch.row)}` };
    case 'update':
      return { op: patch.op, relation: patch.relation.name, summary: `update ${JSON.stringify(patch.key)} with ${JSON.stringify(patch.changes)}` };
    case 'upsert':
      return { op: patch.op, relation: patch.relation.name, summary: `upsert ${JSON.stringify(patch.row)}` };
    case 'delete':
      return { op: patch.op, relation: patch.relation.name, summary: `delete ${JSON.stringify(patch.key)}` };
  }
}
