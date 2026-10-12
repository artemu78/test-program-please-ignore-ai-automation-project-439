install:
	npm ci

setup: install
	npm link

lint:
	npx eslint .

test:
	node --test test/*.js

.PHONY: install setup lint test
