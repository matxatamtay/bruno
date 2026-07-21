import yaml from 'js-yaml';
import { canonicalizeFlow } from './canonical';
import { FlowParseError } from './errors';
import { migrateFlowDocument, type MigrationContext } from './migrations';
import { assertValidFlowDefinition } from './schema';
import type { FlowDefinition, FlowDefinitionInput, ParsedFlowDocument } from './types';

const assertObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new FlowParseError('Flow document root must be an object');
  }
  return value as Record<string, unknown>;
};

export interface ParseFlowOptions {
  now?: () => Date;
}

export const normalizeFlowDefinition = (
  input: FlowDefinitionInput | FlowDefinition | Record<string, unknown>,
  options: ParseFlowOptions = {}
): FlowDefinition => {
  const migrationContext: MigrationContext = { now: options.now || (() => new Date(0)) };
  const migration = migrateFlowDocument(assertObject(input), migrationContext);
  const canonical = canonicalizeFlow(migration.document as unknown as FlowDefinitionInput);
  return assertValidFlowDefinition(canonical);
};

export const parseFlowDocument = (source: string, options: ParseFlowOptions = {}): ParsedFlowDocument => {
  let parsed: unknown;
  try {
    parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new FlowParseError(message);
  }

  const raw = assertObject(parsed);
  const migration = migrateFlowDocument(raw, { now: options.now || (() => new Date(0)) });
  const storedRevision = typeof migration.document.revision === 'string' ? migration.document.revision : null;
  const flow = normalizeFlowDefinition(migration.document, options);
  const revisionMismatch = storedRevision !== flow.revision;

  return {
    flow,
    storedRevision,
    computedRevision: flow.revision,
    revisionMismatch,
    migratedFrom: migration.migratedFrom,
    warnings: revisionMismatch && storedRevision
      ? [`Stored revision ${storedRevision} did not match content revision ${flow.revision}`]
      : []
  };
};

export const parseFlow = (source: string, options: ParseFlowOptions = {}): FlowDefinition => {
  return parseFlowDocument(source, options).flow;
};
