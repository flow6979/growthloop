.PHONY: setup dev api ui test build serve
PY=backend/.venv/bin/python

setup:            ## first-time install
	python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt
	cd frontend && npm install

api:              ## API + agent loop on :8600
	set -a; [ -f .env ] && . ./.env; set +a; cd backend && .venv/bin/uvicorn growthloop.api:app --reload --port 8600 --reload-dir growthloop

ui:               ## Mission Control dev server on :5173
	cd frontend && npm run dev

dev:              ## both
	$(MAKE) -j2 api ui

test:
	cd backend && .venv/bin/python -m pytest -q tests -p no:warnings

build:            ## build UI so the API serves everything on :8600
	cd frontend && npm run build

serve: build      ## single process, production-ish
	set -a; [ -f .env ] && . ./.env; set +a; cd backend && .venv/bin/uvicorn growthloop.api:app --host 0.0.0.0 --port 8600
