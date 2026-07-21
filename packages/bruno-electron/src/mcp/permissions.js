const PROFILE_SCOPES = Object.freeze({
  'read-only': new Set([
    'bruno:status',
    'bruno:read',
    'bruno:flow:read',
    'bruno:prepare',
    'bruno:run:read',
    'bruno:flow:write:preview'
  ]),
  'runner': new Set([
    'bruno:status',
    'bruno:read',
    'bruno:flow:read',
    'bruno:prepare',
    'bruno:execute:request',
    'bruno:execute:flow',
    'bruno:run:read',
    'bruno:flow:write:preview'
  ]),
  'editor': new Set([
    'bruno:status',
    'bruno:read',
    'bruno:flow:read',
    'bruno:prepare',
    'bruno:execute:request',
    'bruno:execute:flow',
    'bruno:run:read',
    'bruno:flow:write:preview',
    'bruno:flow:write'
  ]),
  'full-control': new Set([
    'bruno:status',
    'bruno:read',
    'bruno:flow:read',
    'bruno:prepare',
    'bruno:execute:request',
    'bruno:execute:flow',
    'bruno:run:read',
    'bruno:flow:write:preview',
    'bruno:flow:write',
    'bruno:admin'
  ])
});

const PROFILE_ALIASES = Object.freeze({
  readonly: 'read-only',
  read_only: 'read-only',
  read: 'read-only',
  full: 'full-control',
  admin: 'full-control'
});

const normalizePermissionProfile = (value = 'read-only') => {
  const normalized = String(value || 'read-only').trim().toLowerCase();
  const resolved = PROFILE_ALIASES[normalized] || normalized;
  return PROFILE_SCOPES[resolved] ? resolved : 'read-only';
};

const scopesForProfile = (profile) => new Set(PROFILE_SCOPES[normalizePermissionProfile(profile)]);

const hasScope = (profile, requiredScope) => {
  if (!requiredScope) return true;
  const scopes = PROFILE_SCOPES[normalizePermissionProfile(profile)];
  return scopes.has(requiredScope) || scopes.has('bruno:admin');
};

const assertScope = (profile, requiredScope, toolName = 'tool') => {
  if (hasScope(profile, requiredScope)) return;
  const error = new Error(`Permission profile ${normalizePermissionProfile(profile)} cannot call ${toolName}; required scope is ${requiredScope}`);
  error.code = 'BRUNO_MCP_PERMISSION_DENIED';
  error.statusCode = 403;
  throw error;
};

module.exports = {
  PROFILE_SCOPES,
  assertScope,
  hasScope,
  normalizePermissionProfile,
  scopesForProfile
};
