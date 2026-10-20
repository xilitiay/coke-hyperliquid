import { query, queryOne } from '../config/database'
import { MarginMode } from '../types'

/**
 * Per-user trading settings — leverage and margin mode (cross/isolated),
 * mirroring Hyperliquid's account configuration. One row per user, upserted.
 */
export interface UserSettings {
  userId: number
  leverage: number
  marginMode: MarginMode
}

export class UserSettingsModel {
  static async get(userId: number): Promise<UserSettings> {
    const row = await queryOne<any>(
      'SELECT * FROM user_settings WHERE user_id = ?',
      [userId]
    )
    return {
      userId,
      leverage: row ? Number(row.leverage) : 10,
      marginMode: row ? row.margin_mode : 'CROSS',
    }
  }

  static async setLeverage(userId: number, leverage: number): Promise<UserSettings> {
    await this.upsert(userId, { leverage })
    return this.get(userId)
  }

  static async setMarginMode(userId: number, marginMode: MarginMode): Promise<UserSettings> {
    await this.upsert(userId, { marginMode })
    return this.get(userId)
  }

  private static async upsert(userId: number, patch: { leverage?: number; marginMode?: MarginMode }): Promise<void> {
    const current = await this.get(userId)
    const leverage = patch.leverage ?? current.leverage
    const marginMode = patch.marginMode ?? current.marginMode
    await query(
      `INSERT INTO user_settings (user_id, leverage, margin_mode, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         leverage = VALUES(leverage),
         margin_mode = VALUES(margin_mode),
         updated_at = NOW()`,
      [userId, leverage, marginMode]
    )
  }
}
