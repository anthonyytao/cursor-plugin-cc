import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { main as delegateMain } from '../scripts/delegate.mjs';
import { listJobs } from '../scripts/lib/jobs.mjs';
import { main as resumeMain } from '../scripts/resume.mjs';
import { HAPPY_FIXTURE, STUB_BIN, makeTempHome } from './helpers.mjs';

describe('delegate foreground', () => {
  let tmp;
  const prevHome = process.env.CURSOR_PLUGIN_CC_HOME;
  const prevBin = process.env.CURSOR_AGENT_BIN;
  const prevFix = process.env.CURSOR_AGENT_STUB_FIXTURE;
  const prevArgsOut = process.env.CURSOR_AGENT_STUB_ARGS_OUT;
  const prevCwd = process.cwd();

  beforeEach(() => {
    tmp = makeTempHome();
    process.env.CURSOR_PLUGIN_CC_HOME = tmp.dir;
    process.env.CURSOR_AGENT_BIN = STUB_BIN;
    process.env.CURSOR_AGENT_STUB_FIXTURE = HAPPY_FIXTURE;
    process.chdir(tmp.dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    if (prevHome === undefined) delete process.env.CURSOR_PLUGIN_CC_HOME;
    else process.env.CURSOR_PLUGIN_CC_HOME = prevHome;
    if (prevBin === undefined) delete process.env.CURSOR_AGENT_BIN;
    else process.env.CURSOR_AGENT_BIN = prevBin;
    if (prevFix === undefined) delete process.env.CURSOR_AGENT_STUB_FIXTURE;
    else process.env.CURSOR_AGENT_STUB_FIXTURE = prevFix;
    if (prevArgsOut === undefined) delete process.env.CURSOR_AGENT_STUB_ARGS_OUT;
    else process.env.CURSOR_AGENT_STUB_ARGS_OUT = prevArgsOut;
    tmp.cleanup();
  });

  it('runs to completion and records a finished job', async () => {
    const argsPath = join(tmp.dir, 'delegate-args.json');
    process.env.CURSOR_AGENT_STUB_ARGS_OUT = argsPath;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain([
        '--no-git-check',
        '--model',
        'composer',
        '--',
        'hello world task',
      ]);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    const job = jobs[0];
    const args = JSON.parse(readFileSync(argsPath, 'utf8'));
    expect(args).toContain('--sandbox');
    expect(args).toContain('enabled');
    expect(args).not.toContain('--mode');
    expect(job.status).toBe('done');
    expect(job.model).toBe('composer-2.5-fast');
    expect(job.cursorChatId).toBe('chat_abc123');
    expect(job.filesTouched?.length ?? 0).toBeGreaterThan(0);
  });

  it('does not sandbox cloud delegates', async () => {
    const argsPath = join(tmp.dir, 'cloud-delegate-args.json');
    process.env.CURSOR_AGENT_STUB_ARGS_OUT = argsPath;
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check', '--cloud', '--', 'hello world task']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const args = JSON.parse(readFileSync(argsPath, 'utf8'));
    expect(args).toContain('--cloud');
    expect(args).not.toContain('--sandbox');
    expect(args).not.toContain('--mode');
  });

  it('refuses outside a git repo without --no-git-check', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--', 'nope']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  it('errors with exit 2 when no prompt is given', async () => {
    const errSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check']);
      expect(code).toBe(2);
    } finally {
      errSpy.mockRestore();
    }
  });

  // Regression: a numeric `--resume=<id>` used to crash with
  // `resume.trim is not a function` because the parser auto-cast it to a number.
  it('does not crash on a numeric --resume id', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await delegateMain(['--no-git-check', '--resume=12345', '--', 'follow up']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    expect(listJobs(tmp.dir).length).toBe(1);
  });

  // Regression: `/cursor:resume <multi-word prompt>` used to send the first
  // prompt word as the chat-id because `--resume` greedily consumed it.
  it('resume.mjs preserves a multi-word non-ASCII prompt', async () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const code = await resumeMain(['--no-git-check', '--', 'řekni mi něco o teto službě']);
      expect(code).toBe(0);
    } finally {
      writeSpy.mockRestore();
    }
    const jobs = listJobs(tmp.dir);
    expect(jobs.length).toBe(1);
    expect(jobs[0].prompt).toBe('řekni mi něco o teto službě');
  });
});
