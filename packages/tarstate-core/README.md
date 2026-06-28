# Tarstate

Tarstate lets you query JSON-shaped data as rows.

Use it when a component needs to combine stored records, assignments, visibility,
or other structured data.

```tsx
import {
  as, evaluate, fromObjectSource, refField, from,
  eq, relation, composeSources, maybe, pipe,
  idField, leftJoin, defineSchema, project, stringField,
} from '@tarstate/core'

// Define todo data and relationships.
const schema = defineSchema({
  todos: relation<{ id: string; text: string }>({
    key: 'id',
    fields: { id: idField('todo'), text: stringField() },
  }),
  assignments: relation<{ todoId: string; assignee: string }>({
    key: 'todoId',
    fields: { todoId: refField('todos.id'), assignee: stringField() },
  }),
})

// Pull in data from separate sources.
const todoAppSource = fromObjectSource({
  todos: [
    { id: 'todo-a', text: 'Buy oat milk' },
    { id: 'todo-b', text: 'Water basil' },
  ],
})
const teamSource = fromObjectSource({
  assignments: [{ todoId: 'todo-a', assignee: 'Mina' }],
})

// Combine the sources for the query.
const source = composeSources(todoAppSource, teamSource)

const todo = as(schema.todos, 'todo')
const assignment = as(schema.assignments, 'assignment')

// Build the query.
const todoRows = pipe(
  from(todo), // => [{ todo: { id: 'todo-a', ... } }, { todo: { id: 'todo-b', ... } }]
  // leftJoin appends matches from another query.
  leftJoin(from(assignment), eq(todo.id, assignment.todoId)), // => [{ todo: { id: 'todo-a', ... }, assignment: { assignee: 'Mina', ... } }, { todo: { id: 'todo-b', ... } }]
  // project formats the results nicely.
  project({
    id: todo.id,
    text: todo.text,
    assignedTo: maybe(assignment.assignee),
  }), // => [{ id: 'todo-a', assignedTo: 'Mina', ... }, { id: 'todo-b', assignedTo: undefined, ... }]
)

// Run the query against the current data.
const loadTodos = async () => (await evaluate(source, todoRows)).rows

export function TodoList() {
  const todos = useAppQuery(loadTodos)

  return todos.map((todo) => (
    <div key={todo.id}>
      {todo.text} is assigned to {todo.assignedTo ?? 'unassigned'}
    </div>
  ))
}
```

## Acknowledgements

Tarstate borrows its shape from [Relic](https://github.com/wotbrew/relic),
after [Out of the Tar Pit](http://curtclifton.net/papers/MoseleyMarks06a.pdf).
