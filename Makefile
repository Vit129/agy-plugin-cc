.PHONY: start preview test build release-check

start: preview

preview:
	npm run preview

test:
	npm test

build:
	npm run build

release-check:
	npm run release:check
