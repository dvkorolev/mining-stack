.PHONY: build up down restart rebuild rebuild-backend rebuild-frontend logs clean prod quick test-rules

# The stack is defined by docker-compose.prod.yml. Add the logging overlay
# (loki/promtail) by overriding COMPOSE_FILES, e.g.:
#   make up COMPOSE_FILES="-f docker-compose.prod.yml -f docker-compose.logging.yml"
COMPOSE_FILES ?= -f docker-compose.prod.yml
COMPOSE = docker-compose $(COMPOSE_FILES)

# Build images with BuildKit
build:
	DOCKER_BUILDKIT=1 $(COMPOSE) build

# Validate and unit-test the Prometheus rule files with the same version the
# Pi runs. The unit test catches rules that silently evaluate an empty vector
# because of a label-set mismatch (DMI-96).
PROMETHEUS_TEST_IMAGE ?= prom/prometheus:v3.14.0
test-rules:
	docker run --rm -v "$$(pwd)/docker/prometheus/rules:/rules:ro" --entrypoint sh $(PROMETHEUS_TEST_IMAGE) -c 'promtool check rules /rules/*.yml'
	docker run --rm -v "$$(pwd)/docker/prometheus/rules:/rules:ro" -w /rules --entrypoint sh $(PROMETHEUS_TEST_IMAGE) -c 'promtool test rules tests/*.test.yml'

# Start services without rebuilding
up:
	$(COMPOSE) up -d

# Stop services
down:
	$(COMPOSE) down

# Restart services without rebuilding
restart:
	$(COMPOSE) restart

# Rebuild and restart specific service
rebuild-backend:
	DOCKER_BUILDKIT=1 $(COMPOSE) build backend
	$(COMPOSE) up -d backend

rebuild-frontend:
	DOCKER_BUILDKIT=1 $(COMPOSE) build frontend
	$(COMPOSE) up -d frontend

# Full rebuild (use sparingly)
rebuild:
	DOCKER_BUILDKIT=1 $(COMPOSE) build
	$(COMPOSE) up -d

# View logs
logs:
	$(COMPOSE) logs -f

# Clean up (removes containers, networks, volumes)
clean:
	$(COMPOSE) down -v
	docker system prune -f

# Production mode
prod:
	DOCKER_BUILDKIT=1 $(COMPOSE) build
	$(COMPOSE) up -d

# Quick restart without rebuild
quick:
	$(COMPOSE) restart
