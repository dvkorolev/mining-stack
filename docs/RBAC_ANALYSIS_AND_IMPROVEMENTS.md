# RBAC Model Analysis & Improvement Recommendations

## 📋 Current State Analysis

### Authentication Methods
1. **Telegram Chat ID Authentication**
   - Users authenticate with their Telegram Chat ID
   - Verification via Telegram bot (2-factor-like)
   - Chat ID stored in localStorage
   
2. **System API Key Authentication**
   - Internal services (python-scheduler) use `X-API-Key` header
   - Single system-wide API key from env variable
   - Grants full admin access

### Authorization Model
```
Roles: admin | user
├── admin: Single admin defined by ADMIN_TELEGRAM_CHAT_ID env var
├── user: All other authenticated Telegram users
└── system: Services with SYSTEM_API_KEY (treated as admin)
```

### Current Implementation

#### Backend (`auth.middleware.ts`)
- **`authenticate()`**: Requires either X-API-Key or X-Telegram-Chat-ID
- **`optionalAuth()`**: Attaches user context if provided, no requirement
- **`requireAdmin()`**: Must be used after authenticate, checks role === 'admin'

#### Frontend
- **AuthContext**: Manages user state, stores chatId in localStorage
- **AdminRoute**: Component wrapper for admin-only pages
- **ProtectedRoute**: Component wrapper for authenticated pages

### Protected Resources

#### Admin-Only Operations
- `/mining/database/cleanup` - Database cleanup
- `/mining/miners/:minerId/transfer` - Transfer miner ownership
- `/mining/import-yaml` - Import miners configuration
- `/mining/export-yaml` - Export miners configuration  
- `/mining/backup-yaml` - Backup configuration

#### Admin-Only Pages
- `/alert-rules` - Alert rules management
- `/settings` - System settings

#### User-Filtered Operations
- `/mining/stats` - Filtered by owner if not admin
- Miner operations - Users see only their miners

---

## 🚨 Identified Issues & Risks

### **CRITICAL** Issues

#### 1. Single Admin Model ⚠️
**Risk Level: HIGH**
- Only ONE admin defined via environment variable
- No way to add/remove admins without redeployment
- If admin loses Telegram account, system has no admin

**Impact:**
- System administration bottleneck
- Single point of failure
- No admin succession planning

#### 2. No User Management System ⚠️
**Risk Level: HIGH**
- No user database table
- No user registration/invitation system
- No way to revoke access (except Telegram bot blocking)
- Owner field is just a string, not FK to users

**Impact:**
- Cannot track who has access
- Cannot audit user actions
- Cannot enforce policies per user

#### 3. Weak Session Management ⚠️
**Risk Level: MEDIUM**
- Chat ID stored in plain text in localStorage
- No token expiration
- No session revocation mechanism
- No "logout all devices" capability

**Impact:**
- Compromised browser = compromised account
- No way to force re-authentication
- Stolen localStorage = permanent access

#### 4. No Audit Trail ⚠️
**Risk Level: MEDIUM**
- No logging of sensitive operations
- Cannot track who transferred miners
- Cannot track who changed settings
- Cannot track data exports

**Impact:**
- No accountability
- Cannot investigate incidents
- Compliance issues (GDPR, etc.)

### **MEDIUM** Issues

#### 5. No Granular Permissions
**Risk Level: MEDIUM**
- Only two roles: admin and user
- No concept of "viewer", "operator", "manager"
- No permission to delegate (e.g., pool management only)

**Impact:**
- Over-privileged users (all-or-nothing)
- Cannot implement principle of least privilege

#### 6. No Multi-Tenancy Support
**Risk Level: LOW**
- Owner field is manual string
- No organizational structure
- No shared miners between users
- No team/group concept

**Impact:**
- Limited scalability for business use
- Difficult to manage farm partnerships

#### 7. Weak API Key Management
**Risk Level: MEDIUM**
- System API key in environment variable
- Pool API keys stored with basic encryption
- No key rotation mechanism
- No per-service API keys

