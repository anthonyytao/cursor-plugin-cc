import { readFileSync, writeFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildArgs, resolveModel, runHeadless } from '../scripts/lib/cursor.mjs';
import { extractChatId, summariseEvents } from '../scripts/lib/parse.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

describe('buildArgs', () => {
  it('includes the expected flags by default', () => {
    const args = buildArgs({ prompt: 'hi', model: 'composer-2.5' });
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');
    expect(args).toContain('stream-json');
    expect(args).toContain('--trust');
    expect(args).toContain('--model');
    expect(args).toContain('composer-2.5');
    expect(args).toContain('--sandbox');
    expect(args).toContain('enabled');
    expect(args).not.toContain('--mode');
  });

  it('never puts the prompt on the command line (Windows 32k argv limit, #26)', () => {
    const args = buildArgs({ prompt: 'hi', model: 'composer-2.5' });
    expect(args).not.toContain('hi');
  });

  it('omits --force when force=false', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto', force: false });
    expect(args).not.toContain('--force');
  });

  it('adds --cloud and --resume when requested', () => {
    const args = buildArgs({
      prompt: 'hi',
      model: 'auto',
      cloud: true,
      resumeChatId: 'chat_xyz',
    });
    expect(args).toContain('--cloud');
    expect(args).toContain('--resume=chat_xyz');
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('--mode');
  });

  it('uses ask mode for read-only runs without sandboxing', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto', readOnly: true, force: false });
    expect(args).toContain('--mode');
    expect(args).toContain('ask');
    expect(args).toContain('--disable-project-configs');
    expect(args).toContain('--force');
    expect(args).not.toContain('--sandbox');
  });

  it('adds --approve-mcps when requested', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto', approveMcps: true });
    expect(args).toContain('--approve-mcps');
  });

  it('omits --approve-mcps by default', () => {
    const args = buildArgs({ prompt: 'hi', model: 'auto' });
    expect(args).not.toContain('--approve-mcps');
  });
});

describe('resolveModel', () => {
  const prevDefault = process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL;
  afterEach(() => {
    if (prevDefault === undefined) delete process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL;
    else process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL = prevDefault;
  });

  it('maps aliases to real Cursor ids', () => {
    expect(resolveModel('composer')).toBe('composer-2.5-fast');
    expect(resolveModel('composer-fast')).toBe('composer-2.5-fast');
    expect(resolveModel('fast')).toBe('composer-2.5-fast');
    expect(resolveModel('composer-full')).toBe('composer-2.5');
    expect(resolveModel('composer-2.5')).toBe('composer-2.5');
    expect(resolveModel('composer-2.5-fast')).toBe('composer-2.5-fast');
    expect(resolveModel('sonnet')).toBe('claude-4.6-sonnet-medium');
    expect(resolveModel('opus')).toBe('claude-opus-4-7-high');
    expect(resolveModel('gpt')).toBe('gpt-5.3-codex');
    expect(resolveModel('grok')).toBe('grok-4.3');
    expect(resolveModel('grok-build')).toBe('grok-build-0.1');
    expect(resolveModel('gemini')).toBe('gemini-3.1-pro');
  });

  it('keeps retired Composer ids as passthrough for older cursor-agent builds', () => {
    expect(resolveModel('composer-2')).toBe('composer-2');
    expect(resolveModel('composer-2-fast')).toBe('composer-2-fast');
    expect(resolveModel('grok-4-20')).toBe('grok-4-20');
  });

  it('defaults to auto when empty (no env override)', () => {
    delete process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL;
    expect(resolveModel(undefined)).toBe('auto');
    expect(resolveModel('')).toBe('auto');
  });

  it('honours CURSOR_PLUGIN_CC_DEFAULT_MODEL when no input is given', () => {
    process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL = 'composer';
    expect(resolveModel(undefined)).toBe('composer-2.5-fast');
    process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL = 'some-custom-id';
    expect(resolveModel('')).toBe('some-custom-id');
  });

  it('explicit input wins over the env default', () => {
    process.env.CURSOR_PLUGIN_CC_DEFAULT_MODEL = 'composer';
    expect(resolveModel('opus')).toBe('claude-opus-4-7-high');
  });

  it('passes unknown ids through unchanged', () => {
    expect(resolveModel('some-new-model')).toBe('some-new-model');
  });
});

