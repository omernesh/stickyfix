import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveConfig } from '../src/config.js';

// ---------------------------------------------------------------------------
// resolveConfig -- WR-05: --port validation
// ---------------------------------------------------------------------------

describe('resolveConfig — port validation (WR-05)', () => {
  let tmpRoot: string;

  test.before(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'sfx-config-test-'));
  });

  test.after(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('valid integer port is accepted', () => {
    const cfg = resolveConfig({ root: tmpRoot, port: '39240' });
    assert.strictEqual(cfg.port, 39240);
  });

  test('undefined port results in undefined cfg.port', () => {
    const cfg = resolveConfig({ root: tmpRoot });
    assert.strictEqual(cfg.port, undefined);
  });

  test('WR-05: non-numeric port string throws', () => {
    assert.throws(
      () => resolveConfig({ root: tmpRoot, port: 'garbage' }),
      (err: any) => {
        assert.ok(err.message.includes('--port'), `expected --port in message, got: ${err.message}`);
        return true;
      }
    );
  });

  test('WR-05: port 0 (out of range) throws', () => {
    assert.throws(
      () => resolveConfig({ root: tmpRoot, port: '0' }),
      (err: any) => {
        assert.ok(err.message.includes('--port'));
        return true;
      }
    );
  });

  test('WR-05: port 99999 (above 65535) throws', () => {
    assert.throws(
      () => resolveConfig({ root: tmpRoot, port: '99999' }),
      (err: any) => {
        assert.ok(err.message.includes('--port'));
        return true;
      }
    );
  });

  test('WR-05: negative port throws', () => {
    assert.throws(
      () => resolveConfig({ root: tmpRoot, port: '-1' }),
      (err: any) => {
        assert.ok(err.message.includes('--port'));
        return true;
      }
    );
  });

  test('WR-05: non-integer float port throws', () => {
    assert.throws(
      () => resolveConfig({ root: tmpRoot, port: '3.14' }),
      (err: any) => {
        assert.ok(err.message.includes('--port'));
        return true;
      }
    );
  });
});
