.PHONY: deploy

# Rebuild dist/ from the checked-out source and restart hq.service.
deploy:
	@pnpm run deploy
