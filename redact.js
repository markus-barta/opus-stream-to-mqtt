// Never log credentials: strip URL userinfo and mask known secret values.
// The userinfo match follows the URL grammar: userinfo ends at '@' and never contains '/', '?' or '#' (where the
// authority ends), whitespace, '"', '<', '>' or '`' (not valid unencoded). Apostrophes and commas ARE valid in userinfo,
// so they do not stop the match: redacting too much beats leaking a credential.
function makeRedactor(secrets) {
  const values = secrets.filter(v => v && v.length >= 3);
  return function redact(text) {
    let out = String(text).replace(/(\/\/)[^\/?#\s@"<>`]+@/g, '$1***:***@');
    for (const v of values) out = out.split(v).join('***');
    return out;
  };
}

module.exports = { makeRedactor };
