# Contributing to Mining Stack Monitor

Thank you for your interest in contributing to Mining Stack Monitor! We welcome contributions from the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Making Changes](#making-changes)
- [Submitting Changes](#submitting-changes)
- [Code Style](#code-style)
- [Testing](#testing)
- [Documentation](#documentation)

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for everyone.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/mining-stack.git
   cd mining-stack
   ```
3. **Add the upstream repository**:
   ```bash
   git remote add upstream https://github.com/dvkorolev/mining-stack.git
   ```

## Development Setup

### Prerequisites

- Docker and Docker Compose
- Node.js 16+ (for local development)
- Git

### Setting Up the Development Environment

1. **Install dependencies**:
   ```bash
   # Backend
   cd backend
   npm install
   
   # Frontend
   cd ../frontend
   npm install
   ```

2. **Start the development environment**:
   ```bash
   docker compose -f docker-compose.dev.yml up --build
   ```

3. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend: http://localhost:5000

## Making Changes

### Creating a Branch

Always create a new branch for your changes:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/your-bug-fix
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `test/` - Adding or updating tests

### Making Commits

Write clear, concise commit messages:

```bash
git commit -m "Add feature: description of what you added"
git commit -m "Fix: description of what you fixed"
git commit -m "Docs: description of documentation changes"
```

**Good commit message examples:**
- `Add: WebSocket reconnection logic`
- `Fix: Memory leak in mining service`
- `Docs: Update API documentation for new endpoints`
- `Refactor: Simplify miner configuration loading`

**Bad commit message examples:**
- `update`
- `fix bug`
- `changes`

## Submitting Changes

### Before Submitting

1. **Update from upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Test your changes**:
   ```bash
   npm test
   ```

3. **Check code style**:
   ```bash
   npm run lint
   ```

4. **Build the project**:
   ```bash
   npm run build
   ```

### Creating a Pull Request

1. **Push your changes**:
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Open a Pull Request** on GitHub with:
   - Clear title describing the change
   - Detailed description of what changed and why
   - Reference to any related issues
   - Screenshots (if applicable)

**Pull Request Template:**
```markdown
## Description
Brief description of the changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Refactoring

## Related Issues
Fixes #123

## Testing
Describe how you tested your changes

## Screenshots (if applicable)
Add screenshots here

## Checklist
- [ ] Code follows the project's style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex code
- [ ] Documentation updated
- [ ] No new warnings generated
- [ ] Tests added/updated
- [ ] All tests pass
```

## Code Style

### TypeScript/JavaScript

- Use TypeScript for all new code
- Follow the existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

**Example:**
```typescript
/**
 * Fetches mining statistics from the API
 * @returns Promise containing mining statistics
 * @throws Error if the request fails
 */
export const fetchMiningStats = async (): Promise<MiningStatsResponse> => {
  try {
    const response = await api.get<MiningStatsResponse>('/mining/stats');
    return response.data;
  } catch (error) {
    console.error('Error fetching mining stats:', error);
    throw error;
  }
};
```

### React Components

- Use functional components with hooks
- Keep components small and focused
- Use TypeScript interfaces for props

**Example:**
```typescript
interface MinerCardProps {
  miner: MinerStats;
  onRestart: (minerId: string) => void;
}

export const MinerCard: React.FC<MinerCardProps> = ({ miner, onRestart }) => {
  // Component implementation
};
```

### File Organization

- One component per file
- Group related files in directories
- Use index files for exports

```
src/
├── components/
│   ├── MinerCard/
│   │   ├── MinerCard.tsx
│   │   ├── MinerCard.test.tsx
│   │   └── index.ts
│   └── Dashboard/
│       ├── Dashboard.tsx
│       └── index.ts
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

### Writing Tests

- Write tests for new features
- Update tests when modifying existing code
- Aim for high test coverage

**Example:**
```typescript
describe('fetchMiningStats', () => {
  it('should fetch mining statistics successfully', async () => {
    const mockData = { totalHashrate: 100, activeMiners: 2 };
    jest.spyOn(api, 'get').mockResolvedValue({ data: mockData });
    
    const result = await fetchMiningStats();
    
    expect(result).toEqual(mockData);
    expect(api.get).toHaveBeenCalledWith('/mining/stats');
  });
});
```

## Documentation

### Updating Documentation

When making changes, update the relevant documentation:

- **README.md** - For major features or setup changes
- **API.md** - For API endpoint changes
- **CONFIGURATION.md** - For new configuration options
- **TROUBLESHOOTING.md** - For known issues and solutions

### Code Comments

- Add comments for complex logic
- Use JSDoc for public APIs
- Keep comments up to date

## Review Process

1. **Automated Checks**: Your PR will be checked automatically
2. **Code Review**: Maintainers will review your code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, your PR will be merged

## Questions?

If you have questions:
- Open an issue on GitHub
- Check existing issues and discussions
- Review the documentation

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Thank You!

Thank you for contributing to Mining Stack Monitor! Your efforts help make this project better for everyone.
