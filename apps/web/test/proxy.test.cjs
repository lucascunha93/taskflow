const { test } = require('node:test');
const assert = require('node:assert/strict');
const proxy = require('../proxy.conf.json');

const patterns = Object.keys(proxy).filter((key) => key.startsWith('^')).map((key) => new RegExp(key));
const proxied = (path) => patterns.some((pattern) => pattern.test(path));

test('proxies organization API routes but not the Angular creation page', () => {
  for (const path of [
    '/organizations',
    '/organizations?limit=1',
    '/organizations/invalid-id/members',
    '/organizations/invalid-id/tasks',
    '/organizations/invalid-id/tasks?page=1',
    '/organizations/invalid-id/tasks/summary',
    '/organizations/invalid-id/tasks/task-id?version=1',
    '/organizations/11111111-1111-4111-8111-111111111111',
    '/organizations/invalid-id/activity?limit=10',
    '/organizations/invalid-id/tasks/task-id/comments',
    '/organizations/invalid-id/tasks/task-id/activity',
    '/organizations/invalid-id/projects',
    '/organizations/invalid-id/projects/project-id',
    '/notifications',
    '/notifications?limit=20',
    '/notifications/id/read',
    '/notifications/read-all',
  ]) assert.equal(proxied(path), true, path);

  for (const path of [
    '/organizations/new', '/organizations/new?source=home', '/organizations/new/',
    '/organizations/11111111-1111-4111-8111-111111111111/other',
    '/projects', '/projects/11111111-1111-4111-8111-111111111111', '/notificationsx',
  ]) {
    assert.equal(proxied(path), false, path);
  }
});
