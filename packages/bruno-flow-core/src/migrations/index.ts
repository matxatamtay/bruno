import { UnsupportedFlowVersionError } from '../errors';

export const CURRENT_FLOW_SCHEMA_VERSION = 1;

export interface MigrationContext {
  now: () => Date;
}

export interface MigrationResult {
  document: Record<string, unknown>;
  migratedFrom: number | null;
}

type Migration = (document: Record<string, unknown>, context: MigrationContext) => Record<string, unknown>;

const migrateV0ToV1: Migration = (document, context) => {
  const now = context.now().toISOString();
  const metadata = document.metadata && typeof document.metadata === 'object'
    ? document.metadata as Record<string, unknown>
    : {};

  return {
    schemaVersion: 1,
    uid: document.uid ?? document.id,
    name: document.name,
    ...(document.description !== undefined ? { description: document.description } : {}),
    revision: document.revision ?? 'rev:migrated',
    workspace: document.workspace ?? { uid: document.workspaceUid },
    defaults: document.defaults ?? document.settings ?? {},
    ...(document.inputSchema !== undefined ? { inputSchema: document.inputSchema } : {}),
    ...(document.outputSchema !== undefined ? { outputSchema: document.outputSchema } : {}),
    nodes: document.nodes ?? [],
    controlEdges: document.controlEdges ?? document.edges ?? [],
    dataEdges: document.dataEdges ?? [],
    frames: document.frames ?? document.groups ?? [],
    ...(document.viewport !== undefined ? { viewport: document.viewport } : {}),
    metadata: {
      ...metadata,
      createdAt: metadata.createdAt ?? now,
      updatedAt: metadata.updatedAt ?? now
    }
  };
};

const migrations = new Map<number, Migration>([[0, migrateV0ToV1]]);

const readSchemaVersion = (document: Record<string, unknown>): number => {
  if (document.schemaVersion === undefined || document.schemaVersion === null) return 0;
  if (typeof document.schemaVersion !== 'number' || !Number.isInteger(document.schemaVersion)) {
    return Number.NaN;
  }
  return document.schemaVersion;
};

export const migrateFlowDocument = (
  input: Record<string, unknown>,
  context: MigrationContext = { now: () => new Date(0) }
): MigrationResult => {
  const originalVersion = readSchemaVersion(input);
  if (!Number.isFinite(originalVersion) || originalVersion < 0 || originalVersion > CURRENT_FLOW_SCHEMA_VERSION) {
    throw new UnsupportedFlowVersionError(originalVersion);
  }

  let version = originalVersion;
  let document = { ...input };

  while (version < CURRENT_FLOW_SCHEMA_VERSION) {
    const migration = migrations.get(version);
    if (!migration) throw new UnsupportedFlowVersionError(version);
    document = migration(document, context);
    version += 1;
  }

  return {
    document,
    migratedFrom: originalVersion === CURRENT_FLOW_SCHEMA_VERSION ? null : originalVersion
  };
};
