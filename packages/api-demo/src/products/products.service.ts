import { Injectable, OnModuleInit } from '@nestjs/common';
import initSqlJs, { Database } from 'sql.js';

export interface ProductRow {
  id: number;
  name: string;
  category: string;
  price: number;
}

interface ProductSeed extends ProductRow {
  /** Internal-only column — never returned by the legitimate query, but reachable via a UNION-based injection. */
  internalNote: string;
}

const SEED: ProductSeed[] = [
  {
    id: 1,
    name: 'Wireless Keyboard',
    category: 'peripherals',
    price: 49.99,
    internalNote: 'supplier: acme; margin 40%',
  },
  {
    id: 2,
    name: 'Mechanical Mouse',
    category: 'peripherals',
    price: 29.99,
    internalNote: 'supplier: acme; margin 55%',
  },
  {
    id: 3,
    name: '27-inch Monitor',
    category: 'displays',
    price: 199.0,
    internalNote: 'clearance Q3; cost 120',
  },
  {
    id: 4,
    name: 'USB-C Hub',
    category: 'accessories',
    price: 34.5,
    internalNote: 'supplier: globex; margin 60%',
  },
  {
    id: 5,
    name: 'Laptop Stand',
    category: 'accessories',
    price: 24.0,
    internalNote: 'supplier: initech; margin 70%',
  },
];

/**
 * In-process SQLite (sql.js / WASM — no native build, works identically on
 * dev, CI, and the Alpine container). Deliberately vulnerable: `search()`
 * concatenates the caller's query string straight into the SQL, so it's
 * exploitable by classic SQL injection. This is the flaw DevoxGuard's
 * SqlInjectionDetector is meant to catch — see docs/injection-detection.md.
 */
@Injectable()
export class ProductsService implements OnModuleInit {
  private db!: Database;

  async onModuleInit(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => require.resolve(`sql.js/dist/${file}`),
    });
    this.db = new SQL.Database();
    this.db.run(
      `CREATE TABLE products (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         category TEXT NOT NULL,
         price REAL NOT NULL,
         internalNote TEXT NOT NULL
       );`,
    );
    // Seeding is parameterized — the injection is in search(), not here.
    const insert = this.db.prepare(
      'INSERT INTO products VALUES (?, ?, ?, ?, ?)',
    );
    for (const p of SEED) {
      insert.run([p.id, p.name, p.category, p.price, p.internalNote]);
    }
    insert.free();
  }

  /**
   * Deliberately vulnerable string-concatenated query. A benign `q` matches
   * product names; a crafted `q` such as `' OR '1'='1` returns every row, and
   * a `' UNION SELECT id, internalNote, category, price FROM products --`
   * exfiltrates the internal-only column. The legitimate projection never
   * selects `internalNote`.
   */
  search(q: string): ProductRow[] {
    const sql = `SELECT id, name, category, price FROM products WHERE name LIKE '%${q}%' ORDER BY id`;
    const result = this.db.exec(sql);
    if (result.length === 0) return [];
    const { columns, values } = result[0];
    return values.map((row) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => (obj[col] = row[i]));
      return obj as unknown as ProductRow;
    });
  }
}
