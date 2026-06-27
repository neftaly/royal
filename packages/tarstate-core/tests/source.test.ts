import { describe, expect, it } from 'vitest';
import {
  as,
  anchoredPath,
  composeSources,
  defineSchema,
  evaluate,
  from,
  fromIndexedObjectSource,
  fromObjectSource,
  id,
  leftJoin,
  maybe,
  optional,
  pipe,
  project,
  ref,
  relation,
  string,
  eq,
  type RelationSource,
  type TarstateDiagnostic
} from '@tarstate/core';

const schema = defineSchema({
  objects: relation<{
    id: string;
    kind: string;
    title: string;
  }>({
    key: 'id',
    fields: {
      id: id('object'),
      kind: string(),
      title: string()
    }
  }),
  presence: relation<{
    workspaceId: string;
    peerId: string;
    clientId: string;
    targetObjectId?: string;
    focusPath?: readonly unknown[];
  }>({
    ephemeral: true,
    key: ['workspaceId', 'peerId', 'clientId'],
    fields: {
      workspaceId: id('workspace'),
      peerId: id('peer'),
      clientId: string(),
      targetObjectId: optional(ref('objects.id')),
      focusPath: optional(anchoredPath())
    }
  })
});

const object = as(schema.objects, 'object');
const presence = as(schema.presence, 'presence');

const focusedObjects = pipe(
  from(object),
  leftJoin(from(presence), eq(object.id, presence.targetObjectId)),
  project({
    id: object.id,
    title: object.title,
    focusedBy: maybe(presence.peerId)
  })
);

describe('tarstate sources', () => {
  it('composes durable rows, ephemeral presence rows, and visibility diagnostics', async () => {
    const unreadableDiagnostic: TarstateDiagnostic = {
      code: 'unreadable_ref',
      message: 'linked Automerge document is unreadable',
      relation: 'objects',
      key: 'document:secret'
    };
    const visibilitySource: RelationSource = {
      rows: () => [],
      diagnostics: () => [unreadableDiagnostic]
    };

    const result = await evaluate(
      composeSources(
        fromObjectSource({
          objects: [{ id: 'object-a', kind: 'file', title: 'Alpha' }]
        }),
        fromObjectSource({
          presence: [
            {
              workspaceId: 'workspace-a',
              peerId: 'peer-a',
              clientId: 'client-a',
              targetObjectId: 'object-a',
              focusPath: ['object-a']
            }
          ]
        }),
        visibilitySource
      ),
      focusedObjects
    );

    expect(result.rows).toEqual([{ id: 'object-a', title: 'Alpha', focusedBy: 'peer-a' }]);
    expect(result.diagnostics).toEqual([unreadableDiagnostic]);
  });

  it('routes rows and lookups only to sources that declare a matching relation', async () => {
    const objectSource = fromObjectSource({
      objects: [{ id: 'object-a', kind: 'file', title: 'Alpha' }]
    });
    const presenceSource = fromObjectSource({
      presence: [{ workspaceId: 'workspace-a', peerId: 'peer-a', clientId: 'client-a', targetObjectId: 'object-a' }]
    });
    const source = composeSources(objectSource, presenceSource);

    expect(Array.from(await source.rows(schema.objects))).toEqual([
      { id: 'object-a', kind: 'file', title: 'Alpha' }
    ]);
    expect(Array.from(await source.rows(schema.presence))).toEqual([
      { workspaceId: 'workspace-a', peerId: 'peer-a', clientId: 'client-a', targetObjectId: 'object-a' }
    ]);
  });

  it('does not answer composed lookup unless every relevant source can answer it', async () => {
    const source = composeSources(
      fromIndexedObjectSource({
        objects: [{ id: 'object-a', kind: 'file', title: 'Alpha' }]
      }),
      fromObjectSource({
        objects: [{ id: 'object-b', kind: 'file', title: 'Beta' }]
      })
    );

    expect(await source.lookup?.({ relation: schema.objects, field: 'id', value: 'object-a' })).toBeUndefined();
  });
});
