install:
	npm ci

setup: install
	npm link

lint:
	npx eslint .

test:
	node --test

.PHONY: install setup lint test
