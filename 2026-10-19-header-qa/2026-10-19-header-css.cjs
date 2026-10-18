'use strict';
const assert = require('node:assert/strict');
const startMarker = '/* Header-only compact identity. */\n';
const endMarker = '/* End header-only compact identity. */\n';

function headerCSS(css) {
  const start = css.indexOf(startMarker);
  if (start < 0) return '';
  const end = css.indexOf(endMarker, start);
  assert.ok(end >= 0, 'Header style block must have an end marker');
  assert.equal(css.indexOf(startMarker, start + startMarker.length), -1, 'Only one header block is allowed');
  assert.equal(css.indexOf(endMarker, end + endMarker.length), -1, 'Only one header end marker is allowed');
  return css.slice(start, end + endMarker.length);
}

function stripHeaderCSS(css) {
  const header = headerCSS(css);
  return header ? css.replace(header, '') : css;
}

module.exports = { headerCSS, stripHeaderCSS };
