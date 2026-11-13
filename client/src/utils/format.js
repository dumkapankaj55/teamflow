export function unwrap(response, key) {
  const data = response?.data?.data || {};
  return key ? data[key] : data;
}

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  return error?.response?.data?.message || error?.response?.data?.errors?.[0]?.message || error?.message || fallback;
}

export function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!value) return 'No date';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'No date' : new Intl.DateTimeFormat(undefined, options).format(date);
}

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || 'TF';
}

export function titleCase(value = '') {
  return value.toLowerCase().replace(/(^|_)([a-z])/g, (_match, separator, letter) => `${separator ? ' ' : ''}${letter.toUpperCase()}`);
}
