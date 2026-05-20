const normalizers = require('./normalizers');
const clipboard = require('./clipboard');
const readers = require('./readers');
const powershell = require('./powershell');
const scripts = require('./scripts');

module.exports = {
  ...normalizers,
  ...clipboard,
  ...readers,
  ...powershell,
  ...scripts,
};
