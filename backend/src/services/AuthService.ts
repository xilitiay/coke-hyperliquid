import { ethers } from 'ethers'
import { OAuth2Client } from 'google-auth-library'
import axios from 'axios'
import { UserModel } from '../models/User'
import { AgentModel, type Agent } from '../models/AgentModel'
import { verifyApproveAgentSignature, verifyApproveBuilderSignature } from '../utils/signature'
import config from '../config'
import { generateToken } from '../middleware/auth'
import { AuthToken } from '../types'
import { createError } from '../utils/response'
import logger from '../utils/logger'

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
)

/**
 * Auth Service - Business logic for authentication
 */
export class AuthService {
  /**
   * Register or login with wallet
   * Verifies the signature and creates/retrieves user
   */
  static async loginWithWallet(
    walletAddress: string,
    signature: string,
    message: string
  ): Promise<{ user: any; token: AuthToken }> {
    // Verify signature
    const isValid = await this.verifyWalletSignature(
      walletAddress,
      message,
      signature
    )

    if (!isValid) {
      throw createError.invalidSignature('Invalid wallet signature')
    }

    // Find or create user
    let user = await UserModel.findByWalletAddress(walletAddress)

    if (!user) {
      // Create new user
      user = await UserModel.create(walletAddress)
      logger.info('New user registered', { walletAddress })
    } else {
      logger.info('User logged in', { walletAddress })
    }

    // Generate JWT token
    const token = generateToken(user.id, user.walletAddress || walletAddress)

    return {
      user: {
        id: user.id,
        walletAddress: user.walletAddress,
        email: user.email,
        createdAt: user.createdAt,
      },
      token: {
        token,
        expiresIn: '7d',
      },
    }
  }

  /**
   * Verify wallet signature
   */
  static async verifyWalletSignature(
    walletAddress: string,
    message: string,
    signature: string
  ): Promise<boolean> {
    try {
      // Recover the address from the signature
      const recoveredAddress = ethers.verifyMessage(message, signature)

      // Compare addresses (case-insensitive)
      return recoveredAddress.toLowerCase() === walletAddress.toLowerCase()
    } catch (error) {
      logger.error('Signature verification failed', { error })
      return false
    }
  }

  /**
   * Verify authentication token
   */
  static async verifyToken(token: string): Promise<any> {
    // This is handled by the auth middleware
    // This method is here for completeness
    return null
  }

  /**
   * Get user profile
   */
  static async getProfile(userId: number): Promise<any> {
    const user = await UserModel.findById(userId)

    if (!user) {
      throw createError.notFound('User not found')
    }

    return {
      id: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    }
  }

  /**
   * Update user email
   */
  static async updateEmail(userId: number, email: string): Promise<void> {
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      throw createError.badRequest('Invalid email format')
    }