**Impact:**
- Compromised key = full system access
- Cannot revoke specific service access

#### 8. No Rate Limiting Per User
**Risk Level: LOW**
- Global rate limiting only
- No per-user quotas
- No burst protection per account

**Impact:**
- One user can exhaust API quota
- No DoS protection per account

---

## ✅ Recommended Improvements

### Phase 1: Foundation (Critical - Week 1-2)

#### 1.1 Create Users Table
```sql
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT UNIQUE NOT NULL,
  username TEXT,
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',  -- admin, manager, user, viewer
  status TEXT NOT NULL DEFAULT 'active',  -- active, suspended, deleted
  created_at INTEGER NOT NULL,
  created_by INTEGER,  -- FK to users.id
  updated_at INTEGER,
  last_login_at INTEGER,
  metadata TEXT,  -- JSON for extensibility
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX idx_users_chat_id ON users(telegram_chat_id);
CREATE INDEX idx_users_status ON users(status);
```

#### 1.2 Create Sessions Table
```sql
CREATE TABLE user_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  session_token TEXT UNIQUE NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_activity_at INTEGER,
  revoked BOOLEAN DEFAULT 0,
  revoked_at INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_sessions_token ON user_sessions(session_token);
CREATE INDEX idx_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_sessions_expires ON user_sessions(expires_at);
```

#### 1.3 Create Audit Log Table
```sql
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,  -- 'miner.transfer', 'settings.update', etc.
  resource_type TEXT NOT NULL,  -- 'miner', 'setting', 'user', etc.
  resource_id TEXT,  -- IP, setting key, user ID, etc.
  old_value TEXT,  -- JSON
  new_value TEXT,  -- JSON
  ip_address TEXT,
  user_agent TEXT,
  result TEXT NOT NULL,  -- 'success', 'failure', 'denied'
  error_message TEXT,
  metadata TEXT,  -- JSON for additional context
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_user ON audit_logs(user_id);
CREATE INDEX idx_audit_action ON audit_logs(action);
CREATE INDEX idx_audit_resource ON audit_logs(resource_type, resource_id);
```

#### 1.4 Update Miners Table
```sql
-- Add foreign key to users table
ALTER TABLE miners ADD COLUMN owner_user_id INTEGER;
ALTER TABLE miners ADD COLUMN shared_with TEXT;  -- JSON array of user IDs

-- Create index
CREATE INDEX idx_miners_owner_user ON miners(owner_user_id);

-- Migration: Convert owner (chat_id string) to owner_user_id
-- Run after users table is populated
```

#### 1.5 Implement Session-Based Authentication
- Generate JWT tokens or secure random session tokens
- Token should include: user_id, role, exp, iat, jti
- Store in httpOnly cookie (not localStorage!)
- Implement token refresh mechanism
- Default expiry: 7 days, with sliding window

**Backend Changes:**
```typescript
// New middleware: authenticateSession
export const authenticateSession = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies.session_token || req.headers['authorization']?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No session token provided' });
  }
  
  // Validate token and check session in database
  const session = db.getActiveSession(token);
  if (!session || session.expires_at < Date.now()) {
    return res.status(401).json({ error: 'Invalid or expired session' });
  }
  
  // Update last activity
  db.updateSessionActivity(session.id);
  
  // Attach user to request
  req.user = db.getUserById(session.user_id);
  next();
};
```

### Phase 2: Multi-Admin & Permissions (Week 3-4)

#### 2.1 Define Role Hierarchy
```typescript
enum UserRole {
  SUPER_ADMIN = 'super_admin',  // Can manage admins
  ADMIN = 'admin',               // Can manage users and settings
  MANAGER = 'manager',           // Can manage miners and alerts
  OPERATOR = 'operator',         // Can control miners
  VIEWER = 'viewer',             // Read-only access
  USER = 'user'                  // Standard user
}

const ROLE_HIERARCHY = {
  super_admin: 100,
  admin: 80,
  manager: 60,
  operator: 40,
  viewer: 20,
  user: 10
};
```

