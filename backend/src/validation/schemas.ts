// backend/src/validation/schemas.ts
import { z } from 'zod';

/**
 * Validation Schemas using Zod
 * 
 * These schemas ensure all API endpoints receive valid, well-formed data.
 * Invalid requests are automatically rejected with 400 Bad Request.
 */

// ============================================================================
// Custom Validators
// ============================================================================

/**
 * IPv4 address validator
 */
const ipv4Schema = z.string().regex(
  /^(\d{1,3}\.){3}\d{1,3}$/,
  'Must be a valid IPv4 address'
).refine((ip: string) => {
  const octets = ip.split('.').map(Number);
  return octets.every((octet: number) => octet >= 0 && octet <= 255);
}, 'IP address octets must be between 0 and 255');

/**
 * Port number validator
 */
const portSchema = z.number().int().min(1).max(65535);

/**
 * Pool URL validator (hostname:port format)
 */
const poolUrlSchema = z.string().regex(
  /^[a-zA-Z0-9.-]+:\d{1,5}$/,
  'Must be in format hostname:port'
).refine((url: string) => {
  const parts = url.split(':');
  const portStr = parts[parts.length - 1];
  const port = parseInt(portStr, 10);
  return port >= 1 && port <= 65535;
}, 'Port must be between 1 and 65535');

// ============================================================================
// Pool Schemas
// ============================================================================

/**
 * Pool configuration schema
 */
export const poolConfigSchema = z.object({
  url: poolUrlSchema,
  name: z.string().min(1).max(100),
  algorithm: z.enum(['sha256', 'scrypt', 'multi']),
  priority: z.enum(['high', 'medium', 'low']),
});

export type PoolConfig = z.infer<typeof poolConfigSchema>;

/**
 * Pool monitoring settings schema
 */
export const poolConfigSettingsSchema = z.object({
  test_interval: z.number().int().min(1).max(60),
  enable_ping: z.boolean(),
  connection_timeout: z.number().int().min(1).max(30),
  dns_timeout: z.number().int().min(1).max(10),
});

export type PoolConfigSettings = z.infer<typeof poolConfigSettingsSchema>;

/**
 * Complete pools configuration schema
 */
export const poolsConfigurationSchema = z.object({
  pools: z.array(poolConfigSchema).min(0).max(100),
  config: poolConfigSettingsSchema,
});

export type PoolsConfiguration = z.infer<typeof poolsConfigurationSchema>;

/**
 * Add pool request schema
 */
export const addPoolSchema = poolConfigSchema;

/**
 * Update pool request schema
 */
export const updatePoolSchema = poolConfigSchema;

/**
 * Update pools configuration request schema
 */
export const updatePoolsConfigSchema = poolsConfigurationSchema;

// ============================================================================
// Miner Schemas
// ============================================================================

/**
 * Miner configuration schema
 */
export const minerConfigSchema = z.object({
  name: z.string().min(1).max(100),
  ip: ipv4Schema,
  model: z.string().min(1).max(100),
  alias: z.string().max(100).optional(),
  owner: z.string().max(100).optional(),
});

export type MinerConfig = z.infer<typeof minerConfigSchema>;

/**
 * Miners configuration file schema
 */
export const minersConfigurationSchema = z.object({
  miners: z.array(minerConfigSchema).min(0).max(1000),
});

export type MinersConfiguration = z.infer<typeof minersConfigurationSchema>;

/**
 * Miner control request schema
 */
export const minerControlSchema = z.object({
  action: z.enum(['restart', 'reboot', 'stop', 'start']),
  confirm: z.boolean().optional(),
});

export type MinerControl = z.infer<typeof minerControlSchema>;

// ============================================================================
// Alert Schemas
// ============================================================================

/**
 * Alertmanager webhook payload schema
 */
export const alertmanagerWebhookSchema = z.object({
  version: z.string().optional(),
  groupKey: z.string().optional(),
  truncatedAlerts: z.number().optional(),
  status: z.enum(['firing', 'resolved']),
  receiver: z.string(),
  groupLabels: z.record(z.string()).optional(),
  commonLabels: z.record(z.string()).optional(),
  commonAnnotations: z.record(z.string()).optional(),
  externalURL: z.string().optional(),
  alerts: z.array(z.object({
    status: z.enum(['firing', 'resolved']),
    labels: z.record(z.string()),
    annotations: z.record(z.string()),
    startsAt: z.string(),
    endsAt: z.string().optional(),
    generatorURL: z.string().optional(),
    fingerprint: z.string().optional(),
  })),
});

export type AlertmanagerWebhook = z.infer<typeof alertmanagerWebhookSchema>;

// ============================================================================
// Telegram Schemas
// ============================================================================

/**
 * Telegram message schema
 */
export const telegramMessageSchema = z.object({
  chat_id: z.union([z.string(), z.number()]),
  text: z.string().min(1).max(4096),
  parse_mode: z.enum(['HTML', 'Markdown', 'MarkdownV2']).optional(),
  disable_notification: z.boolean().optional(),
});

export type TelegramMessage = z.infer<typeof telegramMessageSchema>;

// ============================================================================
// Collection Schemas
// ============================================================================

/**
 * Collection trigger schema
 */
export const collectionTriggerSchema = z.object({
  force: z.boolean().optional().default(false),
  collectors: z.array(z.enum(['miners', 'pools', 'all'])).optional(),
});

export type CollectionTrigger = z.infer<typeof collectionTriggerSchema>;

// ============================================================================
// Validation Middleware
// ============================================================================

import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';

/**
 * Validation error response
 */
interface ValidationErrorResponse {
  success: false;
  error: 'ValidationError';
  message: string;
  details: Array<{
    field: string;
    message: string;
  }>;
}

/**
 * Create validation middleware for request body
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      // Validate and parse request body
      const validated = schema.parse(req.body);
      
      // Replace req.body with validated data
      req.body = validated;
      
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorResponse: ValidationErrorResponse = {
          success: false,
          error: 'ValidationError',
          message: 'Invalid request data',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        };
        
        res.status(400).json(errorResponse);
      } else {
        next(error);
      }
    }
  };
}

/**
 * Create validation middleware for query parameters
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.query);
      req.query = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorResponse: ValidationErrorResponse = {
          success: false,
          error: 'ValidationError',
          message: 'Invalid query parameters',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        };
        
        res.status(400).json(errorResponse);
      } else {
        next(error);
      }
    }
  };
}

/**
 * Create validation middleware for route parameters
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const validated = schema.parse(req.params);
      req.params = validated as any;
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errorResponse: ValidationErrorResponse = {
          success: false,
          error: 'ValidationError',
          message: 'Invalid route parameters',
          details: error.errors.map((err: any) => ({
            field: err.path.join('.'),
            message: err.message,
          })),
        };
        
        res.status(400).json(errorResponse);
      } else {
        next(error);
      }
    }
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Safe parse with default value
 */
export function safeParse<T>(schema: ZodSchema<T>, data: unknown, defaultValue: T): T {
  const result = schema.safeParse(data);
  return result.success ? result.data : defaultValue;
}

/**
 * Validate and throw on error
 */
export function validateOrThrow<T>(schema: ZodSchema<T>, data: unknown, errorMessage?: string): T {
  const result = schema.safeParse(data);
  
  if (!result.success) {
    const errors = result.error.errors.map((err: any) => `${err.path.join('.')}: ${err.message}`).join(', ');
    throw new Error(errorMessage || `Validation failed: ${errors}`);
  }
  
  return result.data;
}
