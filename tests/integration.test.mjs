import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const execFileAsync = promisify(execFile);

async function withClient(cwd, fn) {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.resolve('dist/index.js')],
    cwd,
    stderr: 'pipe'
  });

  let stderr = '';
  transport.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  const client = new Client({ name: 'integration-test-client', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  try {
    return await fn(client);
  } catch (error) {
    if (stderr.trim()) {
      error.message += `\nServer stderr:\n${stderr}`;
    }
    throw error;
  } finally {
    await transport.close();
  }
}

async function makeTempProject() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'smart-find-replace-'));
  return {
    dir,
    cleanup: () => rm(dir, { recursive: true, force: true })
  };
}

test('tool surface is minimal and find output is agent-native', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(project.dir, 'src', 'a.txt'), 'foo foo1 FoO\n');
    await writeFile(path.join(project.dir, 'ignored.txt'), 'foo\n');

    await withClient(project.dir, async (client) => {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      assert.deepEqual(names, [
        'apply_replace_in_files',
        'find_in_files',
        'inspect_replace_session',
        'prepare_replace_in_files'
      ]);

      const result = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'foo',
          include: ['src/*.txt'],
          wholeWord: true,
          caseSensitive: true
        }
      });

      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.kind, 'find_result');
      assert.equal(result.structuredContent.status, 'matches_found');
      assert.equal(result.structuredContent.summary.counts.totalMatches, 1);
      assert.equal(result.structuredContent.summary.scope.filePath, null);
      assert.equal(result.structuredContent.files.length, 1);
      assert.equal(result.structuredContent.matches[0].filePath, 'src/a.txt');
      assert.equal(result.structuredContent.matches[0].matchText, 'foo');
      assert.equal(result.structuredContent.nextStep.action, 'prepare_replace_in_files');
      assert.match(result.content[0].text, /status=matches_found/);
      assert.match(result.content[0].text, /next: prepare_replace_in_files/);
    });
  } finally {
    await project.cleanup();
  }
});

test('prepare_replace_in_files uses one JS regex dialect end-to-end, then supports selective replacement', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'a.txt'), 'foo1 foo2\n');
    await writeFile(path.join(project.dir, 'src', 'b.txt'), 'foo3 foo4\n');

    await withClient(project.dir, async (client) => {
      const blocked = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: '(?<=foo)(\\d+)',
          replacement: 'bar$1',
          regex: true,
          include: ['src/*.txt'],
          maxPreviewMatches: 2
        }
      });

      assert.equal(blocked.isError, undefined);
      assert.equal(blocked.structuredContent.kind, 'replace_preview');
      assert.equal(blocked.structuredContent.status, 'requires_refinement');
      assert.equal(blocked.structuredContent.session, null);
      assert.equal(blocked.structuredContent.nextStep.action, 'prepare_replace_in_files');

      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: '(?<=foo)(\\d+)',
          replacement: 'bar$1',
          regex: true,
          filePath: 'src/a.txt'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');
      assert.equal(prepared.structuredContent.summary.mode, 'js-regex');
      assert.equal(prepared.structuredContent.summary.applyAllowed, true);
      assert.equal(prepared.structuredContent.summary.counts.totalMatches, 2);
      assert.equal(prepared.structuredContent.matches[0].matchText, '1');
      assert.equal(prepared.structuredContent.matches[1].matchText, '2');
      assert.equal(prepared.structuredContent.matches[0].replacementPreview, 'bar1');
      assert.equal(prepared.structuredContent.matches[1].replacementPreview, 'bar2');
      assert.equal(prepared.structuredContent.nextStep.action, 'apply_replace_in_files');
      assert.deepEqual(prepared.structuredContent.nextStep.selectionModes, ['all', 'include_ids', 'exclude_ids']);

      const sessionId = prepared.structuredContent.session.sessionId;
      const firstMatchId = prepared.structuredContent.matches[0].id;
      assert.ok(sessionId);
      assert.ok(firstMatchId);

      const inspected = await client.callTool({
        name: 'inspect_replace_session',
        arguments: { sessionId }
      });

      assert.equal(inspected.isError, undefined);
      assert.equal(inspected.structuredContent.kind, 'replace_session');
      assert.equal(inspected.structuredContent.status, 'ready');
      assert.equal(inspected.structuredContent.nextStep.action, 'apply_replace_in_files');
      assert.equal(inspected.structuredContent.matches.length, 2);

      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId,
          selectionMode: 'include_ids',
          matchIds: [firstMatchId]
        }
      });

      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.kind, 'replace_apply_result');
      assert.equal(applied.structuredContent.status, 'applied');
      assert.equal(applied.structuredContent.summary.filesChanged, 1);
      assert.equal(applied.structuredContent.summary.replacementsApplied, 1);
      assert.equal(applied.structuredContent.nextStep.action, 'done');
    });

    assert.equal(await readFile(path.join(project.dir, 'src', 'a.txt'), 'utf8'), 'foobar1 foo2\n');
    assert.equal(await readFile(path.join(project.dir, 'src', 'b.txt'), 'utf8'), 'foo3 foo4\n');
  } finally {
    await project.cleanup();
  }
});

