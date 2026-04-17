import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, MonitorSmartphone, Play, TerminalSquare } from 'lucide-react';
import { apiRequest } from '../lib/api';

const TERMINAL_HISTORY_LIMIT = 12;

interface TerminalPresetGroup {
  label: string;
  commands: string[];
}

interface TerminalPolicy {
  allowedCommands: string[];
  presetCommands: string[];
  presetGroups?: TerminalPresetGroup[];
  blockedExamples?: string[];
  restrictions: string[];
}

interface TerminalTargetResponse {
  assetId: string;
  hostname: string;
  assetTag: string;
  minionId: string;
  connected: boolean;
  policy?: TerminalPolicy;
}

interface TerminalCommandResponse {
  command: string;
  stdout: string;
  stderr: string;
  retcode: number | string;
}

interface TerminalEntry extends TerminalCommandResponse {
  id: string;
  createdAt: string;
}

function historyStorageKey(minionId: string) {
  return `itms_terminal_history_${minionId}`;
}

function terminalErrorHint(message: string) {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return '';
  }
  if (normalized.includes('blocked shell pattern')) {
    return 'Run one approved command at a time. Remove pipes, redirects, chaining operators, sudo, downloads, and interactive utilities.';
  }
  if (normalized.includes('command is not allowed in the terminal console')) {
    return 'Start with one of the allowed tools shown in the sidebar, then add only read-only flags and arguments.';
  }
  if (normalized.includes('only read-only systemctl commands are allowed')) {
    return 'Use systemctl status, show, list-units, or list-unit-files. Restart, stop, enable, and other mutating actions are blocked.';
  }
  if (normalized.includes('only read-only journalctl commands are allowed')) {
    return 'Use read-only journalctl forms such as -n, -u, or --since. Rotation and vacuum operations are blocked.';
  }
  return '';
}

