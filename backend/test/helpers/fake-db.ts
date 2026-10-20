/**
 * In-memory MySQL emulator for tests.
 *
 * Patches the exports of src/config/database.ts (query / queryOne /
 * transaction / getPool) with a tiny SQL interpreter that understands exactly
 * the statement subset used by the models in src/models/*.ts. No external
 * dependencies, fully deterministic.
 *
 * Usage (must run before any model/service code touches the DB):
 *   import './helpers/fake-db'   // installs + seeds defaults
 *   import { fakeDb } from './helpers/fake-db'
 *   fakeDb.reset({ users: [...] })
 */

import { createRequire } from 'node:module'

type Row = Record<string, any>

// NB: __filename (not import.meta.url) — these helpers are compiled to CJS by
// ts-node, and import.meta is invalid in CommonJS output.
const require_ = createRequire(__filename)

interface ExecResult {
	rows: Row[]
	insertId?: number
	affectedRows?: number
}

/** Split "a = ? AND b IN (?, ?)" into clauses, consuming params in order. */
function parseWhere(clause: string, params: any[]): { test: (row: Row) => boolean; consumed: number } {
	let i = 0
	const tests: ((row: Row) => boolean)[] = []
	const parts = clause.split(/\s+AND\s+/i)
	for (const part of parts) {
		const inMatch = part.match(/^(\w+)\s+IN\s+\((\?(?:,\s*\?)*)\)$/i)
		if (inMatch) {
			const col = inMatch[1]
			const count = (inMatch[2].match(/\?/g) || []).length
			const values = params.slice(i, i + count)
			i += count
			tests.push((row) => values.includes(row[col]))
			continue
		}
		const eq = part.match(/^(\w+)\s*=\s*\?$/i)
		if (eq) {
			const col = eq[1]
			const value = params[i++]
			// MySQL's default collations are case-insensitive for = comparisons.
			tests.push((row) =>
				row[col] === value ||
				(typeof row[col] === 'string' && typeof value === 'string' && row[col].toLowerCase() === value.toLowerCase())
			)
			continue
		}
		throw new Error(`fake-db: unsupported WHERE clause "${part}"`)
	}
	return { test: (row) => tests.every((t) => t(row)), consumed: i }
}

class FakeDb {
	tables: Record<string, Row[]> = {}
	private autoInc: Record<string, number> = {}

	reset(seed: Record<string, Row[]> = {}) {
		this.tables = { users: [], orders: [], assets: [], positions: [], trading_pairs: [], tickers: [], trades: [], funding_rates: [], user_settings: [], agents: [], builder_approvals: [], builder_fees: [] }
		this.autoInc = {}
		for (const [table, rows] of Object.entries(seed)) {
			this.tables[table] = rows.map((r) => ({ ...r }))
			const ids = rows.map((r) => Number(r.id)).filter((n) => Number.isFinite(n))
			if (ids.length) this.autoInc[table] = Math.max(...ids)
		}
	}

	table(name: string): Row[] {
		if (!this.tables[name]) throw new Error(`fake-db: unknown table "${name}"`)
		return this.tables[name]
	}

	private nextId(table: string): number {
		this.autoInc[table] = (this.autoInc[table] ?? 0) + 1
		return this.autoInc[table]
	}

	exec(sql: string, params: any[] = []): ExecResult {
		const s = sql.replace(/\s+/g, ' ').replace(/\s+FOR UPDATE$/i, '').trim()

		// ---- INSERT ----
		const ins = s.match(/^INSERT INTO (\w+) \(([^)]+)\) VALUES/i)
		if (ins) {
			const table = ins[1]
			const cols = ins[2].split(',').map((c) => c.trim())
			const row: Row = { created_at: new Date(), updated_at: new Date() }
			cols.forEach((c, idx) => {
				row[c] = params[idx]
			})
			if (!('id' in row)) row.id = this.nextId(table)
			else this.autoInc[table] = Math.max(this.autoInc[table] ?? 0, Number(row.id))
			this.table(table).push(row)
			return { rows: [], insertId: row.id, affectedRows: 1 }
		}

		// ---- DELETE ----
		const del = s.match(/^DELETE FROM (\w+) WHERE (.+)$/i)
		if (del) {
			const table = del[1]
			const { test, consumed } = parseWhere(del[2], params)
			const rows = this.table(table)
			const kept = rows.filter((r) => !test(r))
			const affected = rows.length - kept.length
			this.tables[table] = kept
			return { rows: [], affectedRows: affected }
		}

		// ---- UPDATE ----
		const upd = s.match(/^UPDATE (\w+) SET (.+?) WHERE (.+)$/i)
		if (upd) {
			const table = upd[1]
			const assignments = upd[2].split(',').map((a) => a.trim())
			const setParsed: { col: string; value: any }[] = []
			let pi = 0
			for (const a of assignments) {
				const m = a.match(/^(\w+)\s*=\s*(.+)$/)
				if (!m) throw new Error(`fake-db: unsupported SET clause "${a}"`)
				if (m[2] === '?') setParsed.push({ col: m[1], value: params[pi++] })
				else if (/^NOW\(\)$/i.test(m[2])) setParsed.push({ col: m[1], value: new Date() })
				else throw new Error(`fake-db: unsupported SET value "${m[2]}"`)
			}
			const { test, consumed } = parseWhere(upd[3], params.slice(pi))
			let affected = 0
			for (const row of this.table(table)) {
				if (test(row)) {
					for (const { col, value } of setParsed) row[col] = value
					affected++
				}
			}
			return { rows: [], affectedRows: affected }
		}