test('apply_replace_in_files refuses stale previews after file changes', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'a.txt'), 'hello foo\n');

    await withClient(project.dir, async (client) => {
      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'foo',
          replacement: 'bar',
          filePath: 'src/a.txt'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');

      await writeFile(path.join(project.dir, 'src', 'a.txt'), 'hello foo changed\n');

      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId: prepared.structuredContent.session.sessionId,
          selectionMode: 'all'
        }
      });

      assert.equal(applied.isError, true);
      assert.match(applied.content[0].text, /File changed since preview/);
    });
  } finally {
    await project.cleanup();
  }
});

test('text output is concise and structured content stays decision-ready', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'a.txt'), 'alpha foo omega\n');

    await withClient(project.dir, async (client) => {
      const found = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'foo',
          filePath: 'src/a.txt'
        }
      });

      assert.equal(found.isError, undefined);
      assert.equal(found.structuredContent.summary.counts.totalMatches, 1);
      assert.equal(found.structuredContent.files.length, 1);
      assert.equal(found.structuredContent.matches[0].context, 'alpha [foo] omega⏎');
      assert.equal('absolutePath' in found.structuredContent.matches[0], false);
      assert.equal(Object.keys(found.structuredContent).sort().join(','), 'files,kind,matches,nextStep,status,summary');

      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'foo',
          replacement: 'bar',
          filePath: 'src/a.txt'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(Object.keys(prepared.structuredContent).sort().join(','), 'files,kind,matches,nextStep,session,status,summary');
      assert.match(prepared.content[0].text, /status=ready/);
      assert.match(prepared.content[0].text, /next: apply_replace_in_files/);
      assert.equal(prepared.structuredContent.nextStep.selectionModes.includes('include_ids'), true);
    });
  } finally {
    await project.cleanup();
  }
});


test('regex mode rejects non-UTF-8 filePath with a clear error', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'bad.txt'), Buffer.from([0x81, 0x82, 0x83]));

    await withClient(project.dir, async (client) => {
      const result = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'a',
          regex: true,
          filePath: 'src/bad.txt'
        }
      });

      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /Could not auto-detect a supported text encoding/);
    });
  } finally {
    await project.cleanup();
  }
});

test('prepare_replace_in_files caps active sessions at 10 and evicts the oldest session', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'a.txt'), 'foo\n');

    await withClient(project.dir, async (client) => {
      let firstSessionId = null;
      let latestSessionId = null;

      for (let i = 0; i < 11; i += 1) {
        const prepared = await client.callTool({
          name: 'prepare_replace_in_files',
          arguments: {
            query: 'foo',
            replacement: `bar${i}`,
            filePath: 'src/a.txt'
          }
        });
        assert.equal(prepared.isError, undefined);
        assert.equal(prepared.structuredContent.status, 'ready');
        latestSessionId = prepared.structuredContent.session.sessionId;
        if (i === 0) {
          firstSessionId = latestSessionId;
        }
      }

      const oldest = await client.callTool({
        name: 'inspect_replace_session',
        arguments: { sessionId: firstSessionId }
      });
      assert.equal(oldest.isError, true);
      assert.match(oldest.content[0].text, /Unknown or expired replace session/);

      const newest = await client.callTool({
        name: 'inspect_replace_session',
        arguments: { sessionId: latestSessionId }
      });
      assert.equal(newest.isError, undefined);
      assert.equal(newest.structuredContent.status, 'ready');
    });
  } finally {
    await project.cleanup();
  }
});


