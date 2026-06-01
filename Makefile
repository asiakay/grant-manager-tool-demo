wrangle:
	python wrangle_grants.py --input data/csvs --out out/master.csv

visualize:
	python visualize_grants_web.py

build-ui:
	cd ui && npm install && npm run build

deploy: build-ui
	wrangler deploy

dev-ui:
	cd ui && npm install && npm run dev

.PHONY: wrangle visualize build-ui deploy dev-ui
