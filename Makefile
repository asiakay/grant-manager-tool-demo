wrangle:
	python wrangle_grants.py --input data/csvs --out out/master.csv

visualize:
	python visualize_grants_web.py

deploy:
	wrangler publish

.PHONY: wrangle visualize deploy