test('literal mode supports explicit windows-1252 and writes back in the same encoding', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'latin.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));

    await withClient(project.dir, async (client) => {
      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'café',
          replacement: 'bistro',
          filePath: 'src/latin.txt',
          encoding: 'windows-1252'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');
      assert.equal(prepared.structuredContent.summary.encoding, 'windows-1252');

      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId: prepared.structuredContent.session.sessionId,
          selectionMode: 'all'
        }
      });

      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.status, 'applied');
    });

    const raw = await readFile(path.join(project.dir, 'src', 'latin.txt'));
    assert.deepEqual([...raw], [0x62, 0x69, 0x73, 0x74, 0x72, 0x6f, 0x0a]);
  } finally {
    await project.cleanup();
  }
});

test('literal filePath auto-detects utf-16le bom and preserves it on write', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    const raw = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('foo\n', 'utf16le')]);
    await writeFile(path.join(project.dir, 'src', 'utf16.txt'), raw);

    await withClient(project.dir, async (client) => {
      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'foo',
          replacement: 'bar',
          filePath: 'src/utf16.txt'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');
      assert.equal(prepared.structuredContent.summary.encoding, 'utf-16le');

      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId: prepared.structuredContent.session.sessionId,
          selectionMode: 'all'
        }
      });

      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.status, 'applied');
    });

    const rewritten = await readFile(path.join(project.dir, 'src', 'utf16.txt'));
    assert.equal(rewritten[0], 0xff);
    assert.equal(rewritten[1], 0xfe);
    assert.equal(rewritten.subarray(2).toString('utf16le'), 'bar\n');
  } finally {
    await project.cleanup();
  }
});


test('literal mode treats regex metacharacters as plain text', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'meta.txt'), 'a+b aab\n');

    await withClient(project.dir, async (client) => {
      const literal = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'a+b',
          filePath: 'src/meta.txt'
        }
      });

      assert.equal(literal.isError, undefined);
      assert.equal(literal.structuredContent.summary.mode, 'literal');
      assert.equal(literal.structuredContent.summary.counts.totalMatches, 1);
      assert.equal(literal.structuredContent.matches[0].matchText, 'a+b');

      const regex = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'a+b',
          regex: true,
          filePath: 'src/meta.txt'
        }
      });

      assert.equal(regex.isError, undefined);
      assert.equal(regex.structuredContent.summary.mode, 'js-regex');
      assert.equal(regex.structuredContent.summary.counts.totalMatches, 1);
      assert.equal(regex.structuredContent.matches[0].matchText, 'aab');
    });
  } finally {
    await project.cleanup();
  }
});

test('regex workspace search respects ignore rules and skips unsupported files without failing', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: project.dir });
    await writeFile(path.join(project.dir, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(project.dir, 'src', 'good.txt'), 'foo1\nfoo2\n');
    await writeFile(path.join(project.dir, 'ignored.txt'), 'foo3\n');
    await writeFile(path.join(project.dir, 'src', 'bad.bin'), Buffer.from([0x81, 0x82, 0x83]));

    await withClient(project.dir, async (client) => {
      const result = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'foo\\d',
          regex: true,
        }
      });

      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.summary.mode, 'js-regex');
      assert.equal(result.structuredContent.summary.counts.totalMatches, 2);
      assert.equal(result.structuredContent.summary.counts.filesWithMatches, 1);
      assert.equal(result.structuredContent.summary.counts.skippedFiles >= 1, true);
      assert.deepEqual(result.structuredContent.files.map((item) => item.filePath), ['src/good.txt']);
    });
  } finally {
    await project.cleanup();
  }
});

