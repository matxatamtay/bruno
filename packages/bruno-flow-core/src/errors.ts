import type { FlowValidationIssue } from './types';

export class FlowCoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class FlowParseError extends FlowCoreError {
  constructor(message: string) {
    super('FLOW_PARSE_ERROR', message);
  }
}

export class FlowValidationError extends FlowCoreError {
  readonly issues: FlowValidationIssue[];

  constructor(issues: FlowValidationIssue[]) {
    super('FLOW_VALIDATION_ERROR', issues.map((issue) => `${issue.path || '/'} ${issue.message}`).join('; '));
    this.issues = issues;
  }
}

export class UnsupportedFlowVersionError extends FlowCoreError {
  readonly schemaVersion: number;

  constructor(schemaVersion: number) {
    super('FLOW_UNSUPPORTED_SCHEMA_VERSION', `Unsupported flow schemaVersion ${schemaVersion}`);
    this.schemaVersion = schemaVersion;
  }
}

export class FlowRevisionConflictError extends FlowCoreError {
  readonly pathname: string;
  readonly expectedRevision: string;
  readonly actualRevision: string;

  constructor(pathname: string, expectedRevision: string, actualRevision: string) {
    super(
      'FLOW_REVISION_CONFLICT',
      `Flow revision conflict at ${pathname}: expected ${expectedRevision}, found ${actualRevision}`
    );
    this.pathname = pathname;
    this.expectedRevision = expectedRevision;
    this.actualRevision = actualRevision;
  }
}

export class FlowRevisionRequiredError extends FlowCoreError {
  constructor(pathname: string) {
    super('FLOW_REVISION_REQUIRED', `expectedRevision is required when modifying ${pathname}`);
  }
}

export class FlowNotFoundError extends FlowCoreError {
  constructor(pathname: string) {
    super('FLOW_NOT_FOUND', `Flow not found at ${pathname}`);
  }
}

export class FlowAlreadyExistsError extends FlowCoreError {
  constructor(pathname: string) {
    super('FLOW_ALREADY_EXISTS', `Flow already exists at ${pathname}`);
  }
}

export class InvalidFlowPathError extends FlowCoreError {
  constructor(relativePath: string) {
    super('FLOW_INVALID_PATH', `Invalid flow path: ${relativePath}`);
  }
}

export class FlowDraftNotFoundError extends FlowCoreError {
  constructor(draftUid: string) {
    super('FLOW_DRAFT_NOT_FOUND', `Flow draft not found: ${draftUid}`);
  }
}
