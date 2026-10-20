import type { Database } from 'better-sqlite3';
import { logger } from '../utils/logger';

interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'add_miner_mac',
    up(db) {
      const columns = db.pragma('table_info(miners)') as Array<{ name: string }>;
      const hasMac = columns.some((col) => col.name === 'mac');
      if (!hasMac) {
        db.exec('ALTER TABLE miners ADD COLUMN mac TEXT');
        logger.info('Added mac column to miners table');
      }
    },
  },
  {
    version: 2,
    name: 'add_miner_role',
    up(db) {
      // `role` is the role of the machine in the farm, not the lifecycle of
      // its record (`status`). It replaces the `ip!~"192.168.2.(58|117)"`
      // literal that the park rules carried: a rule cannot read SQLite, so
      // the property has to exist as a label before the literal can go
      // (DMI-179). Typed at the schema level so no writer can introduce a
      // third value by accident.
      const columns = db.pragma('table_info(miners)') as Array<{ name: string }>;
      const hasRole = columns.some((col) => col.name === 'role');
      if (!hasRole) {
        db.exec(
          "ALTER TABLE miners ADD COLUMN role TEXT NOT NULL DEFAULT 'production' " +
          "CHECK (role IN ('production', 'stand'))"
        );
        logger.info('Added role column to miners table');
      }

      // The two machines the literal excluded. This is the same fact, moved
      // from the rules into the inventory, and is deliberately a one-time
      // backfill: a later change of role is an API/DB edit and must not be
      // undone by re-running a migration.
      const result = db.prepare(
        "UPDATE miners SET role = 'stand' WHERE ip IN ('192.168.2.58', '192.168.2.117')"
      ).run();
      if (result.changes > 0) {
        logger.info(`Marked ${result.changes} miner(s) as role=stand`);
      }
    },
  },
];

export function runMigrations(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number;

  for (const m of MIGRATIONS) {
    if (m.version <= current) {
      continue;
    }

    logger.info(`Running migration ${m.version}: ${m.name}`);
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
    logger.info(`Migration ${m.version} complete`);
  }
}
