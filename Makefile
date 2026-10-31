.PHONY: help dev dev\:backend dev\:frontend test test\:smoke check\:frontend build\:frontend build\:docker

help:
	@echo "Perintah Jembatan 112:"
	@echo "  make dev            - Jalankan backend & frontend bersamaan dalam 1 terminal"
	@echo "  make dev:backend    - Jalankan backend FastAPI (port 8000)"
	@echo "  make dev:frontend   - Jalankan frontend Next.js (port 3000)"
	@echo "  make test           - Jalankan unit tests backend (pytest)"
	@echo "  make test:smoke     - Jalankan smoke test panggilan e2e"
	@echo "  make check:frontend - Jalankan typecheck & linter frontend"
	@echo "  make build:frontend - Build produksi Next.js"
	@echo "  make build:docker   - Build Docker image backend"

dev:
	@echo "Menjalankan Backend (8000) dan Frontend (3000)... Tekan Ctrl+C untuk berhenti."
	@trap 'kill 0' EXIT; \
	uv run uvicorn main:app --app-dir apps/api --env-file .env --port 8000 & \
	(cd apps/web && (bun run dev 2>/dev/null || npm run dev)) & \
	wait

dev\:backend:
	uv run uvicorn main:app --app-dir apps/api --env-file .env --port 8000

dev\:frontend:
	cd apps/web && (bun run dev 2>/dev/null || npm run dev)

test:
	uv run pytest -q

test\:smoke:
	uv run python apps/api/tests/smoke_e2e.py

check\:frontend:
	cd apps/web && (bun run typecheck || npm run typecheck) && (bun run lint || npm run lint)

build\:frontend:
	cd apps/web && (bun run build || npm run build)

build\:docker:
	docker build -t jembatan112-api:latest .
