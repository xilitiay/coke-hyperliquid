import { Router } from 'express'
import { CompatController } from '../controllers/CompatController'
import { authenticate } from '../middleware/auth'

/**
 * Hyperliquid-compatible API surface:
 *   POST /info      — public read surface (no auth)
 *   POST /exchange  — write surface (JWT session + EIP-712 signed action)
 */
const router = Router()

router.post('/info', CompatController.info)
router.post('/exchange', authenticate, CompatController.exchange)

export default router