export default function TerminalConsole() {
  const navigate = useNavigate();
  const { minionId = '' } = useParams();
  const [target, setTarget] = useState<TerminalTargetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [command, setCommand] = useState('');
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [error, setError] = useState('');
  const outputRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTarget = async () => {
      try {
        setLoading(true);
        setError('');
        const data = await apiRequest<TerminalTargetResponse>(`/api/terminal/targets/${encodeURIComponent(minionId)}`);
        if (!cancelled) {
          setTarget(data);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Failed to load terminal target');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    if (minionId) {
      void loadTarget();
    } else {
      setLoading(false);
      setError('Terminal target is missing.');
    }

    return () => {
      cancelled = true;
    };
  }, [minionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !minionId) {
      return;
    }
    try {
      const storedHistory = window.localStorage.getItem(historyStorageKey(minionId));
      const parsedHistory = storedHistory ? JSON.parse(storedHistory) : [];
      setHistory(Array.isArray(parsedHistory) ? parsedHistory.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : []);
    } catch {
      setHistory([]);
    }
    setHistoryIndex(-1);
  }, [minionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !minionId) {
      return;
    }
    window.localStorage.setItem(historyStorageKey(minionId), JSON.stringify(history.slice(0, TERMINAL_HISTORY_LIMIT)));
  }, [history, minionId]);

  useEffect(() => {
    if (!outputRef.current) {
      return;
    }
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [entries]);

  const shellPrompt = useMemo(() => `${target?.hostname || minionId}$`, [minionId, target?.hostname]);
  const presetCommands = useMemo(() => target?.policy?.presetCommands ?? [], [target?.policy?.presetCommands]);
  const presetGroups = useMemo(() => target?.policy?.presetGroups ?? [], [target?.policy?.presetGroups]);
  const blockedExamples = useMemo(() => target?.policy?.blockedExamples ?? [], [target?.policy?.blockedExamples]);
  const allowedCommands = useMemo(() => target?.policy?.allowedCommands ?? [], [target?.policy?.allowedCommands]);
  const restrictions = useMemo(() => target?.policy?.restrictions ?? [], [target?.policy?.restrictions]);
  const errorHint = useMemo(() => terminalErrorHint(error), [error]);

  const applyHistoryEntry = (nextIndex: number) => {
    if (history.length === 0) {
      return;
    }
    if (nextIndex < 0) {
      setHistoryIndex(-1);
      setCommand('');
      return;
    }
    const boundedIndex = Math.min(nextIndex, history.length - 1);
    setHistoryIndex(boundedIndex);
    setCommand(history[boundedIndex] || '');
  };

  const clearHistory = () => {
    setHistory([]);
    setHistoryIndex(-1);
    if (typeof window !== 'undefined' && minionId) {
      window.localStorage.removeItem(historyStorageKey(minionId));
    }
  };

  const runCommand = async () => {
    const trimmedCommand = command.trim();
    if (!trimmedCommand || !target?.connected || running) {
      return;
    }

    try {
      setRunning(true);
      setError('');
      const result = await apiRequest<TerminalCommandResponse>(`/api/terminal/targets/${encodeURIComponent(target.minionId)}/execute`, {
        method: 'POST',
        body: JSON.stringify({ command: trimmedCommand }),
      });
      setEntries((current) => [...current, { ...result, id: `${Date.now()}-${current.length}`, createdAt: new Date().toISOString() }]);
      setHistory((current) => [trimmedCommand, ...current.filter((entry) => entry !== trimmedCommand)].slice(0, TERMINAL_HISTORY_LIMIT));
      setHistoryIndex(-1);
      setCommand('');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to execute command');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/80 px-5 py-4 shadow-sm backdrop-blur">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.24em] text-emerald-400">
              <TerminalSquare className="h-4 w-4" /> Terminal Console
            </div>
            <h1 className="mt-2 truncate text-2xl font-black text-white">{target?.hostname || minionId}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-zinc-400">
              <span>{target?.assetTag || 'Asset pending'}</span>
              <span>{target?.minionId || minionId}</span>
              <span className={target?.connected ? 'text-emerald-400' : 'text-amber-400'}>{target?.connected ? 'Connected' : 'Disconnected'}</span>
            </div>
          </div>
          <button type="button" onClick={() => navigate(-1)} className="inline-flex items-center rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-bold text-zinc-200 hover:bg-zinc-800">
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </button>
        </div>

        <div className="mt-5 grid flex-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-zinc-800 bg-zinc-900 p-5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-bold text-white">
              <MonitorSmartphone className="h-4 w-4 text-emerald-400" /> Session
            </div>
            <div className="mt-4 space-y-3 text-sm text-zinc-300">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Mode</div>
                <div className="mt-1">Salt-backed command console</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Access</div>
                <div className="mt-1">IT Team and Super Admin</div>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Execution</div>
                <div className="mt-1">Each command runs independently through Salt and returns stdout, stderr, and exit code.</div>
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
              This is not a PTY shell. Interactive programs like top, vim, sudo password prompts, or SSH sessions will not behave like a local terminal.
            </div>
            {allowedCommands.length > 0 ? (
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
                <div className="font-bold uppercase tracking-wider text-zinc-500">Allowed Tools</div>
                <div className="mt-2 text-zinc-300">{allowedCommands.join(', ')}</div>
              </div>
            ) : null}
            {restrictions.length > 0 ? (
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
                <div className="font-bold uppercase tracking-wider text-zinc-500">Policy</div>
                <div className="mt-2 space-y-2">
                  {restrictions.map((restriction) => (
                    <div key={restriction}>{restriction}</div>
                  ))}
                </div>
              </div>
            ) : null}
            {blockedExamples.length > 0 ? (
              <div className="mt-5 rounded-xl border border-zinc-800 bg-zinc-950/70 px-4 py-3 text-xs text-zinc-400">
                <div className="font-bold uppercase tracking-wider text-zinc-500">Blocked Examples</div>
                <div className="mt-2 space-y-2 text-zinc-300">
                  {blockedExamples.map((example) => (
                    <div key={example}>{example}</div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Recent Commands</div>
                {history.length > 0 ? <button type="button" onClick={clearHistory} className="text-xs font-semibold text-zinc-400 hover:text-zinc-200">Clear</button> : null}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {history.length === 0 ? <div className="text-xs text-zinc-500">No command history for this device yet.</div> : null}
                {history.map((entry) => (
                  <button key={entry} type="button" onClick={() => { setCommand(entry); setHistoryIndex(-1); }} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-800">
                    {entry}
                  </button>
                ))}
              </div>
            </div>
          </aside>

          <section className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 shadow-sm">
            {presetGroups.length > 0 || presetCommands.length > 0 ? (
              <div className="border-b border-zinc-800 bg-zinc-900 px-5 py-4">
                <div className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Quick Presets</div>
                {presetGroups.length > 0 ? (
                  <div className="mt-3 space-y-4">
                    {presetGroups.map((group) => (
                      <div key={group.label}>
                        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-zinc-500">{group.label}</div>
                        <div className="flex flex-wrap gap-2">
                          {group.commands.map((preset) => (
                            <button key={`${group.label}:${preset}`} type="button" onClick={() => { setCommand(preset); setHistoryIndex(-1); }} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">
                              {preset}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {presetCommands.map((preset) => (
                      <button key={preset} type="button" onClick={() => { setCommand(preset); setHistoryIndex(-1); }} className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800">
                        {preset}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
            <div ref={outputRef} className="flex-1 space-y-4 overflow-y-auto bg-[#09090b] px-5 py-5 font-mono text-sm">
              {loading ? <div className="text-zinc-400">Loading terminal target...</div> : null}
              {!loading && entries.length === 0 ? <div className="text-zinc-500">Run a command to start this terminal session.</div> : null}
              {entries.map((entry) => (
                <div key={entry.id} className="space-y-2 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
                  <div className="text-emerald-400">{shellPrompt} {entry.command}</div>
                  {entry.stdout ? <pre className="whitespace-pre-wrap text-zinc-100">{entry.stdout}</pre> : null}
                  {entry.stderr ? <pre className="whitespace-pre-wrap text-rose-300">{entry.stderr}</pre> : null}
                  <div className="text-xs text-zinc-500">exit code: {String(entry.retcode)} • {new Date(entry.createdAt).toLocaleString()}</div>
                </div>
              ))}
            </div>

            <div className="border-t border-zinc-800 bg-zinc-900 px-5 py-4">
              {error ? (
                <div className="mb-3 rounded-xl border border-rose-900 bg-rose-950/60 px-4 py-3 text-sm text-rose-200">
                  <div>{error}</div>
                  {errorHint ? <div className="mt-2 text-xs text-rose-100/90">{errorHint}</div> : null}
                </div>
              ) : null}
              <div className="flex items-center gap-3">
                <div className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-emerald-400">{shellPrompt}</div>
                <input
                  type="text"
                  value={command}
                  onChange={(event) => {
                    setCommand(event.target.value);
                    setHistoryIndex(-1);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      void runCommand();
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      applyHistoryEntry(historyIndex + 1);
                      return;
                    }
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      applyHistoryEntry(historyIndex - 1);
                    }
                  }}
                  disabled={loading || running || !target?.connected}
                  placeholder={target?.connected ? 'Enter a command' : 'Target is not connected'}
                  className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:opacity-60"
                />
                <button type="button" onClick={() => void runCommand()} disabled={loading || running || !command.trim() || !target?.connected} className="inline-flex items-center rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-zinc-950 hover:bg-emerald-400 disabled:opacity-60">
                  <Play className="mr-2 h-4 w-4" /> {running ? 'Running...' : 'Run'}
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}