test('regex mode supports explicit windows-1252 encoding and writes back in that same encoding', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'latin-regex.txt'), Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x63, 0x61, 0x66, 0xe9, 0x0a]));

    await withClient(project.dir, async (client) => {
      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'caf(.)',
          replacement: 'tea$1',
          regex: true,
          filePath: 'src/latin-regex.txt',
          encoding: 'windows-1252'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');
      assert.equal(prepared.structuredContent.summary.mode, 'js-regex');
      assert.equal(prepared.structuredContent.summary.encoding, 'windows-1252');
      assert.equal(prepared.structuredContent.summary.counts.totalMatches, 2);
      assert.equal(prepared.structuredContent.matches[0].matchText, 'café');
      assert.equal(prepared.structuredContent.matches[0].replacementPreview, 'teaé');

      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId: prepared.structuredContent.session.sessionId,
          selectionMode: 'all'
        }
      });

      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.status, 'applied');
    });

    const raw = await readFile(path.join(project.dir, 'src', 'latin-regex.txt'));
    assert.deepEqual([...raw], [0x74, 0x65, 0x61, 0xe9, 0x20, 0x74, 0x65, 0x61, 0xe9, 0x0a]);
  } finally {
    await project.cleanup();
  }
});

test('apply_replace_in_files supports exclude_ids selection mode', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await writeFile(path.join(project.dir, 'src', 'exclude.txt'), 'foo foo foo\n');

    await withClient(project.dir, async (client) => {
      const prepared = await client.callTool({
        name: 'prepare_replace_in_files',
        arguments: {
          query: 'foo',
          replacement: 'bar',
          filePath: 'src/exclude.txt'
        }
      });

      assert.equal(prepared.isError, undefined);
      assert.equal(prepared.structuredContent.status, 'ready');
      assert.equal(prepared.structuredContent.matches.length, 3);

      const middleMatchId = prepared.structuredContent.matches[1].id;
      const applied = await client.callTool({
        name: 'apply_replace_in_files',
        arguments: {
          sessionId: prepared.structuredContent.session.sessionId,
          selectionMode: 'exclude_ids',
          matchIds: [middleMatchId]
        }
      });

      assert.equal(applied.isError, undefined);
      assert.equal(applied.structuredContent.status, 'applied');
      assert.equal(applied.structuredContent.summary.replacementsApplied, 2);
    });

    assert.equal(await readFile(path.join(project.dir, 'src', 'exclude.txt'), 'utf8'), 'bar foo bar\n');
  } finally {
    await project.cleanup();
  }
});

test('literal workspace search now uses the unified text pipeline and still respects ignore rules', async () => {
  const project = await makeTempProject();
  try {
    await mkdir(path.join(project.dir, 'src'), { recursive: true });
    await execFileAsync('git', ['init', '-q'], { cwd: project.dir });
    await writeFile(path.join(project.dir, '.gitignore'), 'ignored.txt\n');
    await writeFile(path.join(project.dir, 'src', 'good.txt'), 'a+b\naab\n');
    await writeFile(path.join(project.dir, 'ignored.txt'), 'a+b\n');
    await writeFile(path.join(project.dir, 'src', 'bad.bin'), Buffer.from([0x81, 0x82, 0x83]));

    await withClient(project.dir, async (client) => {
      const result = await client.callTool({
        name: 'find_in_files',
        arguments: {
          query: 'a+b'
        }
      });

      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent.summary.mode, 'literal');
      assert.equal(result.structuredContent.summary.counts.totalMatches, 1);
      assert.equal(result.structuredContent.summary.counts.filesWithMatches, 1);
      assert.equal(result.structuredContent.summary.counts.skippedFiles >= 1, true);
      assert.deepEqual(result.structuredContent.files.map((item) => item.filePath), ['src/good.txt']);
      assert.equal(result.structuredContent.matches[0].matchText, 'a+b');
    });
  } finally {
    await project.cleanup();
  }
});


test('atomic write cleans up temp file if rename fails', async (t) => {
  const project = await makeTempProject();
  try {
    const fileIo = await import(pathToFileURL(path.resolve('dist/file-io.js')).href);
    const fsModule = await import('node:fs');
    const originalRename = fsModule.promises.rename;
    t.mock.method(fsModule.promises, 'rename', async (...args) => {
      throw new Error('forced rename failure');
    });

    const targetPath = path.join(project.dir, 'target.txt');
    await assert.rejects(
      fileIo.writeFileAtomically(targetPath, Buffer.from('hello')),
      /forced rename failure/
    );

    const leftovers = (await fsModule.promises.readdir(project.dir))
      .filter((name) => /^\.target\.txt\.\d+\.\d+\.tmp$/.test(name));
    assert.deepEqual(leftovers, []);
    fsModule.promises.rename = originalRename;
  } finally {
    await project.cleanup();
  }
});
