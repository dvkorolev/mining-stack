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