#### 2.2 Create Permissions Table
```sql
CREATE TABLE permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,  -- 'miners.view', 'miners.edit', 'users.manage'
  display_name TEXT NOT NULL,
  description TEXT,
  resource_type TEXT NOT NULL,  -- 'miner', 'user', 'setting', 'alert'
  action TEXT NOT NULL  -- 'view', 'create', 'edit', 'delete', 'control'
);

CREATE TABLE role_permissions (
  role TEXT NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,
  PRIMARY KEY (role, permission_id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
);

CREATE TABLE user_permissions (
  user_id INTEGER NOT NULL,
  permission_id INTEGER NOT NULL,
  granted BOOLEAN DEFAULT 1,  -- False = explicitly denied
  granted_by INTEGER,
  granted_at INTEGER NOT NULL,
  expires_at INTEGER,
  PRIMARY KEY (user_id, permission_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id)
);
```

#### 2.3 Permission System Design
```typescript
// Permissions List
const PERMISSIONS = {
  // Miners
  'miners.view': 'View miners',
  'miners.view.all': 'View all miners (override owner filter)',
  'miners.create': 'Add new miners',
  'miners.edit': 'Edit miner configuration',
  'miners.delete': 'Delete miners',
  'miners.control': 'Start/stop/reboot miners',
  'miners.transfer': 'Transfer miner ownership',
  
  // Pools
  'pools.view': 'View pool configurations',
  'pools.edit': 'Edit pool configurations',
  'pools.api_keys.manage': 'Manage pool API keys',
  
  // Alerts
  'alerts.view': 'View alerts',
  'alerts.acknowledge': 'Acknowledge alerts',
  'alert_rules.manage': 'Manage alert rules',
  
  // Users
  'users.view': 'View users',
  'users.create': 'Create new users',
  'users.edit': 'Edit user details',
  'users.delete': 'Delete users',
  'users.roles.assign': 'Assign user roles',
  
  // Settings
  'settings.view': 'View settings',
  'settings.edit': 'Edit settings',
  
  // System
  'system.logs.view': 'View system logs',
  'system.backup': 'Backup system data',
  'system.database.cleanup': 'Database cleanup operations',
  
  // Audit
  'audit.view': 'View audit logs',
};

// Permission checker middleware
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Check if user has permission
    if (!userHasPermission(req.user.id, permission)) {
      auditLog(req.user.id, 'permission.denied', permission);
      return res.status(403).json({ 
        error: 'Forbidden',
        message: `You do not have permission: ${permission}` 
      });
    }
    
    next();
  };
};

// Usage in routes
router.delete('/mining/miners/:minerId', 
  authenticateSession,
  requirePermission('miners.delete'),
  async (req, res, next) => {
    // ...
  }
);
```

### Phase 3: User Management UI (Week 5)

#### 3.1 Admin User Management Page
- List all users with filters (role, status, last login)
- Search by username/chat ID
- Create/invite new users
- Edit user roles and permissions
- Suspend/reactivate users
- View user audit log
- Force logout (revoke all sessions)

#### 3.2 User Profile Page
- View own profile
- View active sessions
- Logout from specific devices
- Change notification preferences
- View own audit log

#### 3.3 Audit Log Viewer (Admin Only)
- Filter by user, action, resource, date range
- Export audit logs to CSV
- Real-time log streaming (WebSocket)

### Phase 4: Advanced Features (Week 6+)

#### 4.1 Multi-Tenancy / Organizations
```sql
CREATE TABLE organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  settings TEXT,  -- JSON
  FOREIGN KEY (owner_user_id) REFERENCES users(id)
);

CREATE TABLE organization_members (
  organization_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,  -- org_admin, org_member
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (organization_id, user_id),
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Miners belong to organizations
ALTER TABLE miners ADD COLUMN organization_id INTEGER;
ALTER TABLE miners ADD FOREIGN KEY (organization_id) REFERENCES organizations(id);
```

