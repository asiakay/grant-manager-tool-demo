wrangle:
	python wrangle_grants.py --input data/csvs --out out/master.csv

visualize:
	python visualize_grants_web.py

deploy:
	wrangler deploy

.PHONY: wrangle visualize deploy
