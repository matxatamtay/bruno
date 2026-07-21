import yaml from 'js-yaml';
import { normalizeFlowDefinition, type ParseFlowOptions } from './parser';
import type { FlowDefinition, FlowDefinitionInput } from './types';

export interface SerializedFlowDocument {
  flow: FlowDefinition;
  content: string;
}

export const serializeFlowDocument = (
  input: FlowDefinitionInput | FlowDefinition | Record<string, unknown>,
  options: ParseFlowOptions = {}
): SerializedFlowDocument => {
  const flow = normalizeFlowDefinition(input, options);
  const dumped = yaml.dump(flow, {
    schema: yaml.JSON_SCHEMA,
    noRefs: true,
    noCompatMode: true,
    sortKeys: false,
    lineWidth: -1,
    skipInvalid: false
  });

  return {
    flow,
    content: dumped.endsWith('\n') ? dumped : `${dumped}\n`
  };
};

export const serializeFlow = (
  input: FlowDefinitionInput | FlowDefinition | Record<string, unknown>,
  options: ParseFlowOptions = {}
): string => serializeFlowDocument(input, options).content;