#### 4.2 API Key Management per Service
```sql
CREATE TABLE api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT UNIQUE NOT NULL,  -- bcrypt hash
  name TEXT NOT NULL,
  user_id INTEGER,  -- NULL for system keys
  service_name TEXT,  -- 'python-scheduler', 'grafana', etc.
  permissions TEXT,  -- JSON array of permissions
  created_at INTEGER NOT NULL,
  created_by INTEGER,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked BOOLEAN DEFAULT 0,
  revoked_at INTEGER,
  revoked_by INTEGER,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (revoked_by) REFERENCES users(id)
);
```

#### 4.3 Rate Limiting per User
```sql
CREATE TABLE rate_limits (
  user_id INTEGER PRIMARY KEY,
  requests_count INTEGER DEFAULT 0,
  window_start INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Middleware
export const userRateLimit = (maxRequests: number, windowMs: number) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return next();
    
    const limit = db.getUserRateLimit(req.user.id, windowMs);
    if (limit.count >= maxRequests) {
      return res.status(429).json({ 
        error: 'Too many requests',
        retryAfter: limit.resetAt 
      });
    }
    
    db.incrementUserRequests(req.user.id);
    next();
  };
};
```

#### 4.4 OAuth Integration (Optional)
- Google OAuth for easier login
- GitHub OAuth for developer teams
- SSO for enterprise deployments

---

## 🎯 Implementation Priority

### **MUST HAVE** (Phase 1)
1. ✅ Users table with proper user management
2. ✅ Sessions table with token-based auth
3. ✅ Audit logging for all sensitive operations
4. ✅ httpOnly cookie storage (not localStorage)
5. ✅ Session expiration and renewal

### **SHOULD HAVE** (Phase 2)
6. ✅ Multiple admins support
7. ✅ Permissions system (granular access control)
8. ✅ Role hierarchy (super_admin > admin > manager > user)
9. ✅ Permission-based middleware

### **NICE TO HAVE** (Phase 3-4)
10. ⚪ User management UI
11. ⚪ Audit log viewer
12. ⚪ Organizations/multi-tenancy
13. ⚪ API key management per service
14. ⚪ Per-user rate limiting
15. ⚪ OAuth integration

---

## 📊 Migration Strategy

### Step 1: Data Migration (No Downtime)
1. Create new tables (users, sessions, audit_logs)
2. Migrate existing data:
   - Scan miners table for unique `owner` values
   - Create user records for each unique chat ID
   - Set first user as super_admin (from ADMIN_TELEGRAM_CHAT_ID)
   - Update miners.owner_user_id FK

### Step 2: Backend Updates (Gradual)
1. Keep old auth middleware alongside new (dual mode)
2. Implement new session-based auth
3. Update routes gradually to use new auth
4. Add audit logging to sensitive operations

### Step 3: Frontend Updates
1. Update AuthContext to use session tokens
2. Replace localStorage with httpOnly cookies
3. Update API interceptor
4. Add user management pages (admin only)

### Step 4: Deprecation
1. Log warnings for old auth method usage
2. Set deprecation date (30 days notice)
3. Remove old auth code
4. Clean up environment variables

---

## 🔒 Security Best Practices

### Current Good Practices ✅
- Telegram-based 2FA verification
- Separate system API key for internal services
- Owner-based data filtering
- CORS configuration
- Rate limiting

### Improvements Needed ❌
- [ ] Move from localStorage to httpOnly cookies
- [ ] Implement CSRF protection
- [ ] Add session expiration
- [ ] Implement audit logging
- [ ] Add permission system
- [ ] Secure API key storage (bcrypt hashing)
- [ ] Input validation on all endpoints
- [ ] SQL injection protection (use parameterized queries)
- [ ] XSS protection headers
- [ ] Content Security Policy (CSP)

---

## 📚 Example Implementation

