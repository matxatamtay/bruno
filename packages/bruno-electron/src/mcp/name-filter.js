const filterByName = (entries, { name_ilike, name_regex } = {}) => {
  let result = entries;
  if (name_ilike) {
    const needle = String(name_ilike).toLowerCase();
    result = result.filter((entry) => entry.name.toLowerCase().includes(needle));
  }
  if (name_regex) {
    const pattern = new RegExp(name_regex, 'i');
    result = result.filter((entry) => pattern.test(entry.name));
  }
  return result;
};

module.exports = { filterByName };
