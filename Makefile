wrangle:
	python scripts/wrangle_grants.py --input data/csvs --out out/master.csv

score: wrangle
	python program_scoring.py out/master.csv --out out/scored.csv

import: score
	python import_to_d1.py out/scored.csv --env remote

import-local: score
	python import_to_d1.py out/scored.csv --env local

visualize:
	python visualize_grants_web.py

build-ui:
	cd ui && npm install && npm run build

deploy: build-ui
	wrangler deploy

dev-ui:
	cd ui && npm install && npm run dev

.PHONY: wrangle score import import-local visualize build-ui deploy dev-ui
