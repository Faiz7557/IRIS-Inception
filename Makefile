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
	@if curl -s http://127.0.0.1:8000/healthz >/dev/null 2>&1; then \
		uv run python apps/api/tests/smoke_e2e.py; \
	else \
		echo "Menjalankan server sementara untuk smoke test..."; \
		(uv run uvicorn main:app --app-dir apps/api --env-file .env --port 8000 >/dev/null 2>&1 & PID=$$!; \
		sleep 5; \
		uv run python apps/api/tests/smoke_e2e.py; \
		RES=$$?; \
		kill $$PID 2>/dev/null || true; \
		exit $$RES); \
	fi

check\:frontend:
	cd apps/web && (bun run typecheck || npm run typecheck) && (bun run lint || npm run lint)

build\:frontend:
	cd apps/web && (bun run build || npm run build)

build\:docker:
	docker build -t jembatan112-api:latest .