		// ---- SELECT ----
		const sel = s.match(
			/^SELECT (.+?) FROM (\w+)(?: WHERE (.+?))?(?: ORDER BY (\w+)( DESC)?)?(?: LIMIT (\d+) OFFSET (\d+))?$/i
		)
		if (sel) {
			const [, colsRaw, table, whereRaw, orderCol, desc, limitRaw, offsetRaw] = sel
			let rows = [...this.table(table)]
			if (whereRaw) {
				const { test } = parseWhere(whereRaw, params)
				rows = rows.filter(test)
			}
			// aggregates
			const countMatch = colsRaw.match(/^COUNT\(\*\)\s+as\s+(\w+)$/i)
			if (countMatch) return { rows: [{ [countMatch[1]]: rows.length }] }
			const sumMatch = colsRaw.match(/^COALESCE\(SUM\(CAST\((\w+) AS DECIMAL\(\d+,\d+\)\)\), 0\)\s+as\s+(\w+)$/i)
			if (sumMatch) {
				const total = rows.reduce((sum, r) => sum + (Number(r[sumMatch[1]]) || 0), 0)
				return { rows: [{ [sumMatch[2]]: total.toFixed(8) }] }
			}
			if (colsRaw.trim() !== '*') throw new Error(`fake-db: unsupported SELECT cols "${colsRaw}"`)
			if (orderCol) {
				rows.sort((a, b) => {
					const av = a[orderCol] instanceof Date ? a[orderCol].getTime() : a[orderCol]
					const bv = b[orderCol] instanceof Date ? b[orderCol].getTime() : b[orderCol]
					const cmp = av > bv ? 1 : av < bv ? -1 : 0
					return desc ? -cmp : cmp
				})
			}
			if (limitRaw !== undefined) {
				const offset = offsetRaw !== undefined ? Number(offsetRaw) : 0
				rows = rows.slice(offset, offset + Number(limitRaw))
			}
			return { rows }
		}

		throw new Error(`fake-db: unsupported SQL "${s}"`)
	}
}

export const fakeDb = new FakeDb()

const DEFAULT_PAIRS: Row[] = [
	{ id: 1, symbol: 'BTC/USDC', base_asset: 'BTC', quote_asset: 'USDC', type: 'SPOT', min_order_size: '0.0001', max_order_size: '1000', tick_size: '0.01', status: 'ACTIVE' },
	{ id: 2, symbol: 'ETH/USDC', base_asset: 'ETH', quote_asset: 'USDC', type: 'SPOT', min_order_size: '0.001', max_order_size: '10000', tick_size: '0.01', status: 'ACTIVE' },
	{ id: 3, symbol: 'BTC-PERP', base_asset: 'BTC', quote_asset: 'USDC', type: 'PERPETUAL', min_order_size: '0.0001', max_order_size: '1000', tick_size: '0.01', status: 'ACTIVE' },
	{ id: 4, symbol: 'ETH-PERP', base_asset: 'ETH', quote_asset: 'USDC', type: 'PERPETUAL', min_order_size: '0.001', max_order_size: '10000', tick_size: '0.01', status: 'ACTIVE' },
]

/** Reset to the default seed: the four trading pairs from schema.sql. */
export function seedDefaults() {
	fakeDb.reset({ trading_pairs: DEFAULT_PAIRS })
}

/** Install the fake into the real database module's exports. */
export function installFakeDb() {
	const dbPath = require_.resolve('../../src/config/database')
	const mod = require_(dbPath)
	// mysql2's query() resolves to the rows array for SELECT, and to a
	// ResultSetHeader ({ insertId, affectedRows }) for INSERT/UPDATE/DELETE.
	mod.query = async (sql: string, params?: any[]) => {
		const r = fakeDb.exec(sql, params ?? [])
		return /^\s*SELECT/i.test(sql) ? r.rows : r
	}
	mod.queryOne = async (sql: string, params?: any[]) => {
		const r = fakeDb.exec(sql, params ?? [])
		return r.rows.length > 0 ? r.rows[0] : null
	}
	mod.transaction = async (cb: any) => {
		const conn = {
			execute: async (sql: string, params?: any[]) => {
				const r = fakeDb.exec(sql, params ?? [])
				return [r.rows, []]
			},
			beginTransaction: async () => {},
			commit: async () => {},
			rollback: async () => {},
			release: () => {},
		}
		return cb(conn)
	}
	mod.getPool = () => ({ getConnection: async () => ({ ping: async () => {}, release: () => {} }), execute: async () => [[]] })
	mod.initDatabase = async () => ({})
	mod.closeDatabase = async () => {}
	seedDefaults()
	return mod
}

installFakeDb()