describe('runHeadless against stub binary', () => {
  let tmp;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFixture = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevReadOnlyConfigDir = process.env.CURSOR_PLUGIN_CC_READONLY_CONFIG_DIR;
  const prevArgsOut = process.env.CURSOR_AGENT_STUB_ARGS_OUT;
  const prevEnvOut = process.env.CURSOR_AGENT_STUB_ENV_OUT;

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.env.CURSOR_PLUGIN_CC_READONLY_CONFIG_DIR = `${tmp.dir}/readonly-config`;
    delete process.env.CURSOR_AGENT_STUB_ARGS_OUT;
    delete process.env.CURSOR_AGENT_STUB_ENV_OUT;
  });

  afterEach(() => {
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFixture === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFixture;
    if (prevReadOnlyConfigDir === undefined)
      delete process.env.CURSOR_PLUGIN_CC_READONLY_CONFIG_DIR;
    else process.env.CURSOR_PLUGIN_CC_READONLY_CONFIG_DIR = prevReadOnlyConfigDir;
    if (prevArgsOut === undefined) delete process.env.CURSOR_AGENT_STUB_ARGS_OUT;
    else process.env.CURSOR_AGENT_STUB_ARGS_OUT = prevArgsOut;
    if (prevEnvOut === undefined) delete process.env.CURSOR_AGENT_STUB_ENV_OUT;
    else process.env.CURSOR_AGENT_STUB_ENV_OUT = prevEnvOut;
    tmp.cleanup();
  });

  it('streams events and writes raw log', async () => {
    const logPath = `${tmp.dir}/run.ndjson`;
    const result = await runHeadless({
      prompt: 'hi',
      model: 'composer-2.5',
      force: false,
      logPath,
      timeoutSec: 10,
    });
    expect(result.exitCode).toBe(0);
    expect(result.events.length).toBeGreaterThan(0);
    const raw = readFileSync(logPath, 'utf8');
    expect(raw.split('\n').filter(Boolean).length).toBeGreaterThan(0);
    expect(extractChatId(result.events)).toBe('chat_abc123');
    const summary = summariseEvents(result.events);
    expect(summary.filesTouched.length).toBeGreaterThan(0);
  });

  it('spawns read-only runs with a deny-list config in an isolated config directory', async () => {
    const envPath = `${tmp.dir}/child-env.json`;
    const argsPath = `${tmp.dir}/child-args.json`;
    const configDir = `${tmp.dir}/readonly-config`;
    process.env.CURSOR_AGENT_STUB_ENV_OUT = envPath;
    process.env.CURSOR_AGENT_STUB_ARGS_OUT = argsPath;
    const result = await runHeadless({
      prompt: 'review this',
      model: 'auto',
      readOnly: true,
      logPath: `${tmp.dir}/readonly.ndjson`,
      timeoutSec: 10,
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(envPath, 'utf8'))).toBe(configDir);
    expect(JSON.parse(readFileSync(argsPath, 'utf8'))).toEqual(
      expect.arrayContaining(['--mode', 'ask', '--force', '--disable-project-configs']),
    );
    const configPath = `${configDir}/cli-config.json`;
    const denyList = {
      version: 1,
      permissions: { allow: [], deny: ['Write(**)', 'Shell(*)'] },
    };
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(denyList);

    writeFileSync(configPath, JSON.stringify({ version: 1, permissions: { allow: [], deny: [] } }));
    const secondResult = await runHeadless({
      prompt: 'review this again',
      model: 'auto',
      readOnly: true,
      logPath: `${tmp.dir}/readonly-second.ndjson`,
      timeoutSec: 10,
    });
    expect(secondResult.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(configPath, 'utf8'))).toEqual(denyList);
  });

  it('does not pass CURSOR_CONFIG_DIR to write runs', async () => {
    const envPath = `${tmp.dir}/child-env.json`;
    const previousConfigDir = process.env.CURSOR_CONFIG_DIR;
    process.env.CURSOR_AGENT_STUB_ENV_OUT = envPath;
    process.env.CURSOR_CONFIG_DIR = `${tmp.dir}/inherited-config`;
    try {
      const result = await runHeadless({
        prompt: 'make a change',
        model: 'auto',
        logPath: `${tmp.dir}/write.ndjson`,
        timeoutSec: 10,
      });
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(readFileSync(envPath, 'utf8'))).toBeNull();
    } finally {
      if (previousConfigDir === undefined) delete process.env.CURSOR_CONFIG_DIR;
      else process.env.CURSOR_CONFIG_DIR = previousConfigDir;
    }
  });

  it('delivers a prompt far beyond the Windows argv limit via stdin (#26)', async () => {
    const promptOut = `${tmp.dir}/prompt.txt`;
    process.env.CURSOR_AGENT_STUB_PROMPT_OUT = promptOut;
    try {
      // 8× the 32,767-char Windows command-line cap — matches MAX_DIFF_BYTES.
      const prompt = 'diff line with some content\n'.repeat(9_600);
      expect(prompt.length).toBeGreaterThan(8 * 32_767);
      const result = await runHeadless({
        prompt,
        model: 'composer-2.5',
        force: false,
        logPath: `${tmp.dir}/run.ndjson`,
        timeoutSec: 10,
      });
      expect(result.exitCode).toBe(0);
      expect(readFileSync(promptOut, 'utf8')).toBe(prompt);
    } finally {
      delete process.env.CURSOR_AGENT_STUB_PROMPT_OUT;
    }
  });
});
