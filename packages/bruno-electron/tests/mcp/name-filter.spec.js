const { filterByName } = require('../../src/mcp/name-filter');

describe('filterByName', () => {
  const entries = [{ name: 'TwinApe' }, { name: 'Sample API Collection' }, { name: 'My Workspace' }];

  it('returns every entry when no filter is given', () => {
    expect(filterByName(entries, {})).toEqual(entries);
  });

  it('matches name_ilike case-insensitively as a substring', () => {
    expect(filterByName(entries, { name_ilike: 'twin' })).toEqual([{ name: 'TwinApe' }]);
    expect(filterByName(entries, { name_ilike: 'WORKSPACE' })).toEqual([{ name: 'My Workspace' }]);
  });

  it('matches name_regex case-insensitively', () => {
    expect(filterByName(entries, { name_regex: '^(twinape|my workspace)$' })).toEqual([
      { name: 'TwinApe' },
      { name: 'My Workspace' }
    ]);
  });

  it('combines name_ilike and name_regex as AND', () => {
    expect(filterByName(entries, { name_ilike: 'sample', name_regex: 'collection$' })).toEqual([
      { name: 'Sample API Collection' }
    ]);
    expect(filterByName(entries, { name_ilike: 'sample', name_regex: '^nomatch$' })).toEqual([]);
  });

  it('throws on an invalid regex, matching the register() error-wrapping convention', () => {
    expect(() => filterByName(entries, { name_regex: '(' })).toThrow();
  });
});
