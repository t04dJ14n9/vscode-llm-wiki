import initSqlJs, { Database as SqlJsDb, SqlJsStatic } from 'sql.js';
import { dirname, join } from 'path';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

// sql.js — pure WASM SQLite, zero native dependencies.
// Works in VS Code extension host (Electron) and CLI (system Node) alike.

let SQL: SqlJsStatic | null = null;
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_STALE_MS = 30_000;
const LOCK_RETRY_MS = 25;

interface DatabaseLock {
  fd: number;
  path: string;
}

async function getSql(): Promise<SqlJsStatic> {
  if (!SQL) {
    SQL = await initSqlJs({
      locateFile: (file: string) => locateSqlJsFile(file),
    });
  }
  return SQL;
}

function locateSqlJsFile(file: string): string {
  const bundled = join(dirname(__dirname), file);
  if (existsSync(bundled)) return bundled;

  const local = join(__dirname, file);
  if (existsSync(local)) return local;

  try {
    const nodeRequire = eval('require') as NodeRequire;
    return nodeRequire.resolve(`sql.js/dist/${file}`);
  } catch {
    return file;
  }
}

// Thin wrapper that makes sql.js look like better-sqlite3 for our usage patterns.
export class Database {
  private db: SqlJsDb;
  private dbPath: string;
  private lock: DatabaseLock | undefined;
  private _open: boolean = true;

  constructor(db: SqlJsDb, dbPath: string, lock?: DatabaseLock) {
    this.db = db;
    this.dbPath = dbPath;
    this.lock = lock;
  }

  prepare(sql: string): Statement {
    return new Statement(this.db, sql);
  }

  exec(sql: string): void {
    this.db.run(sql);
  }

  transaction<R>(fn: () => R): () => R {
    return () => {
      this.db.run('BEGIN');
      try {
        const result = fn();
        this.db.run('COMMIT');
        return result;
      } catch (e) {
        this.db.run('ROLLBACK');
        throw e;
      }
    };
  }

  pragma(key: string, _options?: { simple?: boolean }): string {
    const stmt = this.db.prepare(`PRAGMA ${key}`);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return String(Object.values(row)[0] ?? '');
    }
    stmt.free();
    return '';
  }

  close(): void {
    if (!this._open) return;
    this._open = false;
    try {
      const data = this.db.export();
      writeFileSync(this.dbPath, Buffer.from(data));
      this.db.close();
    } finally {
      releaseDatabaseLock(this.lock);
      this.lock = undefined;
    }
  }
}

class Statement {
  private db: SqlJsDb;
  private sql: string;

  constructor(db: SqlJsDb, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  all(...params: any[]): any[] {
    try {
      const stmt = this.db.prepare(this.sql);
      if (params.length > 0) stmt.bind(params);
      const results: any[] = [];
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
      return results;
    } catch (e: any) {
      if (e.message?.includes('no such table')) return [];
      throw e;
    }
  }

  get(...params: any[]): any | undefined {
    const rows = this.all(...params);
    return rows.length > 0 ? rows[0] : undefined;
  }

  run(...params: any[]): { changes: number } {
    try {
      if (params.length > 0) {
        this.db.run(this.sql, params);
      } else {
        this.db.run(this.sql);
      }
      return { changes: this.db.getRowsModified() };
    } catch (e: any) {
      if (e.message?.includes('UNIQUE constraint') || e.message?.includes('FOREIGN KEY')) {
        return { changes: 0 };
      }
      throw e;
    }
  }
}

export async function openDatabase(vaultPath: string): Promise<Database> {
  const hlDir = join(vaultPath, '.hl');
  if (!existsSync(hlDir)) {
    mkdirSync(hlDir, { recursive: true });
  }

  const dbPath = join(hlDir, 'index.sqlite');
  const lock = await acquireDatabaseLock(hlDir);
  const SQL = await getSql();

  let db: SqlJsDb;
  try {
    if (existsSync(dbPath)) {
      const buffer = readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  } catch (error) {
    releaseDatabaseLock(lock);
    throw error;
  }

  const wrapped = new Database(db, dbPath, lock);

  // WAL mode may not be supported in sql.js — ignore if fails
  try { wrapped.exec('PRAGMA journal_mode=WAL'); } catch {}
  wrapped.exec('PRAGMA foreign_keys=ON');

  return wrapped;
}

async function acquireDatabaseLock(hlDir: string): Promise<DatabaseLock> {
  const lockPath = join(hlDir, 'index.sqlite.lock');
  const startedAt = Date.now();

  while (true) {
    try {
      const fd = openSync(lockPath, 'wx');
      writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`);
      return { fd, path: lockPath };
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;

      if (isStaleLock(lockPath)) {
        try { unlinkSync(lockPath); } catch {}
        continue;
      }

      if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for Human Learning database lock: ${lockPath}`);
      }
      await sleep(LOCK_RETRY_MS);
    }
  }
}

function releaseDatabaseLock(lock: DatabaseLock | undefined): void {
  if (!lock) return;
  try { closeSync(lock.fd); } catch {}
  try { unlinkSync(lock.path); } catch {}
}

function isStaleLock(lockPath: string): boolean {
  try {
    return Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function runMigrations(db: Database): { version: number; applied: number } {
  const currentVersion = getCurrentVersion(db);
  let applied = 0;

  for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
    const statements = MIGRATIONS[v];
    if (!statements) continue;

    const txn = db.transaction(() => {
      for (const sql of statements) {
        db.exec(sql);
      }
      db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(v);
    });
    txn();

    applied++;
  }

  return { version: SCHEMA_VERSION, applied };
}

function getCurrentVersion(db: Database): number {
  const tableExists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'"
  ).get();

  if (!tableExists) return 0;

  const row = db.prepare(
    'SELECT MAX(version) as version FROM schema_version'
  ).get() as { version: number | null } | undefined;

  return row?.version ?? 0;
}

export function closeDatabase(db: Database): void {
  db.close();
}
