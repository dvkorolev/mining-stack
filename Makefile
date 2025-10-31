.PHONY: build up down restart rebuild logs clean dev prod

# Build images with BuildKit
build:
	DOCKER_BUILDKIT=1 docker-compose build

# Start services without rebuilding
up:
	docker-compose up -d

# Stop services
down:
	docker-compose down

# Restart services without rebuilding
restart:
	docker-compose restart

# Rebuild and restart specific service
rebuild-backend:
	DOCKER_BUILDKIT=1 docker-compose build backend
	docker-compose up -d backend

rebuild-frontend:
	DOCKER_BUILDKIT=1 docker-compose build frontend
	docker-compose up -d frontend

# Full rebuild (use sparingly)
rebuild:
	DOCKER_BUILDKIT=1 docker-compose build
	docker-compose up -d

# View logs
logs:
	docker-compose logs -f

# Clean up (removes containers, networks, volumes)
clean:
	docker-compose down -v
	docker system prune -f

# Development mode
dev:
	docker-compose -f docker-compose.dev.yml up

# Production mode
prod:
	DOCKER_BUILDKIT=1 docker-compose build
	docker-compose up -d

# Quick restart without rebuild
quick:
	docker-compose restart
