import { createTarstateDemoSnapshot, type TarstateDemoSnapshot } from './demo.js';
import './style.css';

const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('Missing #app root');
}

app.textContent = 'Loading Tarstate demo...';

createTarstateDemoSnapshot()
  .then((snapshot) => {
    app.replaceChildren(renderDemo(snapshot));
  })
  .catch((error: unknown) => {
    app.replaceChildren(section('Demo failed', pre(error instanceof Error ? error.message : String(error))));
  });

function renderDemo(snapshot: TarstateDemoSnapshot): HTMLElement {
  const page = element('div', 'page');
  page.append(
    hero(),
    section(
      'Schema',
      table(['Relation', 'Key', 'Fields'], snapshot.schema.map((relation) => [relation.name, relation.key, relation.fields.join(', ')]))
    ),
    section('Source rows', pre(JSON.stringify(snapshot.sourceRows, null, 2))),
    section('Query', pre(JSON.stringify(snapshot.query.data, null, 2))),
    section('Query result', pre(JSON.stringify(snapshot.queryResult.rows, null, 2))),
    section(
      'Writer patch log',
      table(
        ['Op', 'Relation', 'Summary'],
        snapshot.patchLog.map((entry) => [entry.op, entry.relation, entry.summary])
      ),
      statusLine(`${snapshot.writeResult.applied}/${snapshot.writeResult.patches} patches applied`)
    ),
    section('Rows after writes', pre(JSON.stringify(snapshot.nextRows.todos, null, 2))),
    section(
      'Planned adapters',
      list(['Automerge document source and writer bridge', 'Immer-backed mutable source adapter', 'Royal renderer lens integration'])
    )
  );

  return page;
}

function hero(): HTMLElement {
  const header = element('header', 'hero');
  header.append(element('p', 'eyebrow', 'Tarstate demo'), element('h1', undefined, 'Todo queries and writer patches'), element('p', 'dek', 'A small DOM app showing relation schema metadata, object-backed source rows, query evaluation, and write patch application.'));
  return header;
}

function section(title: string, ...children: readonly HTMLElement[]): HTMLElement {
  const wrapper = element('section', 'panel');
  wrapper.append(element('h2', undefined, title), ...children);
  return wrapper;
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): HTMLElement {
  const tableElement = document.createElement('table');
  const thead = document.createElement('thead');
  const tbody = document.createElement('tbody');

  const headerRow = document.createElement('tr');
  for (const header of headers) headerRow.append(element('th', undefined, header));
  thead.append(headerRow);

  for (const row of rows) {
    const rowElement = document.createElement('tr');
    for (const cell of row) rowElement.append(element('td', undefined, cell));
    tbody.append(rowElement);
  }

  tableElement.append(thead, tbody);
  return tableElement;
}

function list(items: readonly string[]): HTMLElement {
  const listElement = document.createElement('ul');
  for (const item of items) listElement.append(element('li', undefined, item));
  return listElement;
}

function pre(content: string): HTMLPreElement {
  const preElement = document.createElement('pre');
  preElement.textContent = content;
  return preElement;
}

function statusLine(content: string): HTMLElement {
  return element('p', 'status', content);
}

function element<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  className?: string,
  textContent?: string
): HTMLElementTagNameMap[TagName] {
  const node = document.createElement(tagName);
  if (className !== undefined) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}