    await UserModel.updateEmail(userId, email)
  }

  /* --------------------- API wallets (agents) --------------------- */

  /**
   * Register an agent (API wallet). The user's MAIN wallet signs an EIP-712
   * approveAgent action — the agent key itself is never sent to us beyond its
   * address. Mirrors Hyperliquid's delegation model.
   */
  static async registerAgent(
    userId: number,
    request: { agentAddress: string; agentName?: string; validUntil?: number; nonce?: number; signature: string }
  ): Promise<Agent> {
    if (!ethers.isAddress(request.agentAddress)) {
      throw createError.badRequest('Invalid agent address')
    }
    const valid = await verifyApproveAgentSignature(
      userId,
      { agentAddress: request.agentAddress, agentName: request.agentName, nonce: request.nonce },
      request.signature
    )
    if (!valid) {
      throw createError.invalidSignature()
    }
    await AgentModel.add(userId, {
      agentAddress: ethers.getAddress(request.agentAddress),
      name: request.agentName,
      validUntil: request.validUntil,
    })
    logger.info('Agent registered', { userId, agentAddress: request.agentAddress })
    const agents = await AgentModel.list(userId)
    return agents.find((a) => a.agentAddress.toLowerCase() === request.agentAddress.toLowerCase())!
  }

  static async listAgents(userId: number): Promise<Agent[]> {
    return AgentModel.list(userId)
  }

  static async revokeAgent(userId: number, agentAddress: string): Promise<void> {
    const removed = await AgentModel.remove(userId, agentAddress)
    if (removed === 0) {
      throw createError.notFound('Agent not found')
    }
    logger.info('Agent revoked', { userId, agentAddress })
  }

  /* --------------------- Builder Codes --------------------- */

  /**
   * One-time builder-fee approval: the user's main wallet signs an EIP-712
   * approveBuilderFee action. After this, orders from this account may carry
   * the builder's {b, f} pair (rate-capped per market).
   */
  static async approveBuilderFee(
    userId: number,
    request: { maxFee: number; nonce?: number; signature: string }
  ): Promise<{ builderAddress: string; maxFee: number }> {
    const builderAddress = config.builder.address
    if (!builderAddress) {
      throw createError.badRequest('This deployment has no builder configured')
    }
    // Hyperliquid caps: perp 100 (10bp), spot 1000 (100bp), in 0.1bp units
    if (!Number.isInteger(request.maxFee) || request.maxFee < 0 || request.maxFee > 1000) {
      throw createError.badRequest('maxFee must be an integer in [0, 1000] (0.1bp units)')
    }
    const valid = await verifyApproveBuilderSignature(
      userId,
      { builderAddress, maxFee: request.maxFee, nonce: request.nonce },
      request.signature
    )
    if (!valid) {
      throw createError.invalidSignature()
    }
    await AgentModel.approveBuilder(userId, builderAddress, request.maxFee)
    logger.info('Builder fee approved', { userId, builderAddress, maxFee: request.maxFee })
    return { builderAddress, maxFee: request.maxFee }
  }

  static async listBuilderApprovals(userId: number) {
    return AgentModel.listBuilderApprovals(userId)
  }

  /**
   * Login with Google OAuth (ID Token - for popup mode)
   * Verifies the Google token and creates/retrieves user
   */
  static async loginWithGoogle(
    googleToken: string
  ): Promise<{ user: any; token: AuthToken }> {
    try {
      // Verify Google token
      const ticket = await googleClient.verifyIdToken({
        idToken: googleToken,
        audience: process.env.GOOGLE_CLIENT_ID,
      })

      const payload = ticket.getPayload()
      if (!payload || !payload.email) {
        throw createError.badRequest('Invalid Google token')
      }

      const { email, sub: googleId, name, picture } = payload

      // Find or create user by email
      let user = await UserModel.findByEmail(email)

      if (!user) {
        // Create new user with Google info
        user = await UserModel.createWithGoogle({
          email,
          googleId,
          name: name || email.split('@')[0],
          avatar: picture,
        })
        logger.info('New user registered with Google', { email })
      } else {
        logger.info('User logged in with Google', { email })
      }

      // Generate JWT token
      const token = generateToken(user.id, user.walletAddress || email)

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          walletAddress: user.walletAddress,
          createdAt: user.createdAt,
        },
        token: {
          token,
          expiresIn: '7d',
        },
      }
    } catch (error: any) {
      logger.error('Google login failed', { error: error.message })
      throw createError.unauthorized('Google authentication failed')
    }
  }

  /**
   * Login with Google OAuth (Authorization Code - for redirect mode)
   * Exchange authorization code for tokens and creates/retrieves user
   */
  static async loginWithGoogleCode(
    code: string,
    redirectUri: string
  ): Promise<{ user: any; token: AuthToken }> {
    try {
      logger.info('Attempting to exchange code for tokens', {
        codeLength: code.length,
        redirectUri,
        hasClientId: !!process.env.GOOGLE_CLIENT_ID,
        hasClientSecret: !!process.env.GOOGLE_CLIENT_SECRET
      })

      // Exchange authorization code for tokens using direct HTTP request
      const params = new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })

      const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', params, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      })

      logger.info('Successfully received tokens from Google')

      const { id_token, access_token } = tokenResponse.data

      if (!id_token) {
        throw createError.badRequest('No ID token received from Google')
      }

      // Verify ID token
      const ticket = await googleClient.verifyIdToken({
        idToken: id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      })

      const payload = ticket.getPayload()
      if (!payload || !payload.email) {
        throw createError.badRequest('Invalid Google token payload')
      }

      const { email, sub: googleId, name, picture } = payload

      // Find or create user by email
      let user = await UserModel.findByEmail(email)

      if (!user) {
        // Create new user with Google info
        user = await UserModel.createWithGoogle({
          email,
          googleId,
          name: name || email.split('@')[0],
          avatar: picture,
        })
        logger.info('New user registered with Google (OAuth code)', { email })
      } else {
        logger.info('User logged in with Google (OAuth code)', { email })
      }

      // Generate JWT token
      const token = generateToken(user.id, user.walletAddress || email)

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          avatar: user.avatar,
          walletAddress: user.walletAddress,
          createdAt: user.createdAt,
        },
        token: {
          token,
          expiresIn: '7d',
        },
      }
    } catch (error: any) {
      logger.error('Google OAuth code exchange failed', {
        error: error.message,
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        stack: error.stack
      })
      throw createError.unauthorized('Google authentication failed')
    }
  }
}
