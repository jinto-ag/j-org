import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load the .env file
dotenv.config();

// Define the configuration schema using Zod
const envSchema = z.object({
  DB_PATH: z.string().optional().default('db.json'),
  ENABLE_AUTH: z.preprocess(
    val => (typeof val === 'string' ? val === 'true' : val),
    z.boolean().default(true)
  ),
  PORT: z.coerce.number().optional().default(8000),
  HOST: z.string().optional().default('localhost'),
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .default(
      [
        'http://localhost:4200',
        'http://localhost:4300',
        'http://localhost:3000',
        'http://localhost:3001',
        'https://eunigos.azurewebsites.net',
      ].join(',')
    ),
  // New env variables for password reset flow:
  CLIENT_PASSWORD_RESET_URL: z
    .string()
    .optional()
    .default('http://localhost:3000/reset-password'),
  RESET_EMAIL_FROM: z.string().optional().default('no-reply@mail.quadauq.com'),
  RESEND_TOKEN: z.string(), // required
});

// Infer the TypeScript type from the schema
export type Config = z.infer<typeof envSchema>;

export class Env {
  private static instance: Env;
  private config: Config;

  // Private constructor to enforce singleton pattern.
  private constructor() {
    // Validate and parse the environment variables.
    this.config = envSchema.parse(process.env);
  }

  // Get the singleton instance of the Env class.
  public static getInstance(): Env {
    if (!Env.instance) {
      Env.instance = new Env();
    }
    return Env.instance;
  }

  // Get a specific configuration value.
  public get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  // Get all configuration values.
  public getAll(): Config {
    return this.config;
  }
}
