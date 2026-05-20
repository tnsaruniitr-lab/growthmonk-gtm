import { fetchFile, currentWeekId } from './repo.js';

// Task line format:
//   - [ ] SAL-21-01 — description | owner:arun | due:2026-05-21 | status:doing
const TASK_RE = /^- \[( |x|X)\]\s*(.+)$/;

function parseTaskLine(line) {
  const m = line.match(TASK_RE);
  if (!m) return null;
  const done = m[1].toLowerCase() === 'x';
  const body = m[2];
  const parts = body.split('|');
  const fields = {};
  for (const part of parts.slice(1)) {
    const idx = part.indexOf(':');
    if (idx > -1) {
      fields[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    }
  }
  return {
    done,
    title: parts[0].trim(),
    owner: fields.owner || null,
    due: fields.due || null,
    status: fields.status || (done ? 'done' : 'todo'),
  };
}

// Parse a function's task file for the current week.
export async function weekTasks(fn) {
  const week = currentWeekId();
  const text = await fetchFile(`tasks/${week}/${fn}.md`);
  if (!text) return { week, function: fn, found: false, tasks: [] };
  const tasks = text.split('\n').map(parseTaskLine).filter(Boolean);
  return { week, function: fn, found: true, tasks };
}

export function summarize(tasks) {
  const today = new Date().toISOString().slice(0, 10);
  const done = tasks.filter((t) => t.done).length;
  const overdue = tasks.filter((t) => !t.done && t.due && t.due < today);
  return {
    total: tasks.length,
    done,
    open: tasks.length - done,
    overdue,
    completion: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}
