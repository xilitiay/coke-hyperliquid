import { query } from '../config/database'

/** A registered API wallet (agent) delegated by a user's main wallet. */
export interface Agent {
  agentAddress: string
  name: string | null
  validUntil: number | null
  createdAt: Date
}

export interface BuilderApproval {
  builderAddress: string
  maxFee: number
}

/**
 * Agents + builder-fee authorisations (Hyperliquid's API-wallet and Builder
 * Codes models). Agents may sign orders but never move funds; builder fee
 * approvals are one-time per (user, builder) pair.
 */
export class AgentModel {
  static async list(userId: number): Promise<Agent[]> {
    const rows = await query<any[]>(
      'SELECT * FROM agents WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    )
    return rows.map((r) => ({
      agentAddress: r.agent_address,
      name: r.name ?? null,
      validUntil: r.valid_until ? Number(r.valid_until) : null,
      createdAt: r.created_at,
    }))
  }

  static async add(userId: number, agent: { agentAddress: string; name?: string; validUntil?: number }): Promise<void> {
    await query(
      `INSERT INTO agents (user_id, agent_address, name, valid_until)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), valid_until = VALUES(valid_until)`,
      [userId, agent.agentAddress, agent.name ?? null, agent.validUntil ?? null]
    )
  }

  static async remove(userId: number, agentAddress: string): Promise<number> {
    const result = await query<any>(
      'DELETE FROM agents WHERE user_id = ? AND agent_address = ?',
      [userId, agentAddress]
    )
    return result.affectedRows || 0
  }

  /* ----------------------------- builder fees ----------------------------- */

  static async listBuilderApprovals(userId: number): Promise<BuilderApproval[]> {
    const rows = await query<any[]>(
      'SELECT * FROM builder_approvals WHERE user_id = ?',
      [userId]
    )
    return rows.map((r) => ({ builderAddress: r.builder_address, maxFee: Number(r.max_fee) }))
  }

  static async approveBuilder(userId: number, builderAddress: string, maxFee: number): Promise<void> {
    await query(
      `INSERT INTO builder_approvals (user_id, builder_address, max_fee)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE max_fee = VALUES(max_fee)`,
      [userId, builderAddress, maxFee]
    )
  }

  static async recordBuilderFee(orderId: string, userId: number, builderAddress: string, fee: number): Promise<void> {
    await query(
      'INSERT INTO builder_fees (order_id, user_id, builder_address, fee) VALUES (?, ?, ?, ?)',
      [orderId, userId, builderAddress, fee]
    )
  }

  static async builderFeesForOrder(orderId: string): Promise<{ builderAddress: string; fee: number }[]> {
    const rows = await query<any[]>('SELECT * FROM builder_fees WHERE order_id = ?', [orderId])
    return rows.map((r) => ({ builderAddress: r.builder_address, fee: Number(r.fee) }))
  }
}
