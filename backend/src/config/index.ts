import dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

interface Config {
  env: string
  port: number
  host: string
  database: {
    host: string
    port: number
    name: string
    user: string
    password: string
    connectionLimit: number
  }
  redis: {
    host: string
    port: number
    password?: string
  }
  jwt: {
    secret: string
    expiresIn: string
  }
  cors: {
    origin: string
  }
  websocket: {
    port: number
  }
  /** This deployment's builder code (Hyperliquid Builder Codes). */
  builder: {
    address: string
    /** Default fee injected on orders, in 0.1bp units (perp cap 100 = 10bp). */
    defaultFee: number
  }
  rateLimit: {
    windowMs: number
    maxRequests: number
  }
  log: {
    level: string
  }
}

const config: Config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  host: process.env.HOST || '0.0.0.0',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    name: process.env.DB_NAME || 'hyperliquid',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'your_jwt_secret_change_me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  },
  websocket: {
    port: parseInt(process.env.WS_PORT || '4001', 10),
  },
  builder: {
    // Demo builder code — a zero address disables injection entirely.
    // All-lowercase so ethers can encode it as an EIP-712 `address` field
    // without requiring an EIP-55 checksum.
    address: process.env.BUILDER_ADDRESS || '0x000000000000000000000000000000000000dead',
    defaultFee: parseInt(process.env.BUILDER_DEFAULT_FEE || '10', 10), // 1bp
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
}

export default config