### Example: User Management Service
```typescript
// backend/src/services/user.service.ts
export class UserService {
  async createUser(data: CreateUserDTO, createdBy: number): Promise<User> {
    // Validate input
    if (!data.telegram_chat_id || !data.role) {
      throw new ValidationError('Missing required fields');
    }
    
    // Check permissions
    const creator = await this.getUserById(createdBy);
    if (!this.canCreateUser(creator, data.role)) {
      throw new ForbiddenError('Cannot create user with this role');
    }
    
    // Create user
    const userId = db.insertUser({
      telegram_chat_id: data.telegram_chat_id,
      username: data.username,
      role: data.role,
      status: 'active',
      created_at: Date.now(),
      created_by: createdBy
    });
    
    // Audit log
    auditLog({
      user_id: createdBy,
      action: 'user.create',
      resource_type: 'user',
      resource_id: userId.toString(),
      new_value: JSON.stringify(data),
      result: 'success'
    });
    
    return this.getUserById(userId);
  }
  
  private canCreateUser(creator: User, targetRole: string): boolean {
    // Only super_admin can create admins
    if (targetRole === 'admin' || targetRole === 'super_admin') {
      return creator.role === 'super_admin';
    }
    // Admins can create managers and below
    return ROLE_HIERARCHY[creator.role] >= ROLE_HIERARCHY[targetRole];
  }
}
```

---

## 📝 Checklist

- [ ] **Phase 1 Complete**
  - [ ] Users table created
  - [ ] Sessions table created
  - [ ] Audit logs table created
  - [ ] Session-based auth implemented
  - [ ] Cookies instead of localStorage
  - [ ] Token expiration working
  
- [ ] **Phase 2 Complete**
  - [ ] Permissions table created
  - [ ] Permission checking middleware
  - [ ] Multiple admins supported
  - [ ] Role hierarchy enforced
  
- [ ] **Phase 3 Complete**
  - [ ] User management UI
  - [ ] User profile page
  - [ ] Audit log viewer
  
- [ ] **Phase 4 Complete**
  - [ ] Organizations support
  - [ ] API key management
  - [ ] Per-user rate limiting

---

## 🚀 Quick Wins (Immediate Action)

### 1. Add Audit Logging (2 hours)
Even without the users table, start logging actions:
```typescript
// utils/audit.ts
export const auditLog = (action: string, details: any) => {
  logger.info('AUDIT', {
    timestamp: Date.now(),
    chatId: details.user?.chatId,
    role: details.user?.role,
    action,
    ...details
  });
};

// Use in routes
router.post('/mining/miners/:minerId/transfer', requireAdmin, async (req, res) => {
  const { newOwner } = req.body;
  
  auditLog('miner.transfer', {
    user: req.user,
    minerId: req.params.minerId,
    oldOwner: miner.owner,
    newOwner,
  });
  
  // ... actual transfer logic
});
```

### 2. Switch to httpOnly Cookies (4 hours)
```typescript
// Backend: auth.routes.ts
router.post('/auth/verify-status/:chatId', async (req, res) => {
  const { chatId } = req.params;
  const verification = pendingVerifications.get(chatId);
  
  if (verification?.verified) {
    // Generate session token
    const sessionToken = generateSecureToken();
    db.createSession(userId, sessionToken, 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Set httpOnly cookie
    res.cookie('session_token', sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
    });
    
    return res.json({ verified: true });
  }
  
  res.json({ verified: false });
});

// Frontend: Remove localStorage usage
// Cookies are sent automatically with requests
```

### 3. Add requirePermission Middleware (1 hour)
Start with basic version checking against user role:
```typescript
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    // Basic permission check based on role
    const allowed = ROLE_PERMISSIONS[req.user.role]?.includes(permission);
    if (!allowed) {
      logger.warn('Permission denied', {
        chatId: req.user.chatId,
        role: req.user.role,
        permission
      });
      return res.status(403).json({ error: 'Forbidden' });
    }
    
    next();
  };
};
```

---

## 📖 References

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [NIST Digital Identity Guidelines](https://pages.nist.gov/800-63-3/)
- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [RBAC Wikipedia](https://en.wikipedia.org/wiki/Role-based_access_control)

---

**Document Version:** 1.0  
**Last Updated:** 2025-11-14  
**Status:** Draft / Proposal
