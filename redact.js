// Never log credentials: strip URL userinfo and mask known secret values.
// The userinfo match stays inside one URL token (no whitespace, quotes, '/', '<' or '>' before the '@'),
// so text or JSON that merely contains '//' and a later '@' (e.g. a URL followed by an email) is left intact.
function makeRedactor(secrets) {
  const values = secrets.filter(v => v && v.length >= 3);
  return function redact(text) {
    let out = String(text).replace(/(\/\/)[^\/\s@"'<>]+@/g, '$1***:***@');
    for (const v of values) out = out.split(v).join('***');
    return out;
  };
}

module.exports = { makeRedactor };
