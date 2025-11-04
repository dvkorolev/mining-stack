# GitHub Container Registry (GHCR) Troubleshooting Guide

## ⚠️ Important: CI/CD Only Approach

**This project uses GitHub Actions exclusively for building and pushing images.**

Local builds are not supported. If you encountered a permission error, you were likely attempting a local build.

---

## Common Error: Permission Denied (write_package)

### Error Message
```
ERROR: failed to push ghcr.io/dvkorolev/mining-stack/backend:main: denied: permission_denied: write_package
```

### Root Cause

You attempted to build and push Docker images locally. This project uses **CI/CD only**.

---

## Solution: Use GitHub Actions

1. **Push your code to GitHub**:
   ```bash
   git add .
   git commit -m "Update application"
   git push origin main
   ```

2. **GitHub Actions will automatically**:
   - Build the images
   - Push to GHCR
   - Tag appropriately

3. **Monitor the build**:
   - Go to your repository → **Actions** tab
   - Watch the "Build and Push to GHCR" workflow

4. **Deploy on Raspberry Pi**:
   ```bash
   ssh pi@raspberrypi.local
   cd /opt/mining-stack
   ./update-from-registry.sh latest
   ```

---

## Troubleshooting Specific Issues

### Issue: "unauthorized: unauthenticated" (when pulling on Raspberry Pi)

**Cause**: Not logged in to GHCR (only needed for private packages)

**Solution**:
```bash
# Create a read-only token at https://github.com/settings/tokens
# with only read:packages scope

# Login on Raspberry Pi
echo YOUR_TOKEN | docker login ghcr.io -u YOUR_USERNAME --password-stdin
```

**Better Solution**: Make packages public (if open source)

### Issue: "denied: permission_denied: write_package"

**Cause**: Attempted local build instead of using CI/CD

**Solution**: Don't build locally. Push to GitHub and let Actions handle it:
```bash
git push origin main
```

### Issue: "denied: installation not allowed to Write organization package"

**Cause**: Organization package permissions

**Solution**:
1. Go to Organization settings → Packages
2. Enable package creation for the repository
3. Or move the package to your personal account

### Issue: "name unknown: The repository name is invalid"

**Cause**: Incorrect repository name format

**Solution**: Ensure format is `ghcr.io/username/repository/service:tag`
```bash
# Correct format
ghcr.io/dvkorolev/mining-stack/backend:main

# Incorrect formats
ghcr.io/dvkorolev/backend:main  # Missing repository name
ghcr.io/mining-stack/backend:main  # Missing username
```

### Issue: GitHub Actions build failing

**Cause**: Various - check the logs

**Solution**:
1. Go to GitHub → Actions tab
2. Click on the failed workflow
3. Review error logs
4. Fix the issue in your code
5. Push again - Actions will retry automatically

### Issue: "no space left on device"

**Cause**: Docker disk space full

**Solution**:
```bash
# Clean up Docker
docker system prune -af --volumes

# Check disk usage
docker system df
```

---

## Verification

### Check if images were pushed successfully

```bash
# List packages in your repository
# Go to: https://github.com/dvkorolev?tab=packages

# Or use Docker CLI
docker pull ghcr.io/dvkorolev/mining-stack/backend:main
docker pull ghcr.io/dvkorolev/mining-stack/frontend:main
docker pull ghcr.io/dvkorolev/mining-stack/python-scheduler:main
```

### Verify image platforms

```bash
# Check supported platforms
docker buildx imagetools inspect ghcr.io/dvkorolev/mining-stack/backend:main
```

Expected output should show `linux/arm64` for backend and python-scheduler, and both `linux/arm64` and `linux/amd64` for frontend.

---

## Best Practices

1. **Use GitHub Actions for production builds** - More secure and automated
2. **Local builds for testing only** - Use for development and testing
3. **Rotate tokens regularly** - Update PAT every 90 days
4. **Use specific tags** - Avoid using `latest` in production
5. **Keep tokens secure** - Never commit to git, use environment variables
6. **Make packages public** (if open source) - Easier deployment without authentication

---

## Quick Reference

### Environment Variables
```bash
export GITHUB_USERNAME=dvkorolev
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
export GITHUB_REPOSITORY=dvkorolev/mining-stack
```

### Login Command
```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_USERNAME --password-stdin
```

### Build and Push Script
```bash
./scripts/build-and-push-local.sh
```

### Deploy to Raspberry Pi
```bash
./deploy-from-registry.sh pi raspberrypi.local dvkorolev/mining-stack main
```

---

## Additional Resources

- [GitHub Packages Documentation](https://docs.github.com/en/packages)
- [Docker Buildx Documentation](https://docs.docker.com/buildx/working-with-buildx/)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Personal Access Tokens Guide](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)

---

## Support

If you continue to experience issues:

1. Check GitHub Actions logs for automated builds
2. Verify token permissions at https://github.com/settings/tokens
3. Review package settings at https://github.com/dvkorolev?tab=packages
4. Check Docker buildx status: `docker buildx ls`
5. Verify login status: `cat ~/.docker/config.json`
